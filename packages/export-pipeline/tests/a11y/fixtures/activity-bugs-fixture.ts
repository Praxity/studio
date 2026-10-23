import type { CourseExportInput } from "../../../src/build";
import { buildLightweightCourse } from "./lightweight-fixture";

export const LONG_MATCH =
	"Listen to the concern, describe its effect on the team, and agree on a concrete next step together.";

export function activityBugsFixture(locale: "en" | "fr"): CourseExportInput {
	const stem = (content: string) => [
		{ id: `stem-${content}`, type: "text" as const, data: { content } },
	];
	return {
		...buildLightweightCourse({
			nav: { navigationStyle: "minimal" },
			theme: { name: "campfire", palette: "campfire", colorMode: "light" },
		}),
		id: `activity-bugs-${locale}`,
		title: "Activity fixes",
		sourceLocale: locale,
		content: [
			{
				id: "activity-page",
				title: "Activity fixes",
				blocks: [
					{ id: "title", type: "heading", data: { content: "Activity fixes", level: 1 } },
					{
						id: "choice",
						type: "assessment",
						data: {
							assessmentType: "choice",
							gradingMode: "exact",
							points: 2,
							attempts: 2,
							stem: stem("Choose a constructive response"),
							feedbackEnabled: true,
							feedback: {
								correct: stem("Listen before responding."),
								incorrect: stem("Consider how the other person feels."),
							},
							response: {
								type: "choice",
								selectionMode: "single",
								options: [
									{
										id: "wrong",
										label: "Interrupt",
										isCorrect: false,
										feedback: "Let the other person finish.",
									},
									{
										id: "right",
										label: "Listen",
										isCorrect: true,
										feedback: "Listening gives you time to understand.",
									},
								],
							},
						},
					},
					{
						id: "rating",
						type: "rating",
						data: {
							label: "How often do you listen?",
							style: "numeric",
							maxValue: 10,
							scale: [
								{ id: "rarely", value: 1, label: "Rarely" },
								{ id: "often", value: 10, label: "Very often" },
							],
						},
					},
					{
						id: "signature",
						type: "signature",
						data: { label: "Sign your response", sublabel: "Use your full name", mode: "type" },
					},
					{
						id: "categorize",
						type: "assessment",
						data: {
							assessmentType: "categorize",
							gradingMode: "exact",
							points: 4,
							attempts: 2,
							feedbackEnabled: false,
							stem: stem("Classify each statement"),
							response: {
								type: "categorize",
								categories: [
									{
										id: "helpful",
										name: "Helpful",
										items: ["Listen carefully", "Ask a question"],
										itemIds: ["listen-carefully", "ask-question"],
									},
									{
										id: "unhelpful",
										name: "Unhelpful",
										items: ["Interrupt", "Dismiss the concern"],
										itemIds: ["interrupt-item", "dismiss-concern"],
									},
								],
							},
						},
					},
					{
						id: "matrix",
						type: "assessment",
						data: {
							assessmentType: "matrix",
							gradingMode: "none",
							feedbackEnabled: false,
							stem: stem("Choose a response"),
							response: {
								type: "matrix",
								scalePoints: [
									{ id: "helpful-level", value: 1, label: "Helpful" },
									{ id: "unhelpful-level", value: 2, label: "Unhelpful" },
								],
								statements: [
									{ id: "listen", text: "Listen carefully", correctValues: [1] },
									{ id: "interrupt", text: "Interrupt", correctValues: [2] },
								],
							},
						},
					},
					{
						id: "matching",
						type: "assessment",
						data: {
							assessmentType: "matching",
							gradingMode: "none",
							stem: stem("Match the response"),
							response: {
								type: "matching",
								pairs: [
									{
										id: "response",
										matchId: "constructive-match",
										prompt: "Respond constructively",
										correctMatch: LONG_MATCH,
									},
								],
							},
						},
					},
					{
						id: "checklist",
						type: "checklist",
						data: { title: "Prepare", items: [{ id: "prepare", text: "Read the instructions" }] },
					},
					{
						id: "journal",
						type: "assessment",
						data: {
							assessmentType: "textResponse",
							gradingMode: "none",
							private: true,
							stem: stem("Reflect on your response"),
							response: { type: "textResponse", inputType: "long", downloadAs: "both" },
						},
					},
				],
			},
		],
	};
}
