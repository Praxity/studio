import { describe, expect, it, vi } from "vitest";
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
import type { LearnerStateValue, SavedAssessmentState } from "./learner-state";
import * as learnerState from "./learner-state";

// Namespace fallbacks make the base fail on assertions, not missing exports.
// Independent Node crypto/Buffer vectors, including the full and compact group payloads.
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
	materialProof: { optionIds: ["a", "b"] },
	writtenAt: 10,
	legacyBuildRevision: "original-build",
};
const compact: SavedAssessmentState = {
	...legacy,
	contentSignature: short,
	writtenAt: 10,
	legacyBuildRevision: "original-build",
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

it("projects only choice evidence at the SCORM 1.2 destination without rewriting history", () => {
	const archived = { ...signed, writtenAt: 5, legacyBuildRevision: "archived-build" };
	const state = { ...signed, history: [archived] } as unknown as LearnerStateValue;
	const project = learnerState.choiceStateForDestination ?? ((value) => value);
	expect(project(state, "scorm12")).toEqual({ ...compact, history: [archived] });
	expect(project(state)).toBe(state);
	expect(state).toEqual({ ...signed, history: [archived] });
	for (const value of [
		null,
		[],
		"answer",
		legacy,
		{ ...signed, kind: "assessmentGroup" },
		{ ...signed, assessmentType: "freeResponse" },
		{ ...signed, contentSignature: "broken" },
	]) {
		expect(() => project(value as LearnerStateValue, "scorm12")).not.toThrow();
		expect(project(value as LearnerStateValue, "scorm12")).toBe(value);
	}
	expect(() => learnerState.choiceEvidenceSignature?.(short, "scorm12")).not.toThrow();
	expect(project(compact as unknown as LearnerStateValue, "scorm12")).toEqual(compact);
	expect(learnerState.choiceEvidenceSignature?.(full, "scorm12")).toBe(short);
	expect(learnerState.choiceEvidenceSignature?.(short, "scorm12")).toBe(short);
	expect(learnerState.choiceEvidenceSignature?.(full)).toBe(full);
});

it.each([
	[`sha256:${"ff".repeat(32)}`, "s96:________________"],
	[`sha256:000102030405060708090aff${"00".repeat(20)}`, "s96:AAECAwQFBgcICQr_"],
])("encodes URL-safe underscore evidence for %s", (signature, expected) => {
	expect(learnerState.choiceEvidenceSignature?.(signature, "scorm12")).toBe(expected);
	expect(learnerState.isScorm12ChoiceSignature?.(expected)).toBe(true);
});

it("admits the exact compact digest but treats changed options and added distractors as history", () => {
	expect(restoreChoiceAssessmentState(compact, facts).status).toBe("current");
	expect(choiceDependencyStatus("a", view())).toBe("current");
	for (const edited of [changed, distractor]) {
		expect(restoreChoiceAssessmentState(compact, edited).status).toBe("review");
		expect(choiceDependencyStatus("a", view(compact, undefined, edited))).toBe("history");
	}
	expect(restoreChoiceAssessmentState(signed, distractor).status).toBe("current");
	expect(
		choiceDependencyStatus("a", view(signed, [{ id: "a", contentSignature: full }], distractor)),
	).toBe("current");
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
	expect(learnerState.isScorm12ChoiceSignature?.(contentSignature) ?? false).toBe(false);
	expect(restoreChoiceAssessmentState({ ...legacy, contentSignature }, facts).status).toBe(
		"review",
	);
});

it("refuses compact claims carrying a proof and keeps malformed projection unchanged", () => {
	expect(
		restoreChoiceAssessmentState({ ...compact, materialProof: signed.materialProof }, facts).status,
	).toBe("review");
	expect(() => learnerState.choiceEvidenceSignature?.("sha256:bad", "scorm12")).toThrow(
		"Invalid choice signature",
	);
});

it.each([
	[short, full],
	[full, short],
	[short, short],
])("matches submitted state %s against reporting row %s", (stateSignature, rowSignature) => {
	const state = stateSignature === short ? compact : signed;
	expect(
		choiceDependencyStatus("a", view(state, [{ id: "a", contentSignature: rowSignature }])),
	).toBe("current");
});

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
			view(compact, [{ id: "a", contentSignature: full, correct: false }]),
		),
	).toBe("history");
});

