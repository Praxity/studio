import { assessmentGroupRequirements, type PraxityBlock } from "@praxity/content-model";
import { describe, expect, it } from "vitest";

const member = (id: string, data: Record<string, unknown> = {}): PraxityBlock => ({
	id,
	type: "assessment",
	data,
});

describe("assessment group requirements", () => {
	it("keeps explicit required ahead of grading defaults, in member order", () => {
		const result = assessmentGroupRequirements([
			member("optional", { required: false, gradingMode: "exact", graded: true }),
			member("required", { required: true, gradingMode: "none" }),
			member("exact", { gradingMode: "exact" }),
			member("legacy", { graded: true }),
			member("ungraded", { gradingMode: "none", graded: true }),
			member("scored-only", { scored: true }),
		]);
		expect([...result.requiredIds]).toEqual(["required", "exact", "legacy"]);
		expect([...result.scoreRequiredIds]).toEqual(["required", "exact", "legacy"]);
	});

	it("requires every member when none is required, without changing the score subset", () => {
		const result = assessmentGroupRequirements([
			member("b", { required: false }),
			member("a", { gradingMode: "none" }),
		]);
		expect([...result.requiredIds]).toEqual(["b", "a"]);
		expect([...result.scoreRequiredIds]).toEqual([]);
		expect(result.requiredIds).not.toBe(result.scoreRequiredIds);
	});

	it("keeps empty groups empty and deduplicates repeated member IDs", () => {
		const empty = assessmentGroupRequirements([]);
		expect([...empty.requiredIds]).toEqual([]);
		expect([...empty.scoreRequiredIds]).toEqual([]);
		const repeated = assessmentGroupRequirements([
			member("a", { required: true }),
			member("a", { required: true }),
		]);
		expect([...repeated.requiredIds]).toEqual(["a"]);
		expect([...repeated.scoreRequiredIds]).toEqual(["a"]);
	});
});
