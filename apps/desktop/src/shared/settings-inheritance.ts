import en from "@praxity/editor-core/messages/en" with { type: "json" };
import fr from "@praxity/editor-core/messages/fr" with { type: "json" };
import {
	type DesignSettingWarning,
	getDesignSettingWarnings,
	mergeTypography,
	normalizeDeckDesign,
	normalizeTypography,
} from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import type { CourseManifest } from "./course-manifest";
import type { WorkspaceConfig } from "./types";

export interface ResolvedSettings {
	locale: string;
	localeSource: "lesson" | "course" | "workspace" | "default";
	theme: string | undefined;
	design: Record<string, unknown>;
	designWarnings: Array<DesignSettingWarning & { source: "course" | "lesson"; message: string }>;
}

export type DesignWarning = Omit<ResolvedSettings["designWarnings"][number], "source"> & {
	file: string;
};

export function resolveNarrationLocale(
	lessonLanguage: unknown,
	courseLocale: unknown,
): "en" | "fr" {
	const language =
		lessonLanguage === "en" || lessonLanguage === "fr" ? lessonLanguage : courseLocale;
	return language === "fr" ? "fr" : "en";
}

export function resolveDesignSettings(
	workspace: WorkspaceConfig | null,
	course: CourseManifest,
	lessonFrontmatter: Record<string, unknown>,
): ResolvedSettings {
	const lessonLocale =
		typeof lessonFrontmatter.lang === "string" ? lessonFrontmatter.lang.trim() : "";
	const locale = lessonLocale || (course.locale ?? workspace?.defaultLocale ?? "en");
	const localeSource = lessonLocale
		? "lesson"
		: course.locale != null
			? "course"
			: workspace?.defaultLocale != null
				? "workspace"
				: "default";
	const theme = course.theme ?? workspace?.defaultTheme;

	const lessonDesign =
		lessonFrontmatter.design &&
		typeof lessonFrontmatter.design === "object" &&
		!Array.isArray(lessonFrontmatter.design)
			? (lessonFrontmatter.design as Record<string, unknown>)
			: {};

	const design = { ...course.design, ...lessonDesign };
	if (course.design?.deck !== undefined || lessonDesign.deck !== undefined) {
		design.deck = {
			...normalizeDeckDesign(course.design?.deck),
			...normalizeDeckDesign(lessonDesign.deck),
		};
	}
	const typography = mergeTypography(course.design?.typography, lessonDesign.typography);
	if (typography) design.typography = typography;

	const t = createTranslator({
		locale: locale === "fr" ? "fr" : "en",
		messages: locale === "fr" ? fr : en,
		namespace: "a11yAudit",
	});
	const normalized = normalizeTypography(design.typography);
	const designWarnings = (
		[
			["course", course.design],
			["lesson", lessonDesign],
		] as const
	).flatMap(([source, design]) =>
		getDesignSettingWarnings(design, normalized).map((warning) => ({
			...warning,
			source,
			message: t(`rules.${warning.code}.description`, {
				path: warning.path,
				...("pairing" in warning ? { pairing: warning.pairing } : {}),
			}),
		})),
	);
	return { locale, localeSource, theme, design, designWarnings };
}
