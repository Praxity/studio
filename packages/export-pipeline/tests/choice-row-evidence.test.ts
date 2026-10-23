import {
	choiceDependencyStatus,
	prepareChoiceGroupSubmission,
} from "@praxity/shared-blocks/choice-learner-state";
import { expect, it } from "vitest";
import {
	groupView,
	legacySubmitted,
	signatureA,
} from "../../shared-blocks/src/fixtures/choice-evidence";
import { assessmentAttemptMetadata } from "../src/scorm/types";

it.each([
	["retained refusal marker", { choiceEvidenceInvalid: true }],
	["null signature", { contentSignature: null }],
	["malformed signature", { contentSignature: "sha256:broken" }],
	["sparse member witness", { memberIds: Array(1) }],
	["non-string member witness", { memberIds: ["a", null] }],
	["missing member ID", { memberIds: [""] }],
] as const)("refused %s never becomes unsigned legacy evidence", (_name, raw) => {
	const metadata = assessmentAttemptMetadata(raw);
	expect(metadata.choiceEvidenceInvalid).toBe(true);
	const view = groupView({ a: legacySubmitted }, [{ id: "a", correct: true, ...metadata }]);
	expect(choiceDependencyStatus("a", view)).toBe("history");
	expect(prepareChoiceGroupSubmission("g", view)).toBeNull();
});

it("an explicit empty aggregate witness stays distinguishable from an omitted one", () => {
	expect(assessmentAttemptMetadata({ memberIds: [] }).memberIds).toEqual([]);
	expect(assessmentAttemptMetadata({}).memberIds).toBeUndefined();
});

it("valid signed evidence survives the metadata boundary exactly", () => {
	expect(
		assessmentAttemptMetadata({
			contentSignature: signatureA,
			memberIds: ["a"],
			attemptsUsed: 1,
			maxAttempts: 2,
		}),
	).toEqual({ contentSignature: signatureA, memberIds: ["a"], attemptsUsed: 1, maxAttempts: 2 });
});
