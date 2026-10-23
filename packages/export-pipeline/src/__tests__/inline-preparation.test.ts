// @vitest-environment jsdom
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import {
	materializeInlineIcons,
	prepareInlineBlocks,
} from "@praxity/shared-blocks/inline-markdown";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import { describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { renderBlockHtml } from "../render-block-html";
import { planPageRuntime } from "../runtime-plan";

function prepare(source: string) {
	const blocks = prepareInlineBlocks(adaptGrammarPreviewBlocks(readBlockSource(source).blocks));
	materializeInlineIcons(blocks, { outline: { mail: [["path", { d: "M1 1" }]] }, filled: {} });
	return preparePageFootnotes(blocks, "page", { footnote: "Footnote", footnotes: "Sources" });
}

describe("prepared inline output", () => {
	it("renders caption icons, math and sources and plans late-field glossary behavior", () => {
		const blocks = prepare(
			"# Untitled {hideTitle}\n\n::: figure\n![Example](/assets/image.png)\n**Mail** @icon{mail} [PPE]{Protective equipment} @source{Source}\n:::\n",
		);
		const html = blocks.map((block) => renderBlockHtml(block)).join("");
		expect(html).toContain("<strong>Mail</strong>");
		expect(html).toContain("<svg");
		expect(html).toContain("<li>Source</li>");
		expect(html).toContain("[1]");
		const plan = planPageRuntime({ sourceLocale: "en" }, { id: "p", title: "Page", blocks }, true);
		expect(plan.islands).toContain("tooltip");
	});

	it("renders table content and safe container labels from the prepared fields", () => {
		const blocks = prepare(
			"# Untitled {hideTitle}\n\n| Action | Source |\n| **Mail** @icon{mail} | Evidence @source{Citation} |\n\n::: accordion\n:: [Details](https://example.com) @icon{mail} {level=3}\nBody\n:::\n",
		);
		const html = blocks.map((block) => renderBlockHtml(block)).join("");
		expect(html).toContain("<strong>Mail</strong>");
		const root = document.createElement("div");
		root.innerHTML = html;
		expect(root.querySelectorAll("svg:not(.praxity-disclosure-icon)")).toHaveLength(2);
		const disclosureIcons = root.querySelectorAll("svg.praxity-disclosure-icon");
		expect(disclosureIcons).toHaveLength(1);
		expect(disclosureIcons[0].getAttribute("aria-hidden")).toBe("true");
		expect(disclosureIcons[0].getAttribute("focusable")).toBe("false");
		expect(html).toContain("<li>Citation</li>");
		expect(html).not.toContain('href="https://example.com"');
	});

	it("does not load a doodle runtime for icon or footnote source retained beside prepared HTML", () => {
		const blocks = prepare(
			"# Untitled {hideTitle}\n\n::: figure\n![Example](/assets/image.png)\n@icon{mail} @source{Source}\n:::\n",
		);
		expect(
			planPageRuntime({ sourceLocale: "en" }, { id: "p", title: "Page", blocks }, true).islands,
		).not.toContain("doodle");
	});

	it("keeps inline math in the canonical text baseline", () => {
		const html = renderBlockHtml({
			id: "math",
			type: "text",
			data: {
				content: '<p>Value <span class="praxity-math-inline" data-math-latex="x^2">x^2</span></p>',
			},
		});
		expect(html).toContain("katex");
		expect(html).toContain("<math");
	});

	it("keeps doodles static and preserves metadata in assessment feedback", () => {
		const blocks = prepare(
			'# Untitled {hideTitle}\n\n::: choice Choose an answer {level=3}\nincorrect: @highlight.purple{Review "The calibration of a telescope".}\n(x) Right\n( ) Wrong\n:::\n',
		);
		const plan = planPageRuntime({ sourceLocale: "en" }, { id: "p", title: "Page", blocks }, true);
		expect(plan.islands).not.toContain("doodle");
		expect(plan.islands).toContain("assessment");
		expect(JSON.stringify(blocks)).toContain('data-doodle=\\"highlight\\"');
		expect(JSON.stringify(blocks)).toContain('data-doodle-mods=\\"purple\\"');
	});

	it("retains assessment stem formatting before island activation", () => {
		const blocks = prepare(
			"::: choice Choose **Mail** @icon{mail} {level=3}\n[x] Mail\n[ ] Other\n:::\n",
		);
		const html = blocks.map((block) => renderBlockHtml(block)).join("");
		expect(html).toContain("<strong>Mail</strong>");
		expect(html).toContain("<svg");
	});
});
