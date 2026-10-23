import {
	type A11yIssue,
	checkCourseAccessibility,
	checkLessonTitleAccessibility,
} from "@praxity/editor-core/lib/a11y/checker.ts";
import { isExportBlockingIssue } from "@praxity/editor-core/lib/a11y/rule-metadata.ts";
import en from "@praxity/editor-core/messages/en" with { type: "json" };
import fr from "@praxity/editor-core/messages/fr" with { type: "json" };
import type { DesktopExportInput } from "@praxity/export-pipeline";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { createTranslator } from "use-intl/core";

export interface AuthorWarning {
	code: string;
	severity: "warning";
	file: string;
	message: string;
	hint: string;
}

export function lessonTitleWarnings(
	frontmatter: Record<string, unknown>,
	file: string,
	locale: string,
): AuthorWarning[] {
	const t = createTranslator({
		locale,
		messages: locale === "fr" ? fr : en,
		namespace: "a11yAudit",
	});
	return checkLessonTitleAccessibility(frontmatter, file).map((issue) => ({
		code: issue.rule,
		severity: "warning",
		file,
		message: t("rules.lesson-title.title"),
		hint: t("rules.lesson-title.description"),
	}));
}

export const ACCESSIBILITY_EXPORT_ERROR_PREFIX = "export_accessibility_blocked";

export class ExportAccessibilityError extends Error {
	readonly issues: A11yIssue[];

	constructor(issues: A11yIssue[]) {
		super(`${ACCESSIBILITY_EXPORT_ERROR_PREFIX}:${issues.length}`);
		this.name = "ExportAccessibilityError";
		this.issues = issues;
	}
}

/**
 * Enforce structural accessibility against the exact block set handed to the
 * packaging pipeline. This is deliberately main-process enforcement: renderer
 * pre-flight state is useful feedback, but is not an authorization boundary.
 * The enforcement decision must come from main-process-owned settings; export
 * input is intentionally never consulted for an override.
 */
export function assertExportAccessibility(
	input: DesktopExportInput,
	enforcementEnabled = true,
): A11yIssue[] {
	const rawTitle = input.frontmatter?.title;
	const page: PraxityPage = {
		id: "export",
		title:
			typeof rawTitle === "string" && rawTitle.trim().length > 0
				? rawTitle.trim()
				: "Course export",
		blocks: Array.isArray(input.blocks) ? input.blocks : [],
	};
	const criticalIssues = checkCourseAccessibility([page]).issues.filter(isExportBlockingIssue);

	if (enforcementEnabled && criticalIssues.length > 0) {
		throw new ExportAccessibilityError(criticalIssues);
	}

	return criticalIssues;
}
