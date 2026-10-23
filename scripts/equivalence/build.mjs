// Executed by the selected checkout's tsx, with every production import rooted there.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const [mode, checkout, output, projectDir, assets] = process.argv.slice(2);
const source = createRequire(path.join(checkout, "package.json"));
await mkdir(output, { recursive: true });
if (mode === "prepare") {
	const { bundleViewer, computeViewerSourceHash } = source(
		"./packages/export-pipeline/src/bundle-viewer.ts",
	);
	const { prepareDesktopExportInputs } = source("./packages/export-pipeline/src/export-assets.ts");
	await bundleViewer(output);
	await prepareDesktopExportInputs(output);
	const pkg = JSON.parse(await readFile(path.join(checkout, "apps/desktop/package.json"), "utf8"));
	await writeFile(
		path.join(output, "viewer.version.json"),
		JSON.stringify({
			appVersion: pkg.version,
			viewerSourceHash: (await computeViewerSourceHash()).slice(0, 12),
			builtAt: "2026-01-01T00:00:00.000Z",
		}),
	);
} else if (mode === "export") {
	const { exportProject } = source("./apps/desktop/src/main/export/export-project.ts");
	const { DEFAULT_PROJECT_CONFIG } = source("./packages/editor-core/src/types/project.ts");
	const result = await exportProject({
		projectDir,
		format: "html",
		scope: "course",
		manifestPolicy: "read-only",
		inheritWorkspaceSettings: false,
		fallbackCompletionThreshold: DEFAULT_PROJECT_CONFIG.export.completionThreshold,
		enforceAccessibility: true,
		exportAssetsDir: assets,
		temporaryRoot: path.dirname(output),
	});
	const require = createRequire(path.join(checkout, "apps/desktop/package.json"));
	const AdmZip = require("adm-zip");
	await writeFile(path.join(path.dirname(output), "export.zip"), result.zip);
	new AdmZip(result.zip).extractAllTo(output);
	const { zip: _zip, ...metadata } = result;
	await writeFile(
		path.join(path.dirname(output), "export.json"),
		JSON.stringify(metadata, null, 2),
	);
} else {
	throw new Error(`Unknown build mode: ${mode}`);
}
