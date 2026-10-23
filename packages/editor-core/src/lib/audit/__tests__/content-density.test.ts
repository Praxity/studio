import type { PraxityBlock } from "@praxity/shared-blocks";
import { countWordsInHtml, estimateBlockTime } from "@praxity/shared-blocks/content-density";
import { describe, expect, it } from "vitest";

const makeBlock = (
	type: PraxityBlock["type"],
	data: Record<string, unknown> = {},
): PraxityBlock => ({
	id: `block-${Math.random().toString(36).slice(2)}`,
	type,
	data,
});

const textBlock = (content: string): PraxityBlock =>
	makeBlock("text", { content: `<p>${content}</p>` });

const headingBlock = (content: string): PraxityBlock => makeBlock("heading", { content, level: 2 });
const pageBreakBlock = (): PraxityBlock => makeBlock("pageBreak");

// Generate a block with ~N words of text content
const textWithWords = (wordCount: number): PraxityBlock => {
	const words = Array.from({ length: wordCount }, (_, i) => `word${i}`).join(" ");
	return textBlock(words);
};

describe("countWordsInHtml", () => {
	it("counts words in plain text", () => {
		expect(countWordsInHtml("<p>Hello world foo bar</p>")).toBe(4);
	});

	it("handles nested elements", () => {
		expect(countWordsInHtml("<p>Hello <strong>world</strong> foo</p>")).toBe(3);
	});

	it("returns 0 for empty content", () => {
		expect(countWordsInHtml("")).toBe(0);
		expect(countWordsInHtml("<p></p>")).toBe(0);
	});

	it("returns 0 for undefined/null-like values", () => {
		expect(countWordsInHtml(undefined as unknown as string)).toBe(0);
	});

	it("handles whitespace-only content", () => {
		expect(countWordsInHtml("   ")).toBe(0);
		expect(countWordsInHtml("<p>   </p>")).toBe(0);
	});

	it("handles multiple paragraphs", () => {
		expect(countWordsInHtml("<p>Hello world</p><p>foo bar</p>")).toBe(4);
	});
});

