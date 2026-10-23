import { describe, expect, it } from "vitest";
import { type AuditEmptyStateInput, resolveAuditEmptyState } from "../resolve-empty-state";
import type { AuditIssue } from "../types";

const issue = { annotationId: "a1" } as AuditIssue;

function input(overrides: Partial<AuditEmptyStateInput> = {}): AuditEmptyStateInput {
	return {
		state: "ready",
		issues: [issue],
		hasOpenIssues: true,
		hasDismissedIssues: false,
		filterMode: "severity",
		hasFilteredIssues: true,
		hasQuickStartIssue: false,
		...overrides,
	};
}

describe("resolveAuditEmptyState", () => {
	it("surfaces document-level states first", () => {
		expect(resolveAuditEmptyState(input({ state: "parseError" }))).toBe("parseError");
		expect(resolveAuditEmptyState(input({ state: "noContent" }))).toBe("noContent");
	});

	it("reports a clean course when there are no issues at all", () => {
		expect(resolveAuditEmptyState(input({ issues: [] }))).toBe("zeroIssues");
	});

	it("reports all-dismissed only in severity mode", () => {
		const allDismissed = { hasOpenIssues: false, hasDismissedIssues: true } as const;
		expect(resolveAuditEmptyState(input(allDismissed))).toBe("allDismissed");
		expect(resolveAuditEmptyState(input({ ...allDismissed, filterMode: "dismissed" }))).not.toBe(
			"allDismissed",
		);
	});

	it("reports no-matches when the filters exclude everything", () => {
		expect(resolveAuditEmptyState(input({ hasFilteredIssues: false }))).toBe("noFilteredIssues");
	});

	// The regression this function exists for: `hasFilteredIssues` excludes whatever
	// is in the Start here slot, so a course with exactly one open issue produced an
	// empty category list. The panel then claimed "no issues match the active
	// filters" while the severity chip still counted that issue — and because the
	// empty state replaces the whole results region, the quick-start card never
	// rendered and the only issue was unreachable.
	it("shows results when the only issue is in the Start here slot", () => {
		expect(
			resolveAuditEmptyState(input({ hasFilteredIssues: false, hasQuickStartIssue: true })),
		).toBeNull();
	});

	it("shows results when there is anything to list", () => {
		expect(resolveAuditEmptyState(input())).toBeNull();
	});
});
