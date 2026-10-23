// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { checkRequiredBlocks } from "@praxity/shared-blocks/viewer/required-blocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initChecklistEnhancements } from "../../template/src/islands/island-checklist";
import { renderBlockHtml } from "../render-block-html";

const block = {
	id: "checklist",
	type: "checklist",
	data: {
		title: "Ready?",
		required: true,
		shuffle: true,
		items: [
			{ id: "same", text: "First" },
			{ id: "same", text: "Second" },
		],
	},
} as PraxityBlock;

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
});

describe("checklist island", () => {
	it("enhances stable SSR inputs without replacing them", () => {
		const html = renderBlockHtml(block, { enabledIslands: new Set(["checklist"]) });
		expect(html).toBe(renderBlockHtml(block, { enabledIslands: new Set(["checklist"]) }));
		expect(html).not.toContain("data-block-json");
		expect(html).toMatch(/data-block-type="checklist"[^>]*data-required="true"/);
		expect(html).not.toMatch(/<fieldset[^>]*data-required/);
		document.body.innerHTML = html;
		const before = Array.from(document.querySelectorAll("input"));
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);

		const cleanup = initChecklistEnhancements();
		const root = document.querySelector<HTMLElement>('[data-island="checklist"]');
		const inputs = Array.from(
			document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
		);

		expect(inputs).toEqual(before);
		expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
		expect(root?.dataset.required).toBe("true");
		expect(root?.querySelector('[data-required="true"]')).toBeNull();
		expect(checkRequiredBlocks().valid).toBe(false);
		inputs[0]?.click();
		expect(inputs[0]?.closest("[data-checklist-item]")?.hasAttribute("data-checked")).toBe(true);
		expect(root?.dataset.attempted).toBe("true");
		expect(root?.dataset.completed).toBe("false");
		inputs[1]?.click();
		expect(root?.dataset.completed).toBe("true");
		expect(checkRequiredBlocks().valid).toBe(true);
		expect(interaction).toHaveBeenCalledTimes(2);

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("rehydrates and persists stable item IDs without writing during restore", () => {
		const stateBlock = {
			id: "checklist-state",
			type: "checklist",
			data: {
				title: "Ready?",
				required: true,
				items: [
					{ id: "first", text: "First" },
					{ id: "second", text: "Second" },
				],
			},
		} as PraxityBlock;
		const get = vi.fn(() => ({ checkedItemIds: ["second", "removed", 3] }));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(stateBlock, {
			enabledIslands: new Set(["checklist"]),
		});

		const cleanup = initChecklistEnhancements();
		const root = document.querySelector<HTMLElement>('[data-island="checklist"]');
		const inputs = Array.from(
			document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
		);
		const second = inputs.find((input) => input.value === "second");
		expect(get).toHaveBeenCalledWith("checklist-state");
		expect(second?.checked).toBe(true);
		expect(root?.dataset.attempted).toBe("true");
		expect(root?.dataset.completed).toBe("false");
		expect(set).not.toHaveBeenCalled();

		inputs.find((input) => input.value === "first")?.click();
		expect(set).toHaveBeenCalledWith("checklist-state", {
			checkedItemIds: ["first", "second"],
		});
		cleanup();
	});
});
