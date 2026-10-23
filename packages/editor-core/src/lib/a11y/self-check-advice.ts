import {
	type BlockSpan,
	type ReadLessonResult,
	readSelfCheckContent,
	SelfCheckContentError,
} from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { annotate } from "learning-patterns/patterns/self-check/logic.js";
import type { A11yIssue } from "./checker";

export interface SelfCheckAuditSource {
	read: ReadLessonResult;
	/** Editor identities may differ from a fresh source read's transient IDs. */
	spans?: ReadonlyMap<string, BlockSpan>;
}

// Review guidance for this comparison task, not authored limits or WCAG failures.
const maxModelWords = 200;
const maxCriterionCharacters = 120;
const minimumSpoilerCharacters = 20;
const placeholderHint =
	/^(?:try again|check your answer|réessayez|essayez encore|vérifiez votre réponse)[.!]?$/iu;
const normalized = (text: string) =>
	text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

/** Author-only advice. Full Content stays here; results contain codes and locations. */
export function checkSelfCheckAccessibility(
	pageId: string,
	blocks: readonly PraxityBlock[],
	{ read, spans }: SelfCheckAuditSource,
): A11yIssue[] {
	const issues: A11yIssue[] = [];
	for (const record of read.nodes.values()) {
		if (record.role || record.node.type !== "self-check") continue;
		const sourceSpan = read.spans.get(record.id);
		if (!sourceSpan) throw new SelfCheckContentError("self-check-identity-invalid");
		const blockId = spans
			? blocks.find((block) => {
					const span = spans.get(block.id);
					return (
						block.type === "selfCheck" &&
						span?.startLine === sourceSpan.startLine &&
						span.endLine === sourceSpan.endLine
					);
				})?.id
			: blocks.find((block) => block.id === record.id)?.id;
		// A single read may supply several pages. Audit only this page's activities.
		if (!blockId) continue;
		for (const diagnostic of read.diagnostics) {
			if (
				diagnostic.span.start < record.node.span.start ||
				diagnostic.span.end > record.node.span.end
			)
				continue;
			issues.push({
				rule: "self-check-grammar",
				severity: "serious",
				outcome: "failed",
				message: "Self-check source has a grammar error. Correct it at the reported location.",
				messageValues: { code: diagnostic.code, line: diagnostic.line, column: diagnostic.column },
				blockId,
				pageId,
				sourceLocation: `source:${diagnostic.line}:${diagnostic.column}:${diagnostic.code}`,
			});
		}
		let content: ReturnType<typeof readSelfCheckContent>;
		try {
			content = readSelfCheckContent(read, record.id);
		} catch (error) {
			if (error instanceof SelfCheckContentError && error.code === "self-check-content-invalid")
				continue;
			throw error;
		}
		const advice = (rule: string, message: string, field: string) =>
			issues.push({
				rule,
				severity: "minor",
				outcome: "cantTell",
				message,
				blockId,
				pageId,
				sourceLocation: `source:${sourceSpan.startLine + 1}:${field}`,
			});
		const model = normalized(content.model);
		if (model.length >= minimumSpoilerCharacters && normalized(content.task).includes(model))
			advice(
				"self-check-task-reveals-model",
				"The task contains the model answer. Review whether it gives the answer away before the learner writes.",
				"task",
			);
		if (content.model.trim().split(/\s+/u).length > maxModelWords)
			advice(
				"self-check-model-length",
				"The model answer exceeds 200 words. Review whether a shorter example would make comparison easier.",
				"model",
			);
		const marked = new Set(
			annotate(content.model, content.parts, []).map((segment) => segment.partIndex),
		);
		for (const [index, part] of content.parts.entries()) {
			if (part.label.length > maxCriterionCharacters)
				advice(
					"self-check-criterion-length",
					"A criterion exceeds 120 characters. Review whether a shorter label would be easier to scan.",
					`parts[${index}].label`,
				);
			if (
				placeholderHint.test(part.missed.trim()) ||
				normalized(part.missed) === normalized(part.label)
			)
				advice(
					"self-check-hint-actionable",
					"A hint repeats the criterion or only asks the learner to try again. Explain what to add or change.",
					`parts[${index}].missed`,
				);
			if (part.evidence !== null && !marked.has(index))
				advice(
					"self-check-evidence-overlap",
					"Overlapping evidence leaves a criterion without its own model mark. Review the evidence excerpts.",
					`parts[${index}].evidence`,
				);
		}
	}
	return issues;
}
