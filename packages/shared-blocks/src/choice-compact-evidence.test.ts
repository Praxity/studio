import { expect, it, vi } from "vitest";
import * as reporting from "../../export-pipeline/src/scorm/types";
import {
	type ChoiceDependencyView,
	choiceDependencyStatus,
	choiceGroupSignature,
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
	prepareChoiceGroupSubmission,
	restoreChoiceAssessmentState,
} from "./choice-learner-state";
import { admitChoiceStateFacts, type ChoiceAssessmentFacts } from "./choice-state-facts";
import type { SavedAssessmentState } from "./learner-state";
import * as learnerState from "./learner-state";

// Independent Node crypto/Buffer vectors for compiler digests and saved claims.
const full = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const short = "s96:5N83Sur-iuRJwDIe";
const facts: ChoiceAssessmentFacts = {
	signature: full,
	question: {
		selectionMode: "single",
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
};
const distractor: ChoiceAssessmentFacts = {
	question: {
		...facts.question,
		options: [
			...facts.question.options,
			{ id: "c", materialSignature: `sha256:${"d".repeat(64)}` },
		],
	},
	signature: "sha256:afa3e412c508c12e3e7492d67ae263b4a30df87893ba38fedd00e8e402963063",
};
const changed: ChoiceAssessmentFacts = {
	question: {
		...facts.question,
		options: [
			facts.question.options[0],
			{ id: "b", materialSignature: `sha256:${"d".repeat(64)}` },
		],
	},
	signature: "sha256:3c059831322013bd212abe3391941db66023d34531cebc5de21734ec17ea26f4",
};
const legacy: SavedAssessmentState = {
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: true,
	correct: true,
	completed: true,
	interacted: true,
	answer: ["a"],
};
const signed: SavedAssessmentState = {
	...legacy,
	contentSignature: full,
	writtenAt: 10,
};
const compact: SavedAssessmentState = {
	...legacy,
	contentSignature: short,
	writtenAt: 10,
};

function view(
	state: unknown = compact,
	rows: ChoiceDependencyView["rows"] = [{ id: "a", contentSignature: short, correct: true }],
	current = facts,
): ChoiceDependencyView {
	return {
		rows,
		questions: { a: current.question },
		signatures: { a: current.signature },
		readState: () => state,
	};
}

it.each([
	[`sha256:${"ff".repeat(32)}`, "s96:________________"],
	[`sha256:000102030405060708090aff${"00".repeat(20)}`, "s96:AAECAwQFBgcICQr_"],
])("encodes URL-safe underscore evidence for %s", (signature, expected) => {
	expect(learnerState.choiceEvidenceSignature(signature)).toBe(expected);
	expect(learnerState.choiceEvidenceSignature(expected)).toBe(expected);
	expect(learnerState.isChoiceContentSignature(expected)).toBe(true);
});

it("admits the exact compact digest but treats changed options and added distractors as history", () => {
	expect(restoreChoiceAssessmentState(compact, facts).status).toBe("current");
	expect(choiceDependencyStatus("a", view())).toBe("current");
	for (const edited of [changed, distractor]) {
		expect(restoreChoiceAssessmentState(compact, edited).status).toBe("review");
		expect(choiceDependencyStatus("a", view(compact, undefined, edited))).toBe("history");
	}
	expect(restoreChoiceAssessmentState(signed, facts).status).toBe("review");
	expect(
		choiceDependencyStatus("a", view(signed, [{ id: "a", contentSignature: full }], distractor)),
	).toBe("history");
});

it.each([
	null,
	"",
	"xs96:5N83Sur-iuRJwDIe",
	" s96:5N83Sur-iuRJwDIe",
	"s96:5N83Sur-iuRJwDI",
	"s96:5N83Sur-iuRJwDIe=",
	"s96:5N83Sur+iuRJwDIe",
	"sha256:bad",
])("refuses malformed evidence %j without unsigned fallback", (contentSignature) => {
	expect(learnerState.isChoiceContentSignature(contentSignature)).toBe(false);
	expect(restoreChoiceAssessmentState({ ...legacy, contentSignature }, facts).status).toBe(
		"review",
	);
});

it.each([
	[short, full, "history"],
	[full, short, "history"],
	[short, short, "current"],
])(
	"matches submitted state %s against reporting row %s",
	(stateSignature, rowSignature, status) => {
		const state = stateSignature === short ? compact : signed;
		expect(
			choiceDependencyStatus("a", view(state, [{ id: "a", contentSignature: rowSignature }])),
		).toBe(status);
	},
);

it("refuses a mismatched compact row and contradictory verdict", () => {
	expect(
		choiceDependencyStatus(
			"a",
			view(compact, [{ id: "a", contentSignature: "s96:AAAAAAAAAAAAAAAA" }]),
		),
	).toBe("history");
	expect(
		choiceDependencyStatus(
			"a",
			view(compact, [{ id: "a", contentSignature: short, correct: false }]),
		),
	).toBe("history");
});

it("writes short evidence and preserves archived submissions exactly", () => {
	expect(
		prepareChoiceAssessmentState(compact, legacy, facts, { writtenAt: 20 }).history,
	).toBeUndefined();
	const next = prepareChoiceAssessmentState(compact, legacy, changed, { writtenAt: 20 });
	expect(next.history).toEqual([compact]);
	expect(next.history?.[0]).toEqual({
		...legacy,
		contentSignature: short,
		writtenAt: 10,
	});
	const retry = {
		...legacy,
		checked: false,
		correct: false,
		completed: false,
		interacted: false,
		answer: [],
	};
	const prepared = prepareChoiceAssessmentState(signed, retry, facts, { writtenAt: 20 });

	expect(prepared).toEqual({
		...retry,
		contentSignature: short,
		writtenAt: 20,
		history: [signed],
	});
});

it.each(["s96:too-short", "s96:5N83Sur+iuRJwDIe", "s96:5N83Sur-iuRJwDIe="])(
	"refuses malformed compact aggregate reference %s",
	(signature) => {
		expect(() =>
			choiceGroupSignature({
				mode: "all",
				selectedMemberId: null,
				dependencies: [["a", signature]],
			}),
		).toThrow("Invalid group submission payload");
	},
);

it("retains per-ID corruption while refusing an unidentifiable whole map", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		const admitted = admitChoiceStateFacts({
			choiceStateQuestions: { a: facts.question, broken: {} },
			choiceStateSignatures: { a: full, broken: "bad" },
		});
		expect(() =>
			createChoiceDependencyView(admitted, { rows: [], readState: () => compact }),
		).not.toThrow();
		const input = createChoiceDependencyView(admitted, { rows: [], readState: () => compact });
		expect(input.invalidIds).toEqual(["broken"]);
		expect(choiceDependencyStatus("broken", input)).toBe("history");
		expect(choiceDependencyStatus("a", input)).toBe("current");
		const grouped = {
			...input,
			groups: { g: { mode: "all" as const, memberIds: ["broken"], requiredIds: ["broken"] } },
			rows: [{ id: "g" }],
		};
		expect(choiceDependencyStatus("g", grouped)).toBe("history");
		expect(prepareChoiceGroupSubmission("g", grouped)).toBeNull();
		expect(() =>
			createChoiceDependencyView(
				admitChoiceStateFacts({ choiceStateQuestions: null, choiceStateSignatures: {} }),
				{ rows: [], readState: () => undefined },
			),
		).toThrow("Invalid choice facts");
	} finally {
		warn.mockRestore();
	}
});

