import { MantineProvider } from "@mantine/core";
import { render as renderReact } from "@testing-library/react";
import katex from "katex";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	optionLabelHtml,
	prepareAssessmentContent,
	prepareAssessmentDescriptionHtml,
	prepareAssessmentOptionHtml,
} from "../src/assessment-content";
import { PreviewAssessmentBlock } from "../src/blocks/AssessmentBlock";
import { inlineMarkdown } from "../src/inline-markdown";
import { preparePageFootnotes } from "../src/page-footnotes";
import type { AssessmentBlockData, PraxityBlock } from "../src/types";

const math = '<span class="praxity-math-inline" data-math-latex="x">x</span>';
const renderedMath =
	'<span class="praxity-math-inline" data-math-latex="x"><span role="math" aria-label="x"><span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x</annotation></semantics></math></span></span></span>';
const note = (number: number) =>
	`<sup class="praxity-footnote-ref"><span class="praxity-sr-only">Footnote </span>[${number}]</sup>`;
const textBlock = (id: string, content: string): PraxityBlock => ({
	id,
	type: "text",
	data: { content },
});
function data(stem: unknown, description?: unknown): AssessmentBlockData {
	return {
		assessmentType: "choice",
		stem,
		description,
		gradingMode: "none",
		response: {
			type: "choice",
			selectionMode: "single",
			options: [{ id: "one", label: "**One**" }],
		},
	} as AssessmentBlockData;
}
function render(value: AssessmentBlockData): string {
	return renderToStaticMarkup(
		<MantineProvider>
			<PreviewAssessmentBlock data={value} blockId="question" />
		</MantineProvider>,
	);
}
function assertRendered(value: AssessmentBlockData) {
	const content = prepareAssessmentContent(value, "Question");
	const prepared = {
		...content,
		descriptionContent: prepareAssessmentDescriptionHtml(content.descriptionHtml),
	};
	const html = render(value);
	if (prepared.stemHtml) {
		expect(html).toContain(
			`<span class="praxity-assessment-stem-content">${prepared.stemContent.heading}</span>`,
		);
	}
	if (prepared.stemContent.body) {
		expect(html).toContain(
			`<div class="praxity-assessment-stem-body">${prepared.stemContent.body}</div>`,
		);
	}
	if (prepared.descriptionHtml) {
		expect(html).toContain(
			`<div id="assessment-description-question" class="praxity-assessment-description">${prepared.descriptionContent}</div>`,
		);
	}
	if (value.response.type !== "choice") throw new Error("Expected choice fixture");
	for (const option of value.response.options) {
		expect(html).toContain(
			`class="praxity-choice-label"><span>${prepareAssessmentOptionHtml(option)}</span></span>`,
		);
	}
	return prepared;
}

