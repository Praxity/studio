import { describe, expect, it } from "vitest";
import { getManifest } from "../src/manifest";
import { HIDDEN_BLOCK_TYPES, isCoreBlockType, RETIRED_BLOCK_TYPES } from "../src/supported-blocks";

describe("supported-block registry", () => {
	it("marks the spec's hidden set", () => {
		const hiddenBlockTypes = [
			"chart",
			"labeledGraphic",
			"imageComparison",
			"resourceEntry",
			"document",
		];

		expect([...HIDDEN_BLOCK_TYPES]).toEqual(hiddenBlockTypes);
		for (const blockType of hiddenBlockTypes) {
			expect(isCoreBlockType(blockType)).toBe(false);
		}
	});

	it("keeps retired block tombstones out of the supported set", () => {
		expect([...RETIRED_BLOCK_TYPES]).toEqual(["diagram", "interactiveVideo"]);
		for (const blockType of RETIRED_BLOCK_TYPES) {
			expect(isCoreBlockType(blockType)).toBe(false);
		}
	});

	it("keeps the core set visible", () => {
		for (const blockType of [
			"text",
			"heading",
			"quote",
			"note",
			"divider",
			"image",
			"heroCover",
			"video",
			"audio",
			"table",
			"stats",
			"button",
			"checklist",
			"accordion",
			"tabs",
			"columns",
			"card",
			"assessment",
			"assessmentGroup",
			"pageBreak",
			"variable",
			"logic",
			"code",
			"equation",
			"rating",
			"signature",
			"sequence",
		]) {
			expect(isCoreBlockType(blockType)).toBe(true);
		}
	});

	it("makes every authoring keyword available by default", () => {
		const core = getManifest();
		expect([...core.values()].every((entry) => entry.status === "core")).toBe(true);

		const all = getManifest({ include: "all" });
		expect(core.size).toBe(all.size);
		expect(all.get("code")?.status).toBe("core");
		expect(all.get("rate")?.status).toBe("core");
		expect(all.get("data-table")?.status).toBe("core");
		expect(all.get("embed")?.status).toBe("core");
	});
});
