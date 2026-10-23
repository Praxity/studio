import { describe, expect, it } from "vitest";
import { getImageFloatSide, imageFloatRegions } from "./image-float";
import { groupBlocksIntoSections } from "./section-grouping";
import type { PraxityBlock } from "./types";

function image(data: Record<string, unknown> = {}): PraxityBlock {
	return {
		id: "image",
		type: "image",
		data: { src: "/portrait.png", altText: "Portrait", ...data },
	};
}

function block(type: PraxityBlock["type"], data: Record<string, unknown> = {}): PraxityBlock {
	return { id: type, type, data };
}

const prose = block("text", { content: "<p>Words beside the image.</p>" });

describe("image floats", () => {
	it.each(["left", "right"] as const)("accepts %s with every supported width", (side) => {
		for (const width of ["small", "medium", "large"])
			expect(getImageFloatSide(image({ float: side, width }))).toBe(side);
	});
	it.each([undefined, "", "start", "end", "none", "diagonal"])("rejects float %s", (float) => {
		expect(getImageFloatSide(image({ float, width: "small" }))).toBeNull();
	});
	it.each([undefined, "", "full", "tiny", 50])("rejects width %s", (width) => {
		expect(getImageFloatSide(image({ float: "left", width }))).toBeNull();
	});
	it.each(["layout", "layoutMode"])("rejects conflicting %s", (key) => {
		for (const value of ["wide", "full", "breakout", "unknown", false])
			expect(getImageFloatSide(image({ float: "left", width: "small", [key]: value }))).toBeNull();
	});
	it("does not float non-images or obsolete wrap values", () => {
		expect(getImageFloatSide(prose)).toBeNull();
		expect(getImageFloatSide(image({ wrap: "start", width: "small" }))).toBeNull();
	});
	it("keeps H1 and H2, lists and prose together through the end of the document", () => {
		const blocks = [
			image({ float: "left", width: "small" }),
			block("heading", { level: 1, content: "Title" }),
			block("heading", { level: 2, content: "Subheading" }),
			block("text", { content: "<ul><li>Item</li></ul>" }),
			prose,
		];
		expect(imageFloatRegions(blocks)).toEqual([{ float: "left", blocks }]);
	});
	it.each([block("blockBreak", { close: "float" }), block("pageBreak")])(
		"ends the region at $type",
		(boundary) => {
			const portrait = image({ float: "right", width: "medium" });
			const regions = imageFloatRegions([portrait, prose, boundary, prose]);
			expect(regions[0]).toEqual({
				float: "right",
				blocks: [portrait, prose],
				...(boundary.type === "blockBreak" ? { nodeId: boundary.id } : {}),
			});
			expect(regions.slice(1)).toEqual(
				(boundary.type === "blockBreak" ? [prose] : [boundary, prose]).map((item) => ({
					float: null,
					blocks: [item],
				})),
			);
		},
	);
	it("starts a new region for another floating image and allows an image at document end", () => {
		const left = image({ float: "left", width: "small" });
		const right = image({ float: "right", width: "large" });
		expect(imageFloatRegions([left, prose, right])).toEqual([
			{ float: "left", blocks: [left, prose] },
			{ float: "right", blocks: [right] },
		]);
	});
});

it.each(["alternate", "manual"] as const)(
	"keeps a float intact across %s section changes",
	(rhythm) => {
		const imageBlock = image({ float: "right", width: "medium" });
		const inside = { ...block("heading", { level: 2 }), sectionTheme: "dark" as const };
		const close = block("blockBreak", { close: "float" });
		const outside = { ...inside, id: "outside" };
		const sections = groupBlocksIntoSections([imageBlock, inside, prose, close, outside], rhythm);
		expect(sections.map((section) => section.blocks)).toEqual([
			[imageBlock, inside, prose, close],
			[outside],
		]);
	},
);