describe("estimateBlockTime", () => {
	const config = { readingSpeed: 180 as const };

	it("estimates text block time based on word count", () => {
		// 180 words at 180 WPM = 1 minute
		const block = textWithWords(180);
		const time = estimateBlockTime(block, config);
		expect(time).toBeCloseTo(1, 1);
	});

	it("estimates heading block time based on word count", () => {
		const block = headingBlock("A Short Title");
		const time = estimateBlockTime(block, config);
		expect(time).toBeGreaterThan(0);
		expect(time).toBeLessThan(0.1);
	});

	it("estimates video block time with 10% buffer", () => {
		// 180 seconds default, * 1.1 / 60 = 3.3 minutes
		const block = makeBlock("video", { src: "https://example.com/video.mp4" });
		const time = estimateBlockTime(block, config);
		expect(time).toBeCloseTo(3.3, 1);
	});

	it("estimates video block with explicit duration", () => {
		const block = makeBlock("video", { src: "https://example.com/video.mp4", duration: 300 });
		const time = estimateBlockTime(block, config);
		expect(time).toBeCloseTo((300 * 1.1) / 60, 2);
	});

	it("estimates audio block time", () => {
		// 120 seconds default / 60 = 2 minutes
		const block = makeBlock("audio", { src: "https://example.com/audio.mp3" });
		const time = estimateBlockTime(block, config);
		expect(time).toBeCloseTo(2, 1);
	});

	it("estimates image block as 0.1 minutes", () => {
		const block = makeBlock("image", { src: "", altText: "", decorative: false });
		expect(estimateBlockTime(block, config)).toBe(0.1);
	});

	it("estimates imageComparison block as 0.25 minutes", () => {
		const block = makeBlock("imageComparison", {});
		expect(estimateBlockTime(block, config)).toBe(0.25);
	});

	it("estimates chart block as 0.5 minutes", () => {
		const block = makeBlock("chart", {});
		expect(estimateBlockTime(block, config)).toBe(0.5);
	});

	it("estimates table block based on row count", () => {
		const block = makeBlock("table", {
			rows: [
				["a", "b"],
				["c", "d"],
				["e", "f"],
			],
		});
		expect(estimateBlockTime(block, config)).toBeCloseTo(0.3, 1);
	});

	it("estimates table block with no rows as 0", () => {
		const block = makeBlock("table", { rows: [] });
		expect(estimateBlockTime(block, config)).toBe(0);
	});

	it("estimates card block based on item count", () => {
		const block = makeBlock("card", {
			items: [
				{ id: "1", front: "Q1", back: "A1" },
				{ id: "2", front: "Q2", back: "A2" },
			],
		});
		expect(estimateBlockTime(block, config)).toBeCloseTo(0.5, 1);
	});

	it("estimates accordion block based on item count", () => {
		const block = makeBlock("accordion", {
			items: [
				{ id: "1", label: "T1", children: [] },
				{ id: "2", label: "T2", children: [] },
				{ id: "3", label: "T3", children: [] },
				{ id: "4", label: "T4", children: [] },
			],
			trackCompletion: false,
		});
		expect(estimateBlockTime(block, config)).toBeCloseTo(1.0, 1);
	});

	it("estimates tabs block based on item count", () => {
		const block = makeBlock("tabs", {
			items: [{ id: "1", label: "T1", children: [] }],
			trackCompletion: false,
		});
		expect(estimateBlockTime(block, config)).toBeCloseTo(0.25, 1);
	});

	it("estimates checklist block based on item count", () => {
		const block = makeBlock("checklist", {
			items: [
				{ id: "1", text: "Item 1" },
				{ id: "2", text: "Item 2" },
			],
		});
		expect(estimateBlockTime(block, config)).toBeCloseTo(0.2, 1);
	});

	it("estimates embed block as 1.0 minutes", () => {
		const block = makeBlock("embed", { src: "https://example.com", title: "Embed" });
		expect(estimateBlockTime(block, config)).toBe(1.0);
	});

	it("estimates document block as 2.0 minutes", () => {
		const block = makeBlock("document", { url: "https://example.com/doc.pdf" });
		expect(estimateBlockTime(block, config)).toBe(2.0);
	});

	it("estimates assessment (choice) as 0.5 minutes", () => {
		const block = makeBlock("assessment", { assessmentType: "choice" });
		expect(estimateBlockTime(block, config)).toBe(0.5);
	});

	it("estimates assessment (textResponse) as 2.0 minutes", () => {
		const block = makeBlock("assessment", { assessmentType: "textResponse" });
		expect(estimateBlockTime(block, config)).toBe(2.0);
	});

	it("estimates assessment (audioRecording) as 2.0 minutes", () => {
		const block = makeBlock("assessment", { assessmentType: "audioRecording" });
		expect(estimateBlockTime(block, config)).toBe(2.0);
	});

	it("returns 0 for divider blocks", () => {
		const block = makeBlock("divider", { dividerType: "line" });
		expect(estimateBlockTime(block, config)).toBe(0);
	});

	it("returns 0 for pageBreak blocks", () => {
		const block = pageBreakBlock();
		expect(estimateBlockTime(block, config)).toBe(0);
	});

	it("returns 0 for logic blocks", () => {
		const block = makeBlock("logic", {});
		expect(estimateBlockTime(block, config)).toBe(0);
	});

	it("returns 0 for variable blocks", () => {
		const block = makeBlock("variable", {});
		expect(estimateBlockTime(block, config)).toBe(0);
	});

	it("estimates quote block using data.text field", () => {
		// 180 words at 180 WPM = 1 minute
		const words = Array.from({ length: 180 }, (_, i) => `word${i}`).join(" ");
		const block = makeBlock("quote", { text: words });
		const time = estimateBlockTime(block, config);
		expect(time).toBeCloseTo(1, 1);
	});

	it("estimates note block using title + content", () => {
		// 90 words title + 90 words content = 180 words at 180 WPM = 1 minute
		const half = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
		const block = makeBlock("note", {
			title: half,
			content: half,
			style: "outline",
			color: "accent",
		});
		const time = estimateBlockTime(block, config);
		expect(time).toBeCloseTo(1, 1);
	});

	it("uses readingSpeed from config", () => {
		const slowConfig = { readingSpeed: 150 as const };
		const fastConfig = { readingSpeed: 220 as const };
		const block = textWithWords(150);
		const slowTime = estimateBlockTime(block, slowConfig);
		const fastTime = estimateBlockTime(block, fastConfig);
		expect(slowTime).toBeCloseTo(1, 1); // 150/150 = 1 min
		expect(fastTime).toBeCloseTo(150 / 220, 2);
		expect(slowTime).toBeGreaterThan(fastTime);
	});
});
