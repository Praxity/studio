import { describe, expect, it } from "vitest";
import { compileVisibleExpression, parseLogicConditionExpression } from "../src/logic-condition.ts";

describe("logic condition expressions", () => {
	it("compiles documented visible expressions", () => {
		expect(compileVisibleExpression("passedQuiz")).toEqual({
			operator: "and",
			rules: [{ source: "variable:passedQuiz", comparison: "is", value: true }],
		});
		expect(compileVisibleExpression("!passedQuiz")).toEqual({
			operator: "and",
			rules: [{ source: "variable:passedQuiz", comparison: "is", value: false }],
		});
		expect(compileVisibleExpression("attempts >= 3")).toEqual({
			operator: "and",
			rules: [{ source: "variable:attempts", comparison: "gte", value: 3 }],
		});
	});

	it("parses documented block field references", () => {
		expect(parseLogicConditionExpression("block:quiz-1.score >= 80")).toEqual({
			source: "block:quiz-1",
			field: "score",
			comparison: "gte",
			value: 80,
		});
	});
});
