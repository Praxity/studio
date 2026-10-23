import crypto from "node:crypto";
import { readdir, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type {
	DeckDesign,
	GrammarFrontmatter,
	ImageEffectsMap,
	ImagePerceptualMetadata,
	NavArchetype,
	TypographyVariants,
} from "@praxity/grammar";
import { compileBlockStatePolicy } from "@praxity/shared-blocks/block-state-policy";
import { getPreviewStrings } from "@praxity/shared-blocks/i18n/strings";
import { LEARNER_STATE_SCHEMA_VERSION } from "@praxity/shared-blocks/learner-state";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import type { ImageTreatment, PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import {
	resolvePageSlideStyle,
	type SlideStyleDef,
} from "@praxity/shared-blocks/viewer/slide-styles";
import fs from "fs-extra";
import { ARTIFACT_MEDIA_TYPES } from "./artifact-media-types.ts";
import { isSafeRemoteUrl, resolveAssets } from "./asset-resolver.ts";
import {
	bundleViewer,
	computeViewerSourceHash,
	type IslandManifestEntryName,
	islandFilesForEntries,
	readViewerManifest,
	type ViewerBundleManifest,
	type ViewerHostName,
	viewerManifestAssetPaths,
} from "./bundle-viewer.ts";
import {
	COURSE_HOME_DECK_SLOT,
	COURSE_HOME_LINK_SLOT,
	DEFAULT_COURSE_HOME_URL,
} from "./course-home";
import { buildExportCssBundle } from "./export-css.ts";
import {
	type CourseConfig,
	DEPLOYMENT_HEAD_MARKER,
	escapeJsonForScript,
	generateCourseCss,
	type UnresolvedNode,
} from "./html-gen.ts";
import { generateHtmlPages } from "./html-pages.ts";
import type { ModuleDeckOptions } from "./module-deck";
import { optimizeResolvedImages } from "./optimize-resolved-images.ts";
import { preparePageCompiler } from "./preview/compile-page.ts";
import {
	createCourseContext,
	isDesktopExportInput,
	normalizeDesktopAssetPath,
} from "./preview/course-context.ts";
import { preparePublishedImages } from "./published-images.ts";
import type { IslandName, RuntimeMode } from "./runtime-plan.ts";
import { declaredCourseActivityId } from "./scorm/activity-id.ts";
import { enumerateFiles, generateManifest } from "./scorm/manifest.ts";
import { generateTincanXml } from "./scorm/tincan-xml.ts";
import type { ExportFormat, Scorm2004Edition } from "./scorm/types.ts";
import {
	type SelfCheckAssetReference,
	type SelfCheckAuthoredContent,
	writeSelfCheckAssets,
} from "./self-check.ts";
import { embedTablerInlineIcons, embedTablerNoteIcons } from "./tabler-note-icons.ts";
import { assertRuntimeLegalInputs, writePackageNotice } from "./third-party-notices.ts";
import { cacheViewerBundle, readCachedViewer, VIEWER_CACHE_DIR } from "./viewer-cache.ts";
import {
	type WriteDistractorsAssetReference,
	type WriteDistractorsAuthoredContent,
	writeWriteDistractorsAssets,
} from "./write-distractors.ts";
import { createZip } from "./zip.ts";

export { buildSlugMap, pageSlug } from "@praxity/shared-blocks/viewer/page-slug";
export { PracticeAdmissionError } from "./practice-admission.ts";
export type { ExportFormat, Scorm2004Edition } from "./scorm/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Content-derived stylesheet names are shared by course and pattern assets. */
export function fingerprintedStylesheetName(
	filename: string,
	content: string | Uint8Array,
): string {
	const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
	return `${path.basename(filename, ".css")}.${hash}.css`;
}

export class EmptyCourseError extends Error {
	readonly code = "EEMPTYCOURSE";
	constructor(locale: string) {
		super(getPreviewStrings(locale).emptyCourse);
	}
}

export interface WriteDistractorsContentInput {
	readonly blockId: string;
	readonly contentRevision: string;
	readonly content: WriteDistractorsAuthoredContent;
}
export { writeDistractorsContentInput } from "./write-distractors.ts";

export interface SelfCheckContentInput {
	readonly blockId: string;
	readonly contentRevision: string;
	readonly content: SelfCheckAuthoredContent;
}
export type { UnresolvedNode } from "./html-gen.ts";
export { selfCheckContentInput } from "./self-check.ts";

export interface CourseExportInput {
	courseHomeUrl?: string;
	unresolvedNodes?: ReadonlyMap<string, UnresolvedNode>;
	/** Explicit authored input. Never copy this channel into pages or generic configuration. */
	selfCheckContents?: readonly SelfCheckContentInput[];
	writeDistractorsContents?: readonly WriteDistractorsContentInput[];
	deckDesign?: DeckDesign;
	moduleDeck?: ModuleDeckOptions;
	componentDefaults?: Record<string, Record<string, unknown>>;
	id: string;
	title: string;
	description?: string;
	sourceLocale: string;
	content: PraxityPage[];
	/** Named declarative slide styles from grammar frontmatter. */
	slideStyles?: Record<string, SlideStyleDef>;
	/** Pre-computed CSS custom properties (--praxity-* keys). */
	cssVars?: Record<string, string>;
	/** Dark-mode CSS custom properties for automatic system color mode. */
	darkCssVars?: Record<string, string>;
	/** camelCase theme values for internal lookups (imageFilterSvgDefs, font selection, etc.). */
	theme?: Record<string, string>;
	/** Normalized body and h1-h6 font configuration. */
	typography?: TypographyVariants;
	defaultImageTreatment?: ImageTreatment;
	imageEffects?: ImageEffectsMap;
	imageEffectsAuto?: boolean;
	imageMetadataMap?: Map<string, ImagePerceptualMetadata>;
	customCss?: string;
	brandLogo?: {
		url: string;
		darkUrl?: string;
		placement: "sidebar" | "header" | "hidden" | "left" | "center";
		/** @deprecated Branding follows course navigation on every page. */
		scope?: "all-pages" | "title-only";
	};
	/** The author's chosen nav archetype. Widened from 3 values to the full
	 *  NavArchetype union — the exporter could not previously represent `slides`,
	 *  the product's default, so it silently exported as `sidebar`. */
	navigationStyle?: NavArchetype;
	// Individual nav toggles customise the archetype; they no longer pick it.
	navToggles?: {
		navOutline?: boolean;
		navHamburgerMenu?: boolean;
		navOutlinePosition?: "left" | "right";
		navPrevNext?: boolean;
		navPrevNextPosition?: "bottom" | "top";
		navProgressStyle?: "bar" | "dots" | "segments" | "none";
		navBottomArrows?: boolean;
		navTopBar?: boolean;
		navReadingSupportPlacement?: "topBar" | "bottomBar" | "sidebar" | "none";
		navFloatingToc?: boolean;
		navScrollProgress?: boolean;
		navEdgeArrows?: boolean;
		navSlideCounter?: boolean;
		navBreadcrumbs?: boolean;
		navCourseTitle?: boolean;
		navLessonTitles?: boolean;
		navLessonTitleAsHeading?: boolean;
		navReadingTime?: boolean;
		navSwipeGestures?: boolean;
		navKeyboardArrows?: boolean;
		showA11yPill?: boolean;
		colorSecondary?: string | null;
		colorTertiary?: string | null;
	};
	showCourseNameInNav?: boolean;
	showLessonNameInNav?: boolean;
	showLessonNameAsTitle?: boolean;
	completionMethod?: "allPages" | "percentage" | "quiz";
	completionThreshold?: number;
	requireKnowledgeChecks?: boolean;
	/**
	 * Course pass mark as a percentage (above 0 through 100). SCORM and xAPI exports
	 * report pass/fail from the score on required, automatically scored questions.
	 */
	passingScore?: number;
	completionQuizId?: string;
	/** xAPI LRS configuration baked into the export. */
	xapiConfig?: {
		endpoint: string;
		auth: string;
		activityBase?: string;
		actorMode: "lms" | "manual";
		actor?: { name: string; mbox: string };
	};
	/** Formatted estimated duration string (e.g., "~12 min"). */
	estimatedDuration?: string;
	/** Whether the glossary tab is enabled in course settings. */
	glossaryTabEnabled?: boolean;
	/** Resource entries for the published resources page. */
	resourceEntries?: Array<{
		title: string;
		description: string;
		url: string;
		resourceType: "file" | "link" | "lessonPdf" | "document";
		lessonTitle?: string;
		lessonSlug?: string;
	}>;
	/** Whether the resources tab is enabled in course settings. */
	resourcesTabEnabled?: boolean;
	/** Section rhythm mode for section-based visual grouping. */
	sectionRhythm?: "uniform" | "alternate" | "manual";
	/** Canonical divider style between sections. */
	dividerStyle?:
		| "none"
		| "thin"
		| "gradient"
		| "ornamental"
		| "wave"
		| "angle"
		| "curve"
		| "squiggle"
		| "blend";
	/** @deprecated Use dividerStyle. SVG shape for section transitions. */
	sectionTransition?: "none" | "wave" | "angle" | "curve" | "squiggle" | "gradient" | "blend";
	/** Background texture overlay for published sections. */
	texture?: "none" | "grain" | "noise" | "paper";
	/** Default transition for Slides blocks when per-block transition is unset. */
	slideTransition?: "none" | "fade" | "slide" | "zoom";
	/** Entrance animation applied to blocks in the published output. */
	motionEntrance?: "none" | "fade" | "slide" | "scale";
	/** Whether list-like items reveal sequentially. */
	motionStagger?: "none" | "sequential";
	/** Hover interaction style applied to published image blocks. */
	imageHoverEffect?: "none" | "lift" | "tilt" | "glow";
	/** Default published appearance mode. */
	colorMode?: "light" | "dark" | "auto";
	/** Pre-derived section palette CSS vars. */
	sectionPalettes?: {
		light: {
			background: string;
			surface: string;
			text: string;
			textLight: string;
			accent: string;
			border: string;
		};
		dark: {
			background: string;
			surface: string;
			text: string;
			textLight: string;
			accent: string;
			border: string;
		};
		accent: {
			background: string;
			surface: string;
			text: string;
			textLight: string;
			accent: string;
			border: string;
		};
		warm: {
			background: string;
			surface: string;
			text: string;
			textLight: string;
			accent: string;
			border: string;
		};
		cool: {
			background: string;
			surface: string;
			text: string;
			textLight: string;
			accent: string;
			border: string;
		};
		growth: {
			background: string;
			surface: string;
			text: string;
			textLight: string;
			accent: string;
			border: string;
		};
	};
	/** Section palettes used when automatic colour mode switches to dark. */
	darkSectionPalettes?: CourseExportInput["sectionPalettes"];
	/** Inject the review-only comment sidebar into standalone HTML output. */
	reviewMode?: boolean;
	/** ISO expiry displayed in the review sidebar footer. */
	reviewExpiresAt?: string;
}

export interface DesktopExportInput {
	unresolvedNodes?: ReadonlyMap<string, UnresolvedNode>;
	selfCheckContents?: readonly SelfCheckContentInput[];
	writeDistractorsContents?: readonly WriteDistractorsContentInput[];
	courseId: string;
	blocks: PraxityBlock[];
	frontmatter: GrammarFrontmatter;
	config: {
		courseHomeUrl?: string;
		sectionPalettes?: CourseExportInput["sectionPalettes"];
		darkSectionPalettes?: CourseExportInput["sectionPalettes"];
		moduleDeck?: ModuleDeckOptions;
		/** Fraction (0–1); legacy percentages above 1 through 100 are also accepted. */
		completionThreshold: number;
		requireKnowledgeChecks?: boolean;
		/** Pass mark as a fraction (above 0 through 1); legacy percentages up to 100 are accepted. */
		passingScore?: number;
	};
	resolvedAssets: Map<string, Uint8Array>;
	/** Digests captured with the host-admitted bytes. */
	resolvedAssetDigests?: ReadonlyMap<string, string>;
	viewerVersion: string;
	locale: string;
	/** Inject the review-only comment sidebar into standalone HTML output. */
	reviewMode?: boolean;
	/** ISO expiry displayed in the review sidebar footer. */
	reviewExpiresAt?: string;
}

export interface BuildOptions {
	mode?: "source" | "desktop";
	format: ExportFormat;
	scorm2004Edition?: Scorm2004Edition;
	/** Timeout in milliseconds for the build (default: 120000) */
	timeout?: number;
	/** Required in desktop mode — path to resources/export-assets. */
	prebuiltAssetsDir?: string;
	/** Required in desktop mode — absolute path to the active project directory. */
	projectDir?: string;
	/** Host-owned workspace for recoverable temporary artifacts. */
	temporaryRoot?: string;
	/** Optional progress callback. Called with the current step and percent completion. */
	onProgress?: (step: string, percent: number) => void;
}

export type CompileCourseOptions = Omit<BuildOptions, "format" | "scorm2004Edition">;

export interface ExportResult {
	/** The packaged export. */
	zip: Buffer;
	/** Number of pages in the course */
	pageCount: number;
	/** Format used */
	format: ExportFormat;
}

export interface CourseArtifactFile {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly mediaType: string;
}

export interface CourseArtifactManifest {
	readonly version: 1;
	readonly rendererContractVersion: 1;
	readonly learnerStateSchemaVersion: 1;
	readonly courseId: string;
	readonly revision: string;
	readonly entry: "index.html";
	readonly pageCount: number;
	readonly pages: readonly CourseArtifactPage[];
	readonly files: readonly CourseArtifactFile[];
}

export interface CourseArtifactPage {
	readonly selfCheckAssets?: readonly SelfCheckAssetReference[];
	readonly writeDistractorsAssets?: readonly WriteDistractorsAssetReference[];
	readonly id: string;
	readonly lessonId?: string;
	readonly slug: string;
	readonly runtime: {
		readonly mode: RuntimeMode;
		readonly islands: readonly IslandName[];
		/** @deprecated Empty in artifact v1; retained for reader compatibility. */
		readonly legacyReasons: readonly never[];
	};
	readonly statefulBlockIds: readonly string[];
}

export interface CourseArtifact {
	readonly manifest: CourseArtifactManifest;
	dispose(): Promise<void>;
}

export interface CoursePackageDeploymentTarget {
	format: ExportFormat;
	scorm2004Edition?: Scorm2004Edition;
	reviewMode?: boolean;
	reviewExpiresAt?: string;
	xapiConfig?: CourseExportInput["xapiConfig"];
}

export type CoursePreviewDeploymentTarget =
	| { format: "electron-preview" }
	| { format: "standalone" };

export type CourseDeploymentTarget = CoursePackageDeploymentTarget | CoursePreviewDeploymentTarget;

export interface CourseArtifactByteRange {
	readonly start: number;
	readonly end: number;
}

export interface CoursePreviewDeployment {
	readonly format: CoursePreviewDeploymentTarget["format"];
	readonly courseToken: string;
	readonly manifest: CourseArtifactManifest;
	openFile(relativePath: string, range?: CourseArtifactByteRange): Promise<Readable>;
	dispose(): Promise<void>;
}

/**
 * Remove an export temp dir reliably. The previous `fs.remove(dir).catch(()=>{})`
 * silently swallowed transient EBUSY/ENOTEMPTY errors from async file-handle
 * release, leaking `praxity-export-*` dirs into the OS temp dir on every export.
 * Native fs.rm with retries handles the transient case; a persistent failure is
 * logged (not fatal — a leaked temp dir must not fail an otherwise-good export).
 */
async function removeTempDir(dir: string): Promise<void> {
	try {
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	} catch (error) {
		console.warn(`[export-pipeline] temp dir cleanup failed for ${dir}:`, error);
	}
}

async function writeResolvedAssetsMap(
	resolvedAssets: Map<string, Uint8Array>,
	assetsDir: string,
	includedAssetPaths?: ReadonlySet<string>,
): Promise<void> {
	for (const [assetPath, bytes] of resolvedAssets) {
		const normalized = normalizeDesktopAssetPath(assetPath);
		if (!normalized.startsWith("assets/")) {
			continue;
		}
		if (includedAssetPaths && !includedAssetPaths.has(normalized)) {
			continue;
		}
		const relativeAssetPath = normalized.replace(/^assets\//, "");
		const destination = path.join(assetsDir, relativeAssetPath);
		await fs.ensureDir(path.dirname(destination));
		await fs.writeFile(destination, Buffer.from(bytes));
	}
}

async function listSchemaEntries(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		const relPath = prefix ? path.posix.join(prefix, entry.name) : entry.name;
		const absPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await listSchemaEntries(absPath, relPath)));
			continue;
		}
		results.push(relPath);
	}

	return results;
}

