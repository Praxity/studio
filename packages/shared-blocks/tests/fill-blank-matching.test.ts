import { describe, expect, it } from "vitest";
import { isFillBlankAnswerCorrect } from "../src/blocks/AssessmentBlock";

describe("fill-blank answer matching", () => {
	it.each([
		[" COLOR ", "colour", ["color"], true],
		["colourful", "colour", [], false],
		["colour", "color", ["~col*r"], true],
		["colr", "color", ["~col*r"], true],
		["cold", "color", ["~col?r"], false],
		["color", "other", ["~col?r"], true],
		["xcolor", "other", ["~col?r"], false],
		["a.b", "other", ["~a.b"], true],
		["axb", "other", ["~a.b"], false],
		["a*b", "a*b", [], true],
		["axxb", "a*b", [], false],
		["", "other", ["~*"], false],
		["cafe\u0301", "café", [], true],
		["safety   permit", "safety permit", [], true],
	])("matches %s against %s and %j", (value, answer, alternatives, correct) => {
		expect(isFillBlankAnswerCorrect(value, { id: "blank", answer, alternatives })).toBe(correct);
	});
});
