import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { deserialize, serialize } from "node:v8";
import { deriveSectionPalettes } from "@praxity/editor-core/lib/themes/resolve-theme.ts";
import {
	type DesktopExportInput,
	type SelfCheckContentInput,
	selfCheckContentInput,
	type UnresolvedNode,
	type WriteDistractorsContentInput,
	writeDistractorsContentInput,
} from "@praxity/export-pipeline";
import type { CoursePdfLesson } from "@praxity/format-renderers/pipelines/course-pdf";
import type { DesignVariants, GrammarFrontmatter, ReadLessonResult } from "@praxity/grammar";
import {
	assertCoursePracticeAdmission,
	lessonSourceText,
	partitionLessonPages,
	readLesson,
	readSelfCheckContent,
	readWriteDistractorsContent,
	refuseUnavailableLessonRuntime,
	SelfCheckContentError,
	WriteDistractorsContentError,
} from "@praxity/grammar";
import { colorToHex } from "@praxity/shared-blocks/color-math";
import { isSectionPalette } from "@praxity/shared-blocks/constants";
import { getStrings, interpolate } from "@praxity/shared-blocks/i18n/strings";
import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import {
	narrationDefaultsFromScope,
	resolveNarrationEnabled,
} from "@praxity/shared-blocks/narration";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import {
	BUILT_IN_SLIDE_STYLES,
	resolvePageSlideStyle,
	type SlideStyleDef,
} from "@praxity/shared-blocks/viewer/slide-styles";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { parse as parseYaml } from "yaml";
import { deckPresentationData, moduleDeckOptions } from "../../shared/module-deck";
import {
	emptyNarrationReadView,
	NARRATION_SIDECAR_PATH,
	type NarrationSidecarV2,
	type ProjectNarrationWarning,
	parseNarrationSidecarV2,
	resolveLessonNarration,
} from "../../shared/narration-sidecar";
import { isDesktopSubPath } from "../../shared/path-utils";
import { type DesignWarning, resolveDesignSettings } from "../../shared/settings-inheritance";
import type { WorkspaceConfig } from "../../shared/types";
import { readCourseManifestData } from "../course-manifest-io";
import {
	assertIdentityExportable,
	type CourseIdentitySession,
	persistCourseIdentity,
	type ResolvedCourseIdentity,
} from "../identity-store";
import {
	parseLessonSource,
	readLessonSource,
	refuseGrammar3,
	resolveLessonSources,
	resolveLessonSourcesForWrite,
} from "../lesson-source";
import {
	assertOutsideProjectLockCache,
	readFileWithin,
	resolveExistingPathWithin,
} from "../path-security";
import { listProjectAssets } from "../project-assets";
import { withProjectFileTransaction } from "../project-file-transactions";
import { type AuthorWarning, lessonTitleWarnings } from "./accessibility-enforcement";
import { ProjectAssetInventory } from "./project-asset-inventory";

/** A host-owned, disposable preparation cache. Assets have their own admission. */
export class ProjectLessonPreparation {
	constructor(
		readonly projectDir: string,
		readonly maxBytes = 16 * 1024 * 1024,
		readonly maxEntries = 128,
	) {
		if (![maxBytes, maxEntries].every((value) => Number.isSafeInteger(value) && value > 0))
			throw new Error("Invalid lesson preparation budget");
		this.invalidate();
	}
	invalidate(): void {
		lessonPreparations.set(this, { entries: new Map(), bytes: 0 });
	}
}

interface RetainedLessonPreparations {
	entries: Map<string, { key: Buffer; value: Buffer }>;
	bytes: number;
}
const lessonPreparations = new WeakMap<ProjectLessonPreparation, RetainedLessonPreparations>();

export interface BuildExportInputFromProjectOptions {
	identitySession?: CourseIdentitySession;
	assetInventory?: ProjectAssetInventory;
	lessonPreparation?: ProjectLessonPreparation;
	identityOperations?: readonly import("@praxity/content-identity").IdentityOperation[];
	mode?: "preview" | "export";
	loadAssets?: boolean;
	preparePdf?: boolean;
	includeAnswerSheet?: boolean;
	projectDir: string;
	completionThreshold: number;
	requireKnowledgeChecks?: boolean;
	passingScore?: number;
	viewerVersionPath: string;
	lessonFilename?: string;
	/** In-memory authoring source. It is never written back by export input building. */
	lessonSource?: string;
	workspacePath?: string | null;
	/** Trusted host policy. Server sessions disable all ancestor workspace reads. */
	inheritWorkspaceSettings?: boolean;
	/** Read-only by default. Trusted writers must explicitly opt into persistence and recovery. */
	manifestPolicy?: "read-only" | "write";
}

