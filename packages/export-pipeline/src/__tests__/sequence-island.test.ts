// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSequenceEnhancements } from "../../template/src/islands/island-sequence";
import { renderBlockHtml } from "../render-block-html";

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
	vi.restoreAllMocks();
});

describe("published sequence island", () => {
	it("adds controls and keyboard scrolling only while overflow exists", () => {
		document.body.innerHTML = renderBlockHtml(
			{
				id: "timeline",
				type: "sequence",
				data: {
					variant: "timeline",
					orientation: "horizontal",
					scrollable: true,
					items: ["One", "Two", "Three"].map((label) => ({ id: label, label, children: [] })),
				},
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["sequence"]) },
		);
		const viewport = document.querySelector<HTMLElement>(".praxity-sequence-scroll-viewport");
		if (!viewport) throw new Error("Missing sequence viewport");
		Object.defineProperties(viewport, {
			clientWidth: { configurable: true, value: 300 },
			scrollWidth: { configurable: true, value: 900 },
		});
		const scrollBy = vi.fn((options?: ScrollToOptions | number) => {
			const left = typeof options === "number" ? options : options?.left;
			viewport.scrollLeft += Number(left ?? 0);
			viewport.dispatchEvent(new Event("scroll"));
		});
		Object.defineProperty(viewport, "scrollBy", { configurable: true, value: scrollBy });

		const cleanup = initSequenceEnhancements();
		const root = document.querySelector<HTMLElement>(".praxity-sequence-scroll-region");
		const start = document.querySelector<HTMLButtonElement>('[data-sequence-scroll="start"]');
		const end = document.querySelector<HTMLButtonElement>('[data-sequence-scroll="end"]');
		expect(root?.dataset.overflow).toBe("end");
		expect(start?.hidden).toBe(false);
		expect(start?.getAttribute("aria-disabled")).toBe("true");
		expect(end?.hidden).toBe(false);
		expect(end?.getAttribute("aria-disabled")).toBe("false");

		viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(scrollBy).toHaveBeenCalledOnce();
		expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: "instant" });
		expect(viewport.scrollLeft).toBe(240);
		expect(root?.dataset.overflow).toBe("both");

		cleanup();
		expect(root?.dataset.sequenceEnhanced).toBeUndefined();
		expect(start?.hidden).toBe(true);
		expect(end?.hidden).toBe(true);
	});

	it("restores a bounded scroll position before syncing and saves user scrolls", () => {
		const get = vi.fn(() => ({ position: 999 }));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(
			{
				id: "timeline",
				type: "sequence",
				data: {
					variant: "timeline",
					orientation: "horizontal",
					scrollable: true,
					items: ["One", "Two", "Three"].map((label) => ({ id: label, label, children: [] })),
				},
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["sequence"]) },
		);
		const viewport = document.querySelector<HTMLElement>(".praxity-sequence-scroll-viewport");
		if (!viewport) throw new Error("Missing sequence viewport");
		Object.defineProperties(viewport, {
			clientWidth: { configurable: true, value: 300 },
			scrollWidth: { configurable: true, value: 900 },
		});

		const cleanup = initSequenceEnhancements();
		const root = document.querySelector<HTMLElement>(".praxity-sequence-scroll-region");
		expect(get).toHaveBeenCalledWith("timeline");
		expect(viewport.scrollLeft).toBe(600);
		expect(root?.dataset.overflow).toBe("start");
		expect(set).not.toHaveBeenCalled();

		viewport.scrollLeft = 240;
		viewport.dispatchEvent(new Event("scroll"));
		expect(set).toHaveBeenCalledWith("timeline", { position: 240 });
		cleanup();
	});

	it("waits to consume restored position until a hidden viewport has dimensions", () => {
		const get = vi.fn(() => ({ position: 999 }));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(
			{
				id: "hidden-timeline",
				type: "sequence",
				data: {
					variant: "timeline",
					orientation: "horizontal",
					scrollable: true,
					items: ["One", "Two", "Three"].map((label) => ({ id: label, label, children: [] })),
				},
			} as unknown as PraxityBlock,
			{ enabledIslands: new Set(["sequence"]) },
		);
		const viewport = document.querySelector<HTMLElement>(".praxity-sequence-scroll-viewport");
		if (!viewport) throw new Error("Missing sequence viewport");
		let clientWidth = 0;
		let scrollWidth = 0;
		Object.defineProperties(viewport, {
			clientWidth: { configurable: true, get: () => clientWidth },
			scrollWidth: { configurable: true, get: () => scrollWidth },
		});

		const cleanup = initSequenceEnhancements();
		expect(viewport.scrollLeft).toBe(0);
		viewport.dispatchEvent(new Event("scroll"));
		expect(set).not.toHaveBeenCalled();

		clientWidth = 300;
		scrollWidth = 900;
		window.dispatchEvent(new Event("resize"));
		expect(viewport.scrollLeft).toBe(600);
		expect(set).not.toHaveBeenCalled();
		cleanup();
	});
});
