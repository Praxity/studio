import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertViewerAssetsCurrent,
	readViewerManifest,
	viewerManifestAssetPaths,
} from "./bundle-viewer.ts";
import { desktopCssAssetPaths, desktopCssInputs, prepareDesktopCssAssets } from "./export-css.ts";
import { IMAGE_CODEC_ASSETS } from "./optimize-image.ts";
import {
	assertRuntimeLegalInputs,
	readPackageNotice,
	selectableRuntimeNoticeInputs,
} from "./third-party-notices.ts";

const pipelineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(pipelineRoot, "package.json"));

export interface DesktopExportInputFile {
	source: string;
	assetPath: string;
}

async function directoryInputs(source: string, prefix: string): Promise<DesktopExportInputFile[]> {
	const files: DesktopExportInputFile[] = [];
	for (const entry of await readdir(source, { withFileTypes: true })) {
		const file = path.join(source, entry.name);
		const assetPath = `${prefix}/${entry.name}`;
		if (entry.isDirectory()) files.push(...(await directoryInputs(file, assetPath)));
		else files.push({ source: file, assetPath });
	}
	return files;
}

/** File inputs copied by preparation, separate from generated viewer/CSS outputs. */
async function desktopExportCopyInputs(): Promise<DesktopExportInputFile[]> {
	return [
		...IMAGE_CODEC_ASSETS.map((specifier) => ({
			source: require.resolve(specifier),
			assetPath: `image-codecs/${path.basename(specifier)}`,
		})),
		...(await directoryInputs(
			path.resolve(pipelineRoot, "../../apps/desktop/resources/third-party-notices/image-codecs"),
			"image-codecs/notices",
		)),
		...(await directoryInputs(path.join(pipelineRoot, "schemas"), "schemas")),
		...["review-comments.js", "review-comments.css"].map((name) => ({
			source: path.join(pipelineRoot, "template", name),
			assetPath: name,
		})),
		...["tabler-nodes-outline.json", "tabler-nodes-filled.json"].map((name) => ({
			source: path.join(pipelineRoot, "node_modules/@tabler/icons", name),
			assetPath: name,
		})),
	];
}

/** Preparation and provenance consumers use exactly the same owned input rules. */
export async function desktopExportInputs(): Promise<DesktopExportInputFile[]> {
	return [...(await desktopExportCopyInputs()), ...(await desktopCssInputs())];
}

export async function prepareDesktopExportInputs(outputDir: string): Promise<void> {
	for (const input of await desktopExportCopyInputs()) {
		const target = path.join(outputDir, input.assetPath);
		await mkdir(path.dirname(target), { recursive: true });
		await copyFile(input.source, target);
	}
	await prepareDesktopCssAssets(outputDir);
}

/** Required paths come from preparation owners, never from a directory being checked. */
export async function preparedExportAssetPaths(outputDir: string): Promise<string[]> {
	const manifest = await readViewerManifest(outputDir);
	return [
		...new Set([
			"viewer.version.json",
			"viewer-manifest.json",
			...viewerManifestAssetPaths(manifest),
			...(await desktopExportCopyInputs()).map((input) => input.assetPath),
			...(await desktopCssAssetPaths(outputDir)),
		]),
	].sort();
}

/** Verify the prepared inputs shipped to desktop and standalone exports. */
export async function verifyPreparedExportAssets(
	outputDir: string,
	appVersion?: string,
): Promise<void> {
	await assertViewerAssetsCurrent(outputDir, appVersion);
	for (const assetPath of await preparedExportAssetPaths(outputDir)) {
		try {
			await readFile(path.join(outputDir, assetPath));
		} catch (cause) {
			throw new Error(`Missing or unreadable export asset: ${assetPath}`, { cause });
		}
	}
	const selectablePackages = [];
	for (const source of await selectableRuntimeNoticeInputs())
		selectablePackages.push((await readPackageNotice(source)).name);
	const manifest = await readViewerManifest(outputDir);
	assertRuntimeLegalInputs(manifest, viewerManifestAssetPaths(manifest), selectablePackages);
	for (const specifier of IMAGE_CODEC_ASSETS) {
		const assetPath = `image-codecs/${path.basename(specifier)}`;
		try {
			await WebAssembly.compile(await readFile(path.join(outputDir, assetPath)));
		} catch (cause) {
			throw new Error(`Invalid image codec export asset: ${assetPath}`, { cause });
		}
	}
}
