import type { A11yIssue } from "./checker";

function part(value: string): string {
	return encodeURIComponent(value);
}

/** Identity for one authored-source result. Evidence text and scan order are deliberately absent. */
export function buildA11yOccurrenceId(
	issue: Pick<A11yIssue, "rule" | "pageId" | "blockId" | "sourceLocation">,
): string {
	return [
		"studio-source",
		part(issue.rule),
		part(issue.pageId ?? "course"),
		part(issue.blockId ?? "page"),
		part(issue.sourceLocation),
	].join(":");
}
