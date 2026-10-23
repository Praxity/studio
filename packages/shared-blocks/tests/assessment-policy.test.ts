import { assessmentStatePolicy } from "@praxity/content-model";
import { expect, it } from "vitest";

it.each([
	[{}, true, "none", false, false, Infinity],
	[{}, false, "none", false, false, 1],
	[{ graded: true }, true, "exact", true, false, 1],
	[{ graded: true, gradingMode: "none" }, true, "none", false, false, Infinity],
	[{ gradingMode: "exact", attempts: 3 }, true, "exact", true, false, 3],
	[{ gradingMode: "exact", attempts: 0 }, true, "exact", true, false, Infinity],
	[{ gradingMode: "exact", feedbackMode: "reveal", attempts: 3 }, true, "exact", true, true, 1],
	[{ gradingMode: "exact", feedbackMode: "reveal" }, false, "exact", true, false, 1],
	[{ assessmentType: "fillBlank", gradingMode: "exact" }, false, "exact", false, false, 1],
	[{ assessmentType: "fillBlank", gradingMode: "exact" }, true, "exact", true, false, 1],
	[
		{ assessmentType: "hotspot", feedbackMode: "reveal", attempts: 4 },
		true,
		"none",
		false,
		false,
		4,
	],
] as const)(
	"retains effective control policy %#",
	(data, autoScore, gradingMode, graded, revealAnswers, maxAttempts) => {
		expect(assessmentStatePolicy(data, autoScore)).toEqual({
			gradingMode,
			graded,
			revealAnswers,
			maxAttempts,
		});
	},
);
