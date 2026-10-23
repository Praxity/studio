import { describe, expect, it } from "vitest";
import { countDialogueWords, estimateBlockTime } from "./content-density";
import type { PraxityBlock } from "./types";

describe("dialogue content density", () => {
	it("counts the visible dialogue words as reading time", () => {
		const block = {
			id: "d1",
			type: "dialogue",
			data: {
				caption: "A meeting",
				turns: [
					{
						id: "item-0",
						speaker: "alex",
						name: "Alex",
						paragraphs: ["Hello <em>there</em>", "Again"],
					},
				],
			},
		} as PraxityBlock;
		expect(countDialogueWords(block.data)).toBe(6);
		expect(estimateBlockTime(block, { readingSpeed: 180 })).toBeCloseTo(0.03333333333333333);
	});
	it("counts displayed markdown and omits delivery cues", () => {
		const block = {
			id: "d2",
			type: "dialogue",
			data: {
				caption: "A *quick* [warm] talk",
				turns: [{ speaker: "alex", paragraphs: ["[warm] Hello **there**", "[sighs] Again"] }],
			},
		} as PraxityBlock;
		expect(countDialogueWords(block.data)).toBe(8);
	});
});
