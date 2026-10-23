import { fileURLToPath } from "node:url";
import { getRetrievalSheetStrings } from "@praxity/shared-blocks/i18n/retrieval-sheet-strings";
import type { RetrievalSheetContent } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { strings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import { describe, expect, it } from "vitest";
import { viewerSourceFiles } from "../bundle-viewer.ts";
import { desktopCssInputs } from "../export-css.ts";
import { renderRetrievalSheet } from "../patterns/retrieval-sheet/render.ts";
import { sanitizeBlockForJson } from "../published-markup.ts";
import fixtures from "./fixtures/retrieval-sheet-render.json";

const content: RetrievalSheetContent = {
	title: "Recall later",
	questions: [{ id: "q1", question: "What matters?", answer: "People." }],
};
const render = (value = content, id = "sheet", lang = "en", headingLevel = 2) =>
	renderRetrievalSheet(value, {
		prefix: `${id}-retrieval`,
		lang,
		headingLevel,
		strings: strings[lang === "fr" ? "fr" : "en"],
		noDate: getRetrievalSheetStrings(lang).retrievalNoDate,
	});

describe("retrieval-sheet server baseline", () => {
	it.each(fixtures)("literal $locale HTML with $rows rows", ({ locale, content, html }) => {
		expect(render(content, "sheet", locale)).toBe(html);
	});
	it.each([1, 2, 3, 4, 5, 6])("uses resolved heading level %s", (level) => {
		const document = new JSDOM(render(content, "sheet", "en", level)).window.document;
		expect(document.querySelector(`#sheet-retrieval-title`)?.tagName).toBe(`H${level}`);
		expect(document.querySelector(`#sheet-retrieval-front-heading`)?.tagName).toBe(
			`H${Math.min(6, level + 1)}`,
		);
		expect(document.querySelector(`#sheet-retrieval-back-heading`)?.tagName).toBe(
			`H${Math.min(6, level + 1)}`,
		);
	});

	it.each([
		{ value: -3, expected: 1 },
		{ value: 0, expected: 1 },
		{ value: 9, expected: 6 },
		{ value: 3.9, expected: 3 },
		{ value: Number.NaN, expected: 2 },
		{ value: Number.POSITIVE_INFINITY, expected: 2 },
	])("clamps heading level $value to $expected", ({ value, expected }) => {
		const dom = new JSDOM(render(content, "sheet", "en", value));
		try {
			expect(
				dom.window.document.querySelector("[data-retrieval-sheet] > :first-child")?.tagName,
			).toBe(`H${expected}`);
			expect(
				dom.window.document.querySelector("[data-retrieval-side] > :first-child")?.tagName,
			).toBe(`H${Math.min(6, expected + 1)}`);
		} finally {
			dom.window.close();
		}
	});
	it("renders hostile text literally without rich-text collectors or attribute injection", () => {
		const hostile =
			'<img src=x onerror="alert(1)"> [term]{definition} @footer{note} @icon{star} & <script>bad()</script>';
		const document = new JSDOM(
			render(
				{
					title: hostile,
					questions: [{ id: '" onclick=bad', question: hostile, answer: hostile }],
				},
				'" onmouseover=bad',
				'" onfocus=bad',
			),
		).window.document;
		expect(
			document.querySelectorAll("img, script, svg, a, [onclick], [onmouseover], [onfocus]"),
		).toHaveLength(0);
		expect(document.querySelector("h2")?.textContent).toBe(hostile);
		expect([...document.querySelectorAll("li > p")].map((p) => p.textContent)).toEqual([
			hostile,
			hostile,
		]);
		expect(document.querySelector("[data-retrieval-sheet]")?.getAttribute("lang")).toBe(
			'" onfocus=bad',
		);
	});
	it("keeps instance IDs unique and both sides readable with no JS-only controls", () => {
		const document = new JSDOM(render() + render(content, "second", "fr")).window.document;
		const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(document.querySelectorAll("ol")).toHaveLength(4);
		expect(
			document.querySelectorAll("button, input, [role=tab], [role=tablist], [role=region], time"),
		).toHaveLength(0);
		expect(document.querySelectorAll("[data-retrieval-side][hidden]")).toHaveLength(0);
		expect(document.querySelectorAll("[data-retrieval-controls][hidden]:empty")).toHaveLength(2);
		expect(document.querySelectorAll("[data-retrieval-date-line]")).toHaveLength(2);
		expect(document.querySelector("[data-retrieval-date-line]")?.textContent).toBe("");
	});
});

it("preserves literal fields before dispatch, including nested sheets", () => {
	const literal = "<script>literal</script> @icon{star} [term]{definition} & text";
	const sheet = {
		id: "sheet",
		type: "retrievalSheet" as const,
		data: {
			level: 2,
			content: {
				title: literal,
				questions: [{ id: "q", question: literal, answer: literal }],
			},
		},
	};
	expect(sanitizeBlockForJson(sheet)).toEqual(sheet);
	const outer = {
		id: "outer",
		type: "accordion" as const,
		data: { items: [{ id: "item", blocks: [sheet] }] },
	};
	expect(sanitizeBlockForJson(outer).data.items).toEqual(outer.data.items);
});

it("inventories the exclusive CSS for hashes and offline delivery alongside its explicit bundle entry", async () => {
	const css = fileURLToPath(new URL("../patterns/retrieval-sheet/style.css", import.meta.url));
	expect(await viewerSourceFiles()).toContain(css);
	expect(await desktopCssInputs()).toContainEqual(
		expect.objectContaining({
			source: css,
			assetPath: "css-sources/patterns/retrieval-sheet/style.css",
		}),
	);
});