it("an explicitly invalid group remains history", () => {
	expect(
		choiceDependencyStatus("g", {
			invalidIds: ["g"],
			questions: {},
			signatures: {},
			rows: [{ id: "g" }],
			groups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
			readState: () => undefined,
		}),
	).toBe("history");
});

it("a rejected question signature cannot grant credit to an admitted group with the same ID", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		const admitted = admitChoiceStateFacts({
			choiceStateQuestions: {},
			choiceStateSignatures: { g: full },
			choiceStateGroups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
		});
		expect(() =>
			createChoiceDependencyView(admitted, { rows: [{ id: "g" }], readState: () => undefined }),
		).not.toThrow();
		const input = createChoiceDependencyView(admitted, {
			rows: [{ id: "g" }],
			readState: () => undefined,
		});
		expect(input.invalidIds).toEqual(["g"]);
		expect(input.groups?.g).toEqual({ mode: "all", memberIds: ["a"], requiredIds: ["a"] });
		expect(choiceDependencyStatus("g", input)).toBe("history");
	} finally {
		warn.mockRestore();
	}
});

it.each(["a", "g"])(
	"retains a rejected latest %s row rather than reviving previous evidence",
	(id) => {
		const group = {
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			completed: true,
			submitted: {
				payload: { mode: "all", selectedMemberId: null, dependencies: [["a", short]] },
				contentSignature: "s96:Qf8kWQY1fzr05K52",
			},
		};
		const contentSignature = id === "a" ? short : group.submitted.contentSignature;
		const input = {
			...view(compact),
			readState: (member: string) => (member === "g" ? group : compact),
			groups: { g: { mode: "all" as const, memberIds: ["a"], requiredIds: ["a"] } },
			rows: [
				{ id, correct: true, contentSignature },
				{ id, correct: true, contentSignature, choiceEvidenceInvalid: true as const },
			],
		};
		expect(choiceDependencyStatus(id, input)).toBe("history");
		if (id === "a") expect(prepareChoiceGroupSubmission("g", input)).toBeNull();
		expect(
			choiceDependencyStatus(id, {
				...input,
				rows: [
					{ id, choiceEvidenceInvalid: true },
					{ id, correct: true, contentSignature: id === "a" ? short : "s96:Qf8kWQY1fzr05K52" },
				],
			}),
		).toBe("current");
		expect(
			choiceDependencyStatus("removed", {
				...input,
				rows: [{ id: "removed", choiceEvidenceInvalid: true }],
			}),
		).toBe("current");
	},
);

