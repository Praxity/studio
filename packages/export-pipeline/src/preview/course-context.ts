import crypto from "node:crypto";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import { ASSET_FIELDS } from "@praxity/shared-blocks/constants";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import {
	isInlineProjectionMetadataKey,
	prepareInlineBlocks,
} from "@praxity/shared-blocks/inline-markdown";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { buildSlugMap } from "@praxity/shared-blocks/viewer/page-slug";
import {
	resolvePageSlideStyle,
	type SlideStyleDef,
} from "@praxity/shared-blocks/viewer/slide-styles";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { isSafeRemoteUrl, normalizeRootLocalAssetUrl } from "../asset-resolver.ts";
import type { CourseExportInput, DesktopExportInput } from "../build.ts";
import { extractDesktopDesignFromFrontmatter } from "../desktop-design.ts";
import { collectGlossaryTerms, type GlossaryPageTerm } from "../glossary-page.ts";
import {
	type CourseConfig,
	collectRequiredAssessmentIds,
	courseVariables,
	generateCourseCss,
	type HtmlOutputOptions,
	type PreparedHtmlCourse,
	prepareHtmlCourse,
	publishedReadingTimes,
	type UnresolvedNode,
} from "../html-gen.ts";
import {
	admitSelfCheckRuntime,
	captureSelfCheckRuntime,
	type SelfCheckRuntime,
	selfCheckAssetReferences,
	selfCheckPageAssets,
} from "../self-check.ts";
import { cloneAdmittedSelfCheckData, constructSelfCheckPromptData } from "../self-check-prompt.ts";

import {
	admitWriteDistractorsRuntime,
	captureWriteDistractorsRuntime,
	type WriteDistractorsRuntime,
	writeDistractorsAssetReferences,
	writeDistractorsPageAssets,
} from "../write-distractors.ts";

export type SliceKey =
	| `lesson:${string}`
	| `cast:${string}`
	| "theme.css"
	| "design.images"
	| "design.motion"
	| "design.sections"
	| "assets"
	| "nav"
	| "glossary.enabled"
	| "glossary.terms"
	| "assessments"
	| "variables"
	| "narration"
	| "manifest";

export type SliceConsumer =
	| "fragments"
	| "shell"
	| "page-frame"
	| "deck-outline"
	| "glossary-document"
	| "reading-script"
	| "working-directory";

/** Prefix entries apply to every lesson/speaker. Fragment consumers use the
 * page's sourceDigest and referenced cast/asset keys, rather than a whole lesson. */
type DependencyScope =
	| "all"
	| "page"
	| "speaker"
	| "images"
	| "cards"
	| "assets"
	| "mentions"
	| "narration";

export const SLICE_CONSUMERS = {
	"lesson:*": { fragments: "page", shell: "page", "reading-script": "page" },
	"cast:*": { fragments: "speaker" },
	"theme.css": { shell: "all" },
	"design.images": { fragments: "images" },
	"design.motion": { fragments: "cards", shell: "all" },
	"design.sections": { "page-frame": "all", shell: "all" },
	assets: { fragments: "assets", "working-directory": "all" },
	nav: { shell: "all", "deck-outline": "all" },
	"glossary.enabled": { shell: "all", "deck-outline": "all" },
	"glossary.terms": { "glossary-document": "all" },
	assessments: { shell: "all", "deck-outline": "all" },
	variables: { fragments: "mentions", shell: "all" },
	narration: { "reading-script": "narration", "deck-outline": "all" },
	manifest: { shell: "all" },
} as const satisfies Record<
	Exclude<SliceKey, `lesson:${string}` | `cast:${string}`> | "lesson:*" | "cast:*",
	Partial<Record<SliceConsumer, DependencyScope>>
>;

export interface ContextSlice {
	readonly value: unknown;
	readonly digest: string;
}

/** Host-captured asset digests. No project filesystem reads happen in this slice.
 * When omitted, bytes already admitted by the host supply the digest. */
export type AssetCache = ReadonlyMap<string, string>;

export type CourseContextInput = (CourseExportInput | DesktopExportInput) & {
	/** The operation service owns admitted sequence numbers. Standalone callers
	 * may omit this until they have a session; refresh then advances locally. */
	seq?: number;
	htmlOutput?: HtmlOutputOptions;
	unresolvedNodes?: ReadonlyMap<string, UnresolvedNode>;
};

export interface PageEntry extends PraxityPage {
	readonly lessonKey: `lesson:${string}`;
	readonly documentSlug: string;
	readonly sourceDigest: string;
	readonly renderDigest: string;
	readonly castKeys: readonly string[];
	readonly assetPaths: readonly string[];
}

export interface DocumentEntry {
	readonly slug: string;
	readonly pageIds: readonly string[];
	readonly kind: "page" | "module" | "glossary" | "resources";
}

export interface CourseContext extends Awaited<ReturnType<typeof prepareCourse>> {
	readonly selfCheckRuntime: SelfCheckRuntime;
	readonly writeDistractorsRuntime: WriteDistractorsRuntime;
	readonly seq: number;
	readonly htmlOutput?: HtmlOutputOptions;
	readonly unresolvedNodes?: ReadonlyMap<string, UnresolvedNode>;
	readonly htmlRendering?: PreparedHtmlCourse;
	readonly renderingOutput?: HtmlOutputOptions;
	/** Opaque session cache owner, retained across refreshes. */
	readonly compilerCache: object;
	readonly slices: Partial<Record<SliceKey, ContextSlice>>;
	readonly pages: readonly PageEntry[];
	readonly documents: readonly DocumentEntry[];
}

