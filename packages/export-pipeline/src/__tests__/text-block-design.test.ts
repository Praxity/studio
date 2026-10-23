import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderBlockHtml } from "../render-block-html";

function documentFor(type: string, data: Record<string, unknown>) {
	return new JSDOM(renderBlockHtml({ id: "reading", type, data } as PraxityBlock)).window.document;
}

describe("section 5 text block output", () => {
	it("keeps a run-in label within grammar's identity wrapper", () => {
		const document = documentFor("note", {
			title: "Read $& carefully",
			content: '<div data-node-id="paragraph"><p>First paragraph.</p></div>',
		});
		expect(document.querySelector('[data-node-id="paragraph"] > p')?.textContent).toBe(
			"Read $& carefully First paragraph.",
		);
	});
	it.each(["error", "danger"])("preserves the %s note's own label and warning symbol", (color) => {
		const document = documentFor("note", { color, content: "<p>Stop here.</p>" });
		expect(document.querySelector(".praxity-note-label")?.textContent).toBe("Error");
		expect(document.querySelector("aside")?.getAttribute("data-color")).toBe("error");
		expect(document.querySelector("svg")?.getAttribute("width")).toBe("20");
	});
	it.each(["accent", "info", "tip", "neutral", "success"])("maps %s onto a plain Note", (color) => {
		const document = documentFor("note", { color, icon: "book", content: "<p>Read this.</p>" });
		expect(document.querySelector(".praxity-note-label")?.textContent).toBe("Note");
		expect(document.querySelector("svg")).toBeNull();
	});
	it("places the note label inline before the first paragraph without losing later paragraphs", () => {
		const document = documentFor("note", {
			title: "Remember",
			content: "<p>First paragraph.</p><p>Second paragraph.</p>",
		});
		const first = document.querySelector(".praxity-note-body > p");
		expect(first?.textContent).toBe("Remember First paragraph.");
		expect(first?.querySelector("strong")?.textContent).toBe("Remember");
		expect(document.querySelectorAll(".praxity-note-body > p")).toHaveLength(2);
	});
	it.each(["default", "large", "very-large"])(
		"retains authored quote size %s without an attribution prefix",
		(size) => {
			const document = documentFor("quote", { text: "Read this.", speaker: "The author", size });
			expect(document.querySelector("figure")?.getAttribute("data-size")).toBe(size);
			expect(document.querySelector("figcaption")?.textContent).toBe("The author");
		},
	);
	it("puts a table caption above its scroll region, with a localized scrolling hint", () => {
		const document = documentFor("table", {
			headers: ["Name", "Description"],
			rows: [["A", "B"]],
			caption: "Reference",
		});
		const figure = document.querySelector("figure");
		expect(figure?.firstElementChild?.textContent).toBe("Reference");
		expect(document.querySelector(".praxity-table-scroll-hint")?.textContent).toBe(
			"Scroll for more",
		);
	});
	it("numbers timeline markers in their ordered sequence", () => {
		const document = documentFor("sequence", {
			variant: "timeline",
			items: [
				{ id: "first", label: "1999", children: [] },
				{ id: "second", label: "2008", children: [] },
			],
		});
		expect(
			Array.from(document.querySelectorAll(".praxity-accent-badge")).map((e) => e.textContent),
		).toEqual(["1", "2"]);
	});
});
