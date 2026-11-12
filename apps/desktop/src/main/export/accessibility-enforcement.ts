import {
	type A11yIssue,
	checkCourseAccessibility,
	checkLessonTitleAccessibility,
	collectAllBlocksDeep,
} from "@praxity/editor-core/lib/a11y/checker.ts";
import { findFlashingGifSources } from "@praxity/editor-core/lib/a11y/gif-flash-detector.ts";
import { isExportBlockingIssue } from "@praxity/editor-core/lib/a11y/rule-metadata.ts";
import { checkWriteDistractorsAccessibility } from "@praxity/editor-core/lib/a11y/write-distractors-advice.ts";
import en from "@praxity/editor-core/messages/en" with { type: "json" };
import fr from "@praxity/editor-core/messages/fr" with { type: "json" };
import type { DesktopExportInput } from "@praxity/export-pipeline";
import type { ReadLessonResult } from "@praxity/grammar";
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
 * Enforce source and animated-media accessibility against the exact block set handed to the
 * packaging pipeline. This is deliberately main-process enforcement: renderer
 * pre-flight state is useful feedback, but is not an authorization boundary.
 * The enforcement decision must come from main-process-owned settings; export
 * input is intentionally never consulted for an override.
 */
export async function assertExportAccessibility(
	input: DesktopExportInput,
	enforcementEnabled = true,
	readAsset: (relativePath: string) => Promise<Uint8Array> = async (relativePath) => {
		const bytes = input.resolvedAssets.get(relativePath);
		if (!bytes) throw new Error(`Missing export asset: ${relativePath}`);
		return bytes;
	},
	sources: readonly ReadLessonResult[] = [],
): Promise<A11yIssue[]> {
	const rawTitle = input.frontmatter?.title;
	const page: PraxityPage = {
		id: "export",
		title:
			typeof rawTitle === "string" && rawTitle.trim().length > 0
				? rawTitle.trim()
				: "Course export",
		blocks: Array.isArray(input.blocks) ? input.blocks : [],
	};
	const flashingGifSources = await findFlashingGifSources([page], readAsset);
	const criticalIssues = [
		...checkCourseAccessibility([page], { flashingGifSources }).issues,
		...sources.flatMap((read) =>
			read.pages.flatMap((sourcePage) =>
				checkWriteDistractorsAccessibility(sourcePage.id, collectAllBlocksDeep(sourcePage.blocks), {
					read,
				}),
			),
		),
	].filter(isExportBlockingIssue);

	if (enforcementEnabled && criticalIssues.length > 0) {
		throw new ExportAccessibilityError(criticalIssues);
	}

	return criticalIssues;
}