export interface CourseContextChanges {
	lessons?: readonly string[];
	manifest?: boolean;
	assets?: readonly string[];
}

// JSON object insertion order and Map insertion order carry no authoring meaning.
// Arrays retain order, except where a slice explicitly owns an unordered set.
function structuralValue(value: unknown): unknown {
	if (value instanceof Map) return structuralValue(Object.fromEntries(value));
	if (Array.isArray(value)) return value.map(structuralValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => !isInlineProjectionMetadataKey(key, { keepDisplay: true }))
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, child]) => [key, structuralValue(child)]),
		);
	}
	return value;
}

function digest(value: unknown): string {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(structuralValue(value)))
		.digest("hex");
}

function slice(value: unknown): ContextSlice {
	return { value: structuredClone(value), digest: digest(value) };
}

function canShowGlossary(
	course: Pick<CourseExportInput, "moduleDeck" | "content" | "glossaryTabEnabled">,
): boolean {
	return course.moduleDeck
		? course.content.some(
				(page) => (page.data?.deckGlossaryPage ?? course.glossaryTabEnabled) !== false,
			)
		: course.glossaryTabEnabled !== false;
}

// DialogueTurnData marks these fields as resolver output, never authored bytes.
const RESOLVED_SPEAKER_FIELDS = ["name", "avatar", "voice", "side"] as const;

function withoutCast(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutCast);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.entries(record).map(([key, child]) => {
			if (isInlineProjectionMetadataKey(key, { keepDisplay: true })) return [key, child];
			if (record.type !== "dialogue" || key !== "data" || !child || typeof child !== "object")
				return [key, withoutCast(child)];
			const data = Object.fromEntries(
				Object.entries(child).filter(([field]) => field !== "speakers"),
			);
			if (Array.isArray(data.turns))
				data.turns = data.turns.map((turn) => {
					if (!turn || typeof turn !== "object") return turn;
					return Object.fromEntries(
						Object.entries(turn).filter(
							([field]) => !(RESOLVED_SPEAKER_FIELDS as readonly string[]).includes(field),
						),
					);
				});
			return [key, withoutCast(data)];
		}),
	);
}

function pageSource(page: PraxityPage) {
	// Navigation metadata does not change a block fragment when a page moves.
	const metadata = Object.fromEntries(
		Object.entries(page.data ?? {}).filter(
			([key]) =>
				![
					"id",
					"title",
					"label",
					"lessonId",
					"lessonTitle",
					"lessonTitleIsFallback",
					"lessonKicker",
					"lessonLocale",
					"isFirstPageOfLesson",
				].includes(key),
		),
	);
	return {
		blocks: withoutCast(page.blocks),
		data: metadata,
		locale: page.locale,
		description: page.description,
		settings: page.settings,
		narrationEnabled: page.narrationEnabled,
		narrationDefaults: page.narrationDefaults,
	};
}

function dialogueCast(blocks: readonly PraxityBlock[]) {
	const speakers = new Map<string, Map<string, unknown>>();
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
			return;
		}
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (record.type === "dialogue") {
			const data = record.data as Record<string, unknown>;
			const entries = new Map(
				Object.entries((data.speakers ?? {}) as Record<string, unknown>).map(([key, entry]) => [
					key.toLowerCase(),
					entry,
				]),
			);
			for (const turn of Array.isArray(data.turns) ? data.turns : []) {
				if (!turn || typeof turn.speaker !== "string") continue;
				const key = turn.speaker.toLowerCase();
				const fields = RESOLVED_SPEAKER_FIELDS.filter((field) => Object.hasOwn(turn, field));
				const metadata = fields.length
					? Object.fromEntries(fields.map((field) => [field, turn[field]]))
					: (entries.get(key) ?? null);
				const values = speakers.get(key) ?? new Map<string, unknown>();
				values.set(digest(metadata), metadata);
				speakers.set(key, values);
			}
		}
		for (const [key, child] of Object.entries(record))
			if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) visit(child);
	};
	visit(blocks);
	return new Map(
		[...speakers].map(([key, values]) => [
			key,
			[...values].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value),
		]),
	);
}

