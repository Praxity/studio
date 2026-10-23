import { expect, it } from "vitest";
import { preserveTextWraps } from "../src/ranges.ts";

it.each([
	["A\r\nB\nC\rD\r\nE", "AAAB\nCD\nEEE", "AAAB\nCD\r\nEEE"],
	[
		"First\r\nSecond\nThird\rFourth",
		"Changed FirstSecond\nThirdFourth tail",
		"Changed FirstSecond\nThirdFourth tail",
	],
	["A\r\nB\nA\rC", "XA\nZ", "XA\r\nZ"],
	["A\r\nB\nC", "XB\nBZZ", "XB\r\nBZZ"],
])("C06a review keeps interior wraps across separate word edits: %j", (before, text, expected) => {
	expect(preserveTextWraps(text, before, "\n")).toBe(expected);
});
