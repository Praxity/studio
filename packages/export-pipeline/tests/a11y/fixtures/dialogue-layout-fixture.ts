import type { CourseExportInput } from "../../../src/build";
import { buildLightweightCourse, FIXTURE_IMAGE_URL } from "./lightweight-fixture";

export const DIALOGUE_PALETTES = ["ink", "forest", "plum", "clay", "clear"] as const;

export function dialogueLayoutFixture(
	presentation: "pages" | "deck",
	palette: (typeof DIALOGUE_PALETTES)[number],
	mode: "light" | "dark",
): CourseExportInput {
	const turns = [
		{
			id: "alex-long",
			speaker: "Alex",
			name: "Alex",
			side: "start" as const,
			avatar: FIXTURE_IMAGE_URL,
			paragraphs: [
				"A difficult conversation needs enough room to read comfortably. We can explain what happened, listen carefully, and agree on a useful next step together.",
				"A second paragraph belongs to the same turn. It should sit closer to the first paragraph than to the next speaker's reply.",
			],
		},
		{
			id: "sam-short",
			speaker: "Sam",
			name: "Sam",
			side: "end" as const,
			avatar: FIXTURE_IMAGE_URL,
			paragraphs: ["Yes."],
		},
		{
			id: "sam-again",
			speaker: "sAM",
			name: "Sam",
			side: "end" as const,
			avatar: FIXTURE_IMAGE_URL,
			paragraphs: ["And we can check in again tomorrow."],
		},
		{
			id: "guide",
			speaker: "Guide",
			name: "Guide",
			side: "start" as const,
			paragraphs: ["Remember to ask for a concrete example."],
		},
		{
			id: "alex-url",
			speaker: "Alex",
			name: "Alex",
			side: "start" as const,
			avatar: FIXTURE_IMAGE_URL,
			paragraphs: [`Read https://example.com/${"unbreakable".repeat(30)}`],
		},
	];
	return {
		...buildLightweightCourse({ theme: { name: `${palette}-${mode}`, palette, colorMode: mode } }),
		id: `dialogue-layout-${presentation}-${palette}-${mode}`,
		title: "Dialogue layout",
		sourceLocale: "en",
		navigationStyle: presentation === "deck" ? "slides" : "sidebar",
		...(presentation === "deck" ? { moduleDeck: { gates: {} } } : {}),
		colorMode: mode,
		content: [
			{
				id: "dialogue-layout",
				title: "Dialogue layout",
				lessonId: "conversation",
				lessonTitle: "Conversation",
				isFirstPageOfLesson: true,
				blocks: [
					{ id: "layout-heading", type: "heading", data: { level: 1, content: "Dialogue layout" } },
					{
						id: "layout-dialogue",
						type: "dialogue",
						data: { caption: "Making room for a conversation", turns },
					},
					{
						id: "no-avatar-dialogue",
						type: "dialogue",
						data: {
							turns: [
								{
									id: "plain",
									speaker: "Guide",
									name: "Guide",
									paragraphs: ["No portraits in this conversation."],
								},
							],
						},
					},
				],
			},
		],
	};
}
