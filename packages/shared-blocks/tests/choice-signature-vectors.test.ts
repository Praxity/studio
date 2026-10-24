import { expect, it } from "vitest";
import { choiceContentSignature, choiceStateQuestion } from "../src/assessment-choice";
import { choiceQuestionSignature } from "../src/choice-state-facts";
import type { AssessmentBlockData } from "../src/types";
import vectors from "./fixtures/choice-signature-vectors.json";

it.each(vectors.vectors)("literal facts and short signature: $name", (vector) => {
	const data = { ...vectors.question.data, ...vector.data } as unknown as AssessmentBlockData;
	const expected = { ...vectors.question.question, ...vector.question };
	expect(choiceStateQuestion(data, false)).toEqual(expected);
	expect(choiceContentSignature(data, false)).toBe(vector.hash);
	expect(choiceQuestionSignature(expected as ReturnType<typeof choiceStateQuestion>)).toBe(
		vector.hash,
	);
});
