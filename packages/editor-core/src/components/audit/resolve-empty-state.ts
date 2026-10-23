import type { AuditIssue } from "./types";

export type AuditEmptyStateType =
	| "parseError"
	| "noContent"
	| "zeroIssues"
	| "allDismissed"
	| "noFilteredIssues";

export interface AuditEmptyStateInput {
	/** Document-level state from the audit data hook. */
	state: string;
	/** Every issue for the course, dismissed included. */
	issues: readonly AuditIssue[];
	hasOpenIssues: boolean;
	hasDismissedIssues: boolean;
	filterMode: "severity" | "dismissed";
	/**
	 * Issues that will render in the category list. This deliberately excludes
	 * whatever is showing in the Start here slot, so it is not the whole picture.
	 */
	hasFilteredIssues: boolean;
	/** Whether a Start here card will render. */
	hasQuickStartIssue: boolean;
}

/**
 * Which empty state the results region should show, or `null` to show results.
 *
 * The empty state replaces the entire results region, so it must only win when
 * there is genuinely nothing to display. `hasFilteredIssues` alone is not that
 * test: a course with exactly one open issue puts it in the Start here slot and
 * leaves the category list empty, which used to render "no issues match the
 * active filters" while the severity chip still counted the issue — and the
 * quick-start card never appeared, making the only issue unreachable.
 */
export function resolveAuditEmptyState(input: AuditEmptyStateInput): AuditEmptyStateType | null {
	if (input.state === "parseError") return "parseError";
	if (input.state === "noContent") return "noContent";
	if (input.issues.length === 0) return "zeroIssues";
	if (!input.hasOpenIssues && input.hasDismissedIssues && input.filterMode === "severity") {
		return "allDismissed";
	}
	if (!input.hasFilteredIssues && !input.hasQuickStartIssue) return "noFilteredIssues";
	return null;
}
