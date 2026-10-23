import { HighlightContentError, readHighlightContent } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import type { A11yIssue } from "./checker";
import type { SelfCheckAuditSource } from "./self-check-advice";

/** Explicit author Check only. Refused source belongs to grammar, never this advice. */
export function checkHighlightAccessibility(
	pageId: string,
	blocks: readonly PraxityBlock[],
	{ read, spans }: SelfCheckAuditSource,
): A11yIssue[] {
	const issues: A11yIssue[] = [];
	for (const record of read.nodes.values()) {
		if (record.role || record.node.type !== "highlight" || record.node.status !== "resolved")
			continue;
		const sourceSpan = read.spans.get(record.id);
		if (!sourceSpan) throw new HighlightContentError("highlight-identity-invalid");
		const block = blocks.find((candidate) => {
			if (candidate.type !== "highlight") return false;
			if (!spans) return candidate.id === record.id;
			const span = spans.get(candidate.id);
			return span?.startLine === sourceSpan.startLine && span.endLine === sourceSpan.endLine;
		});
		// A source read can include several pages and use different editor identities.
		if (!block) continue;
		try {
			readHighlightContent(read, record.id);
		} catch (error) {
			if (error instanceof HighlightContentError && error.code === "highlight-content-invalid")
				continue;
			throw error;
		}
		issues.push({
			rule: "highlight-limited-support",
			severity: "minor",
			outcome: "cantTell",
			message:
				"Highlight is optional, unsaved practice with visible text. Edit its source and print through the browser. Native PDF and block narration are unavailable.",
			pageId,
			blockId: block.id,
			sourceLocation: `source:${sourceSpan.startLine + 1}:highlight`,
		});
	}
	return issues;
}
