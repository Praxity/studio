import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readLesson } from "@praxity/grammar";
import { optionFeedbackHtml } from "@praxity/shared-blocks/assessment-content";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { getInlineField } from "@praxity/shared-blocks/inline-markdown";
import { extractNarrationSegments } from "@praxity/shared-blocks/narration";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import type { AssessmentBlockData, PraxityPage } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { type CourseConfig, renderPageFragments } from "../src/html-gen";
import { compileDocument } from "../src/preview/compile-page";
import { createCourseContext } from "../src/preview/course-context";
import { stripChoiceStateFacts } from "./fixtures/choice-facts";
import { compilerIslandAssets } from "./fixtures/page-compiler";

it("retains the base learner body and embedded block JSON with every inline construct", () => {
	let id = 0;
	const lesson = readLesson(
		"# Practice\n::: choice [Pick]{Definition} ==one== @circle{word} @source{Note} [guide](https://example.org) ~~old~~\nRead @source{More}.\n\n@sources\n(x) [Yes]{Option definition}\n( ) @circle{No}\n:::\n",
		{ ids: () => `fixture-${++id}` },
	);
	expect(lesson.hasErrors).toBe(false);
	const config: CourseConfig = {
		id: "course",
		title: "Practice",
		sourceLocale: "en",
		totalPages: 1,
		pages: lesson.pages,
	};
	const body = renderPageFragments(config, lesson.pages[0], new Set(["assessment"]))
		.map((fragment) => fragment.html)
		.join("\n");
	// Captured before the node refactor. Opaque text preserves the learner's exact HTML.
	expect(body).toBe(
		readFileSync(new URL("./fixtures/inline-nodes-body.txt", import.meta.url), "utf8"),
	);
	expect(body).not.toContain("referenceTrivia");
	expect(body).not.toContain("generatedBy");
	expect(body).not.toContain("_inlineTrees");
	expect(body).not.toContain("choiceStateQuestions");
	expect(body).not.toContain("choiceStateSignatures");
});

