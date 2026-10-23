import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";
import { readBlockFixture as readBlockSource } from "../helpers/lesson-fixture.ts";

describe("reveal-time validation", () => {
	it.each(["click", "sequential", "all"])(
		"retains labeled graphic reveal %s without a retirement warning",
		(reveal) => {
			const result = validate(
				[
					{
						id: "labels",
						type: "labeledGraphic",
						data: { src: "/image.png", reveal, markers: [] },
					},
				],
				"",
			);
			expect(result.errors.some((error) => error.id === "retired-reveal")).toBe(false);
		},
	);
	it("warns rather than errors on a retired reveal value", () => {
		const source = "Content appears later.";
		const { blocks } = readBlockSource(source);
		blocks[0].data.reveal = "eventually";

		const result = validate(blocks, source);
		const finding = result.errors.find((error) => error.id === "retired-reveal");

		expect(finding).toEqual(
			expect.objectContaining({
				level: "warning",
				blockId: blocks[0]?.id,
				blockType: "text",
			}),
		);
		expect(result.hasErrors).toBe(false);
	});

	it.each(["00:08", "123:59", "8"])("warns for retired reveal time %s", (reveal) => {
		const source = "Content appears later.";
		const { blocks } = readBlockSource(source);
		blocks[0].data.reveal = reveal;

		const result = validate(blocks, source);

		expect(result.errors.some((error) => error.id === "retired-reveal")).toBe(true);
	});

	it("warns consistently for retired reveal: each on lists and containers", () => {
		const listSource = "- First\n- Second";
		const list = readBlockSource(listSource);
		list.blocks[0].data.reveal = "each";
		expect(validate(list.blocks, listSource).errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "retired-reveal", level: "warning" })]),
		);

		const accordionSource = "::: accordion\n:: Panel {level=3}\nContent\n:::\n";
		const accordion = readBlockSource(accordionSource);
		accordion.blocks[0].data.reveal = "each";
		expect(validate(accordion.blocks, accordionSource).errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "retired-reveal", level: "warning" })]),
		);
	});
});
