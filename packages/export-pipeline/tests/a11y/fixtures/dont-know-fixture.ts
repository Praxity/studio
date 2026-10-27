import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { THEME_PRESET_DEFAULTS } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";
import { activityCardsFixture } from "./activity-cards-fixture";
import { buildChoiceControlAlignmentCourse } from "./choice-control-alignment-fixture";

export const DONT_KNOW_PALETTES = ["ink", "forest", "plum", "clay", "clear"] as const;

export function dontKnowFixture(
	palette: (typeof DONT_KNOW_PALETTES)[number],
	dark: boolean,
	locale: "en" | "fr",
	deck = false,
) {
	const course = activityCardsFixture(locale, dark);
	Object.assign(
		course,
		extractDesktopDesignFromFrontmatter({
			design: {
				...DEFAULT_DESIGN_VARIANTS,
				...THEME_PRESET_DEFAULTS[palette],
				palette,
				colorMode: dark ? "dark" : "light",
			},
		}),
	);
	course.id = `dont-know-${palette}-${dark}-${locale}-${deck}`;
	const question = (id: string, extra: Record<string, unknown> = {}): PraxityBlock => ({
		id,
		type: "assessment",
		data: {
			assessmentType: "choice",
			gradingMode: "none",
			required: false,
			attempts: 2,
			feedbackEnabled: false,
			stem: [
				{
					id: `${id}-stem`,
					type: "text",
					data: { content: locale === "fr" ? "Que faire ?" : "What should you do?" },
				},
			],
			feedback: {
				incorrect: [
					{
						id: `${id}-feedback`,
						type: "text",
						data: {
							content: locale === "fr" ? "Écoutez avant de répondre." : "Listen before responding.",
						},
					},
				],
			},
			response: {
				type: "choice",
				selectionMode: "single",
				options: [
					{ id: `${id}-right`, label: "Listen", isCorrect: true },
					{ id: `${id}-wrong`, label: "Interrupt", isCorrect: false },
				],
			},
			...extra,
		},
	});
	const page = course.content[0];
	page.blocks = [
		question("practice"),
		question("graded", { gradingMode: "exact" }),
		question("graded-optin", { gradingMode: "exact", dontKnow: true, attempts: 1 }),
		{
			id: "group",
			type: "assessmentGroup",
			data: {
				groupName: "Practice together",
				mode: "all",
				requireAll: true,
				memberBlockIds: ["group-first", "group-second"],
			},
		},
		question("group-first", { attempts: 1 }),
		question("group-second", { attempts: 1 }),
		...buildChoiceControlAlignmentCourse().content[0].blocks.filter((block) =>
			(
				block.data as { stem?: Array<{ data: { content?: string } }> }
			).stem?.[0]?.data.content?.includes("Compare the markers"),
		),
	];
	if (deck) {
		page.lessonId = "uncertainty";
		course.moduleDeck = {
			gates: {
				attempt: "attempt",
				pass: "pass",
				"default-pass": "pass",
				final: "pass",
				"final-group": "pass",
			},
		};
		course.content = [
			{
				...page,
				id: "attempt-page",
				title: "Attempt gate",
				blocks: [question("attempt", { dontKnow: true })],
			},
			{
				...page,
				id: "pass-page",
				title: "Pass gate",
				blocks: [question("pass", { dontKnow: true }), question("default-pass")],
			},
			{
				...page,
				id: "final-page",
				title: "Final attempt",
				blocks: [question("final", { dontKnow: true, attempts: 1 })],
			},
			{
				...page,
				id: "group-page",
				title: "Group final attempt",
				blocks: [
					{
						id: "final-group",
						type: "assessmentGroup",
						data: {
							groupName: "Final group",
							mode: "all",
							requireAll: true,
							memberBlockIds: ["final-first", "final-second"],
						},
					},
					question("final-first", { dontKnow: true, attempts: 1 }),
					question("final-second", { dontKnow: true, attempts: 1 }),
				],
			},
			{
				...page,
				id: "done-page",
				title: "Done",
				blocks: [{ id: "done", type: "text", data: { content: "Finished" } }],
			},
		];
	}
	return course;
}