// Main rendering characterization: material projection must not change any learner byte.
const mainRenderCases: {
	name: string;
	locale: string;
	source?: string;
	title?: string;
	body: string;
	props: string[];
	feedback?: string[];
	cells?: string[][];
	narration?: unknown;
}[] = [
	{
		name: "en:tableSol",
		locale: "en",
		source:
			"# T\n| Header | Other |\n| --- | --- |\n| @footer{Note} | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup>',
				'<a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer{Note}","[a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableSameCell",
		locale: "en",
		source: "# T\n| Header |\n| --- |\n| @footer{Note} [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer{Note} [a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableSameCellEsc",
		locale: "en",
		source: "# T\n| Header |\n| --- |\n| @footer{Note} a\\*b\\* *c* |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> a<em>b</em> <em>c</em></td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> a<em>b</em> <em>c</em>',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer{Note} a*b* *c*"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableCodeCellLink",
		locale: "en",
		source: "# T\n| Header |\n| --- |\n| `@footer{x}` [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><code>@footer{x}</code> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>',
		props: [],
		cells: [['<code>@footer{x}</code> <a href="https://x.test/a(1">a</a>)']],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["`@footer{x}` [a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableEscapedLink",
		locale: "en",
		source: "# T\n| Header |\n| --- |\n| \\@footer{x} [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>x</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer{x} [a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableEmailAt",
		locale: "en",
		source: "# T\n| Header |\n| --- |\n| mail@footer{x} [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left">mail<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>x</li></ol></div></div>',
		props: [],
		cells: [
			[
				'mail<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["mail@footer{x} [a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelCodeHtml",
		locale: "en",
		source: "# P\n::: choice Word\n(x) Use `<em>` tag\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Use `&lt;em&gt;` tag","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Use `<em>` tag</em></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Use `&lt;em&gt;` tag","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Use `` tag\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Use `<em>` tag"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Use `` tag\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelEscHtml",
		locale: "en",
		source: "# P\n::: choice Word\n(x) a \\<em>b\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">a <em>b</em></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- a b\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"a <em>b"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- a b\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelRealHtml",
		locale: "en",
		source: "# P\n::: choice Word\n(x) a <em>b</em>\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b&lt;/em&gt;","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">a <em>b</em></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b&lt;/em&gt;","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- a b\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"a <em>b</em>"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- a b\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelCodeSpan",
		locale: "en",
		source: "# P\n::: choice Word\n(x) The `<span>` tag\n( ) The `<div>` tag\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"The `&lt;span&gt;` tag","isCorrect":true},{"id":"no4","label":"The `&lt;div&gt;` tag","isCorrect":false,"_inline":{"label":"The &lt;code&gt;&amp;lt;div&amp;gt;&lt;/code&gt; tag"}}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">The `<span>` tag</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">The <code>&lt;div&gt;</code> tag</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"The `&lt;span&gt;` tag","isCorrect":true},{"id":"no4","label":"The `&lt;div&gt;` tag","isCorrect":false,"_inline":{"label":"The &lt;code&gt;&amp;lt;div&amp;gt;&lt;/code&gt; tag"}}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- The `` tag\n- The ` ` tag\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"The `<span>` tag"},{"id":"no4","isCorrect":false,"label":"The `<div>` tag"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- The `` tag\n- The ` ` tag\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:fbLinkTerm",
		locale: "en",
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: [Guide](https://example.com) [term]{Definition} and `code`\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"[Guide](https://example.com) [term]{Definition} and `code`","_inline":{"feedback":"Guide term (Definition) and &lt;code&gt;code&lt;/code&gt;"}}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"[Guide](https://example.com) [term]{Definition} and `code`","_inline":{"feedback":"Guide term (Definition) and &lt;code&gt;code&lt;/code&gt;"}}]},"_dontKnow":true}}',
		],
		feedback: [
			"",
			'<a href="https://example.com">Guide</a> <span class="inline-tooltip-trigger" data-tooltip-content="Definition">term</span> and <code>code</code>',
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{},"assessmentType":"choice","feedback":{"incorrect":[{"data":{"content":"<p>Try again</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"feedback":"[Guide](https://example.com) [term]{Definition} and `code`","id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:fbHtml",
		locale: "en",
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: Use <em>this</em> one\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use &lt;em&gt;this&lt;/em&gt; one"}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use &lt;em&gt;this&lt;/em&gt; one"}]},"_dontKnow":true}}',
		],
		feedback: ["", "Use &lt;em&gt;this&lt;/em&gt; one"],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{},"assessmentType":"choice","feedback":{"incorrect":[{"data":{"content":"<p>Try again</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"feedback":"Use <em>this</em> one","id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:fbCodeHtml",
		locale: "en",
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: Use `<em>` here\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use `&lt;em&gt;` here&lt;/em&gt;"}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use `&lt;em&gt;` here&lt;/em&gt;"}]},"_dontKnow":true}}',
		],
		feedback: ["", "Use <code>&lt;em&gt;</code> here"],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{},"assessmentType":"choice","feedback":{"incorrect":[{"data":{"content":"<p>Try again</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"feedback":"Use `<em>` here","id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:fbMultiNoPromo",
		locale: "en",
		source:
			"# P\n::: choice Word {multiple}\n(x) Yes\nfeedback: Good [Guide](https://example.com)\n(x) Also\nfeedback: Fine [term]{Def}\n( ) No\nfeedback: Bad [Guide](https://example.com)\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x8" class="praxity-block praxity-block-assessment praxity-block-x8" data-block-id="x8" data-node-id="x8" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x8","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes5","incorrect":"no6"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}],"incorrect":[{"id":"x4","type":"text","data":{"content":"&lt;p&gt;Bad &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes5","label":"Yes","isCorrect":true,"feedback":"Good [Guide](https://example.com)","_inline":{"feedback":"Good Guide"}},{"id":"yes7","label":"Also","isCorrect":true,"feedback":"Fine [term]{Def}","_inline":{"feedback":"Fine term (Def)"}},{"id":"no6","label":"No","isCorrect":false,"feedback":"Bad [Guide](https://example.com)","_inline":{"feedback":"Bad Guide"}}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x8" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x8"><div class="praxity-assessment-choice-options"><label data-node-id="yes5" class="praxity-assessment-choice-option" for="x8-option-yes5"><input id="x8-option-yes5" type="radio" name="x8" value="yes5" aria-labelledby="x8-option-yes5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-yes5-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="yes7" class="praxity-assessment-choice-option" for="x8-option-yes7"><input id="x8-option-yes7" type="radio" name="x8" value="yes7" aria-labelledby="x8-option-yes7-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-yes7-label" class="praxity-choice-label">Also</span></span></label><label data-node-id="no6" class="praxity-assessment-choice-option" for="x8-option-no6"><input id="x8-option-no6" type="radio" name="x8" value="no6" aria-labelledby="x8-option-no6-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-no6-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x8-option-dont-know"><input id="x8-option-dont-know" type="radio" name="x8" value="dont-know" aria-labelledby="x8-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x8","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes5","incorrect":"no6"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}],"incorrect":[{"id":"x4","type":"text","data":{"content":"&lt;p&gt;Bad &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes5","label":"Yes","isCorrect":true,"feedback":"Good [Guide](https://example.com)","_inline":{"feedback":"Good Guide"}},{"id":"yes7","label":"Also","isCorrect":true,"feedback":"Fine [term]{Def}","_inline":{"feedback":"Fine term (Def)"}},{"id":"no6","label":"No","isCorrect":false,"feedback":"Bad [Guide](https://example.com)","_inline":{"feedback":"Bad Guide"}}]},"_dontKnow":true}}',
		],
		feedback: [
			'<p>Good <a href="https://example.com">Guide</a></p>',
			'Fine <span class="inline-tooltip-trigger" data-tooltip-content="Def">term</span>',
			'<p>Bad <a href="https://example.com">Guide</a></p>',
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x8",
				kind: "block",
				blockId: "x8",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- Also\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{"correct":"yes5","incorrect":"no6"},"assessmentType":"choice","feedback":{"correct":[{"data":{"content":"<p>Good <a href=\\"https://example.com\\">Guide</a></p>"},"id":"x3","type":"text"}],"incorrect":[{"data":{"content":"<p>Bad <a href=\\"https://example.com\\">Guide</a></p>"},"id":"x4","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"feedback":"Good [Guide](https://example.com)","id":"yes5","isCorrect":true,"label":"Yes"},{"feedback":"Fine [term]{Def}","id":"yes7","isCorrect":true,"label":"Also"},{"feedback":"Bad [Guide](https://example.com)","id":"no6","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- Also\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x8"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:cardsTitle",
		locale: "en",
		source:
			"# C\n::: cards Group [a](https://x.test/a(1)) \\*x\\* $x^2$\n:: One\nText\n:: Two\nText\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">C</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-card praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Group <a href="https://x.test/a(1">a</a>) <em>x</em> $x^2$</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="x6" data-node-id="x6" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="x2" data-node-id="x2" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"><div id="block-x3" class="praxity-block praxity-block-text praxity-block-x3" data-block-id="x3" data-node-id="x3" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="x4" data-node-id="x4" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"><div id="block-x5" class="praxity-block praxity-block-text praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "C",
				derivedScript: "C",
				sourceContent: '{"type":"heading","data":{"content":"<p>C</p>","level":1}}',
				script: "C",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Group [a]( *x* $x^2$",
				derivedScript: "Group [a]( *x* $x^2$",
				sourceContent:
					'{"type":"card","data":{"title":"Group [a](https://x.test/a(1)) *x* $x^2$"}}',
				script: "Group [a]( *x* $x^2$",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "intro",
			},
			{
				id: "x6:item:0",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "One",
				derivedScript: "One [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x3","type":"text"}],"headingLevel":3,"id":"x2","label":"One"}}}',
				script: "One [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "item",
				itemIndex: 0,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 0,
						side: "front",
					},
				],
			},
			{
				id: "x6:item:1",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Two",
				derivedScript: "Two [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x5","type":"text"}],"headingLevel":3,"id":"x4","label":"Two"}}}',
				script: "Two [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "item",
				itemIndex: 1,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 1,
						side: "front",
					},
				],
			},
		],
	},
	{
		name: "en:cardsTitleHtml",
		locale: "en",
		source: "# C\n::: cards Group <em>b</em> `<i>`\n:: One\nText\n:: Two\nText\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">C</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-card praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Group &lt;em&gt;b&lt;/em&gt; <code>&lt;i&gt;</code></h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="x6" data-node-id="x6" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="x2" data-node-id="x2" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"><div id="block-x3" class="praxity-block praxity-block-text praxity-block-x3" data-block-id="x3" data-node-id="x3" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="x4" data-node-id="x4" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"><div id="block-x5" class="praxity-block praxity-block-text praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "C",
				derivedScript: "C",
				sourceContent: '{"type":"heading","data":{"content":"<p>C</p>","level":1}}',
				script: "C",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Group b ``",
				derivedScript: "Group b ``",
				sourceContent: '{"type":"card","data":{"title":"Group <em>b</em> `<i>`"}}',
				script: "Group b ``",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "intro",
			},
			{
				id: "x6:item:0",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "One",
				derivedScript: "One [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x3","type":"text"}],"headingLevel":3,"id":"x2","label":"One"}}}',
				script: "One [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "item",
				itemIndex: 0,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 0,
						side: "front",
					},
				],
			},
			{
				id: "x6:item:1",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Two",
				derivedScript: "Two [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x5","type":"text"}],"headingLevel":3,"id":"x4","label":"Two"}}}',
				script: "Two [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "item",
				itemIndex: 1,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 1,
						side: "front",
					},
				],
			},
		],
	},
	{
		name: "en:proseSourcesMid",
		locale: "en",
		source: "# P\nRead @source{N} and see @sources here.\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-text praxity-block-x2" data-block-id="x2" data-node-id="x2" data-block-type="text" data-focus-row><div class="praxity-text"><p>Read <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> and see <span data-footer-insert="true">@footer.insert</span> here.</p></div></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "text",
				label: "Read @footer{N} and see @footer.insert here.",
				derivedScript: "Read @footer{N} and see @footer.insert here.",
				sourceContent:
					'{"type":"text","data":{"content":"<p>Read <span data-footer-content=\\"N\\">@footer{N}</span> and see <span data-footer-insert=\\"true\\">@footer.insert</span> here.</p>"}}',
				script: "Read @footer{N} and see @footer.insert here.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelFooterInsertMid",
		locale: "en",
		source: "# P\n::: choice Word\n(x) Yes @footer.insert now\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert now","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; now"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span data-footer-insert="true">@footer.insert</span> now</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert now","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; now"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @footer.insert now\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @footer.insert now"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @footer.insert now\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelFooter",
		locale: "en",
		source: "# P\n::: choice Word\n(x) Yes @footer{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"Yes &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"Yes @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"Yes &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"Yes @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @footer{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @footer{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @footer{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelSource",
		locale: "en",
		source: "# P\n::: choice Word\n(x) Yes @source{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span class="praxity-doodle" data-doodle="source" data-doodle-mods="">N</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @source{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @source{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @source{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelPlain",
		locale: "en",
		source: "# P\n::: choice Word\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelWavy",
		locale: "en",
		source: "# P\n::: choice Word\n(x) Yes @source.wavy{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source.wavy{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"wavy\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span class="praxity-doodle" data-doodle="source" data-doodle-mods="wavy">N</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source.wavy{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"wavy\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @source.wavy{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @source.wavy{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @source.wavy{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:dialogue",
		locale: "en",
		source: "# D\n::: dialogue\n- A: Say @footer{N} and @source{M}\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">D</h1></div>\n<div id="block-x3" class="praxity-block praxity-block-dialogue praxity-block-x3" data-block-id="x3" data-node-id="x3" data-block-type="dialogue" data-focus-row><figure class="praxity-dialogue" data-style="bubbles"><ol class="praxity-dialogue-turns" role="list"><li data-node-id="x2" class="praxity-dialogue-turn" data-turn-index="0" data-speaker="a" data-side="start"><div class="praxity-dialogue-bubble"><p class="praxity-dialogue-name"><bdi>A</bdi></p><div class="praxity-dialogue-text" dir="auto"><p>Say <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> and <span class="praxity-doodle" data-doodle="source" data-doodle-mods="">M</span></p></div></div></li></ol></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "D",
				derivedScript: "D",
				sourceContent: '{"type":"heading","data":{"content":"<p>D</p>","level":1}}',
				script: "D",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x3:item:0",
				kind: "block",
				blockId: "x3",
				blockType: "dialogue",
				label: "A",
				derivedScript: "Say @footer{N} and M",
				sourceContent:
					'{"type":"dialogue","data":{"dialogue":null,"turn":{"paragraphs":["Say @footer{N} and @source{M}"],"speaker":"a"}}}',
				script: "Say @footer{N} and M",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
				containerPart: "item",
				itemIndex: 0,
				speaker: "A",
			},
		],
	},
	{
		name: "en:labelMaterialHtml",
		locale: "en",
		source: "# P\n::: choice Word\n\n(x) Yes @source{Use `<span>`}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{Use `&lt;span&gt;`}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes @source{Use `<span>`}</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{Use `&lt;span&gt;`}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @source{Use ``}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @source{Use `<span>`}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @source{Use ``}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelMaterialAliasStem",
		locale: "en",
		source: "# P\n::: choice Word @footer{N}\n\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word @footer{N}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word @footer{N}</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word @footer{N}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word @footer{N}\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word @footer{N}</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word @footer{N}\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelMaterialAliasDescription",
		locale: "en",
		source: "# P\n::: choice Word\nDescription @footer{N}\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Description @footer{N}&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>Description @footer{N}</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Description @footer{N}&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word Description @footer{N}\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>Description @footer{N}</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word Description @footer{N}\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelMaterialWhole",
		locale: "en",
		source: "# P\n::: choice Word\n\n(x) @source{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"@source{N}","isCorrect":true,"_inline":{"label":"&lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label"><span class="praxity-doodle" data-doodle="source" data-doodle-mods="">N</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"@source{N}","isCorrect":true,"_inline":{"label":"&lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- @source{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"@source{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- @source{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelMaterialWholeMark",
		locale: "en",
		source: "# P\n::: choice Word\n\n(x) ==Yes== @footer{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"&lt;mark&gt;Yes&lt;/mark&gt; &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"==Yes== @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label"><mark>Yes</mark> <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"&lt;mark&gt;Yes&lt;/mark&gt; &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"==Yes== @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- ==Yes== @footer{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"==Yes== @footer{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- ==Yes== @footer{N}\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelMaterialList",
		locale: "en",
		source: "# P\n::: choice Word\n\n(x) Yes @footer.insert\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span data-footer-insert="true">@footer.insert</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @footer.insert\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @footer.insert"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @footer.insert\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableEscapedList",
		locale: "en",
		source: "# T\n| Header |\n| --- |\n| \\@footer.insert [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><span data-footer-insert="true">@footer.insert</span> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>',
		props: [],
		cells: [
			['<span data-footer-insert="true">@footer.insert</span> <a href="https://x.test/a(1">a</a>)'],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer.insert [a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableCanonical",
		locale: "en",
		source:
			"# T\n| Header | Other |\n| --- | --- |\n| @source{Note} [a](https://x.test/a(1)) | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1)">a</a></td><td style="text-align:left"><a href="https://x.test/a(1)">a</a></td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> <a href="https://x.test/a(1)">a</a>',
				'<a href="https://x.test/a(1)">a</a>',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@source{Note} [a](https://x.test/a(1))","[a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableNeighbourActive",
		locale: "en",
		source: "# T\n| Header | Other |\n| --- | --- |\n| @footer{N} | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup>',
				'<a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer{N}","[a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableNeighbourCode",
		locale: "en",
		source: "# T\n| Header | Other |\n| --- | --- |\n| `@footer{N}` | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><code>@footer{N}</code></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>',
		props: [],
		cells: [["<code>@footer{N}</code>", '<a href="https://x.test/a(1">a</a>)']],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["`@footer{N}`","[a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableNeighbourEscaped",
		locale: "en",
		source: "# T\n| Header | Other |\n| --- | --- |\n| \\@footer{N} | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup>',
				'<a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer{N}","[a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:tableNeighbourEscapedList",
		locale: "en",
		source:
			"# T\n| Header | Other |\n| --- | --- |\n| \\@footer.insert | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Data table" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Data table" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Scroll for more</p></figure></div>',
		props: [],
		cells: [["", '<a href="https://x.test/a(1">a</a>)']],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Review the table on the page for the complete data.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer.insert","[a](https://x.test/a(1))"]]}}',
				script: "Review the table on the page for the complete data.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:promotedsource",
		locale: "en",
		source:
			"# Practice\n::: choice Word\n(x) Yes\nfeedback: Good @source{N}\n( ) No\n:::\n\nLater @source{Later}\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Practice</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="Practice" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @source{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>\n<div id="block-x7" class="praxity-block praxity-block-text praxity-block-x7" data-block-id="x7" data-node-id="x7" data-block-type="text" data-focus-row><div class="praxity-text"><p>Later <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[2]</sup></p></div></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li><li>Later</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @source{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: [
			'<p>Good <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup></p>',
			"",
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "Practice",
				derivedScript: "Practice",
				sourceContent: '{"type":"heading","data":{"content":"<p>Practice</p>","level":1}}',
				script: "Practice",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{"correct":"yes4"},"assessmentType":"choice","feedback":{"correct":[{"data":{"content":"<p>Good <span data-footer-content=\\"N\\">@footer{N}</span></p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"feedback":"Good @source{N}","id":"yes4","isCorrect":true,"label":"Yes"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x7",
				kind: "block",
				blockId: "x7",
				blockType: "text",
				label: "Later @footer{Later}",
				derivedScript: "Later @footer{Later}",
				sourceContent:
					'{"type":"text","data":{"content":"<p>Later <span data-footer-content=\\"Later\\">@footer{Later}</span></p>"}}',
				script: "Later @footer{Later}",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:promotedfooter",
		locale: "en",
		source:
			"# Practice\n::: choice Word\n(x) Yes\nfeedback: Good @footer{N}\n( ) No\n:::\n\nLater @source{Later}\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Practice</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="Practice" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good @footer{N}&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @footer{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>\n<div id="block-x7" class="praxity-block praxity-block-text praxity-block-x7" data-block-id="x7" data-node-id="x7" data-block-type="text" data-focus-row><div class="praxity-text"><p>Later <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[2]</sup></p></div></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li><li>Later</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good @footer{N}&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @footer{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["<p>Good @footer{N}</p>", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "Practice",
				derivedScript: "Practice",
				sourceContent: '{"type":"heading","data":{"content":"<p>Practice</p>","level":1}}',
				script: "Practice",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{"correct":"yes4"},"assessmentType":"choice","feedback":{"correct":[{"data":{"content":"<p>Good @footer{N}</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"feedback":"Good @footer{N}","id":"yes4","isCorrect":true,"label":"Yes"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x7",
				kind: "block",
				blockId: "x7",
				blockType: "text",
				label: "Later @footer{Later}",
				derivedScript: "Later @footer{Later}",
				sourceContent:
					'{"type":"text","data":{"content":"<p>Later <span data-footer-content=\\"Later\\">@footer{Later}</span></p>"}}',
				script: "Later @footer{Later}",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelTree0",
		locale: "en",
		source:
			"# P\n::: choice If a<b @source{N} then b>a\nx<y @source{N} z>w\n(x) x<y @source{N} z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[2]&lt;/sup&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @source{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[2]</sup> z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y <span class="praxity-doodle" data-doodle="source" data-doodle-mods="">N</span> z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li><li>N</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[2]&lt;/sup&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @source{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y <span data-footer-content=\\"N\\">@footer{N}</span> z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @source{N} z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b <span data-footer-content=\\"N\\">@footer{N}</span> then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelTree1",
		locale: "en",
		source:
			"# P\n::: choice If a<b @footer{N} then b>a\nx<y @footer{N} z>w\n(x) x<y @footer{N} z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer{N} then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer{N} z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @footer{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b @footer{N} then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y @footer{N} z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[1]</sup> z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer{N} then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer{N} z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Footnote &lt;/span&gt;[1]&lt;/sup&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @footer{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y @footer{N} z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @footer{N} z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b @footer{N} then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelTree2",
		locale: "en",
		source:
			"# P\n::: choice If a<b @sources then b>a\nx<y @sources z>w\n(x) x<y @sources z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @sources z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y @sources z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b <span data-footer-insert="true">@footer.insert</span> then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y <span data-footer-insert="true">@footer.insert</span> z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y @sources z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @sources z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y @sources z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y <span data-footer-insert=\\"true\\">@footer.insert</span> z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @sources z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b <span data-footer-insert=\\"true\\">@footer.insert</span> then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelTree3",
		locale: "en",
		source:
			"# P\n::: choice If a<b @footer.insert then b>a\nx<y @footer.insert z>w\n(x) x<y @footer.insert z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer.insert then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer.insert z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @footer.insert z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b @footer.insert then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y @footer.insert z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y <span data-footer-insert="true">@footer.insert</span> z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer.insert then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer.insert z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @footer.insert z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y @footer.insert z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @footer.insert z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b @footer.insert then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:labelTreeCode",
		locale: "en",
		source: "# P\n::: choice Yes `<tag` @footer{N >}\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Yes &lt;code&gt;&amp;lt;tag&lt;/code&gt; @footer{N &amp;gt;}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Yes <code>&lt;tag</code> @footer{N &gt;}</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">I don\'t know</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Answering this question needs JavaScript. Turn it on to answer and see feedback.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Yes &lt;code&gt;&amp;lt;tag&lt;/code&gt; @footer{N &amp;gt;}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "en",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Yes }\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Yes <code>&lt;tag</code> @footer{N &gt;}</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Yes }\n\n- Yes\n- No\n- I don't know\n\nNow review the options on the page and choose your answer.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "en",
				},
			},
		],
	},
	{
		name: "en:rawCard:A <em>b</em>",
		locale: "en",
		title: "A <em>b</em>",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A &lt;em&gt;b&lt;/em&gt;</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "en:rawCard:A [l](https://x.test/a(1)) $x^2$",
		locale: "en",
		title: "A [l](https://x.test/a(1)) $x^2$",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A <a href="https://x.test/a(1">l</a>) $x^2$</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "en:rawCard:  spaced  ",
		locale: "en",
		title: "  spaced  ",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">spaced</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "en:rawCard:A `<b>` b",
		locale: "en",
		title: "A `<b>` b",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A <code>&lt;b&gt;</code> b</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "en:rawCard:A \\*x\\*",
		locale: "en",
		title: "A \\*x\\*",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A *x*</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "fr:tableSol",
		locale: "fr",
		source:
			"# T\n| Header | Other |\n| --- | --- |\n| @footer{Note} | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup>',
				'<a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer{Note}","[a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableSameCell",
		locale: "fr",
		source: "# T\n| Header |\n| --- |\n| @footer{Note} [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer{Note} [a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableSameCellEsc",
		locale: "fr",
		source: "# T\n| Header |\n| --- |\n| @footer{Note} a\\*b\\* *c* |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> a<em>b</em> <em>c</em></td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> a<em>b</em> <em>c</em>',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer{Note} a*b* *c*"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableCodeCellLink",
		locale: "fr",
		source: "# T\n| Header |\n| --- |\n| `@footer{x}` [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><code>@footer{x}</code> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>',
		props: [],
		cells: [['<code>@footer{x}</code> <a href="https://x.test/a(1">a</a>)']],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["`@footer{x}` [a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableEscapedLink",
		locale: "fr",
		source: "# T\n| Header |\n| --- |\n| \\@footer{x} [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>x</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer{x} [a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableEmailAt",
		locale: "fr",
		source: "# T\n| Header |\n| --- |\n| mail@footer{x} [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left">mail<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>x</li></ol></div></div>',
		props: [],
		cells: [
			[
				'mail<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["mail@footer{x} [a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelCodeHtml",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) Use `<em>` tag\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Use `&lt;em&gt;` tag","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Use `<em>` tag</em></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Use `&lt;em&gt;` tag","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Use `` tag\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Use `<em>` tag"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Use `` tag\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelEscHtml",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) a \\<em>b\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">a <em>b</em></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- a b\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"a <em>b"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- a b\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelRealHtml",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) a <em>b</em>\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b&lt;/em&gt;","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">a <em>b</em></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"a &lt;em&gt;b&lt;/em&gt;","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- a b\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"a <em>b</em>"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- a b\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelCodeSpan",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) The `<span>` tag\n( ) The `<div>` tag\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"The `&lt;span&gt;` tag","isCorrect":true},{"id":"no4","label":"The `&lt;div&gt;` tag","isCorrect":false,"_inline":{"label":"The &lt;code&gt;&amp;lt;div&amp;gt;&lt;/code&gt; tag"}}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">The `<span>` tag</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">The <code>&lt;div&gt;</code> tag</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"The `&lt;span&gt;` tag","isCorrect":true},{"id":"no4","label":"The `&lt;div&gt;` tag","isCorrect":false,"_inline":{"label":"The &lt;code&gt;&amp;lt;div&amp;gt;&lt;/code&gt; tag"}}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- The `` tag\n- The ` ` tag\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"The `<span>` tag"},{"id":"no4","isCorrect":false,"label":"The `<div>` tag"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- The `` tag\n- The ` ` tag\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:fbLinkTerm",
		locale: "fr",
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: [Guide](https://example.com) [term]{Definition} and `code`\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"[Guide](https://example.com) [term]{Definition} and `code`","_inline":{"feedback":"Guide term (Definition) and &lt;code&gt;code&lt;/code&gt;"}}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"[Guide](https://example.com) [term]{Definition} and `code`","_inline":{"feedback":"Guide term (Definition) and &lt;code&gt;code&lt;/code&gt;"}}]},"_dontKnow":true}}',
		],
		feedback: [
			"",
			'<a href="https://example.com">Guide</a> <span class="inline-tooltip-trigger" data-tooltip-content="Definition">term</span> and <code>code</code>',
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{},"assessmentType":"choice","feedback":{"incorrect":[{"data":{"content":"<p>Try again</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"feedback":"[Guide](https://example.com) [term]{Definition} and `code`","id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:fbHtml",
		locale: "fr",
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: Use <em>this</em> one\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use &lt;em&gt;this&lt;/em&gt; one"}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use &lt;em&gt;this&lt;/em&gt; one"}]},"_dontKnow":true}}',
		],
		feedback: ["", "Use &lt;em&gt;this&lt;/em&gt; one"],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{},"assessmentType":"choice","feedback":{"incorrect":[{"data":{"content":"<p>Try again</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"feedback":"Use <em>this</em> one","id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:fbCodeHtml",
		locale: "fr",
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: Use `<em>` here\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use `&lt;em&gt;` here&lt;/em&gt;"}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{},"stemLevel":2,"feedback":{"incorrect":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Try again&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false,"feedback":"Use `&lt;em&gt;` here&lt;/em&gt;"}]},"_dontKnow":true}}',
		],
		feedback: ["", "Use <code>&lt;em&gt;</code> here"],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{},"assessmentType":"choice","feedback":{"incorrect":[{"data":{"content":"<p>Try again</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"feedback":"Use `<em>` here","id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:fbMultiNoPromo",
		locale: "fr",
		source:
			"# P\n::: choice Word {multiple}\n(x) Yes\nfeedback: Good [Guide](https://example.com)\n(x) Also\nfeedback: Fine [term]{Def}\n( ) No\nfeedback: Bad [Guide](https://example.com)\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x8" class="praxity-block praxity-block-assessment praxity-block-x8" data-block-id="x8" data-node-id="x8" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x8","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes5","incorrect":"no6"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}],"incorrect":[{"id":"x4","type":"text","data":{"content":"&lt;p&gt;Bad &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes5","label":"Yes","isCorrect":true,"feedback":"Good [Guide](https://example.com)","_inline":{"feedback":"Good Guide"}},{"id":"yes7","label":"Also","isCorrect":true,"feedback":"Fine [term]{Def}","_inline":{"feedback":"Fine term (Def)"}},{"id":"no6","label":"No","isCorrect":false,"feedback":"Bad [Guide](https://example.com)","_inline":{"feedback":"Bad Guide"}}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x8" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x8"><div class="praxity-assessment-choice-options"><label data-node-id="yes5" class="praxity-assessment-choice-option" for="x8-option-yes5"><input id="x8-option-yes5" type="radio" name="x8" value="yes5" aria-labelledby="x8-option-yes5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-yes5-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="yes7" class="praxity-assessment-choice-option" for="x8-option-yes7"><input id="x8-option-yes7" type="radio" name="x8" value="yes7" aria-labelledby="x8-option-yes7-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-yes7-label" class="praxity-choice-label">Also</span></span></label><label data-node-id="no6" class="praxity-assessment-choice-option" for="x8-option-no6"><input id="x8-option-no6" type="radio" name="x8" value="no6" aria-labelledby="x8-option-no6-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-no6-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x8-option-dont-know"><input id="x8-option-dont-know" type="radio" name="x8" value="dont-know" aria-labelledby="x8-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x8-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x8","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes5","incorrect":"no6"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}],"incorrect":[{"id":"x4","type":"text","data":{"content":"&lt;p&gt;Bad &lt;a href=\\"https://example.com\\"&gt;Guide&lt;/a&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes5","label":"Yes","isCorrect":true,"feedback":"Good [Guide](https://example.com)","_inline":{"feedback":"Good Guide"}},{"id":"yes7","label":"Also","isCorrect":true,"feedback":"Fine [term]{Def}","_inline":{"feedback":"Fine term (Def)"}},{"id":"no6","label":"No","isCorrect":false,"feedback":"Bad [Guide](https://example.com)","_inline":{"feedback":"Bad Guide"}}]},"_dontKnow":true}}',
		],
		feedback: [
			'<p>Good <a href="https://example.com">Guide</a></p>',
			'Fine <span class="inline-tooltip-trigger" data-tooltip-content="Def">term</span>',
			'<p>Bad <a href="https://example.com">Guide</a></p>',
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x8",
				kind: "block",
				blockId: "x8",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- Also\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{"correct":"yes5","incorrect":"no6"},"assessmentType":"choice","feedback":{"correct":[{"data":{"content":"<p>Good <a href=\\"https://example.com\\">Guide</a></p>"},"id":"x3","type":"text"}],"incorrect":[{"data":{"content":"<p>Bad <a href=\\"https://example.com\\">Guide</a></p>"},"id":"x4","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"feedback":"Good [Guide](https://example.com)","id":"yes5","isCorrect":true,"label":"Yes"},{"feedback":"Fine [term]{Def}","id":"yes7","isCorrect":true,"label":"Also"},{"feedback":"Bad [Guide](https://example.com)","id":"no6","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- Also\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x8"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:cardsTitle",
		locale: "fr",
		source:
			"# C\n::: cards Group [a](https://x.test/a(1)) \\*x\\* $x^2$\n:: One\nText\n:: Two\nText\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">C</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-card praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Group <a href="https://x.test/a(1">a</a>) <em>x</em> $x^2$</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="x6" data-node-id="x6" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="x2" data-node-id="x2" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"><div id="block-x3" class="praxity-block praxity-block-text praxity-block-x3" data-block-id="x3" data-node-id="x3" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="x4" data-node-id="x4" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"><div id="block-x5" class="praxity-block praxity-block-text praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "C",
				derivedScript: "C",
				sourceContent: '{"type":"heading","data":{"content":"<p>C</p>","level":1}}',
				script: "C",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Group [a]( *x* $x^2$",
				derivedScript: "Group [a]( *x* $x^2$",
				sourceContent:
					'{"type":"card","data":{"title":"Group [a](https://x.test/a(1)) *x* $x^2$"}}',
				script: "Group [a]( *x* $x^2$",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "intro",
			},
			{
				id: "x6:item:0",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "One",
				derivedScript: "One [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x3","type":"text"}],"headingLevel":3,"id":"x2","label":"One"}}}',
				script: "One [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "item",
				itemIndex: 0,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 0,
						side: "front",
					},
				],
			},
			{
				id: "x6:item:1",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Two",
				derivedScript: "Two [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x5","type":"text"}],"headingLevel":3,"id":"x4","label":"Two"}}}',
				script: "Two [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "item",
				itemIndex: 1,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 1,
						side: "front",
					},
				],
			},
		],
	},
	{
		name: "fr:cardsTitleHtml",
		locale: "fr",
		source: "# C\n::: cards Group <em>b</em> `<i>`\n:: One\nText\n:: Two\nText\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">C</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-card praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Group &lt;em&gt;b&lt;/em&gt; <code>&lt;i&gt;</code></h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="x6" data-node-id="x6" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="x2" data-node-id="x2" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"><div id="block-x3" class="praxity-block praxity-block-text praxity-block-x3" data-block-id="x3" data-node-id="x3" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="x4" data-node-id="x4" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"><div id="block-x5" class="praxity-block praxity-block-text praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="text" data-focus-row><div class="praxity-text"><p>Text</p></div></div></div></article></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "C",
				derivedScript: "C",
				sourceContent: '{"type":"heading","data":{"content":"<p>C</p>","level":1}}',
				script: "C",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Group b ``",
				derivedScript: "Group b ``",
				sourceContent: '{"type":"card","data":{"title":"Group <em>b</em> `<i>`"}}',
				script: "Group b ``",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "intro",
			},
			{
				id: "x6:item:0",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "One",
				derivedScript: "One [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x3","type":"text"}],"headingLevel":3,"id":"x2","label":"One"}}}',
				script: "One [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "item",
				itemIndex: 0,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 0,
						side: "front",
					},
				],
			},
			{
				id: "x6:item:1",
				kind: "block",
				blockId: "x6",
				blockType: "card",
				label: "Two",
				derivedScript: "Two [pause]\n\nText",
				sourceContent:
					'{"type":"card","data":{"item":{"back":[],"front":[{"data":{"content":"<p>Text</p>"},"id":"x5","type":"text"}],"headingLevel":3,"id":"x4","label":"Two"}}}',
				script: "Two [pause]\n\nText",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "item",
				itemIndex: 1,
				authoredStopBlockIds: [],
				cardTargets: [
					{
						containerId: "x6",
						itemIndex: 1,
						side: "front",
					},
				],
			},
		],
	},
	{
		name: "fr:proseSourcesMid",
		locale: "fr",
		source: "# P\nRead @source{N} and see @sources here.\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-text praxity-block-x2" data-block-id="x2" data-node-id="x2" data-block-type="text" data-focus-row><div class="praxity-text"><p>Read <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> and see <span data-footer-insert="true">@footer.insert</span> here.</p></div></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "text",
				label: "Read @footer{N} and see @footer.insert here.",
				derivedScript: "Read @footer{N} and see @footer.insert here.",
				sourceContent:
					'{"type":"text","data":{"content":"<p>Read <span data-footer-content=\\"N\\">@footer{N}</span> and see <span data-footer-insert=\\"true\\">@footer.insert</span> here.</p>"}}',
				script: "Read @footer{N} and see @footer.insert here.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelFooterInsertMid",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) Yes @footer.insert now\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert now","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; now"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span data-footer-insert="true">@footer.insert</span> now</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert now","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; now"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @footer.insert now\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @footer.insert now"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @footer.insert now\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelFooter",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) Yes @footer{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"Yes &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"Yes @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"Yes &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"Yes @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @footer{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @footer{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @footer{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelSource",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) Yes @source{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span class="praxity-doodle" data-doodle="source" data-doodle-mods="">N</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @source{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @source{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @source{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelPlain",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelWavy",
		locale: "fr",
		source: "# P\n::: choice Word\n(x) Yes @source.wavy{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source.wavy{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"wavy\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span class="praxity-doodle" data-doodle="source" data-doodle-mods="wavy">N</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source.wavy{N}","isCorrect":true,"_inline":{"label":"Yes &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"wavy\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @source.wavy{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @source.wavy{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @source.wavy{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:dialogue",
		locale: "fr",
		source: "# D\n::: dialogue\n- A: Say @footer{N} and @source{M}\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">D</h1></div>\n<div id="block-x3" class="praxity-block praxity-block-dialogue praxity-block-x3" data-block-id="x3" data-node-id="x3" data-block-type="dialogue" data-focus-row><figure class="praxity-dialogue" data-style="bubbles"><ol class="praxity-dialogue-turns" role="list"><li data-node-id="x2" class="praxity-dialogue-turn" data-turn-index="0" data-speaker="a" data-side="start"><div class="praxity-dialogue-bubble"><p class="praxity-dialogue-name"><bdi>A</bdi></p><div class="praxity-dialogue-text" dir="auto"><p>Say <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> and <span class="praxity-doodle" data-doodle="source" data-doodle-mods="">M</span></p></div></div></li></ol></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "D",
				derivedScript: "D",
				sourceContent: '{"type":"heading","data":{"content":"<p>D</p>","level":1}}',
				script: "D",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x3:item:0",
				kind: "block",
				blockId: "x3",
				blockType: "dialogue",
				label: "A",
				derivedScript: "Say @footer{N} and M",
				sourceContent:
					'{"type":"dialogue","data":{"dialogue":null,"turn":{"paragraphs":["Say @footer{N} and @source{M}"],"speaker":"a"}}}',
				script: "Say @footer{N} and M",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
				containerPart: "item",
				itemIndex: 0,
				speaker: "A",
			},
		],
	},
	{
		name: "fr:labelMaterialHtml",
		locale: "fr",
		source: "# P\n::: choice Word\n\n(x) Yes @source{Use `<span>`}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{Use `&lt;span&gt;`}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes @source{Use `<span>`}</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @source{Use `&lt;span&gt;`}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @source{Use ``}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @source{Use `<span>`}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @source{Use ``}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelMaterialAliasStem",
		locale: "fr",
		source: "# P\n::: choice Word @footer{N}\n\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word @footer{N}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word @footer{N}</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word @footer{N}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word @footer{N}\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word @footer{N}</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word @footer{N}\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelMaterialAliasDescription",
		locale: "fr",
		source: "# P\n::: choice Word\nDescription @footer{N}\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Description @footer{N}&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>Description @footer{N}</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Description @footer{N}&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"Yes","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word Description @footer{N}\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>Description @footer{N}</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"Yes"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word Description @footer{N}\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelMaterialWhole",
		locale: "fr",
		source: "# P\n::: choice Word\n\n(x) @source{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"@source{N}","isCorrect":true,"_inline":{"label":"&lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label"><span class="praxity-doodle" data-doodle="source" data-doodle-mods="">N</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"@source{N}","isCorrect":true,"_inline":{"label":"&lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- @source{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"@source{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- @source{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelMaterialWholeMark",
		locale: "fr",
		source: "# P\n::: choice Word\n\n(x) ==Yes== @footer{N}\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"&lt;mark&gt;Yes&lt;/mark&gt; &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"==Yes== @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label"><mark>Yes</mark> <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"&lt;mark&gt;Yes&lt;/mark&gt; &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes3","label":"==Yes== @footer{N}","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- ==Yes== @footer{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"==Yes== @footer{N}"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- ==Yes== @footer{N}\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelMaterialList",
		locale: "fr",
		source: "# P\n::: choice Word\n\n(x) Yes @footer.insert\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes <span data-footer-insert="true">@footer.insert</span></span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes @footer.insert","isCorrect":true,"_inline":{"label":"Yes &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt;"}},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes @footer.insert\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes @footer.insert"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes @footer.insert\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableEscapedList",
		locale: "fr",
		source: "# T\n| Header |\n| --- |\n| \\@footer.insert [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:1"><thead><tr><th scope="col" style="text-align:left">Header</th></tr></thead><tbody><tr><td style="text-align:left"><span data-footer-insert="true">@footer.insert</span> <a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>',
		props: [],
		cells: [
			['<span data-footer-insert="true">@footer.insert</span> <a href="https://x.test/a(1">a</a>)'],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header"],"rows":[["@footer.insert [a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableCanonical",
		locale: "fr",
		source:
			"# T\n| Header | Other |\n| --- | --- |\n| @source{Note} [a](https://x.test/a(1)) | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1)">a</a></td><td style="text-align:left"><a href="https://x.test/a(1)">a</a></td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>Note</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> <a href="https://x.test/a(1)">a</a>',
				'<a href="https://x.test/a(1)">a</a>',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@source{Note} [a](https://x.test/a(1))","[a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableNeighbourActive",
		locale: "fr",
		source: "# T\n| Header | Other |\n| --- | --- |\n| @footer{N} | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup>',
				'<a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer{N}","[a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableNeighbourCode",
		locale: "fr",
		source: "# T\n| Header | Other |\n| --- | --- |\n| `@footer{N}` | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><code>@footer{N}</code></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>',
		props: [],
		cells: [["<code>@footer{N}</code>", '<a href="https://x.test/a(1">a</a>)']],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["`@footer{N}`","[a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableNeighbourEscaped",
		locale: "fr",
		source: "# T\n| Header | Other |\n| --- | --- |\n| \\@footer{N} | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"><sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [],
		cells: [
			[
				'<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup>',
				'<a href="https://x.test/a(1">a</a>)',
			],
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer{N}","[a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:tableNeighbourEscapedList",
		locale: "fr",
		source:
			"# T\n| Header | Other |\n| --- | --- |\n| \\@footer.insert | [a](https://x.test/a(1)) |\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">T</h1></div>\n<div id="block-x2" class="praxity-block praxity-block-table praxity-block-x2 praxity-block-feature-width" data-block-id="x2" data-node-id="x2" data-block-type="table" data-focus-row><figure class="praxity-figure-reset praxity-table-figure"><div class="praxity-table-scroll-region" role="region" aria-label="Tableau de données" tabindex="0"><table class="praxity-data-table" data-gridlines="all" data-shade-headers="true" data-first-row-line="true" data-first-col-line="false" data-striped="false" aria-label="Tableau de données" style="--praxity-table-columns:2"><thead><tr><th scope="col" style="text-align:left">Header</th><th scope="col" style="text-align:left">Other</th></tr></thead><tbody><tr><td style="text-align:left"></td><td style="text-align:left"><a href="https://x.test/a(1">a</a>)</td></tr></tbody></table></div><p class="praxity-table-scroll-hint">Faire défiler pour en voir plus</p></figure></div>',
		props: [],
		cells: [["", '<a href="https://x.test/a(1">a</a>)']],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "T",
				derivedScript: "T",
				sourceContent: '{"type":"heading","data":{"content":"<p>T</p>","level":1}}',
				script: "T",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x2",
				kind: "block",
				blockId: "x2",
				blockType: "table",
				label: "table",
				derivedScript: "Consultez le tableau sur la page pour voir toutes les données.",
				sourceContent:
					'{"type":"table","data":{"headers":["Header","Other"],"rows":[["@footer.insert","[a](https://x.test/a(1))"]]}}',
				script: "Consultez le tableau sur la page pour voir toutes les données.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:promotedsource",
		locale: "fr",
		source:
			"# Practice\n::: choice Word\n(x) Yes\nfeedback: Good @source{N}\n( ) No\n:::\n\nLater @source{Later}\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Practice</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="Practice" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @source{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>\n<div id="block-x7" class="praxity-block praxity-block-text praxity-block-x7" data-block-id="x7" data-node-id="x7" data-block-type="text" data-focus-row><div class="praxity-text"><p>Later <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[2]</sup></p></div></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li><li>Later</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @source{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: [
			'<p>Good <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup></p>',
			"",
		],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "Practice",
				derivedScript: "Practice",
				sourceContent: '{"type":"heading","data":{"content":"<p>Practice</p>","level":1}}',
				script: "Practice",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{"correct":"yes4"},"assessmentType":"choice","feedback":{"correct":[{"data":{"content":"<p>Good <span data-footer-content=\\"N\\">@footer{N}</span></p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"feedback":"Good @source{N}","id":"yes4","isCorrect":true,"label":"Yes"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x7",
				kind: "block",
				blockId: "x7",
				blockType: "text",
				label: "Later @footer{Later}",
				derivedScript: "Later @footer{Later}",
				sourceContent:
					'{"type":"text","data":{"content":"<p>Later <span data-footer-content=\\"Later\\">@footer{Later}</span></p>"}}',
				script: "Later @footer{Later}",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:promotedfooter",
		locale: "fr",
		source:
			"# Practice\n::: choice Word\n(x) Yes\nfeedback: Good @footer{N}\n( ) No\n:::\n\nLater @source{Later}\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">Practice</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="Practice" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good @footer{N}&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @footer{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Word</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>\n<div id="block-x7" class="praxity-block praxity-block-text praxity-block-x7" data-block-id="x7" data-node-id="x7" data-block-type="text" data-focus-row><div class="praxity-text"><p>Later <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[2]</sup></p></div></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li><li>Later</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Word&lt;/p&gt;"}}],"_feedbackOptionIds":{"correct":"yes4"},"stemLevel":2,"feedback":{"correct":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;Good @footer{N}&lt;/p&gt;"}}]},"feedbackEnabled":true,"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"feedback":"Good &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt;"},"id":"yes4","label":"Yes","isCorrect":true,"feedback":"Good @footer{N}"},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["<p>Good @footer{N}</p>", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "Practice",
				derivedScript: "Practice",
				sourceContent: '{"type":"heading","data":{"content":"<p>Practice</p>","level":1}}',
				script: "Practice",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"_feedbackOptionIds":{"correct":"yes4"},"assessmentType":"choice","feedback":{"correct":[{"data":{"content":"<p>Good @footer{N}</p>"},"id":"x3","type":"text"}]},"feedbackEnabled":true,"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"feedback":"Good @footer{N}","id":"yes4","isCorrect":true,"label":"Yes"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Word</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Word\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x7",
				kind: "block",
				blockId: "x7",
				blockType: "text",
				label: "Later @footer{Later}",
				derivedScript: "Later @footer{Later}",
				sourceContent:
					'{"type":"text","data":{"content":"<p>Later <span data-footer-content=\\"Later\\">@footer{Later}</span></p>"}}',
				script: "Later @footer{Later}",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelTree0",
		locale: "fr",
		source:
			"# P\n::: choice If a<b @source{N} then b>a\nx<y @source{N} z>w\n(x) x<y @source{N} z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[2]&lt;/sup&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @source{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[2]</sup> z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y <span class="praxity-doodle" data-doodle="source" data-doodle-mods="">N</span> z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li><li>N</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[2]&lt;/sup&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;span class=\\"praxity-doodle\\" data-doodle=\\"source\\" data-doodle-mods=\\"\\"&gt;N&lt;/span&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @source{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y <span data-footer-content=\\"N\\">@footer{N}</span> z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @source{N} z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b <span data-footer-content=\\"N\\">@footer{N}</span> then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelTree1",
		locale: "fr",
		source:
			"# P\n::: choice If a<b @footer{N} then b>a\nx<y @footer{N} z>w\n(x) x<y @footer{N} z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer{N} then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer{N} z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @footer{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b @footer{N} then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y @footer{N} z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y <sup class="praxity-footnote-ref"><span class="praxity-sr-only">Note </span>[1]</sup> z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>\n<div id="block-x0-footnotes" class="praxity-block praxity-block-text praxity-block-x0-footnotes" data-block-id="x0-footnotes" data-node-id="x0-footnotes" data-block-type="text" data-focus-row><div class="praxity-text"><ol class="praxity-footnotes" aria-label="Sources"><li>N</li></ol></div></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer{N} then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer{N} z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"_inline":{"label":"x&amp;lt;y &lt;sup class=\\"praxity-footnote-ref\\"&gt;&lt;span class=\\"praxity-sr-only\\"&gt;Note &lt;/span&gt;[1]&lt;/sup&gt; z&amp;gt;w"},"id":"yes4","label":"x&lt;y @footer{N} z&gt;w","isCorrect":true},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y @footer{N} z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @footer{N} z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b @footer{N} then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelTree2",
		locale: "fr",
		source:
			"# P\n::: choice If a<b @sources then b>a\nx<y @sources z>w\n(x) x<y @sources z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @sources z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y @sources z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b <span data-footer-insert="true">@footer.insert</span> then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y <span data-footer-insert="true">@footer.insert</span> z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y @sources z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @sources z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y @sources z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y <span data-footer-insert=\\"true\\">@footer.insert</span> z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @sources z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b <span data-footer-insert=\\"true\\">@footer.insert</span> then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelTree3",
		locale: "fr",
		source:
			"# P\n::: choice If a<b @footer.insert then b>a\nx<y @footer.insert z>w\n(x) x<y @footer.insert z>w\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x6" class="praxity-block praxity-block-assessment praxity-block-x6" data-block-id="x6" data-node-id="x6" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer.insert then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer.insert z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @footer.insert z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x6" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">If a&lt;b @footer.insert then b&gt;a</span></p></div><div id="x6-description" class="praxity-assessment-description"><div data-node-id="x3"><p>x&lt;y @footer.insert z&gt;w</p></div></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x6" aria-describedby="x6-description"><div class="praxity-assessment-choice-options"><label data-node-id="yes4" class="praxity-assessment-choice-option" for="x6-option-yes4"><input id="x6-option-yes4" type="radio" name="x6" value="yes4" aria-labelledby="x6-option-yes4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-yes4-label" class="praxity-choice-label">x&lt;y <span data-footer-insert="true">@footer.insert</span> z&gt;w</span></span></label><label data-node-id="no5" class="praxity-assessment-choice-option" for="x6-option-no5"><input id="x6-option-no5" type="radio" name="x6" value="no5" aria-labelledby="x6-option-no5-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-no5-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x6-option-dont-know"><input id="x6-option-dont-know" type="radio" name="x6" value="dont-know" aria-labelledby="x6-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x6-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x6","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;If a&amp;lt;b @footer.insert then b&amp;gt;a&lt;/p&gt;"}}],"stemLevel":2,"description":[{"id":"x3","type":"text","data":{"content":"&lt;p&gt;x&amp;lt;y @footer.insert z&amp;gt;w&lt;/p&gt;"}}],"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes4","label":"x&lt;y @footer.insert z&gt;w","isCorrect":true,"_inline":{"label":"x&amp;lt;y &lt;span data-footer-insert=\\"true\\"&gt;@footer.insert&lt;/span&gt; z&amp;gt;w"}},{"id":"no5","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x6",
				kind: "block",
				blockId: "x6",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","description":[{"data":{"content":"<p>x&lt;y @footer.insert z&gt;w</p>"},"id":"x3","type":"text"}],"feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes4","isCorrect":true,"label":"x<y @footer.insert z>w"},{"id":"no5","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>If a&lt;b @footer.insert then b&gt;a</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"If aa xw\n\n- xw\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x6"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:labelTreeCode",
		locale: "fr",
		source: "# P\n::: choice Yes `<tag` @footer{N >}\n(x) Yes\n( ) No\n:::\n",
		body: '<div id="block-x1" class="praxity-block praxity-block-heading praxity-block-x1" data-block-id="x1" data-node-id="x1" data-block-type="heading" data-heading-level="1" data-focus-row data-focus-exempt="heading"><h1 style="font-size:var(--praxity-type-h1);font-family:var(--praxity-font-family-h1, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h1, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h1, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">P</h1></div>\n<div id="block-x5" class="praxity-block praxity-block-assessment praxity-block-x5" data-block-id="x5" data-node-id="x5" data-block-type="assessment" data-focus-row data-assessment-report-title="P" data-island="assessment" data-block-json=\'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Yes &lt;code&gt;&amp;lt;tag&lt;/code&gt; @footer{N &amp;gt;}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}\'><form class="praxity-block-assessment praxity-assessment-choice-baseline"><div class="praxity-assessment-question-header"><p id="assessment-question-x5" class="praxity-assessment-stem"><span class="praxity-assessment-stem-content">Yes <code>&lt;tag</code> @footer{N &gt;}</span></p></div><fieldset class="praxity-fieldset-reset praxity-assessment-choice" role="radiogroup" aria-labelledby="assessment-question-x5"><div class="praxity-assessment-choice-options"><label data-node-id="yes3" class="praxity-assessment-choice-option" for="x5-option-yes3"><input id="x5-option-yes3" type="radio" name="x5" value="yes3" aria-labelledby="x5-option-yes3-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-yes3-label" class="praxity-choice-label">Yes</span></span></label><label data-node-id="no4" class="praxity-assessment-choice-option" for="x5-option-no4"><input id="x5-option-no4" type="radio" name="x5" value="no4" aria-labelledby="x5-option-no4-label" disabled /><span class="praxity-choice-key" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-no4-label" class="praxity-choice-label">No</span></span></label><label data-node-id="dont-know" data-dont-know class="praxity-assessment-choice-option" for="x5-option-dont-know"><input id="x5-option-dont-know" type="radio" name="x5" value="dont-know" aria-labelledby="x5-option-dont-know-label" disabled /><span class="praxity-choice-key-spacer" aria-hidden="true"></span><span class="praxity-choice-text"><span id="x5-option-dont-know-label" class="praxity-choice-label">Je ne sais pas</span></span></label></div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div><noscript><p class="praxity-assessment-needs-script">Répondre à cette question nécessite JavaScript. Activez-le pour répondre et voir la rétroaction.</p></noscript></form></div>',
		props: [
			'{"id":"x5","type":"assessment","data":{"stem":[{"id":"x2","type":"text","data":{"content":"&lt;p&gt;Yes &lt;code&gt;&amp;lt;tag&lt;/code&gt; @footer{N &amp;gt;}&lt;/p&gt;"}}],"stemLevel":2,"feedback":{},"gradingMode":"none","assessmentType":"choice","response":{"type":"choice","selectionMode":"single","inputMethod":"click","display":"list","options":[{"id":"yes3","label":"Yes","isCorrect":true},{"id":"no4","label":"No","isCorrect":false}]},"_dontKnow":true}}',
		],
		feedback: ["", ""],
		narration: [
			{
				id: "x1",
				kind: "block",
				blockId: "x1",
				blockType: "heading",
				label: "P",
				derivedScript: "P",
				sourceContent: '{"type":"heading","data":{"content":"<p>P</p>","level":1}}',
				script: "P",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: false,
				overrides: {},
				settings: {
					language: "fr",
				},
			},
			{
				id: "x5",
				kind: "block",
				blockId: "x5",
				blockType: "assessment",
				label: "assessment",
				derivedScript:
					"Yes }\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				sourceContent:
					'{"type":"assessment","data":{"_dontKnow":true,"assessmentType":"choice","feedback":{},"gradingMode":"none","response":{"display":"list","inputMethod":"click","options":[{"id":"yes3","isCorrect":true,"label":"Yes"},{"id":"no4","isCorrect":false,"label":"No"}],"selectionMode":"single","type":"choice"},"stem":[{"data":{"content":"<p>Yes <code>&lt;tag</code> @footer{N &gt;}</p>"},"id":"x2","type":"text"}],"stemLevel":2}}',
				script:
					"Yes }\n\n- Yes\n- No\n- Je ne sais pas\n\nExaminez maintenant les options sur la page et choisissez votre réponse.",
				custom: false,
				disabled: false,
				needsDraftReview: false,
				pauseAfter: true,
				authoredStopBlockIds: ["x5"],
				overrides: {},
				settings: {
					language: "fr",
				},
			},
		],
	},
	{
		name: "fr:rawCard:A <em>b</em>",
		locale: "fr",
		title: "A <em>b</em>",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A &lt;em&gt;b&lt;/em&gt;</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "fr:rawCard:A [l](https://x.test/a(1)) $x^2$",
		locale: "fr",
		title: "A [l](https://x.test/a(1)) $x^2$",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A <a href="https://x.test/a(1">l</a>) $x^2$</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "fr:rawCard:  spaced  ",
		locale: "fr",
		title: "  spaced  ",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">spaced</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "fr:rawCard:A `<b>` b",
		locale: "fr",
		title: "A `<b>` b",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A <code>&lt;b&gt;</code> b</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
	{
		name: "fr:rawCard:A \\*x\\*",
		locale: "fr",
		title: "A \\*x\\*",
		body: '<div id="block-cards" class="praxity-block praxity-block-card praxity-block-cards" data-block-id="cards" data-node-id="cards" data-block-type="card" data-focus-row><h2 style="font-size:var(--praxity-type-h2);font-family:var(--praxity-font-family-h2, var(--praxity-font-heading));font-weight:var(--praxity-font-weight-h2, var(--praxity-font-weight-heading));font-style:var(--praxity-font-style-h2, var(--praxity-font-style-heading));line-height:var(--leading-heading);letter-spacing:normal">A *x*</h2><div class="praxity-cards praxity-card-island" data-card-root data-block-id="cards" data-node-id="cards" data-layout="grid" data-columns="1" data-style="none" data-shadow="theme" data-shuffle="false" style="display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:16px"><article class="praxity-card praxity-card-item" data-card-item data-card-index="0" data-card-id="cards-item-0" data-node-id="cards-item-0" data-entrance="visible" data-flippable="false" style="--i:0;--praxity-stagger-index:0;text-align:left"><h3 class="praxity-card-header--minimal">One</h3><div class="praxity-card-body--minimal"></div></article><article class="praxity-card praxity-card-item" data-card-item data-card-index="1" data-card-id="cards-item-1" data-node-id="cards-item-1" data-entrance="visible" data-flippable="false" style="--i:1;--praxity-stagger-index:1;text-align:left"><h3 class="praxity-card-header--minimal">Two</h3><div class="praxity-card-body--minimal"></div></article></div></div>',
		props: [],
	},
];
it.each(mainRenderCases)("preserves main rendering and embedded JSON: $name", (row) => {
	let id = 0;
	const page: PraxityPage = row.source
		? readLesson(row.source, {
				ids: (node) =>
					node.kind === "option" ? (node.correct ? `yes${id++}` : `no${id++}`) : `x${id++}`,
			}).pages[0]
		: {
				id: "page",
				title: "Cards",
				blocks: [
					{
						id: "cards",
						type: "card",
						data: {
							title: row.title,
							items: [
								{ label: "One", front: [] },
								{ label: "Two", front: [] },
							],
						},
					},
				],
			};
	const config: CourseConfig = {
		id: "course",
		title: "P",
		sourceLocale: row.locale,
		totalPages: 1,
		pages: [page],
	};
	const body = renderPageFragments(config, page, new Set(["assessment"]))
		.map((fragment) => fragment.html)
		.join("\n");
	expect(body).toBe(row.body);
	expect([...body.matchAll(/data-block-json='([^']*)'/g)].map((match) => match[1])).toEqual(
		row.props,
	);
	const prepared = preparePageFootnotes(page.blocks, "page", getStrings(row.locale));
	if (row.feedback) {
		const data = prepared.find((block) => block.type === "assessment")
			?.data as unknown as AssessmentBlockData;
		if (data.response.type !== "choice") throw new Error("Missing choice");
		expect(data.response.options.map((option) => optionFeedbackHtml(data, option))).toEqual(
			row.feedback,
		);
	}
	if (row.cells) {
		const table = prepared.find((block) => block.type === "table");
		expect(
			row.cells.map((cells, i) => cells.map((_, j) => getInlineField(table?.data, ["rows", i, j]))),
		).toEqual(row.cells);
	}
	if (row.narration)
		expect(extractNarrationSegments("", {}, page.blocks, {}, row.locale)).toEqual(row.narration);
});

// Pinned from the base after removing only the compiled choice facts.
const mainDocumentCases = [
	{
		name: "labelCodeHtml",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) Use `<em>` tag\n( ) No\n:::\n",
		hash: "37b72b059266f33bcaec688bb96d691c213eedd012554ffc614cf00c64c7381b",
	},
	{
		name: "labelEscHtml",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) a \\<em>b\n( ) No\n:::\n",
		hash: "cc84e561b8c88de32fe530caf075aebf6dedd749f279d48522e9eb2d7a26d07d",
	},
	{
		name: "labelRealHtml",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) a <em>b</em>\n( ) No\n:::\n",
		hash: "ce521b5f44b34ad3a866b343854157d0ba0f8ec2d87634183249712c9a67def1",
	},
	{
		name: "labelCodeSpan",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) The `<span>` tag\n( ) The `<div>` tag\n:::\n",
		hash: "06b3c8084a6e82ea0d9f17722daee9c558676e7a4035e978a22e57dbe0ef590c",
	},
	{
		name: "fbLinkTerm",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: [Guide](https://example.com) [term]{Definition} and `code`\n:::\n",
		hash: "d3e011eba8810d6e41800c8f08c9ee22713dcdd364b882625684e9c5413b4bda",
	},
	{
		name: "fbLinkTerm",
		slug: "glossary",
		configs: 1,
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: [Guide](https://example.com) [term]{Definition} and `code`\n:::\n",
		hash: "d3c722f0b49cc9afbdb5c126e66acbef7b22c5e845111f15ecf03fdfd8c10253",
	},
	{
		name: "fbHtml",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: Use <em>this</em> one\n:::\n",
		hash: "2e93313bfaba2d4285902398cd5fdc8169f3d643497e83f30e14e8a6f2fe6dc6",
	},
	{
		name: "fbCodeHtml",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice Word\nincorrect: Try again\n(x) Yes\n( ) No\nfeedback: Use `<em>` here\n:::\n",
		hash: "f24ed8f83275e0781b2d268e0962fbfbf55d1860047a958b1ad7c00ffdfc5590",
	},
	{
		name: "fbMultiNoPromo",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice Word {multiple}\n(x) Yes\nfeedback: Good [Guide](https://example.com)\n(x) Also\nfeedback: Fine [term]{Def}\n( ) No\nfeedback: Bad [Guide](https://example.com)\n:::\n",
		hash: "ff12efda1acd30547840aada32a2aa45432a498d0ccf0c50d62c959923909ba0",
	},
	{
		name: "fbMultiNoPromo",
		slug: "glossary",
		configs: 1,
		source:
			"# P\n::: choice Word {multiple}\n(x) Yes\nfeedback: Good [Guide](https://example.com)\n(x) Also\nfeedback: Fine [term]{Def}\n( ) No\nfeedback: Bad [Guide](https://example.com)\n:::\n",
		hash: "492b51d38f1936221e09146f0ef941ea41c93fe3f369ed948f0b5b533d11f868",
	},
	{
		name: "labelFooterInsertMid",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) Yes @footer.insert now\n( ) No\n:::\n",
		hash: "27013dd4fe29f90540fc74856c875a55d5172896d2351e37cf2a857259ef5daf",
	},
	{
		name: "labelFooter",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) Yes @footer{N}\n( ) No\n:::\n",
		hash: "a95860c568016ba0122137359487e5601308ce9db5714831556e894c1e52d4a9",
	},
	{
		name: "labelSource",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) Yes @source{N}\n( ) No\n:::\n",
		hash: "bba6c26a4717208a1aff3078623aa310c00492d26e5aa5376e36916b3b8cfa50",
	},
	{
		name: "labelPlain",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) Yes\n( ) No\n:::\n",
		hash: "3b998dbc8a141c4a9ee64e85b579d20a171b36b79c19ea542e5f3fe6c56a05b7",
	},
	{
		name: "labelWavy",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n(x) Yes @source.wavy{N}\n( ) No\n:::\n",
		hash: "0ab15a820e5dedbfa01dcccdf542485111c7023034f223f5ea625ff373db2246",
	},
	{
		name: "labelMaterialHtml",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n\n(x) Yes @source{Use `<span>`}\n( ) No\n:::\n",
		hash: "40dc6f4170ad84a95c5eeedd89c6107089d027b28db0eb0f732869e147155c73",
	},
	{
		name: "labelMaterialAliasStem",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word @footer{N}\n\n(x) Yes\n( ) No\n:::\n",
		hash: "ea67362d4d46bb069a61f6196d4c8bb96488986b05940ea3ecb3041a22a5070c",
	},
	{
		name: "labelMaterialAliasDescription",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\nDescription @footer{N}\n(x) Yes\n( ) No\n:::\n",
		hash: "5418d83fc5f3337886806531515010b0bc81adeca11b4bca898d5b96c36ff71d",
	},
	{
		name: "labelMaterialWhole",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n\n(x) @source{N}\n( ) No\n:::\n",
		hash: "6094a2a86d571c3d1c5051b797ede2576826b5664abff6983ca263e43a6e05a2",
	},
	{
		name: "labelMaterialWholeMark",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n\n(x) ==Yes== @footer{N}\n( ) No\n:::\n",
		hash: "6d619bfd2fb20284eb830b9003ff9b41130191ae7b0c4e51ff5c0fcf76d1b088",
	},
	{
		name: "labelMaterialList",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Word\n\n(x) Yes @footer.insert\n( ) No\n:::\n",
		hash: "0769bc873da9b35264dccb0e73d647289db2adc5a19206a71c6936ce63b3b0a0",
	},
	{
		name: "labelTree0",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice If a<b @source{N} then b>a\nx<y @source{N} z>w\n(x) x<y @source{N} z>w\n( ) No\n:::\n",
		hash: "d5c9ee6ed2dbff6b0d1e72224de66da9f9771cdf9144c2bdff9d94d7c3baafd8",
	},
	{
		name: "labelTree1",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice If a<b @footer{N} then b>a\nx<y @footer{N} z>w\n(x) x<y @footer{N} z>w\n( ) No\n:::\n",
		hash: "3709b7f506507ee991b736d0425e3c5d1c2d97914e2afee814728f4af8c98f77",
	},
	{
		name: "labelTree2",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice If a<b @sources then b>a\nx<y @sources z>w\n(x) x<y @sources z>w\n( ) No\n:::\n",
		hash: "371c65abf2d7b737a686991b735f8136ee08fbe68d5e4fcba00b6a7ad148c3f7",
	},
	{
		name: "labelTree3",
		slug: "p",
		configs: 2,
		source:
			"# P\n::: choice If a<b @footer.insert then b>a\nx<y @footer.insert z>w\n(x) x<y @footer.insert z>w\n( ) No\n:::\n",
		hash: "136201856e88ac74fa1791a5a7f0e29f5e1b08fab0a2e10c9c585aa682b5dc86",
	},
	{
		name: "labelTreeCode",
		slug: "p",
		configs: 2,
		source: "# P\n::: choice Yes `<tag` @footer{N >}\n(x) Yes\n( ) No\n:::\n",
		hash: "495400dbcabfa9f3aa6282dd1ff1bbc28bc7c9d97c3ee749899728aaaded4d33",
	},
];
it.each(mainDocumentCases)("preserves all ordinary document bytes: $name in $slug", async (row) => {
	let id = 0;
	const read = readLesson(row.source, {
		ids: (node) =>
			node.kind === "option" ? (node.correct ? `yes${id++}` : `no${id++}`) : `x${id++}`,
	});
	const context = await createCourseContext({
		id: "course",
		title: "P",
		sourceLocale: "en",
		content: read.pages,
		htmlOutput: { islandAssets: compilerIslandAssets },
	});
	const html = compileDocument(context, row.slug).html;
	const facts: unknown[] = [];
	const configs =
		html.match(
			/<script id="(?:praxity-host-config|praxity-config)" type="application\/json">(.*?)<\/script>/g,
		) ?? [];
	for (const script of configs) {
		const value = JSON.parse(script.slice(script.indexOf(">") + 1, -9));
		facts.push([value.choiceStateQuestions, value.choiceStateSignatures]);
	}
	expect(configs).toHaveLength(row.configs);
	for (const published of facts.slice(1)) expect(published).toEqual(facts[0]);
	expect(createHash("sha256").update(stripChoiceStateFacts(html)).digest("hex")).toBe(row.hash);
});