describe("assessment learner HTML preparation", () => {
	it.each([
		["string", "<p>Pick <em>one</em>.</p><p>Details.</p>"],
		[
			"blocks",
			[textBlock("stem", "<p>Pick <em>one</em>.</p>"), textBlock("body", "<p>Details.</p>")],
		],
		["ProseMirror", [{ type: "paragraph", content: [{ type: "text", text: "Pick one." }] }]],
	])("supplies the rendered %s stem and description", (_name, stem) => {
		const prepared = assertRendered(
			data(stem, [textBlock("description", "<p>Read <strong>carefully</strong>.</p>")]),
		);
		expect(prepared.stemContent.heading).toBe(
			_name === "ProseMirror" ? "Pick one." : "Pick <em>one</em>.",
		);
		expect(prepared.stemContent.body).toBe(_name === "ProseMirror" ? "" : "<p>Details.</p>");
		expect(prepared.descriptionContent).toBe("<p>Read <strong>carefully</strong>.</p>");
	});

	it("keeps page-numbered footnotes and the distinct math paths byte for byte", () => {
		const questionData = data(
			[
				textBlock(
					"stem",
					`<p>Pick ${math} ${inlineMarkdown("@footer{Stem source}")}</p><p>Body ${math}</p>`,
				),
			],
			[
				textBlock(
					"description",
					`<p>Read ${math} ${inlineMarkdown("@footer{Description source}")}</p>`,
				),
			],
		);
		if (questionData.response.type !== "choice") throw new Error("Expected choice fixture");
		questionData.response.options[0].label = "**One** @footer{Option source}";
		const [, question, footnotes] = preparePageFootnotes(
			[
				textBlock("earlier", inlineMarkdown("Earlier @footer{Earlier source}")),
				{
					id: "question",
					type: "assessment",
					data: questionData as unknown as PraxityBlock["data"],
				},
			],
			"page",
			{ footnote: "Footnote", footnotes: "Sources" },
		);
		const value = question.data as unknown as AssessmentBlockData;
		if (value.response.type !== "choice") throw new Error("Expected choice fixture");
		// A prepared legacy option retains its math span without expanding it.
		value.response.options.push({
			id: "two",
			label: `One ${math}`,
			_inline: { label: `One ${math}` },
		} as (typeof value.response.options)[number]);
		const prepared = assertRendered(value);
		expect(prepared.stemContent.heading).toBe(`Pick ${renderedMath} ${note(2)}`);
		expect(prepared.stemContent.body).toBe(`<p>Body ${renderedMath}</p>`);
		expect(prepared.descriptionContent).toBe(`<p>Read ${renderedMath} ${note(3)}</p>`);
		expect(prepareAssessmentOptionHtml(value.response.options[0])).toBe(
			`<strong>One</strong> ${note(4)}`,
		);
		expect(prepareAssessmentOptionHtml(value.response.options[1])).toBe(`One ${math}`);
		expect(footnotes.data.content).toBe(
			'<ol class="praxity-footnotes" aria-label="Sources"><li>Earlier source</li><li>Stem source</li><li>Description source</li><li>Option source</li></ol>',
		);
	});

	it.each([
		["missing", undefined, "", ""],
		["empty", [], "", ""],
		["block-only", "<ul><li>Read this.</li></ul>", "Question", "<ul><li>Read this.</li></ul>"],
		["sanitized", '<p onclick="bad()">Pick one.</p><script>bad()</script>', "Pick one.", ""],
	])("preserves %s presence checks and heading fallback", (_name, stem, heading, body) => {
		const value = data(stem);
		const prepared = assertRendered(value);
		expect(prepared.stemHtml).toBe(typeof stem === "string" ? stem : "");
		expect(prepared.stemContent.heading).toBe(heading || "Question");
		expect(prepared.stemContent.body).toBe(body);
		expect(prepared.descriptionContent).toBe("");
		expect(render(value)).not.toContain('id="assessment-description-question"');
	});

	it.each([
		[{ label: "**Label**", text: "Unused" }, "<strong>Label</strong>"],
		[{ label: "", text: "*Text*" }, "<em>Text</em>"],
		[{ content: [{ type: "text", text: "**Content**" }] }, "<strong>Content</strong>"],
		[{ label: "Source", _inline: { label: "<em>Prepared</em>" } }, "<em>Prepared</em>"],
		[
			{ label: '<a href="https://example.com"><strong>Manual</strong></a>' },
			"<strong>Manual</strong>",
		],
		[{}, ""],
	])("prepares noninteractive options through the owner: %j", (option, expected) => {
		expect(prepareAssessmentOptionHtml(option)).toBe(expected);
		const value = data("Pick one.");
		if (value.response.type !== "choice") throw new Error("Expected choice fixture");
		value.response.options = [{ id: "one", ...option }] as typeof value.response.options;
		assertRendered(value);
	});

	it("reuses description math across renders with unchanged input", () => {
		const value = data("Pick one.", [textBlock("description", `<p>Read ${math}</p>`)]);
		const renderMath = vi.spyOn(katex, "renderToString");
		try {
			const { rerender } = renderReact(<PreviewAssessmentBlock data={value} blockId="question" />, {
				wrapper: MantineProvider,
			});
			expect(renderMath).toHaveBeenCalledTimes(1);
			rerender(<PreviewAssessmentBlock data={{ ...value }} blockId="question" />);
			expect(renderMath).toHaveBeenCalledTimes(1);
			rerender(
				<PreviewAssessmentBlock
					data={{ ...value, description: [textBlock("description", `<p>Changed ${math}</p>`)] }}
					blockId="question"
				/>,
			);
			expect(renderMath).toHaveBeenCalledTimes(2);
		} finally {
			renderMath.mockRestore();
		}
	});

	it("keeps the raw option projection available to interaction reporting", () => {
		const option = { label: "Source", _inline: { label: '<span onclick="bad()">Label</span>' } };
		expect(optionLabelHtml(option)).toBe('<span onclick="bad()">Label</span>');
		expect(prepareAssessmentOptionHtml(option)).toBe("<span>Label</span>");
	});
});
