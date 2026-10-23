import { type FillBlankResponse, parseFillBlankContent } from "@praxity/content-model";
import { readLesson } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import { isFillBlankAnswerCorrect } from "../src/blocks/AssessmentBlock";
import { inlineMarkdown } from "../src/inline-markdown";

describe("formatting and fill-blank punctuation escaping", () => {
	it.each([
		['\\"', "\\&quot;", '\\"'],
		["\\%", "\\%", "\\%"],
		["\\&", "\\&amp;", "\\&"],
		["\\'", "\\'", "\\'"],
		["\\,", "\\,", "\\,"],
		["\\<", "\\&lt;", "\\<"],
		["\\^", "\\^", "\\^"],
	])("characterizes %s through both live content interfaces", (source, html, answer) => {
		expect(inlineMarkdown(source)).toBe(html);
		expect(parseFillBlankContent(`{${source}}`)).toEqual([{ answer }]);
		const blank = { id: "answer", ...parseFillBlankContent(`{${source}}`)[0] };
		expect(isFillBlankAnswerCorrect(answer, blank)).toBe(true);
		expect(isFillBlankAnswerCorrect("wrong", blank)).toBe(false);
	});
	it.each([
		['\\"', '\\"'],
		["\\%", "\\%"],
		["\\&", "\\&"],
		["\\'", "\\'"],
		["\\,", "\\,"],
		["\\<", "\\<"],
		["\\^", "\\^"],
	])("characterizes %s in dropdown choices and the admitted word bank", (source, answer) => {
		expect(parseFillBlankContent(`{*${source}|spare}`, "dropdown")).toEqual([
			{ answer, choices: [answer, "spare"] },
		]);
		const parsed = readLesson(
			`# Test\n\n::: fill-blank Choose {style=word-bank}\nbank: ${source} | spare\n\nPick {${source}}.\n:::\n`,
		);
		expect(parsed.diagnostics).toEqual([]);
		const assessment = parsed.blocks.find((block) => block.type === "assessment");
		expect(assessment).toBeDefined();
		const response = assessment?.data.response as FillBlankResponse;
		expect(response.type).toBe("fillBlank");
		expect(response.wordBank).toEqual([answer, "spare"]);
		expect(response.blanks[0].answer).toBe(answer);
	});
	it("keeps unknown escapes, a trailing backslash and shielded code literal", () => {
		expect(inlineMarkdown("\\q end\\")).toBe("\\q end\\");
		expect(inlineMarkdown("\\\\")).toBe("\\");
		expect(inlineMarkdown("\\*\\[\\{\\@")).toBe("*[{@");
		expect(inlineMarkdown("`\\%\\<\\q`")).toBe("<code>\\%\\&lt;\\q</code>");
		expect(parseFillBlankContent("{\\q}")).toEqual([{ answer: "\\q" }]);
		expect(parseFillBlankContent("{\\\\}")).toEqual([{ answer: "\\", answerSources: ["\\\\"] }]);
		expect(parseFillBlankContent("`{\\%}` \\{literal\\}")).toEqual([]);
	});
	it("decodes literal delimiters after finding typed and dropdown answer bounds", () => {
		expect(parseFillBlankContent("{left\\|right|\\{brace\\}}")).toEqual([
			{
				answer: "left|right",
				alternatives: ["{brace}"],
				answerSources: ["left\\|right", "\\{brace\\}"],
			},
		]);
		expect(parseFillBlankContent("{*left\\|right|wrong}", "dropdown")).toEqual([
			{
				answer: "left|right",
				choices: ["left|right", "wrong"],
			},
		]);
	});
	it("retains decomposed Unicode and escaped answer source", () => {
		expect(parseFillBlankContent("{Cafe\u0301\\*}")).toEqual([
			{
				answer: "Cafe\u0301*",
				answerSources: ["Cafe\u0301\\*"],
			},
		]);
		const blank = { id: "answer", answer: "Cafe\u0301*", answerSources: ["Cafe\u0301\\*"] };
		expect(isFillBlankAnswerCorrect("Caf\u00e9*", blank)).toBe(true);
		expect(isFillBlankAnswerCorrect("Caf\u00e9x", blank)).toBe(false);
	});
	it("retains malformed text and blank recovery", () => {
		expect(inlineMarkdown("`unfinished \\q")).toBe("`unfinished \\q");
		expect(parseFillBlankContent("{unfinished \\q")).toEqual([]);
	});
});
