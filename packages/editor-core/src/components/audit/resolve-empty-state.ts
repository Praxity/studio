import type { AuditIssue } from "./types";

export type AuditEmptyStateType =
	| "parseError"
	| "noContent"
	| "zeroIssues"
	| "allDismissed"
	| "noFilteredIssues";

export interface AuditEmptyStateInput {
	state: string;
	issues: readonly AuditIssue[];
	hasOpenIssues: boolean;
	hasDismissedIssues: boolean;
	filterMode: "severity" | "dismissed";
	hasFilteredIssues: boolean;
	hasQuickStartIssue: boolean;
}

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
