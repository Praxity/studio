import { type CoursePresetId, readLesson, readSelfCheckContent } from "@praxity/grammar";
import { type CourseExportInput, selfCheckContentInput } from "../../../src/build";
import { buildLightweightCourse } from "./lightweight-fixture";

export function sidebarFeedbackFixture(
	locale: "en" | "fr",
	palette: CoursePresetId,
	colorMode: "light" | "dark",
): CourseExportInput {
	const explanation =
		locale === "en"
			? "Stop and check the instructions before continuing."
			: "Arrêtez et vérifiez les consignes avant de continuer.";
	return {
		...buildLightweightCourse({ theme: { name: palette, palette, colorMode } }),
		id: `sidebar-feedback-${locale}-${palette}-${colorMode}`,
		sourceLocale: locale,
		navigationStyle: "sidebar",
		content: [
			{
				id: "practice",
				title: locale === "en" ? "Practice" : "Exercice",
				blocks: [
					...Array.from({ length: 20 }, (_, index) => ({
						id: `intro-${index}`,
						type: "text" as const,
						data: { content: explanation },
					})),
					{
						id: "choice",
						type: "assessment",
						data: {
							assessmentType: "choice",
							gradingMode: "exact",
							attempts: 2,
							feedbackEnabled: true,
							stem: [{ id: "stem", type: "text", data: { content: explanation } }],
							response: {
								type: "choice",
								selectionMode: "single",
								options: [
									{ id: "stop", label: locale === "en" ? "Stop" : "Arrêter", isCorrect: true },
									{ id: "go", label: locale === "en" ? "Continue" : "Continuer", isCorrect: false },
								],
							},
							feedback: {
								correct: [{ id: "correct", type: "text", data: { content: explanation } }],
								incorrect: [{ id: "incorrect", type: "text", data: { content: explanation } }],
							},
						},
					},
					...Array.from({ length: 8 }, (_, index) => ({
						id: `after-${index}`,
						type: "text" as const,
						data: { content: explanation },
					})),
				],
			},
		],
	};
}

export const feedbackLayouts = [
	"bottomBar",
	"deck",
	"long",
	"options",
	"multi",
	"text",
	"group",
	"self-check",
] as const;
export type FeedbackLayout = (typeof feedbackLayouts)[number];

export function feedbackLayoutFixture(
	layout: FeedbackLayout,
	locale: "en" | "fr" = "en",
): CourseExportInput {
	const course = sidebarFeedbackFixture(locale, "clear", "light");
	course.id = `feedback-layout-${layout}-${locale}`;
	const page = course.content[0];
	const question = page.blocks.find((block) => block.id === "choice");
	if (!question) throw new Error("Missing choice fixture");
	if (layout === "bottomBar") course.navigationStyle = "bottomBar";
	if (layout === "deck") {
		course.navigationStyle = "slides";
		course.moduleDeck = {};
		page.lessonId = "practice";
	}
	if (layout === "long") {
		question.data.feedback = {
			incorrect: Array.from({ length: 3 }, (_, index) => ({
				id: `explanation-${index}`,
				type: "text",
				data: {
					content:
						"Read the instructions before continuing. Check which step comes first and ask for help if the next step is unclear.",
				},
			})),
		};
	}
	if (layout === "options" || layout === "multi") {
		question.data.response = {
			type: "choice",
			selectionMode: layout === "multi" ? "multiple" : "single",
			options: Array.from({ length: 7 }, (_, index) => ({
				id: `option-${index}`,
				label: `Action ${index + 1}: read the request before deciding`,
				isCorrect: index === 6,
				feedback: `Explanation ${index + 1}: stop and check the instructions.`,
			})),
		};
		question.data.feedback = undefined;
	}
	if (layout === "text") {
		question.data.assessmentType = "textResponse";
		question.data.gradingMode = "none";
		question.data.response = { type: "textResponse", inputType: "long" };
	}
	if (layout === "group") {
		page.blocks.splice(page.blocks.indexOf(question), 0, {
			id: "practice-group",
			type: "assessmentGroup",
			data: {
				groupName: "Practice together",
				mode: "all",
				requireAll: true,
				showResultsSummary: false,
				memberBlockIds: ["choice"],
			},
		});
	}
	if (layout === "self-check") {
		const read = readLesson(
			"# Practice\n\n::: self-check Check the next step\nmodel: Read the request.\n:: Read\nmissed: Read the instructions.\n:::\n",
		);
		page.blocks.splice(page.blocks.indexOf(question), 1, ...read.pages[0].blocks);
		course.selfCheckContents = read.blocks
			.filter((block) => block.type === "selfCheck")
			.map((block) => selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)));
	}
	course.content.push({
		id: "next-step",
		title: locale === "en" ? "Next step" : "Étape suivante",
		...(layout === "deck" ? { lessonId: "practice" } : {}),
		blocks: [
			{
				id: "next-text",
				type: "text",
				data: {
					content: locale === "en" ? "Read the next instruction." : "Lisez la consigne suivante.",
				},
			},
		],
	});
	return course;
}
