import { parseInlineMarkdown } from "@praxity/content-model/inline-markdown";
import { inlineParagraph, renderInlineTree } from "@praxity/content-model/inline-tree";
import { readLesson } from "../../../grammar/src/read-lesson";
import { tokenizeInline } from "../../../grammar/src/v4/inline";
import { preparePageFootnotes } from "../../src/page-footnotes";
import type { AssessmentBlockData } from "../../src/types";
import vectors from "./choice-signature-vectors.json";

// The pinned fixture exercises legacy raw-string fields accepted by the renderer.
export const question = () =>
	structuredClone(vectors.question.data) as unknown as AssessmentBlockData;
export const producers = [
	{ name: "grammar", parse: tokenizeInline, note: "@source{N}", sources: "@sources" },
	{ name: "display", parse: parseInlineMarkdown, note: "@footer{N}", sources: "@footer.insert" },
] as const;
export type Producer = (typeof producers)[number];

export function fieldQuestion(
	source: string,
	field: "stem" | "description" | "option",
	producer: Producer,
): AssessmentBlockData {
	const data = question();
	const tree =
		field === "option" ? producer.parse(source) : inlineParagraph(producer.parse(source));
	const html = renderInlineTree(tree, { interactive: field !== "option" });
	if (field === "option" && data.response.type === "choice") {
		Object.assign(data.response.options[0], {
			label: source,
			_inline: { label: html },
			_inlineTrees: { label: [tree] },
		});
	} else
		data[field as "stem" | "description"] = [
			{ id: "field", type: "text", data: { content: html, _inlineTrees: { content: [tree] } } },
		];
	return data;
}

export function compiled(
	stem: string,
	description = "",
	label = "Yes",
	earlier = "",
	page = "Practice",
): AssessmentBlockData {
	let ordinary = 0;
	const read = readLesson(
		`# ${page}\n${earlier}\n::: choice ${stem} {scored}\n${description}\n(x) ${label}\n( ) No\n:::\n`,
		{
			ids(node, role) {
				if (node.type === "choice") return `question-${role ?? "root"}`;
				if (node.kind === "option") return node.correct ? "a" : "b";
				return `other-${ordinary++}`;
			},
		},
	);
	if (read.hasErrors) throw new Error(JSON.stringify(read.diagnostics));
	const pageWithQuestion = read.pages.find((page) =>
		page.blocks.some((block) => block.type === "assessment"),
	);
	if (!pageWithQuestion) throw new Error("Missing choice page");
	const block = preparePageFootnotes(pageWithQuestion.blocks, pageWithQuestion.id, {
		footnote: "Footnote",
		footnotes: "Sources",
	}).find((block) => block.type === "assessment");
	if (!block) throw new Error("Missing choice fixture");
	return block.data as unknown as AssessmentBlockData;
}
