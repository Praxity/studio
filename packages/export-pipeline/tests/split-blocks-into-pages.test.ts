import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { describe, expect, it } from "vitest";

describe("splitBlocksIntoPages", () => {
	it("attaches pageBreak params to the following page", () => {
		const blocks: PraxityBlock[] = [
			{ id: "t1", type: "text", data: { content: "intro" } },
			{
				id: "pb1",
				type: "pageBreak",
				data: {
					title: "Lens",
					narration: "audio/s2.mp3",
					style: "scenario",
				},
			},
			{ id: "t2", type: "text", data: { content: "body" } },
		];

		const pages = splitBlocksIntoPages(blocks, "Course");

		expect(pages[0].data).toEqual({});
		expect(pages[1].data).toMatchObject({
			title: "Lens",
			narration: "audio/s2.mp3",
			style: "scenario",
		});
	});

	it("uses an authored heading as the fallback navigation label", () => {
		const blocks: PraxityBlock[] = [
			{ id: "h1", type: "heading", data: { content: "Résumé & next steps" } },
		];
		const pages = splitBlocksIntoPages(blocks, "Course", {
			narration: "assets/intro.mp3",
			captions: "assets/intro.vtt",
		});

		expect(pages[0]).toMatchObject({
			title: "Résumé & next steps",
			slug: "resume-and-next-steps",
			data: { narration: "assets/intro.mp3", captions: "assets/intro.vtt" },
		});
	});
});
