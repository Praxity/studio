import { expect, it, vi } from "vitest";
import { restoreChoiceAssessmentState } from "../src/choice-learner-state";
import {
	admitChoiceStateFacts,
	choiceQuestionSignature,
	isChoiceAssessmentFacts,
	isChoiceStateQuestion,
} from "../src/choice-state-facts";
import vectors from "./fixtures/choice-signature-vectors.json";

const original = vectors.question.question;
const pair = { question: original, signature: vectors.question.hash };
it("admits the literal pair and preserves one short signature", () => {
	expect(isChoiceAssessmentFacts(pair)).toBe(true);
	expect(
		admitChoiceStateFacts({
			choiceStateQuestions: { q: original },
			choiceStateSignatures: { q: pair.signature },
		}).choiceStateSignatures.q,
	).toBe("s96:3bsC6Tn5WgY9dA00");
});
it.each([
	["text type", { content: { ...original.content, text: 3 } }],
	["image array", { content: { ...original.content, images: "a.png" } }],
	["image entries", { content: { ...original.content, images: [17] } }],
	["icon array", { content: { ...original.content, icons: "mail" } }],
	["icon entries", { content: { ...original.content, icons: [null] } }],
	["mode", { gradingMode: "unknown" }],
	["mode type", { gradingMode: { toString: () => "exact" } }],
	["graded consistency", { graded: false }],
	["points type", { points: "100" }],
	["points finite", { points: Infinity }],
	["points bound", { points: -1 }],
	["required", { required: "yes" }],
	["content shape", { content: null }],
	["option content", { options: [{ ...original.options[0], content: null }] }],
	["option image", { options: [{ ...original.options[0], image: 3 }] }],
	["correct set array", { correctIds: "a" }],
	["correct set members", { correctIds: ["missing"] }],
	["correct set string", { correctIds: [3] }],
	["correct set unique", { correctIds: ["a", "a"] }],
	["automatic consistency", { canAutoScore: false }],
	["sparse correct set", { correctIds: new Array(1) }],
	["sparse media", { content: { ...original.content, images: new Array(1) } }],
])("refuses malformed compiler facts: %s", (_name, changes) => {
	expect(() => isChoiceStateQuestion({ ...original, ...changes })).not.toThrow();
	expect(isChoiceStateQuestion({ ...original, ...changes })).toBe(false);
});
it("refuses changed facts with an unchanged claim, retaining per-ID invalidity", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		const changed = { ...original, points: 50 };
		expect(isChoiceAssessmentFacts({ ...pair, question: changed })).toBe(false);
		expect(isChoiceAssessmentFacts({ ...pair, signature: `sha256:${"a".repeat(64)}` })).toBe(false);
		const result = admitChoiceStateFacts({
			choiceStateQuestions: { good: original, bad: changed },
			choiceStateSignatures: { good: pair.signature, bad: pair.signature },
		});
		expect(result.choiceStateInvalidIds).toEqual(["bad"]);
		expect(result.choiceStateQuestions).toEqual({ good: original });
	} finally {
		warn.mockRestore();
	}
});
it("property order and unrelated fields cannot move a signature", () => {
	expect(
		choiceQuestionSignature({ ...original, options: [...original.options].reverse() } as Parameters<
			typeof choiceQuestionSignature
		>[0]),
	).toBe(pair.signature);
});

it("checks both selected cardinality and correct IDs through saved admission", () => {
	const question = { ...original, selectionMode: "multiple" as const, correctIds: ["a", "b"] };
	const facts = {
		question,
		signature: choiceQuestionSignature(question as Parameters<typeof choiceQuestionSignature>[0]),
	};
	const state = {
		version: 1,
		kind: "assessment",
		assessmentType: "choice",
		attemptCount: 1,
		checked: true,
		correct: true,
		completed: true,
		interacted: true,
		answer: ["a"],
		contentSignature: facts.signature,
	};
	expect(restoreChoiceAssessmentState(state, facts).status).toBe("review");
	const single = { question: original, signature: pair.signature };
	expect(
		restoreChoiceAssessmentState(
			{ ...state, answer: ["b"], contentSignature: pair.signature },
			single as Parameters<typeof restoreChoiceAssessmentState>[1],
		).status,
	).toBe("review");
});

it("retains empty image sources accepted by the content model", () => {
	expect(
		isChoiceStateQuestion({
			...original,
			content: { ...original.content, images: [""] },
			options: [
				{
					...original.options[0],
					image: "",
					content: { ...original.options[0].content, images: [""] },
				},
				original.options[1],
			],
		}),
	).toBe(true);
});
