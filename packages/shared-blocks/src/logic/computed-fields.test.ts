import { describe, expect, it } from "vitest";
import { computeBlockFields } from "./computed-fields";

function mockElement(config: {
	attrs?: Record<string, string>;
	children?: Array<{ attrs: Record<string, string> }>;
}): Element {
	const children = config.children ?? [];

	return {
		getAttribute: (name: string) => config.attrs?.[name] ?? null,
		querySelectorAll: (selector: string) => {
			const requiredAttrs = (selector.match(/\[([^\]]+)\]/g) ?? []).map((s) => s.slice(1, -1));
			return children.filter((child) => requiredAttrs.every((attr) => attr in child.attrs));
		},
	} as unknown as Element;
}

describe("computeBlockFields", () => {
	it("returns empty object for unknown block types", () => {
		const el = mockElement({});
		expect(computeBlockFields("unknownType", el)).toEqual({});
	});

	describe("checklist", () => {
		it("returns completedCount and allChecked", () => {
			const el = mockElement({
				children: [
					{ attrs: { "data-checklist-item": "" } },
					{
						attrs: {
							"data-checklist-item": "",
							"data-checked": "",
						},
					},
					{
						attrs: {
							"data-checklist-item": "",
							"data-checked": "",
						},
					},
				],
			});

			const result = computeBlockFields("checklist", el);
			expect(result.completedCount).toBe(2);
			expect(result.allChecked).toBe(false);
			expect(result.isAttempted).toBe(true);
			expect(result.isCompleted).toBe(false);
		});

		it("returns allChecked=true when all items are checked", () => {
			const el = mockElement({
				children: [
					{
						attrs: {
							"data-checklist-item": "",
							"data-checked": "",
						},
					},
					{
						attrs: {
							"data-checklist-item": "",
							"data-checked": "",
						},
					},
				],
			});

			const result = computeBlockFields("checklist", el);
			expect(result.completedCount).toBe(2);
			expect(result.allChecked).toBe(true);
			expect(result.isAttempted).toBe(true);
			expect(result.isCompleted).toBe(true);
		});

		it("returns allChecked=false when no items exist", () => {
			const el = mockElement({ children: [] });
			const result = computeBlockFields("checklist", el);
			expect(result.completedCount).toBe(0);
			expect(result.allChecked).toBe(false);
			expect(result.isAttempted).toBe(false);
			expect(result.isCompleted).toBe(false);
		});
	});

	describe("rating", () => {
		it("returns numeric value from data-rating-value", () => {
			const el = mockElement({ attrs: { "data-rating-value": "4" } });
			const result = computeBlockFields("rating", el);
			expect(result.value).toBe(4);
			expect(result.ratingScore).toBe(4);
			expect(result.isAttempted).toBe(true);
			expect(result.isCompleted).toBe(true);
		});

		it("returns 0 when no rating attribute", () => {
			const el = mockElement({});
			const result = computeBlockFields("rating", el);
			expect(result.value).toBe(0);
			expect(result.ratingScore).toBe(0);
			expect(result.isAttempted).toBe(false);
			expect(result.isCompleted).toBe(false);
		});
	});

	describe("signature", () => {
		it("returns true when data-signed is true", () => {
			const el = mockElement({ attrs: { "data-signed": "true" } });
			const result = computeBlockFields("signature", el);
			expect(result.signed).toBe(true);
			expect(result.isSigned).toBe(true);
			expect(result.isAttempted).toBe(true);
			expect(result.isCompleted).toBe(true);
		});

		it("returns false when data-signed is not true", () => {
			const el = mockElement({ attrs: { "data-signed": "false" } });
			const result = computeBlockFields("signature", el);
			expect(result.signed).toBe(false);
			expect(result.isSigned).toBe(false);
			expect(result.isAttempted).toBe(false);
			expect(result.isCompleted).toBe(false);
		});
	});

	describe("assessment", () => {
		it("returns score, passed, and selectedOption", () => {
			const el = mockElement({
				attrs: {
					"data-score": "85",
					"data-passed": "true",
					"data-selected-option": "optionB",
					"data-result": "correct",
					"data-attempted": "true",
					"data-completed": "true",
				},
			});

			const result = computeBlockFields("assessment", el);
			expect(result.score).toBe(85);
			expect(result.passed).toBe(true);
			expect(result.selectedOption).toBe("optionB");
			expect(result.result).toBe("correct");
			expect(result.isCorrect).toBe(true);
			expect(result.isAttempted).toBe(true);
			expect(result.isCompleted).toBe(true);
		});

		it("returns defaults when attributes are missing", () => {
			const el = mockElement({});
			const result = computeBlockFields("assessment", el);
			expect(result.score).toBe(0);
			expect(result.passed).toBe(false);
			expect(result.selectedOption).toBe("");
			expect(result.result).toBe("");
			expect(result.isCorrect).toBe(false);
			expect(result.isAttempted).toBe(false);
			expect(result.isCompleted).toBe(false);
		});
	});

	describe("card", () => {
		it("returns isAttempted, isCompleted, and flippedPercentage", () => {
			const el = mockElement({
				attrs: {
					"data-attempted": "true",
					"data-completed": "false",
					"data-flipped-percentage": "50",
					"data-flipped-count": "2",
				},
			});
			const result = computeBlockFields("card", el);
			expect(result.isAttempted).toBe(true);
			expect(result.isCompleted).toBe(false);
			expect(result.flippedPercentage).toBe(50);
			expect(result.flippedCount).toBe(2);
		});

		it("returns defaults when no attributes", () => {
			const el = mockElement({});
			const result = computeBlockFields("card", el);
			expect(result.isAttempted).toBe(false);
			expect(result.isCompleted).toBe(false);
			expect(result.flippedPercentage).toBe(0);
			expect(result.flippedCount).toBe(0);
		});
	});
});
