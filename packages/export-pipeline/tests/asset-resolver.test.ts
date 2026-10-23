import os from "node:os";
import path from "node:path";
import type { BlockType } from "@praxity/shared-blocks";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AssetResolverOptions, resolveAssets } from "../src/asset-resolver";

// Mock fetch globally
const originalFetch = globalThis.fetch;

function mockFetchSuccess(content = "fake-image-data") {
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok: true,
		arrayBuffer: () => Promise.resolve(Buffer.from(content)),
	}) as unknown as typeof fetch;
}

function mockFetchFailure() {
	globalThis.fetch = vi
		.fn()
		.mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
}

describe("resolveAssets", () => {
	let tmpDir: string;
	let assetsDir: string;
	let options: AssetResolverOptions;

	beforeEach(async () => {
		tmpDir = (await fs.mkdtemp(path.join(os.tmpdir(), "assets-"))) as string;
		assetsDir = path.join(tmpDir, "assets");
		options = { assetsDir, basePath: "./assets/" };
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		await fs.remove(tmpDir);
	});

	it("downloads remote image and rewrites URL", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/photo.jpg",
							alt: "Test",
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);

		expect(result[0].blocks[0].data.src).toMatch(/^\.\/assets\/[a-f0-9]+-photo\.jpg$/);
		expect(globalThis.fetch).toHaveBeenCalledWith("https://cdn.example.com/photo.jpg");

		// Verify file was written
		const files = await fs.readdir(assetsDir);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/^[a-f0-9]+-photo\.jpg$/);
	});

	it("downloads and rewrites page title narration assets", async () => {
		mockFetchSuccess("narration-asset-data");
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "pb1",
						type: "pageBreak" as const,
						data: {
							narrationAudio: "https://cdn.example.com/n.mp3",
							narrationTimings: "https://cdn.example.com/n.vtt",
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);
		const pageBreakData = result[0].blocks[0].data;

		expect(pageBreakData.narrationAudio).toMatch(/^\.\/assets\/[a-f0-9]+-n\.mp3$/);
		expect(pageBreakData.narrationTimings).toMatch(/^\.\/assets\/[a-f0-9]+-n\.vtt$/);
		expect(await fs.readdir(assetsDir)).toHaveLength(2);
	});

	it("deduplicates identical URLs", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/photo.jpg",
							alt: "Test 1",
						},
					},
					{
						id: "b2",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/photo.jpg",
							alt: "Test 2",
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);

		// Both should have the same rewritten URL
		expect(result[0].blocks[0].data.src).toBe(result[0].blocks[1].data.src);
		// Fetch should only be called once
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("handles download failure gracefully with placeholder", async () => {
		mockFetchFailure();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/broken.jpg",
							alt: "Broken",
						},
					},
				],
			},
		];

		// Should not throw
		const result = await resolveAssets(pages, options);

		// Should use placeholder
		expect(result[0].blocks[0].data.src).toBe("./assets/placeholder.png");

		// Placeholder file should exist
		expect(await fs.pathExists(path.join(assetsDir, "placeholder.png"))).toBe(true);
	});

	it("ignores non-remote URLs (relative paths)", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "image" as const,
						data: { src: "/local/image.jpg", alt: "Local" },
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);

		// URL should not be changed
		expect(result[0].blocks[0].data.src).toBe("/local/image.jpg");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("handles nested data structures (e.g., hotgraphic pins)", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "hotgraphic" as BlockType,
						data: {
							imageSrc: "https://cdn.example.com/bg.jpg",
							pins: [
								{
									imageSrc: "https://cdn.example.com/pin1.jpg",
									title: "Pin 1",
								},
								{
									imageSrc: "https://cdn.example.com/pin2.jpg",
									title: "Pin 2",
								},
							],
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);
		const data = result[0].blocks[0].data;

		expect(data.imageSrc).toMatch(/^\.\/assets\/[a-f0-9]+-bg\.jpg$/);
		expect((data.pins as Array<{ imageSrc: string }>)[0].imageSrc).toMatch(
			/^\.\/assets\/[a-f0-9]+-pin1\.jpg$/,
		);
		expect((data.pins as Array<{ imageSrc: string }>)[1].imageSrc).toMatch(
			/^\.\/assets\/[a-f0-9]+-pin2\.jpg$/,
		);
	});

	it("preserves non-asset data fields unchanged", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "text" as const,
						data: {
							content: "<p>Hello world</p>",
							alignment: "center",
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);

		expect(result[0].blocks[0].data.content).toBe("<p>Hello world</p>");
		expect(result[0].blocks[0].data.alignment).toBe("center");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("returns empty array for empty pages", async () => {
		const result = await resolveAssets([], options);
		expect(result).toEqual([]);
	});

	it("handles blocks with no asset fields", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "divider" as const,
						data: {},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);
		expect(result[0].blocks[0].data).toEqual({});
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("resolves 'image' field in nested assessment response (hotspot)", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "assessment" as BlockType,
						data: {
							assessmentType: "hotspot",
							response: {
								type: "hotspot",
								image: "https://cdn.example.com/hotspot-bg.jpg",
								imageAlt: "Background",
								mode: "select",
								hotspots: [],
							},
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);
		const response = result[0].blocks[0].data.response as { image: string };

		expect(response.image).toMatch(/^\.\/assets\/[a-f0-9]+-hotspot-bg\.jpg$/);
		expect(globalThis.fetch).toHaveBeenCalledWith("https://cdn.example.com/hotspot-bg.jpg");
	});

	it("resolves 'image' field in choice response options", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "assessment" as BlockType,
						data: {
							assessmentType: "choice",
							response: {
								type: "choice",
								selectionMode: "single",
								options: [
									{
										id: "o1",
										text: "Option A",
										image: "https://cdn.example.com/opt-a.jpg",
									},
									{
										id: "o2",
										text: "Option B",
										image: "https://cdn.example.com/opt-b.jpg",
									},
								],
							},
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);
		const response = result[0].blocks[0].data.response as {
			options: Array<{ image: string }>;
		};

		expect(response.options[0].image).toMatch(/^\.\/assets\/[a-f0-9]+-opt-a\.jpg$/);
		expect(response.options[1].image).toMatch(/^\.\/assets\/[a-f0-9]+-opt-b\.jpg$/);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it("resolves 'url' field in document blocks", async () => {
		mockFetchSuccess();
		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "document" as BlockType,
						data: {
							url: "https://cdn.example.com/doc.pdf",
							title: "Handbook",
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);

		expect(result[0].blocks[0].data.url).toMatch(/^\.\/assets\/[a-f0-9]+-doc\.pdf$/);
		expect(globalThis.fetch).toHaveBeenCalledWith("https://cdn.example.com/doc.pdf");
	});

	it("downloads multiple unique assets in parallel", async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			return Promise.resolve({
				ok: true,
				arrayBuffer: () => Promise.resolve(Buffer.from(`data-${callCount}`)),
			});
		}) as unknown as typeof fetch;

		const pages = [
			{
				id: "p1",
				title: "Page 1",
				blocks: [
					{
						id: "b1",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/a.jpg",
							alt: "A",
						},
					},
					{
						id: "b2",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/b.jpg",
							alt: "B",
						},
					},
					{
						id: "b3",
						type: "image" as const,
						data: {
							src: "https://cdn.example.com/c.jpg",
							alt: "C",
						},
					},
				],
			},
		];

		const result = await resolveAssets(pages, options);

		expect(globalThis.fetch).toHaveBeenCalledTimes(3);
		const files = await fs.readdir(assetsDir);
		expect(files).toHaveLength(3);

		// Each block should have a unique rewritten URL
		const urls = result[0].blocks.map((b) => b.data.src);
		expect(new Set(urls).size).toBe(3);
	});
});