it.each([
	["invalid signature", { contentSignature: "sha256:broken" }],
	["full compiler digest", { contentSignature: full }],
	["null signature", { contentSignature: null }],
	["invalid members", { memberIds: ["a", 7] }],
	["sparse members", { memberIds: new Array(1) }],
	["retained rejection", { choiceEvidenceInvalid: true }],
	["false marker", { choiceEvidenceInvalid: false }],
	["string marker", { choiceEvidenceInvalid: "true" }],
	["numeric marker", { choiceEvidenceInvalid: 1 }],
	["null marker", { choiceEvidenceInvalid: null }],
])("dormant metadata retains %s without unsigned fallback", (_name, input) => {
	const normalize = reporting.assessmentEvidenceMetadata;
	expect(normalize(input).choiceEvidenceInvalid).toBe(true);
	expect(normalize(JSON.parse(JSON.stringify(normalize(input)))).choiceEvidenceInvalid).toBe(true);
	expect(choiceDependencyStatus("a", view(compact, [{ id: "a", ...normalize(input) }]))).toBe(
		"history",
	);
});

it("keeps ordinary metadata unchanged and admits short evidence through the dormant entry", () => {
	const ordinary = { attemptsUsed: 2, maxAttempts: Infinity, memberIds: ["a"] };
	const normalize = reporting.assessmentEvidenceMetadata;
	for (const contentSignature of [short]) {
		expect(normalize({ ...ordinary, contentSignature })).toEqual({
			attemptsUsed: 2,
			maxAttempts: 0,
			memberIds: ["a"],
			contentSignature,
		});
		expect(reporting.assessmentAttemptMetadata({ ...ordinary, contentSignature })).toEqual({
			attemptsUsed: 2,
			maxAttempts: 0,
			memberIds: ["a"],
		});
	}
	expect(normalize(ordinary)).toEqual(reporting.assessmentAttemptMetadata(ordinary));
	expect(normalize({ memberIds: [] }).memberIds).toEqual([]);
	expect(reporting.assessmentAttemptMetadata({ memberIds: [] }).memberIds).toBeUndefined();
	for (const input of [undefined, null, 0, "row"]) {
		expect(() => normalize(input)).not.toThrow();
		expect(normalize(input)).toEqual(reporting.assessmentAttemptMetadata(input));
	}
});