export interface ProjectExportInput extends DesktopExportInput {
	/** Host-only captured source hashes, excluded from compiler manifests. */
	sourceRevisions?: Record<string, string>;
	authorWarnings?: AuthorWarning[];
	designWarnings?: DesignWarning[];
	warnings?: ProjectNarrationWarning[];
	preparedLessons?: CoursePdfLesson[];
}

export interface BuildCourseExportInputOptions extends BuildExportInputFromProjectOptions {
	scope?: "lesson" | "course";
}

function authoredContentInputs(read: ReadLessonResult) {
	const unresolvedNodes = new Map<string, UnresolvedNode>();
	const selfCheckContents: SelfCheckContentInput[] = [];
	const writeDistractorsContents: WriteDistractorsContentInput[] = [];
	const collect = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		if ("type" in value && (value.type === "selfCheck" || value.type === "writeDistractors")) {
			const block = value as PraxityBlock;
			try {
				if (value.type === "selfCheck")
					selfCheckContents.push(
						selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)),
					);
				else
					writeDistractorsContents.push(
						writeDistractorsContentInput(block.id, readWriteDistractorsContent(read, block.id)),
					);
			} catch (error) {
				if (
					!(
						error instanceof SelfCheckContentError && error.code === "self-check-content-invalid"
					) &&
					!(
						error instanceof WriteDistractorsContentError &&
						error.code === "write-distractors-content-invalid"
					)
				)
					throw error;
				unresolvedNodes.set(block.id, {
					code: "invalid-source",
					line: (read.spans.get(block.id)?.startLine ?? 0) + 1,
				});
			}
			return;
		}
		for (const [key, child] of Object.entries(value))
			if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) collect(child);
	};
	collect(read.blocks);
	return {
		selfCheckContents,
		writeDistractorsContents,
		...(unresolvedNodes.size ? { unresolvedNodes } : {}),
	};
}

function pdfSelfCheckInputs(
	inputs: readonly SelfCheckContentInput[],
	includeAnswerSheet?: boolean,
) {
	return includeAnswerSheet === true
		? { selfCheckContents: new Map(inputs.map(({ blockId, content }) => [blockId, content])) }
		: {};
}

function pdfWriteDistractorsInputs(
	inputs: readonly WriteDistractorsContentInput[],
	includeAnswerSheet?: boolean,
) {
	return includeAnswerSheet === true
		? {
				writeDistractorsContents: new Map(inputs.map(({ blockId, content }) => [blockId, content])),
			}
		: {};
}

function sectionPaletteConfig(design: Record<string, unknown>, blocks: PraxityBlock[]) {
	if (
		design.sectionRhythmMode !== "alternate" &&
		design.sectionRhythmMode !== "manual" &&
		!blocks.some(
			(block) =>
				isSectionPalette(block.sectionTheme) ||
				(block.type === "divider" && isSectionPalette(block.data?.palette)),
		)
	)
		return {};
	const variants = design as unknown as DesignVariants;
	const palette = (mode: "light" | "dark") => {
		const vars = resolveDesignTokens(variants, mode);
		return deriveSectionPalettes({
			background: vars["--praxity-color-background"],
			text: vars["--praxity-color-text"],
			accent: vars["--praxity-color-accent"],
			sectionDarkBackground:
				typeof design.sectionDarkBackground === "string"
					? (colorToHex(design.sectionDarkBackground) ?? undefined)
					: undefined,
			sectionAccentBackground:
				typeof design.sectionAccentBackground === "string"
					? (colorToHex(design.sectionAccentBackground) ?? undefined)
					: undefined,
			accentOnDark:
				typeof design.accentOnDark === "string"
					? (colorToHex(design.accentOnDark) ?? undefined)
					: undefined,
		});
	};
	const mode = design.colorMode === "dark" ? "dark" : "light";
	return {
		sectionPalettes: palette(mode),
		...(design.colorMode === "auto" ? { darkSectionPalettes: palette("dark") } : {}),
	};
}

async function readProjectAssets(options: BuildExportInputFromProjectOptions) {
	if (options.loadAssets === false) {
		// PDF still uses publication's asset-reference guards, but only its selected
		// images need bytes (resolved separately by resolvePdfAssets). Admit real
		// paths through the shared filesystem policy; never invent missing assets.
		const paths = options.preparePdf ? await listProjectAssets(options.projectDir) : [];
		return {
			bytes: new Map(paths.map((asset) => [asset, new Uint8Array()])),
			digests: new Map<string, string>(),
		};
	}
	const inventory = options.assetInventory ?? new ProjectAssetInventory(options.projectDir);
	if (
		(await resolveExistingPathWithin(options.projectDir, inventory.projectDir)) !==
		(await resolveExistingPathWithin(options.projectDir, options.projectDir))
	)
		throw new Error("Asset inventory belongs to another project");
	return inventory.read();
}

