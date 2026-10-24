/**
 * Shared viewer bundle logic.
 *
 * Used by:
 *   - prebuild-client.ts (manual `pnpm prebuild:client`)
 *   - build.ts (auto-rebuild at publish time when source is stale)
 */

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, build, type Metafile, type Plugin } from "esbuild";

import {
	assertLearningPatternsBundleInputs,
	installedLearningPatternsDigest,
} from "../../../scripts/learning-patterns-admission.mjs";

import { classicIslandFilename } from "./classic-island-filename.ts";
import { WRITE_DISTRACTORS_STYLESHEET } from "./patterns/write-distractors/assets.ts";
import { collectRuntimeNotices, type RuntimeNotices } from "./third-party-notices.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHARED_BLOCKS_SRC = path.resolve(__dirname, "../../shared-blocks/src");
const GRAMMAR_SRC = path.resolve(__dirname, "../../grammar/src");
const CONTENT_MODEL_SRC = path.resolve(__dirname, "../../content-model/src");
const RETRIEVAL_SHEET_CSS_ENTRY = path.resolve(__dirname, "patterns/retrieval-sheet/style.css");
const DECK_CSS_ENTRY = path.join(SHARED_BLOCKS_SRC, "viewer/deck-shell.css");
const TEMPLATE_SRC = path.resolve(__dirname, "../template/src");
const VIEWER_CSS_ENTRY = path.resolve(__dirname, "../template/src/styles/viewer.css");
const BUNDLE_SOURCE = fileURLToPath(import.meta.url);
const EXPORT_CSS_SOURCE = path.resolve(__dirname, "export-css.ts");
const SHARED_BLOCKS_PACKAGE = path.resolve(__dirname, "../../shared-blocks/package.json");
const GRAMMAR_PACKAGE = path.resolve(__dirname, "../../grammar/package.json");
const CONTENT_MODEL_PACKAGE = path.resolve(__dirname, "../../content-model/package.json");
const EXPORT_PIPELINE_PACKAGE = path.resolve(__dirname, "../package.json");
const WORKSPACE_LOCKFILE = path.resolve(__dirname, "../../../pnpm-lock.yaml");
const ISLANDS_DIR = path.resolve(__dirname, "../template/src/islands");
const SELF_CHECK_SUPPORT_ENTRY = path.join(ISLANDS_DIR, "self-check-support.ts");
const ISLAND_LOADER_ENTRY = path.resolve(__dirname, "../template/src/island-bootstrap.ts");
const COURSE_RESUME_ENTRY = path.resolve(__dirname, "../template/src/course-resume.ts");
const COURSE_SHELL_ENTRY = path.resolve(__dirname, "../template/src/course-shell.ts");
const SCORM_SUPPORT_ENTRY = path.resolve(__dirname, "../template/src/scorm-support.ts");
const HOSTS_DIR = path.resolve(__dirname, "../template/src/hosts");
const PRIVACY_BOOTSTRAP_ENTRY = path.join(HOSTS_DIR, "privacy-bootstrap.ts");
const PRIVATE_CHOICE_ENTRY = path.join(HOSTS_DIR, "private-choice-bootstrap.ts");
const PRIVACY_SUPPORT_ENTRY = path.join(HOSTS_DIR, "privacy-support.ts");
const SCORM_SRC = path.resolve(__dirname, "scorm");
export const PATTERNS_SRC = path.resolve(__dirname, "patterns");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
// Code, literal data and browser assets. Machine/editor debris is never an input.
const PATTERN_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".css",
	".txt",
	".prax",
	".svg",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".avif",
	".ico",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".mp3",
	".mp4",
	".wav",
	".ogg",
	".webm",
]);

const ISLAND_ENTRY_POINTS = {
	"island-nav": path.resolve(ISLANDS_DIR, "island-nav.tsx"),
	"island-accordion": path.resolve(ISLANDS_DIR, "island-accordion.tsx"),
	"island-tabs": path.resolve(ISLANDS_DIR, "island-tabs.tsx"),
	"island-assessment": path.resolve(ISLANDS_DIR, "island-assessment.tsx"),
	"island-assessment-group": path.resolve(ISLANDS_DIR, "island-assessment-group.ts"),
	"island-logic": path.resolve(ISLANDS_DIR, "island-logic.ts"),
	"island-self-check": path.resolve(ISLANDS_DIR, "island-self-check.ts"),
	"island-write-distractors": path.resolve(ISLANDS_DIR, "island-write-distractors.ts"),
	"island-retrieval-sheet": path.resolve(ISLANDS_DIR, "island-retrieval-sheet.ts"),
	"island-highlight": path.resolve(ISLANDS_DIR, "island-highlight.ts"),
	"island-checklist": path.resolve(ISLANDS_DIR, "island-checklist.tsx"),
	"island-rating": path.resolve(ISLANDS_DIR, "island-rating.ts"),
	"island-signature": path.resolve(ISLANDS_DIR, "island-signature.ts"),
	"island-image-comparison": path.resolve(ISLANDS_DIR, "island-image-comparison.ts"),
	"island-labeled-graphic": path.resolve(ISLANDS_DIR, "island-labeled-graphic.ts"),
	"island-narration": path.resolve(ISLANDS_DIR, "island-narration.tsx"),
	"island-deck": path.resolve(ISLANDS_DIR, "island-deck.ts"),
	"island-card": path.resolve(ISLANDS_DIR, "island-card.ts"),
	"island-table": path.resolve(ISLANDS_DIR, "island-table.ts"),
	"island-code": path.resolve(ISLANDS_DIR, "island-code.ts"),
	"island-tooltip": path.resolve(ISLANDS_DIR, "island-tooltip.ts"),
	"island-media": path.resolve(ISLANDS_DIR, "island-media.ts"),
	"island-sequence": path.resolve(ISLANDS_DIR, "island-sequence.ts"),
} as const;

const HOST_ENTRY_POINTS = {
	standalone: {
		entryPoint: path.resolve(HOSTS_DIR, "standalone.ts"),
		outputName: "host-standalone",
	},
	electronPreview: {
		entryPoint: path.resolve(HOSTS_DIR, "electron-preview.ts"),
		outputName: "host-electron-preview",
	},
	scorm12: {
		entryPoint: path.resolve(HOSTS_DIR, "scorm12.ts"),
		outputName: "host-scorm12",
	},
	scorm2004: {
		entryPoint: path.resolve(HOSTS_DIR, "scorm2004.ts"),
		outputName: "host-scorm2004",
	},
	xapi: {
		entryPoint: path.resolve(HOSTS_DIR, "xapi.ts"),
		outputName: "host-xapi",
	},
} as const;

type IslandEntryName = keyof typeof ISLAND_ENTRY_POINTS;
export type IslandManifestEntryName = IslandEntryName | "island-loader";
export type ViewerHostName = keyof typeof HOST_ENTRY_POINTS;

export const ISLAND_MANIFEST_ENTRY_NAMES = [
	...Object.keys(ISLAND_ENTRY_POINTS),
	"island-loader",
] as readonly IslandManifestEntryName[];

const GENERATED_ISLAND_ENTRY = new RegExp(
	`^(?:${[...Object.keys(ISLAND_ENTRY_POINTS), "island-loader", "self-check-lifetime"].join("|")})-[A-Z0-9]{8}(?:\\.classic)?\\.(?:js|css|map)$`,
);
const GENERATED_HOST_ENTRY =
	/^(?:course-(?:bootstrap|shell|resume)|scorm-support|host-(?:standalone|electron-preview|scorm12|scorm2004|xapi)(?:-private)?|privacy-(?:bootstrap|support)|private-choice-bootstrap)-[A-Z0-9]{8}(?:\.classic)?\.(?:js|map)$/;

