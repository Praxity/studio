// @vitest-environment jsdom

import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initLabeledGraphicEnhancements } from "../../template/src/islands/island-labeled-graphic";
import { renderBlockHtml } from "../render-block-html";

const labels = [
	{
		id: "one",
		x: -10,
		y: 25,
		title: "First",
		body: '<p>Safe <strong>body</strong><img src="x" onerror="bad()"></p><script>bad()</script>',
	},
	{ id: "two", x: 50, y: 50, title: "Second", body: "Second body" },
	{ id: "three", x: 110, y: 75, title: "Third", body: "Third body" },
];

function block(reveal: "all" | "click" | "sequential"): PraxityBlock {
	return {
		id: "diagram",
		type: "labeledGraphic",
		data: {
			imageSrc: "assets/diagram.png",
			imageAlt: "Annotated diagram",
			intrinsicWidth: 1200,
			intrinsicHeight: 675,
			loading: "eager",
			fetchPriority: "high",
			labels,
			reveal,
		},
	} as unknown as PraxityBlock;
}

afterEach(() => {
	document.body.innerHTML = "";
	delete window.__praxityBlockState;
});

describe("published labeled graphic", () => {
	it.each(["en", "fr"] as const)(
		"associates the %s order instruction with sequential pins",
		(locale) => {
			document.body.innerHTML = renderBlockHtml(block("sequential"), {
				enabledIslands: new Set(["labeledGraphic"]),
				strings: getStrings(locale),
			});
			const instruction = document.querySelector<HTMLElement>(".praxity-labeled-graphic-hint");
			expect(instruction?.textContent).toBe(
				locale === "en"
					? "Explore the numbered pins in order. Later pins become available after the preceding pin."
					: "Explorez les épingles numérotées dans l'ordre. Les épingles suivantes deviennent disponibles après la précédente.",
			);
			expect(instruction?.id).toBe("diagram-label-instructions");
			for (const control of document.querySelectorAll(
				".praxity-labeled-graphic-dot, .praxity-labeled-graphic[role=group]",
			)) {
				expect(control.getAttribute("aria-describedby")).toBe(instruction?.id);
			}
		},
	);

	it("keeps unrestricted instructions and omits instructions for empty graphics", () => {
		document.body.innerHTML = renderBlockHtml(block("click"));
		expect(document.querySelector(".praxity-labeled-graphic-hint")?.textContent).toBe(
			"Select the numbered pins to explore",
		);
		const empty = block("sequential");
		empty.data = { ...empty.data, labels: [] };
		document.body.innerHTML = renderBlockHtml(empty);
		expect(document.querySelector(".praxity-labeled-graphic-hint")).toBeNull();
		expect(document.querySelector("[aria-describedby]")).toBeNull();
	});

	it("gives each graphic its own instruction target", () => {
		const second = { ...block("sequential"), id: "another-diagram" };
		document.body.innerHTML = renderBlockHtml(block("sequential")) + renderBlockHtml(second);
		const instructions = [
			...document.querySelectorAll<HTMLElement>(".praxity-labeled-graphic-hint"),
		];
		expect(instructions.map((hint) => hint.id)).toEqual([
			"diagram-label-instructions",
			"another-diagram-label-instructions",
		]);
		for (const [index, group] of [
			...document.querySelectorAll(".praxity-labeled-graphic"),
		].entries()) {
			expect(document.getElementById(group.getAttribute("aria-describedby") ?? "")).toBe(
				instructions[index],
			);
			for (const button of group.querySelectorAll("button")) {
				expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")).toBe(
					instructions[index],
				);
			}
		}
	});

	it("restores only a contiguous partial sequence and keeps its order explanation", () => {
		window.__praxityBlockState = {
			get: () => ({ revealedIds: ["one", "three"], activeId: "three" }),
			set: () => {},
		};
		document.body.innerHTML = renderBlockHtml(block("sequential"), {
			enabledIslands: new Set(["labeledGraphic"]),
		});
		const cleanup = initLabeledGraphicEnhancements();
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>(".praxity-labeled-graphic-dot"),
		];
		expect(buttons.map((button) => button.disabled)).toEqual([false, false, true]);
		expect(buttons.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
		expect(document.querySelector("[data-labeled-graphic-progress]")?.textContent).toBe(
			"1 of 3 revealed",
		);
		buttons[0].focus();
		buttons[0].click();
		expect(document.activeElement).toBe(buttons[0]);
		expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
		expect(buttons[0].getAttribute("aria-describedby")).toBe("diagram-label-instructions");
		cleanup();
	});

	it("blocks out-of-order activation, completes the sequence and reopens every revealed description", () => {
		document.body.innerHTML = renderBlockHtml(block("sequential"), {
			enabledIslands: new Set(["labeledGraphic"]),
		});
		const cleanup = initLabeledGraphicEnhancements();
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>(".praxity-labeled-graphic-dot"),
		];
		const popovers = [
			...document.querySelectorAll<HTMLElement>(".praxity-labeled-graphic-popover"),
		];
		const progress = document.querySelector("[data-labeled-graphic-progress]");
		buttons[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(progress?.textContent).toBe("0 of 3 revealed");
		expect(popovers.every((popover) => popover.hidden)).toBe(true);
		for (const button of buttons) {
			button.focus();
			button.click();
			expect(document.activeElement).toBe(button);
			expect(button.disabled).toBe(false);
		}
		expect(progress?.textContent).toBe("3 of 3 revealed");
		for (const [index, button] of buttons.entries()) {
			button.focus();
			button.click();
			expect(document.activeElement).toBe(button);
			expect(popovers.map((popover) => popover.hidden)).toEqual(
				buttons.map((_, candidate) => candidate !== index),
			);
			expect(progress?.textContent).toBe("3 of 3 revealed");
		}
		cleanup();
	});

	it("retains a sanitized ordered list of every description without JavaScript", () => {
		const html = renderBlockHtml(block("sequential"));
		document.body.innerHTML = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
		const items = [...document.querySelectorAll("ol li")];
		expect(items.map((item) => item.querySelector("strong")?.textContent)).toEqual([
			"First",
			"Second",
			"Third",
		]);
		expect(items.map((item) => item.textContent)).toEqual([
			"FirstSafe body",
			"SecondSecond body",
			"ThirdThird body",
		]);
		expect(document.querySelector("script, [onerror]")).toBeNull();
	});
	it.each(["all", "click", "sequential"] as const)(
		"honors decorative backgrounds in %s markup without losing the group name",
		(reveal) => {
			for (const imageAlt of ["", "Annotated diagram"]) {
				for (const flags of [
					{ data: { decorative: true }, decorative: true },
					{ data: {}, a11y: { decorative: true }, decorative: true },
					{ data: {}, decorative: false },
					{ data: { decorative: false }, decorative: false },
					{ data: { decorative: "true" }, decorative: false },
				]) {
					const graphic = block(reveal);
					graphic.data = { ...graphic.data, ...flags.data, imageAlt };
					graphic.a11y = flags.a11y;
					document.body.innerHTML = renderBlockHtml(graphic);
					const group = document.querySelector('.praxity-labeled-graphic[role="group"]');
					const image = group?.querySelector("img");
					expect(image?.getAttribute("alt"), JSON.stringify(flags)).toBe(
						flags.decorative ? "" : imageAlt || "Labeled graphic",
					);
					expect(image?.getAttribute("role")).toBe(flags.decorative ? "presentation" : null);
					expect(group?.getAttribute("aria-label")).toBe(imageAlt || "Labeled graphic");
				}
			}
		},
	);

	it("renders reveal-all as sized, sanitized static HTML", () => {
		const html = renderBlockHtml(block("all"), {
			enabledIslands: new Set(["labeledGraphic"]),
		});

		expect(html).toContain('data-reveal="all"');
		expect(html).toContain('width="1200" height="675" loading="eager" fetchpriority="high"');
		expect(html).toContain("<strong>First</strong>");
		expect(html).toContain("Safe <strong>body</strong>");
		expect(html).not.toContain("onerror");
		expect(html).not.toContain("<script");
		expect(html).toContain('style="left:0%;top:25%"');
		expect(html).toContain('style="left:100%;top:75%"');
		expect(html).toContain('data-label-id="one"');
		expect(html).not.toContain("<button");
		expect(html).not.toContain('data-island="labeledGraphic"');
		expect(html).not.toContain("data-block-json");
	});

	it("reveals sequential pins in place without disabling the focused pin", () => {
		const html = renderBlockHtml(block("sequential"), {
			enabledIslands: new Set(["labeledGraphic"]),
			strings: {
				labeledGraphicClickToReveal: "Sélectionnez les épingles",
				labeledGraphicProgress: "{revealed} sur {total} révélés",
			},
		});
		document.body.innerHTML = html;
		const root = document.querySelector<HTMLElement>('[data-block-type="labeledGraphic"]');
		expect(root?.dataset.island).toBe("labeledGraphic");
		expect(root?.hasAttribute("data-block-json")).toBe(false);
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction);
		const cleanup = initLabeledGraphicEnhancements();
		const buttons = Array.from(
			document.querySelectorAll<HTMLButtonElement>(".praxity-labeled-graphic-dot"),
		);
		const progress = document.querySelector<HTMLElement>("[data-labeled-graphic-progress]");

		expect(buttons.map((button) => button.disabled)).toEqual([false, true, true]);
		expect(progress?.textContent).toBe("0 sur 3 révélés");
		buttons[0]?.focus();
		buttons[0]?.click();
		expect(document.activeElement).toBe(buttons[0]);
		expect(buttons.map((button) => button.disabled)).toEqual([false, false, true]);
		expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
		expect(progress?.textContent).toBe("1 sur 3 révélés");
		expect(interaction).toHaveBeenCalledOnce();

		buttons[0]?.click();
		expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
		expect(progress?.textContent).toBe("1 sur 3 révélés");
		expect(interaction).toHaveBeenCalledOnce();

		buttons[1]?.click();
		expect(buttons.map((button) => button.disabled)).toEqual([false, false, false]);
		expect(buttons[1]?.getAttribute("aria-expanded")).toBe("true");
		expect(progress?.textContent).toBe("2 sur 3 révélés");
		expect(interaction).toHaveBeenCalledTimes(2);

		cleanup();
		document.removeEventListener("praxity:block-interaction", interaction);
	});

	it("lets any click-reveal pin open while progress counts unique reveals", () => {
		document.body.innerHTML = renderBlockHtml(block("click"), {
			enabledIslands: new Set(["labeledGraphic"]),
		});
		const cleanup = initLabeledGraphicEnhancements();
		const buttons = Array.from(
			document.querySelectorAll<HTMLButtonElement>(".praxity-labeled-graphic-dot"),
		);
		const popovers = Array.from(
			document.querySelectorAll<HTMLElement>(".praxity-labeled-graphic-popover"),
		);
		const progress = document.querySelector<HTMLElement>("[data-labeled-graphic-progress]");

		expect(buttons.every((button) => !button.disabled)).toBe(true);
		buttons[2]?.click();
		expect(popovers[2]?.hidden).toBe(false);
		expect(progress?.textContent).toBe("1 of 3 revealed");
		buttons[0]?.click();
		expect(popovers[2]?.hidden).toBe(true);
		expect(popovers[0]?.hidden).toBe(false);
		expect(progress?.textContent).toBe("2 of 3 revealed");
		buttons[0]?.click();
		expect(popovers[0]?.hidden).toBe(true);
		expect(progress?.textContent).toBe("2 of 3 revealed");

		cleanup();
	});

	it("rehydrates only valid reveals and the active pin", () => {
		const get = vi.fn(() => ({
			revealedIds: ["two", "one", "removed"],
			activeId: "two",
		}));
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		document.body.innerHTML = renderBlockHtml(block("sequential"), {
			enabledIslands: new Set(["labeledGraphic"]),
		});

		const cleanup = initLabeledGraphicEnhancements();
		const buttons = Array.from(
			document.querySelectorAll<HTMLButtonElement>(".praxity-labeled-graphic-dot"),
		);
		const popovers = Array.from(
			document.querySelectorAll<HTMLElement>(".praxity-labeled-graphic-popover"),
		);
		const progress = document.querySelector<HTMLElement>("[data-labeled-graphic-progress]");
		expect(get).toHaveBeenCalledWith("diagram");
		expect(buttons.map((button) => button.disabled)).toEqual([false, false, false]);
		expect(popovers.map((popover) => popover.hidden)).toEqual([true, false, true]);
		expect(progress?.textContent).toBe("2 of 3 revealed");
		expect(set).not.toHaveBeenCalled();

		buttons[2]?.click();
		expect(set).toHaveBeenCalledWith("diagram", {
			revealedIds: ["one", "two", "three"],
			activeId: "three",
		});
		cleanup();
	});

	it("ignores old positional learner state", () => {
		const set = vi.fn();
		window.__praxityBlockState = {
			get: () => ({ revealed: [0, 1], active: 1 }),
			set,
		};
		document.body.innerHTML = renderBlockHtml(block("sequential"), {
			enabledIslands: new Set(["labeledGraphic"]),
		});

		const cleanup = initLabeledGraphicEnhancements();
		const buttons = Array.from(
			document.querySelectorAll<HTMLButtonElement>(".praxity-labeled-graphic-dot"),
		);
		const progress = document.querySelector<HTMLElement>("[data-labeled-graphic-progress]");
		expect(buttons.map((button) => button.disabled)).toEqual([false, true, true]);
		expect(progress?.textContent).toBe("0 of 3 revealed");
		expect(set).not.toHaveBeenCalled();
		cleanup();
	});
});
