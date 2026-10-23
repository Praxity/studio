import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";

function createBlock(
	id: string,
	type: PraxityBlock["type"],
	data: Record<string, unknown>,
): PraxityBlock {
	return { id, type, data };
}

describe("assessment-group schema", () => {
	it("requires memberBlockIds", () => {
		const group = createBlock("assessment-group-0", "assessmentGroup", {
			groupName: "Quiz",
			mode: "all",
			memberBlockIds: [],
		});

		const result = validate([group], "", { strictness: "normal" });

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assessment-group-empty", level: "error" }),
			]),
		);
	});

	it("flags invalid member references", () => {
		const group = createBlock("assessment-group-0", "assessmentGroup", {
			mode: "all",
			memberBlockIds: ["assessment-1", "missing-id"],
		});
		const assessment = createBlock("assessment-1", "assessment", {
			assessmentType: "single",
			question: "Q",
			options: [
				{ text: "A", correct: true },
				{ text: "B", correct: false },
			],
		});

		const result = validate([group, assessment], "", { strictness: "normal" });

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assessment-group-invalid-member", level: "error" }),
			]),
		);
	});

	it("warns for non-assessment members", () => {
		const group = createBlock("assessment-group-0", "assessmentGroup", {
			mode: "all",
			memberBlockIds: ["text-0"],
		});
		const text = createBlock("text-0", "text", { content: "Hello" });

		const result = validate([group, text], "", { strictness: "normal" });

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "assessment-group-non-assessment-member", level: "warning" }),
			]),
		);
	});
});
