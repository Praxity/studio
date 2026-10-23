import { describe, expect, it } from "vitest";
import type { PraxityBlock } from "../types";
import { flattenLogicBlocks } from "./flatten-blocks";

describe("flattenLogicBlocks", () => {
	it("keeps sibling block arrays in separate hierarchical scopes", () => {
		const blocks = [
			{
				id: "accordion",
				type: "accordion",
				data: {
					items: [
						{
							children: [
								{ id: "heading-a", type: "heading", data: { level: 2 } },
								{ id: "text-a", type: "text", data: {} },
							],
						},
						{
							children: [
								{ id: "heading-b", type: "heading", data: { level: 2 } },
								{ id: "text-b", type: "text", data: {} },
							],
						},
					],
				},
			},
			{ id: "outer", type: "text", data: {} },
		] as PraxityBlock[];

		const byId = new Map(flattenLogicBlocks(blocks).map((block) => [block.id, block.logicScope]));
		expect(byId.get("accordion")).toBe("root");
		expect(byId.get("outer")).toBe("root");
		expect(byId.get("heading-a")).toBe(byId.get("text-a"));
		expect(byId.get("heading-b")).toBe(byId.get("text-b"));
		expect(byId.get("heading-a")).not.toBe(byId.get("heading-b"));
		expect(byId.get("heading-a")?.startsWith("root/")).toBe(true);
	});
});