// Owner 2026-10-11: 58 KiB while S9b gets working; the startup split will tighten it.
// owner 2026-10-11: raised for S9b; size optimisation at the end
export const SELF_CHECK_INITIAL_RAW_CEILING = 59_392;

export interface ViewerBundleManifest {
	/** Packaged separately; loaded only after Check or when saved state exists. */
	selfCheckSupport?: string[];
	writeDistractorsSupport?: string[];
	selfCheckDocument?: string;
	selfCheckLifetime?: string;
	privacy?: { bootstrap: string; support: string; files: string[] };
	privateChoice?: string;
	privateHosts?: Record<ViewerHostName, string>;
	thirdPartyNotices?: RuntimeNotices;
	courseRuntimeLicense?: string;
	css: string;
	deckCss: string;
	retrievalSheetCss: string;
	highlightCss: string;
	writeDistractorsCss?: string;
	shell: string;
	resume: string;
	hosts: Record<ViewerHostName, string>;
	hostDependencies?: Partial<Record<ViewerHostName, string[]>>;
	islands: Record<IslandManifestEntryName, string>;
	islandFiles: string[];
	islandDependencies: Record<IslandManifestEntryName, string[]>;
}

/**
 * Every file a viewer manifest references, relative to the assets directory with
 * forward slashes. Copy and verify through this list so a new asset field
 * (as `resume` was) cannot be missed by one consumer.
 */
export function viewerManifestAssetPaths(manifest: ViewerBundleManifest): string[] {
	return [
		...new Set([
			manifest.css,
			manifest.deckCss,
			manifest.retrievalSheetCss,
			manifest.highlightCss,
			...(manifest.writeDistractorsCss ? [manifest.writeDistractorsCss] : []),
			manifest.shell,
			manifest.resume,
			...(manifest.privacy?.files ?? []),
			...(manifest.privateChoice ? [manifest.privateChoice] : []),
			...Object.values(manifest.hosts),
			...Object.values(manifest.privateHosts ?? {}),
			...Object.values(manifest.hostDependencies ?? {}).flat(),
			...manifest.islandFiles.map((file) => `islands/${file}`),
		]),
	];
}

export interface ViewerBundleResult {
	cssPath: string;
	deckCssPath: string;
	shellPath: string;
	resumePath: string;
	hostPaths: Record<ViewerHostName, string>;
	islandOutDir: string;
	manifestPath: string;
	manifest: ViewerBundleManifest;
}

export type ViewerAssetFormat = "electron-preview" | "html" | "scorm-1.2" | "scorm-2004" | "xapi";

const COMMON_VIEWER_ASSETS = [
	"viewer.css",
	"deck-shell.css",
	"retrieval-sheet.css",
	"highlight.css",
	"styles.css",
	"styles-lite.css",
	"viewer.version.json",
	"viewer-manifest.json",
	"islands",
] as const;

export class ViewerAssetsError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ViewerAssetsError";
	}
}

export function requiredViewerAssetPaths(format: ViewerAssetFormat, reviewMode = false): string[] {
	const paths: string[] = [...COMMON_VIEWER_ASSETS];
	if (reviewMode) paths.push("review-comments.js", "review-comments.css");
	if (format !== "html" && format !== "electron-preview") {
		paths.push(path.join("schemas", format === "scorm-1.2" ? "scorm12" : "scorm2004"));
	}
	return paths;
}

async function assertViewerAssetPaths(
	outDir: string,
	relativePaths: Iterable<string>,
): Promise<void> {
	for (const relativePath of relativePaths) {
		try {
			await access(path.join(outDir, relativePath));
		} catch (error) {
			throw new ViewerAssetsError(`Missing export asset: ${relativePath}`, { cause: error });
		}
	}
}

async function readViewerVersion(outDir: string): Promise<Record<string, unknown>> {
	const versionPath = path.join(outDir, "viewer.version.json");
	try {
		return JSON.parse(await readFile(versionPath, "utf-8")) as Record<string, unknown>;
	} catch (error) {
		throw new ViewerAssetsError(`Invalid viewer version metadata at ${versionPath}`, {
			cause: error,
		});
	}
}

export async function assertViewerAssetsReady(
	outDir: string,
	format: ViewerAssetFormat,
	options: {
		reviewMode?: boolean;
		expectedAppVersion?: string;
		expectedViewerSourceHash?: string;
	} = {},
): Promise<void> {
	await assertViewerAssetPaths(
		outDir,
		requiredViewerAssetPaths(format, options.reviewMode ?? false),
	);
	const hostName = hostForFormat(format);
	const manifest = await readViewerManifest(outDir);
	assertCompleteViewerManifest(manifest, outDir);
	await assertViewerAssetPaths(outDir, [
		manifest.css,
		manifest.deckCss,
		manifest.highlightCss,
		manifest.shell,
		manifest.resume,
		...(manifest.privacy?.files ?? []),
		...(manifest.privateChoice ? [manifest.privateChoice] : []),
		...manifest.islandFiles.map((file) => path.join("islands", file)),
	]);
	if (hostName) {
		await assertViewerAssetPaths(outDir, [
			...(manifest.hostDependencies?.[hostName] ?? []),
			manifest.hosts[hostName],
		]);
	}
	if (!options.expectedAppVersion && !options.expectedViewerSourceHash) return;

	const version = await readViewerVersion(outDir);
	if (options.expectedAppVersion && version.appVersion !== options.expectedAppVersion) {
		throw new ViewerAssetsError(
			`Export assets target app ${String(version.appVersion)}, expected ${options.expectedAppVersion}.`,
		);
	}
	if (
		options.expectedViewerSourceHash &&
		version.viewerSourceHash !== options.expectedViewerSourceHash
	) {
		throw new ViewerAssetsError(
			`Export assets target viewer ${String(version.viewerSourceHash)}, expected ${options.expectedViewerSourceHash}.`,
		);
	}
}

function isSafeRelativeAssetPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		!path.posix.isAbsolute(value) &&
		!path.win32.isAbsolute(value) &&
		!value.includes("\\") &&
		!value.includes(":") &&
		path.posix.normalize(value) === value &&
		value !== ".." &&
		!value.startsWith("../")
	);
}

function assertCompleteIslandManifest(manifest: ViewerBundleManifest): void {
	if (
		manifest.selfCheckDocument !== undefined &&
		(!isSafeRelativeAssetPath(manifest.selfCheckDocument) ||
			!manifest.islandFiles.includes(manifest.selfCheckDocument))
	)
		throw new Error("Invalid self-check document asset");
	if (
		manifest.selfCheckSupport !== undefined &&
		(!Array.isArray(manifest.selfCheckSupport) ||
			manifest.selfCheckSupport.length !== 2 ||
			manifest.selfCheckSupport.some(
				(file) => !isSafeRelativeAssetPath(file) || !manifest.islandFiles.includes(file),
			) ||
			manifest.selfCheckSupport[1] !== classicIslandFilename(manifest.selfCheckSupport[0]))
	)
		throw new Error("Invalid self-check support assets");
	for (const entryName of ISLAND_MANIFEST_ENTRY_NAMES) {
		if (!isSafeRelativeAssetPath(manifest.islands[entryName])) {
			throw new Error(`missing island entry ${entryName}`);
		}
		const dependencies = manifest.islandDependencies[entryName];
		if (
			!Array.isArray(dependencies) ||
			!dependencies.includes(manifest.islands[entryName]) ||
			dependencies.some((file) => !manifest.islandFiles.includes(file))
		) {
			throw new Error(`invalid island dependency closure ${entryName}`);
		}
	}
}

function assertCompleteViewerManifest(manifest: ViewerBundleManifest, outDir: string): void {
	try {
		assertCompleteIslandManifest(manifest);
	} catch (error) {
		throw new ViewerAssetsError(
			`Invalid viewer manifest at ${path.join(outDir, "viewer-manifest.json")}`,
			{ cause: error },
		);
	}
}

