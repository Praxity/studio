import { describe, expect, it } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { adaptGrammarPreviewBlocks } from "../grammar-adapter";
import {
	getInlineField,
	hasInlineIconMarkup,
	materializeInlineIcons,
	prepareInlineBlocks,
	withoutInlineProjectionMetadata,
} from "../inline-markdown";
import { preparePageFootnotes } from "../page-footnotes";
import { sanitizeHtml } from "../sanitize";

const parse = (source: string) => adaptGrammarPreviewBlocks(readBlockSource(source).blocks);
const strings = { footnote: "Footnote", footnotes: "Sources" };

describe("inline display preparation", () => {
	it("removes only inline projection metadata recursively and retains runtime display copies", () => {
		const data = {
			_inline: { label: "<strong>Question</strong>" },
			_htmlFields: ["label"],
			_inlineTrees: { label: [{ source: "Question", children: [] }] },
			label: "Question",
			_dontKnow: true,
			_headingLevel: 3,
			_feedbackOptionIds: { correct: "option" },
			items: [
				{
					label: "Item",
					_inline: { label: "<em>Item</em>" },
					_htmlFields: ["label"],
					_inlineTrees: { label: [] },
				},
			],
		};
		const original = structuredClone(data);
		expect(withoutInlineProjectionMetadata(data)).toEqual({
			label: "Question",
			_dontKnow: true,
			_headingLevel: 3,
			_feedbackOptionIds: { correct: "option" },
			items: [{ label: "Item" }],
		});
		expect(withoutInlineProjectionMetadata(data, { keepDisplay: true })).toEqual({
			_inline: { label: "<strong>Question</strong>" },
			label: "Question",
			_dontKnow: true,
			_headingLevel: 3,
			_feedbackOptionIds: { correct: "option" },
			items: [{ label: "Item", _inline: { label: "<em>Item</em>" } }],
		});
		expect(data).toEqual(original);
	});
	it("does not prepare icon-shaped HTML in a literal self-check task", () => {
		const blocks = parse(
			'# Practice\n::: self-check Write @icon{mail} <span data-praxity-inline-icon="mail"></span> here.\nmodel: Model\n:: Criterion\nmissed: Hint\n:::\n',
		);
		const original = structuredClone(blocks);
		expect(prepareInlineBlocks(blocks)).toBe(blocks);
		expect(hasInlineIconMarkup(blocks)).toBe(false);
		materializeInlineIcons(blocks, { outline: { mail: [["path", { d: "M1 1" }]] }, filled: {} });
		expect(blocks).toEqual(original);
	});
	it("prepares dialogue paragraphs beside unchanged source", () => {
		const blocks = parse(
			"---\n{ cast: { alex: {}, sam: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Alex: Hello *there*\n- Sam: Start here\ncaption: A **meeting**\n:::\n",
		);
		const prepared = prepareInlineBlocks(blocks);
		const turn = (prepared[0].data.turns as Array<Record<string, unknown>>)[0];
		expect(turn.paragraphs).toEqual(["Hello *there*"]);
		expect((turn._inline as { paragraphs: string[] }).paragraphs[0]).toContain("<em>there</em>");
		expect(getInlineField(turn, ["paragraphs", 0])).toContain("<em>there</em>");
		expect(getInlineField(prepared[0].data, "caption")).toContain("<strong>meeting</strong>");
		expect(prepareInlineBlocks(prepared)).toBe(prepared);
	});
	it("prepares dialogue delivery cues without changing narration source", () => {
		const blocks = parse(
			"---\n{ cast: { alex: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- Alex: [warm] Hello *there* \\[warm] [sighs]\n:::\n",
		);
		const prepared = prepareInlineBlocks(blocks);
		const turn = (prepared[0].data.turns as Array<{ paragraphs: string[] }>)[0];
		expect(turn.paragraphs[0]).toBe("[warm] Hello *there* \\[warm] [sighs]");
		expect(getInlineField(turn, ["paragraphs", 0])).toContain(
			"Hello <em>there</em> [warm] [sighs]",
		);
	});
	it("keeps legacy rich control labels noninteractive without losing their text", () => {
		const legacy =
			'<a href="https://example.com"><strong>Manual</strong></a> <span class="inline-tooltip-trigger" tabindex="0" role="button" data-tooltip-content="Protective equipment">PPE</span>';
		const label = sanitizeHtml(getInlineField({ label: legacy }, "label", false), {
			interactive: false,
		});
		expect(label).toContain("<strong>Manual</strong>");
		expect(label).toContain("Protective equipment");
		expect(label).not.toMatch(/<a\b|tabindex=|role="button"|data-tooltip-content=/);
	});

	it("prepares captions without changing authored source and is idempotent", () => {
		const blocks = parse(
			"# Untitled {hideTitle}\n\n::: figure\n![Example](/assets/image.png)\n**Mail** @icon{mail} @footer{Source}\n:::\n",
		);
		const original = JSON.stringify(blocks);
		const prepared = prepareInlineBlocks(blocks);
		expect(getInlineField(prepared[0].data, "caption")).toContain("<strong>Mail</strong>");
		expect(getInlineField(prepared[0].data, "caption")).toContain("data-praxity-inline-icon");
		expect(prepared[0].data.caption).toBe(blocks[0].data.caption);
		expect(JSON.stringify(blocks)).toBe(original);
		expect(prepareInlineBlocks(prepared)).toBe(prepared);
	});

	it("collects title sources before body sources without collecting either twice", () => {
		const parsed = parse(
			"# Untitled {hideTitle}\n\n::: accordion\n:: Details @footer{Title} {level=3}\nBody @source{Body}.\n:::\n",
		);
		const parsedItem = (parsed[0].data.items as Array<Record<string, unknown>>)[0];
		parsedItem.title = "Unused @footer{Hidden title}";
		const blocks = preparePageFootnotes(parsed, "page", strings);
		const item = (blocks[0].data.items as Array<Record<string, unknown>>)[0];
		expect(getInlineField(item, "label")).toContain("[1]");
		expect(blocks.at(-1)?.data.content).toContain("<li>Title</li><li>Body</li>");
		expect(blocks.at(-1)?.data.content).not.toContain("Hidden title");
		expect(preparePageFootnotes(blocks, "page", strings)).toBe(blocks);
	});

	it("resolves icons and sources in table cells and captions", () => {
		const blocks = prepareInlineBlocks(
			parse(
				"# Untitled {hideTitle}\n\n| Action | Source |\n| @icon{mail} **Mail** | Evidence @source{Citation} |\n",
			),
		);
		materializeInlineIcons(blocks, { outline: { mail: [["path", { d: "M1 1" }]] }, filled: {} });
		const prepared = preparePageFootnotes(blocks, "page", strings);
		expect(sanitizeHtml(getInlineField(prepared[0].data, ["rows", 0, 0]))).toContain("<svg");
		expect(getInlineField(prepared[0].data, ["rows", 0, 0])).toContain("<strong>Mail</strong>");
		expect(getInlineField(prepared[0].data, ["rows", 0, 1])).toContain("[1]");
		expect(prepared.at(-1)?.data.content).toContain("<li>Citation</li>");
	});

	it("does not format code, URLs, alt text, or grading keys", () => {
		const blocks = parse(
			"# Untitled {hideTitle}\n\n::: figure\n![**literal**](/assets/@icon{mail}.png)\nVisible **bold**\n:::\n",
		);
		const prepared = prepareInlineBlocks(blocks);
		expect(prepared[0].data.src).toBe(blocks[0].data.src);
		expect(prepared[0].data.alt).toBe("**literal**");
		const assessment = {
			id: "a",
			type: "assessment" as const,
			data: {
				response: {
					type: "matching",
					pairs: [{ id: "p", prompt: "**Prompt**", correctMatch: "**Answer**" }],
				},
			},
		};
		const result = prepareInlineBlocks([assessment]);
		expect((result[0].data.response as typeof assessment.data.response).pairs[0].correctMatch).toBe(
			"**Answer**",
		);
	});
});
