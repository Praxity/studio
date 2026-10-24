import { describe, expect, it, vi } from "vitest";
import {
	choiceDependencyStatus,
	choiceGroupSignature,
	createChoiceDependencyView,
	restoreChoiceAssessmentState,
} from "./choice-learner-state";
import {
	admitChoiceStateFacts,
	type ChoiceAssessmentFacts,
	choiceGroupDefinitionIsValid,
	isChoiceStateQuestion,
} from "./choice-state-facts";

const facts: ChoiceAssessmentFacts = {
	question: {
		selectionMode: "multiple",
		dontKnow: false,
		canAutoScore: true,
		graded: true,
		maxAttempts: 2,
		correctAnswerSignature:
			"sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
		materialSignature: `sha256:${"a".repeat(64)}`,
		options: [
			{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
			{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
		],
	},
	signature: "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d",
};

const submitted = {
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: true,
	correct: true,
	completed: true,
	interacted: true,
	answer: ["a"],
	contentSignature: "s96:5N83Sur-iuRJwDIe",
};

const memberThenHole = new Array<string>(2);
memberThenHole[0] = "a";
const sparseMembers = [
	["only holes", new Array<string>(1)],
	["member then hole", memberThenHole],
] as const;

it.each(sparseMembers)("refuses raw group %s", (_input, memberBlockIds) => {
	expect(choiceGroupDefinitionIsValid({ mode: "all", memberBlockIds })).toBe(false);
});

it("keeps dense raw group members", () => {
	expect(choiceGroupDefinitionIsValid({ mode: "all", memberBlockIds: ["a"] })).toBe(true);
});

it.each([
	["only holes", new Array(1)],
	// biome-ignore lint/suspicious/noSparseArray: Reproduce an option followed by a missing index.
	["option then hole", [{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` }, ,]],
])("refuses question options containing %s", (_input, options) => {
	expect(isChoiceStateQuestion({ ...facts.question, options })).toBe(false);
});

it("keeps dense and empty question options", () => {
	expect(isChoiceStateQuestion(facts.question)).toBe(true);
	expect(isChoiceStateQuestion({ ...facts.question, options: [] })).toBe(true);
});

describe.each(["all", "oneOf"] as const)("sparse %s group facts", (mode) => {
	it.each([
		["all member holes", new Array(1), ["a"]],
		// biome-ignore lint/suspicious/noSparseArray: Isolate sparse membership with a valid required member.
		["member then hole", ["a", ,], ["a"]],
		["all required holes", ["a"], new Array(1)],
		// biome-ignore lint/suspicious/noSparseArray: Isolate sparse requirements with dense valid membership.
		["required then hole", ["a"], ["a", ,]],
	])("refuses %s", (_input, memberIds, requiredIds) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const admitted = admitChoiceStateFacts({
				choiceStateGroups: { g: { mode, memberIds, requiredIds } },
			});
			expect(admitted.choiceStateFactsStatus).toBe("invalid");
			expect(admitted.choiceStateInvalidIds).toEqual(["g"]);
			expect(admitted.choiceStateGroups).toEqual({});
			const view = createChoiceDependencyView(admitted, { rows: [], readState: () => undefined });
			expect(view.invalidIds).toEqual(["g"]);
			expect(choiceDependencyStatus("g", view)).toBe("history");
		} finally {
			warn.mockRestore();
		}
	});

	it("keeps dense membership and requirements", () => {
		const admitted = admitChoiceStateFacts({
			choiceStateGroups: { g: { mode, memberIds: ["a", "b"], requiredIds: ["a"] } },
		});
		expect(admitted.choiceStateFactsStatus).toBe("valid");
		expect(admitted.choiceStateInvalidIds).toEqual([]);
		expect(admitted.choiceStateGroups?.g).toEqual({
			mode,
			memberIds: ["a", "b"],
			requiredIds: ["a"],
		});
	});
});

it.each(sparseMembers)("refuses submitted answer with %s", (_input, answer) => {
	const restored = restoreChoiceAssessmentState(
		{ ...submitted, answer, correct: false, completed: false },
		facts,
	);
	expect(restored.status).toBe("review");
	expect(restored.current).toBeNull();
});

it.each(sparseMembers)("refuses reviewed choices with %s", (_input, reviewedChoiceIds) => {
	const restored = restoreChoiceAssessmentState({ ...submitted, reviewedChoiceIds }, facts);
	expect(restored.status).toBe("review");
	expect(restored.current).toBeNull();
});

it("keeps dense submitted and reviewed choices", () => {
	const restored = restoreChoiceAssessmentState({ ...submitted, reviewedChoiceIds: ["b"] }, facts);
	expect(restored.status).toBe("current");
	expect(restored.current?.answer).toEqual(["a"]);
	expect(restored.current?.reviewedChoiceIds).toEqual(["b"]);
});

it.each([
	["only holes", 1, false],
	["dependency then hole", 2, true],
] as const)("keeps refusing aggregate dependencies with %s", (_input, length, hasMember) => {
	const dependencies = new Array<[string, string | null]>(length);
	if (hasMember) dependencies[0] = ["a", null];
	expect(() => choiceGroupSignature({ mode: "all", selectedMemberId: null, dependencies })).toThrow(
		"Invalid group submission payload",
	);
});

it.each(sparseMembers)("refuses an aggregate row witness with %s", (_input, memberIds) => {
	const view = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
		}),
		{
			rows: [{ id: "g", correct: true, memberIds, contentSignature: "s96:_0j2FBczKQd6abp2" }],
			readState: () => ({
				version: 1,
				kind: "assessmentGroup",
				mode: "all",
				completed: true,
				submitted: {
					payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
					contentSignature: "s96:_0j2FBczKQd6abp2",
				},
			}),
		},
	);
	expect(choiceDependencyStatus("g", view)).toBe("history");
});

it("keeps a dense aggregate row witness", () => {
	const view = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
		}),
		{
			rows: [
				{ id: "g", correct: true, memberIds: ["a"], contentSignature: "s96:_0j2FBczKQd6abp2" },
			],
			readState: () => ({
				version: 1,
				kind: "assessmentGroup",
				mode: "all",
				completed: true,
				submitted: {
					payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
					contentSignature: "s96:_0j2FBczKQd6abp2",
				},
			}),
		},
	);
	expect(choiceDependencyStatus("g", view)).toBe("current");
});
