import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it } from "vitest";
import { preparePublishedImages, readImageDimensions } from "../published-images.ts";

function png(width: number, height: number): Uint8Array {
	const bytes = Buffer.alloc(24);
	Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

describe("published image metadata", () => {
	let tempDir = "";

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
	});

	it("reads dimensions from common raster headers", () => {
		const gif = Buffer.from("GIF89a0000", "binary");
		gif.writeUInt16LE(320, 6);
		gif.writeUInt16LE(180, 8);
		const jpeg = Buffer.from([
			0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x80, 0x03, 0xc0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			0,
		]);
		const webp = Buffer.alloc(30);
		webp.write("RIFF", 0);
		webp.write("WEBP", 8);
		webp.write("VP8X", 12);
		webp.writeUIntLE(799, 24, 3);
		webp.writeUIntLE(449, 27, 3);

		expect(readImageDimensions(png(1200, 675))).toEqual({ width: 1200, height: 675 });
		expect(readImageDimensions(gif)).toEqual({ width: 320, height: 180 });
		expect(readImageDimensions(jpeg)).toEqual({ width: 960, height: 640 });
		expect(readImageDimensions(webp)).toEqual({ width: 800, height: 450 });
	});

	it("reads SVG dimensions without assigning percentages as pixels", () => {
		expect(
			readImageDimensions(
				Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"></svg>'),
			),
		).toEqual({ width: 1200, height: 675 });
		expect(
			readImageDimensions(Buffer.from('<svg width="100%" viewBox="0 0 640 360"></svg>')),
		).toEqual({ width: 640, height: 360 });
	});

	it("sizes nested images and prioritizes only the first image on each page", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "first.png"), png(1200, 675));
		await writeFile(path.join(tempDir, "second.png"), png(640, 480));
		const nestedImages: PraxityBlock[] = [
			{ id: "first", type: "image", data: { src: "assets/first.png" } },
			{ id: "second", type: "image", data: { src: "assets/second.png" } },
		];
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Images",
				blocks: [{ id: "columns", type: "columns", data: { items: [{ children: nestedImages }] } }],
			},
		];

		const [page] = await preparePublishedImages(pages, tempDir);
		const items = ((page.blocks[0].data as { items: Array<{ children: PraxityBlock[] }> }).items[0]
			.children ?? []) as PraxityBlock[];
		expect(items[0].data).toMatchObject({
			intrinsicWidth: 1200,
			intrinsicHeight: 675,
			loading: "eager",
			fetchPriority: "high",
		});
		expect(items[1].data).toMatchObject({
			intrinsicWidth: 640,
			intrinsicHeight: 480,
			loading: "lazy",
		});
	});

	it("prioritizes only the opening slide image of each module document", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "image.png"), png(1200, 675));
		const pages: PraxityPage[] = [
			{
				id: "slide-1",
				lessonId: "module-1",
				title: "First",
				blocks: [{ id: "image-1", type: "image", data: { src: "assets/image.png" } }],
			},
			{
				id: "slide-2",
				lessonId: "module-1",
				title: "Second",
				blocks: [{ id: "image-2", type: "image", data: { src: "assets/image.png" } }],
			},
			{
				id: "slide-3",
				lessonId: "module-2",
				title: "Third",
				blocks: [{ id: "image-3", type: "image", data: { src: "assets/image.png" } }],
			},
		];
		const result = await preparePublishedImages(pages, tempDir, true);
		expect(result.map((page) => page.blocks[0].data)).toEqual([
			expect.objectContaining({
				intrinsicWidth: 1200,
				intrinsicHeight: 675,
				loading: "eager",
				fetchPriority: "high",
			}),
			expect.objectContaining({ intrinsicWidth: 1200, intrinsicHeight: 675, loading: "lazy" }),
			expect.objectContaining({
				intrinsicWidth: 1200,
				intrinsicHeight: 675,
				loading: "eager",
				fetchPriority: "high",
			}),
		]);
		expect(result[1].blocks[0].data).not.toHaveProperty("fetchPriority");
	});

	it("keeps explicit image loading choices", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "image.png"), png(800, 450));
		const pages: PraxityPage[] = [
			{
				id: "first",
				lessonId: "module",
				title: "First",
				blocks: [
					{ id: "image-1", type: "image", data: { src: "assets/image.png", loading: "lazy" } },
				],
			},
			{
				id: "second",
				lessonId: "module",
				title: "Second",
				blocks: [
					{
						id: "image-2",
						type: "image",
						data: { src: "assets/image.png", loading: "eager", fetchPriority: "high" },
					},
				],
			},
		];
		const result = await preparePublishedImages(pages, tempDir, true);
		expect(result[0].blocks[0].data).toMatchObject({
			loading: "lazy",
			intrinsicWidth: 800,
			intrinsicHeight: 450,
		});
		expect(result[0].blocks[0].data).not.toHaveProperty("fetchPriority");
		expect(result[1].blocks[0].data).toMatchObject({ loading: "eager", fetchPriority: "high" });
	});

	it("reserves space and loading priority for hero-cover images", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "hero.png"), png(1600, 900));
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Hero",
				blocks: [
					{
						id: "hero",
						type: "heroCover",
						data: { imageSrc: "assets/hero.png", imageAlt: "", title: "Welcome" },
					},
				],
			},
		];

		const [page] = await preparePublishedImages(pages, tempDir);
		expect(page.blocks[0].data).toMatchObject({
			intrinsicWidth: 1600,
			intrinsicHeight: 900,
			loading: "eager",
			fetchPriority: "high",
		});
	});

	it("does not let an empty image consume the page loading priority", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "real.png"), png(800, 450));
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Images",
				blocks: [
					{ id: "empty", type: "image", data: { src: "" } },
					{ id: "real", type: "image", data: { src: "assets/real.png" } },
				],
			},
		];

		const [page] = await preparePublishedImages(pages, tempDir);
		expect(page.blocks[1].data).toMatchObject({
			intrinsicWidth: 800,
			intrinsicHeight: 450,
			loading: "eager",
			fetchPriority: "high",
		});
	});

	it("sizes both images inside an image comparison", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "before.png"), png(1200, 800));
		await writeFile(path.join(tempDir, "after.png"), png(900, 600));
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Comparison",
				blocks: [
					{
						id: "comparison",
						type: "imageComparison",
						data: {
							display: "slider",
							beforeImage: { src: "assets/before.png", altText: "Before" },
							afterImage: { src: "assets/after.png", altText: "After" },
						},
					} as PraxityBlock,
				],
			},
		];

		const [page] = await preparePublishedImages(pages, tempDir);
		const comparison = page.blocks[0].data as unknown as {
			beforeImage: Record<string, unknown>;
			afterImage: Record<string, unknown>;
		};
		expect(comparison.beforeImage).toMatchObject({
			intrinsicWidth: 1200,
			intrinsicHeight: 800,
			loading: "eager",
			fetchPriority: "high",
		});
		expect(comparison.afterImage).toMatchObject({
			intrinsicWidth: 900,
			intrinsicHeight: 600,
			loading: "lazy",
		});
	});

	it("reserves space for a labeled graphic image", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "published-images-"));
		await writeFile(path.join(tempDir, "diagram.png"), png(1000, 625));
		const pages: PraxityPage[] = [
			{
				id: "page",
				title: "Diagram",
				blocks: [
					{
						id: "diagram",
						type: "labeledGraphic",
						data: {
							imageSrc: "assets/diagram.png",
							imageAlt: "A diagram",
							labels: [],
						},
					} as PraxityBlock,
				],
			},
		];

		const [page] = await preparePublishedImages(pages, tempDir);
		expect(page.blocks[0].data).toMatchObject({
			intrinsicWidth: 1000,
			intrinsicHeight: 625,
			loading: "eager",
			fetchPriority: "high",
		});
	});
});
