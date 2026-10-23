/**
 * Pre-bundles the React viewer into a static JS file.
 * Run via: pnpm --filter @praxity/export-pipeline prebuild:client
 *
 * Publish-time builds reuse a complete, immutable generation instead of
 * running a full bundler pass per export. Generated assets stay uncommitted.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { bundleViewer, computeViewerSourceHash } from "./bundle-viewer";
import { cacheViewerBundle, VIEWER_CACHE_DIR } from "./viewer-cache";

const hash = await computeViewerSourceHash();
await mkdir(VIEWER_CACHE_DIR, { recursive: true });
const source = await mkdtemp(path.join(VIEWER_CACHE_DIR, ".build-"));
try {
	const { manifest } = await bundleViewer(source);
	const directory = await cacheViewerBundle(VIEWER_CACHE_DIR, source, manifest, hash);
	console.log(
		`✓ ${path.relative(VIEWER_CACHE_DIR, directory)}/viewer.hash (${hash.slice(0, 12)}…)`,
	);
} finally {
	await rm(source, { recursive: true, force: true });
}
