import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageResultCache } from "../image-result-cache.ts";
import { optimizeImage } from "../optimize-image.ts";
import { optimizeResolvedImages as runOptimization } from "../optimize-resolved-images.ts";

vi.mock("../optimize-image.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../optimize-image.ts")>()),
	optimizeImage: vi.fn(),
}));

describe("resolved image optimization", () => {
	let tempDir: string;
	let assetsDir: string;
	function optimizeResolvedImages(...args: Parameters<typeof runOptimization>) {
		return runOptimization(
			args[0],
			args[1],
			args[2],
			args[3],
			args[4],
			new ImageResultCache({ directory: path.join(tempDir, "cache") }),
		);
	}

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "praxity-image-derivatives-"));
		assetsDir = path.join(tempDir, "public", "assets");
		await mkdir(assetsDir, { recursive: true });
		vi.mocked(optimizeImage).mockReset();
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("rewrites nested, page, style, poster, and logo references once per content", async () => {
		const source = Buffer.alloc(512, 7);
		const names = [
			"nested.png",
			"duplicate.jpg",
			"background.png",
			"poster.png",
			"corner.png",
			"logo.png",
		];
		for (const name of names) await writeFile(path.join(assetsDir, name), source);
		const authored = path.join(tempDir, "author-original.png");
		await writeFile(authored, source);
		vi.mocked(optimizeImage).mockResolvedValue(Uint8Array.of(82, 73, 70, 70, 87, 69, 66, 80));
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Images",
				data: { backgroundImage: "assets/background.png" },
				blocks: [
					{
						id: "cards",
						type: "card",
						data: {
							cards: [
								{ imageSrc: "assets/nested.png?size=wide#hero" },
								{ imageSrc: "assets/duplicate.jpg" },
							],
						},
					},
					{ id: "video", type: "video", data: { posterSrc: "assets/poster.png#frame" } },
				],
			},
		];
		const styleCarrier: PraxityPage = {
			id: "styles",
			title: "",
			blocks: [],
			data: { styles: { named: { cornerImage: "assets/corner.png?v=1" } } },
		};
		const before = structuredClone(pages);

		const result = await optimizeResolvedImages(pages, styleCarrier, assetsDir, {
			localPath: "assets/logo.png",
			placement: "header",
		});
		const derivative = result.rewrites.get("assets/nested.png");
		expect(derivative).toMatch(/^assets\/__praxity-[a-f0-9]{24}\.webp$/);
		expect(new Set(result.rewrites.values())).toEqual(new Set([derivative]));
		expect(optimizeImage).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(result.pages)).toContain(`${derivative}?size=wide#hero`);
		expect(JSON.stringify(result.pages)).toContain(`${derivative}#frame`);
		expect(JSON.stringify(result.styleCarrier)).toContain(`${derivative}?v=1`);
		expect(result.brandLogo?.localPath).toBe(derivative);
		expect(await readFile(path.join(assetsDir, path.basename(derivative ?? "")))).toHaveLength(8);
		for (const name of names) expect(await readFile(path.join(assetsDir, name))).toEqual(source);
		expect(await readFile(authored)).toEqual(source);
		expect(pages).toEqual(before);
	});

	it("keeps originals used in raw content or CSS, and leaves unsupported files alone", async () => {
		const opaque = Buffer.alloc(512, 4);
		const unsupported = Buffer.alloc(512, 5);
		await writeFile(path.join(assetsDir, "raw.png"), opaque);
		await writeFile(path.join(assetsDir, "css.png"), opaque);
		await writeFile(path.join(assetsDir, "unsupported.png"), unsupported);
		vi.mocked(optimizeImage).mockImplementation(async (bytes) =>
			bytes[0] === 4 ? Uint8Array.of(1, 2, 3) : undefined,
		);
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "References",
				data: { css: "background: url(assets/css.png)" },
				blocks: [
					{
						id: "raw",
						type: "text",
						data: { content: '<img src="&#97;ssets/raw.png">', imageSrc: "assets/raw.png" },
					},
					{ id: "css", type: "image", data: { src: "assets/css.png" } },
					{ id: "bad", type: "image", data: { src: "assets/unsupported.png" } },
				],
			},
		];
		const result = await optimizeResolvedImages(
			pages,
			{ id: "styles", title: "", blocks: [] },
			assetsDir,
		);
		expect(result.rewrites.size).toBe(2);
		expect(JSON.stringify(result.pages)).toContain("&#97;ssets/raw.png");
		expect(JSON.stringify(result.pages)).toContain("assets/unsupported.png");
		expect(await readFile(path.join(assetsDir, "raw.png"))).toEqual(opaque);
		expect(await readFile(path.join(assetsDir, "css.png"))).toEqual(opaque);
		expect(await readFile(path.join(assetsDir, "unsupported.png"))).toEqual(unsupported);
	});

	it("skips escaping paths, outside symlinks, and derivatives that grow", async () => {
		const original = Buffer.alloc(512, 9);
		await writeFile(path.join(assetsDir, "grows.png"), original);
		await writeFile(path.join(tempDir, "outside.png"), original);
		await symlink(path.join(tempDir, "outside.png"), path.join(assetsDir, "link.png"));
		vi.mocked(optimizeImage).mockResolvedValue(Buffer.alloc(513, 1));
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Unsafe paths",
				blocks: [
					{ id: "grows", type: "image", data: { src: "assets/grows.png" } },
					{ id: "escape", type: "image", data: { src: "assets/../outside.png" } },
					{ id: "link", type: "image", data: { src: "assets/link.png" } },
				],
			},
		];
		const result = await optimizeResolvedImages(
			pages,
			{ id: "styles", title: "", blocks: [] },
			assetsDir,
		);
		expect(result.rewrites.size).toBe(0);
		expect(optimizeImage).toHaveBeenCalledTimes(1);
		expect(await readFile(path.join(assetsDir, "grows.png"))).toEqual(original);
		expect(await readFile(path.join(tempDir, "outside.png"))).toEqual(original);
	});

	it("a second build reads the persistent derivative without calling the encoder", async () => {
		await writeFile(path.join(assetsDir, "hero.png"), Buffer.alloc(512, 7));
		const fresh = Uint8Array.of(1, 2, 3);
		vi.mocked(optimizeImage).mockResolvedValue(fresh);
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Image",
				blocks: [{ id: "hero", type: "image", data: { src: "assets/hero.png" } }],
			},
		];
		const carrier: PraxityPage = { id: "styles", title: "", blocks: [] };
		const first = await optimizeResolvedImages(pages, carrier, assetsDir);
		const second = await optimizeResolvedImages(pages, carrier, assetsDir);
		expect(second.rewrites).toEqual(first.rewrites);
		expect(optimizeImage).toHaveBeenCalledTimes(1);
		const derivative = second.rewrites.get("assets/hero.png");
		expect(await readFile(path.join(assetsDir, path.basename(derivative ?? "")))).toEqual(
			Buffer.from(fresh),
		);
	});

	it("allows asset-free courses without an assets directory", async () => {
		await rm(assetsDir, { recursive: true });
		const pages: PraxityPage[] = [{ id: "page", title: "Text", blocks: [] }];
		const styleCarrier: PraxityPage = { id: "styles", title: "", blocks: [] };
		expect(await optimizeResolvedImages(pages, styleCarrier, assetsDir)).toEqual({
			pages,
			styleCarrier,
			brandLogo: undefined,
			rewrites: new Map(),
		});
	});
});
