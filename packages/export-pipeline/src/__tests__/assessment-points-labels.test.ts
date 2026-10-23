import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { expect, it } from "vitest";
import { renderBlockHtml } from "../render-block-html";

it.each([
	["en", 1000000, "1,000,000 points"],
	["en", 0.0001, "0.0001 points"],
	["en", 0.0000001, "0.0000001 points"],
	["en", 0.1 + 0.2, "0.3 points"],
	["en", 1.0001, "1.0001 points"],
	["fr", 1000000, "1\u202f000\u202f000 points"],
	["fr", 0.0001, "0,0001 points"],
	["fr", 0.0000001, "0,0000001 points"],
	["fr", 0.1 + 0.2, "0,3 points"],
	["fr", 1.0001, "1,0001 points"],
])(
	"formats %s assessment and group metadata for %s points but preserves authored statistics",
	(sourceLocale, points, label) => {
		const assessment: PraxityBlock = {
			id: "points",
			type: "assessment",
			data: {
				assessmentType: "choice",
				gradingMode: "exact",
				points,
				stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
				response: {
					type: "choice",
					selectionMode: "single",
					options: [{ id: "a", label: "Answer", isCorrect: true }],
				},
			},
		};
		const group: PraxityBlock = {
			id: "group",
			type: "assessmentGroup",
			data: {
				groupName: "Group",
				memberBlockIds: ["points"],
				pointsOverride: points,
			},
		};
		expect(renderBlockHtml(assessment, { sourceLocale })).toContain(label);
		expect(renderBlockHtml(group, { sourceLocale })).toContain(label);
		expect(assessment.data.points).toBe(points);
		expect(group.data.pointsOverride).toBe(points);
		expect(
			renderBlockHtml(
				{
					id: "stats",
					type: "stats",
					data: {
						items: [{ value: "1000000", label: "Authored" }],
					},
				},
				{ sourceLocale },
			),
		).toContain(">1000000<");
	},
);
