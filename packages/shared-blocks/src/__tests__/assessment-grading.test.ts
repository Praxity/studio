import type { PraxityBlock } from "@praxity/content-model";
import { type AssessmentDeckOptions, resolveAssessmentDontKnow } from "@praxity/content-model";
import { expect, it } from "vitest";

const question = (dontKnow?: boolean): PraxityBlock => ({
	id: "q",
	type: "assessment",
	data: {
		assessmentType: "choice",
		gradingMode: "none",
		required: false,
		...(dontKnow === undefined ? {} : { dontKnow }),
		response: {
			type: "choice",
			selectionMode: "single",
			options: [
				{ id: "yes", label: "Yes", isCorrect: true },
				{ id: "no", label: "No" },
			],
		},
	},
});

it.each([
	"standalone",
	"group-pass",
	"group-score",
	"deck-pass",
	"deck-group-pass",
	"deck-required",
])("resolves the effective uncertainty setting once for %s", (context) => {
	for (const explicit of [undefined, true, false]) {
		const q = question(explicit);
		if (context === "deck-required") q.data.required = true;
		const blocks =
			context.startsWith("group") || context === "deck-group-pass"
				? [
						{
							id: "group",
							type: "assessmentGroup" as const,
							data: {
								memberBlockIds: ["q"],
								...(context === "group-pass" ? { deckGate: "pass" } : {}),
								...(context === "group-score" ? { passingScore: 80 } : {}),
							},
						},
						q,
					]
				: [q];
		const deck: AssessmentDeckOptions | undefined = context.startsWith("deck")
			? {
					gates:
						context === "deck-group-pass"
							? { group: "pass" as const }
							: context === "deck-pass"
								? { q: "pass" as const }
								: {},
				}
			: undefined;
		const resolved = resolveAssessmentDontKnow(blocks, deck);
		expect(resolved.find((b) => b.id === "q")?.data._dontKnow).toBe(
			explicit ?? context === "standalone",
		);
		expect(q.data.dontKnow).toBe(explicit);
		expect(resolveAssessmentDontKnow(resolved, deck)).toEqual(resolved);
	}
});
