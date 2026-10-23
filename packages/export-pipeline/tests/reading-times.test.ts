import { estimateBlockTime } from "@praxity/shared-blocks/content-density";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { publishedReadingTimes } from "../src/html-gen";

function block(type: PraxityBlock["type"], data: PraxityBlock["data"]): PraxityBlock {
	return { id: "block", type, data };
}
describe("published reading times", () => {
	it("keeps empty pages at zero and the empty course at one minute", () => {
		expect(publishedReadingTimes([])).toEqual({ pageMinutes: [], courseMinutes: 1 });
		expect(publishedReadingTimes([{ blocks: [] }])).toEqual({ pageMinutes: [0], courseMinutes: 1 });
	});
	it("uses 180 WPM and literal media estimates", () => {
		const words = block("text", { content: "word ".repeat(360) });
		const video = block("video", { duration: 120 });
		expect(estimateBlockTime(words, { readingSpeed: 180 })).toBe(2);
		expect(estimateBlockTime(video, { readingSpeed: 180 })).toBe(2.2);
		expect(publishedReadingTimes([{ blocks: [words] }, { blocks: [video] }])).toEqual({
			pageMinutes: [2, 2],
			courseMinutes: 4,
		});
	});
	it("rounds raw estimates for the course independently of page minimums", () => {
		const short = block("text", { content: "Two words" });
		expect(publishedReadingTimes([{ blocks: [short] }, { blocks: [short] }])).toEqual({
			pageMinutes: [1, 1],
			courseMinutes: 1,
		});
	});
	it("retains mixed media, text and zero-time pages", () => {
		expect(
			publishedReadingTimes([
				{ blocks: [] },
				{ blocks: [block("text", { content: "word ".repeat(360) })] },
				{ blocks: [block("video", { duration: 120 }), block("audio", { duration: 30 })] },
				{ blocks: [block("divider", {})] },
			]),
		).toEqual({ pageMinutes: [0, 2, 3, 0], courseMinutes: 5 });
	});
});
