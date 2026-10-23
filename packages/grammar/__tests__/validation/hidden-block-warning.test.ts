import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";
import { readBlockFixture as readBlockSource } from "../helpers/lesson-fixture.ts";

describe("hidden-block validation", () => {
	it("warns rather than errors on hidden block types", () => {
		const source = `::: table {chart=bar}
| Metric | June | July |
|--------|------|------|
| Checks | 4 | 7 |
title: Checks completed
alt: Bar chart of completed checks by month
:::
`;
		const { blocks } = readBlockSource(source);

		const result = validate(blocks, source);
		const finding = result.errors.find((error) => error.id === "hidden-block");

		expect(blocks[0]?.type).toBe("chart");
		expect(finding).toEqual(
			expect.objectContaining({
				level: "warning",
				blockId: blocks[0]?.id,
				blockType: "chart",
			}),
		);
		expect(result.hasErrors).toBe(false);
	});

	it("stays silent for core blocks", () => {
		const source = "Plain paragraph.";
		const { blocks } = readBlockSource(source);

		const result = validate(blocks, source);

		expect(result.errors.some((error) => error.id === "hidden-block")).toBe(false);
	});

	it.each(["diagram", "interactiveVideo"] as const)(
		"reports retired %s content as an error",
		(blockType) => {
			const blocks = [{ id: "retired", type: blockType, data: {} }] as unknown as PraxityBlock[];

			const result = validate(blocks, "");

			expect(result.errors).toContainEqual(
				expect.objectContaining({
					id: "retired-block",
					level: "error",
					blockId: "retired",
					blockType,
				}),
			);
			expect(result.hasErrors).toBe(true);
		},
	);
});
