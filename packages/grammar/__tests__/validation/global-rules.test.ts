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

describe("global validation rules", () => {
	it("warns when heading levels skip", () => {
		const result = validate(
			[
				createBlock("heading-0", "heading", { level: 1, content: "Intro" }),
				createBlock("heading-1", "heading", { level: 3, content: "Details" }),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "heading-level-skip", level: "warning" }),
			]),
		);
	});

	it("errors when heading level is invalid", () => {
		const result = validate(
			[createBlock("heading-0", "heading", { level: 7, content: "Bad" })],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "heading-level-invalid", level: "error" }),
			]),
		);
	});

	it("reports empty document as info when only structural blocks exist", () => {
		const result = validate(
			[createBlock("divider-0", "divider", {}), createBlock("page-break-0", "pageBreak", {})],
			"",
			{ strictness: "strict" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "empty-document", level: "info" })]),
		);
	});
});
