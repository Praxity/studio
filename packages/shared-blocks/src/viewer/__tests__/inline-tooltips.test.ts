// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { initInlineTooltips } from "../inline-tooltips";

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	document.body.innerHTML = "";
	document.documentElement.removeAttribute("lang");
});

it("marks actual new-tab definition links even when titles and labels resemble markup", () => {
	const trigger = document.createElement("button");
	trigger.textContent = "Term";
	trigger.setAttribute(
		"data-tooltip-content",
		`<a title="A > B" target="_blank" href="https://example.com/new">praxity-external-icon</a> <a title="target='_blank'" href="https://example.com/same">Same tab</a>`,
	);
	document.body.appendChild(trigger);
	cleanup = initInlineTooltips("Definition available", "(opens in a new tab)");
	trigger.click();
	const newTab = document.querySelector('[role="definition"] a[target="_blank"]');
	expect(newTab?.querySelector(".praxity-external-icon")?.getAttribute("aria-hidden")).toBe("true");
	expect(newTab?.querySelector(".praxity-sr-only")?.textContent).toContain("(opens in a new tab)");
	expect(
		document.querySelector('a[href="https://example.com/same"] .praxity-external-icon'),
	).toBeNull();
});

it("keeps the French definition language separate from its English glossary action", () => {
	document.documentElement.lang = "en";
	document.body.innerHTML =
		'<button lang="fr" data-tooltip-content="Une aide disponible.">aide</button>';
	document
		.querySelector("button")
		?.setAttribute(
			"data-tooltip-content",
			'Une aide <a href="https://example.com/source" target="_blank">disponible</a>.',
		);
	cleanup = initInlineTooltips("Definition available", "(opens in a new tab)", {
		href: "glossary.html",
		label: "Full glossary",
	});
	document.querySelector<HTMLButtonElement>("button")?.click();
	const definition = document.querySelector('[id$="-definition"]');
	const action = document.querySelector(".praxity-glossary-link");
	expect(definition?.closest("[lang]")?.getAttribute("lang")).toBe("fr");
	expect(definition?.querySelector("a .praxity-sr-only")?.getAttribute("lang")).toBe("en");
	expect(action?.closest("[lang]")?.getAttribute("lang")).toBe("en");
	expect(action?.hasAttribute("aria-label")).toBe(false);
});

it("enhances an authored glossary term even when it already has term semantics", () => {
	document.body.innerHTML =
		'<span role="term" class="inline-tooltip-trigger" data-tooltip-content="Protective equipment">PPE</span>';
	cleanup = initInlineTooltips("Definition available", "(opens in a new tab)");
	const term = document.querySelector<HTMLElement>("[data-tooltip-content]");
	term?.click();
	expect(document.querySelector('[role="definition"]')?.textContent).toContain(
		"Protective equipment",
	);
	term?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	term?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
	expect(term?.getAttribute("aria-expanded")).toBe("true");
});