export async function readViewerManifest(outDir: string): Promise<ViewerBundleManifest> {
	const manifestPath = path.join(outDir, "viewer-manifest.json");
	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as ViewerBundleManifest;
		if (
			Object.hasOwn(manifest, "legacy") ||
			!isSafeRelativeAssetPath(manifest.css) ||
			!isSafeRelativeAssetPath(manifest.deckCss) ||
			!isSafeRelativeAssetPath(manifest.retrievalSheetCss) ||
			!isSafeRelativeAssetPath(manifest.highlightCss) ||
			(manifest.writeDistractorsCss !== undefined &&
				!isSafeRelativeAssetPath(manifest.writeDistractorsCss)) ||
			!isSafeRelativeAssetPath(manifest.shell) ||
			!isSafeRelativeAssetPath(manifest.resume) ||
			(manifest.privateChoice !== undefined && !isSafeRelativeAssetPath(manifest.privateChoice)) ||
			(manifest.writeDistractorsSupport !== undefined &&
				(!Array.isArray(manifest.writeDistractorsSupport) ||
					manifest.writeDistractorsSupport.length !== 4 ||
					manifest.writeDistractorsSupport.some(
						(file) => !isSafeRelativeAssetPath(file) || !manifest.islandFiles.includes(file),
					))) ||
			(manifest.privacy !== undefined &&
				(!isSafeRelativeAssetPath(manifest.privacy.bootstrap) ||
					!isSafeRelativeAssetPath(manifest.privacy.support) ||
					!Array.isArray(manifest.privacy.files) ||
					!manifest.privacy.files.includes(manifest.privacy.bootstrap) ||
					!manifest.privacy.files.includes(manifest.privacy.support) ||
					!manifest.privacy.files.includes(classicIslandFilename(manifest.privacy.support)) ||
					manifest.privacy.files.some((file) => !isSafeRelativeAssetPath(file)))) ||
			!manifest.hosts ||
			(manifest.privateHosts !== undefined &&
				(Object.keys(manifest.privateHosts).length !== Object.keys(HOST_ENTRY_POINTS).length ||
					Object.keys(HOST_ENTRY_POINTS).some(
						(name) => !isSafeRelativeAssetPath(manifest.privateHosts?.[name as ViewerHostName]),
					))) ||
			Object.keys(manifest.hosts).length !== Object.keys(HOST_ENTRY_POINTS).length ||
			(Object.keys(HOST_ENTRY_POINTS) as ViewerHostName[]).some(
				(hostName) => !isSafeRelativeAssetPath(manifest.hosts[hostName]),
			) ||
			!manifest.islands ||
			!Array.isArray(manifest.islandFiles) ||
			manifest.islandFiles.some((file) => !isSafeRelativeAssetPath(file)) ||
			!manifest.islandDependencies
		) {
			throw new Error("invalid manifest shape");
		}
		if (manifest.hostDependencies !== undefined) {
			if (
				!manifest.hostDependencies ||
				typeof manifest.hostDependencies !== "object" ||
				Array.isArray(manifest.hostDependencies)
			) {
				throw new Error("invalid host dependencies");
			}
			for (const [hostName, dependencies] of Object.entries(manifest.hostDependencies)) {
				if (
					!Object.hasOwn(HOST_ENTRY_POINTS, hostName) ||
					!Array.isArray(dependencies) ||
					dependencies.some((file) => !isSafeRelativeAssetPath(file))
				) {
					throw new Error(`invalid host dependencies ${hostName}`);
				}
			}
		}
		for (const [entryName, filename] of Object.entries(manifest.islands)) {
			if (
				!ISLAND_MANIFEST_ENTRY_NAMES.includes(entryName as IslandManifestEntryName) ||
				!isSafeRelativeAssetPath(filename) ||
				!manifest.islandFiles.includes(filename)
			) {
				throw new Error(`invalid island entry ${entryName}`);
			}
		}
		for (const [entryName, dependencies] of Object.entries(manifest.islandDependencies)) {
			if (
				!ISLAND_MANIFEST_ENTRY_NAMES.includes(entryName as IslandManifestEntryName) ||
				!Array.isArray(dependencies) ||
				dependencies.some(
					(file) => !isSafeRelativeAssetPath(file) || !manifest.islandFiles.includes(file),
				)
			) {
				throw new Error(`invalid island dependencies ${entryName}`);
			}
		}
		return manifest;
	} catch (error) {
		throw new ViewerAssetsError(`Invalid viewer manifest at ${manifestPath}`, { cause: error });
	}
}

function hostForFormat(format: ViewerAssetFormat): ViewerHostName | null {
	switch (format) {
		case "html":
			return "standalone";
		case "electron-preview":
			return "electronPreview";
		case "scorm-1.2":
			return "scorm12";
		case "scorm-2004":
			return "scorm2004";
		case "xapi":
			return "xapi";
	}
}

function outputClosure(metafile: Metafile, entryPath: string, outDir: string): string[] {
	const outputs = new Map(
		Object.entries(metafile.outputs).map(([outputPath, meta]) => [path.resolve(outputPath), meta]),
	);
	const files = new Set<string>();
	const visit = (outputPath: string) => {
		const absolute = path.resolve(outputPath);
		if (files.has(absolute)) return;
		const meta = outputs.get(absolute);
		if (!meta || !absolute.endsWith(".js")) return;
		files.add(absolute);
		for (const imported of meta.imports) {
			if (!imported.external) visit(imported.path);
		}
	};
	visit(entryPath);
	return [...files].map((file) => path.relative(outDir, file).split(path.sep).join("/")).sort();
}

export function islandFilesForEntries(
	manifest: ViewerBundleManifest,
	entries: Iterable<IslandManifestEntryName>,
): string[] {
	const files = new Set<string>();
	for (const entry of entries) {
		const dependencies = manifest.islandDependencies?.[entry];
		for (const file of dependencies ?? manifest.islandFiles) {
			if (file) files.add(file);
		}
	}
	return [...files].sort();
}

async function collectSourceFiles(
	dir: string,
	extensions: ReadonlySet<string> = SOURCE_EXTENSIONS,
	patternTree = false,
): Promise<string[]> {
	const files: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (patternTree && entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (patternTree && entry.isSymbolicLink() && (await stat(full)).isDirectory()) {
			throw new Error(`Symlinked pattern directory is not supported: ${full}`);
		}
		if (entry.isDirectory()) {
			files.push(...(await collectSourceFiles(full, extensions, patternTree)));
		} else if (
			extensions.has(path.extname(entry.name)) ||
			// Copied legal text contributes to prepared runtime notices and their cache key.
			(patternTree && /^(?:LICENSE|NOTICE|COPYING)(?:[._-]|$)/i.test(entry.name))
		) {
			files.push(full);
		}
	}
	return files;
}

/** Conservative input inventory, never an entry registry. Include literal data and
 * test-named code too, so moving a bundled input cannot silently retain old assets. */
