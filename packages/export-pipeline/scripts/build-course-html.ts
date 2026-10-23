/**
 * Build a grammar .md file into a standalone HTML export directory.
 *
 * Usage: tsx scripts/build-course-html.ts <course.md> <output-dir> [supplement.json] [--fresh-assets]
 *
 * Same pipeline the desktop app uses (buildScormPackage, format "html"), driven
 * from the CLI so sample/test courses can be produced without launching Electron.
 * The optional supplement is a JSON array of typed blocks for fixtures that cover
 * internal block types without public grammar syntax.
 *
 * PageSpeed sample:
 * pnpm --filter @praxity/export-pipeline exec tsx scripts/build-course-html.ts \
 *   ../../docs/test-fixtures/sample-course-grammar.md /tmp/praxity-pagespeed-sample \
 *   ../../docs/test-fixtures/sample-course-pagespeed-extras.json --fresh-assets
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	assertCoursePracticeAdmission,
	type GrammarFrontmatter,
	readLesson,
	refuseUnavailableLessonRuntime,
} from "@praxity/grammar";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import { ASSET_FIELDS, DEFAULT_COMPLETION_THRESHOLD } from "@praxity/shared-blocks/constants";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import AdmZip from "adm-zip";
import { buildScormPackage, type DesktopExportInput } from "../src/build.ts";
import { bundleViewer } from "../src/bundle-viewer.ts";
import { prepareDesktopCssAssets } from "../src/export-css.ts";

const args = process.argv.slice(2);
const freshAssets = args.includes("--fresh-assets");
const [sourceArg, outArg, supplementArg] = args.filter((arg) => arg !== "--fresh-assets");
if (!sourceArg || !outArg) {
	console.error(
		"Usage: tsx scripts/build-course-html.ts <course.md> <output-dir> [supplement.json] [--fresh-assets]",
	);
	process.exit(1);
}

const sourcePath = path.resolve(sourceArg);
const sourceDir = path.dirname(sourcePath);
const outDir = path.resolve(outArg);

const source = await readFile(sourcePath, "utf-8");
const parsed = readLesson(source);
refuseUnavailableLessonRuntime(parsed, sourcePath);
assertCoursePracticeAdmission([{ path: sourcePath, read: parsed }]);
const supplement = supplementArg
	? (JSON.parse(await readFile(path.resolve(supplementArg), "utf-8")) as unknown)
	: [];
if (!Array.isArray(supplement)) {
	throw new Error("The supplement must be a JSON array of Praxity blocks.");
}
const blocks = adaptGrammarPreviewBlocks(
	[...parsed.blocks, ...supplement],
	undefined,
	parsed.frontmatter.lang,
);
for (const warning of parsed.warnings ?? []) {
	console.warn(`[grammar] ${warning.message}`);
}

const frontmatter = (parsed.frontmatter ?? {}) as GrammarFrontmatter;
// Local asset paths in the grammar are relative to the source file's directory.
const resolvedAssets = new Map<string, Uint8Array>();
const [resolvedSource] = await traverseAssetGraph(
	[{ id: "sample-course-source", title: "Sample Course", blocks }],
	{
		onAsset: async ({ value }) => {
			if (/^https?:\/\//.test(value)) return;
			const normalized = value.replace(/^\/+|^\.\//g, "");
			if (!normalized) return;
			const exportPath = normalized.startsWith("assets/")
				? normalized
				: `assets/${path.basename(normalized)}`;
			resolvedAssets.set(exportPath, await readFile(path.resolve(sourceDir, normalized)));
		},
		rewriteAsset: ({ value }) => {
			if (/^https?:\/\//.test(value)) return undefined;
			const normalized = value.replace(/^\/+|^\.\//g, "");
			return normalized.startsWith("assets/") ? normalized : `assets/${path.basename(normalized)}`;
		},
	},
	{ assetFields: [...ASSET_FIELDS, "href"] },
);

const course: DesktopExportInput = {
	courseId: "sample-course",
	blocks: resolvedSource?.blocks ?? blocks,
	frontmatter,
	config: { completionThreshold: DEFAULT_COMPLETION_THRESHOLD },
	resolvedAssets,
	viewerVersion: "local",
	locale: typeof frontmatter.lang === "string" ? frontmatter.lang : "en",
};

const generatedAssetsDir = freshAssets
	? await mkdtemp(path.join(tmpdir(), "praxity-sample-assets-"))
	: null;
try {
	if (generatedAssetsDir) {
		await Promise.all([
			bundleViewer(generatedAssetsDir),
			prepareDesktopCssAssets(generatedAssetsDir),
		]);
	}
	const result = await buildScormPackage(course, {
		mode: "desktop",
		format: "html",
		prebuiltAssetsDir:
			generatedAssetsDir ??
			path.resolve(import.meta.dirname, "../../../apps/desktop/resources/export-assets"),
		projectDir: sourceDir,
		onProgress: (step, percent) => console.log(`  ${percent}% — ${step}`),
	});

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	new AdmZip(result.zip).extractAllTo(outDir, true);

	console.log(`\n${result.pageCount} pages → ${outDir}`);
} finally {
	if (generatedAssetsDir) await rm(generatedAssetsDir, { recursive: true, force: true });
}
