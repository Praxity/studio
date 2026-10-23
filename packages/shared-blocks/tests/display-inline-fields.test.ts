import { describe, expect, it } from "vitest";
import { optionLabelHtml } from "../src/assessment-content";
import { getInlineField, prepareInlineBlocks } from "../src/inline-markdown";

describe("display node field compatibility", () => {
	it.each([
		["Yes", "Yes"],
		["[Yes]{Definition}", "Yes (Definition)"],
		["[Yes]{Other definition}", "Yes (Other definition)"],
		[
			"@circle{Yes}",
			'<span class="praxity-doodle" data-doodle="circle" data-doodle-mods="">Yes</span>',
		],
		["[Yes](https://x.test)", "Yes"],
		["~~Yes~~", "<del>Yes</del>"],
		["@footer{Note}", '<span data-footer-content="Note">@footer{Note}</span>'],
	])("preserves raw option and ProseMirror fallback HTML for %s", (source, html) => {
		expect(optionLabelHtml({ label: source })).toBe(html);
		expect(optionLabelHtml({ text: source })).toBe(html);
		expect(
			optionLabelHtml({ content: [{ type: "text", text: source, marks: [{ type: "bold" }] }] }),
		).toBe(html);
		expect(
			optionLabelHtml({
				label: "",
				text: "",
				content: [{ type: "paragraph", content: [{ type: "text", text: source }] }],
			}),
		).toBe(html);
	});
	it("retains label then text then extracted content precedence", () => {
		expect(optionLabelHtml({ label: "Label", text: "Text", content: [{ text: "Content" }] })).toBe(
			"Label",
		);
		expect(optionLabelHtml({ label: "", text: "Text", content: [{ text: "Content" }] })).toBe(
			"Text",
		);
	});
	it("retains field interactivity, prepared display copies and rich HTML passthrough", () => {
		const source = "[Yes](https://x.test) [Term]{Definition}";
		const blocks = prepareInlineBlocks([
			{ id: "note", type: "note", data: { title: source } },
			{
				id: "question",
				type: "assessment",
				data: { response: { type: "choice", options: [{ label: source }] } },
			},
		]);
		expect(getInlineField(blocks[0].data, "title")).toBe(
			'<a href="https://x.test">Yes</a> <span class="inline-tooltip-trigger" data-tooltip-content="Definition">Term</span>',
		);
		const option = (blocks[1].data.response as { options: Record<string, unknown>[] }).options[0];
		expect(optionLabelHtml(option)).toBe("Yes Term (Definition)");
		expect(option.label).toBe(source);
		expect(getInlineField({ title: "<p>**literal**</p>" }, "title")).toBe("<p>**literal**</p>");
		expect(prepareInlineBlocks(blocks)).toBe(blocks);
	});
});
