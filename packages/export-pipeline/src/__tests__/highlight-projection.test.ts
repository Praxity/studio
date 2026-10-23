// @vitest-environment jsdom
import { readHighlightContent, readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { escapeJsonForHtml } from "../escape-json-for-html";
import { collectGlossaryTerms } from "../glossary-page";
import { assertPracticeLogic, escapeJsonForScript } from "../html-gen";
import { sanitizeBlockForJson } from "../published-markup";
import { renderBlockHtml } from "../render-block-html";
import { pageHasTooltipMarkup } from "../runtime-plan";

it.each(["en", "fr", "fr-CA"])(
	"round-trips hostile literal content through inert page JSON in %s",
	(locale) => {
		const text =
			'<script>hostile()</script> </script> &amp; &lt; " \' [term]\\{definition} @icon{star} @footer{note} <span data-mention="blockOutput:mark:score">value</span> inline-tooltip-trigger';
		const note = '</script><img src=x onerror="hostile()"> &amp; " \' @footer{hostile}';
		const read = readLesson(
			`---\nlang: ${locale}\n---\n# P\n::: highlight <script>Title</script> {name=mark}\nquestion: Literal ? ! : ; « »\n:: ${text} {key=true}\nnote: ${note}\n:::\n`,
		);
		expect(read.diagnostics).toEqual([]);
		const block = read.blocks.find((b) => b.type === "highlight")!;
		const content = readHighlightContent(read, block.id);
		const safe = sanitizeBlockForJson(block);
		expect(safe.data.content).toEqual(content);
		expect(content.paragraphs[0][0]).toMatchObject({ text: text.replace("\\{", "{"), note });
		const json = escapeJsonForHtml(JSON.stringify({ blocks: [safe] }));
		const doc = new DOMParser().parseFromString(
			`<div id="page-data" data-config='${json}'></div>`,
			"text/html",
		);
		expect(doc.querySelectorAll("script")).toHaveLength(0);
		expect(doc.querySelector("img, span, [onerror]")).toBeNull();
		expect(
			JSON.parse(doc.querySelector("#page-data")!.getAttribute("data-config")!).blocks,
		).toEqual([block]);
		expect(json).not.toContain("</script>");
		const scriptJson = escapeJsonForScript(JSON.stringify({ blocks: [safe] }));
		const scriptDoc = new DOMParser().parseFromString(
			`<script id="praxity-config" type="application/json">${scriptJson}</script>`,
			"text/html",
		);
		expect(scriptDoc.querySelectorAll("script")).toHaveLength(1);
		expect(scriptDoc.querySelector("img, span, [onerror]")).toBeNull();
		expect(JSON.parse(scriptDoc.querySelector("script")!.textContent!).blocks).toEqual([block]);
		expect(JSON.stringify(safe)).not.toMatch(/"marked"|"shown"|"result"|data-node-id/);
		expect(collectGlossaryTerms(read.pages)).toEqual([]);
		expect(pageHasTooltipMarkup(read.pages[0])).toBe(false);
		expect(() => assertPracticeLogic(read.pages)).not.toThrow();
		const rendered = new DOMParser().parseFromString(
			renderBlockHtml(block, { sourceLocale: locale }),
			"text/html",
		);
		expect(rendered.querySelector("[data-highlight-chunk]")?.textContent).toBe(
			content.paragraphs[0][0].text,
		);
		expect(rendered.querySelector("script, img, [onerror]")).toBeNull();
	},
);
