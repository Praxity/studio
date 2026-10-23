// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initImageComparisonEnhancements } from "../../template/src/islands/island-image-comparison";
import { renderBlockHtml } from "../render-block-html";

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
});

describe("image comparison island", () => {
	it("updates the server-rendered slider through its native range input", () => {
		document.body.innerHTML = renderBlockHtml(
			{
				id: "comparison",
				type: "imageComparison",
				data: {
					display: "slider",
					beforeLabel: "Before",
					afterLabel: "After",
					beforeImage: { src: "/before.png", altText: "Before state" },
					afterImage: { src: "/after.png", altText: "After state" },
				},
			} as unknown as PraxityBlock,
			{ extraAttributes: ['data-island="imageComparison"'] },
		);
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);
		const inputBefore = document.querySelector<HTMLInputElement>('input[type="range"]');
		const cleanup = initImageComparisonEnhancements();
		const root = document.querySelector<HTMLElement>('[data-island="imageComparison"]');
		const slider = root?.querySelector<HTMLElement>(".praxity-comparison-slider");
		const input = root?.querySelector<HTMLInputElement>('input[type="range"]');

		expect(input).toBe(inputBefore);
		expect(input?.min).toBe("0");
		expect(input?.max).toBe("100");
		expect(input?.step).toBe("2");
		if (!input) throw new Error("Missing comparison range input");
		input.value = "72";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		expect(slider?.style.getPropertyValue("--praxity-comparison-position")).toBe("72%");
		expect(input.getAttribute("aria-valuenow")).toBe("72");
		expect(input.getAttribute("aria-valuetext")).toBe("72% Before, 28% After");
		expect(root?.hasAttribute("data-hydrated")).toBe(true);
		expect(interaction).not.toHaveBeenCalled();

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("restores a clamped position before syncing and persists user input", () => {
		const get = vi.fn(() => ({ position: 999 }));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(
			{
				id: "comparison",
				type: "imageComparison",
				data: {
					display: "slider",
					beforeLabel: "Before",
					afterLabel: "After",
					beforeImage: { src: "/before.png", altText: "Before state" },
					afterImage: { src: "/after.png", altText: "After state" },
				},
			} as unknown as PraxityBlock,
			{ extraAttributes: ['data-island="imageComparison"'] },
		);

		const cleanup = initImageComparisonEnhancements();
		const input = document.querySelector<HTMLInputElement>('input[type="range"]');
		expect(get).toHaveBeenCalledWith("comparison");
		expect(input?.value).toBe("100");
		expect(input?.getAttribute("aria-valuenow")).toBe("100");
		expect(set).not.toHaveBeenCalled();

		if (!input) throw new Error("Missing comparison range input");
		input.value = "72";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(set).toHaveBeenCalledWith("comparison", { position: 72 });
		cleanup();
	});
});