it("same-material full-to-short writes avoid invented history and preserve archived origins", () => {
	expect(
		prepareChoiceAssessmentState(compact, legacy, facts, { writtenAt: 20 }).history,
	).toBeUndefined();
	const next = prepareChoiceAssessmentState(compact, legacy, changed, { writtenAt: 20 });
	expect(next.history).toEqual([compact]);
	expect(next.history?.[0]).toEqual({
		...legacy,
		contentSignature: short,
		writtenAt: 10,
		legacyBuildRevision: "original-build",
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
	const projected = learnerState.choiceStateForDestination?.(
		prepared as unknown as LearnerStateValue,
		"scorm12",
	);
	expect(projected).toEqual({
		...retry,
		contentSignature: short,
		writtenAt: 20,
		legacyBuildRevision: "original-build",
		history: [signed],
	});
});

describe.each([
	[
		"all",
		"sha256:fda7918846cc4d25dcde21a4916d530393f2c0d4b6852e8cb257b80d8caa8ba1",
		"sha256:41ff245906357f3af4e4ae767706fa59266a52caadf3f75a3751d4c42092f683",
	],
	[
		"oneOf",
		"sha256:5e7428cce3d013af78211f473ccb88441c8aef6e0978a40519945fa6970c8316",
		"sha256:0228a3d56bfd72e9af1ee4ab044a50020a0287e91d78eb52d64e544dce42d469",
	],
] as const)("%s aggregate evidence", (mode, fullDigest, compactDigest) => {
	const payload = {
		mode,
		selectedMemberId: mode === "oneOf" ? "a" : null,
		dependencies: [["a", full]] as [string, string][],
	};
	const group = {
		version: 1,
		kind: "assessmentGroup",
		mode,
		completed: true,
		selectedMemberId: mode === "oneOf" ? "a" : null,
		submitted: { payload, contentSignature: fullDigest },
	};
	const groupView = (
		member: unknown,
		rows: ChoiceDependencyView["rows"],
	): ChoiceDependencyView => ({
		...view(member, rows),
		groups: { g: { mode, memberIds: ["a"], requiredIds: ["a"] } },
		readState: (id) => (id === "g" ? group : member),
	});
	it("keeps full aggregate witnesses after a member's compact write and reload", () => {
		expect(choiceGroupSignature(payload)).toBe(fullDigest);
		const rows = [
			{ id: "g", contentSignature: fullDigest, memberIds: ["a"] },
			{ id: "a", contentSignature: short },
		];
		const member = JSON.parse(JSON.stringify(compact));
		expect(choiceDependencyStatus("g", groupView(member, rows))).toBe("current");
		expect(prepareChoiceGroupSubmission("g", groupView(member, rows))).toEqual({
			payload: { ...payload, dependencies: [["a", short]] },
			contentSignature: compactDigest,
		});
	});
	it("resolves a compact aggregate reference against an unchanged full member", () => {
		const submitted = {
			payload: { ...payload, dependencies: [["a", short]] as [string, string][] },
			contentSignature: compactDigest,
		};
		expect(() => choiceGroupSignature(submitted.payload)).not.toThrow();
		const input = groupView(signed, [
			{ id: "g", contentSignature: compactDigest, memberIds: ["a"] },
		]);
		input.readState = (id) => (id === "g" ? { ...group, submitted } : signed);
		expect(choiceDependencyStatus("g", input)).toBe("current");
	});
	it("keeps the exact old full proof through a compact retry and compatible resubmission", () => {
		const retry = {
			...legacy,
			checked: false,
			correct: false,
			completed: false,
			interacted: false,
			answer: [],
		};
		const prepared = prepareChoiceAssessmentState(signed, retry, distractor, { writtenAt: 20 });
		const resubmitted = prepareChoiceAssessmentState(prepared, legacy, distractor, {
			writtenAt: 30,
		});
		expect(resubmitted.history?.[0]).toEqual(signed);
		const project = learnerState.choiceStateForDestination ?? ((value) => value);
		const member = JSON.parse(
			JSON.stringify(project(resubmitted as unknown as LearnerStateValue, "scorm12")),
		);
		const input = {
			...groupView(member, [{ id: "g", contentSignature: fullDigest, memberIds: ["a"] }]),
			questions: { a: distractor.question },
			signatures: { a: distractor.signature },
		};
		expect(choiceDependencyStatus("g", input)).toBe("current");
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
			createChoiceDependencyView(admitted, { rows: [], readState: () => legacy }),
		).not.toThrow();
		const input = createChoiceDependencyView(admitted, { rows: [], readState: () => legacy });
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

it("an explicitly invalid group never receives legacy aggregate credit", () => {
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
		const input = {
			...view(legacy),
			groups: { g: { mode: "all" as const, memberIds: ["a"], requiredIds: ["a"] } },
			rows: [
				{ id, correct: true },
				{ id, choiceEvidenceInvalid: true as const },
			],
		};
		expect(choiceDependencyStatus(id, input)).toBe("history");
		if (id === "a") expect(prepareChoiceGroupSubmission("g", input)).toBeNull();
		expect(
			choiceDependencyStatus(id, {
				...input,
				rows: [
					{ id, choiceEvidenceInvalid: true },
					{ id, correct: true },
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
	["null signature", { contentSignature: null }],
	["invalid members", { memberIds: ["a", 7] }],
	["sparse members", { memberIds: new Array(1) }],
	["retained rejection", { choiceEvidenceInvalid: true }],
	["false marker", { choiceEvidenceInvalid: false }],
	["string marker", { choiceEvidenceInvalid: "true" }],
	["numeric marker", { choiceEvidenceInvalid: 1 }],
	["null marker", { choiceEvidenceInvalid: null }],
])("dormant metadata retains %s without unsigned fallback", (_name, input) => {
	const normalize = reporting.assessmentEvidenceMetadata ?? reporting.assessmentAttemptMetadata;
	expect(normalize(input).choiceEvidenceInvalid).toBe(true);
	expect(normalize(JSON.parse(JSON.stringify(normalize(input)))).choiceEvidenceInvalid).toBe(true);
	expect(choiceDependencyStatus("a", view(legacy, [{ id: "a", ...normalize(input) }]))).toBe(
		"history",
	);
});

it("keeps ordinary metadata unchanged and admits both evidence forms only through the dormant entry", () => {
	const ordinary = { attemptsUsed: 2, maxAttempts: Infinity, memberIds: ["a"] };
	const normalize = reporting.assessmentEvidenceMetadata ?? reporting.assessmentAttemptMetadata;
	for (const contentSignature of [full, short]) {
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