function hasRecord(
	value: unknown,
	predicate: (record: Record<string, unknown>) => boolean,
): boolean {
	if (Array.isArray(value)) return value.some((child) => hasRecord(child, predicate));
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		predicate(record) ||
		Object.entries(record).some(
			([key, child]) =>
				!isInlineProjectionMetadataKey(key, { keepDisplay: true }) && hasRecord(child, predicate),
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasVariableMention(value: unknown): boolean {
	// readLesson projects mentions to HTML; prepared display fields can nest them
	// inside _inline records or arrays. Other mention kinds have no static fallback.
	if (typeof value === "string") return /\bdata-mention="variable:/.test(value);
	if (Array.isArray(value)) return value.some(hasVariableMention);
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.kind === "variable" ||
		Object.entries(record).some(
			([key, child]) =>
				!isInlineProjectionMetadataKey(key, { keepDisplay: true }) && hasVariableMention(child),
		)
	);
}

/** Digests of the values a particular consumer reads. Revalidate against this
 * function on the new context: lesson/asset/narration values are page-scoped,
 * so comparing these records to the aggregate slice digest would over-invalidate. */
export function getPageDependencies(
	context: CourseContext,
	pageId: string,
	consumer: SliceConsumer,
): Partial<Record<SliceKey, string>> {
	const page = context.pages.find((candidate) => candidate.id === pageId);
	if (!page) throw new Error(`Unknown course context page: ${pageId}`);
	const deps: Partial<Record<SliceKey, string>> = {};
	const cast = dialogueCast(page.blocks);
	for (const key of (Object.keys(context.slices) as SliceKey[]).sort()) {
		const declaration = key.startsWith("lesson:")
			? "lesson:*"
			: key.startsWith("cast:")
				? "cast:*"
				: (key as Exclude<SliceKey, `lesson:${string}` | `cast:${string}`>);
		const scope = (SLICE_CONSUMERS[declaration] as Partial<Record<SliceConsumer, DependencyScope>>)[
			consumer
		];
		const current = context.slices[key];
		if (!scope || !current) continue;
		if (scope === "page") {
			if (key === page.lessonKey) deps[key] = page.sourceDigest;
		} else if (scope === "speaker") {
			const speaker = key.slice("cast:".length);
			if (page.castKeys.includes(speaker)) deps[key] = digest(cast.get(speaker) ?? null);
		} else if (scope === "assets") {
			if (page.assetPaths.length === 0) continue;
			if (!(current.value instanceof Map))
				throw new Error("Course context has no captured asset digests.");
			const captured = current.value;
			deps[key] = digest(page.assetPaths.map((name) => [name, captured.get(name) ?? null]));
		} else if (scope === "images") {
			if (hasRecord(page.blocks, (record) => record.type === "image")) deps[key] = current.digest;
		} else if (scope === "cards") {
			if (hasRecord(page.blocks, (record) => record.type === "card")) deps[key] = current.digest;
		} else if (scope === "mentions") {
			if (hasVariableMention(page.blocks)) deps[key] = current.digest;
		} else if (scope === "narration") {
			if (!Array.isArray(current.value))
				throw new Error("Course context has no captured narration.");
			deps[key] = digest(current.value.find((entry) => entry.id === page.id) ?? null);
		} else {
			deps[key] = current.digest;
		}
	}
	return deps;
}

async function makeContext(
	course: CourseContextInput,
	assets: AssetCache,
	seq: number,
	captured?: Awaited<ReturnType<typeof prepareCourse>>,
	runtime = captureSelfCheckRuntime(course),
	distractorsRuntime = captureWriteDistractorsRuntime(course),
): Promise<CourseContext> {
	const prepared = captured ?? (await prepareCourse(course, distractorsRuntime));
	const normalized = prepared.normalizedCourse;
	const selfCheckRuntime = admitSelfCheckRuntime(
		normalized.content,
		runtime,
		new Set(course.unresolvedNodes?.keys()),
	);
	const writeDistractorsRuntime = admitWriteDistractorsRuntime(
		normalized.content,
		distractorsRuntime,
		new Set(course.unresolvedNodes?.keys()),
	);
	const config: CourseConfig = {
		...normalized,
		brandLogo: prepared.desktopBrandLogo,
		pages: normalized.content,
		totalPages: normalized.content.length,
	};
	const slugMap = buildSlugMap(normalized.content);
	const availableAssetPaths = new Set(
		isDesktopExportInput(course)
			? [...course.resolvedAssets.keys()].map(normalizeDesktopAssetPath)
			: assets.keys(),
	);
	const pages = await Promise.all(
		normalized.content.map(async (page): Promise<PageEntry> => {
			const first = normalized.moduleDeck
				? (normalized.content.find(
						(candidate) => (candidate.lessonId ?? candidate.id) === (page.lessonId ?? page.id),
					) ?? page)
				: page;
			const assetPaths = embeddedAssetPaths(
				{ ...page, blocks: withoutCast(page.blocks) },
				availableAssetPaths,
			);
			const cast = dialogueCast(page.blocks);
			const cornerImage = resolvePageSlideStyle(page, normalized.slideStyles).cornerImage;
			if (cornerImage) assetPaths.add(normalizeDesktopAssetPath(cornerImage.split(/[?#]/, 1)[0]));
			await traverseAssetGraph(
				[page],
				{
					onAsset: ({ value, path: fieldPath }) => {
						const speakerIndex = fieldPath.indexOf("speakers");
						const speaker = fieldPath[speakerIndex + 1];
						if (
							speakerIndex >= 0 &&
							typeof speaker === "string" &&
							!cast.has(speaker.toLowerCase())
						)
							return;
						assetPaths.add(
							matchingDesktopAssetPath(value, availableAssetPaths) ??
								normalizeDesktopAssetPath(value.split(/[?#]/, 1)[0]),
						);
					},
				},
				{ assetFields: [...ASSET_FIELDS, "href"] },
			);
			const selfCheckAssets = selfCheckPageAssets(selfCheckRuntime, page.blocks);
			const writeDistractorsAssets = writeDistractorsPageAssets(
				writeDistractorsRuntime,
				page.blocks,
			);
			for (const asset of [...selfCheckAssets, ...writeDistractorsAssets])
				assetPaths.add(asset.path);
			const sourceDigest = writeDistractorsAssets.length
				? digest({ page: pageSource(page), selfCheckAssets, writeDistractorsAssets })
				: selfCheckAssets.length
					? digest({ page: pageSource(page), selfCheckAssets })
					: digest(pageSource(page));
			return {
				...page,
				lessonKey: `lesson:${page.lessonId ?? (isDesktopExportInput(course) ? "desktop-source" : page.id)}`,
				documentSlug: slugMap.get(first.id) ?? first.id,
				sourceDigest,
				renderDigest: digest({ sourceDigest, cast }),
				castKeys: [...cast.keys()].sort(),
				assetPaths: [...assetPaths].sort(),
			};
		}),
	);
	const slices: CourseContext["slices"] = {};
	const lessons = new Map<PageEntry["lessonKey"], Array<{ id: string; sourceDigest: string }>>();
	for (const page of pages) {
		const members = lessons.get(page.lessonKey) ?? [];
		members.push({ id: page.id, sourceDigest: page.sourceDigest });
		lessons.set(page.lessonKey, members);
	}
	for (const [id, members] of lessons)
		slices[id] = slice(members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
	for (const [speaker, value] of dialogueCast(pages.flatMap((page) => page.blocks)))
		slices[`cast:${speaker}`] = slice(value);
	slices["theme.css"] = slice({
		css: generateCourseCss(
			normalized,
			pages.some((page) =>
				Boolean(resolvePageSlideStyle(page, normalized.slideStyles).cornerImage),
			),
		),
		typography: normalized.typography,
	});
	slices["design.images"] = slice({
		treatment: normalized.defaultImageTreatment,
		effects: normalized.imageEffects,
		auto: normalized.imageEffectsAuto,
		metadata: normalized.imageMetadataMap,
		hover: normalized.imageHoverEffect,
	});
	slices["design.motion"] = slice({
		transition: normalized.slideTransition,
		entrance: normalized.motionEntrance,
		stagger: normalized.motionStagger,
	});
	slices["design.sections"] = slice({
		rhythm: normalized.sectionRhythm,
		divider: normalized.dividerStyle,
		transition: normalized.sectionTransition,
		texture: normalized.texture,
		palettes: normalized.sectionPalettes,
		darkPalettes: normalized.darkSectionPalettes,
		slideStyles: normalized.slideStyles,
	});
	const assetDigests = new Map(assets);
	if (isDesktopExportInput(course)) {
		for (const [name, bytes] of course.resolvedAssets) {
			const key = normalizeDesktopAssetPath(name);
			const captured = course.resolvedAssetDigests?.get(name);
			if (captured !== undefined) assetDigests.set(key, captured);
			else if (!assetDigests.has(key))
				assetDigests.set(key, crypto.createHash("sha256").update(bytes).digest("hex"));
		}
	}
	for (const asset of [
		...selfCheckAssetReferences(selfCheckRuntime),
		...writeDistractorsAssetReferences(writeDistractorsRuntime),
	])
		assetDigests.set(asset.path, asset.contentRevision);
	slices.assets = slice(assetDigests);
	const readingTimes = publishedReadingTimes(pages);
	slices.nav = slice(
		pages.map((page, index) => ({
			id: page.id,
			title: page.title,
			slug: slugMap.get(page.id),
			documentSlug: page.documentSlug,
			lessonId: page.lessonId,
			lessonTitle: page.lessonTitle,
			lessonTitleIsFallback: page.lessonTitleIsFallback,
			lessonKicker: page.lessonKicker,
			isFirstPageOfLesson: page.isFirstPageOfLesson,
			readingTimeMinutes: readingTimes.pageMinutes[index],
			courseReadingTimeMinutes: readingTimes.courseMinutes,
		})),
	);
	const glossaryEnabled = canShowGlossary(normalized) && Boolean(normalized.glossaryTerms?.length);
	slices["glossary.enabled"] = slice(glossaryEnabled);
	slices["glossary.terms"] = slice(normalized.glossaryTerms ?? []);
	slices.assessments = slice({
		requireKnowledgeChecks: normalized.requireKnowledgeChecks === true,
		requiredIds:
			normalized.requireKnowledgeChecks === true ? collectRequiredAssessmentIds(pages).sort() : [],
		scoredIds:
			normalized.passingScore !== undefined
				? collectRequiredAssessmentIds(pages, "passingScore").sort()
				: [],
		passingScore: normalized.passingScore,
	});
	slices.variables = slice(courseVariables(config));
	slices.narration = slice(
		pages
			.map((page) => ({
				id: page.id,
				enabled: page.narrationEnabled,
				defaults: page.narrationDefaults,
				segments: page.data?._narrationSegments,
			}))
			.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	);
	slices.manifest = slice({
		id: normalized.id,
		title: normalized.title,
		description: normalized.description,
		locale: normalized.sourceLocale,
		completionMethod: normalized.completionMethod,
		completionThreshold: normalized.completionThreshold,
		completionQuizId: normalized.completionQuizId,
		navigationStyle: normalized.navigationStyle,
		navToggles: normalized.navToggles,
		showCourseNameInNav: normalized.showCourseNameInNav,
		showLessonNameInNav: normalized.showLessonNameInNav,
		showLessonNameAsTitle: normalized.showLessonNameAsTitle,
		brandLogo: prepared.desktopBrandLogo ?? normalized.brandLogo,
		resources: normalized.resourceEntries,
		resourcesEnabled: normalized.resourcesTabEnabled,
		deckDesign: normalized.deckDesign,
		moduleDeck: normalized.moduleDeck,
	});
	const documents = new Map<string, DocumentEntry>();
	for (const page of pages) {
		const previous = documents.get(page.documentSlug);
		documents.set(page.documentSlug, {
			slug: page.documentSlug,
			kind: normalized.moduleDeck ? "module" : "page",
			pageIds: [...(previous?.pageIds ?? []), page.id],
		});
	}
	if (glossaryEnabled)
		documents.set("glossary", { slug: "glossary", kind: "glossary", pageIds: [] });
	if (normalized.resourcesTabEnabled !== false && normalized.resourceEntries?.length)
		documents.set("resources", { slug: "resources", kind: "resources", pageIds: [] });
	const htmlRendering = prepareHtmlCourse(
		{ ...normalized, brandLogo: prepared.desktopBrandLogo, pages, totalPages: pages.length },
		course.htmlOutput
			? (course.htmlOutput.islandAssets ?? { loaderFilename: "", islandFilenames: {} })
			: undefined,
	);
	return {
		...prepared,
		selfCheckRuntime,
		writeDistractorsRuntime,
		seq,
		compilerCache: {},
		slices,
		pages,
		documents: [...documents.values()],
		htmlRendering,
		htmlOutput: course.htmlOutput,
		renderingOutput: course.htmlOutput,
	};
}

function captureUnresolvedNodes(
	nodes?: ReadonlyMap<string, UnresolvedNode>,
): ReadonlyMap<string, UnresolvedNode> | undefined {
	if (!nodes) return undefined;
	const captured = new Map<string, UnresolvedNode>();
	for (const [id, error] of nodes) {
		if (
			typeof id !== "string" ||
			!id.trim() ||
			!isRecord(error) ||
			Reflect.ownKeys(error).length !== 2 ||
			!Object.hasOwn(error, "code") ||
			!Object.hasOwn(error, "line") ||
			error.code !== "invalid-source" ||
			!Number.isSafeInteger(error.line) ||
			error.line < 1
		)
			throw Object.assign(new Error("Invalid unresolved node diagnostic."), {
				code: "EUNRESOLVEDNODE",
			});
		captured.set(id, { code: error.code, line: error.line });
	}
	return captured;
}

export async function createCourseContext(
	input: CourseContextInput,
	assets: AssetCache = new Map(),
): Promise<CourseContext> {
	const seq = input.seq ?? 0;
	if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("Invalid course context sequence.");

	const distractorsRuntime = captureWriteDistractorsRuntime(input);
	const unresolvedNodes = captureUnresolvedNodes(input.unresolvedNodes);
	return {
		...(await makeContext(
			{ ...input, unresolvedNodes },
			assets,
			seq,
			undefined,
			undefined,
			distractorsRuntime,
		)),
		htmlOutput: input.htmlOutput,
		unresolvedNodes,
	};
}

/** Capture an already adapted publishing model without adapting it a second time. */
export async function createCourseContextFromHtml(
	config: CourseConfig &
		Pick<CourseExportInput, "componentDefaults" | "selfCheckContents" | "writeDistractorsContents">,
	htmlOutput: HtmlOutputOptions,
	runtime?: SelfCheckRuntime,
	distractorsRuntime?: WriteDistractorsRuntime,
): Promise<CourseContext> {
	runtime ??= captureSelfCheckRuntime(config);
	const capturedDistractorsRuntime = captureWriteDistractorsRuntime(config);
	distractorsRuntime ??= capturedDistractorsRuntime;
	const {
		selfCheckContents: _selfCheckContent,
		writeDistractorsContents: _writeDistractorsContent,
		...promptConfig
	} = config;
	const pages = cloneAdmittedSelfCheckData(config.pages, config.componentDefaults);
	const normalizedCourse = {
		...promptConfig,
		pages,
		brandLogo: undefined,
		content: pages,
		htmlOutput,
		glossaryTerms: canShowGlossary({ ...promptConfig, content: pages })
			? collectGlossaryTerms(pages)
			: [],
	};
	const context = await makeContext(
		normalizedCourse,
		new Map(),
		0,
		{
			normalizedCourse,
			desktopBrandLogo: config.brandLogo,
			referencedDesktopAssetPaths: undefined,
			styleCarrier: { id: "slide-style-assets", title: "", blocks: [] },
		},
		runtime,
		distractorsRuntime,
	);
	return context;
}

export async function refreshCourseContext(
	previous: CourseContext,
	input: CourseContextInput,
	changed: CourseContextChanges,
): Promise<CourseContext> {
	const courseId = isDesktopExportInput(input) ? input.courseId : input.id;
	if (courseId !== previous.normalizedCourse.id)
		throw new Error("Cannot refresh a context with another course.");
	const seq = input.seq ?? previous.seq + 1;
	if (!Number.isSafeInteger(seq) || seq <= previous.seq)
		throw new Error("Course context sequence must advance.");
	const capturedAssets = previous.slices.assets?.value;
	if (!(capturedAssets instanceof Map))
		throw new Error("Course context has no captured asset digests.");
	const assets = new Map<string, string>(capturedAssets);
	for (const asset of [
		...selfCheckAssetReferences(previous.selfCheckRuntime),
		...writeDistractorsAssetReferences(previous.writeDistractorsRuntime),
	])
		assets.delete(asset.path);
	for (const name of changed.assets ?? []) assets.delete(normalizeDesktopAssetPath(name));
	if (isDesktopExportInput(input)) {
		const present = new Set([...input.resolvedAssets.keys()].map(normalizeDesktopAssetPath));
		for (const name of assets.keys()) if (!present.has(name)) assets.delete(name);
	}
	const distractorsRuntime = captureWriteDistractorsRuntime(input);
	const next = await makeContext(
		{
			...input,
			unresolvedNodes: captureUnresolvedNodes(input.unresolvedNodes),
			htmlOutput: input.htmlOutput ?? previous.htmlOutput,
		},
		assets,
		seq,
		undefined,
		undefined,
		distractorsRuntime,
	);
	const previousPages = new Map(previous.pages.map((page) => [page.id, page]));
	const pages = next.pages.map((page) => {
		const cached = previousPages.get(page.id);
		return cached?.renderDigest === page.renderDigest ? { ...page, blocks: cached.blocks } : page;
	});
	for (const key of Object.keys(next.slices) as SliceKey[]) {
		if (next.slices[key]?.digest === previous.slices[key]?.digest)
			next.slices[key] = previous.slices[key];
	}
	next.normalizedCourse.content = pages;
	return {
		...next,
		pages,
		compilerCache: previous.compilerCache,
		htmlOutput: input.htmlOutput ?? previous.htmlOutput,
		unresolvedNodes: captureUnresolvedNodes(input.unresolvedNodes),
	};
}

export function isDesktopExportInput(
	course: CourseExportInput | DesktopExportInput,
): course is DesktopExportInput {
	return "blocks" in course && "frontmatter" in course && "resolvedAssets" in course;
}

function normalizeDesktopCourseInput(input: DesktopExportInput): CourseExportInput {
	const threshold = input.config.completionThreshold;
	if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
		throw new Error(
			"Completion threshold must be a fraction from 0 to 1 or a percentage above 1 through 100.",
		);
	}
	const passingScore = input.config.passingScore;
	if (
		passingScore !== undefined &&
		(!Number.isFinite(passingScore) || passingScore <= 0 || passingScore > 100)
	) {
		throw new Error(
			"Passing score must be a fraction above 0 through 1 or a percentage above 1 through 100.",
		);
	}
	const title = (input.frontmatter.title as string | undefined)?.trim() || "Untitled Course";
	const description =
		typeof input.frontmatter.description === "string" &&
		input.frontmatter.description.trim().length > 0
			? input.frontmatter.description.trim()
			: undefined;
	const sourceLocale =
		(input.frontmatter.lang as string | undefined)?.trim() || input.locale || "en";
	const design = extractDesktopDesignFromFrontmatter(input.frontmatter);
	return {
		id: input.courseId,
		...(input.config.courseHomeUrl === undefined
			? {}
			: { courseHomeUrl: input.config.courseHomeUrl }),
		moduleDeck: input.config.moduleDeck,
		title,
		description,
		sourceLocale,
		content: [{ id: "desktop-source", title, blocks: input.blocks }],
		slideStyles: input.frontmatter.pageStyles ?? input.frontmatter.styles,
		componentDefaults: input.frontmatter.design?.componentDefaults as
			| Record<string, Record<string, unknown>>
			| undefined,
		cssVars: design.cssVars,
		darkCssVars: design.darkCssVars,
		theme: design.theme,
		typography: design.typography,
		defaultImageTreatment: design.defaultImageTreatment,
		imageEffects: design.imageEffects,
		imageEffectsAuto: design.imageEffectsAuto,
		brandLogo: design.brandLogo,
		customCss: design.customCss,
		navigationStyle: design.navigationStyle,
		navToggles: design.navToggles,
		deckDesign: design.deckDesign,
		showCourseNameInNav: design.showCourseNameInNav,
		showLessonNameInNav: design.showLessonNameInNav,
		showLessonNameAsTitle: design.showLessonNameAsTitle,
		colorMode: design.colorMode,
		dividerStyle: design.dividerStyle,
		sectionTransition: design.sectionTransition,
		sectionRhythm: design.sectionRhythm,
		sectionPalettes: input.config.sectionPalettes,
		darkSectionPalettes: input.config.darkSectionPalettes,
		texture: design.texture,
		slideTransition: design.slideTransition,
		motionEntrance: design.motionEntrance,
		motionStagger: design.motionStagger,
		imageHoverEffect: design.imageHoverEffect,
		glossaryTabEnabled: design.glossaryTabEnabled,
		completionMethod: "percentage",
		// Studio stores fractions; older direct callers pass percentages.
		// Convert only fractions so 80% cannot become an impossible 8000%.
		completionThreshold: threshold <= 1 ? threshold * 100 : threshold,
		requireKnowledgeChecks: input.config.requireKnowledgeChecks === true,
		...(passingScore === undefined
			? {}
			: { passingScore: passingScore <= 1 ? passingScore * 100 : passingScore }),
		reviewMode: input.reviewMode,
		reviewExpiresAt: input.reviewExpiresAt,
	};
}

export function normalizeDesktopAssetPath(assetPath: string): string {
	return assetPath.replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");
}

function matchingDesktopAssetPath(
	url: string,
	resolvedAssetPaths: ReadonlySet<string>,
): string | undefined {
	const normalized = normalizeDesktopAssetPath(url.split(/[?#]/, 1)[0]);
	if (resolvedAssetPaths.has(normalized)) return normalized;
	try {
		const decoded = decodeURIComponent(normalized);
		return resolvedAssetPaths.has(decoded) ? decoded : undefined;
	} catch {
		return undefined;
	}
}

function rewriteDesktopAssetUrl(
	assetUrl: string,
	resolvedAssetPaths: ReadonlySet<string>,
): string | undefined {
	if (assetUrl.startsWith("//")) {
		const absoluteUrl = `https:${assetUrl}`;
		return isSafeRemoteUrl(absoluteUrl) ? absoluteUrl : undefined;
	}
	const rootLocal = normalizeRootLocalAssetUrl(assetUrl, "assets/");
	if (rootLocal) return rootLocal;
	const queryIndex = assetUrl.indexOf("?");
	const fragmentIndex = assetUrl.indexOf("#");
	const suffixIndex =
		queryIndex === -1
			? fragmentIndex
			: fragmentIndex === -1
				? queryIndex
				: Math.min(queryIndex, fragmentIndex);
	const pathPart = suffixIndex === -1 ? assetUrl : assetUrl.slice(0, suffixIndex);
	const suffix = suffixIndex === -1 ? "" : assetUrl.slice(suffixIndex);
	const normalized = normalizeDesktopAssetPath(pathPart);
	return resolvedAssetPaths.has(normalized) ? `${normalized}${suffix}` : undefined;
}

// Authored HTML can embed asset paths outside typed asset fields. Preserve the
// export pipeline's existing literal-path detection for packaging and dependencies.
interface AssetPathTrie {
	children: Map<string, AssetPathTrie>;
	path?: string;
}

// These inventories are owned by context preparation and never mutated. Weak keys
// reuse the index across pages without retaining inventories from earlier refreshes.
const assetPathIndexes = new WeakMap<
	ReadonlySet<string>,
	{ prefixes: RegExp; root: AssetPathTrie }
>();

function embeddedAssetPaths(value: unknown, paths: ReadonlySet<string>): Set<string> {
	const serialized = JSON.stringify(value, (key, child) =>
		isInlineProjectionMetadataKey(key, { keepDisplay: true }) ? undefined : child,
	);
	if (paths.size === 0) return new Set();
	let index = assetPathIndexes.get(paths);
	if (!index) {
		const root: AssetPathTrie = { children: new Map() };
		const prefixes = new Set<string>();
		for (const path of paths) {
			let node = root;
			for (let offset = 0; offset < path.length; offset++) {
				const character = path[offset];
				let child = node.children.get(character);
				if (!child) {
					child = { children: new Map() };
					node.children.set(character, child);
				}
				node = child;
			}
			node.path = path;
			if (path.length > 0) {
				const slash = path.indexOf("/");
				prefixes.add(slash > 0 ? path.slice(0, slash + 1) : path);
			}
		}
		const alternatives = [...prefixes].map((prefix) =>
			prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		);
		// Lookahead visits overlapping occurrences. The trie checks every terminal,
		// including a shorter literal inside a longer one, against serialized JSON.
		index = { prefixes: new RegExp(`(?=${alternatives.join("|") || "(?!)"})`, "g"), root };
		assetPathIndexes.set(paths, index);
	}
	const found = new Set<string>();
	if (paths.has("")) found.add("");
	for (const match of serialized.matchAll(index.prefixes)) {
		let node = index.root;
		for (let offset = match.index; offset < serialized.length; offset++) {
			const child = node.children.get(serialized[offset]);
			if (!child) break;
			node = child;
			if (node.path !== undefined) found.add(node.path);
		}
	}
	// Packaging observes inventory order, not occurrence order in the document.
	return new Set([...paths].filter((path) => found.has(path)));
}

async function prepareCourse(
	course: CourseExportInput | DesktopExportInput,
	distractorsRuntime: WriteDistractorsRuntime,
) {
	const {
		selfCheckContents: _selfCheckContent,
		writeDistractorsContents: _writeDistractorsContent,
		...promptCourse
	} = course;
	course = promptCourse;
	course = isDesktopExportInput(course)
		? { ...course, blocks: cloneAdmittedSelfCheckData(course.blocks) }
		: { ...course, content: cloneAdmittedSelfCheckData(course.content) };
	const normalizedCourse: CourseExportInput & { glossaryTerms: GlossaryPageTerm[] } = {
		...(isDesktopExportInput(course) ? normalizeDesktopCourseInput(course) : course),
		glossaryTerms: [],
	};
	admitWriteDistractorsRuntime(
		normalizedCourse.content,
		distractorsRuntime,
		new Set(course.unresolvedNodes?.keys()),
	);
	const adaptedContent = (normalizedCourse.content ?? []).map((page) => ({
		...page,
		blocks: prepareInlineBlocks(
			constructSelfCheckPromptData(
				adaptGrammarPreviewBlocks(
					page.blocks,
					normalizedCourse.componentDefaults,
					page.locale ?? normalizedCourse.sourceLocale,
					{ moduleDeck: normalizedCourse.moduleDeck },
				),
			),
		),
	}));
	// Style artwork participates in the same asset graph as page metadata. Only
	// selected artwork needs packaging. Unused named styles remain source-only.
	const artworkPages = isDesktopExportInput(course)
		? splitBlocksIntoPages(
				adaptedContent.flatMap((page) => page.blocks),
				normalizedCourse.title,
				normalizedCourse.content[0]?.data,
			)
		: adaptedContent;
	const inheritedStyles = new Set(
		artworkPages.flatMap((page) => {
			const style = resolvePageSlideStyle(page, normalizedCourse.slideStyles);
			return style.cornerImage && style.name ? [style.name] : [];
		}),
	);
	const slideStyles = Object.fromEntries(
		Object.entries(normalizedCourse.slideStyles ?? {}).map(([name, definition]) => {
			if (!definition || typeof definition !== "object" || Array.isArray(definition))
				return [name, definition];
			const copy = { ...definition };
			if (!inheritedStyles.has(name)) delete copy.cornerImage;
			return [name, copy];
		}),
	);
	let styleCarrier: PraxityPage = {
		id: "slide-style-assets",
		title: "",
		blocks: [],
		data: { styles: slideStyles },
	};
	let referencedDesktopAssetPaths: Set<string> | undefined;
	let desktopBrandLogo: CourseConfig["brandLogo"];
	if (isDesktopExportInput(course)) {
		const resolvedAssetPaths = new Set(
			Array.from(course.resolvedAssets.keys(), normalizeDesktopAssetPath),
		);
		referencedDesktopAssetPaths = new Set<string>();
		if (normalizedCourse.brandLogo) {
			const logo = normalizedCourse.brandLogo;
			const localLogoPath = (url: string): string => {
				const rewritten = rewriteDesktopAssetUrl(url, resolvedAssetPaths);
				const assetPath = rewritten?.split(/[?#]/, 1)[0];
				if (!rewritten || !assetPath?.startsWith("assets/") || !resolvedAssetPaths.has(assetPath)) {
					throw new Error(`Missing local brand logo asset: ${url}`);
				}
				referencedDesktopAssetPaths?.add(assetPath);
				return rewritten;
			};
			desktopBrandLogo = {
				localPath: localLogoPath(logo.url),
				darkLocalPath: logo.darkUrl ? localLogoPath(logo.darkUrl) : undefined,
				placement: logo.placement,
				scope: logo.scope,
			};
		}
		for (const assetPath of embeddedAssetPaths(
			[...adaptedContent, styleCarrier],
			resolvedAssetPaths,
		))
			referencedDesktopAssetPaths.add(assetPath);
		const missingNarrationAssets = new Set<string>();
		const missingCaptionAssets = new Set<string>();
		const missingAvatarAssets = new Set<string>();
		// Rewrite while pageBreak blocks are still present; splitting moves their metadata to page data.
		const rewritten = await traverseAssetGraph(
			[...adaptedContent, styleCarrier],
			{
				onAsset: ({ key, path, value }) => {
					const normalized = normalizeDesktopAssetPath(value.split(/[?#]/, 1)[0]);
					const matched = matchingDesktopAssetPath(value, resolvedAssetPaths);
					if (matched) referencedDesktopAssetPaths?.add(matched);
					if (key === "avatar" && !matched) missingAvatarAssets.add(value);
					if (
						["narrationAudio", "narrationTimings", "audioUrl", "timingsUrl"].includes(key) &&
						normalized.startsWith("assets/") &&
						!matched
					) {
						missingNarrationAssets.add(normalized);
					}
					if (
						key === "src" &&
						path.includes("captionTracks") &&
						!/^https:\/\//i.test(value) &&
						!matched
					)
						missingCaptionAssets.add(value);
				},
				rewriteAsset: ({ value }) => {
					const rewrittenUrl = rewriteDesktopAssetUrl(value, resolvedAssetPaths);
					if (rewrittenUrl) {
						referencedDesktopAssetPaths?.add(
							normalizeDesktopAssetPath(rewrittenUrl.split(/[?#]/, 1)[0]),
						);
					}
					return rewrittenUrl;
				},
			},
			{ assetFields: [...ASSET_FIELDS, "href"] },
		);
		if (missingNarrationAssets.size > 0) {
			throw new Error(`Missing narration asset: ${[...missingNarrationAssets].join(", ")}`);
		}
		if (missingCaptionAssets.size > 0) {
			throw new Error(`Missing caption asset: ${[...missingCaptionAssets].join(", ")}`);
		}
		if (missingAvatarAssets.size > 0) {
			throw new Error(`Missing avatar asset: ${[...missingAvatarAssets].join(", ")}`);
		}
		styleCarrier = rewritten.at(-1) ?? styleCarrier;
		const rewrittenSource = rewritten[0];
		normalizedCourse.content = splitBlocksIntoPages(
			rewrittenSource?.blocks ?? [],
			normalizedCourse.title,
			rewrittenSource?.data,
		);
	} else {
		normalizedCourse.content = adaptedContent;
	}

	// Glossary terms come from the inline tooltips in page content. Aggregate here
	// (after page splitting, so entries carry the right page title/slug) rather than
	// at each caller.
	if (canShowGlossary(normalizedCourse)) {
		normalizedCourse.glossaryTerms = collectGlossaryTerms(normalizedCourse.content);
	}

	return { normalizedCourse, styleCarrier, referencedDesktopAssetPaths, desktopBrandLogo };
}
