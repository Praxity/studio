import path from "node:path";
import fs from "fs-extra";
import {
	readViewerManifest,
	type ViewerBundleManifest,
	viewerManifestAssetPaths,
} from "./bundle-viewer.ts";

export const VIEWER_CACHE_DIR = path.resolve(import.meta.dirname, "../prebuilt");

const generationDir = (root: string, hash: string) => path.join(root, "viewer-cache", hash);

/** Published generations stay immutable while exports copy their selected assets. */
export async function readCachedViewer(root: string, hash: string) {
	for (const directory of [generationDir(root, hash), root]) {
		try {
			if (String(await fs.readFile(path.join(directory, "viewer.hash"), "utf8")).trim() !== hash)
				continue;
			const manifest = await readViewerManifest(directory);
			if (!manifest.thirdPartyNotices) continue;
			if (
				(
					await Promise.all(
						viewerManifestAssetPaths(manifest).map((file) =>
							fs.pathExists(path.join(directory, file)),
						),
					)
				).every(Boolean)
			)
				return { directory, manifest };
		} catch {
			// A missing, stale or incomplete cache is rebuilt from source.
		}
	}
	return null;
}

export async function cacheViewerBundle(
	root: string,
	source: string,
	manifest: ViewerBundleManifest,
	hash: string,
) {
	const directory = generationDir(root, hash);
	await fs.ensureDir(path.dirname(directory));
	const stage = await fs.mkdtemp(path.join(path.dirname(directory), ".viewer-"));
	try {
		for (const file of [...viewerManifestAssetPaths(manifest), "viewer-manifest.json"])
			await fs.copy(path.join(source, file), path.join(stage, file));
		await fs.writeFile(path.join(stage, "viewer.hash"), hash);
		try {
			await fs.rename(stage, directory);
		} catch (error) {
			// Another process may publish this same complete generation first.
			const winner = await readCachedViewer(root, hash);
			if (winner?.directory !== directory) throw error;
		}
		return directory;
	} finally {
		await fs.remove(stage);
	}
}
