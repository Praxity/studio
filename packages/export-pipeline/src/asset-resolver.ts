import crypto from "node:crypto";
import path from "node:path";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import fs from "fs-extra";

/** Simple concurrency limiter — replaces p-limit to avoid standalone dep issues. */
function pLimit(concurrency: number) {
	let active = 0;
	const queue: Array<() => void> = [];
	function next() {
		if (queue.length > 0 && active < concurrency) {
			active++;
			// biome-ignore lint/style/noNonNullAssertion: length checked above
			queue.shift()!();
		}
	}
	return <T>(fn: () => Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			queue.push(() =>
				fn()
					.then(resolve, reject)
					.finally(() => {
						active--;
						next();
					}),
			);
			next();
		});
}

export interface AssetResolverOptions {
	/** Directory to download assets into (e.g., tempDir/public/assets/) */
	assetsDir: string;
	/** Base path for URL rewriting (e.g., "./assets/" or "/assets/") */
	basePath?: string;
}

/** Rewrite authored `/assets/...` paths for packages served below an LMS root. */
export function normalizeRootLocalAssetUrl(
	value: string,
	basePath = "./assets/",
): string | undefined {
	if (!/^\/assets(?:\/|$)/.test(value)) return undefined;
	const relative = value.slice("/assets/".length);
	return `${basePath.endsWith("/") ? basePath : `${basePath}/`}${relative}`;
}

interface ResolvedAsset {
	originalUrl: string;
	localPath: string;
	relativePath: string;
}

/**
 * Resolve all remote assets in course pages.
 * Downloads each unique URL once and rewrites all references to local paths.
 */
export async function resolveAssets(
	pages: PraxityPage[],
	options: AssetResolverOptions,
): Promise<PraxityPage[]> {
	await fs.ensureDir(options.assetsDir);
	const basePath = options.basePath ?? "./assets/";

	// Collect all unique URLs
	const urlMap = new Map<string, string>(); // original URL -> local relative path

	// First pass: discover all URLs. Embed src is an iframe URL, but poster fields are assets.
	await traverseAssetGraph(pages, {
		onAsset: ({ block, key, value }) => {
			if (block.type === "embed" && key === "src") return;
			if (isRemoteUrl(value) && !urlMap.has(value)) {
				urlMap.set(value, "");
			}
		},
	});

	// Download all unique assets
	const limit = pLimit(8);
	const downloadPromises = [...urlMap.keys()].map((url) =>
		limit(async () => {
			try {
				const resolved = await downloadAsset(url, options.assetsDir, basePath);
				urlMap.set(url, resolved.relativePath);
			} catch (error) {
				// On failure: log warning, use placeholder
				console.warn(`Failed to download asset: ${url}`, error);
				urlMap.set(url, `${basePath}placeholder.png`);
			}
		}),
	);

	await Promise.all(downloadPromises);

	// Ensure placeholder exists if any downloads failed
	const hasPlaceholder = [...urlMap.values()].some((v) => v.includes("placeholder.png"));
	if (hasPlaceholder) {
		await createPlaceholder(options.assetsDir);
	}

	// Second pass: rewrite downloaded and root-local asset URLs.
	return traverseAssetGraph(pages, {
		rewriteAsset: ({ block, key, value }) => {
			if (block.type === "embed" && key === "src") return undefined;
			const local = normalizeRootLocalAssetUrl(value, basePath);
			if (local) return local;
			if (isRemoteUrl(value) && urlMap.has(value)) {
				return urlMap.get(value);
			}
			return undefined;
		},
	});
}

/**
 * RFC1918, loopback, and link-local IP patterns that must be blocked to prevent SSRF.
 */
const BLOCKED_HOSTNAME_PATTERN =
	/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1\])$/i;

/**
 * Hostnames that are embed/streaming services — their URLs should be kept
 * as-is (for iframe embeds) rather than downloaded as binary assets.
 */
const EMBED_HOSTNAMES = new Set([
	"youtube.com",
	"www.youtube.com",
	"youtu.be",
	"www.youtube-nocookie.com",
	"vimeo.com",
	"player.vimeo.com",
	"www.loom.com",
	"loom.com",
]);

function isEmbedUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return EMBED_HOSTNAMES.has(url.hostname);
	} catch {
		return false;
	}
}

export function isSafeRemoteUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return false;
		if (BLOCKED_HOSTNAME_PATTERN.test(url.hostname)) return false;
		return true;
	} catch {
		return false;
	}
}

function isRemoteUrl(value: unknown): value is string {
	if (typeof value !== "string") return false;
	if (!value.startsWith("http://") && !value.startsWith("https://")) return false;
	if (isEmbedUrl(value)) return false;
	return isSafeRemoteUrl(value);
}

async function downloadAsset(
	url: string,
	assetsDir: string,
	basePath: string,
): Promise<ResolvedAsset> {
	if (!isSafeRemoteUrl(url)) {
		throw new Error(`Blocked unsafe URL: ${url}`);
	}

	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	const buffer = Buffer.from(await response.arrayBuffer());

	const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
	const urlPath = new URL(url).pathname;
	const rawBasename = path.basename(urlPath) || "asset";
	const basename = rawBasename.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 64);

	const filename = `${hash}-${basename}`;
	const localPath = path.join(assetsDir, filename);
	await fs.writeFile(localPath, buffer);

	return { originalUrl: url, localPath, relativePath: `${basePath}${filename}` };
}

async function createPlaceholder(assetsDir: string): Promise<void> {
	const placeholderPath = path.join(assetsDir, "placeholder.png");
	if (await fs.pathExists(placeholderPath)) return;

	// Create a minimal 1x1 PNG (smallest valid PNG)
	const png = Buffer.from([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a, // PNG signature
		0x00,
		0x00,
		0x00,
		0x0d,
		0x49,
		0x48,
		0x44,
		0x52, // IHDR chunk
		0x00,
		0x00,
		0x00,
		0x01,
		0x00,
		0x00,
		0x00,
		0x01,
		0x08,
		0x02,
		0x00,
		0x00,
		0x00,
		0x90,
		0x77,
		0x53,
		0xde,
		0x00,
		0x00,
		0x00,
		0x0c,
		0x49,
		0x44,
		0x41, // IDAT chunk
		0x54,
		0x08,
		0xd7,
		0x63,
		0xf8,
		0xcf,
		0xc0,
		0x00,
		0x00,
		0x00,
		0x02,
		0x00,
		0x01,
		0xe2,
		0x21,
		0xbc,
		0x33,
		0x00,
		0x00,
		0x00,
		0x00,
		0x49,
		0x45,
		0x4e, // IEND chunk
		0x44,
		0xae,
		0x42,
		0x60,
		0x82,
	]);
	await fs.writeFile(placeholderPath, png);
}