async function readViewerVersion(viewerVersionPath: string): Promise<string> {
	try {
		const raw = await readFile(viewerVersionPath, "utf-8");
		const parsed = JSON.parse(raw) as {
			viewerSourceHash?: string;
			appVersion?: string;
		};
		return parsed.viewerSourceHash ?? parsed.appVersion ?? "desktop";
	} catch {
		return "desktop";
	}
}

async function readWorkspaceConfig(
	projectDir: string,
	workspacePath: string | null | undefined,
	inheritWorkspaceSettings = true,
): Promise<WorkspaceConfig | null> {
	if (!inheritWorkspaceSettings) return null;
	const candidateRoots: string[] = [];
	if (workspacePath && isDesktopSubPath(workspacePath, projectDir)) {
		candidateRoots.push(workspacePath);
	}
	candidateRoots.push(path.dirname(projectDir));

	for (const root of candidateRoots) {
		const configPath = path.join(root, "workspace.praxity.yaml");
		try {
			await assertOutsideProjectLockCache(configPath);
			const raw = await readFile(configPath, "utf-8");
			const parsed = parseYaml(raw) as Record<string, unknown>;
			return {
				defaultTheme: typeof parsed.defaultTheme === "string" ? parsed.defaultTheme : undefined,
				defaultLocale: typeof parsed.defaultLocale === "string" ? parsed.defaultLocale : undefined,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ELOCKCACHE") throw error;
			// Try next candidate.
		}
	}

	return null;
}

export async function readNarrationSidecar(
	projectDir: string,
	courseId: string,
): Promise<NarrationSidecarV2> {
	try {
		return parseNarrationSidecarV2(
			(await readFileWithin(
				projectDir,
				path.join(projectDir, NARRATION_SIDECAR_PATH),
				"utf-8",
			)) as string,
			courseId,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyNarrationReadView(courseId);
		throw error;
	}
}

export class NarrationUnlinkedError extends Error {
	readonly code = "ENARRATIONUNLINKED";
	constructor(readonly details: { file: string; count: number }) {
		super(
			`Narration has ${details.count} unlinked ${details.count === 1 ? "entry" : "entries"} in ${details.file}. Reattach or remove them in Studio before exporting.`,
		);
	}
}

function assertNarrationLinked(
	filename: string,
	count: number,
	enabled: boolean,
	mode: "preview" | "export" = "export",
	warnings: NonNullable<ProjectExportInput["warnings"]>,
): void {
	if (enabled && count > 0) {
		if (mode === "preview") warnings.push({ code: "ENARRATIONUNLINKED", file: filename, count });
		else throw new NarrationUnlinkedError({ file: filename, count });
	}
}

function narrationRuntimeData(
	courseEnabled: boolean | undefined,
	frontmatter: GrammarFrontmatter,
): Record<string, unknown> {
	const defaults = narrationDefaultsFromScope(frontmatter);
	if (
		courseEnabled === undefined &&
		frontmatter.narrationEnabled === undefined &&
		Object.keys(defaults).length === 0
	) {
		return {};
	}
	return {
		_narrationEnabled: resolveNarrationEnabled(courseEnabled, frontmatter.narrationEnabled),
		_narrationDefaults: defaults,
	};
}

function withNarrationRuntime(
	blocks: PraxityBlock[],
	runtime: Record<string, unknown>,
): PraxityBlock[] {
	return blocks.map((block) =>
		block.type === "pageBreak" ? { ...block, data: { ...runtime, ...(block.data ?? {}) } } : block,
	);
}

function toLessonTitle(frontmatter: GrammarFrontmatter, lessonNumber: number, locale: string) {
	const rawTitle = frontmatter.title;
	if (typeof rawTitle === "string" && rawTitle.trim().length > 0) {
		return { title: rawTitle.trim(), isFallback: false };
	}
	return {
		title: interpolate(getStrings(locale).lessonLabel, { n: lessonNumber }),
		isFallback: true,
	};
}

function toLessonKicker(frontmatter: GrammarFrontmatter): string | undefined {
	return typeof frontmatter.kicker === "string"
		? frontmatter.kicker.trim() || undefined
		: undefined;
}

function withLessonIdentity(
	data: Record<string, unknown>,
	lesson: ReturnType<typeof toLessonTitle>,
	lessonKicker: string | undefined,
	lessonId: string,
): Record<string, unknown> {
	return {
		...data,
		lessonTitle: lesson.title,
		...(lesson.isFallback ? { lessonTitleIsFallback: true } : {}),
		lessonId,
		...(lessonKicker !== undefined ? { lessonKicker } : {}),
		isFirstPageOfLesson: true,
	};
}

async function readExportManifest(options: BuildExportInputFromProjectOptions) {
	return readCourseManifestData(options.projectDir);
}
const digest = (source: string) => createHash("sha256").update(source).digest("hex");
async function prepareIdentity(
	options: BuildExportInputFromProjectOptions,
	admitted?: ResolvedCourseIdentity,
) {
	// The caller holds the same admission that issued this identity. Recorded
	// commits reuse their durable reader projections instead of reconciling twice.
	if (admitted) {
		return {
			identity: admitted,
			savedSources: new Map(
				[...admitted.lessons].map(([file, read]) => [file, lessonSourceText(read)]),
			),
		};
	}
	const lessonReads = options.identitySession?.lessonReads() ?? new Map<string, ReadLessonResult>();
	const savedSources = new Map<string, string>();
	// Legacy source must report the converter before I4 publication or persistence checks.
	if (options.lessonSource !== undefined) refuseGrammar3(options.lessonSource, lessonReads);
	const { lessonFilesOnDisk } = await readExportManifest(options);
	for (const filename of lessonFilesOnDisk)
		savedSources.set(
			filename,
			await readLessonSource(options.projectDir, filename, { lessonReads }),
		);
	// Practice source refusals precede identity publication. A required container can
	// be structurally unresolved and must still report its source-located practice error.
	assertCoursePracticeAdmission(
		[...savedSources].map(([path, saved]) => {
			const source = path === options.lessonFilename ? (options.lessonSource ?? saved) : saved;
			const read = lessonReads.get(source) ?? readLesson(source);
			refuseUnavailableLessonRuntime(read, path);
			return { path, read };
		}),
		undefined,
		options.preparePdf ? "native-pdf" : "runtime",
	);
	const sources =
		options.lessonSource !== undefined && options.lessonFilename
			? { [options.lessonFilename]: options.lessonSource }
			: {};
	if (options.mode === "preview")
		return {
			identity: await resolveLessonSources(options.projectDir, sources, {
				identitySession: options.identitySession,
				operations: options.identityOperations,
				lessonReads,
			}),
			savedSources,
		};
	for (const [file, source] of Object.entries(sources))
		if (savedSources.get(file) !== source) throw new Error("Save lesson changes before exporting.");
	if (options.manifestPolicy !== "write")
		return {
			identity: await resolveLessonSources(options.projectDir, sources, {
				strict: true,
				lessonReads,
			}),
			savedSources,
		};
	const durable = await persistCourseIdentity(
		options.projectDir,
		await resolveLessonSourcesForWrite(options.projectDir, sources, { lessonReads }),
	);
	assertIdentityExportable(durable);
	return { identity: durable, savedSources };
}

async function buildLessonInputFromProject(
	options: BuildExportInputFromProjectOptions,
	admitted?: ResolvedCourseIdentity,
): Promise<ProjectExportInput> {
	const { manifest, orderedLessons } = await readExportManifest(options);
	if (orderedLessons.length === 0) {
		throw new Error("No lesson files found for export.");
	}
	const targetLesson = options.lessonFilename ?? orderedLessons[0];
	if (!targetLesson.toLowerCase().endsWith(".prax")) {
		throw new Error(`Invalid lesson filename: ${targetLesson}`);
	}
	if (!orderedLessons.includes(targetLesson)) {
		throw new Error(`Lesson file not found in course manifest: ${targetLesson}`);
	}

	const { identity, savedSources } = await prepareIdentity(
		{
			...options,
			lessonFilename: targetLesson,
		},
		admitted,
	);
	const lessonSource = options.lessonSource ?? savedSources.get(targetLesson);
	assertCoursePracticeAdmission(
		[...identity.lessons].map(([path, read]) => ({ path, read })),
		undefined,
		options.preparePdf ? "native-pdf" : "runtime",
	);
	if (lessonSource === undefined) throw new Error(`Lesson file not found: ${targetLesson}`);
	const parsedLesson = await parseLessonSource(options.projectDir, targetLesson, lessonSource, {
		cast: manifest.cast,
		identity,
	});
	const workspace = await readWorkspaceConfig(
		options.projectDir,
		options.workspacePath,
		options.inheritWorkspaceSettings,
	);
	const resolved = resolveDesignSettings(
		workspace,
		manifest,
		parsedLesson.frontmatter as Record<string, unknown>,
	);
	const sidecar = await readNarrationSidecar(options.projectDir, identity.identity.course.courseId);
	const narration = resolveLessonNarration({
		read: parsedLesson,
		courseId: parsedLesson.courseId,
		lessonId: parsedLesson.lessonId,
		sidecar,
		locale: resolved.locale,
		enabled: manifest.narrationEnabled,
		componentDefaults: resolved.design.componentDefaults as
			| Record<string, Record<string, unknown>>
			| undefined,
		moduleDeck: moduleDeckOptions(
			manifest.moduleDeck,
			parsedLesson.blocks,
			parsedLesson.frontmatter,
		),
		digest,
	});
	const warnings: NonNullable<ProjectExportInput["warnings"]> = [];
	warnings.push(...narration.warnings.map((warning) => ({ ...warning, file: targetLesson })));
	assertNarrationLinked(
		targetLesson,
		narration.unlinked.length,
		resolveNarrationEnabled(manifest.narrationEnabled, narration.frontmatter.narrationEnabled),
		options.mode,
		warnings,
	);
	const lesson = toLessonTitle(
		narration.frontmatter,
		orderedLessons.indexOf(targetLesson) + 1,
		resolved.locale,
	);
	const lessonTitle = lesson.title;
	const lessonKicker = toLessonKicker(narration.frontmatter);
	const lessonId = parsedLesson.lessonId;
	if (!lessonId) throw new Error(`Lesson has no durable ID: ${targetLesson}`);
	const narrationRuntime = narrationRuntimeData(manifest.narrationEnabled, narration.frontmatter);
	const frontmatter: GrammarFrontmatter = {
		...narration.frontmatter,
		title: lessonTitle,
		description:
			manifest.description ??
			(typeof narration.frontmatter.description === "string"
				? narration.frontmatter.description
				: undefined),
		lang: resolved.locale,
		theme: resolved.theme,
		design: resolved.design as unknown as GrammarFrontmatter["design"],
	};
	const lessonMetadata = withLessonIdentity(
		{
			...narrationRuntime,
			...deckPresentationData(manifest.moduleDeck, resolved.design),
		},
		lesson,
		lessonKicker,
		lessonId,
	);
	const firstBoundary = narration.blocks.find((block) => block.type === "pageBreak");
	if (firstBoundary)
		firstBoundary.data = {
			...lessonMetadata,
			lessonLocale: resolved.locale,
			...firstBoundary.data,
		};

	const assets = await readProjectAssets(options);
	const selfChecks = authoredContentInputs(parsedLesson);

	return {
		warnings,
		authorWarnings: lessonTitleWarnings(parsedLesson.frontmatter, targetLesson, resolved.locale),
		...selfChecks,
		designWarnings: resolved.designWarnings.map(({ source, ...warning }) => ({
			...warning,
			file: source === "course" ? "course.yaml" : targetLesson,
		})),
		...(options.preparePdf
			? {
					preparedLessons: [
						{
							id: lessonId,
							title: lessonTitle,
							locale: resolved.locale,
							blocks: withNarrationRuntime(narration.blocks, narrationRuntime),
							...pdfSelfCheckInputs(selfChecks.selfCheckContents, options.includeAnswerSheet),
							// Only explicit native PDF inputs carry grammar-captured distractor Content.
							...pdfWriteDistractorsInputs(
								selfChecks.writeDistractorsContents,
								options.includeAnswerSheet,
							),
							design: resolved.design,
							moduleDeck: moduleDeckOptions(
								manifest.moduleDeck,
								narration.blocks,
								narration.frontmatter,
							),
							componentDefaults: resolved.design.componentDefaults as
								| Record<string, Record<string, unknown>>
								| undefined,
							narrationEnabled: resolveNarrationEnabled(
								manifest.narrationEnabled,
								narration.frontmatter.narrationEnabled,
							),
						},
					],
				}
			: {}),
		courseId: identity.identity.course.courseId,
		blocks: withNarrationRuntime(narration.blocks, narrationRuntime),
		frontmatter,
		config: {
			...(manifest.courseHomeUrl === undefined ? {} : { courseHomeUrl: manifest.courseHomeUrl }),
			...sectionPaletteConfig(resolved.design, narration.blocks),
			moduleDeck: moduleDeckOptions(manifest.moduleDeck, narration.blocks, frontmatter),
			completionThreshold: options.completionThreshold,
			requireKnowledgeChecks: options.requireKnowledgeChecks ?? false,
			...(options.passingScore !== undefined ? { passingScore: options.passingScore } : {}),
		},
		resolvedAssets: assets.bytes,
		resolvedAssetDigests: assets.digests,
		viewerVersion: options.preparePdf
			? "desktop"
			: await readViewerVersion(options.viewerVersionPath),
		locale: resolved.locale,
	};
}

interface CourseLessonPreparationInput {
	lessonNumber: number;
	options: BuildCourseExportInputOptions;
	filename: string;
	lessonSource: string;
	manifest: Awaited<ReturnType<typeof readExportManifest>>["manifest"];
	workspace: WorkspaceConfig | null;
	identity: ResolvedCourseIdentity;
	sidecar: NarrationSidecarV2;
}

async function prepareCourseLesson({
	lessonNumber,
	options,
	filename,
	lessonSource,
	manifest,
	workspace,
	identity,
	sidecar,
}: CourseLessonPreparationInput) {
	const warnings: NonNullable<ProjectExportInput["warnings"]> = [];
	const preparedLessons: CoursePdfLesson[] = [];
	const pageStyles: Record<string, SlideStyleDef> = {};
	const parsedLesson = await parseLessonSource(options.projectDir, filename, lessonSource, {
		cast: manifest.cast,
		identity,
	});
	const resolved = resolveDesignSettings(
		workspace,
		manifest,
		parsedLesson.frontmatter as Record<string, unknown>,
	);
	const narration = resolveLessonNarration({
		read: parsedLesson,
		courseId: parsedLesson.courseId,
		lessonId: parsedLesson.lessonId,
		sidecar: sidecar,
		locale: resolved.locale,
		enabled: manifest.narrationEnabled,
		componentDefaults: resolved.design.componentDefaults as
			| Record<string, Record<string, unknown>>
			| undefined,
		moduleDeck: moduleDeckOptions(
			manifest.moduleDeck,
			parsedLesson.blocks,
			parsedLesson.frontmatter,
		),
		digest,
	});
	warnings.push(...narration.warnings.map((warning) => ({ ...warning, file: filename })));
	assertNarrationLinked(
		filename,
		narration.unlinked.length,
		resolveNarrationEnabled(manifest.narrationEnabled, narration.frontmatter.narrationEnabled),
		options.mode,
		warnings,
	);
	const lesson = toLessonTitle(narration.frontmatter, lessonNumber, resolved.locale);
	const lessonTitle = lesson.title;
	const lessonKicker = toLessonKicker(narration.frontmatter);
	const lessonId = parsedLesson.lessonId;
	if (!lessonId) throw new Error(`Lesson has no durable ID: ${filename}`);
	const narrationRuntime = narrationRuntimeData(manifest.narrationEnabled, narration.frontmatter);
	const selfChecks = authoredContentInputs(parsedLesson);
	if (options.preparePdf)
		preparedLessons.push({
			id: lessonId,
			title: lessonTitle,
			locale: resolved.locale,
			blocks: structuredClone(withNarrationRuntime(narration.blocks, narrationRuntime)),
			...pdfSelfCheckInputs(selfChecks.selfCheckContents, options.includeAnswerSheet),
			// Only explicit native PDF inputs carry grammar-captured distractor Content.
			...pdfWriteDistractorsInputs(selfChecks.writeDistractorsContents, options.includeAnswerSheet),
			design: resolved.design,
			moduleDeck: moduleDeckOptions(manifest.moduleDeck, narration.blocks, narration.frontmatter),
			componentDefaults: resolved.design.componentDefaults as
				| Record<string, Record<string, unknown>>
				| undefined,
			narrationEnabled: resolveNarrationEnabled(
				manifest.narrationEnabled,
				narration.frontmatter.narrationEnabled,
			),
		});

	// Registries are lesson-local. Scope only selected custom definitions in the
	// assembled input, retaining built-in defaults when a lesson overrides one.
	const lessonFirstPage = {
		lessonLocale: resolved.locale,
	};
	const registry = narration.frontmatter.pageStyles ?? narration.frontmatter.styles;
	for (const page of splitBlocksIntoPages(narration.blocks, lessonTitle, lessonFirstPage)) {
		const { name } = resolvePageSlideStyle(page, registry);
		if (!name || !registry || !Object.hasOwn(registry, name)) continue;
		const definition = registry[name];
		if (!definition || typeof definition !== "object" || Array.isArray(definition)) continue;
		const scopedName = `${lessonId}:${name}`;
		pageStyles[scopedName] = {
			...(Object.hasOwn(BUILT_IN_SLIDE_STYLES, name)
				? BUILT_IN_SLIDE_STYLES[name as keyof typeof BUILT_IN_SLIDE_STYLES]
				: {}),
			...definition,
		};
		page.data.pageStyle = scopedName;
	}

	const leadingBoundary = partitionLessonPages(narration.blocks)[0]?.boundary;
	if (leadingBoundary) {
		// The authored boundary already starts this lesson's first page.
		// Implicit-page metadata has no page to apply to in this lesson.
		leadingBoundary.data = withLessonIdentity(
			{
				...narrationRuntime,
				lessonLocale: resolved.locale,
				...deckPresentationData(manifest.moduleDeck, resolved.design),
				...leadingBoundary.data,
			},
			lesson,
			lessonKicker,
			lessonId,
		);
	}
	const blocks = withNarrationRuntime(narration.blocks, narrationRuntime);
	return {
		blocks,
		...selfChecks,
		preparedLessons,
		pageStyles,
		warnings,
		authorWarnings: lessonTitleWarnings(parsedLesson.frontmatter, filename, resolved.locale),
		resolved,
		description: narration.frontmatter.description,
	};
}

async function retainedCourseLesson(input: CourseLessonPreparationInput) {
	const owner = input.options.lessonPreparation;
	const retained = owner && lessonPreparations.get(owner);
	if (!owner || !retained) return prepareCourseLesson(input);
	const read = input.identity.lessons.get(input.filename);
	if (!read || read.tree.stream.source !== input.lessonSource)
		throw new Error(`Identity source revision differs for ${input.filename}`);
	// Admission still runs on every build. Bind preparation to exact source bytes,
	// ID-bearing projections and all settings/narration inputs, including other lessons'
	// narration targets. V8 bytes preserve undefined, Maps and RegExps without JSON collisions.
	const key = serialize([
		input.lessonNumber,
		input.lessonSource,
		read.blocks,
		read.frontmatter,
		input.identity.identity.course.courseId,
		input.identity.identity.heads.find((head) => head.path === input.filename),
		input.manifest,
		input.workspace,
		input.sidecar,
		input.options.mode ?? "export",
		input.options.preparePdf === true,
		input.options.includeAnswerSheet === true,
	]);
	const cached = retained.entries.get(input.filename);
	if (cached?.key.equals(key)) {
		retained.entries.delete(input.filename);
		retained.entries.set(input.filename, cached);
		return deserialize(cached.value) as Awaited<ReturnType<typeof prepareCourseLesson>>;
	}
	const prepared = await prepareCourseLesson(input);
	const value = serialize(prepared);
	// Replacing the owner state prevents an in-flight preparation repopulating it.
	if (lessonPreparations.get(owner) !== retained) return prepared;
	const previous = retained.entries.get(input.filename);
	if (previous) {
		retained.entries.delete(input.filename);
		retained.bytes -= previous.key.byteLength + previous.value.byteLength;
	}
	const size = key.byteLength + value.byteLength;
	if (size > owner.maxBytes) return prepared;
	for (const [filename, entry] of retained.entries) {
		if (retained.bytes + size <= owner.maxBytes && retained.entries.size < owner.maxEntries) break;
		retained.entries.delete(filename);
		retained.bytes -= entry.key.byteLength + entry.value.byteLength;
	}
	retained.entries.set(input.filename, { key, value });
	retained.bytes += size;
	return prepared;
}

export async function buildCourseExportInput(
	options: BuildCourseExportInputOptions,
): Promise<ProjectExportInput> {
	try {
		return await withProjectFileTransaction(
			options.projectDir,
			async (root) => {
				if (
					options.lessonPreparation &&
					(await resolveExistingPathWithin(
						options.lessonPreparation.projectDir,
						options.lessonPreparation.projectDir,
					)) !== root
				)
					throw new Error("Lesson preparation belongs to another project");
				return buildCourseInputSnapshot({ ...options, projectDir: root });
			},
			options.manifestPolicy === "write" ? "write" : "read",
		);
	} catch (error) {
		options.lessonPreparation?.invalidate();
		throw error;
	}
}

async function buildCourseInputSnapshot(
	options: BuildCourseExportInputOptions,
	admitted?: ResolvedCourseIdentity,
): Promise<ProjectExportInput> {
	if (options.scope !== "course") {
		return buildLessonInputFromProject(options, admitted);
	}

	const { manifest, orderedLessons } = await readExportManifest(options);
	if (orderedLessons.length === 0) {
		throw new Error("No lesson files found for export.");
	}
	const workspace = await readWorkspaceConfig(
		options.projectDir,
		options.workspacePath,
		options.inheritWorkspaceSettings,
	);
	const { identity, savedSources } = await prepareIdentity(options, admitted);
	assertCoursePracticeAdmission(
		[...identity.lessons].map(([path, read]) => ({ path, read })),
		undefined,
		options.preparePdf ? "native-pdf" : "runtime",
	);
	const narrationSidecar = await readNarrationSidecar(
		options.projectDir,
		identity.identity.course.courseId,
	);

	const warnings: NonNullable<ProjectExportInput["warnings"]> = [];
	const combinedBlocks: PraxityBlock[] = [];
	const authorWarnings: AuthorWarning[] = [];
	const selfCheckContents: SelfCheckContentInput[] = [];
	const writeDistractorsContents: WriteDistractorsContentInput[] = [];
	const unresolvedNodes = new Map<string, UnresolvedNode>();
	const designWarnings: DesignWarning[] = [];
	const preparedLessons: CoursePdfLesson[] = [];
	const combinedLocale = resolveDesignSettings(workspace, manifest, {}).locale;
	let combinedTheme: string | undefined;
	let combinedDesign: Record<string, unknown> = {};
	let combinedDescription = manifest.description;
	const combinedPageStyles: Record<string, SlideStyleDef> = {};

	for (let index = 0; index < orderedLessons.length; index++) {
		const filename = orderedLessons[index];
		const lessonSource = savedSources.get(filename);
		if (lessonSource === undefined) throw new Error(`Lesson file not found: ${filename}`);
		const prepared = await retainedCourseLesson({
			lessonNumber: index + 1,
			options,
			filename,
			lessonSource,
			manifest,
			workspace,
			identity,
			sidecar: narrationSidecar,
		});
		warnings.push(...prepared.warnings);
		authorWarnings.push(...prepared.authorWarnings);
		for (const { source, ...warning } of prepared.resolved.designWarnings) {
			const file = source === "course" ? "course.yaml" : filename;
			if (
				!designWarnings.some((existing) => existing.file === file && existing.path === warning.path)
			)
				designWarnings.push({ ...warning, file });
		}
		preparedLessons.push(...prepared.preparedLessons);
		Object.assign(combinedPageStyles, prepared.pageStyles);
		combinedBlocks.push(...prepared.blocks);
		selfCheckContents.push(...prepared.selfCheckContents);
		writeDistractorsContents.push(...prepared.writeDistractorsContents);
		for (const [id, diagnostic] of prepared.unresolvedNodes ?? [])
			unresolvedNodes.set(id, diagnostic);
		combinedTheme = combinedTheme ?? prepared.resolved.theme;
		if (index === 0) combinedDesign = prepared.resolved.design;
		if (!combinedDescription && typeof prepared.description === "string") {
			combinedDescription = prepared.description;
		}
	}

	const assets = await readProjectAssets(options);

	const frontmatter: GrammarFrontmatter = {
		title: manifest.title || path.basename(options.projectDir),
		description: combinedDescription,
		lang: combinedLocale,
		theme: combinedTheme,
		design: combinedDesign as unknown as GrammarFrontmatter["design"],
		pageStyles: combinedPageStyles,
		pronunciation: manifest.pronunciation,
	};

	return {
		warnings,
		designWarnings,
		authorWarnings,
		selfCheckContents,
		writeDistractorsContents,
		...(unresolvedNodes.size ? { unresolvedNodes } : {}),
		...(options.preparePdf ? { preparedLessons } : {}),
		courseId: identity.identity.course.courseId,
		blocks: combinedBlocks,
		sourceRevisions: Object.fromEntries(
			[...savedSources]
				.map(([file, source]) => [file, digest(source)])
				.concat([["course.yaml", digest(JSON.stringify(manifest))]]),
		),
		frontmatter,
		config: {
			...(manifest.courseHomeUrl === undefined ? {} : { courseHomeUrl: manifest.courseHomeUrl }),
			...sectionPaletteConfig(combinedDesign, combinedBlocks),
			moduleDeck: moduleDeckOptions(manifest.moduleDeck, combinedBlocks, frontmatter),
			completionThreshold: options.completionThreshold,
			requireKnowledgeChecks: options.requireKnowledgeChecks ?? false,
			...(options.passingScore !== undefined ? { passingScore: options.passingScore } : {}),
		},
		resolvedAssets: assets.bytes,
		resolvedAssetDigests: assets.digests,
		viewerVersion: options.preparePdf
			? "desktop"
			: await readViewerVersion(options.viewerVersionPath),
		locale: combinedLocale,
	};
}

export async function buildExportInputFromProject(
	options: BuildExportInputFromProjectOptions,
): Promise<ProjectExportInput> {
	return withProjectFileTransaction(
		options.projectDir,
		(root) => buildLessonInputFromProject({ ...options, projectDir: root }),
		options.manifestPolicy === "write" ? "write" : "read",
	);
}

/** Trusted host adapter: call inside the project admission that issued identity.
 * This is preview-only; publication keeps its persistence checks above. */
export function buildAdmittedCoursePreviewInput(
	options: BuildCourseExportInputOptions,
	identity: ResolvedCourseIdentity,
): Promise<ProjectExportInput> {
	return buildCourseInputSnapshot(
		{ ...options, mode: "preview", manifestPolicy: "read-only" },
		identity,
	);
}
