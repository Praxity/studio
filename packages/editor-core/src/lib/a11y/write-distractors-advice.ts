import { writeDistractorsDiagnosticMessage } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import type { A11yIssue } from "./checker";
import type { SelfCheckAuditSource } from "./self-check-advice";

const adviceCodes = new Set([
	"write-distractors-author-right",
	"write-distractors-duplicate-label",
	"practice-question-too-long",
	"practice-right-answer-too-long",
	"practice-misconception-too-long",
	"practice-option-too-long",
]);

/** Grammar owns quality checks and bounds. Check carries only their fixed copy and locations. */
export function checkWriteDistractorsAccessibility(
	pageId: string,
	blocks: readonly PraxityBlock[],
	{ read, spans }: SelfCheckAuditSource,
): A11yIssue[] {
	const issues: A11yIssue[] = [];
	for (const record of read.nodes.values()) {
		if (record.role || record.node.type !== "write-distractors") continue;
		const sourceSpan = read.spans.get(record.id);
		if (!sourceSpan) throw new Error("write-distractors-identity-invalid");
		const block = blocks.find((candidate) => {
			if (candidate.type !== "writeDistractors") return false;
			if (!spans) return candidate.id === record.id;
			const span = spans.get(candidate.id);
			return span?.startLine === sourceSpan.startLine && span.endLine === sourceSpan.endLine;
		});
		if (!block) continue;
		for (const diagnostic of read.diagnostics) {
			if (
				!adviceCodes.has(diagnostic.code) ||
				diagnostic.span.start < record.node.span.start ||
				diagnostic.span.end > record.node.span.end
			)
				continue;
			// Whitelist numeric bounds, never forward arbitrary diagnostic arguments or source.
			const max = diagnostic.message.args.max;
			const messageValues: Record<string, number> = typeof max === "number" ? { max } : {};
			const message = writeDistractorsDiagnosticMessage(diagnostic.code, messageValues);
			if (!message) throw new Error(`Missing diagnostic copy: ${diagnostic.code}`);
			// Limits and duplicate labels remain publication-refusing grammar errors;
			// only author-option equality is review advice.
			issues.push({
				rule: diagnostic.code,
				grammarDiagnostic: diagnostic.code,
				message,
				messageValues,
				severity: diagnostic.severity === "warning" ? "minor" : "serious",
				outcome: diagnostic.severity === "warning" ? "cantTell" : "failed",
				pageId,
				blockId: block.id,
				sourceLocation: `source:${diagnostic.line}:${diagnostic.column}:${diagnostic.code}`,
			});
		}
	}
	return issues;
}
