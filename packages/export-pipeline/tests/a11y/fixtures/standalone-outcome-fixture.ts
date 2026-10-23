import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { buildScormPackage, type CourseExportInput } from "../../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";
import { activityBugsFixture } from "./activity-bugs-fixture";

export async function buildStandaloneOutcome(
	locale: "en" | "fr",
	dark: boolean,
	attempts = 1,
	passMark = true,
	onLastPage = false,
	moduleDeck = false,
) {
	const french = locale === "fr";
	const base = activityBugsFixture(locale);
	const question = base.content[0].blocks.find((block) => block.id === "choice");
	if (!question) throw new Error("Missing choice fixture");
	question.data.attempts = attempts;
	question.data.stem = [
		{
			id: "question-stem",
			type: "text",
			data: { content: french ? "Quelle réponse est correcte ?" : "Which answer is correct?" },
		},
	];
	question.data.response = {
		type: "choice",
		selectionMode: "single",
		options: [
			{ id: "right", label: french ? "Oui" : "Yes", isCorrect: true },
			{ id: "wrong", label: french ? "Non" : "No", isCorrect: false },
		],
	};
	const course: CourseExportInput = {
		...base,
		...extractDesktopDesignFromFrontmatter({
			design: {
				...DEFAULT_DESIGN_VARIANTS,
				palette: dark ? "clay" : "ink",
				colorMode: dark ? "dark" : "light",
			},
		}),
		id: `outcome-${locale}-${dark}-${attempts}-${passMark}`,
		title: french ? "Résultat du cours" : "Course result",
		navigationStyle: moduleDeck ? "slides" : "sidebar",
		moduleDeck: moduleDeck ? {} : undefined,
		passingScore: passMark ? 80 : undefined,
		content: [
			{ id: "question-page", title: "Question", blocks: onLastPage ? [] : [question] },
			{
				id: "summary-page",
				title: french ? "Résumé" : "Summary",
				blocks: [
					{
						id: "summary-text",
						type: "text",
						data: {
							content: french
								? "<p>Vos réponses ont été vérifiées.</p>"
								: "<p>Your answers have been checked.</p>",
						},
					},
				],
			},
		],
	};
	if (onLastPage) course.content[1].blocks.unshift(question);
	if (moduleDeck)
		course.content.forEach((page, index) => {
			page.lessonId = "module-one";
			page.lessonTitle = "Question";
			page.isFirstPageOfLesson = index === 0;
		});
	return buildScormPackage(course, { format: "html" });
}

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AdmZip from "adm-zip";

export async function writeStandaloneOutcomeFixtures(directory: string) {
	for (const locale of ["en", "fr"] as const) {
		for (const dark of [false, true]) {
			const output = resolve(directory, "outcomes", `${locale}-${dark ? "dark" : "light"}`);
			await mkdir(output, { recursive: true });
			new AdmZip((await buildStandaloneOutcome(locale, dark)).zip).extractAllTo(output, true);
		}
	}
	for (const [name, attempts, passMark, onLastPage, deck] of [
		["retry", 2, true, false, false],
		["no-mark", 1, false, false, false],
		["last-page", 1, true, true, false],
		["deck", 1, true, false, true],
	] as const) {
		const output = resolve(directory, "outcomes", name);
		await mkdir(output, { recursive: true });
		new AdmZip(
			(await buildStandaloneOutcome("en", false, attempts, passMark, onLastPage, deck)).zip,
		).extractAllTo(output, true);
	}
}
