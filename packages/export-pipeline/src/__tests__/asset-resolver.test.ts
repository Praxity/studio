import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRootLocalAssetUrl, resolveAssets } from "../asset-resolver";

describe("resolveAssets root-local paths", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("rewrites every shared asset field while preserving external URLs and embed src", async () => {
		const assetsDir = await mkdtemp(path.join(os.tmpdir(), "praxity-assets-"));
		tempDirs.push(assetsDir);
		const pages = [
			{
				id: "page",
				title: "Assets",
				data: {
					cornerImage: "none",
					styles: { decorated: { cornerImage: "/assets/corners.png?v=1#crop" } },
				},
				blocks: [
					{
						id: "media",
						type: "image",
						data: {
							src: "/assets/image.webp",
							backgroundImage: "/assets/background.webp",
							posterSrc: "/assets/poster.webp",
							poster: "/assets/legacy-poster.webp",
							url: "/assets/guide.pdf",
							nested: { audioSrc: "/assets/audio.mp3", image: "//cdn.test/x.webp" },
						},
					},
					{
						id: "embed",
						type: "embed",
						data: {
							src: "https://video.test/embed/1",
							posterSrc: "/assets/embed-poster.webp",
							imageSrc: "//cdn.test/embed.webp",
						},
					},
				],
			},
		] as PraxityPage[];

		const result = await resolveAssets(pages, { assetsDir });
		expect(result[0].data).toEqual({
			cornerImage: "none",
			styles: { decorated: { cornerImage: "./assets/corners.png?v=1#crop" } },
		});
		expect(pages[0].data?.styles).toEqual({
			decorated: { cornerImage: "/assets/corners.png?v=1#crop" },
		});
		const media = result[0].blocks[0].data as Record<string, unknown>;
		const nested = media.nested as Record<string, string>;
		const embed = result[0].blocks[1].data as Record<string, string>;

		expect(media.src).toBe("./assets/image.webp");
		expect(media.backgroundImage).toBe("./assets/background.webp");
		expect(media.posterSrc).toBe("./assets/poster.webp");
		expect(media.poster).toBe("./assets/legacy-poster.webp");
		expect(media.url).toBe("./assets/guide.pdf");
		expect(nested.audioSrc).toBe("./assets/audio.mp3");
		expect(nested.image).toBe("//cdn.test/x.webp");
		expect(embed.src).toBe("https://video.test/embed/1");
		expect(embed.posterSrc).toBe("./assets/embed-poster.webp");
		expect(embed.imageSrc).toBe("//cdn.test/embed.webp");
		expect(normalizeRootLocalAssetUrl("https://cdn.test/x.webp")).toBeUndefined();
	});
});
