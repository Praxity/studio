import type { ChoiceStateQuestion } from "../../../shared-blocks/src/choice-state-facts";

// Independent version-4 question/signature pair, with a as the correct option.
export const gateSignature = "s96:3w14l18FIDxpK_Py";
export const gateQuestion: ChoiceStateQuestion = {
	selectionMode: "single",
	dontKnow: false,
	canAutoScore: true,
	graded: true,
	maxAttempts: 2,
	correctIds: ["a"],
	gradingMode: "exact" as const,
	points: 100,
	required: true,
	content: { text: "a", images: [], icons: [] },
	options: [
		{ id: "a", content: { text: "b", images: [], icons: [] }, image: null },
		{ id: "b", content: { text: "c", images: [], icons: [] }, image: null },
	],
};
export const exhaustedGateState = {
	version: 1 as const,
	kind: "assessment" as const,
	assessmentType: "choice" as const,
	attemptCount: 2,
	checked: true,
	correct: false,
	completed: true,
	interacted: true,
	answer: ["b"],
};
