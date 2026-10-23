import { describe, expect, it } from "vitest";
import { adaptGrammarPreviewBlocks } from "../src/grammar-adapter";
import type { PraxityBlock } from "../src/types";

function cloneBlocks(blocks: PraxityBlock[]): PraxityBlock[] {
	return structuredClone(blocks);
}

describe("adaptGrammarPreviewBlocks componentDefaults", () => {
	it("defaults merge onto top-level blocks that do not have the field", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "note-1",
				type: "note",
				data: { content: "<p>Hello</p>" },
			},
		];

		const result = adaptGrammarPreviewBlocks(blocks, {
			note: { tone: "info", compact: true },
		});

		expect(result[0]?.data).toEqual({
			tone: "info",
			compact: true,
			content: "<p>Hello</p>",
		});
	});

	it("explicit block values override componentDefaults", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "note-2",
				type: "note",
				data: { content: "<p>Hello</p>", tone: "warning" },
			},
		];

		const result = adaptGrammarPreviewBlocks(blocks, {
			note: { tone: "info", compact: true },
		});

		expect(result[0]?.data).toEqual({
			tone: "warning",
			compact: true,
			content: "<p>Hello</p>",
		});
	});

	it("applies componentDefaults for accordion blocks", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "accordion-2",
				type: "accordion",
				data: { items: [] },
			},
		];

		const result = adaptGrammarPreviewBlocks(blocks, {
			accordion: { accordionStyle: "separated" },
		});

		expect((result[0]?.data as Record<string, unknown>)?.accordionStyle).toBe("separated");
	});

	it("block-level accordionStyle wins over componentDefaults", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "accordion-3",
				type: "accordion",
				data: { items: [], accordionStyle: "contained" },
			},
		];

		const result = adaptGrammarPreviewBlocks(blocks, {
			accordion: { accordionStyle: "separated" },
		});

		expect((result[0]?.data as Record<string, unknown>)?.accordionStyle).toBe("contained");
	});

	it("preserves an assessment layout override while adapting canonical data", () => {
		const result = adaptGrammarPreviewBlocks(
			[
				{
					id: "assessment-1",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [{ id: "pick-stem", type: "text", data: { content: "<p>Pick one</p>" } }],
						response: {
							type: "choice",
							selectionMode: "single",
							options: [{ id: "answer", label: "Yes", isCorrect: true }],
						},
						layoutMode: "full",
					},
				},
			],
			{ assessment: {} },
		);

		expect(result[0]?.data.layoutMode).toBe("full");
	});

	it("recursive merge into disclosure/accordion item children", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "accordion-1",
				type: "accordion",
				data: {
					items: [
						{
							id: "item-1",
							label: "Item 1",
							children: [
								{
									id: "note-child-1",
									type: "note",
									data: { content: "<p>Nested</p>" },
								},
							],
						},
					],
				},
			},
		];

		const result = adaptGrammarPreviewBlocks(blocks, {
			note: { tone: "info" },
		});
		const firstItem = ((
			result[0]?.data.items as Array<{ children?: PraxityBlock[] }> | undefined
		)?.[0] ?? {}) as {
			children?: PraxityBlock[];
		};
		const nestedNote = firstItem.children?.[0];

		expect(nestedNote?.data).toEqual({
			tone: "info",
			content: "<p>Nested</p>",
		});
	});

	it("empty componentDefaults is a no-op (no data mutation)", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "text-1",
				type: "text",
				data: { content: "<p>Body</p>" },
			},
		];
		const snapshot = cloneBlocks(blocks);

		const result = adaptGrammarPreviewBlocks(blocks, {});

		expect(result).toEqual(snapshot);
		expect(blocks).toEqual(snapshot);
	});

	it("calling without second arg is a no-op (backward compat)", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "text-2",
				type: "text",
				data: { content: "<p>Body</p>" },
			},
		];
		const snapshot = cloneBlocks(blocks);

		const result = adaptGrammarPreviewBlocks(blocks);

		expect(result).toEqual(snapshot);
		expect(blocks).toEqual(snapshot);
	});

	it("normalizes implicit comparison column widths that were parsed as full-width columns", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "comparison-1",
				type: "columns",
				data: {
					layoutMode: "breakout",
					items: [
						{
							id: "left",
							width: 1,
							label: "Before",
							children: [{ id: "left-text", type: "text", data: { content: "Left" } }],
						},
						{
							id: "right",
							width: 1,
							label: "After",
							children: [{ id: "right-text", type: "text", data: { content: "Right" } }],
						},
					],
				},
			},
		];

		const result = adaptGrammarPreviewBlocks(blocks);
		const items = result[0]?.data.items as Array<{ width?: number }> | undefined;

		expect(items?.map((item) => item.width)).toEqual([0.5, 0.5]);
		expect(result[0]?.data.layoutMode).toBe("breakout");
	});
});
