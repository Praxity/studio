import { resolveAssessmentDontKnow } from "@praxity/content-model";
import {
	type InlineIconCatalogs,
	materializeInlineIcons,
} from "@praxity/content-model/inline-icons";
import { inlineParagraph, renderInlineTree } from "@praxity/content-model/inline-tree";
import { constructSelfCheckPromptData } from "../../../export-pipeline/src/self-check-prompt";
import { readLesson } from "../../../grammar/src/read-lesson";
import { adaptGrammarPreviewBlocks } from "../../src/grammar-adapter";
import { prepareInlineBlocks } from "../../src/inline-markdown";
import { preparePageFootnotes } from "../../src/page-footnotes";
import type { AssessmentBlockData } from "../../src/types";
import { producers, question } from "./choice-material";

export type IconField = "stem" | "description" | "option";

export function preparedIconQuestion(
	producer: "grammar" | "display",
	field: IconField,
	source: string,
	catalogs: InlineIconCatalogs,
): AssessmentBlockData {
	const stem = field === "stem" ? source : "Pick";
	const description = field === "description" ? source : "Read";
	const label = field === "option" ? source : "Yes";
	let sourceBlocks: Parameters<typeof adaptGrammarPreviewBlocks>[0];
	if (producer === "grammar") {
		let next = 0;
		const read = readLesson(
			`# Practice\n::: choice ${stem} {scored}\n${description}\n(x) ${label}\n( ) No\n:::\n`,
			{ ids: () => `node-${next++}` },
		);
		if (read.hasErrors) throw new Error(JSON.stringify(read.diagnostics));
		sourceBlocks = read.pages[0].blocks;
	} else {
		const data = question();
		const prose = (id: string, source: string) =>
			source.split(/\n\s*\n/).map((paragraph, index) => {
				const tree = inlineParagraph(producers[1].parse(paragraph));
				const content = renderInlineTree(tree);
				return {
					id: `${id}-${index}`,
					type: "text",
					data: { content, _inlineTrees: { content: { trees: [tree], display: content } } },
				};
			});
		data.stem = prose("s", stem) as never;
		data.description = prose("d", description) as never;
		if (data.response.type !== "choice") throw new Error("Expected choice");
		data.response.options[0] = { id: "a", label };
		sourceBlocks = [{ id: "q", type: "assessment", data: data as never }];
	}
	const blocks = prepareInlineBlocks(
		producer === "grammar"
			? constructSelfCheckPromptData(adaptGrammarPreviewBlocks(sourceBlocks, undefined, "en"))
			: sourceBlocks,
	);
	materializeInlineIcons(blocks, catalogs);
	const prepared = preparePageFootnotes(resolveAssessmentDontKnow(blocks), "p", {
		footnote: "Footnote",
		footnotes: "Sources",
	});
	const assessment = prepared.find((block) => block.type === "assessment");
	if (!assessment) throw new Error("Missing assessment");
	return assessment.data as unknown as AssessmentBlockData;
}
