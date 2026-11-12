import {
	type A11yIssue,
	checkCourseAccessibility,
	checkLessonTitleAccessibility,
	collectAllBlocksDeep,
} from "@praxity/editor-core/lib/a11y/checker.ts";
import {
	findFlashingGifSources,
	type GifSkipReason,
} from "@praxity/editor-core/lib/a11y/gif-flash-detector.ts";
import { isExportBlockingIssue } from "@praxity/editor-core/lib/a11y/rule-metadata.ts";
import { checkWriteDistractorsAccessibility } from "@praxity/editor-core/lib/a11y/write-distractors-advice.ts";
import en from "@praxity/editor-core/messages/en" with { type: "json" };
import fr from "@praxity/editor-core/messages/fr" with { type: "json" };
import type { DesktopExportInput } from "@praxity/export-pipeline";
import type { ReadLessonResult } from "@praxity/grammar";
import { matchingDesktopAssetPath } from "@praxity/shared-blocks/desktop-asset-path";
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
	options: { locale?: string; authorWarnings?: AuthorWarning[]; checkFlashing?: boolean } = {},
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
	const locale = options.locale ?? input.locale;
	const t = createTranslator({
		locale,
		messages: locale === "fr" ? fr : en,
		namespace: "a11yAudit",
	});
	const assetPaths = new Set(input.resolvedAssets.keys());
	const uncheckedSources = new Map<string, GifSkipReason>();
	const flashingGifSources =
		options.checkFlashing === false
			? new Set<string>()
			: await findFlashingGifSources([page], readAsset, undefined, {
					resolveAssetPath: (reference) => matchingDesktopAssetPath(reference, assetPaths),
					uncheckedSources,
				});
	const report = checkCourseAccessibility([page], {
		flashingGifSources,
		uncheckedGifSources: uncheckedSources,
	});
	for (const issue of report.issues.filter((issue) => issue.rule === "gif-flash-unchecked"))
		options.authorWarnings?.push({
			code: issue.rule,
			severity: "warning",
			file: issue.sourceLocation,
			message: t("rules.gif-flash-unchecked.description", issue.messageValues),
			hint: t("rules.gif-flash-unchecked.guidance.bullet1"),
		});

	const criticalIssues = [
		...report.issues,
		...sources.flatMap((read) =>
			read.pages.flatMap((sourcePage) =>
				checkWriteDistractorsAccessibility(sourcePage.id, collectAllBlocksDeep(sourcePage.blocks), {
					read,
				}),
			),
		),
	]
		.filter(isExportBlockingIssue)
		.map((issue) =>
			issue.rule === "gif-flash-threshold"
				? {
						...issue,
						message: `${issue.sourceLocation}: ${t("rules.gif-flash-threshold.description")}`,
					}
				: issue,
		);

	if (enforcementEnabled && criticalIssues.length > 0) {
		throw new ExportAccessibilityError(criticalIssues);
	}

	return criticalIssues;
}
