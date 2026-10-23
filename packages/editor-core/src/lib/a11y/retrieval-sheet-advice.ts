import {
	lineColumn,
	RetrievalSheetContentError,
	readRetrievalSheetContent,
} from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import type { A11yIssue } from "./checker";
import type { SelfCheckAuditSource } from "./self-check-advice";

const normalized = (text: string) =>
	text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

/** Author review only; issues contain locations and fixed copy, never authored excerpts. */
export function checkRetrievalSheetAccessibility(
	pageId: string,
	blocks: readonly PraxityBlock[],
	{ read, spans }: SelfCheckAuditSource,
): A11yIssue[] {
	const issues: A11yIssue[] = [];
	for (const record of read.nodes.values()) {
		if (record.role || record.node.type !== "retrieval-sheet") continue;
		// Grammar owns blanks, limits and malformed source. Never add advice to a refusal.
		if (record.node.status !== "resolved") continue;
		const sourceSpan = read.spans.get(record.id);
		if (!sourceSpan) throw new Error("retrieval-sheet-identity-invalid");
		const block = blocks.find((candidate) => {
			if (candidate.type !== "retrievalSheet") return false;
			if (!spans) return candidate.id === record.id;
			const span = spans.get(candidate.id);
			return span?.startLine === sourceSpan.startLine && span.endLine === sourceSpan.endLine;
		});
		// The source read can include several pages. Only audit activities on this page.
		if (!block) continue;
		let content: ReturnType<typeof readRetrievalSheetContent>;
		try {
			content = readRetrievalSheetContent(read, record.id);
		} catch (error) {
			if (
				error instanceof RetrievalSheetContentError &&
				error.code === "retrieval-sheet-content-invalid"
			)
				continue;
			throw error;
		}
		const items = record.node.children.filter((node) => node.kind === "item");
		const seen = new Set<string>();
		for (const [index, item] of content.questions.entries()) {
			const question = normalized(item.question);
			const advice = (rule: string, message: string, field: "question" | "answer") => {
				const sourceItem = items[index];
				const target =
					field === "answer"
						? sourceItem.children.find((child) => child.kind === "part" && child.name === "answer")
						: sourceItem;
				if (!target) throw new RetrievalSheetContentError("retrieval-sheet-content-invalid");
				const { line } = lineColumn(read.tree.stream.source, target.span.start);
				issues.push({
					rule,
					message,
					severity: "minor",
					outcome: "cantTell",
					pageId,
					blockId: block.id,
					sourceLocation: `source:${line}:questions[${index}].${field}`,
				});
			};
			if (normalized(item.answer) === question)
				advice(
					"retrieval-sheet-answer-repeats-question",
					"An answer repeats its question. Write the information the learner should recall.",
					"answer",
				);
			if (seen.has(question))
				advice(
					"retrieval-sheet-duplicate-question",
					"A question repeats an earlier question on this sheet. Review whether each item asks for something distinct.",
					"question",
				);
			seen.add(question);
		}
	}
	return issues;
}
