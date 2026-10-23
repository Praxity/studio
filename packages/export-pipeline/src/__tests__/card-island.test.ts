// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { initCardEnhancements } from "../../template/src/islands/island-card";
import { renderBlockHtml } from "../render-block-html";

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
});

describe("card island", () => {
	it("reports recall expansion through aria-expanded without a flip announcement", () => {
		document.body.innerHTML = `<div id="praxity-live-region">Previous message</div>${renderBlockHtml(
			{
				id: "recall",
				type: "card",
				data: {
					items: [
						{
							id: "one",
							front: [{ id: "prompt", type: "text", data: { content: "Question" } }],
							back: [{ id: "answer", type: "text", data: { content: "Answer" } }],
						},
					],
				},
			} as PraxityBlock,
			{ enabledIslands: new Set(["card"]) },
		)}`;
		const cleanup = initCardEnhancements();
		try {
			const toggle = document.querySelector<HTMLButtonElement>("[data-card-flip]");
			assert(toggle);
			toggle.click();
			expect(toggle.getAttribute("aria-expanded")).toBe("true");
			expect(document.getElementById("praxity-live-region")?.textContent).toBe("Previous message");
			toggle.click();
			expect(toggle.getAttribute("aria-expanded")).toBe("false");
			expect(document.getElementById("praxity-live-region")?.textContent).toBe("Previous message");
		} finally {
			cleanup();
		}
	});
	it("a continued playthrough cannot acquire a successor lifetime after saving", () => {
		const callbacks: (() => void)[] = [];
		vi.spyOn(window, "setTimeout").mockImplementation(((callback: () => void) => {
			callbacks.push(callback);
			return callbacks.length;
		}) as typeof window.setTimeout);
		let epoch = 0;
		Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => epoch } } });
		window.__praxityBlockState = {
			get: () => undefined,
			set: () => {
				if (epoch === 0) ++epoch;
			},
		};
		document.body.innerHTML = renderBlockHtml(
			{
				id: "playthrough",
				type: "card",
				data: {
					layout: "single",
					advance: 1,
					items: [0, 1, 2].map((index) => ({
						id: `card-${index}`,
						front: [{ id: `text-${index}`, type: "text", data: { content: "Prompt" } }],
					})),
				},
			} as PraxityBlock,
			{ enabledIslands: new Set(["card"]) },
		);
		const cleanup = initCardEnhancements();
		try {
			const play = document.querySelector<HTMLButtonElement>("[data-card-play]");
			assert(play);
			play.click();
			callbacks[0]();
			expect(epoch).toBe(1);
			expect(document.querySelector("[data-card-counter]")?.textContent).toBe("2 / 3");
			expect(callbacks).toHaveLength(1);
			play.click();
			play.click();
			callbacks[1]();
			expect(document.querySelector("[data-card-counter]")?.textContent).toBe("3 / 3");
		} finally {
			cleanup();
			Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
			vi.restoreAllMocks();
		}
	});

	it("keeps a playthrough's control and position outside nested card decks", () => {
		vi.useFakeTimers();
		const deck = (id: string): PraxityBlock => ({
			id,
			type: "card",
			data: {
				layout: "single",
				advance: 1,
				items: [0, 1].map((index) => ({
					id: `${id}-${index}`,
					front: [{ id: `${id}-text-${index}`, type: "text", data: { content: "Prompt" } }],
				})),
			},
		});
		const outer = deck("outer");
		const items = outer.data.items as Array<{ front: PraxityBlock[] }>;
		items[0].front.push(deck("inner"));
		document.body.innerHTML = renderBlockHtml(outer, { enabledIslands: new Set(["card"]) });
		const cleanup = initCardEnhancements();
		try {
			const controls = document.querySelector('[data-block-id="outer"] > .praxity-card-controls');
			const play = controls?.querySelector<HTMLButtonElement>("[data-card-play]");
			assert(play, "Outer cards must own their Play control");
			play.focus();
			play.click();
			vi.advanceTimersByTime(1000);
			expect(controls?.querySelector("[data-card-counter]")?.textContent).toBe("2 / 2");
			expect(
				document.querySelector('[data-block-id="inner"] [data-card-counter]')?.textContent,
			).toBe("1 / 2");
			expect(document.activeElement).toBe(play);
		} finally {
			cleanup();
			vi.useRealTimers();
		}
	});
	it("starts a bounded pass only on Play and cancels it on Pause, manual navigation and disposal", () => {
		vi.useFakeTimers();
		const block: PraxityBlock = {
			id: "playthrough",
			type: "card",
			data: {
				layout: "single",
				advance: 1,
				items: [0, 1, 2].map((index) => ({
					id: String(index),
					front: [{ id: `text-${index}`, type: "text", data: { content: `Card ${index + 1}` } }],
				})),
			},
		};
		document.body.innerHTML = renderBlockHtml(block, { enabledIslands: new Set(["card"]) });
		const cleanup = initCardEnhancements();
		const counter = document.querySelector("[data-card-counter]");
		vi.advanceTimersByTime(2200);
		expect(counter?.textContent).toBe("1 / 3");
		const toggle = document.querySelector<HTMLButtonElement>("[data-card-play]");
		assert(toggle, "Published cards require a learner Play control");
		toggle.focus();
		toggle.click();
		expect(toggle.getAttribute("aria-label")).toBe("Pause cards");
		vi.advanceTimersByTime(1000);
		expect(counter?.textContent).toBe("2 / 3");
		expect(document.activeElement).toBe(toggle);
		toggle.click();
		vi.advanceTimersByTime(2200);
		expect(counter?.textContent).toBe("2 / 3");
		toggle.click();
		vi.advanceTimersByTime(1000);
		expect(counter?.textContent).toBe("3 / 3");
		expect(toggle.getAttribute("aria-label")).toBe("Play cards");
		vi.advanceTimersByTime(2200);
		expect(counter?.textContent).toBe("3 / 3");
		toggle.click();
		expect(counter?.textContent).toBe("1 / 3");
		document.querySelector<HTMLButtonElement>("[data-card-next]")?.click();
		vi.advanceTimersByTime(2200);
		expect(counter?.textContent).toBe("2 / 3");
		toggle.click();
		cleanup();
		vi.advanceTimersByTime(2200);
		expect(counter?.textContent).toBe("2 / 3");
		vi.useRealTimers();
	});
	it("flips, tracks completion, and navigates server-rendered cards", () => {
		const block = {
			id: "cards",
			type: "card",
			data: {
				layout: "single",
				showProgress: true,
				trackCompletion: true,
				items: [
					{
						id: "one",
						label: "One",
						front: [{ id: "front", type: "text", data: { content: "<p>Front</p>" } }],
						back: [{ id: "back", type: "text", data: { content: "<p>Back</p>" } }],
					},
					{
						id: "two",
						label: "Two",
						front: [{ id: "second", type: "text", data: { content: "<p>Second</p>" } }],
						back: [],
					},
				],
			},
		} as unknown as PraxityBlock;
		document.body.innerHTML = `<div id="praxity-live-region"></div>${renderBlockHtml(block, { enabledIslands: new Set(["card"]) })}`;
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);
		const cleanup = initCardEnhancements();
		const root = document.querySelector<HTMLElement>("[data-card-root]");
		const flip = document.querySelector<HTMLElement>("[data-card-flip]");
		const next = document.querySelector<HTMLButtonElement>("[data-card-next]");

		flip?.click();
		expect(flip?.getAttribute("aria-expanded")).toBe("true");
		expect(root?.dataset.completed).toBe("true");
		expect(root?.dataset.flippedPercentage).toBe("100");
		expect(interaction).toHaveBeenCalledOnce();

		next?.focus();
		next?.click();
		const previous = document.querySelector<HTMLButtonElement>("[data-card-previous]");
		expect(document.activeElement).toBe(previous);
		expect(previous?.disabled).toBe(false);
		expect(next?.disabled).toBe(true);
		expect(root?.querySelector("[data-slide-index='0']")?.getAttribute("data-active")).toBe(
			"false",
		);
		expect(root?.querySelector("[data-slide-index='1']")?.getAttribute("data-active")).toBe("true");
		expect(root?.querySelector("[data-card-counter]")?.textContent).toBe("2 / 2");
		previous?.click();
		expect(document.activeElement).toBe(next);
		expect(previous?.disabled).toBe(true);
		expect(next?.disabled).toBe(false);
		expect(root?.querySelector("[data-card-counter]")?.textContent).toBe("1 / 2");

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("moves endangered one-card navigation focus to the active card", () => {
		const block = {
			id: "one-card",
			type: "card",
			data: {
				layout: "single",
				items: [
					{
						id: "one",
						label: "One",
						front: [{ id: "front", type: "text", data: { content: "Only card" } }],
						back: [],
					},
				],
			},
		} as unknown as PraxityBlock;
		document.body.innerHTML = renderBlockHtml(block, { enabledIslands: new Set(["card"]) });
		const next = document.querySelector<HTMLButtonElement>("[data-card-next]");
		assert(next);
		// Model focus retained from a server facade before the enhancer resolves its boundary.
		next.disabled = false;
		next.focus();
		const cleanup = initCardEnhancements();
		const slide = document.querySelector(".praxity-slides-item");
		expect(document.activeElement).toBe(slide);
		expect(slide?.hasAttribute("inert")).toBe(false);
		expect(next.disabled).toBe(true);
		cleanup();
	});

	it("rehydrates only current cards and valid flip/completion IDs", () => {
		const block = {
			id: "cards",
			type: "card",
			data: {
				layout: "single",
				showProgress: true,
				trackCompletion: true,
				items: [
					{
						id: "one",
						label: "One",
						front: [{ id: "front", type: "text", data: { content: "<p>Front</p>" } }],
						back: [{ id: "back", type: "text", data: { content: "<p>Back</p>" } }],
					},
					{
						id: "two",
						label: "Two",
						front: [{ id: "second", type: "text", data: { content: "<p>Second</p>" } }],
						back: [{ id: "second-back", type: "text", data: { content: "<p>Back</p>" } }],
					},
				],
			},
		} as unknown as PraxityBlock;
		const get = vi.fn(() => ({
			currentId: "two",
			flippedIds: ["two", "missing"],
			completedIds: ["one", "two", "missing"],
		}));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(block, {
			enabledIslands: new Set(["card"]),
		});

		const cleanup = initCardEnhancements();
		const root = document.querySelector<HTMLElement>("[data-card-root]");
		const slides = Array.from(document.querySelectorAll<HTMLElement>(".praxity-slides-item"));
		const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-card-item]"));
		expect(get).toHaveBeenCalledWith("cards");
		expect(slides[1]?.dataset.active).toBe("true");
		expect(cards[1]?.dataset.flipped).toBe("true");
		expect(root?.dataset.flippedPercentage).toBe("100");
		expect(set).not.toHaveBeenCalled();

		cards[1]?.querySelector<HTMLElement>("[data-card-flip]")?.click();
		expect(set).toHaveBeenCalledWith("cards", {
			currentId: "two",
			flippedIds: [],
			completedIds: ["one", "two"],
		});
		cleanup();
	});
	it.each(["single", "grid"])(
		"narrates exact %s prompts without revealing answers or automatically advancing",
		(layout) => {
			vi.useFakeTimers();
			const block = {
				id: "cards",
				type: "card",
				data: {
					layout,
					advance: 1,
					items: [0, 1].map((index) => ({
						id: String(index),
						label: "Repeated",
						front: [{ id: `f${index}`, type: "text", data: { content: "Repeated" } }],
						back: [{ id: `b${index}`, type: "text", data: { content: "Repeated" } }],
					})),
				},
			} as unknown as PraxityBlock;
			document.body.innerHTML = renderBlockHtml(block, { enabledIslands: new Set(["card"]) });
			const cleanup = initCardEnhancements();
			const root = document.querySelector<HTMLElement>("[data-card-root]");
			assert(root);
			const manual = vi.fn();
			root.addEventListener("praxity:narration-manual-navigation", manual);
			const reveal = (side: string) =>
				root.dispatchEvent(
					new CustomEvent("praxity:narration-reveal", {
						bubbles: true,
						detail: { cardTarget: { containerId: "cards", itemIndex: 1, side } },
					}),
				);
			reveal("front");
			const card = root.querySelector<HTMLElement>('[data-card-index="1"]');
			assert(card);
			expect(card.querySelector("[data-card-flip]")?.getAttribute("aria-expanded")).toBe("false");
			reveal("back");
			expect(card.querySelector("[data-card-flip]")?.getAttribute("aria-expanded")).toBe("false");
			expect(card.querySelector('[data-card-side="back"]')?.hasAttribute("inert")).toBe(true);
			expect(card.querySelector('[data-card-side="front"]')?.hasAttribute("inert")).toBe(false);
			expect(manual).not.toHaveBeenCalled();
			if (layout === "single") {
				expect(root.dataset.flippedCount).toBe("0");
				root.dataset.narrationPlaying = "true";
				vi.advanceTimersByTime(2000);
				expect(root.querySelector("[data-card-counter]")?.textContent).toBe("2 / 2");
				delete root.dataset.narrationPlaying;
				vi.advanceTimersByTime(1000);
				expect(root.querySelector("[data-card-counter]")?.textContent).toBe("2 / 2");
			}
			reveal("front");
			expect(card.dataset.flipped).toBe("false");
			card.querySelector<HTMLElement>("[data-card-flip]")?.click();
			expect(card.querySelector("[data-card-flip]")?.getAttribute("aria-expanded")).toBe("true");
			expect(card.querySelector('[data-card-side="back"]')?.hasAttribute("inert")).toBe(false);
			expect(manual).toHaveBeenCalledOnce();
			if (layout === "single") {
				vi.advanceTimersByTime(1000);
				expect(root.querySelector("[data-card-counter]")?.textContent).toBe("2 / 2");
			}
			const completedBefore = root.dataset.flippedCount;
			root.dispatchEvent(
				new CustomEvent("praxity:narration-reveal", { detail: { resetCards: true } }),
			);
			expect(root.querySelector('[data-flipped="true"]')).toBeNull();
			if (layout === "single") {
				expect(root.querySelector("[data-card-counter]")?.textContent).toBe("1 / 2");
				expect(root.dataset.flippedCount).toBe(completedBefore);
			}
			cleanup();
			vi.useRealTimers();
		},
	);
	it.each(["single", "grid"])(
		"replays and clears a deferred %s card target after initialization",
		(layout) => {
			const block = {
				id: "cards",
				type: "card",
				data: {
					layout,
					items: [0, 1].map((index) => ({
						id: String(index),
						label: "Repeated",
						front: [{ id: `f${index}`, type: "text", data: { content: "Front" } }],
						back: [{ id: `b${index}`, type: "text", data: { content: "Back" } }],
					})),
				},
			} as unknown as PraxityBlock;
			document.body.innerHTML = renderBlockHtml(block, { enabledIslands: new Set(["card"]) });
			const root = document.querySelector<HTMLElement>("[data-card-root]") as HTMLElement;
			root.dataset.narrationPendingReset = "true";
			root.dataset.narrationPendingIndex = "1";
			root.dataset.narrationPendingSide = "front";
			const cleanup = initCardEnhancements();
			expect(root.querySelector<HTMLElement>('[data-card-index="1"]')?.dataset.flipped).toBe(
				"false",
			);
			expect(root.dataset.narrationPendingReset).toBeUndefined();
			expect(root.dataset.narrationPendingIndex).toBeUndefined();
			expect(root.dataset.narrationPendingSide).toBeUndefined();
			if (layout === "single") expect(root.dataset.flippedCount).toBe("0");
			cleanup();
			expect(root.dataset.cardEnhanced).toBeUndefined();
		},
	);
});
