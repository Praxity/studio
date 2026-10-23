import { describe, expect, it } from "vitest";
import { readLesson } from "../src/read-lesson";
import { tokenizeInline } from "../src/v4/inline";
import { tokenizeLesson } from "../src/v4/lex";

describe("grammar punctuation escaping", () => {
	it.each([
		['\\"', '"'],
		["\\%", "%"],
		["\\&", "&"],
		["\\'", "'"],
		["\\,", ","],
		["\\<", "<"],
		["\\^", "^"],
		["\\q", "\\q"],
		["\\", "\\"],
		["\\\\", "\\"],
		["\\*\\[\\{\\@", "*[{@"],
	])("decodes %s after retaining exact inline bounds", (source, value) => {
		expect(tokenizeInline(source)).toEqual({
			source,
			start: 0,
			end: source.length,
			children: [{ kind: "text", start: 0, end: source.length, raw: source, value }],
		});
	});
	it("does not decode a punctuation character outside the inline range", () => {
		expect(tokenizeInline("a\\%b", { start: 1, end: 2 })).toEqual({
			source: "a\\%b",
			start: 1,
			end: 2,
			children: [{ kind: "text", start: 1, end: 2, raw: "\\", value: "\\" }],
		});
	});
	it("shields code contents from punctuation decoding", () => {
		expect(tokenizeInline("`\\%\\<\\q`").children).toEqual([
			{
				kind: "code",
				start: 0,
				end: 8,
				raw: "`\\%\\<\\q`",
				content: { start: 1, end: 7, raw: "\\%\\<\\q", value: "\\%\\<\\q" },
			},
		]);
	});
	it("retains every saved-source byte in lexical spans and admitted source", () => {
		const source = "# Cafe\u0301\\%\r\nBody \\& `\\<`\\q\r\n";
		expect(
			tokenizeLesson(source)
				.tokens.map((token) => token.raw)
				.join(""),
		).toBe(source);
		expect(readLesson(source).tree.stream.source).toBe(source);
	});
});