export async function patternSourceFiles(): Promise<string[]> {
	try {
		await access(PATTERNS_SRC);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	if ((await lstat(PATTERNS_SRC)).isSymbolicLink()) {
		throw new Error(`Symlinked pattern directory is not supported: ${PATTERNS_SRC}`);
	}
	return (await collectSourceFiles(PATTERNS_SRC, PATTERN_EXTENSIONS, true)).sort();
}

function getBundleResolutionPaths(): { entryPoint: string; extraNodePaths: string[] } {
	const isStandalone = __dirname.includes(".next/standalone");
	let entryPoint = VIEWER_CSS_ENTRY;
	const extraNodePaths: string[] = [];

	if (!isStandalone) return { entryPoint, extraNodePaths };

	let repoRoot = path.resolve(__dirname, "..");
	for (let i = 0; i < 10; i++) {
		if (existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) break;
		repoRoot = path.resolve(repoRoot, "..");
	}

	const repoViewerEntry = path.join(
		repoRoot,
		"packages/export-pipeline/template/src/styles/viewer.css",
	);
	if (existsSync(repoViewerEntry)) entryPoint = repoViewerEntry;

	extraNodePaths.push(path.join(repoRoot, "node_modules"));
	const rendererNm = path.join(repoRoot, "packages/export-pipeline/node_modules");
	if (existsSync(rendererNm)) extraNodePaths.push(rendererNm);

	return { entryPoint, extraNodePaths };
}

/** Exact hash inventory, exposed so bundle-input coverage can guard future imports. */
export async function viewerSourceFiles(): Promise<string[]> {
	const [sharedFiles, grammarFiles, contentModelFiles, templateFiles, scormFiles, patternFiles] =
		await Promise.all([
			collectSourceFiles(SHARED_BLOCKS_SRC),
			collectSourceFiles(GRAMMAR_SRC),
			collectSourceFiles(CONTENT_MODEL_SRC),
			collectSourceFiles(TEMPLATE_SRC),
			collectSourceFiles(SCORM_SRC),
			patternSourceFiles(),
		]);

	const supplementalNotices = await readdir(
		path.resolve(__dirname, "../../../apps/desktop/resources/third-party-notices"),
		{ recursive: true, withFileTypes: true },
	);
	const allFiles = [
		...supplementalNotices
			.filter((entry) => entry.isFile())
			.map((entry) => path.join(entry.parentPath, entry.name)),
		...sharedFiles,
		...grammarFiles,
		...contentModelFiles,
		...templateFiles,
		...scormFiles,
		...patternFiles,
		BUNDLE_SOURCE,
		EXPORT_CSS_SOURCE,
		path.resolve(__dirname, "course-home.ts"),
		path.resolve(__dirname, "course-session-time.ts"),
		path.resolve(__dirname, "classic-island-filename.ts"),
		path.resolve(__dirname, "third-party-notices.ts"),
		path.resolve(__dirname, "module-deck-strings.ts"),
		path.resolve(__dirname, "../template/COURSE-RUNTIME-LICENSE.txt"),
		SHARED_BLOCKS_PACKAGE,
		GRAMMAR_PACKAGE,
		CONTENT_MODEL_PACKAGE,
		EXPORT_PIPELINE_PACKAGE,
		WORKSPACE_LOCKFILE,
		path.resolve(__dirname, "../../../scripts/learning-patterns-admission.json"),
		path.resolve(__dirname, "../../../scripts/learning-patterns-admission.mjs"),
	].sort();
	return allFiles;
}

export async function computeViewerSourceHash(): Promise<string> {
	const hash = crypto.createHash("sha256");

	for (const filePath of await viewerSourceFiles()) {
		hash.update(path.relative(path.resolve(__dirname, "../.."), filePath));
		hash.update(await readFile(filePath));
	}

	hash.update(await installedLearningPatternsDigest(path.resolve(__dirname, "../../..")));
	return hash.digest("hex");
}

export async function assertViewerAssetsCurrent(
	outDir: string,
	expectedAppVersion?: string,
): Promise<void> {
	await assertViewerAssetPaths(
		outDir,
		new Set([
			...requiredViewerAssetPaths("scorm-1.2", true),
			...requiredViewerAssetPaths("scorm-2004"),
		]),
	);
	const manifest = await readViewerManifest(outDir);
	assertCompleteViewerManifest(manifest, outDir);
	await assertViewerAssetPaths(outDir, viewerManifestAssetPaths(manifest));
	const version = await readViewerVersion(outDir);
	const sourceHash = (await computeViewerSourceHash()).slice(0, 12);
	if (version.viewerSourceHash !== sourceHash) {
		throw new ViewerAssetsError(
			`Export assets are stale: viewer.version.json has ${String(version.viewerSourceHash)}, source is ${sourceHash}. Run pnpm prebuild.`,
		);
	}
	if (expectedAppVersion && version.appVersion !== expectedAppVersion) {
		throw new ViewerAssetsError(
			`Export assets target app ${String(version.appVersion)}, but this release is ${expectedAppVersion}. Run pnpm prebuild.`,
		);
	}
}

async function cleanGeneratedIslandFiles(islandOutDir: string): Promise<void> {
	const entries = await readdir(islandOutDir, { withFileTypes: true });
	await Promise.all(
		entries
			.filter(
				(entry) =>
					entry.name === "chunks" ||
					entry.name === "assets" ||
					(entry.isFile() && GENERATED_ISLAND_ENTRY.test(entry.name)),
			)
			.map((entry) => rm(path.join(islandOutDir, entry.name), { recursive: true, force: true })),
	);
}

/** CSS build entries used by publishing and source-level contract checks. */
export function viewerStylesheetBuilds(
	outDir: string,
): Record<string, BuildOptions & { metafile: true }> {
	const { entryPoint, extraNodePaths } = getBundleResolutionPaths();
	return {
		viewer: {
			entryPoints: [entryPoint],
			bundle: true,
			outfile: path.join(outDir, "viewer.css"),
			minify: true,
			target: "es2020",
			nodePaths: extraNodePaths,
			metafile: true,
			legalComments: "none",
		},
		deck: {
			entryPoints: [DECK_CSS_ENTRY],
			bundle: true,
			outfile: path.join(outDir, "deck-shell.css"),
			minify: true,
			target: "es2020",
			nodePaths: extraNodePaths,
			metafile: true,
			legalComments: "none",
		},

		retrievalSheet: {
			entryPoints: [RETRIEVAL_SHEET_CSS_ENTRY],
			bundle: true,
			outfile: path.join(outDir, "retrieval-sheet.css"),
			minify: true,
			target: "es2020",
			metafile: true,
			legalComments: "none",
		},
	};
}

export async function bundleViewer(
	outDir: string,
	onBuildInputs?: (inputs: string[]) => void,
): Promise<ViewerBundleResult> {
	const cssPath = path.join(outDir, "viewer.css");
	const deckCssPath = path.join(outDir, "deck-shell.css");
	const islandOutDir = path.join(outDir, "islands");
	const manifestPath = path.join(outDir, "viewer-manifest.json");

	await mkdir(outDir, { recursive: true });
	await mkdir(islandOutDir, { recursive: true });
	await cleanGeneratedIslandFiles(islandOutDir);
	for (const entry of await readdir(outDir, { withFileTypes: true })) {
		if (
			entry.isFile() &&
			(entry.name === "scorm-runtime.js" ||
				entry.name === "viewer.js" ||
				entry.name === "viewer-legacy.js" ||
				entry.name === "viewer-legacy.css" ||
				GENERATED_HOST_ENTRY.test(entry.name))
		) {
			await rm(path.join(outDir, entry.name), { force: true });
		}
	}

	const { extraNodePaths } = getBundleResolutionPaths();

	const stylesheets = viewerStylesheetBuilds(outDir);
	const cssResult = await build(stylesheets.viewer);
	const deckCssResult = await build(stylesheets.deck);
	const retrievalSheetCssResult = await build(stylesheets.retrievalSheet);

	const highlightCssResult = await build({
		entryPoints: [path.join(PATTERNS_SRC, "highlight/style.css")],
		bundle: true,
		outfile: path.join(outDir, "highlight.css"),
		minify: true,
		target: "es2020",
		metafile: true,
		legalComments: "none",
	});
	const distractorCssResult = await build({
		entryPoints: [path.join(PATTERNS_SRC, "write-distractors/style.css")],
		bundle: true,
		outfile: path.join(outDir, WRITE_DISTRACTORS_STYLESHEET),
		minify: true,
		target: "es2020",
		metafile: true,
		legalComments: "none",
	});
	const islandOptions = {
		entryPoints: ISLAND_ENTRY_POINTS,
		bundle: true,
		splitting: true,
		format: "esm",
		outdir: islandOutDir,
		entryNames: "[name]-[hash]",
		chunkNames: "chunks/[name]-[hash]",
		assetNames: "assets/[name]-[hash]",
		minify: true,
		treeShaking: true,
		target: "es2020",
		jsx: "automatic",
		// viewer.css is built explicitly and loaded by every page.
		// Treat component CSS imports as empty here so they do not keep unrelated
		// block modules alive in the island graph or emit duplicate CSS bundles.
		loader: { ".css": "empty" },
		define: {
			"process.env.NODE_ENV": '"production"',
		},
		external: [],
		nodePaths: extraNodePaths,
		metafile: true,
		drop: ["debugger"],
		legalComments: "none",
	} satisfies BuildOptions;
	const distractorSupportEntry = path.join(path.dirname(ISLANDS_DIR), "write-distractors-asset.ts");
	const distractorSupportResult = await build({
		...islandOptions,
		entryPoints: { "write-distractors-support": distractorSupportEntry },
		entryNames: "chunks/[name]-[hash]",
		splitting: false,
	});
	const distractorSupportFilename = path
		.relative(islandOutDir, Object.keys(distractorSupportResult.metafile.outputs)[0])
		.split(path.sep)
		.join("/");
	const distractorSupportClassicResult = await build({
		...islandOptions,
		entryPoints: [distractorSupportEntry],
		splitting: false,
		format: "iife",
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, classicIslandFilename(distractorSupportFilename)),
	});
	const distractorDraftEntry = path.join(path.dirname(ISLANDS_DIR), "write-distractors-draft.ts");
	const distractorDraftResult = await build({
		...islandOptions,
		entryPoints: { "write-distractors-draft": distractorDraftEntry },
		entryNames: "chunks/[name]-[hash]",
		splitting: false,
	});
	const distractorDraftFilename = path
		.relative(islandOutDir, Object.keys(distractorDraftResult.metafile.outputs)[0])
		.split(path.sep)
		.join("/");
	const distractorDraftClassicResult = await build({
		...islandOptions,
		entryPoints: [distractorDraftEntry],
		splitting: false,
		format: "iife",
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, classicIslandFilename(distractorDraftFilename)),
	});
	Object.assign(islandOptions.define, {
		__PRAXITY_DISTRACTORS_SUPPORT__: JSON.stringify(distractorSupportFilename),
		__PRAXITY_DISTRACTORS_DRAFT__: JSON.stringify(distractorDraftFilename),
	});
	const selfCheckSupportResult = await build({
		...islandOptions,
		entryPoints: { "self-check-support": SELF_CHECK_SUPPORT_ENTRY },
		entryNames: "chunks/[name]-[hash]",
		splitting: false,
	});
	const selfCheckSupportFilename = path
		.relative(islandOutDir, Object.keys(selfCheckSupportResult.metafile.outputs)[0])
		.split(path.sep)
		.join("/");
	const selfCheckSupportClassicFilename = classicIslandFilename(selfCheckSupportFilename);
	const selfCheckSupportClassicResult = await build({
		...islandOptions,
		entryPoints: [SELF_CHECK_SUPPORT_ENTRY],
		splitting: false,
		format: "iife",
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, selfCheckSupportClassicFilename),
	});
	Object.assign(islandOptions.define, {
		__PRAXITY_SELF_CHECK_SUPPORT__: JSON.stringify(selfCheckSupportFilename),
		__PRAXITY_SELF_CHECK_BUILD__: JSON.stringify("fingerprint"),
		__PRAXITY_SELF_CHECK_DOCUMENT__: JSON.stringify("fingerprint"),
	});
	const selfCheckImplementation = await build({
		...islandOptions,
		entryPoints: [ISLAND_ENTRY_POINTS["island-self-check"]],
		splitting: false,
		format: "iife",
		globalName: "PraxitySelfCheckIsland",
		write: false,
	});
	const selfCheckCoreProbe = await build({
		...islandOptions,
		entryPoints: [path.join(ISLANDS_DIR, "self-check-classic.ts")],
		splitting: false,
		format: "iife",
		write: false,
	});
	const selfCheckImplementationHash = crypto
		.createHash("sha256")
		.update(selfCheckImplementation.outputFiles[0].contents)
		.update(selfCheckCoreProbe.outputFiles[0].contents)
		.update(await readFile(path.join(ISLANDS_DIR, "self-check-module.ts")))
		.digest("hex");
	const selfCheckDocumentFilename = `chunks/self-check-document-${selfCheckImplementationHash.slice(0, 16)}.classic.js`;
	Object.assign(islandOptions.define, {
		__PRAXITY_SELF_CHECK_BUILD__: JSON.stringify(selfCheckImplementationHash),
		__PRAXITY_SELF_CHECK_DOCUMENT__: JSON.stringify(selfCheckDocumentFilename),
	});
	const selfCheckLifetimeResult = await build({
		...islandOptions,
		entryPoints: {
			"self-check-lifetime": path.join(path.dirname(ISLANDS_DIR), "self-check-document-entry.ts"),
		},
		format: "iife",
		splitting: false,
		entryNames: "[name]-[hash].classic",
	});
	const selfCheckLifetimeFilename = path.basename(
		Object.keys(selfCheckLifetimeResult.metafile.outputs)[0],
	);
	const selfCheckDocumentResult = await build({
		...islandOptions,
		entryPoints: [ISLAND_ENTRY_POINTS["island-self-check"]],
		splitting: false,
		format: "iife",
		globalName: "PraxitySelfCheckIsland",
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, selfCheckDocumentFilename),
	});
	const selfCheckDocumentHash = crypto
		.createHash("sha256")
		.update(await readFile(path.join(islandOutDir, selfCheckDocumentFilename)))
		.digest("hex");
	// Both launch modes use this same classic core. ESM statically imports its IIFE.
	const selfCheckCore = await build({
		...islandOptions,
		entryPoints: [path.join(ISLANDS_DIR, "self-check-classic.ts")],
		splitting: false,
		format: "iife",
		write: false,
	});
	const selfCheckCoreHash = crypto
		.createHash("sha256")
		.update(selfCheckCore.outputFiles[0].contents)
		.update(await readFile(path.join(ISLANDS_DIR, "self-check-module.ts")))
		.digest("hex")
		.slice(0, 8)
		.toUpperCase();
	const selfCheckCoreFilename = `island-self-check-${selfCheckCoreHash}.classic.js`;
	const selfCheckCoreResult = await build({
		...islandOptions,
		entryPoints: [path.join(ISLANDS_DIR, "self-check-classic.ts")],
		splitting: false,
		format: "iife",
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, selfCheckCoreFilename),
	});
	const selfCheckInitialResult = await build({
		...islandOptions,
		entryPoints: [path.join(ISLANDS_DIR, "self-check-module.ts")],
		splitting: false,
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, `island-self-check-${selfCheckCoreHash}.js`),
		banner: { js: `/* implementation ${selfCheckDocumentHash} */` },
		plugins: [
			{
				name: "self-check-core",
				setup(builder) {
					builder.onResolve({ filter: /^__praxity_self_check_core__$/ }, () => ({
						path: `./${selfCheckCoreFilename}`,
						external: true,
					}));
				},
			},
		],
	});
	const logicFilename = `island-logic-${(await computeViewerSourceHash()).slice(0, 12).toUpperCase()}.js`;
	const logicClassicFilename = classicIslandFilename(logicFilename);
	const logicClassicResult = await build({
		...islandOptions,
		globalName: "PraxityLogicIsland",
		entryPoints: [ISLAND_ENTRY_POINTS["island-logic"]],
		splitting: false,
		format: "iife",
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, logicClassicFilename),
	});
	const logicModuleResult = await build({
		...islandOptions,
		entryPoints: [path.join(ISLANDS_DIR, "logic-module.ts")],
		splitting: false,
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(islandOutDir, logicFilename),
		plugins: [
			{
				name: "logic-core",
				setup(builder) {
					builder.onResolve({ filter: /^__praxity_logic_core__$/ }, () => ({
						path: `./${logicClassicFilename}`,
						external: true,
					}));
				},
			},
		],
	});
	// Keep this closure free of shared chunks retaining unrelated island exports.
	const assessmentGroupResult = await build({
		...islandOptions,
		entryPoints: { "island-assessment-group": ISLAND_ENTRY_POINTS["island-assessment-group"] },
	});
	const navResult = await build({
		...islandOptions,
		entryPoints: { "island-nav": ISLAND_ENTRY_POINTS["island-nav"] },
	});
	// A new entry in the shared split graph changes existing chunk fingerprints.
	// Keep retrieval independent so courses without sheets retain exact assets.
	const retrievalSheetResult = await build({
		...islandOptions,
		entryPoints: { "island-retrieval-sheet": ISLAND_ENTRY_POINTS["island-retrieval-sheet"] },
		splitting: false,
	});
	const highlightResult = await build({
		...islandOptions,
		entryPoints: { "island-highlight": ISLAND_ENTRY_POINTS["island-highlight"] },
		splitting: false,
	});
	const distractorsResult = await build({
		...islandOptions,
		entryPoints: { "island-write-distractors": ISLAND_ENTRY_POINTS["island-write-distractors"] },
		splitting: false,
	});
	const islandResult = await build({
		...islandOptions,
		entryPoints: Object.fromEntries(
			Object.entries(ISLAND_ENTRY_POINTS).filter(
				([name]) =>
					name !== "island-write-distractors" &&
					name !== "island-retrieval-sheet" &&
					name !== "island-highlight" &&
					name !== "island-self-check" &&
					name !== "island-logic" &&
					name !== "island-nav" &&
					name !== "island-assessment-group",
			),
		),
	});
	islandResult.metafile.inputs = {
		...islandResult.metafile.inputs,
		...assessmentGroupResult.metafile.inputs,
		...retrievalSheetResult.metafile.inputs,
		...highlightResult.metafile.inputs,
		...distractorsResult.metafile.inputs,
		...distractorSupportResult.metafile.inputs,
		...distractorDraftResult.metafile.inputs,
		...distractorDraftClassicResult.metafile.inputs,
		...distractorSupportClassicResult.metafile.inputs,
		...navResult.metafile.inputs,
		...selfCheckInitialResult.metafile.inputs,
		...selfCheckCoreResult.metafile.inputs,
		...logicClassicResult.metafile.inputs,
		...logicModuleResult.metafile.inputs,
	};
	islandResult.metafile.outputs = {
		...islandResult.metafile.outputs,
		...assessmentGroupResult.metafile.outputs,
		...retrievalSheetResult.metafile.outputs,
		...highlightResult.metafile.outputs,
		...distractorsResult.metafile.outputs,
		...distractorSupportResult.metafile.outputs,
		...distractorDraftResult.metafile.outputs,
		...distractorDraftClassicResult.metafile.outputs,
		...distractorSupportClassicResult.metafile.outputs,
		...navResult.metafile.outputs,
		...selfCheckInitialResult.metafile.outputs,
		...logicModuleResult.metafile.outputs,
	};
	const islandLoaderResult = await build({
		entryPoints: [ISLAND_LOADER_ENTRY],
		bundle: true,
		format: "iife",
		outdir: islandOutDir,
		entryNames: "island-loader-[hash]",
		minify: true,
		treeShaking: true,
		target: "es2020",
		jsx: "automatic",
		define: {
			"process.env.NODE_ENV": '"production"',
			"import.meta.env": "{}",
		},
		external: [],
		nodePaths: extraNodePaths,
		metafile: true,
		drop: ["debugger"],
		legalComments: "none",
	});
	const rootRuntimeOptions: BuildOptions = {
		entryPoints: Object.fromEntries([
			...Object.entries(HOST_ENTRY_POINTS)
				.filter(([name]) => name !== "scorm12" && name !== "scorm2004")
				.map(([, { entryPoint, outputName }]) => [outputName, entryPoint]),
			["course-shell", COURSE_SHELL_ENTRY],
			["course-resume", COURSE_RESUME_ENTRY],
			["scorm-support", SCORM_SUPPORT_ENTRY],
		]),
		bundle: true,
		format: "iife",
		outdir: outDir,
		entryNames: "[name]-[hash]",
		minify: true,
		treeShaking: true,
		target: "es2020",
		define: {
			"process.env.NODE_ENV": '"production"',
			"import.meta.env": "{}",
		},
		external: [],
		nodePaths: extraNodePaths,
		metafile: true,
		drop: ["debugger"],
		legalComments: "none",
	};
	// Match the existing SCORM support boundary: hosts retain guards while the
	// private persistence and attempt owners live in a separately selected asset.
	const privacyProxy: Plugin = {
		name: "private-state-support",
		setup(builder) {
			builder.onResolve(
				{
					filter:
						/(?:^@praxity\/shared-blocks\/block-state-policy$|private-(?:xapi|scorm12)-policy(?:\.ts)?$)/,
				},
				(args) => {
					if (
						args.importer.includes(`${path.sep}scorm${path.sep}api${path.sep}`) ||
						args.importer.replaceAll("\\", "/").includes("/scorm/api/")
					)
						return {
							path: args.path.includes("private-scorm12-policy")
								? "device-attempt.ts"
								: args.path.includes("private-xapi-policy")
									? "xapi-guard"
									: "suspend-guard",
							namespace: "praxity-privacy",
						};
				},
			);
			builder.onResolve({ filter: /(?:private-block-state|device-attempt)(?:\.ts)?$/ }, (args) => {
				const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, "")}.ts`);
				if (
					source === path.join(HOSTS_DIR, "private-block-state.ts") ||
					source === path.join(SCORM_SRC, "api/device-attempt.ts")
				)
					return { path: path.basename(source), namespace: "praxity-privacy" };
			});
			if (builder.initialOptions.define?.["globalThis.__praxityPrivateState"] === "true") {
				builder.onResolve({ filter: /course-config(?:\.ts)?$/ }, () => ({
					path: "config-reader",
					namespace: "praxity-privacy",
				}));
			}
			builder.onLoad({ filter: /.*/, namespace: "praxity-privacy" }, (args) => ({
				contents:
					args.path === "config-reader"
						? 'export function readCourseHostConfig(doc) { const guard = window.__praxityPrivacyGuard; if (!guard) throw new Error("EPRIVACYLOAD"); return guard.readCourseHostConfig(doc); }'
						: args.path === "suspend-guard" || args.path === "xapi-guard"
							? `export function ${args.path === "suspend-guard" ? "filterPrivateSuspendData" : "applyXapiPrivatePolicy"}(...args) { const guard = window.__praxityPrivacyGuard; if (!guard) throw new Error("EPRIVACYLOAD"); return guard.${args.path === "suspend-guard" ? "filterPrivateSuspendData" : "applyXapiPrivatePolicy"}(...args); }`
							: args.path === "private-block-state.ts"
								? 'export function createPrivateBlockStateRuntime(...args) { const create = args[2].__praxityPrivacyBootstrap; if (!create) throw new Error("EPRIVACYLOAD"); return create(...args); }'
								: 'function support() { if (!window.__praxityPrivacySupport) throw new Error("EPRIVACYLOAD"); return window.__praxityPrivacySupport; } export function deviceAttemptId(...args) { return support().deviceAttemptId(...args); } export function resolveLaunchAttempt(...args) { return support().resolveLaunchAttempt(...args); } export function appendPrivateScorm12Interaction(session, get, set, id, index) { const loaded = window.__praxityPrivacySupport; return loaded ? loaded.appendPrivateScorm12Interaction(session, get, set, id, index) : set(`cmi.interactions.${index}.id`, id) ? index : undefined; }',
				loader: "js",
			}));
		},
	};
	const privacyBootstrapResult = await build({
		...rootRuntimeOptions,
		entryPoints: { "privacy-bootstrap": PRIVACY_BOOTSTRAP_ENTRY },
		metafile: true,
	});
	const privateChoiceResult = await build({
		...rootRuntimeOptions,
		entryPoints: { "private-choice-bootstrap": PRIVATE_CHOICE_ENTRY },
		metafile: true,
	});
	const privateChoiceFilename = path.basename(Object.keys(privateChoiceResult.metafile.outputs)[0]);
	const privacySupportResult = await build({
		...rootRuntimeOptions,
		entryPoints: { "privacy-support": PRIVACY_SUPPORT_ENTRY },
		format: "esm",
		splitting: true,
		chunkNames: "privacy-chunks/[name]-[hash]",
		metafile: true,
	});
	const privacyBootstrapFilename = path.basename(
		Object.keys(privacyBootstrapResult.metafile?.outputs ?? {})[0],
	);
	const privacySupportFilename = path.basename(
		Object.entries(privacySupportResult.metafile?.outputs ?? {}).find(
			([, meta]) => meta.entryPoint,
		)?.[0] ?? "",
	);
	const privacyClassicFilename = classicIslandFilename(privacySupportFilename);
	const privacyClassicResult = await build({
		...rootRuntimeOptions,
		entryPoints: [PRIVACY_SUPPORT_ENTRY],
		outdir: undefined,
		entryNames: undefined,
		outfile: path.join(outDir, privacyClassicFilename),
		metafile: true,
	});
	rootRuntimeOptions.plugins = [privacyProxy];
	rootRuntimeOptions.define = {
		...rootRuntimeOptions.define,
		"globalThis.__praxityPrivateState": "false",
	};
	const rootRuntimeResult = await build({ ...rootRuntimeOptions, metafile: true });
	// Only SCORM hosts import the shared classic asset. Other hosts and the shell
	// retain normal imports, so their output has no SCORM dependency or guard.
	const scormHostOptions: BuildOptions = {
		...rootRuntimeOptions,
		metafile: true,
		entryPoints: {
			"host-scorm12": HOST_ENTRY_POINTS.scorm12.entryPoint,
			"host-scorm2004": HOST_ENTRY_POINTS.scorm2004.entryPoint,
		},
		plugins: [
			privacyProxy,
			{
				name: "shared-scorm-support",
				setup(builder) {
					builder.onResolve(
						{ filter: /(?:^|\/)(?:session|api-discovery|tracking)(?:\.ts)?$/ },
						(args) => {
							const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, "")}.ts`);
							if (
								[
									path.join(SCORM_SRC, "api/session.ts"),
									path.join(SCORM_SRC, "api-discovery.ts"),
									path.join(SCORM_SRC, "tracking.ts"),
								].includes(source)
							) {
								return { path: "scorm-support", namespace: "praxity-runtime" };
							}
						},
					);
					builder.onLoad({ filter: /^scorm-support$/, namespace: "praxity-runtime" }, () => ({
						contents: `const runtime = window.__praxityScormSupport;
if (!runtime) throw new Error("Missing SCORM support runtime.");
export const { getSessionState, readSessionState, writeSessionState, sessionAllowsCalls, findScormApi, findWindowProperty, readScormEntry, CourseTracker } = runtime;`,
						loader: "js",
					}));
				},
			},
		],
	};
	const scormHostResult = await build({ ...scormHostOptions, metafile: true });
	const privateHostResult = await build({
		...rootRuntimeOptions,
		define: { ...rootRuntimeOptions.define, "globalThis.__praxityPrivateState": "true" },
		entryPoints: Object.fromEntries(
			Object.entries(HOST_ENTRY_POINTS)
				.filter(([name]) => name !== "scorm12" && name !== "scorm2004")
				.map(([, { entryPoint, outputName }]) => [`${outputName}-private`, entryPoint]),
		),
		metafile: true,
	});
	const privateScormResult = await build({
		...scormHostOptions,
		define: { ...rootRuntimeOptions.define, "globalThis.__praxityPrivateState": "true" },
		entryPoints: Object.fromEntries(
			["scorm12", "scorm2004"].map((name) => {
				const host = HOST_ENTRY_POINTS[name as "scorm12" | "scorm2004"];
				return [`${host.outputName}-private`, host.entryPoint];
			}),
		),
		metafile: true,
	});
	rootRuntimeResult.metafile.inputs = {
		...rootRuntimeResult.metafile.inputs,
		...scormHostResult.metafile.inputs,
		...privateHostResult.metafile.inputs,
		...privateScormResult.metafile.inputs,
	};
	rootRuntimeResult.metafile.outputs = {
		...rootRuntimeResult.metafile.outputs,
		...scormHostResult.metafile.outputs,
		...privateHostResult.metafile.outputs,
		...privateScormResult.metafile.outputs,
	};

	const entryByPath = new Map<string, IslandEntryName>(
		Object.entries(ISLAND_ENTRY_POINTS).map(([name, absPath]) => [
			path.resolve(absPath),
			name as IslandEntryName,
		]),
	);
	entryByPath.set(path.resolve(ISLANDS_DIR, "self-check-module.ts"), "island-self-check");
	entryByPath.set(path.resolve(ISLANDS_DIR, "logic-module.ts"), "island-logic");
	const islandFileMap = {} as Record<IslandEntryName, string>;
	const islandEntryOutputs = {} as Record<IslandEntryName, string>;
	const islandFiles = new Set<string>();
	islandFiles.add(selfCheckSupportFilename);
	islandFiles.add(selfCheckSupportClassicFilename);
	islandFiles.add(selfCheckDocumentFilename);

	for (const [outputPath, outputMeta] of Object.entries(islandResult.metafile?.outputs ?? {})) {
		if (!outputPath.endsWith(".js")) continue;
		const rel = path.relative(islandOutDir, outputPath).split(path.sep).join("/");
		islandFiles.add(rel);
		if (outputMeta.entryPoint) {
			const entryName = entryByPath.get(path.resolve(outputMeta.entryPoint));
			if (entryName) {
				islandFileMap[entryName] = rel;
				islandEntryOutputs[entryName] = outputPath;
			}
		}
	}

	for (const entryName of Object.keys(ISLAND_ENTRY_POINTS) as IslandEntryName[]) {
		if (!islandFileMap[entryName]) {
			throw new Error(`bundleViewer: missing output for island entry ${entryName}`);
		}
	}
	// Chromium file:// refuses module imports. Keep the same island entries in classic bundles.
	const classicFilenames: Partial<Record<IslandEntryName, string>> = {};
	const classicResults = [];
	classicFilenames["island-self-check"] = selfCheckCoreFilename;
	classicFilenames["island-logic"] = logicClassicFilename;
	islandFiles.add(logicClassicFilename);
	classicResults.push(logicClassicResult);
	islandFiles.add(selfCheckCoreFilename);
	classicResults.push(selfCheckCoreResult);
	for (const entryName of [
		"island-deck",
		"island-rating",
		"island-write-distractors",
		"island-highlight",
	] as const) {
		const filename = classicIslandFilename(islandFileMap[entryName]);
		classicFilenames[entryName] = filename;
		classicResults.push(
			await build({
				...islandOptions,
				entryPoints: [ISLAND_ENTRY_POINTS[entryName]],
				globalName: {
					"island-deck": "PraxityDeckIsland",
					"island-rating": "PraxityRatingIsland",
					"island-write-distractors": "PraxityDistractorsIsland",
					"island-highlight": "PraxityHighlightIsland",
				}[entryName],
				splitting: false,
				format: "iife",
				outdir: undefined,
				entryNames: undefined,
				outfile: path.join(islandOutDir, filename),
			}),
		);
		islandFiles.add(filename);
	}
	islandFiles.add(selfCheckLifetimeFilename);
	let islandLoaderFilename: string | null = null;
	for (const [outputPath, outputMeta] of Object.entries(
		islandLoaderResult.metafile?.outputs ?? {},
	)) {
		if (!outputPath.endsWith(".js")) continue;
		const rel = path.relative(islandOutDir, outputPath).split(path.sep).join("/");
		islandFiles.add(rel);
		if (
			outputMeta.entryPoint &&
			path.resolve(outputMeta.entryPoint) === path.resolve(ISLAND_LOADER_ENTRY)
		) {
			islandLoaderFilename = rel;
		}
	}
	if (!islandLoaderFilename) {
		throw new Error("bundleViewer: missing output for island-loader entry");
	}
	const hostByEntryPoint = new Map(
		(Object.keys(HOST_ENTRY_POINTS) as ViewerHostName[]).map((hostName) => [
			path.resolve(HOST_ENTRY_POINTS[hostName].entryPoint),
			hostName,
		]),
	);
	const hostFilenames = {} as Record<ViewerHostName, string>;
	const privateHostFilenames = {} as Record<ViewerHostName, string>;
	let shellFilename: string | null = null;
	let resumeFilename: string | null = null;
	let scormSessionFilename: string | null = null;
	for (const [outputPath, outputMeta] of Object.entries(
		rootRuntimeResult.metafile?.outputs ?? {},
	)) {
		if (!outputPath.endsWith(".js") || !outputMeta.entryPoint) continue;
		if (path.resolve(outputMeta.entryPoint) === SCORM_SUPPORT_ENTRY) {
			scormSessionFilename = path.basename(outputPath);
			continue;
		}
		if (path.resolve(outputMeta.entryPoint) === path.resolve(COURSE_SHELL_ENTRY)) {
			shellFilename = path.basename(outputPath);
			continue;
		}
		if (path.resolve(outputMeta.entryPoint) === path.resolve(COURSE_RESUME_ENTRY)) {
			resumeFilename = path.basename(outputPath);
			continue;
		}
		const hostName = hostByEntryPoint.get(path.resolve(outputMeta.entryPoint));
		if (hostName) {
			if (path.basename(outputPath).includes("-private-"))
				privateHostFilenames[hostName] = path.basename(outputPath);
			else hostFilenames[hostName] = path.basename(outputPath);
		}
	}
	if (!shellFilename) throw new Error("bundleViewer: missing course shell output");
	if (!resumeFilename) throw new Error("bundleViewer: missing course resume output");
	if (!scormSessionFilename) throw new Error("bundleViewer: missing SCORM session output");
	for (const hostName of Object.keys(HOST_ENTRY_POINTS) as ViewerHostName[]) {
		if (!hostFilenames[hostName]) {
			throw new Error(`bundleViewer: missing output for ${hostName} host`);
		}
	}

	const metafiles = [
		cssResult,
		deckCssResult,
		retrievalSheetCssResult,
		highlightCssResult,
		distractorCssResult,
		islandResult,
		selfCheckSupportResult,
		selfCheckSupportClassicResult,
		selfCheckDocumentResult,
		selfCheckLifetimeResult,
		...classicResults,
		islandLoaderResult,
		rootRuntimeResult,
		privacyBootstrapResult,
		privateChoiceResult,
		privacySupportResult,
		privacyClassicResult,
	].map((result) => result.metafile);
	onBuildInputs?.(
		[
			...new Set([
				BUNDLE_SOURCE,
				...metafiles.flatMap((meta) =>
					Object.keys(meta.inputs).filter(
						(input) =>
							!input.startsWith("praxity-runtime:") && !input.startsWith("praxity-privacy:"),
					),
				),
			]),
		].sort(),
	);
	await assertLearningPatternsBundleInputs(
		path.resolve(__dirname, "../../.."),
		metafiles,
		"learner-bundle",
		process.cwd(),
	);

	const manifest: ViewerBundleManifest = {
		selfCheckSupport: [selfCheckSupportFilename, selfCheckSupportClassicFilename],
		writeDistractorsSupport: [
			distractorDraftFilename,
			classicIslandFilename(distractorDraftFilename),
			distractorSupportFilename,
			classicIslandFilename(distractorSupportFilename),
		],
		selfCheckDocument: selfCheckDocumentFilename,
		selfCheckLifetime: selfCheckLifetimeFilename,
		courseRuntimeLicense: await readFile(
			path.resolve(__dirname, "../template/COURSE-RUNTIME-LICENSE.txt"),
			"utf8",
		),
		thirdPartyNotices: await collectRuntimeNotices(metafiles, outDir),
		css: path.basename(cssPath),
		deckCss: path.basename(deckCssPath),
		retrievalSheetCss: "retrieval-sheet.css",
		highlightCss: "highlight.css",
		writeDistractorsCss: WRITE_DISTRACTORS_STYLESHEET,
		shell: shellFilename,
		resume: resumeFilename,
		privateChoice: privateChoiceFilename,
		privacy: {
			bootstrap: privacyBootstrapFilename,
			support: privacySupportFilename,
			files: [
				...outputClosure(
					privacySupportResult.metafile,
					path.join(outDir, privacySupportFilename),
					outDir,
				),
				privacyBootstrapFilename,
				privacyClassicFilename,
			],
		},
		hosts: hostFilenames,
		privateHosts: privateHostFilenames,
		hostDependencies: { scorm12: [scormSessionFilename], scorm2004: [scormSessionFilename] },
		islands: {
			...islandFileMap,
			"island-loader": islandLoaderFilename,
		},
		islandFiles: [...islandFiles].sort(),
		islandDependencies: {
			...(Object.fromEntries(
				(Object.keys(ISLAND_ENTRY_POINTS) as IslandEntryName[]).map((entryName) => [
					entryName,
					[
						...outputClosure(islandResult.metafile, islandEntryOutputs[entryName], islandOutDir),
						...(classicFilenames[entryName] ? [classicFilenames[entryName]] : []),
						...(entryName === "island-self-check"
							? [selfCheckLifetimeFilename, selfCheckDocumentFilename]
							: entryName === "island-rating" || entryName === "island-write-distractors"
								? [selfCheckLifetimeFilename]
								: []),
					],
				]),
			) as Record<IslandEntryName, string[]>),
			"island-loader": outputClosure(
				islandLoaderResult.metafile,
				path.join(islandOutDir, islandLoaderFilename),
				islandOutDir,
			),
		},
	};

	await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

	const cssBytes = Object.values(cssResult.metafile?.outputs ?? {})[0]?.bytes ?? 0;
	console.log(`✓ viewer.css (${(cssBytes / 1024).toFixed(0)} KB)`);
	console.log(`✓ islands (${manifest.islandFiles.length} JS files)`);

	return {
		cssPath,
		deckCssPath,
		shellPath: path.join(outDir, shellFilename),
		resumePath: path.join(outDir, resumeFilename),
		hostPaths: Object.fromEntries(
			(Object.keys(hostFilenames) as ViewerHostName[]).map((hostName) => [
				hostName,
				path.join(outDir, hostFilenames[hostName]),
			]),
		) as Record<ViewerHostName, string>,
		islandOutDir,
		manifestPath,
		manifest,
	};
}
