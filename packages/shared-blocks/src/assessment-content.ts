import { inlineField } from "@praxity/content-model/inline-fields";
import { inlineTextTree } from "@praxity/content-model/inline-preparation";
import {
	type InlineTree,
	inlineMaterial,
	renderInlineTree,
} from "@praxity/content-model/inline-tree";
import DOMPurify from "isomorphic-dompurify";
import type { ChoiceMaterialContent } from "./choice-state-facts";
import { getInlineField, inlineMarkdown } from "./inline-markdown";
import { processMathSpans } from "./math/process-math-spans";
import { htmlToPlainText, sanitizeHtml, splitHeadingContent } from "./sanitize";
import type { AssessmentBlockData, ChoiceResponse } from "./types";

/** Promoted feedback uses the grammar's HTML, just as the learner's result does. */
export function optionFeedbackHtml(
	data: Pick<AssessmentBlockData, "feedback"> & {
		_feedbackOptionIds?: { correct?: string; incorrect?: string };
	},
	option: ChoiceResponse["options"][number],
): string {
	const result = (["incorrect", "correct"] as const).find(
		(result) => data._feedbackOptionIds?.[result] === option.id,
	);
	return result ? blocksToText(data.feedback?.[result]) : inlineMarkdown(option.feedback ?? "");
}

/** Extract plain text from ProseMirror inline content array. */
export function proseMirrorToText(nodes: unknown[]): string {
	return nodes
		.map((n) => {
			if (typeof n === "string") return n;
			if (n && typeof n === "object" && "text" in n) return (n as { text: string }).text;
			if (n && typeof n === "object" && "content" in n)
				return proseMirrorToText((n as { content: unknown[] }).content);
			return "";
		})
		.join("");
}

/** Extract HTML from stem/feedback — handles PraxityBlock[], ProseMirror nodes, or string. */
export function blocksToText(blocks: unknown): string {
	if (typeof blocks === "string") return blocks;
	if (!Array.isArray(blocks) || blocks.length === 0) return "";
	const first = blocks[0];
	// PraxityBlock format: { data: { content: "<p>..." } }
	if (first && typeof first === "object" && "data" in first) {
		return blocks
			.map((block: { data?: { content?: string } } | null) => block?.data?.content ?? "")
			.join("");
	}
	// ProseMirror node format: { type: "paragraph", content: [{ text: "...", type: "text" }] }
	if (first && typeof first === "object" && "type" in first && "content" in first) {
		return blocks
			.filter(
				(b: unknown) =>
					b && typeof b === "object" && "type" in (b as object) && "content" in (b as object),
			)
			.map((b: unknown) => {
				const text = proseMirrorToText((b as { content: unknown[] }).content ?? []);
				return text ? `<p>${text}</p>` : "";
			})
			.join("");
	}
	return "";
}

/** Page footnotes must already be prepared at the page boundary. */
export function prepareAssessmentContent(
	data: Pick<AssessmentBlockData, "stem" | "description">,
	fallbackHeading: string,
) {
	const stemHtml = blocksToText(data.stem);
	const stemContent = splitHeadingContent(sanitizeHtml(stemHtml));
	const descriptionHtml = blocksToText(data.description);
	return {
		// Raw projections retain the renderer's presence checks and reporting text.
		stemHtml,
		stemPlainText: htmlToPlainText(stemHtml),
		stemContent: {
			heading: processMathSpans(stemContent.heading || fallbackHeading),
			body: processMathSpans(stemContent.body),
		},
		descriptionHtml,
	};
}

export function prepareAssessmentDescriptionHtml(descriptionHtml: string): string {
	return processMathSpans(sanitizeHtml(descriptionHtml));
}

/** Raw inline projection is also used for LMS interaction labels. */
function optionLabelSource(option: Record<string, unknown>) {
	const field =
		typeof option.label === "string" && option.label
			? "label"
			: typeof option.text === "string" && option.text
				? "text"
				: undefined;
	return {
		field,
		text: field
			? String(option[field])
			: Array.isArray(option.content)
				? proseMirrorToText(option.content)
				: "",
	};
}

export function optionLabelHtml(option: Record<string, unknown>): string {
	const { field, text } = optionLabelSource(option);
	return field
		? getInlineField(option, field, false)
		: inlineMarkdown(text, { interactive: false });
}

export function prepareAssessmentOptionHtml(option: Record<string, unknown>): string {
	return sanitizeHtml(optionLabelHtml(option), { interactive: false });
}

/** Legacy tree arrays have no binding: accept only an exact rendering match. */
function fieldTrees(
	owner: Record<string, unknown>,
	field: string,
	display: string,
	interactive: boolean,
): InlineTree[] | undefined {
	const bound = inlineField(owner, field);
	if (bound) return bound.display === display ? bound.trees : undefined;
	const legacy = (owner._inlineTrees as Record<string, unknown> | undefined)?.[field];
	return Array.isArray(legacy) &&
		legacy.map((tree) => renderInlineTree(tree, { interactive })).join("") === display
		? legacy
		: undefined;
}

/** Raw HTML has no compiler exclusions. Its visible text and image sources still count. */
function htmlMaterial(html: string): ChoiceMaterialContent {
	const root = DOMPurify.sanitize(sanitizeHtml(html), { RETURN_DOM: true }) as Element;
	return {
		text: root.textContent ?? "",
		images: Array.from(
			root.querySelectorAll("img[src]"),
			(image) => image.getAttribute("src") ?? "",
		),
		icons: [],
	};
}

function combineMaterial(parts: ChoiceMaterialContent[]): ChoiceMaterialContent {
	return {
		text: parts
			.map((part) => part.text)
			.join("")
			.replace(/\s+/gu, " ")
			.trim(),
		images: parts.flatMap((part) => part.images),
		icons: parts.flatMap((part) => part.icons),
	};
}

function treeMaterial(trees: InlineTree[]): ChoiceMaterialContent {
	const parts = trees.map(inlineMaterial);
	return {
		text: parts.map((part) => part.text).join(""),
		images: [],
		icons: parts.flatMap((part) => part.icons),
	};
}

export function assessmentMaterialContent(
	data: Pick<AssessmentBlockData, "stem" | "description">,
): ChoiceMaterialContent {
	const field = (value: unknown): ChoiceMaterialContent => {
		if (!Array.isArray(value)) return htmlMaterial(blocksToText(value));
		return combineMaterial(
			value.map((block) => {
				const owner = block?.data;
				const trees = owner && fieldTrees(owner, "content", owner.content ?? "", true);
				return trees ? treeMaterial(trees) : htmlMaterial(blocksToText([block]));
			}),
		);
	};
	return combineMaterial([
		field(data.stem),
		{ text: " ", images: [], icons: [] },
		field(data.description),
	]);
}

export function assessmentMaterialOption(option: Record<string, unknown>): ChoiceMaterialContent {
	const { field, text } = optionLabelSource(option);
	const trees = field && fieldTrees(option, field, optionLabelHtml(option), false);
	if (trees) return combineMaterial([treeMaterial(trees)]);
	if (field && typeof (option._inline as Record<string, unknown> | undefined)?.[field] === "string")
		return combineMaterial([htmlMaterial(prepareAssessmentOptionHtml(option))]);
	const tree = inlineTextTree(text);
	return tree
		? combineMaterial([treeMaterial([tree])])
		: combineMaterial([htmlMaterial(optionLabelHtml(option))]);
}
