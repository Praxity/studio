import { expect, it } from "vitest";
import {
	choiceDependencyStatus,
	prepareChoiceAssessmentState,
	restoreChoiceAssessmentState,
} from "./choice-learner-state";
import {
	addedDistractor,
	factsA,
	factsB,
	legacySubmitted,
	row,
	signatureA,
	signedSubmitted,
	view,
} from "./fixtures/choice-evidence";
import {
	choiceEvidenceSignature,
	choiceStateForDestination,
	isScorm12ChoiceSignature,
	type LearnerStateValue,
} from "./learner-state";

const short = "s96:5N83Sur-iuRJwDIe";
const saved = {
	...legacySubmitted,
	contentSignature: short,
	writtenAt: 10,
	legacyBuildRevision: "original-build",
};

it("uses a tagged 96-bit signature only for the SCORM 1.2 destination", () => {
	expect(choiceEvidenceSignature(signatureA, "scorm12")).toBe(short);
	expect(choiceEvidenceSignature(short, "scorm12")).toBe(short);
	expect(choiceEvidenceSignature(signatureA)).toBe(signatureA);
	expect(
		choiceStateForDestination(signedSubmitted as unknown as LearnerStateValue, "scorm12"),
	).toEqual(saved);
	expect(choiceStateForDestination(signedSubmitted as unknown as LearnerStateValue)).toBe(
		signedSubmitted,
	);
	for (const value of [
		null,
		[],
		"answer",
		legacySubmitted,
		{ kind: "assessment", assessmentType: "freeResponse", contentSignature: signatureA },
		{ kind: "assessmentGroup", contentSignature: signatureA },
	])
		expect(choiceStateForDestination(value as LearnerStateValue, "scorm12")).toBe(value);
});

it.each([
	null,
	"",
	"s96:5N83Sur-iuRJwDI",
	"s96:5N83Sur-iuRJwDIe=",
	"s96:5N83Sur+iuRJwDIe",
	"sha256:bad",
])("refuses malformed short evidence %j without unsigned fallback", (contentSignature) => {
	expect(isScorm12ChoiceSignature(contentSignature)).toBe(false);
	const state = { ...legacySubmitted, contentSignature };
	expect(restoreChoiceAssessmentState(state, factsA).status).toBe("review");
});

it("short evidence requires the current digest and no proof, including drafts", () => {
	expect(restoreChoiceAssessmentState(saved, factsA).status).toBe("current");
	for (const facts of [factsB, addedDistractor])
		expect(restoreChoiceAssessmentState(saved, facts).status).toBe("review");
	expect(
		restoreChoiceAssessmentState({ ...saved, materialProof: { optionIds: ["a", "b"] } }, factsA)
			.status,
	).toBe("review");
	expect(choiceDependencyStatus("a", view({ a: saved }, [row("a", short)], { a: factsA }))).toBe(
		"current",
	);
	expect(
		choiceDependencyStatus("a", view({ a: saved }, [row("a", signatureA)], { a: factsA })),
	).toBe("current");
	expect(
		choiceDependencyStatus("a", view({ a: signedSubmitted }, [row("a", short)], { a: factsA })),
	).toBe("current");
	expect(
		choiceDependencyStatus(
			"a",
			view({ a: saved }, [row("a", "s96:AAAAAAAAAAAAAAAA")], { a: factsA }),
		),
	).toBe("history");
	expect(() => choiceEvidenceSignature("sha256:bad", "scorm12")).toThrow(
		"Invalid choice signature",
	);
});

it("same-material writes preserve one submission while changed material archives its original short evidence", () => {
	expect(
		prepareChoiceAssessmentState(saved, legacySubmitted, factsA, { writtenAt: 20 }).history,
	).toBeUndefined();
	const changed = prepareChoiceAssessmentState(saved, legacySubmitted, factsB, { writtenAt: 20 });
	expect(changed.history).toEqual([saved]);
	expect(changed.contentSignature).toBe(
		"sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702",
	);
});
