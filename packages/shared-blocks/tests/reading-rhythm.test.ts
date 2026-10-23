import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const rhythmCss = readFileSync(
	resolve(import.meta.dirname, "../src/blocks/shared-blocks.css"),
	"utf8",
).replace(/^@import[^;]+;/, "");
const typeCss = readFileSync(resolve(import.meta.dirname, "../src/reading-rhythm.css"), "utf8");

afterEach(() => {
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("published type scale", () => {
	it("owns six sizes, two weights, line heights and the spacing scale", () => {
		for (const [role, value] of [
			["small", "0.9375rem"],
			["body", "1.1875rem"],
			["lead", "1.375rem"],
			["h3", "1.5rem"],
			["h2", "1.875rem"],
			["h1", "2.375rem"],
		])
			expect(typeCss).toContain(`--type-${role}: ${value}`);
		for (const [role, value] of [
			["body", "1.125rem"],
			["lead", "1.25rem"],
			["h3", "1.3125rem"],
			["h2", "1.5625rem"],
			["h1", "1.875rem"],
		])
			expect(typeCss).toContain(`--type-${role}: ${value}`);
		for (const [name, value] of [
			["weight-body", "400"],
			["weight-strong", "600"],
			["leading-body", "1.55"],
			["leading-heading", "1.2"],
			["leading-small", "1.45"],
			["measure", "66ch"],
		])
			expect(typeCss).toContain(`--${name}: ${value}`);
		for (const [step, value] of [
			[1, 4],
			[2, 8],
			[3, 12],
			[4, 16],
			[6, 24],
			[8, 32],
			[12, 48],
			[16, 64],
			[24, 96],
		])
			expect(typeCss).toContain(`--space-${step}: ${value}px`);
	});
	it("scales the complete type system at the learner's large text step", () => {
		expect(typeCss).toMatch(/data-praxity-text-size="large"[\s\S]*?--root-font-size: 20px/);
		expect(typeCss).not.toContain("--praxity-heading-size");
	});
});

describe("published block rhythm", () => {
	it.each([
		["text", undefined],
		["assessment", undefined],
		["note", undefined],
		["divider", undefined],
		["heading", 1],
		["heading", 2],
		["heading", 3],
		["heading", 4],
	] as const)(
		"spaces %s at heading level %s after a closed assessment group like an ordinary assessment",
		(type, level) => {
			const expected = gap("assessment", type, undefined, level);
			document.body.innerHTML = `<main data-praxity-root>
			<div class="praxity-assessment-group-submit" data-assessment-group-submit="journal"></div>
			<div class="praxity-block" data-block-type="${type}"${level ? ` data-heading-level="${level}"` : ""}></div>
		</main>`;
			const target = document.querySelector(".praxity-block");
			expect(target).not.toBeNull();
			if (!target) return;
			expect(getComputedStyle(target).getPropertyValue("--praxity-flow-gap").trim()).toBe(expected);
		},
	);

	function gap(from: string, to: string, fromLevel?: number, toLevel?: number): string {
		document.head.innerHTML = `<style>${rhythmCss}</style>`;
		document.body.innerHTML = `<main data-praxity-root><div data-block-type="${from}"${fromLevel ? ` data-heading-level="${fromLevel}"` : ""}></div><div data-block-type="${to}"${toLevel ? ` data-heading-level="${toLevel}"` : ""}></div></main>`;
		const target = document.body.lastElementChild?.lastElementChild;
		return target ? getComputedStyle(target).getPropertyValue("--praxity-flow-gap").trim() : "";
	}

	it.each([
		["future", "future", "var(--praxity-space-normal)"],
		["text", "text", "var(--praxity-space-close)"],
		["text", "checklist", "var(--praxity-space-close)"],
		["checklist", "text", "var(--praxity-space-close)"],
		["text", "note", "var(--praxity-space-normal)"],
		["quote", "text", "var(--praxity-space-normal)"],
		["text", "table", "var(--praxity-space-section)"],
		["columns", "text", "var(--praxity-space-section)"],
		["note", "quote", "var(--praxity-space-section)"],
		["table", "assessmentGroup", "var(--praxity-space-section)"],
		["text", "divider", "var(--praxity-space-section)"],
		["divider", "text", "var(--praxity-space-section)"],
		["text", "button", "var(--praxity-space-close)"],
		["button", "text", "var(--praxity-space-normal)"],
		["button", "button", "var(--praxity-space-tight)"],
	] as const)("maps %s -> %s to %s", (from, to, expected) => {
		expect(gap(from, to)).toBe(expected);
	});

	it.each([
		["text", "heading", undefined, 1, "var(--praxity-space-boundary)"],
		["text", "heading", undefined, 2, "var(--praxity-section-gap,var(--praxity-space-section))"],
		["text", "heading", undefined, 3, "var(--praxity-space-normal)"],
		["text", "heading", undefined, 4, "var(--praxity-space-close)"],
		["heading", "table", 1, undefined, "var(--praxity-space-normal)"],
		["heading", "columns", 2, undefined, "var(--praxity-space-close)"],
		["heading", "assessment", 3, undefined, "var(--praxity-space-tight)"],
		["heading", "text", 4, undefined, "var(--praxity-space-tight)"],
		["heading", "heading", 1, 2, "var(--praxity-space-tight)"],
	] as const)("heading precedence %s/%s at %s/%s", (from, to, fromLevel, toLevel, expected) => {
		expect(gap(from, to, fromLevel, toLevel)).toBe(expected);
	});

	it("passes a slot gap to its block without leaking it into a nested flow", () => {
		document.head.innerHTML = `<style>${rhythmCss}</style>`;
		document.body.innerHTML = `<main data-praxity-root>
			<div class="praxity-block-slot" data-block-type="text"><div class="praxity-block" data-block-type="text"></div></div>
			<div class="praxity-block-slot" data-block-type="columns"><div class="praxity-block" data-block-type="columns"><div class="praxity-columns"><div class="praxity-block" data-block-type="heading" data-heading-level="3"></div></div></div></div>
		</main>`;
		const outer = document.querySelector<HTMLElement>(
			'.praxity-block-slot[data-block-type="columns"] > .praxity-block',
		);
		const inner = document.querySelector<HTMLElement>(
			'.praxity-columns > [data-block-type="heading"]',
		);
		expect(outer).not.toBeNull();
		expect(inner).not.toBeNull();
		if (!outer || !inner) return;

		expect(getComputedStyle(outer).getPropertyValue("--praxity-flow-gap").trim()).toBe(
			"var(--praxity-space-section)",
		);
		expect(getComputedStyle(inner).getPropertyValue("--praxity-flow-gap").trim()).toBe("0px");
	});
});
