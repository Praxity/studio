import type { ChoiceStateQuestion } from "../../../shared-blocks/src/choice-state-facts";

// Independent version-3 question/signature pair, with a as the correct option.
export const gateSignature =
	"sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
export const gateQuestion: ChoiceStateQuestion = {
	selectionMode: "single",
	dontKnow: false,
	canAutoScore: true,
	graded: true,
	maxAttempts: 2,
	correctAnswerSignature: "sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
	materialSignature: `sha256:${"a".repeat(64)}`,
	options: [
		{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
		{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
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
