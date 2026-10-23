import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";

function createAssessmentBlock(data: Record<string, unknown>): PraxityBlock {
	return {
		id: "assessment-0",
		type: "assessment",
		data,
	};
}

describe("assessment schema", () => {
	it("rejects reveal on open response assessments", () => {
		const result = validate(
			[
				createAssessmentBlock({
					question: "Order",
					assessmentType: "textResponse",
					feedbackMode: "reveal",
				}),
			],
			"",
			{ strictness: "normal" },
		);
		expect(result.errors.some((error) => error.id === "assessment-reveal-unsupported")).toBe(true);
	});
	it("keeps rejecting reveal on a hotspot that has a small region", () => {
		const result = validate(
			[
				createAssessmentBlock({
					question: "Find the valve",
					assessmentType: "hotspot",
					feedbackMode: "reveal",
					spots: [{ label: "Valve", shape: "rect", region: [10, 10, 5, 5] }],
				}),
			],
			"",
			{ strictness: "normal" },
		);
		expect(result.errors.map((error) => error.id)).toEqual(
			expect.arrayContaining(["hotspot-region-small", "assessment-reveal-unsupported"]),
		);
	});
	it("requires a question", () => {
		const result = validate(
			[createAssessmentBlock({ assessmentType: "single", options: [] })],
			"",
			{
				strictness: "normal",
			},
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "missing-question", level: "error", attribute: "question" }),
			]),
		);
	});

	it("requires at least two options for single-choice", () => {
		const result = validate(
			[
				createAssessmentBlock({
					assessmentType: "single",
					question: "Q?",
					options: [{ text: "Only one", correct: true }],
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assessment-too-few-options", level: "error" }),
			]),
		);
	});

	it("requires a correct answer for scored assessments", () => {
		const result = validate(
			[
				createAssessmentBlock({
					assessmentType: "single",
					question: "Q?",
					feedback: "immediate",
					options: [
						{ text: "A", correct: false },
						{ text: "B", correct: false },
					],
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assessment-no-correct-answer", level: "error" }),
			]),
		);
	});

	it("does not require a correct answer when feedback is deferred", () => {
		const result = validate(
			[
				createAssessmentBlock({
					assessmentType: "single",
					question: "Q?",
					feedback: "deferred",
					options: [
						{ text: "A", correct: false },
						{ text: "B", correct: false },
					],
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors.some((error) => error.id === "assessment-no-correct-answer")).toBe(false);
	});

	it("warns on empty option text", () => {
		const result = validate(
			[
				createAssessmentBlock({
					assessmentType: "single",
					question: "Q?",
					options: [
						{ text: "", correct: true },
						{ text: "B", correct: false },
					],
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assessment-empty-option", level: "warning" }),
			]),
		);
	});

	it("adds choose-many hint when only one correct option is marked", () => {
		const result = validate(
			[
				createAssessmentBlock({
					assessmentType: "multi",
					question: "Q?",
					options: [
						{ text: "A", correct: true },
						{ text: "B", correct: false },
						{ text: "C", correct: false },
					],
				}),
			],
			"",
			{ strictness: "strict" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "choose-many-single-correct", level: "info" }),
			]),
		);
	});

	it("does not apply choice-option rules to non-choice assessments", () => {
		const result = validate(
			[
				createAssessmentBlock({
					assessmentType: "matching",
					question: "Match them",
					pairs: [],
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors.some((error) => error.id === "assessment-too-few-options")).toBe(false);
		expect(result.errors.some((error) => error.id === "assessment-no-correct-answer")).toBe(false);
	});
});
