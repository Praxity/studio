import { readHighlightContent, readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { childRecords } from "../child-records";
import { adaptGrammarPreviewBlocks } from "../grammar-adapter";
import { preparePageFootnotes } from "../page-footnotes";
import type { HighlightContent, HighlightData } from "../types";

const lesson = () =>
	readLesson(
		"# P\n::: highlight <b>Title</b>\nquestion: **Question**\n:: [term]\\{definition} @icon{star} @footer{note} {key=true}\nnote: <script>hostile()</script>\n:: Other {paragraph=true}\n:::\n",
	);

it("reexports the public types and preserves literal content through the grammar adapter and footnotes", () => {
	const read = lesson();
	const block = read.blocks.find((b) => b.type === "highlight")!;
	const content: HighlightContent = readHighlightContent(read, block.id);
	const data: HighlightData = { level: 2, content };
	expect(block.data).toEqual(data);
	expect(adaptGrammarPreviewBlocks([block])).toEqual([block]);
	expect(
		preparePageFootnotes([block], "page", { footnote: "Footnote", footnotes: "Footnotes" }),
	).toEqual([block]);
	expect(JSON.stringify(block)).not.toContain("data-node-id");
});

it("enumerates chunk identities and structural paths across paragraphs", () => {
	const read = lesson();
	const block = read.blocks.find((b) => b.type === "highlight")!;
	const content = readHighlightContent(read, block.id);
	expect(childRecords(block)).toEqual([
		{
			kind: "item",
			id: content.paragraphs[0][0].id,
			ownerId: block.id,
			path: "block.data.content.paragraphs[0][0].id",
		},
		{
			kind: "item",
			id: content.paragraphs[1][0].id,
			ownerId: block.id,
			path: "block.data.content.paragraphs[1][0].id",
		},
	]);
});

it.each(["missing", "duplicate"])(
	"refuses %s child identities through the grammar adapter",
	(kind) => {
		const read = lesson();
		const block = read.blocks.find((b) => b.type === "highlight")!;
		const content = block.data.content as HighlightContent;
		content.paragraphs[1][0].id = kind === "missing" ? "" : content.paragraphs[0][0].id;
		expect(() => adaptGrammarPreviewBlocks([block])).toThrow(
			kind === "missing" ? /Missing child ID/ : /Duplicate child ID/,
		);
	},
);
