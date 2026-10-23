import type { CourseExportInput } from "../../../src/build";

export const MODULE_TITLES = [
	"Observatory tour",
	"The telescope and constellation catalogue",
	"Module 2: Practice",
	"Module 3: Review",
];

export function buildModuleNavigationCourse(): CourseExportInput {
	return {
		id: "module-navigation-a11y",
		title: "Module navigation",
		sourceLocale: "en",
		navigationStyle: "sidebar",
		content: MODULE_TITLES.flatMap((lessonTitle, lesson) =>
			Array.from({ length: 2 }, (_, page) => ({
				id: `module-${lesson}-page-${page}`,
				lessonId: `module-${lesson}`,
				lessonTitle,
				lessonKicker: "Excluded kicker",
				isFirstPageOfLesson: page === 0,
				title: `Module ${lesson} page ${page}`,
				blocks: [
					{
						id: `heading-${lesson}-${page}`,
						type: "heading" as const,
						data: { content: `${lessonTitle} page ${page + 1}`, level: 1 },
					},
					{
						id: `term-${lesson}-${page}`,
						type: "text" as const,
						data: { content: `[Term ${lesson}]{Definition from ${lessonTitle}}` },
					},
				],
			})),
		),
	};
}
