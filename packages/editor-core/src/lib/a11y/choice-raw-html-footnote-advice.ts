import { parseMaterialFootnote } from "@praxity/content-model/inline-footnotes";
import { isInlineHtml } from "@praxity/content-model/inline-preparation";
import type { AssessmentBlockData, PraxityBlock } from "@praxity/shared-blocks/types";
import type { A11yIssue } from "./checker";

/** Source advice stays independent of material signatures and their DOM runtime. */
export function checkChoiceRawHtmlFootnotes(
	pageId: string,
	blocks: readonly PraxityBlock[],
): A11yIssue[] {
	const issues: A11yIssue[] = [];
	for (const block of blocks) {
		if (block.type !== "assessment") continue;
		const response = block.data.response as AssessmentBlockData["response"] | undefined;
		if (response?.type !== "choice" || !Array.isArray(response.options)) continue;
		for (const [index, option] of response.options.entries()) {
			const label = option.label;
			if (typeof label !== "string" || !isInlineHtml(label)) continue;
			for (let start = label.indexOf("@"); start !== -1; start = label.indexOf("@", start + 1)) {
				if (!parseMaterialFootnote(label, start)) continue;
				issues.push({
					severity: "minor",
					rule: "choice-raw-html-footnote",
					message:
						"Learners may see the footnote as plain text. Editing the note later may make them answer again. Use Markdown formatting or move the note to the question.",
					blockId: block.id,
					pageId,
					sourceLocation: `data.response.options[${index}].label`,
					outcome: "cantTell",
				});
				break;
			}
		}
	}
	return issues;
}