function getSchemaDirName(format: ExportFormat): string | null {
	if (format === "scorm12") {
		return "scorm12";
	}
	if (format === "scorm2004" || format === "xapi") {
		return "scorm2004";
	}
	return null;
}

async function loadSchemaFiles(
	format: ExportFormat,
	options: Pick<BuildOptions, "mode" | "prebuiltAssetsDir">,
): Promise<Array<{ name: string; content: Buffer }>> {
	if (format === "html") return [];

	const schemaDirName = getSchemaDirName(format);
	if (!schemaDirName) {
		return [];
	}
	const localSchemaDir = path.resolve(__dirname, `../schemas/${schemaDirName}`);
	const candidateDirs: string[] = [];

	if (options.mode === "desktop" && options.prebuiltAssetsDir) {
		candidateDirs.push(path.join(options.prebuiltAssetsDir, "schemas", schemaDirName));
	}
	candidateDirs.push(localSchemaDir);

	const attemptedDirs: string[] = [];
	for (const schemaDir of candidateDirs) {
		attemptedDirs.push(schemaDir);
		let entries: string[];
		try {
			entries = await listSchemaEntries(schemaDir);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		const files: Array<{ name: string; content: Buffer }> = [];
		for (const entry of entries) {
			if (entry.endsWith(".xsd") || entry.endsWith(".dtd")) {
				const content = await readFile(path.join(schemaDir, entry));
				files.push({ name: entry, content });
			}
		}
		if (files.length > 0) {
			// LOM headers refer to license.txt; never replace an incomplete prepared set silently.
			files.push({
				name: "license.txt",
				content: await readFile(path.join(schemaDir, "..", "license.txt")),
			});
			return files.sort((a, b) => a.name.localeCompare(b.name));
		}
	}

	throw new Error(
		`SCORM schema files or notices for format "${format}" are missing. Checked: ${attemptedDirs.join(", ")}`,
	);
}

interface CompiledCourseArtifact {
	tempDir: string;
	distDir: string;
	course: Pick<
		CourseExportInput,
		| "id"
		| "title"
		| "description"
		| "sourceLocale"
		| "moduleDeck"
		| "passingScore"
		| "courseHomeUrl"
	>;
	pageCount: number;
	options: CompileCourseOptions;
	manifest: CourseArtifactManifest;
	hostRuntimePaths: Partial<Record<ViewerHostName, string>>;
	hostRuntimeDependencies: Partial<
		Record<ViewerHostName, { filename: string; path: string | null }[]>
	>;
	reviewAssets: { js: string; css: string } | null;
	activeDeployments: number;
}

const VIEWER_HOST_NAMES = [
	"standalone",
	"electronPreview",
	"scorm12",
	"scorm2004",
	"xapi",
] as const;

const compiledArtifacts = new WeakMap<CourseArtifact, CompiledCourseArtifact>();

function artifactMediaType(filePath: string): string {
	return ARTIFACT_MEDIA_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function assertRevisionRelativeReferences(filePath: string, content: Buffer): void {
	if (!filePath.endsWith(".html") && !filePath.endsWith(".css")) return;
	const text = content.toString("utf8");
	const rootRelativeReference = text.match(
		filePath.endsWith(".html")
			? /\b(?:action|href|poster|src|srcset)\s*=\s*["']\//iu
			: /\burl\(\s*["']?\//iu,
	);
	if (rootRelativeReference) {
		throw new Error(
			`Course artifact reference must be revision-relative or an absolute HTTPS URL: ${filePath} (${rootRelativeReference[0]})`,
		);
	}
}

async function createCourseArtifactManifest(
	distDir: string,
	courseId: string,
	pageCount: number,
	pages: readonly CourseArtifactPage[],
	selfCheckFiles: readonly CourseArtifactFile[] = [],
	writeDistractorsFiles: readonly CourseArtifactFile[] = [],
): Promise<CourseArtifactManifest> {
	const files: CourseArtifactFile[] = [];
	for (const filePath of await enumerateFiles(distDir)) {
		const absolutePath = path.join(distDir, filePath);
		if ((await fs.lstat(absolutePath)).isSymbolicLink()) {
			throw new Error(`Course artifact cannot contain symbolic links: ${filePath}`);
		}
		const content = await readFile(absolutePath);
		assertRevisionRelativeReferences(filePath, content);
		const distractorAsset = writeDistractorsFiles.find((file) => file.path === filePath);
		const owned = selfCheckFiles.find((file) => file.path === filePath) ?? distractorAsset;
		const actual = createCourseArtifactFile(filePath, content);
		if (owned && (owned.sha256 !== actual.sha256 || owned.byteLength !== actual.byteLength))
			throw Object.assign(
				new Error(
					distractorAsset ? "write-distractors-asset-integrity" : "self-check-asset-integrity",
				),
				{
					code: distractorAsset
						? "write-distractors-asset-integrity"
						: "self-check-asset-integrity",
				},
			);
		files.push(owned ?? actual);
	}
	return createCourseArtifactManifestFromFiles(courseId, pageCount, pages, files);
}

function createCourseArtifactFile(filePath: string, content: Buffer): CourseArtifactFile {
	return Object.freeze({
		path: filePath,
		byteLength: content.byteLength,
		sha256: crypto.createHash("sha256").update(content).digest("hex"),
		mediaType: artifactMediaType(filePath),
	});
}

function createCourseArtifactManifestFromFiles(
	courseId: string,
	pageCount: number,
	pages: readonly CourseArtifactPage[],
	inputFiles: readonly CourseArtifactFile[],
): CourseArtifactManifest {
	const revision = crypto.createHash("sha256");
	const files = [...inputFiles].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	for (const file of files) {
		revision.update(file.path).update("\0").update(file.sha256).update("\n");
	}
	return Object.freeze({
		version: 1,
		rendererContractVersion: 1,
		learnerStateSchemaVersion: LEARNER_STATE_SCHEMA_VERSION,
		courseId,
		revision: revision.digest("hex"),
		entry: "index.html",
		pageCount,
		pages: Object.freeze(
			pages.map((page) =>
				Object.freeze({
					...page,
					runtime: Object.freeze({
						...page.runtime,
						islands: Object.freeze([...page.runtime.islands]),
						legacyReasons: Object.freeze([...page.runtime.legacyReasons]),
					}),
					statefulBlockIds: Object.freeze([...page.statefulBlockIds]),
					...(page.writeDistractorsAssets
						? {
								writeDistractorsAssets: Object.freeze(
									page.writeDistractorsAssets.map((asset) => Object.freeze({ ...asset })),
								),
							}
						: {}),
					...(page.selfCheckAssets
						? {
								selfCheckAssets: Object.freeze(
									page.selfCheckAssets.map((asset) => Object.freeze({ ...asset })),
								),
							}
						: {}),
				}),
			),
		),
		files: Object.freeze(files),
	});
}

/** Editor contexts may be empty; every publication format uses this admission. */
export async function preparePublicationContext(course: CourseExportInput | DesktopExportInput) {
	const context = await createCourseContext(course);
	if (context.pages.length === 0) {
		throw new EmptyCourseError(context.normalizedCourse.sourceLocale);
	}
	preparePageCompiler(context);
	return context;
}

async function compileCourseArtifact(
	course: CourseExportInput | DesktopExportInput,
	options: CompileCourseOptions,
): Promise<CompiledCourseArtifact> {
	const mode = options.mode ?? "source";
	const reportProgress = (step: string, percent: number) => {
		options.onProgress?.(step, percent);
	};

	const context = await preparePublicationContext(course);
	const { normalizedCourse, referencedDesktopAssetPaths, desktopBrandLogo } = context;
	let { styleCarrier } = context;

	const tempDir = String(
		await realpath(
			await fs.mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), "praxity-export-")),
		),
	);

	try {
		const templateDir = path.resolve(__dirname, "../template");
		const distDir = path.join(tempDir, "dist");
		const publicDir = path.join(tempDir, "public");
		await fs.ensureDir(distDir);
		await fs.ensureDir(publicDir);

		reportProgress("Preparing export workspace", 5);

		let fontPreloads: string[] = [];
		let builtDesktopCss = false;
		let desktopAssets: {
			viewerCssPath: string;
			islandManifestPath: string | null;
			islandOutputDir: string | null;
			stylesCssPath: string;
			stylesLiteCssPath: string;
			tablerOutlineNodesPath: string;
			tablerFilledNodesPath: string;
		} | null = null;

		if (mode === "desktop") {
			if (!isDesktopExportInput(course)) {
				throw new Error("buildScormPackage: desktop mode requires DesktopExportInput.");
			}
			const prebuiltAssetsDir = options.prebuiltAssetsDir;
			if (!prebuiltAssetsDir) {
				throw new Error("buildScormPackage: prebuiltAssetsDir is required in desktop mode.");
			}
			if (!options.projectDir) {
				throw new Error("buildScormPackage: projectDir is required in desktop mode.");
			}
			desktopAssets = {
				viewerCssPath: path.join(prebuiltAssetsDir, "viewer.css"),
				islandManifestPath: (await fs.pathExists(
					path.join(prebuiltAssetsDir, "viewer-manifest.json"),
				))
					? path.join(prebuiltAssetsDir, "viewer-manifest.json")
					: null,
				islandOutputDir: (await fs.pathExists(path.join(prebuiltAssetsDir, "islands")))
					? path.join(prebuiltAssetsDir, "islands")
					: null,
				stylesCssPath: path.join(prebuiltAssetsDir, "styles.css"),
				stylesLiteCssPath: (await fs.pathExists(path.join(prebuiltAssetsDir, "styles-lite.css")))
					? path.join(prebuiltAssetsDir, "styles-lite.css")
					: path.join(prebuiltAssetsDir, "styles.css"),
				tablerOutlineNodesPath: path.join(prebuiltAssetsDir, "tabler-nodes-outline.json"),
				tablerFilledNodesPath: path.join(prebuiltAssetsDir, "tabler-nodes-filled.json"),
			};
			await fs.ensureDir(path.join(publicDir, "assets"));
			await writeResolvedAssetsMap(
				course.resolvedAssets,
				path.join(publicDir, "assets"),
				referencedDesktopAssetPaths,
			);
			if (await fs.pathExists(path.join(prebuiltAssetsDir, "css-sources", "global.css"))) {
				fontPreloads = await buildExportCssBundle(
					publicDir,
					normalizedCourse.typography,
					prebuiltAssetsDir,
				);
				builtDesktopCss = true;
			}
		} else {
			// 1. Pre-build full and Mantine-free CSS bundles into temp public/.
			//    Font files are copied to public/fonts/.
			fontPreloads = await buildExportCssBundle(publicDir, normalizedCourse.typography);
		}

		// 2. Resolve assets (download remote files, rewrite URLs)
		const assetsDir = path.join(publicDir, "assets");
		const resolvedPages =
			mode === "desktop"
				? normalizedCourse.content
				: await resolveAssets([...normalizedCourse.content, styleCarrier], {
						assetsDir,
						basePath: "assets/",
					});
		if (mode !== "desktop") styleCarrier = resolvedPages.pop() ?? styleCarrier;
		let resolvedBrandLogo = desktopBrandLogo;
		if (normalizedCourse.brandLogo && !isDesktopExportInput(course)) {
			const localPath = await downloadBrandLogoAsset(
				normalizedCourse.brandLogo.url,
				assetsDir,
				"brand-logo",
			);
			const darkLocalPath = normalizedCourse.brandLogo.darkUrl
				? await downloadBrandLogoAsset(
						normalizedCourse.brandLogo.darkUrl,
						assetsDir,
						"brand-logo-dark",
					)
				: undefined;
			resolvedBrandLogo = {
				localPath,
				darkLocalPath,
				placement: normalizedCourse.brandLogo.placement,
				scope: normalizedCourse.brandLogo.scope,
			};
		}
		const optimized = await optimizeResolvedImages(
			resolvedPages,
			styleCarrier,
			assetsDir,
			resolvedBrandLogo,
			options.prebuiltAssetsDir ? path.join(options.prebuiltAssetsDir, "image-codecs") : undefined,
		);
		styleCarrier = optimized.styleCarrier;
		resolvedBrandLogo = optimized.brandLogo;
		normalizedCourse.slideStyles = styleCarrier.data?.styles as Record<string, SlideStyleDef>;
		if (normalizedCourse.imageMetadataMap) {
			const metadata = new Map(normalizedCourse.imageMetadataMap);
			for (const [url, value] of normalizedCourse.imageMetadataMap) {
				const pathPart = url.split(/[?#]/, 1)[0].replace(/^\.\//, "");
				const next = optimized.rewrites.get(pathPart);
				const suffixIndex = url.search(/[?#]/);
				if (next) metadata.set(`${next}${suffixIndex < 0 ? "" : url.slice(suffixIndex)}`, value);
			}
			normalizedCourse.imageMetadataMap = metadata;
		}
		const resolvedContent = await preparePublishedImages(
			optimized.pages,
			assetsDir,
			Boolean(normalizedCourse.moduleDeck),
		);
		await embedTablerNoteIcons(resolvedContent, desktopAssets?.tablerOutlineNodesPath);
		await embedTablerInlineIcons(
			resolvedContent,
			desktopAssets?.tablerOutlineNodesPath,
			desktopAssets?.tablerFilledNodesPath,
		);
		reportProgress("Resolving course assets", 20);

		// 3. Resolve the shared stylesheet, course shell, hosts, and islands.
		let viewerCssPath: string;
		let deckCssPath: string | null = null;
		let retrievalSheetCssPath: string | null = null;
		let shellRuntimePath: string | null = null;
		let hostRuntimePaths: Partial<Record<ViewerHostName, string>> = {};
		let islandManifest: ViewerBundleManifest | null = null;
		let islandOutputDir: string | null = null;

		if (mode === "desktop") {
			if (!desktopAssets) {
				throw new Error("buildScormPackage: desktop assets are not initialized.");
			}
			viewerCssPath = desktopAssets.viewerCssPath;
			if (desktopAssets.islandManifestPath && desktopAssets.islandOutputDir) {
				islandManifest = await readViewerManifest(options.prebuiltAssetsDir as string);
				deckCssPath = path.join(options.prebuiltAssetsDir as string, islandManifest.deckCss);
				retrievalSheetCssPath = path.join(
					options.prebuiltAssetsDir as string,
					islandManifest.retrievalSheetCss,
				);
				islandOutputDir = desktopAssets.islandOutputDir;
				const shellCandidate = path.join(options.prebuiltAssetsDir as string, islandManifest.shell);
				if (!(await fs.pathExists(shellCandidate))) {
					throw new Error("buildScormPackage: missing course shell asset.");
				}
				shellRuntimePath = shellCandidate;
				for (const hostName of VIEWER_HOST_NAMES) {
					const filename = islandManifest.hosts[hostName];
					const candidate = path.join(options.prebuiltAssetsDir as string, filename);
					if (await fs.pathExists(candidate)) hostRuntimePaths[hostName] = candidate;
				}
			}
		} else {
			let currentHash: string | undefined;
			try {
				currentHash = await computeViewerSourceHash();
			} catch {
				// An unavailable source hash remains a cache miss; rebuild as before.
			}
			const cached = currentHash ? await readCachedViewer(VIEWER_CACHE_DIR, currentHash) : null;
			const prebuiltManifest = cached?.manifest;
			if (cached && prebuiltManifest) {
				viewerCssPath = path.join(cached.directory, prebuiltManifest.css);
				deckCssPath = path.join(cached.directory, prebuiltManifest.deckCss);
				retrievalSheetCssPath = path.join(cached.directory, prebuiltManifest.retrievalSheetCss);
				shellRuntimePath = path.join(cached.directory, prebuiltManifest.shell);
				islandOutputDir = path.join(cached.directory, "islands");
				islandManifest = prebuiltManifest;
				hostRuntimePaths = Object.fromEntries(
					Object.entries(prebuiltManifest.hosts).map(([format, filename]) => [
						format,
						path.join(cached.directory, filename),
					]),
				) as Record<ViewerHostName, string>;
			} else {
				console.log("[publish] Viewer bundle is stale — rebuilding…");
				const viewerBuildDir = path.join(tempDir, "viewer-build");
				await fs.ensureDir(viewerBuildDir);
				const built = await bundleViewer(viewerBuildDir);
				viewerCssPath = built.cssPath;
				deckCssPath = built.deckCssPath;
				retrievalSheetCssPath = path.join(viewerBuildDir, built.manifest.retrievalSheetCss);
				shellRuntimePath = built.shellPath;
				islandOutputDir = built.islandOutDir;
				islandManifest = built.manifest;
				hostRuntimePaths = built.hostPaths;

				// Cache the rebuilt viewer so subsequent publishes skip the rebuild.
				try {
					await cacheViewerBundle(
						VIEWER_CACHE_DIR,
						viewerBuildDir,
						built.manifest,
						currentHash ?? (await computeViewerSourceHash()),
					);
				} catch (cacheErr) {
					// Non-fatal — publish continues, just won't cache
					console.warn("[publish] Could not cache viewer bundle:", cacheErr);
				}
			}
		}
		if (!islandManifest || !shellRuntimePath) {
			throw new Error("buildScormPackage: course shell assets are missing or invalid.");
		}
		await fs.copy(
			path.join(path.dirname(shellRuntimePath), islandManifest.resume),
			path.join(distDir, islandManifest.resume),
		);
		reportProgress("Preparing viewer assets", 40);
		if (mode === "desktop" && !builtDesktopCss) {
			if (!desktopAssets) {
				throw new Error("buildScormPackage: desktop assets are not initialized.");
			}
			await Promise.all([
				fs.copy(desktopAssets.stylesCssPath, path.join(publicDir, "styles.css")),
				fs.copy(desktopAssets.stylesLiteCssPath, path.join(publicDir, "styles-lite.css")),
			]);
		}
		const reviewAssetDir = mode === "desktop" ? (options.prebuiltAssetsDir as string) : templateDir;
		const deploymentAssetDir = path.join(tempDir, "deployment-assets");
		await fs.ensureDir(deploymentAssetDir);
		const capturedHostRuntimePaths: Partial<Record<ViewerHostName, string>> = {};
		const capturedHostRuntimeDependencies: CompiledCourseArtifact["hostRuntimeDependencies"] = {};
		const blockStatePolicy = compileBlockStatePolicy(
			normalizedCourse.content.flatMap((page) => page.blocks),
		);
		const hasPolicy = Object.keys(blockStatePolicy).length > 0;
		for (const hostName of VIEWER_HOST_NAMES) {
			const privateFilename = islandManifest.privateHosts?.[hostName];
			if (hasPolicy && !privateFilename) throw new Error("EPRIVACYASSET");
			const source = hasPolicy
				? path.join(path.dirname(shellRuntimePath), privateFilename as string)
				: hostRuntimePaths[hostName];
			if (!source) continue;
			const destination = path.join(deploymentAssetDir, path.basename(source));
			await fs.copy(source, destination);
			capturedHostRuntimePaths[hostName] = destination;
			capturedHostRuntimeDependencies[hostName] = [];
			for (const filename of islandManifest.hostDependencies?.[hostName] ?? []) {
				const dependencySource = path.join(path.dirname(shellRuntimePath), filename);
				const dependencyDestination = path.join(deploymentAssetDir, filename);
				const available = await fs.pathExists(dependencySource);
				if (available) await fs.copy(dependencySource, dependencyDestination);
				capturedHostRuntimeDependencies[hostName]?.push({
					filename,
					path: available ? dependencyDestination : null,
				});
			}
		}
		const reviewSourceJs = path.join(reviewAssetDir, "review-comments.js");
		const reviewSourceCss = path.join(reviewAssetDir, "review-comments.css");
		const reviewAssets =
			(await fs.pathExists(reviewSourceJs)) && (await fs.pathExists(reviewSourceCss))
				? {
						js: path.join(deploymentAssetDir, "review-comments.js"),
						css: path.join(deploymentAssetDir, "review-comments.css"),
					}
				: null;
		if (reviewAssets) {
			await Promise.all([
				fs.copy(reviewSourceJs, reviewAssets.js),
				fs.copy(reviewSourceCss, reviewAssets.css),
			]);
		}
		if (!deckCssPath || !(await fs.pathExists(deckCssPath))) {
			throw new Error("buildScormPackage: missing deck stylesheet asset.");
		}
		const viewerCss = await fs.readFile(viewerCssPath, "utf-8");
		const courseCss = generateCourseCss(
			normalizedCourse,
			resolvedContent.some((page) =>
				Boolean(resolvePageSlideStyle(page, normalizedCourse.slideStyles).cornerImage),
			),
		);
		const deckCss = normalizedCourse.moduleDeck ? await fs.readFile(deckCssPath, "utf-8") : null;
		await Promise.all(
			["styles", "styles-lite"].map(async (name) => {
				const source = path.join(publicDir, `${name}.css`);
				const baseCss = await fs.readFile(source, "utf-8");
				await fs.writeFile(source, `${baseCss}\n${viewerCss}\n${courseCss}`);
				if (deckCss !== null) {
					await fs.writeFile(
						path.join(publicDir, `${name}-deck.css`),
						`${baseCss}\n${viewerCss}\n${deckCss}\n${courseCss}`,
					);
				}
			}),
		);
		const stylesheetFilenames = {} as Record<"full" | "lite" | "deckFull" | "deckLite", string>;
		for (const [kind, sourceFilename] of [
			["full", "styles.css"],
			["lite", "styles-lite.css"],
			...(normalizedCourse.moduleDeck
				? ([
						["deckFull", "styles-deck.css"],
						["deckLite", "styles-lite-deck.css"],
					] as const)
				: []),
		] as const) {
			const sourcePath = path.join(publicDir, sourceFilename);
			const content = await fs.readFile(sourcePath);
			const filename = fingerprintedStylesheetName(sourceFilename, content);
			await fs.move(sourcePath, path.join(publicDir, filename));
			stylesheetFilenames[kind] = filename;
		}

		await fs.copy(shellRuntimePath, path.join(distDir, islandManifest.shell));
		if (hasPolicy) {
			if (!islandManifest.privacy) throw new Error("EPRIVACYASSET");
			for (const file of islandManifest.privacy.files)
				await fs.copy(path.join(path.dirname(shellRuntimePath), file), path.join(distDir, file));
		}

		const hasPrivateChoices = normalizedCourse.content.some((page) =>
			flattenLogicBlocks(page.blocks).some(
				(block) =>
					block.type === "assessment" &&
					block.data.assessmentType === "choice" &&
					compileBlockStatePolicy([block])[block.id] === "device",
			),
		);
		if (hasPrivateChoices) {
			if (!islandManifest.privateChoice) throw new Error("EPRIVATECHOICEASSET");
			await fs.copy(
				path.join(path.dirname(shellRuntimePath), islandManifest.privateChoice),
				path.join(distDir, islandManifest.privateChoice),
			);
		}
		let islandHtmlAssets:
			| {
					privacy?: ViewerBundleManifest["privacy"];
					privateChoice?: string;
					selfCheckLifetime?: string;
					writeDistractorsCss?: string;
					loaderFilename: string;
					islandFilenames: Partial<Record<IslandName, string>>;
			  }
			| undefined;

		if (islandManifest && islandOutputDir) {
			islandHtmlAssets = {
				privacy: islandManifest.privacy,
				privateChoice: islandManifest.privateChoice,
				selfCheckLifetime: islandManifest.selfCheckLifetime,
				writeDistractorsCss: islandManifest.writeDistractorsCss
					? fingerprintedStylesheetName(
							islandManifest.writeDistractorsCss,
							await fs.readFile(
								path.join(path.dirname(viewerCssPath), islandManifest.writeDistractorsCss),
							),
						)
					: undefined,
				loaderFilename: islandManifest.islands["island-loader"],
				islandFilenames: {
					nav: islandManifest.islands["island-nav"],
					accordion: islandManifest.islands["island-accordion"],
					tabs: islandManifest.islands["island-tabs"],
					assessment: islandManifest.islands["island-assessment"],
					assessmentGroup: islandManifest.islands["island-assessment-group"],
					logic: islandManifest.islands["island-logic"],
					checklist: islandManifest.islands["island-checklist"],
					selfCheck: islandManifest.islands["island-self-check"],
					retrievalSheet: islandManifest.islands["island-retrieval-sheet"],
					highlight: islandManifest.islands["island-highlight"],
					writeDistractors: islandManifest.islands["island-write-distractors"],
					rating: islandManifest.islands["island-rating"],
					signature: islandManifest.islands["island-signature"],
					imageComparison: islandManifest.islands["island-image-comparison"],
					labeledGraphic: islandManifest.islands["island-labeled-graphic"],
					narration: islandManifest.islands["island-narration"],
					deck: islandManifest.islands["island-deck"],
					card: islandManifest.islands["island-card"],
					table: islandManifest.islands["island-table"],
					code: islandManifest.islands["island-code"],
					tooltip: islandManifest.islands["island-tooltip"],
					media: islandManifest.islands["island-media"],
					sequence: islandManifest.islands["island-sequence"],
				},
			};
		}

		// 4. Generate HTML pages directly to dist/
		const htmlConfig: Parameters<typeof generateHtmlPages>[0] = {
			courseHomeUrl: normalizedCourse.courseHomeUrl,
			id: normalizedCourse.id,
			moduleDeck: normalizedCourse.moduleDeck,
			deckDesign: normalizedCourse.deckDesign,
			title: normalizedCourse.title,
			description: normalizedCourse.description,
			sourceLocale: normalizedCourse.sourceLocale,
			pages: resolvedContent,
			totalPages: resolvedContent.length,
			slideStyles: normalizedCourse.slideStyles,
			cssVars: normalizedCourse.cssVars,
			darkCssVars: normalizedCourse.darkCssVars,
			theme: normalizedCourse.theme,
			defaultImageTreatment: normalizedCourse.defaultImageTreatment,
			imageEffects: normalizedCourse.imageEffects,
			imageEffectsAuto: normalizedCourse.imageEffectsAuto,
			imageMetadataMap: normalizedCourse.imageMetadataMap,
			customCss: normalizedCourse.customCss,
			brandLogo: resolvedBrandLogo,
			navigationStyle: normalizedCourse.navigationStyle,
			navToggles: normalizedCourse.navToggles,
			showCourseNameInNav: normalizedCourse.showCourseNameInNav,
			showLessonNameInNav: normalizedCourse.showLessonNameInNav,
			showLessonNameAsTitle: normalizedCourse.showLessonNameAsTitle,
			completionMethod: normalizedCourse.completionMethod,
			completionThreshold: normalizedCourse.completionThreshold,
			requireKnowledgeChecks: normalizedCourse.requireKnowledgeChecks,
			passingScore: normalizedCourse.passingScore,
			completionQuizId: normalizedCourse.completionQuizId,
			estimatedDuration: normalizedCourse.estimatedDuration,
			fontPreloads,
			glossaryTerms: normalizedCourse.glossaryTerms,
			glossaryTabEnabled: normalizedCourse.glossaryTabEnabled,
			resourceEntries: normalizedCourse.resourceEntries,
			resourcesTabEnabled: normalizedCourse.resourcesTabEnabled,
			sectionRhythm: normalizedCourse.sectionRhythm,
			dividerStyle: normalizedCourse.dividerStyle,
			sectionTransition: normalizedCourse.sectionTransition,
			texture: normalizedCourse.texture,
			slideTransition: normalizedCourse.slideTransition,
			motionEntrance: normalizedCourse.motionEntrance,
			motionStagger: normalizedCourse.motionStagger,
			imageHoverEffect: normalizedCourse.imageHoverEffect,
			colorMode: normalizedCourse.colorMode,
			sectionPalettes: normalizedCourse.sectionPalettes,
			darkSectionPalettes: normalizedCourse.darkSectionPalettes,
		};

		if (!retrievalSheetCssPath) throw new Error("Missing retrieval-sheet stylesheet asset.");
		const retrievalSheetStylesheetFilename = fingerprintedStylesheetName(
			islandManifest.retrievalSheetCss,
			await fs.readFile(retrievalSheetCssPath),
		);
		const highlightCssPath = path.join(path.dirname(viewerCssPath), islandManifest.highlightCss);
		const hasHighlight = normalizedCourse.content.some((page) =>
			flattenLogicBlocks(page.blocks).some((block) => block.type === "highlight"),
		);
		const highlightStylesheetFilename = hasHighlight
			? fingerprintedStylesheetName(
					islandManifest.highlightCss,
					await fs.readFile(highlightCssPath),
				)
			: undefined;
		const runtimeAssets = await generateHtmlPages(
			htmlConfig,
			distDir,
			islandHtmlAssets,
			undefined,
			stylesheetFilenames.lite,
			islandManifest.shell,
			stylesheetFilenames.full,
			normalizedCourse.moduleDeck
				? { full: stylesheetFilenames.deckFull, lite: stylesheetFilenames.deckLite }
				: undefined,
			islandManifest.resume,
			context.selfCheckRuntime,
			retrievalSheetStylesheetFilename,
			context.writeDistractorsRuntime,
			highlightStylesheetFilename,
		);
		const selfCheckAssetFiles = await writeSelfCheckAssets(context.selfCheckRuntime, distDir);
		const writeDistractorsAssetFiles = await writeWriteDistractorsAssets(
			context.writeDistractorsRuntime,
			distDir,
		);
		if (runtimeAssets.stylesheetsUsed.includes(retrievalSheetStylesheetFilename)) {
			await fs.copy(retrievalSheetCssPath, path.join(publicDir, retrievalSheetStylesheetFilename));
		}
		if (
			highlightStylesheetFilename &&
			runtimeAssets.stylesheetsUsed.includes(highlightStylesheetFilename)
		)
			await fs.copy(highlightCssPath, path.join(publicDir, highlightStylesheetFilename));
		const distractorStylesheet = islandHtmlAssets?.writeDistractorsCss;
		if (
			distractorStylesheet &&
			islandManifest.writeDistractorsCss &&
			runtimeAssets.stylesheetsUsed.includes(distractorStylesheet)
		)
			await fs.copy(
				path.join(path.dirname(viewerCssPath), islandManifest.writeDistractorsCss),
				path.join(publicDir, distractorStylesheet),
			);
		if (normalizedCourse.moduleDeck) {
			for (const filename of Object.values(stylesheetFilenames)) {
				if (filename && !runtimeAssets.stylesheetsUsed.includes(filename)) {
					await fs.remove(path.join(publicDir, filename));
				}
			}
		}
		if (runtimeAssets.islands.length > 0 && islandManifest && islandOutputDir) {
			const entries: IslandManifestEntryName[] = [
				"island-loader",
				...runtimeAssets.islands.map(
					(island): IslandManifestEntryName =>
						`island-${island.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}` as IslandManifestEntryName,
				),
			];
			for (const relPath of islandFilesForEntries(islandManifest, entries)) {
				await fs.copy(path.join(islandOutputDir, relPath), path.join(distDir, relPath));
			}
			if (runtimeAssets.islands.includes("writeDistractors")) {
				if (!islandManifest.writeDistractorsSupport) throw new Error("EWRITEDISTRACTORSSUPPORT");
				for (const file of islandManifest.writeDistractorsSupport)
					await fs.copy(path.join(islandOutputDir, file), path.join(distDir, file));
			}
			if (runtimeAssets.islands.includes("selfCheck")) {
				if (!islandManifest.selfCheckSupport) throw new Error("ESELFCHECKLOAD");
				for (const file of islandManifest.selfCheckSupport)
					await fs.copy(path.join(islandOutputDir, file), path.join(distDir, file));
				if (!islandManifest.selfCheckDocument || !islandManifest.selfCheckLifetime)
					throw new Error("ESELFCHECKLOAD");
				await fs.copy(
					path.join(islandOutputDir, islandManifest.selfCheckDocument),
					path.join(distDir, islandManifest.selfCheckDocument),
				);
			}
		}
		reportProgress("Generating HTML pages", 55);
		reportProgress("Preparing runtime", 65);

		assertRuntimeLegalInputs(islandManifest, viewerManifestAssetPaths(islandManifest));
		await fs.writeFile(
			path.join(distDir, "PRAXITY-COURSE-RUNTIME-LICENSE.txt"),
			islandManifest.courseRuntimeLicense,
		);
		const notices = islandManifest.thirdPartyNotices;
		// CSS is shared by every course. Island files retain their own dependency selection.
		const noticeKeys = new Set([
			"@mantine/core",
			...(notices.outputs[islandManifest.css] ?? []),
			...(runtimeAssets.islands.includes("highlight")
				? (notices.outputs[islandManifest.highlightCss] ?? [])
				: []),
			...(normalizedCourse.moduleDeck ? (notices.outputs[islandManifest.deckCss] ?? []) : []),
		]);
		for (const [file, names] of Object.entries(notices.outputs)) {
			const emittedFile = file.startsWith("islands/") ? file.slice("islands/".length) : file;
			if (await fs.pathExists(path.join(distDir, emittedFile))) {
				for (const name of names) noticeKeys.add(name);
			}
		}
		for (const file of await enumerateFiles(distDir)) {
			if (!file.endsWith(".html")) continue;
			const html = await fs.readFile(path.join(distDir, file), "utf8");
			if (/praxity-note-icon|icon-tabler|data-praxity-inline-icon=/.test(html))
				noticeKeys.add("@tabler/icons");
			if (html.includes("praxity-code-token")) noticeKeys.add("prism-react-renderer");
			if (html.includes('class="katex')) noticeKeys.add("katex");
		}
		for (const filename of [
			...Object.values(islandManifest.hosts),
			...Object.values(islandManifest.hostDependencies ?? {}).flat(),
		]) {
			for (const name of notices.outputs[filename] ?? []) noticeKeys.add(name);
		}
		for (const name of noticeKeys) await writePackageNotice(distDir, notices.packages[name]);

		// 6. Copy CSS, fonts, and assets from temp public/ to dist/.
		await fs.copy(publicDir, distDir, { overwrite: false });
		reportProgress("Copying bundle assets", 75);
		const pageCount = resolvedContent.length;

		return {
			tempDir,
			distDir,
			course: {
				courseHomeUrl: normalizedCourse.courseHomeUrl,
				moduleDeck: normalizedCourse.moduleDeck,
				id: normalizedCourse.id,
				title: normalizedCourse.title,
				description: normalizedCourse.description,
				sourceLocale: normalizedCourse.sourceLocale,
				passingScore: normalizedCourse.passingScore,
			},
			pageCount,
			options: { ...options },
			manifest: await createCourseArtifactManifest(
				distDir,
				normalizedCourse.id,
				pageCount,
				runtimeAssets.pages,
				selfCheckAssetFiles,
				writeDistractorsAssetFiles,
			),
			hostRuntimePaths: capturedHostRuntimePaths,
			hostRuntimeDependencies: capturedHostRuntimeDependencies,
			reviewAssets,
			activeDeployments: 0,
		};
	} catch (error) {
		await removeTempDir(tempDir);
		throw error;
	}
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// null restores the default destination for LMS formats and previews.
function withDeploymentHead(
	filePath: string,
	html: string,
	head: string | ((filePath: string) => string),
	courseHomeUrl?: string | null,
): string | null {
	const slot = html.indexOf(DEPLOYMENT_HEAD_MARKER);
	if (slot === -1) return null;
	if (html.indexOf(DEPLOYMENT_HEAD_MARKER, slot + DEPLOYMENT_HEAD_MARKER.length) !== -1) {
		throw new Error(`Course page has more than one deployment head slot: ${filePath}`);
	}
	const deployed = html.replace(
		DEPLOYMENT_HEAD_MARKER,
		typeof head === "string" ? head : head(filePath),
	);
	if (courseHomeUrl === undefined) return deployed;
	const escaped = escapeHtmlAttribute(courseHomeUrl ?? DEFAULT_COURSE_HOME_URL);
	return deployed
		.replaceAll(COURSE_HOME_LINK_SLOT, () => `href="${escaped}"`)
		.replaceAll(COURSE_HOME_DECK_SLOT, () =>
			courseHomeUrl === null ? "" : ` data-praxity-course-home="${escaped}"`,
		);
}

async function fillDeploymentHead(
	distDir: string,
	head: string | ((filePath: string) => string),
	minimumPages: number,
	courseHomeUrl?: string | null,
): Promise<void> {
	let filled = 0;
	for (const filePath of await enumerateFiles(distDir)) {
		if (!filePath.endsWith(".html")) continue;
		const absolutePath = path.join(distDir, filePath);
		const html = await fs.readFile(absolutePath, "utf-8");
		const deployed = withDeploymentHead(filePath, html, head, courseHomeUrl);
		if (deployed === null) continue;
		await fs.writeFile(absolutePath, deployed);
		filled += 1;
	}
	if (filled < minimumPages) {
		throw new Error(
			`Course artifact has ${filled} deployment head slots for ${minimumPages} pages.`,
		);
	}
}

async function applyDeploymentTarget(
	artifact: CompiledCourseArtifact,
	distDir: string,
	target: CoursePackageDeploymentTarget,
): Promise<void> {
	if (target.reviewMode && target.format !== "html") {
		throw new Error("Review mode is available only for standalone HTML deployments.");
	}

	let reviewHead: ((filePath: string) => string) | null = null;
	if (target.reviewMode) {
		if (!artifact.reviewAssets) {
			throw new Error("Missing review assets for course deployment.");
		}
		await Promise.all([
			fs.copy(artifact.reviewAssets.js, path.join(distDir, "review-comments.js")),
			fs.copy(artifact.reviewAssets.css, path.join(distDir, "review-comments.css")),
		]);
		const [jsVersion, cssVersion] = await Promise.all(
			[artifact.reviewAssets.js, artifact.reviewAssets.css].map(async (file) =>
				crypto
					.createHash("sha256")
					.update(await fs.readFile(file))
					.digest("hex")
					.slice(0, 12),
			),
		);
		const locale = artifact.course.sourceLocale === "fr" ? "fr" : "en";
		const expiresAt = target.reviewExpiresAt ?? "";
		const pageIds = new Map<string, string>(
			artifact.manifest.pages.map((page) => [`${page.slug}.html`, page.id] as const),
		);
		reviewHead = (filePath) => {
			const pageId = pageIds.get(filePath) ?? path.basename(filePath, ".html");
			return `<link rel="stylesheet" href="review-comments.css?v=${cssVersion}" />\n<script defer src="review-comments.js?v=${jsVersion}" data-praxity-review-comments="true" data-review-page-id="${escapeHtmlAttribute(pageId)}" data-review-locale="${locale}" data-review-expires-at="${escapeHtmlAttribute(expiresAt)}"></script>`;
		};
	}
	const hostName = target.format === "html" ? "standalone" : target.format;
	const hostRuntimePath = artifact.hostRuntimePaths[hostName];
	if (!hostRuntimePath) {
		throw new Error(`Missing ${target.format} host runtime for course deployment.`);
	}
	const hostRuntimeFilename = path.basename(hostRuntimePath);
	const dependencies = artifact.hostRuntimeDependencies[hostName] ?? [];
	for (const dependency of dependencies) {
		if (!dependency.path)
			throw new Error(`Missing ${hostName} host dependency: ${dependency.filename}`);
		await fs.copy(dependency.path, path.join(distDir, dependency.filename));
	}
	await fs.copy(hostRuntimePath, path.join(distDir, hostRuntimeFilename));
	const deploymentConfig = {
		format: target.format === "html" ? "standalone" : target.format,
		...(target.format === "xapi"
			? {
					courseActivityId: declaredCourseActivityId(
						artifact.course.id,
						target.xapiConfig?.activityBase,
					),
				}
			: {}),
		...(target.format === "xapi" && target.xapiConfig
			? { xapiConfig: structuredClone(target.xapiConfig) }
			: {}),
	};
	const hostHead = [
		`<script id="praxity-deployment-config" type="application/json">${escapeJsonForScript(JSON.stringify(deploymentConfig))}</script>`,
		...dependencies.map(
			({ filename }) => `<script defer src="${escapeHtmlAttribute(filename)}"></script>`,
		),
		`<script defer src="${hostRuntimeFilename}"></script>`,
	].join("\n");
	await fillDeploymentHead(
		distDir,
		reviewHead ? (filePath) => `${hostHead}\n${reviewHead(filePath)}` : hostHead,
		contentDocumentCount(artifact),
		artifact.course.courseHomeUrl === undefined
			? undefined
			: target.format === "html"
				? artifact.course.courseHomeUrl
				: null,
	);
}

async function deployCourseArtifact(
	artifact: CompiledCourseArtifact,
	target: CoursePackageDeploymentTarget,
): Promise<ExportResult> {
	const { course, options, pageCount } = artifact;
	const reportProgress = (step: string, percent: number) => {
		options.onProgress?.(step, percent);
	};
	const deploymentTempDir = String(
		await realpath(
			await fs.mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), "praxity-deployment-")),
		),
	);
	const distDir = path.join(deploymentTempDir, "dist");
	let succeeded = false;

	try {
		await fs.copy(artifact.distDir, distDir);
		await applyDeploymentTarget(artifact, distDir, target);
		let manifestXml: string | null = null;
		if (target.format !== "html") {
			manifestXml = generateManifest(
				target.format,
				course.id,
				course.title,
				await enumerateFiles(distDir),
				{
					title: course.title,
					lang: course.sourceLocale,
					description: course.description,
				},
				target.scorm2004Edition,
				course.passingScore,
			);
		}
		reportProgress("Generating manifest", 90);

		const schemaFiles = await loadSchemaFiles(target.format, options);
		if (target.format === "xapi") {
			const tincanXml = generateTincanXml(
				course.id,
				course.title,
				course.sourceLocale,
				target.xapiConfig?.activityBase,
			);
			schemaFiles.push({ name: "tincan.xml", content: Buffer.from(tincanXml, "utf-8") });
		}
		const zip = await createZip(distDir, manifestXml, schemaFiles);
		reportProgress("Packaging ZIP", 98);
		succeeded = true;

		return { zip, pageCount, format: target.format };
	} finally {
		await removeTempDir(deploymentTempDir);
		if (succeeded) reportProgress("Export ready", 100);
	}
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
	const relativePath = path.relative(rootPath, targetPath);
	return (
		relativePath !== ".." &&
		!relativePath.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relativePath)
	);
}

async function createCoursePreviewDeployment(
	artifact: CompiledCourseArtifact,
	format: CoursePreviewDeploymentTarget["format"],
): Promise<CoursePreviewDeployment> {
	const hostRuntimePath =
		artifact.hostRuntimePaths[format === "standalone" ? "standalone" : "electronPreview"];
	if (!hostRuntimePath) throw new Error(`Missing ${format} host runtime.`);
	const rootPath = await fs.realpath(artifact.distDir);
	const hostRuntimeFilename = path.basename(hostRuntimePath);
	if (artifact.manifest.files.some((file) => file.path === hostRuntimeFilename)) {
		throw new Error("Preview host runtime conflicts with a course artifact file.");
	}
	const deploymentHead = `<script id="praxity-deployment-config" type="application/json">${escapeJsonForScript(
		JSON.stringify({
			format,
			...(format === "electron-preview" ? { revision: artifact.manifest.revision } : {}),
		}),
	)}</script>\n<script defer src="${hostRuntimeFilename}"></script>`;
	const overlayFiles = new Map<string, Buffer>();
	const manifestFiles: CourseArtifactFile[] = [];
	let filled = 0;
	for (const file of artifact.manifest.files) {
		if (file.path.endsWith(".html")) {
			const content = await readFile(path.join(rootPath, file.path));
			const deployed = withDeploymentHead(
				file.path,
				content.toString("utf8"),
				deploymentHead,
				artifact.course.courseHomeUrl === undefined ? undefined : null,
			);
			if (deployed !== null) {
				const bytes = Buffer.from(deployed, "utf8");
				overlayFiles.set(file.path, bytes);
				manifestFiles.push(createCourseArtifactFile(file.path, bytes));
				filled += 1;
				continue;
			}
		}
		manifestFiles.push(file);
	}
	if (filled < contentDocumentCount(artifact)) {
		throw new Error(
			`Course artifact has ${filled} deployment head slots for ${artifact.pageCount} pages.`,
		);
	}
	const hostRuntime = await readFile(hostRuntimePath);
	overlayFiles.set(hostRuntimeFilename, hostRuntime);
	manifestFiles.push(createCourseArtifactFile(hostRuntimeFilename, hostRuntime));
	const manifest = createCourseArtifactManifestFromFiles(
		artifact.manifest.courseId,
		artifact.pageCount,
		artifact.manifest.pages,
		manifestFiles,
	);

	const files = new Map(manifest.files.map((file) => [file.path, file] as const));
	const openStreams = new Set<Readable>();
	let inFlightOpens = 0;
	let resolveOpenIdle: (() => void) | undefined;
	let disposed = false;
	let disposePromise: Promise<void> | undefined;

	return Object.freeze({
		format,
		courseToken: crypto
			.createHash("sha256")
			.update(`praxity-${format}\0`)
			.update(artifact.manifest.courseId)
			.digest("hex")
			.slice(0, 32),
		manifest,
		openFile: async (relativePath: string, range?: CourseArtifactByteRange): Promise<Readable> => {
			if (disposed) throw new Error("Course preview deployment has been disposed.");
			inFlightOpens += 1;
			try {
				const file = files.get(relativePath);
				if (!file) throw new Error("Course artifact file is not listed in the manifest.");
				if (
					range &&
					(!Number.isSafeInteger(range.start) ||
						!Number.isSafeInteger(range.end) ||
						range.start < 0 ||
						range.end < range.start ||
						range.end >= file.byteLength)
				) {
					throw new Error("Course artifact byte range is invalid.");
				}

				const overlay = overlayFiles.get(relativePath);
				if (overlay) {
					await Promise.resolve();
					if (disposed) throw new Error("Course preview deployment has been disposed.");
					const bytes = range ? overlay.subarray(range.start, range.end + 1) : overlay;
					const stream = Readable.from([bytes]);
					openStreams.add(stream);
					stream.once("close", () => openStreams.delete(stream));
					return stream;
				}

				const filePath = await fs.realpath(path.resolve(rootPath, relativePath));
				if (!isPathWithin(rootPath, filePath)) {
					throw new Error("Course artifact path escapes its retained revision.");
				}
				const stats = await fs.stat(filePath);
				if (disposed) throw new Error("Course preview deployment has been disposed.");
				if (!stats.isFile() || stats.size !== file.byteLength) {
					throw new Error("Course artifact file no longer matches its manifest.");
				}

				const stream = fs.createReadStream(filePath, range);
				openStreams.add(stream);
				stream.once("close", () => openStreams.delete(stream));
				return stream;
			} finally {
				inFlightOpens -= 1;
				if (inFlightOpens === 0) {
					resolveOpenIdle?.();
					resolveOpenIdle = undefined;
				}
			}
		},
		dispose: () => {
			if (disposePromise) return disposePromise;
			disposed = true;
			disposePromise = (async () => {
				if (inFlightOpens > 0) {
					await new Promise<void>((resolveIdle) => {
						resolveOpenIdle = resolveIdle;
					});
				}
				const closing = [...openStreams].map(
					(stream) =>
						new Promise<void>((resolveClose) => {
							if (stream.closed) {
								resolveClose();
								return;
							}
							stream.once("close", resolveClose);
							stream.destroy();
						}),
				);
				await Promise.all(closing);
				artifact.activeDeployments -= 1;
			})();
			return disposePromise;
		},
	});
}

export async function compileCourse(
	course: CourseExportInput | DesktopExportInput,
	options: CompileCourseOptions = {},
): Promise<CourseArtifact> {
	const compiled = await compileCourseArtifact(course, options);
	let artifact: CourseArtifact;
	artifact = Object.freeze({
		manifest: compiled.manifest,
		dispose: async () => {
			const retained = compiledArtifacts.get(artifact);
			if (!retained) return;
			if (retained.activeDeployments > 0) {
				throw new Error("Course artifact cannot be disposed while a deployment is active.");
			}
			compiledArtifacts.delete(artifact);
			await removeTempDir(retained.tempDir);
		},
	});
	compiledArtifacts.set(artifact, compiled);
	return artifact;
}

export function deployCourse(
	artifact: CourseArtifact,
	target: CoursePreviewDeploymentTarget,
): Promise<CoursePreviewDeployment>;
export function deployCourse(
	artifact: CourseArtifact,
	target: CoursePackageDeploymentTarget,
): Promise<ExportResult>;
export async function deployCourse(
	artifact: CourseArtifact,
	target: CourseDeploymentTarget,
): Promise<ExportResult | CoursePreviewDeployment> {
	const compiled = compiledArtifacts.get(artifact);
	if (!compiled) throw new Error("Course artifact is unknown or has been disposed.");
	compiled.activeDeployments += 1;
	if (target.format === "electron-preview" || target.format === "standalone") {
		try {
			return await createCoursePreviewDeployment(compiled, target.format);
		} catch (error) {
			compiled.activeDeployments -= 1;
			throw error;
		}
	}
	try {
		return await deployCourseArtifact(compiled, target);
	} finally {
		compiled.activeDeployments -= 1;
	}
}

/** Build and package a SCORM/xAPI/HTML course. */
export async function buildScormPackage(
	course: CourseExportInput | DesktopExportInput,
	options: BuildOptions,
): Promise<ExportResult> {
	const { format, scorm2004Edition, ...compileOptions } = options;
	const target: CoursePackageDeploymentTarget = {
		format,
		...(scorm2004Edition ? { scorm2004Edition } : {}),
		reviewMode: format === "html" && course.reviewMode,
		reviewExpiresAt: course.reviewExpiresAt,
		xapiConfig:
			!isDesktopExportInput(course) && course.xapiConfig
				? structuredClone(course.xapiConfig)
				: undefined,
	};
	const artifact = await compileCourse(course, compileOptions);
	try {
		return await deployCourse(artifact, target);
	} finally {
		await artifact.dispose();
	}
}

function inferBrandLogoExtension(url: string, contentType: string | null): string {
	const normalizedType = contentType?.split(";")[0].trim().toLowerCase();
	switch (normalizedType) {
		case "image/jpeg":
			return ".jpg";
		case "image/png":
			return ".png";
		case "image/webp":
			return ".webp";
		case "image/gif":
			return ".gif";
		case "image/svg+xml":
			return ".svg";
		case "image/avif":
			return ".avif";
		default:
			break;
	}

	try {
		const parsed = new URL(url);
		const ext = path.extname(parsed.pathname).toLowerCase();
		if (ext) return ext;
	} catch {
		// Ignore invalid URL and fall back to .png.
	}
	return ".png";
}

async function downloadBrandLogoAsset(
	url: string,
	assetsDir: string,
	fileStem: "brand-logo" | "brand-logo-dark",
): Promise<string> {
	if (!isSafeRemoteUrl(url)) {
		throw new Error(`Unsafe brand logo URL: ${url}`);
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download brand logo (${response.status}): ${url}`);
	}

	const ext = inferBrandLogoExtension(url, response.headers.get("content-type"));
	const filename = `${fileStem}${ext}`;
	const buffer = Buffer.from(await response.arrayBuffer());
	await fs.writeFile(path.join(assetsDir, filename), buffer);
	return `assets/${filename}`;
}

function contentDocumentCount(artifact: CompiledCourseArtifact): number {
	return artifact.course.moduleDeck
		? new Set(artifact.manifest.pages.map((page) => page.lessonId ?? page.id)).size
		: artifact.pageCount;
}

export type { CompiledPage, Fragment } from "./preview/compile-page.ts";
export {
	compileDocument,
	compileDocumentFrame,
	compilePage,
	renderNode,
} from "./preview/compile-page.ts";
export { type CompileJob, CompileQueue } from "./preview/compile-queue.ts";
export type {
	CourseContext,
	CourseContextChanges,
	CourseContextInput,
	SliceKey,
} from "./preview/course-context.ts";
export {
	createCourseContext,
	getPageDependencies,
	refreshCourseContext,
} from "./preview/course-context.ts";
