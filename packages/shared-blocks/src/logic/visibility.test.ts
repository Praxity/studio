import { describe, expect, it } from "vitest";
import type { PraxityBlock } from "../types";
import { flattenLogicBlocks } from "./flatten-blocks";
import { initiallyHiddenBlockIds, resolveBlockTargetIds } from "./visibility";

describe("logic visibility shared by export and narration", () => {
	it.each([
		["null", { data: null }],
		["string", { data: "invalid" }],
		["missing", {}],
	])("treats %s block data as empty", (_description, fields) => {
		const blocks = [
			{ id: "broken", type: "text", ...fields },
			{ id: "conditional", type: "text", data: { visible: "variable:ready is true" } },
		] as PraxityBlock[];
		expect(initiallyHiddenBlockIds(blocks)).toEqual(new Set(["conditional"]));
	});

	it("marks visible conditions and a hidden heading section, then resolves its name", () => {
		const blocks: PraxityBlock[] = [
			{
				id: "scene",
				type: "heading",
				data: { level: 2, name: "calm-path", hide: true, content: "Calm" },
			},
			{ id: "dialogue", type: "dialogue", data: { turns: [] } },
			{ id: "end", type: "heading", data: { level: 2, content: "End" } },
			{
				id: "conditional",
				type: "text",
				data: { content: "Later", visible: "variable:ready is true" },
			},
		];
		expect(initiallyHiddenBlockIds(blocks)).toEqual(new Set(["scene", "dialogue", "conditional"]));
		expect(resolveBlockTargetIds(flattenLogicBlocks(blocks), "@calm-path")).toEqual([
			"scene",
			"dialogue",
		]);
	});
});
