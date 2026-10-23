/**
 * Vitest globalSetup — ensures prebuilt viewer assets exist before tests run,
 * and pre-builds the comprehensive grammar fixture so all published-output
 * test files share a single build (workers get their own module scope, so
 * module-level caching doesn't survive across Vitest forks).
 */

import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeViewerSourceHash } from "./src/bundle-viewer";
import { readCachedViewer, VIEWER_CACHE_DIR } from "./src/viewer-cache";
import { AUTHORING_CATALOG_PATH, PUBLISHED_FIXTURE_PATH } from "./tests/published-output/setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setup() {
	if (!(await readCachedViewer(VIEWER_CACHE_DIR, await computeViewerSourceHash()))) {
		console.log("[export-pipeline] Prebuilt viewer missing — running prebuild…");
		execSync("pnpm prebuild", { cwd: __dirname, stdio: "inherit" });
	}

	// Pre-build the comprehensive grammar fixture so all published-output
	// test files read from disk instead of each worker rebuilding.
	console.log("[export-pipeline] Building published-output fixture…");
	const { loadGrammarFixture } = await import("./tests/fixtures/load-grammar-fixture");
	const { buildScormPackage } = await import("./src/build");
	const { course: publishedCourse, buildOptions: publishedOptions } = await loadGrammarFixture();
	const publishedResult = await buildScormPackage(publishedCourse, {
		...publishedOptions,
		format: "html",
	});
	await writeFile(PUBLISHED_FIXTURE_PATH, publishedResult.zip);
	console.log("[export-pipeline] Published-output fixture cached.");
	const { loadAuthoringCatalogFixture } = await import("./tests/fixtures/load-grammar-fixture");
	const { course, buildOptions } = await loadAuthoringCatalogFixture();
	const result = await buildScormPackage(course, { ...buildOptions, format: "html" });
	await writeFile(AUTHORING_CATALOG_PATH, result.zip);
}

export async function teardown() {
	// Clean up cached fixture after test run
	const { rm } = await import("node:fs/promises");
	await rm(PUBLISHED_FIXTURE_PATH, { force: true });
	await rm(AUTHORING_CATALOG_PATH, { force: true });
}
