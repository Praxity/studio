import type { PraxityBlock } from "@praxity/shared-blocks";
import type { SectionPaletteName } from "@praxity/shared-blocks/constants";
import { describe, expect, it } from "vitest";
import { groupBlocksIntoSections, type SectionGroup } from "../html-gen";

type SectionTestBlock = PraxityBlock & {
	sectionTheme?: SectionPaletteName;
};

let nextId = 0;

function makeBlock(
	overrides: Partial<SectionTestBlock> & { type: SectionTestBlock["type"] },
): SectionTestBlock {
	return {
		id: overrides.id ?? `block-${++nextId}`,
		data: overrides.data ?? {},
		...overrides,
	};
}

function headingBlock(level: number, sectionTheme?: SectionTestBlock["sectionTheme"]) {
	return makeBlock({
		type: "heading",
		data: { content: `Heading ${level}`, level },
		sectionTheme,
	});
}

function textBlock() {
	return makeBlock({ type: "text", data: { content: "Hello" } });
}

describe("groupBlocksIntoSections", () => {
	it("keeps uniform rhythm flat", () => {
		const blocks = [headingBlock(2), textBlock(), headingBlock(2), textBlock()];
		const sections: SectionGroup[] = groupBlocksIntoSections(blocks, "uniform");

		expect(sections).toHaveLength(1);
		expect(sections[0].palette).toBe("light");
		expect(sections[0].blocks).toHaveLength(4);
	});

	it("alternates on H2 headings", () => {
		const blocks = [headingBlock(2), textBlock(), headingBlock(2), textBlock()];
		const sections = groupBlocksIntoSections(blocks, "alternate");

		expect(sections.map((section) => section.palette)).toEqual(["light", "dark"]);
		expect(sections[0].blocks).toHaveLength(2);
		expect(sections[1].blocks).toHaveLength(2);
	});

	it("does not split on H3 headings", () => {
		const blocks = [headingBlock(2), textBlock(), headingBlock(3), textBlock()];
		const sections = groupBlocksIntoSections(blocks, "alternate");

		expect(sections).toHaveLength(1);
		expect(sections[0].blocks).toHaveLength(4);
	});

	it("creates an intro section before the first H2", () => {
		const blocks = [textBlock(), textBlock(), headingBlock(2), textBlock()];
		const sections = groupBlocksIntoSections(blocks, "alternate");

		expect(sections).toHaveLength(2);
		expect(sections[0].palette).toBe("light");
		expect(sections[0].blocks).toHaveLength(2);
		expect(sections[1].palette).toBe("dark");
		expect(sections[1].blocks).toHaveLength(2);
	});

	it("keeps a single top-level H2 in the first light section", () => {
		const blocks = [headingBlock(2), textBlock()];
		const sections = groupBlocksIntoSections(blocks, "alternate");

		expect(sections).toHaveLength(1);
		expect(sections[0].palette).toBe("light");
		expect(sections[0].blocks).toHaveLength(2);
	});

	it("splits manually on sectionTheme", () => {
		const blocks = [
			textBlock(),
			headingBlock(2, "dark"),
			textBlock(),
			headingBlock(2, "accent"),
			textBlock(),
		];
		const sections = groupBlocksIntoSections(blocks, "manual");

		expect(sections.map((section) => section.palette)).toEqual(["light", "dark", "accent"]);
		expect(sections[0].blocks).toHaveLength(1);
		expect(sections[1].blocks).toHaveLength(2);
		expect(sections[2].blocks).toHaveLength(2);
	});

	it("splits manually on mood palette sectionThemes", () => {
		const blocks = [
			textBlock(),
			headingBlock(2, "warm"),
			textBlock(),
			headingBlock(2, "cool"),
			textBlock(),
			headingBlock(2, "growth"),
			textBlock(),
		];
		const sections = groupBlocksIntoSections(blocks, "manual");

		expect(sections.map((section) => section.palette)).toEqual(["light", "warm", "cool", "growth"]);
	});

	it("keeps manual sections inherited until the next override", () => {
		const blocks = [headingBlock(2, "dark"), textBlock(), textBlock()];
		const sections = groupBlocksIntoSections(blocks, "manual");

		expect(sections).toHaveLength(1);
		expect(sections[0].palette).toBe("dark");
		expect(sections[0].blocks).toHaveLength(3);
	});

	it("returns no sections for an empty page", () => {
		expect(groupBlocksIntoSections([], "alternate")).toHaveLength(0);
	});

	it("keeps assessmentGroup blocks in the flow without splitting on them", () => {
		const blocks = [headingBlock(2), makeBlock({ type: "assessmentGroup", data: {} }), textBlock()];
		const sections = groupBlocksIntoSections(blocks, "alternate");

		expect(sections).toHaveLength(1);
		expect(sections[0].blocks).toHaveLength(3);
	});
});
