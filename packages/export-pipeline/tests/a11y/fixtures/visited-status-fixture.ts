import { readLesson } from "@praxity/grammar";
import type { CourseExportInput } from "../../../src/build";

export function buildVisitedStatusCourse(locale: "en" | "fr", nested: boolean): CourseExportInput {
	const french = locale === "fr";
	const titles = french
		? ["Introduction", "Vérifiez votre compréhension", "Lectures complémentaires"]
		: ["Introduction", "Check your understanding", "Further reading"];
	const question = readLesson(
		"# Untitled {hideTitle}\n\n::: choice " +
			(french ? "Quelle réponse est correcte ?" : "Which answer is correct?") +
			" {scored required attempts=2 level=3}\n(x) " +
			(french ? "Bonne réponse" : "Correct answer") +
			"\n( ) " +
			(french ? "Mauvaise réponse" : "Wrong answer") +
			"\n:::\n",
	).pages[0].blocks;
	return {
		id: `visited-status-${locale}-${nested ? "modules" : "flat"}`,
		title: french ? "État des visites" : "Visit status",
		sourceLocale: locale,
		navigationStyle: "sidebar",
		content: titles.map((title, index) => ({
			id: `stable-page-${index}`,
			title,
			...(nested
				? {
						lessonId: index < 2 ? "practice" : "resources",
						lessonTitle:
							index < 2
								? french
									? "Module de pratique"
									: "Practice module"
								: french
									? "Ressources"
									: "Resources module",
						isFirstPageOfLesson: index !== 1,
					}
				: {}),
			blocks: [
				{ id: `heading-${index}`, type: "heading" as const, data: { content: title, level: 1 } },
				...(index === 1 ? structuredClone(question) : []),
			],
		})),
	};
}
