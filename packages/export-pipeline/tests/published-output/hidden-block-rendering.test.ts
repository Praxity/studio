import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";
import { renderBlockHtml } from "../../src/render-block-html";
import { EXPORTABLE_HIDDEN_BLOCK_TYPES, HIDDEN_BLOCKS } from "../a11y/fixtures/lightweight-fixture";

// Every parser-reachable hidden type must carry its learner content in server
// HTML. An island may enhance that baseline, never substitute for it.
const STATIC_SEMANTIC_SELECTORS: Record<string, string> = {
	chart: "table.praxity-chart-data",
	code: "pre code",
	equation: ".praxity-equation, .katex, math",
	sequence: "ol.praxity-sequence",
	document: "a[href]",
};

describe("hidden block static export", () => {
	test("fixture stays synchronized with parser-reachable hidden types", () => {
		expect(HIDDEN_BLOCKS.map((block) => block.type).sort()).toEqual(
			[...EXPORTABLE_HIDDEN_BLOCK_TYPES].sort(),
		);
	});

	test.each(HIDDEN_BLOCKS)("$type has a semantic server-rendered baseline", (block) => {
		const selector = STATIC_SEMANTIC_SELECTORS[block.type];
		expect(selector, `${block.type} lacks a semantic baseline assertion`).toBeDefined();
		const document = new JSDOM(renderBlockHtml(block)).window.document;
		expect(
			document.querySelector(selector ?? "missing-selector"),
			`${block.type} exports only an empty data-block wrapper before hydration`,
		).toBeTruthy();
	});
});
