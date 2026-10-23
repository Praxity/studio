import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, it } from "vitest";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
let root = "";
let refusal = "";
let inputs: string[] | undefined;

// One real build for this file. Copied policy/source and links to read-only
// dependencies prevent the planted manifest omission from touching other builds.
beforeAll(async () => {
	root = await realpath(await mkdtemp(path.join(tmpdir(), "learning-patterns-bundle-")));
	const put = async (relative: string, contents: Uint8Array | string) => {
		await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
		await writeFile(path.join(root, relative), contents);
	};
	for (const file of [
		"bundle-viewer.ts",
		"third-party-notices.ts",
		"classic-island-filename.ts",
		"export-css.ts",
		"module-deck-strings.ts",
		"course-home.ts",
		"course-session-time.ts",
	])
		await put(
			`packages/export-pipeline/src/${file}`,
			await readFile(path.join(repo, "packages/export-pipeline/src", file)),
		);
	for (const file of [
		"scripts/learning-patterns-admission.mjs",
		"packages/export-pipeline/package.json",
		"pnpm-lock.yaml",
	])
		await put(file, await readFile(path.join(repo, file)));
	for (const relative of [
		"packages/shared-blocks",
		"packages/grammar",
		"packages/content-model",
		"packages/export-pipeline/node_modules",
		"packages/export-pipeline/src/scorm",
		"apps/desktop/resources/third-party-notices",
	]) {
		await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
		await symlink(path.join(repo, relative), path.join(root, relative), "dir");
	}
	await cp(
		path.join(repo, "packages/export-pipeline/template"),
		path.join(root, "packages/export-pipeline/template"),
		{ recursive: true },
	);
	await cp(
		path.join(repo, "packages/export-pipeline/src/patterns"),
		path.join(root, "packages/export-pipeline/src/patterns"),
		{ recursive: true },
	);
	const manifest = JSON.parse(
		await readFile(path.join(repo, "scripts/learning-patterns-admission.json"), "utf8"),
	);
	manifest.files = manifest.files.filter(
		(file: { path: string }) => file.path !== "lib/text-limits.js",
	);
	await put("scripts/learning-patterns-admission.json", JSON.stringify(manifest));
	const { bundleViewer } = await import(
		pathToFileURL(path.join(root, "packages/export-pipeline/src/bundle-viewer.ts")).href
	);
	try {
		await bundleViewer(path.join(root, "output"), (files: string[]) => {
			inputs = files;
		});
	} catch (error) {
		refusal = error instanceof Error ? error.message : String(error);
	}
});

afterAll(async () => {
	if (root) await rm(root, { recursive: true });
});

it("P2-2: bundleViewer itself refuses unadmitted bytes for every caller", () => {
	assert.ok(
		inputs?.some((file) =>
			file.replaceAll("\\", "/").endsWith("/learning-patterns/lib/text-limits.js"),
		),
		"The real bundle must consume the omitted helper",
	);
	assert.match(
		refusal || "build passed without admission",
		/Unadmitted bundle input: lib\/text-limits.js/,
	);
});
