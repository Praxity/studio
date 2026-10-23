/**
 * Pre-bundles learner UI and host runtimes for the standalone Studio CLI.
 *
 * Outputs:
 *   resources/export-assets/viewer.css
 *   resources/export-assets/viewer-manifest.json
 *   resources/export-assets/course-shell-*.js
 *   resources/export-assets/host-*.js
 *   resources/export-assets/islands/ (recursive)
 *   resources/export-assets/styles.css
 *   resources/export-assets/styles-lite.css
 *   resources/export-assets/tabler-nodes-outline.json
 *   resources/export-assets/tabler-nodes-filled.json
 *   resources/export-assets/viewer.version.json
 *   resources/export-assets/review-comments.js
 *   resources/export-assets/review-comments.css
 *   resources/export-assets/schemas/ (recursive)
 *
 * Run via: pnpm --filter @praxity/desktop prebuild
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
	bundleViewer,
	computeViewerSourceHash,
} from "../../../packages/export-pipeline/src/bundle-viewer.ts";
import { prepareDesktopExportInputs } from "../../../packages/export-pipeline/src/export-assets.ts";
import { assertLearningPatternsBundleInputs } from "../../../scripts/learning-patterns-admission.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../resources/export-assets");
export async function bundleInspectionFrame(
	repoRoot: string,
	outputDir: string,
	onBuildInputs?: (files: string[]) => void,
): Promise<void> {
	// Studio-only bridge. Deployment manifests never include it in learner exports.
	const inspectionBundle = await build({
		entryPoints: [path.join(repoRoot, "apps/desktop/src/inspection-frame.ts")],
		outfile: path.join(outputDir, "inspection-frame.js"),
		bundle: true,
		format: "iife",
		platform: "browser",
		minify: true,
		metafile: true,
		plugins: [
			{
				name: "inspection-css",
				setup(builder) {
					builder.onResolve({ filter: /\.css\?raw$/ }, (args) => ({
						path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
						namespace: "inspection-css",
					}));
					builder.onLoad({ filter: /./, namespace: "inspection-css" }, async (args) => ({
						contents: await readFile(args.path, "utf8"),
						loader: "text",
					}));
				},
			},
		],
	});
	// The CSS plugin namespace names real files; include those bytes as inputs too.
	const inputs = Object.keys(inspectionBundle.metafile.inputs).map((input) =>
		path.resolve(input.replace(/^inspection-css:/, "")),
	);
	onBuildInputs?.(inputs);
	await assertLearningPatternsBundleInputs(
		repoRoot,
		[{ inputs: Object.fromEntries(inputs.map((input) => [input, {}])) }],
		"studio-browser",
		process.cwd(),
	);
	await writeFile(
		path.join(outputDir, "inspection-frame.inputs.json"),
		JSON.stringify(inputs.map((input) => path.relative(repoRoot, input))),
	);
}

async function main(): Promise<void> {
	execFileSync(
		process.execPath,
		[path.resolve(__dirname, "../../../scripts/check-learning-patterns.mjs")],
		{
			stdio: "inherit",
		},
	);
	await mkdir(outputDir, { recursive: true });
	await bundleInspectionFrame(path.resolve(__dirname, "../../.."), outputDir);
	const sourceHash = await computeViewerSourceHash();

	// 1. Bundle viewer UI, target-specific hosts, and their manifest.
	console.log("[prebuild] Bundling viewer...");
	const { cssPath, islandOutDir, manifestPath } = await bundleViewer(outputDir);
	console.log(`[prebuild] viewer.css written to ${cssPath}`);
	const islandDestDir = path.join(outputDir, "islands");
	if (path.resolve(islandOutDir) !== path.resolve(islandDestDir)) {
		await cp(islandOutDir, islandDestDir, { recursive: true, force: true });
	}
	const manifestDestPath = path.join(outputDir, "viewer-manifest.json");
	if (path.resolve(manifestPath) !== path.resolve(manifestDestPath)) {
		await copyFile(manifestPath, manifestDestPath);
	}
	console.log(`[prebuild] islands output ready at ${islandDestDir}`);
	console.log(`[prebuild] viewer-manifest.json ready at ${manifestDestPath}`);

	// 2. Build the desktop export CSS bundles
	console.log("[prebuild] Building styles.css and styles-lite.css...");
	await prepareDesktopExportInputs(outputDir);
	console.log("[prebuild] styles.css and styles-lite.css written");

	// 3. Write version metadata for the viewer compatibility contract.
	//    Embedded as <meta name="praxity-viewer" content="..."> in exported HTML.
	const packageJsonPath = path.resolve(__dirname, "../package.json");
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8")) as { version: string };
	const versionInfo = {
		appVersion: packageJson.version,
		viewerSourceHash: sourceHash.slice(0, 12),
		builtAt: new Date().toISOString(),
	};
	await writeFile(
		path.join(outputDir, "viewer.version.json"),
		JSON.stringify(versionInfo, null, "\t"),
		"utf-8",
	);

	console.log(
		`[prebuild] viewer.version.json (app=${versionInfo.appVersion}, hash=${versionInfo.viewerSourceHash})`,
	);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err: unknown) => {
		console.error("[prebuild] Failed:", err);
		process.exit(1);
	});
}
