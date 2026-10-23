import crypto from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { traverseAssetGraph } from "@praxity/shared-blocks/asset-graph";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import fs from "fs-extra";
import type { CourseConfig } from "./html-gen.ts";
import { defaultImageResultCache, type ImageResultCache } from "./image-result-cache.ts";

type BrandLogo = CourseConfig["brandLogo"];

/** Rewrite compiler-owned local assets, leaving authored bytes and paths alone. */
export async function optimizeResolvedImages(
	pages: PraxityPage[],
	styleCarrier: PraxityPage,
	assetsDir: string,
	brandLogo?: BrandLogo,
	codecDir?: string,
	imageCache: ImageResultCache = defaultImageResultCache,
): Promise<{
	pages: PraxityPage[];
	styleCarrier: PraxityPage;
	brandLogo: BrandLogo;
	rewrites: Map<string, string>;
}> {
	const paths = new Set<string>();
	const assetPath = (url: string): string | undefined => {
		const bare = url.split(/[?#]/, 1)[0].replace(/^\.\//, "");
		if (
			!/^assets\/.+\.(?:png|jpe?g)$/i.test(bare) ||
			bare.includes("\\") ||
			bare.includes("\0") ||
			bare.includes("%") ||
			path.posix.normalize(bare) !== bare
		)
			return undefined;
		return bare;
	};
	const collect = (url: string) => {
		const bare = assetPath(url);
		if (bare) paths.add(bare);
	};
	await traverseAssetGraph([...pages, styleCarrier], { onAsset: ({ value }) => collect(value) });
	if (brandLogo?.localPath) collect(brandLogo.localPath);
	if (brandLogo?.darkLocalPath) collect(brandLogo.darkLocalPath);

	const rewrites = new Map<string, string>();
	if (paths.size === 0 || !(await fs.pathExists(assetsDir))) {
		return { pages, styleCarrier, brandLogo, rewrites };
	}
	const assetsRoot = await realpath(assetsDir);
	const byContent = new Map<string, string | undefined>();
	for (const original of paths) {
		const file = path.join(assetsDir, original.slice("assets/".length));
		try {
			const realFile = await realpath(file);
			const relative = path.relative(assetsRoot, realFile);
			if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
				continue;
			const stat = await fs.stat(realFile);
			if (!stat.isFile() || stat.size > 32 * 1024 * 1024) continue;
			const bytes = await fs.readFile(realFile);
			const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
			if (!byContent.has(sourceHash)) {
				let optimized: Uint8Array | undefined;
				try {
					optimized = await imageCache.optimize(bytes, codecDir);
				} catch {
					// Unsupported or corrupt source images keep their original bytes.
				}
				let next: string | undefined;
				if (optimized && optimized.length < bytes.length) {
					const hash = crypto.createHash("sha256").update(optimized).digest("hex").slice(0, 24);
					next = `assets/__praxity-${hash}.webp`;
					const output = path.join(assetsDir, path.basename(next));
					try {
						await fs.writeFile(output, optimized, { flag: "wx" });
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
						const outputStat = await fs.lstat(output);
						if (
							!outputStat.isFile() ||
							!Buffer.from(await fs.readFile(output)).equals(Buffer.from(optimized))
						)
							next = undefined;
					}
				}
				byContent.set(sourceHash, next);
			}
			const next = byContent.get(sourceHash);
			if (next) rewrites.set(original, next);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	const rewrite = (url: string): string | undefined => {
		const bare = assetPath(url);
		const next = bare && rewrites.get(bare);
		const suffixIndex = url.search(/[?#]/);
		return next ? `${next}${suffixIndex < 0 ? "" : url.slice(suffixIndex)}` : undefined;
	};
	const rewritten = await traverseAssetGraph([...pages, styleCarrier], {
		rewriteAsset: ({ value }) => rewrite(value),
	});
	const rewrittenLogo = brandLogo && {
		...brandLogo,
		localPath: rewrite(brandLogo.localPath) ?? brandLogo.localPath,
		darkLocalPath: brandLogo.darkLocalPath
			? (rewrite(brandLogo.darkLocalPath) ?? brandLogo.darkLocalPath)
			: undefined,
	};
	const rewrittenPages = rewritten.slice(0, -1);
	const rewrittenCarrier = rewritten.at(-1) ?? styleCarrier;
	return {
		pages: rewrittenPages,
		styleCarrier: rewrittenCarrier,
		brandLogo: rewrittenLogo,
		rewrites,
	};
}
