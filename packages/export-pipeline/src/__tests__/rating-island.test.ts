// @vitest-environment jsdom

import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initRatingEnhancements } from "../../template/src/islands/island-rating";
import { renderBlockHtml } from "../render-block-html";

const block = {
	id: "rating-1",
	type: "rating",
	data: {
		label: "Utilité",
		style: "emoji",
		maxValue: 3,
		required: true,
		scale: [
			{ value: 1, label: "Peu utile" },
			{ value: 2, label: "Utile" },
			{ value: 3, label: "Très utile" },
		],
	},
} as unknown as PraxityBlock;

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
});

describe("rating island", () => {
	it("hovering a numeric key preserves the selected value's presentation", () => {
		document.body.innerHTML = renderBlockHtml(
			{ ...block, data: { ...block.data, style: "numeric" } },
			{ enabledIslands: new Set(["rating"]) },
		);
		const cleanup = initRatingEnhancements();
		const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		options[1].click();
		options[2].labels?.[0].dispatchEvent(new Event("pointerenter"));
		expect(options.map((input) => input.labels?.[0].getAttribute("data-rating-active"))).toEqual([
			"false",
			"true",
			"false",
		]);
		expect(options.map((input) => input.checked)).toEqual([false, true, false]);
		cleanup();
	});
	it.each(["likert", "stars", "slider"])("renders rating style %s", (style) => {
		const set = vi.fn();
		window.__praxityBlockState = { get: () => undefined, set };
		document.body.innerHTML = renderBlockHtml(
			{ ...block, data: { ...block.data, style } },
			{ enabledIslands: new Set(["rating"]) },
		);
		const cleanup = initRatingEnhancements();
		if (style === "likert")
			expect(document.querySelector(".praxity-rating-visual")?.textContent).toBe("Peu utile");
		if (style === "stars") expect(document.querySelector(".praxity-rating-stars")).not.toBeNull();
		if (style === "slider") {
			const slider = document.querySelector<HTMLInputElement>('input[type="range"]');
			if (!slider) throw new Error("Missing rating slider");
			expect(slider.disabled).toBe(false);
			expect(
				document.querySelector('[data-block-type="rating"]')?.getAttribute("data-completed"),
			).toBe("false");
			slider.value = "2";
			slider.dispatchEvent(new Event("input"));
			expect(
				document.querySelector('[data-block-type="rating"]')?.getAttribute("data-rating-value"),
			).toBe("2");
			expect(slider.getAttribute("aria-valuetext")).toContain("Utile");
			expect(set).toHaveBeenCalledWith(block.id, { value: 2 });
		}
		cleanup();
	});
	it("renders and enhances native radios in place", () => {
		document.body.innerHTML = renderBlockHtml(block, {
			enabledIslands: new Set(["rating"]),
			strings: {
				rateValueOf: "Évaluer {value} sur {count}",
				required: "Obligatoire",
			},
		});
		const root = document.querySelector<HTMLElement>('[data-block-type="rating"]');
		expect(root?.hasAttribute("data-rating-value")).toBe(false);
		expect(root?.dataset.required).toBe("true");
		expect(root?.dataset.island).toBe("rating");
		const before = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		expect(before).toHaveLength(3);
		expect(new Set(before.map((input) => input.name))).toEqual(new Set(["rating-1-rating"]));
		const group = root?.querySelector('[role="radiogroup"]');
		expect(group?.getAttribute("aria-required")).toBe("true");
		expect(root?.querySelector("[aria-invalid]")).toBeNull();
		expect(before.filter((input) => input.required)).toHaveLength(0);
		expect(before.every((input) => !input.matches(":invalid") && input.form === null)).toBe(true);
		expect(before[1]?.labels?.[0]?.textContent).toContain("Évaluer 2 sur 3: Utile");

		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);
		const cleanup = initRatingEnhancements();
		const after = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		expect(after).toEqual(before);
		expect(root?.hasAttribute("data-rating-value")).toBe(false);
		expect(group?.getAttribute("aria-required")).toBe("true");
		expect(root?.querySelector("[aria-invalid], input[required], input:invalid")).toBeNull();

		after[1]?.click();
		expect(root?.dataset.ratingValue).toBe("2");
		expect(root?.dataset.attempted).toBe("true");
		expect(root?.dataset.completed).toBe("true");
		expect(
			Array.from(document.querySelectorAll("[data-rating-active]"), (label) =>
				label.getAttribute("data-rating-active"),
			),
		).toEqual(["true", "true", "false"]);
		expect(interaction).toHaveBeenCalledWith(
			expect.objectContaining({ detail: { blockId: "rating-1", blockType: "rating" } }),
		);

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("rehydrates a valid option, clamps stale values, and writes only on change", () => {
		const get = vi.fn(() => ({ value: 99 }));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(block, {
			enabledIslands: new Set(["rating"]),
		});

		const cleanup = initRatingEnhancements();
		const root = document.querySelector<HTMLElement>('[data-block-type="rating"]');
		const options = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
		expect(get).toHaveBeenCalledWith("rating-1");
		expect(options[2]?.checked).toBe(true);
		expect(root?.dataset.ratingValue).toBe("3");
		expect(set).not.toHaveBeenCalled();

		options[0]?.click();
		expect(set).toHaveBeenCalledWith("rating-1", { value: 1 });
		cleanup();
	});

	it.each(["stars", "emoji", "numeric"] as const)("preserves the %s presentation", (style) => {
		const html = renderBlockHtml({
			...block,
			data: { ...block.data, style },
		} as PraxityBlock);

		expect(html).toContain(`data-rating-style="${style}"`);
		expect(html).toContain(`praxity-rating-${style}`);
	});

	it("hides authored feedback until selection and reveals it in one polite live region", () => {
		const withFeedback = {
			...block,
			data: { ...block.data, feedback: "Review your rating before continuing." },
		};
		document.body.innerHTML = renderBlockHtml(withFeedback, {
			enabledIslands: new Set(["rating"]),
			strings: { feedbackLabel: "Rétroaction" },
		});
		const feedback = document.querySelector<HTMLElement>("[data-rating-feedback]");
		expect(feedback?.hidden).toBe(true);
		expect(feedback?.textContent).toBe("");
		expect(feedback?.parentElement?.getAttribute("aria-live")).toBe("polite");
		const cleanup = initRatingEnhancements();
		expect(feedback?.hidden).toBe(true);
		document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]?.click();
		expect(feedback?.hidden).toBe(false);
		expect(feedback?.textContent).toContain("Rétroaction: Review your rating");
		cleanup();
	});

	it("binds course links in revealed feedback for the Guided deck", () => {
		const activate = vi.fn((_control: HTMLElement, event: Event) => event.preventDefault());
		window.__praxityActivateDeckControl = activate;
		document.body.innerHTML = renderBlockHtml(
			{
				...block,
				data: { ...block.data, feedback: 'Revisit <a href="#slide-2"><em>the practice</em></a>.' },
			},
			{ enabledIslands: new Set(["rating"]) },
		);
		const cleanup = initRatingEnhancements();
		document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]?.click();
		const link = document.querySelector<HTMLAnchorElement>("[data-rating-feedback] a");
		if (!link) throw new Error("Missing feedback link");
		const click = new MouseEvent("click", { bubbles: true, cancelable: true });
		link.querySelector("em")?.dispatchEvent(click);
		expect(activate).toHaveBeenCalledWith(link, click);
		expect(click.defaultPrevented).toBe(true);
		cleanup();
		delete window.__praxityActivateDeckControl;
	});

	it("treats a restored 0 as no selection, so no feedback appears", () => {
		window.__praxityBlockState = { get: () => ({ value: 0 }), set: vi.fn() };
		document.body.innerHTML = renderBlockHtml(
			{ ...block, data: { ...block.data, feedback: "Saved rating feedback" } },
			{ enabledIslands: new Set(["rating"]) },
		);
		const cleanup = initRatingEnhancements();
		expect(document.querySelector<HTMLElement>("[data-rating-feedback]")?.hidden).toBe(true);
		expect(document.querySelector<HTMLInputElement>('input[type="radio"]:checked')).toBeNull();
		cleanup();
	});

	it("keeps safe formatting and strips unsafe HTML from published feedback", () => {
		document.body.innerHTML = renderBlockHtml(
			{
				...block,
				data: {
					...block.data,
					feedback:
						'<strong>Thanks</strong> <img src=x onerror="alert(1)"><a href="javascript:alert(1)">more</a>',
				},
			},
			{ enabledIslands: new Set(["rating"]) },
		);
		const cleanup = initRatingEnhancements();
		document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0]?.click();
		const feedback = document.querySelector<HTMLElement>("[data-rating-feedback]");
		expect(feedback?.querySelector("strong")?.textContent).toBe("Thanks");
		expect(document.body.innerHTML).not.toMatch(/onerror|javascript:/);
		cleanup();
	});

	it("reveals feedback for restored state and omits it when unauthored", () => {
		window.__praxityBlockState = { get: () => ({ value: 2 }), set: vi.fn() };
		document.body.innerHTML = renderBlockHtml(
			{ ...block, data: { ...block.data, feedback: "Saved rating feedback" } },
			{ enabledIslands: new Set(["rating"]) },
		);
		const cleanup = initRatingEnhancements();
		expect(document.querySelector<HTMLElement>("[data-rating-feedback]")?.hidden).toBe(false);
		cleanup();
		expect(renderBlockHtml(block)).not.toContain("data-rating-feedback");
	});
});
