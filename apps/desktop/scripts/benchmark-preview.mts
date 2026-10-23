import path from "node:path";
import { performance } from "node:perf_hooks";
import { assertViewerAssetsReady } from "@praxity/export-pipeline/bundle-viewer";
import { buildCourseExportInput } from "../src/main/export/build-export-input-from-project.ts";

// Run with pnpm exec tsx apps/desktop/scripts/benchmark-preview.mts PROJECT [CALLS].
// Mirrors the service's build phases without Electron hosting or opening an iframe.
const projectDir = path.resolve(process.argv[2]);
const exportAssetsDir = path.resolve("apps/desktop/resources/export-assets");
for (let call = 0; call < Number(process.argv[3] ?? 1); call++) {
	const timings: Record<string, number> = {};
	let previous = performance.now();
	const start = previous;
	const mark = (name: string) => {
		const now = performance.now();
		timings[name] = Math.round((now - previous) * 10) / 10;
		previous = now;
	};
	await assertViewerAssetsReady(exportAssetsDir, "electron-preview");
	mark("validate");
	const input = await buildCourseExportInput({
		mode: "preview",
		manifestPolicy: "read-only",
		projectDir,
		completionThreshold: 1,
		viewerVersionPath: path.join(exportAssetsDir, "viewer.version.json"),
		scope: "course",
	});
	mark("input");
	const { compileCourse, deployCourse } = await import("@praxity/export-pipeline");
	mark("import");
	const stages: Array<{ step: string; ms: number }> = [];
	const compileStart = performance.now();
	const artifact = await compileCourse(input, {
		mode: "desktop",
		prebuiltAssetsDir: exportAssetsDir,
		projectDir,
		onProgress: (step) => stages.push({ step, ms: Math.round(performance.now() - compileStart) }),
	});
	mark("compile");
	try {
		const deployment = await deployCourse(artifact, { format: "electron-preview" });
		mark("deploy");
		try {
			console.log(
				JSON.stringify({
					projectDir,
					call,
					timings,
					total: Math.round(performance.now() - start),
					stages,
					pages: artifact.manifest.pages.length,
					assetBytes: [...input.resolvedAssets.values()].reduce(
						(sum, bytes) => sum + bytes.byteLength,
						0,
					),
					files: artifact.manifest.files.length,
				}),
			);
		} finally {
			await deployment.dispose();
		}
	} finally {
		await artifact.dispose();
	}
}
