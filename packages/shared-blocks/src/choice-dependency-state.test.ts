import { describe, expect, it } from "vitest";
import {
	type ChoiceDependencyView,
	type ChoiceGroupPayload,
	type ChoiceGroupSubmission,
	type ChoiceStateGroup,
	choiceDependencyStatus,
	choiceGroupDependencyIds,
	choiceGroupSignature,
	prepareChoiceAssessmentState,
	prepareChoiceGroupSubmission,
	restoreChoiceAssessmentState,
} from "./choice-learner-state";
import {
	type ChoiceAssessmentFacts,
	type ChoiceStateQuestion,
	choiceMaterialProof,
	choiceProofSignature,
} from "./choice-state-facts";
import type { SavedAssessmentState } from "./learner-state";

// Independent SHA-256 literals for version-3 question payloads.
const signatureA = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const signatureB = "sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702";
const question: ChoiceStateQuestion = {
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
const factsA: ChoiceAssessmentFacts = { question, signature: signatureA };
const factsB: ChoiceAssessmentFacts = {
	question: { ...question, materialSignature: `sha256:${"d".repeat(64)}` },
	signature: signatureB,
};
const repairedFacts: ChoiceAssessmentFacts = {
	question: {
		...question,
		materialSignature: `sha256:${"f".repeat(64)}`,
		correctAnswerSignature:
			"sha256:a8950f05d3443e7921e7ec6fbe06c8febe40966a5db58b15f767a995d561290b",
	},
	signature: "sha256:5c2b122cba5f1eb15ccabd6efddce1542fdbcf510e411f0b803e1d367b3929fa",
};
// Literal state written before signatures/history existed, including Try again's empty draft.
const legacySubmitted: SavedAssessmentState = {
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
const legacyRetry: SavedAssessmentState = {
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: false,
	correct: false,
	completed: false,
	interacted: false,
	answer: [],
};
const signedSubmitted: SavedAssessmentState = {
	...legacySubmitted,
	contentSignature: signatureA,
	materialProof: { optionIds: ["a", "b"] },
	writtenAt: 10,
};
const retryDraft = {
	...legacyRetry,
	contentSignature: signatureB,
	materialProof: { optionIds: ["a", "b"] },
};
const addedDistractor: ChoiceAssessmentFacts = {
	question: {
		...question,
		options: [...question.options, { id: "c", materialSignature: `sha256:${"d".repeat(64)}` }],
	},
	signature: "sha256:afa3e412c508c12e3e7492d67ae263b4a30df87893ba38fedd00e8e402963063",
};

function factPair(question: ChoiceStateQuestion): ChoiceAssessmentFacts {
	return { question, signature: choiceProofSignature(choiceMaterialProof(question)) };
}

function answer(correct = true, signed = true): SavedAssessmentState {
	return {
		version: 1,
		kind: "assessment",
		assessmentType: "choice",
		attemptCount: 1,
		checked: true,
		correct,
		completed: correct,
		interacted: true,
		answer: [correct ? "a" : "b"],
		...(signed ? { contentSignature: signatureA, materialProof: { optionIds: ["a", "b"] } } : {}),
	};
}
const draft = (): SavedAssessmentState => ({
	...answer(),
	checked: false,
	correct: false,
	completed: false,
	attemptCount: 0,
	answer: [],
});
const row = (id = "a", contentSignature = signatureA, correct = true) => ({
	id,
	contentSignature,
	correct,
});

function view(
	states: Record<string, unknown> = { a: answer() },
	rows: ChoiceDependencyView["rows"] = [row()],
	facts: Record<string, ChoiceAssessmentFacts> = { a: factsA },
): ChoiceDependencyView {
	return {
		rows,
		questions: Object.fromEntries(Object.entries(facts).map(([id, value]) => [id, value.question])),
		signatures: Object.fromEntries(
			Object.entries(facts).map(([id, value]) => [id, value.signature]),
		),
		readState: (id) => states[id],
	};
}

// Precomputed from the specified JSON tuples using Node crypto, independently of this owner.
const groupDigests = {
	all: {
		signed: "sha256:fda7918846cc4d25dcde21a4916d530393f2c0d4b6852e8cb257b80d8caa8ba1",
		legacy: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
		changed: "sha256:855046ca0ab3006f658988e444dc7e03da69af411410c1947d688ffe7dc8b3b8",
		repaired: "sha256:bff77f1fc1e7627fffe5cc04f13fa3e614f878fdecb3e0894ae1d784170411f8",
	},
	oneOf: {
		signed: "sha256:5e7428cce3d013af78211f473ccb88441c8aef6e0978a40519945fa6970c8316",
		legacy: "sha256:0f7eea5ce8b8751eb709140d6e6f323b4f320870e2be78ba811e1ff2c16b11a8",
		changed: "sha256:300052c69af6a4ec0df2a88eef7bba63e825877186cdca1fe4356f564cee5d11",
		repaired: "sha256:75e1ac10da40ca1cc647b07a3c37914f1e0c4ec39c483a1b255b0d4d627b1837",
	},
};

function groupSubmission(
	mode: "all" | "oneOf",
	material: keyof typeof groupDigests.all,
): ChoiceGroupSubmission {
	return {
		payload: {
			mode,
			selectedMemberId: mode === "oneOf" ? "a" : null,
			dependencies: [
				[
					"a",
					material === "legacy"
						? null
						: material === "changed"
							? signatureB
							: material === "repaired"
								? repairedFacts.signature
								: signatureA,
				],
			],
		},
		contentSignature: groupDigests[mode][material],
	};
}

function groupState(
	mode: "all" | "oneOf",
	submitted?: ChoiceGroupSubmission,
	selected = "a",
	completed = false,
) {
	return {
		version: 1,
		kind: "assessmentGroup",
		mode,
		selectedMemberId: mode === "oneOf" ? selected : null,
		completed,
		...(submitted ? { submitted } : {}),
	};
}

function groupView(
	states: Record<string, unknown>,
	rows: ChoiceDependencyView["rows"],
	facts: Record<string, ChoiceAssessmentFacts> = { a: factsA },
	group: ChoiceStateGroup = { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
): ChoiceDependencyView {
	return { ...view(states, rows, facts), groups: { g: group } };
}

describe("dormant choice admission", () => {
	const memberCases = [
		{ name: "no submission anywhere", state: undefined, facts: factsA, status: "unanswered" },
		{
			name: "fresh unsigned selection",
			state: { ...legacyRetry, attemptCount: 0, answer: ["a"] },
			facts: factsA,
			status: "unanswered",
		},
		{
			name: "rule-B unsigned submission",
			state: legacySubmitted,
			row: { id: "a", correct: true },
			facts: factsA,
			status: "current",
		},
		{
			name: "signed submission with retained legacy origin",
			state: { ...signedSubmitted, history: [legacySubmitted] },
			row: { id: "a", contentSignature: signatureA, correct: true },
			facts: factsA,
			status: "current",
		},
		{
			name: "signed submission without legacy origin",
			state: signedSubmitted,
			row: { id: "a", contentSignature: signatureA, correct: true },
			facts: factsA,
			status: "current",
		},
		{
			name: "today's retry draft over unsigned submission",
			state: { ...retryDraft, history: [legacySubmitted] },
			row: { id: "a", correct: true },
			facts: factsB,
			status: "current",
		},
		{
			name: "draft over signed and legacy history",
			state: { ...retryDraft, history: [legacySubmitted, signedSubmitted] },
			row: { id: "a", contentSignature: signatureA, correct: true },
			facts: factsA,
			status: "current",
		},
		{
			name: "draft over signed history only",
			state: { ...retryDraft, history: [signedSubmitted] },
			row: { id: "a", contentSignature: signatureA, correct: true },
			facts: factsA,
			status: "current",
		},
		{
			name: "erased pre-change retry",
			state: legacyRetry,
			row: { id: "a", correct: false },
			facts: factsA,
			status: "current",
		},
		{
			name: "latest submission rejected for changed material",
			state: signedSubmitted,
			row: { id: "a", contentSignature: signatureA, correct: true },
			facts: factsB,
			status: "history",
		},
		{
			name: "today's signed draft over rejected submission",
			state: { ...retryDraft, history: [signedSubmitted] },
			row: { id: "a", contentSignature: signatureA, correct: true },
			facts: factsB,
			status: "history",
		},
		{
			name: "new submission after material repair with rejected old origin",
			state: {
				...signedSubmitted,
				answer: ["b"],
				contentSignature: repairedFacts.signature,
				history: [legacySubmitted],
			},
			row: { id: "a", contentSignature: repairedFacts.signature, correct: true },
			facts: repairedFacts,
			status: "current",
		},
	];
	it.each(memberCases)("member evidence table: $name", ({ state, row, facts, status }) => {
		for (const saved of [
			state,
			state === undefined ? undefined : JSON.parse(JSON.stringify(state)),
		]) {
			for (const rows of [row ? [row] : [], []]) {
				const bytes = JSON.stringify(saved);
				expect(choiceDependencyStatus("a", view({ a: saved }, rows, { a: facts }))).toBe(status);
				expect(JSON.stringify(saved)).toBe(bytes);
			}
		}
	});

	const groupTable = [
		{
			member: memberCases[0],
			material: "signed",
			statuses: ["unanswered", "history", "history", "history"],
		},
		{
			member: memberCases[1],
			material: "signed",
			statuses: ["unanswered", "history", "history", "history"],
		},
		{
			member: memberCases[2],
			material: "legacy",
			statuses: ["unanswered", "current", "current", "history"],
		},
		{
			member: memberCases[3],
			material: "signed",
			statuses: ["unanswered", "current", "current", "history"],
		},
		{
			member: memberCases[4],
			material: "signed",
			statuses: ["unanswered", "history", "current", "history"],
		},
		{
			member: memberCases[5],
			material: "legacy",
			statuses: ["unanswered", "current", "current", "history"],
		},
		{
			member: memberCases[6],
			material: "signed",
			statuses: ["unanswered", "current", "current", "history"],
		},
		{
			member: memberCases[7],
			material: "signed",
			statuses: ["unanswered", "history", "current", "history"],
		},
		{
			member: memberCases[8],
			material: "legacy",
			statuses: ["unanswered", "current", "current", "history"],
		},
		{
			member: memberCases[9],
			material: "signed",
			statuses: ["unanswered", "history", "history", "history"],
		},
		{
			member: memberCases[10],
			material: "signed",
			statuses: ["unanswered", "history", "history", "history"],
		},
		{
			member: memberCases[11],
			material: "repaired",
			statuses: ["unanswered", "history", "current", "history"],
		},
	] as const;
	for (const mode of ["all", "oneOf"] as const) {
		for (const { member, material, statuses } of groupTable) {
			for (const [column, expected] of statuses.entries()) {
				for (const staleReference of column === 3 ? [false, true] : [false]) {
					it(`group evidence table: ${mode}, ${member.name}, column ${column}${staleReference ? ", valid stale reference" : ""}`, () => {
						const matching = groupSubmission(mode, material);
						const submitted =
							column < 2
								? undefined
								: column === 2
									? matching
									: staleReference
										? groupSubmission(mode, "changed")
										: { ...matching, contentSignature: signatureB };
						const aggregateRows =
							column === 0
								? []
								: [
										{
											id: "g",
											...(submitted ? { contentSignature: submitted.contentSignature } : {}),
										},
									];
						for (const completed of [false, true]) {
							const states = {
								a: member.state,
								g: column === 0 ? undefined : groupState(mode, submitted, "a", completed),
							};
							for (const saved of [states, JSON.parse(JSON.stringify(states))]) {
								for (const rows of [
									member.row ? [member.row, ...aggregateRows] : aggregateRows,
									aggregateRows,
								]) {
									const bytes = JSON.stringify(saved);
									const input = groupView(
										saved,
										rows,
										{ a: member.facts },
										{ mode, memberIds: ["a"], requiredIds: ["a"] },
									);
									expect(choiceDependencyStatus("g", input)).toBe(expected);
									expect(JSON.stringify(saved)).toBe(bytes);
								}
							}
						}
					});
				}
			}
		}
	}

	it("refuses a signed incorrect row as evidence for an erased legacy retry", () => {
		expect(
			choiceDependencyStatus(
				"a",
				view({ a: legacyRetry }, [{ id: "a", contentSignature: signatureA, correct: false }]),
			),
		).toBe("history");
	});

	it("draft writes retain an erased retry's material evidence across a content change", () => {
		const previous: SavedAssessmentState = {
			...legacyRetry,
			contentSignature: signatureA,
			materialProof: { optionIds: ["a", "b"] },
			writtenAt: 1,
		};
		const bytes = JSON.stringify(previous);
		for (const rows of [[], [{ id: "a", correct: false }]]) {
			expect(choiceDependencyStatus("a", view({ a: previous }, rows))).toBe("current");
			for (const { facts, status } of [
				{ facts: factsB, status: "history" },
				{ facts: addedDistractor, status: "current" },
			]) {
				expect(choiceDependencyStatus("a", view({ a: previous }, rows, { a: facts }))).toBe(status);
				const edited = prepareChoiceAssessmentState(
					previous,
					{ ...legacyRetry, answer: ["b"] },
					facts,
					{ writtenAt: 2 },
				);
				expect(choiceDependencyStatus("a", view({ a: edited }, rows, { a: facts }))).toBe(status);
				expect(edited.contentSignature).toBe(signatureA);
				expect(edited.materialProof).toEqual({ optionIds: ["a", "b"] });
				const reloaded = JSON.parse(JSON.stringify(edited));
				const repeated = prepareChoiceAssessmentState(reloaded, legacyRetry, facts, {
					writtenAt: 3,
				});
				expect(choiceDependencyStatus("a", view({ a: repeated }, rows, { a: facts }))).toBe(status);
			}
		}
		const submitted = prepareChoiceAssessmentState(previous, legacySubmitted, factsB, {
			writtenAt: 4,
		});
		expect(
			choiceDependencyStatus(
				"a",
				view({ a: submitted }, [{ id: "a", contentSignature: signatureB, correct: true }], {
					a: factsB,
				}),
			),
		).toBe("current");
		expect(JSON.stringify(previous)).toBe(bytes);
	});

	it("refuses a zero-attempt erased retry paired with an unsigned reporting row", () => {
		expect(
			choiceDependencyStatus(
				"a",
				view({ a: { ...legacyRetry, attemptCount: 0 } }, [{ id: "a", correct: false }]),
			),
		).toBe("history");
	});

	it("classifies compatible same-attempt re-signing against its unchanged reporting row", () => {
		const rows = [{ id: "a", contentSignature: signatureA, correct: true }];
		expect(
			choiceDependencyStatus("a", view({ a: signedSubmitted }, rows, { a: addedDistractor })),
		).toBe("current");
		const resigned = prepareChoiceAssessmentState(
			signedSubmitted,
			signedSubmitted,
			addedDistractor,
			{ writtenAt: 5 },
		);
		for (const saved of [resigned, JSON.parse(JSON.stringify(resigned))]) {
			expect(choiceDependencyStatus("a", view({ a: saved }, rows, { a: addedDistractor }))).toBe(
				"history",
			);
			expect(choiceDependencyStatus("a", view({ a: saved }, [], { a: addedDistractor }))).toBe(
				"current",
			);
		}
	});

	it("does not fall back to legacy pending or an older current answer when the latest submission rejects", () => {
		const state = {
			...legacyRetry,
			history: [legacySubmitted, { ...signedSubmitted, contentSignature: signatureB }],
		};
		expect(choiceDependencyStatus("a", view({ a: state }, []))).toBe("history");
	});

	it("reconciles a later signed submission with its own signed row", () => {
		const later = {
			...signedSubmitted,
			contentSignature: signatureB,
			history: [signedSubmitted],
		};
		const consistent = { id: "a", contentSignature: signatureB, correct: true };
		expect(choiceDependencyStatus("a", view({ a: later }, [consistent], { a: factsB }))).toBe(
			"current",
		);
		expect(
			choiceDependencyStatus("a", view({ a: later }, [{ id: "a", correct: true }], { a: factsB })),
		).toBe("history");
	});

	it("preserves submitted origin through draft writes, reload and compatible re-signing", () => {
		const original = JSON.stringify(signedSubmitted);
		const retry = prepareChoiceAssessmentState(signedSubmitted, legacyRetry, addedDistractor, {
			writtenAt: 20,
		});
		const reloaded = JSON.parse(JSON.stringify(retry));
		const again = prepareChoiceAssessmentState(reloaded, legacyRetry, addedDistractor, {
			writtenAt: 21,
		});
		expect(again.history).toEqual([signedSubmitted]);
		const pending = view({ a: again }, [{ id: "a", contentSignature: signatureA, correct: true }], {
			a: addedDistractor,
		});
		expect(choiceDependencyStatus("a", pending)).toBe("current");
		const resubmitted = prepareChoiceAssessmentState(
			again,
			{ ...legacySubmitted, attemptCount: 2 },
			addedDistractor,
			{ writtenAt: 22 },
		);
		expect(resubmitted.history).toEqual([signedSubmitted]);
		const resigned = prepareChoiceAssessmentState(
			signedSubmitted,
			signedSubmitted,
			addedDistractor,
			{ writtenAt: 23 },
		);
		expect(resigned.history).toEqual([signedSubmitted]);
		expect(JSON.stringify(signedSubmitted)).toBe(original);
	});

	it("keeps real unsigned submissions and pre-signature Try again drafts current", () => {
		const submittedRow = { id: "a", response: "correct-option", correct: true, timestamp: 1 };
		expect(choiceDependencyStatus("a", view({ a: legacySubmitted }, [submittedRow]))).toBe(
			"current",
		);
		const retryRow = {
			id: "a",
			response: "wrong-option",
			correct: false,
			score: 0,
			timestamp: 1,
			attemptsUsed: 1,
			maxAttempts: 2,
		};
		const bytes = JSON.stringify(legacyRetry);
		expect(restoreChoiceAssessmentState(legacyRetry, factsA).status).toBe("current");
		expect(choiceDependencyStatus("a", view({ a: legacyRetry }, [retryRow]))).toBe("current");
		const editedDraft = prepareChoiceAssessmentState(legacyRetry, legacyRetry, factsA, {
			writtenAt: 7,
		});
		expect(choiceDependencyStatus("a", view({ a: editedDraft }, [retryRow]))).toBe("current");
		expect(choiceDependencyStatus("a", view({ a: legacyRetry }, []))).toBe("current");
		expect(choiceDependencyStatus("a", view({ a: editedDraft }, []))).toBe("current");
		expect(editedDraft).not.toHaveProperty("history");
		expect(JSON.stringify(legacyRetry)).toBe(bytes);
		expect(choiceDependencyStatus("a", view({ a: { ...legacyRetry, attemptCount: 0 } }, []))).toBe(
			"unanswered",
		);
	});

	it("keeps changed or contradictory retry evidence historical instead of taking the legacy path", () => {
		const retryRow = { id: "a", correct: false };
		const stale = { ...legacyRetry, contentSignature: signatureA };
		expect(choiceDependencyStatus("a", view({ a: stale }, [retryRow], { a: factsB }))).toBe(
			"history",
		);
		expect(choiceDependencyStatus("a", view({ a: stale }, [], { a: factsB }))).toBe("history");
		expect(choiceDependencyStatus("a", view({ a: legacyRetry }, [row()]))).toBe("history");
		expect(
			choiceDependencyStatus("a", view({ a: legacyRetry }, [{ id: "a", correct: true }])),
		).toBe("history");
		const changed = factPair({ ...question, correctAnswerSignature: `sha256:${"f".repeat(64)}` });
		expect(
			choiceDependencyStatus(
				"a",
				view({ a: legacySubmitted }, [{ id: "a", correct: true }], { a: changed }),
			),
		).toBe("history");
	});

	it("recognizes a private fresh draft's archived submission without a reporting row or attempt count", () => {
		const fresh = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 0,
			checked: false,
			correct: false,
			completed: false,
			interacted: false,
			answer: [],
			contentSignature: signatureB,
			history: [{ ...legacySubmitted, contentSignature: signatureA }],
		};
		expect(choiceDependencyStatus("a", view({ a: fresh }, [], { a: factsB }))).toBe("history");
	});

	it("archives a signed submission on direct resubmission without an intervening draft", () => {
		const first: SavedAssessmentState = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 1,
			checked: true,
			correct: false,
			completed: false,
			interacted: true,
			answer: ["b"],
			contentSignature: signatureA,
			materialProof: { optionIds: ["a", "b"] },
			writtenAt: 10,
		};
		const bytes = JSON.stringify(first);
		const second = prepareChoiceAssessmentState(
			first,
			{ ...legacySubmitted, attemptCount: 2 },
			factsA,
			{ writtenAt: 11 },
		);
		expect(second.history).toEqual([first]);
		expect(second.answer).toEqual(["a"]);
		expect(second.attemptCount).toBe(2);
		expect(JSON.stringify(first)).toBe(bytes);
	});

	it("uses the compiled version-3 signature without changing the saved answer", () => {
		expect(choiceProofSignature(choiceMaterialProof(question))).toBe(signatureA);
		const saved = answer();
		const bytes = JSON.stringify(saved);
		expect(restoreChoiceAssessmentState(saved, factsA)).toEqual({
			status: "current",
			current: saved,
			history: [],
		});
		expect(choiceDependencyStatus("a", view({ a: saved }))).toBe("current");
		expect(JSON.stringify(saved)).toBe(bytes);
	});

	it("keeps a signed material edit as history, with no current answer", () => {
		const saved = answer();
		expect(restoreChoiceAssessmentState(saved, factsB)).toEqual({
			status: "review",
			current: null,
			history: [saved],
		});
		expect(choiceDependencyStatus("a", view({ a: saved }, [row()], { a: factsB }))).toBe("history");
	});

	it("distinguishes an unanswered draft from a retry whose submitted answer became history", () => {
		expect(restoreChoiceAssessmentState(undefined, factsA)).toEqual({
			status: "empty",
			current: null,
			history: [],
		});
		expect(choiceDependencyStatus("a", view({}, []))).toBe("unanswered");
		expect(choiceDependencyStatus("a", view({ a: draft() }, []))).toBe("unanswered");
		expect(restoreChoiceAssessmentState({ ...draft(), answer: ["removed"] }, factsA).status).toBe(
			"empty",
		);
		const retry = { ...draft(), attemptCount: 1, history: [answer()] };
		expect(choiceDependencyStatus("a", view({ a: retry }))).toBe("current");
		expect(choiceDependencyStatus("a", view({ a: retry }, [row()], { a: factsB }))).toBe("history");
	});

	it.each([true, false])(
		"rule B admits the unchanged unsigned verdict %s without signing it",
		(correct) => {
			const saved = answer(correct, false);
			const bytes = JSON.stringify(saved);
			expect(restoreChoiceAssessmentState(saved, factsB).status).toBe("current");
			expect(choiceDependencyStatus("a", view({ a: saved }, [{ id: "a", correct }]))).toBe(
				"current",
			);
			expect(JSON.stringify(saved)).toBe(bytes);
			expect(saved).not.toHaveProperty("contentSignature");
		},
	);

	it("rule B rejects changed verdicts, removed selections and malformed submitted answers", () => {
		const changed = {
			...factsA,
			question: { ...question, correctAnswerSignature: `sha256:${"f".repeat(64)}` },
		};
		expect(restoreChoiceAssessmentState(answer(true, false), changed).status).toBe("review");
		for (const invalid of [
			{ ...answer(), answer: ["removed"] },
			{ ...answer(), answer: ["a", "a"] },
			{ ...answer(), answer: ["a", "b"] },
			{ ...answer(), correct: false },
			{ ...answer(), completed: false },
			{ ...answer(), attemptCount: 0 },
			{ ...answer(), attemptCount: 3 },
			{ ...answer(), reviewedChoiceIds: ["removed"] },
			{ ...answer(), contentSignature: "malformed" },
		]) {
			expect(restoreChoiceAssessmentState(invalid, factsA).status).toBe("review");
			expect(choiceDependencyStatus("a", view({ a: invalid }))).toBe("history");
		}
	});

	it("normalizes legacy finality under today's policy but preserves the original stored verdict in history", () => {
		const legacy = { ...answer(false, false), completed: true };
		const restored = restoreChoiceAssessmentState(legacy, factsA);
		expect(restored.current).toEqual({ ...legacy, completed: false });
		const next = prepareChoiceAssessmentState(legacy, draft(), factsA, { writtenAt: 42 });
		expect(next.history).toEqual([legacy]);
		expect(legacy).not.toHaveProperty("history");
	});

	it("handles unlimited attempts, unscored answers and offered uncertainty without inventing a verdict", () => {
		const unlimited = { ...factsA, question: { ...question, maxAttempts: 0 } };
		const saved = { ...answer(false, false), attemptCount: 80 };
		expect(restoreChoiceAssessmentState(saved, unlimited).current).toEqual(saved);
		const survey = { ...factsA, question: { ...question, canAutoScore: false, graded: false } };
		expect(
			restoreChoiceAssessmentState({ ...answer(false, false), completed: true }, survey).status,
		).toBe("current");
		const uncertain = { ...answer(false, false), answer: ["dont-know"] };
		expect(
			restoreChoiceAssessmentState(uncertain, {
				...factsA,
				question: { ...question, dontKnow: true },
			}).status,
		).toBe("current");
		expect(restoreChoiceAssessmentState(uncertain, factsA).status).toBe("review");
	});

	it("refuses invalid compiled question facts instead of falling back to unsigned admission", () => {
		for (const invalid of [
			{ ...factsA, signature: "invalid" },
			{ ...factsA, signature: signatureB },
			{ ...factsA, question: { ...question, maxAttempts: -1 } },
			{ ...factsA, question: { ...question, options: [question.options[0], question.options[0]] } },
		]) {
			expect(restoreChoiceAssessmentState(answer(true, false), invalid).status).toBe("review");
			expect(() =>
				prepareChoiceAssessmentState(undefined, answer(), invalid, { writtenAt: 1 }),
			).toThrow("Invalid compiled choice facts");
			expect(
				choiceDependencyStatus(
					"a",
					view({ a: answer(true, false) }, [{ id: "a", correct: true }], { a: invalid }),
				),
			).toBe("history");
		}
	});

	it("retains a legacy multiple selection after a single-selection policy edit when the verdict agrees", () => {
		const legacy = { ...answer(false, false), answer: ["a", "b"] };
		expect(restoreChoiceAssessmentState(legacy, factsA).status).toBe("current");
		expect(
			restoreChoiceAssessmentState({ ...legacy, contentSignature: signatureA }, factsA).status,
		).toBe("review");
	});

	it("recovers added distractors through compact option-ID proof, but refuses changed or missing old options", () => {
		const withDistractor: ChoiceAssessmentFacts = {
			question: {
				...question,
				options: [...question.options, { id: "c", materialSignature: `sha256:${"d".repeat(64)}` }],
			},
			signature: "sha256:afa3e412c508c12e3e7492d67ae263b4a30df87893ba38fedd00e8e402963063",
		};
		expect(restoreChoiceAssessmentState(answer(), withDistractor).status).toBe("current");
		expect(
			restoreChoiceAssessmentState(
				answer(),
				factPair({
					...withDistractor.question,
					options: withDistractor.question.options.slice(1),
				}),
			).status,
		).toBe("review");
		expect(
			restoreChoiceAssessmentState(
				answer(),
				factPair({
					...withDistractor.question,
					options: [
						{ ...question.options[0], materialSignature: `sha256:${"e".repeat(64)}` },
						...question.options.slice(1),
					],
				}),
			).status,
		).toBe("review");
		for (const materialProof of [
			{ optionIds: ["a", "a"] },
			{ optionIds: ["a", "missing"] },
			{ optionIds: ["a", "b"], question: question.materialSignature },
			{ optionIds: [1, "b"] },
		]) {
			expect(
				restoreChoiceAssessmentState({ ...answer(), materialProof }, withDistractor).status,
			).toBe("review");
		}
	});

	it("also verifies the archive's full proof before accepting a new distractor", () => {
		const saved = { ...answer(), materialProof: choiceMaterialProof(question) };
		const added = {
			signature: "sha256:afa3e412c508c12e3e7492d67ae263b4a30df87893ba38fedd00e8e402963063",
			question: {
				...question,
				options: [...question.options, { id: "c", materialSignature: `sha256:${"d".repeat(64)}` }],
			},
		};
		expect(restoreChoiceAssessmentState(saved, added).status).toBe("current");
		expect(
			restoreChoiceAssessmentState(
				{
					...saved,
					materialProof: { ...saved.materialProof, question: `sha256:${"f".repeat(64)}` },
				},
				added,
			).status,
		).toBe("review");
	});

	it("prepares a signed write with compact proof and archives stale content exactly once", () => {
		const old = answer();
		const bytes = JSON.stringify(old);
		const next = prepareChoiceAssessmentState(old, draft(), factsB, {
			writtenAt: 123,
		});
		expect(next).toEqual({
			...draft(),
			contentSignature: signatureB,
			materialProof: { optionIds: ["a", "b"] },
			writtenAt: 123,
			history: [old],
		});
		const again = prepareChoiceAssessmentState(next, { ...draft(), answer: ["b"] }, factsB, {
			writtenAt: 124,
		});
		expect(again.history).toEqual([old]);
		expect(JSON.stringify(old)).toBe(bytes);
	});

	it("keeps both selections and verdicts through a same-content retry and shares only repeated proofs", () => {
		const first = answer(false);
		const retry = prepareChoiceAssessmentState(first, { ...draft(), attemptCount: 1 }, factsA, {
			writtenAt: 10,
		});
		const second = prepareChoiceAssessmentState(retry, { ...answer(), attemptCount: 2 }, factsA, {
			writtenAt: 11,
		});
		const third = prepareChoiceAssessmentState(second, { ...draft(), attemptCount: 2 }, factsA, {
			writtenAt: 12,
		});
		expect(third.history).toEqual([
			first,
			{
				...answer(),
				attemptCount: 2,
				materialProof: undefined,
				writtenAt: 11,
			},
		]);
		expect(JSON.parse(JSON.stringify(third.history))).toEqual([
			first,
			{
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				attemptCount: 2,
				checked: true,
				correct: true,
				completed: true,
				interacted: true,
				answer: ["a"],
				contentSignature: signatureA,
				writtenAt: 11,
			},
		]);
		const dependency = view({ a: third }, [row()]);
		expect(choiceDependencyStatus("a", dependency)).toBe("current");
		const added = {
			question: {
				...question,
				options: [...question.options, { id: "c", materialSignature: `sha256:${"d".repeat(64)}` }],
			},
			signature: "sha256:afa3e412c508c12e3e7492d67ae263b4a30df87893ba38fedd00e8e402963063",
		};
		expect(choiceDependencyStatus("a", view({ a: third }, [row()], { a: added }))).toBe("current");
	});

	it("does not add a history entry for a write of the same signed submission", () => {
		const next = prepareChoiceAssessmentState(
			answer(),
			answer(),
			{ ...factsA, question: { ...question, options: [...question.options].reverse() } },
			{ writtenAt: 19 },
		);
		expect(next).toEqual({
			...answer(),
			materialProof: { optionIds: ["a", "b"] },
			writtenAt: 19,
		});
	});

	it("uses the latest reporting row and refuses a missing or contradictory saved submission", () => {
		expect(choiceDependencyStatus("a", view({}, [row()]))).toBe("history");
		expect(choiceDependencyStatus("a", view({ a: answer() }, [row(), row("a", signatureB)]))).toBe(
			"history",
		);
		expect(
			choiceDependencyStatus("a", view({ a: answer() }, [row(), row("a", signatureA, false)])),
		).toBe("history");
		expect(choiceDependencyStatus("a", view({ a: answer() }, []))).toBe("current");
	});

	it("leaves IDs without compiled choice facts outside admission", () => {
		const state = view({ removed: answer() }, [row("removed", signatureB)], {});
		expect(choiceDependencyStatus("removed", state)).toBe("current");
		expect(choiceDependencyStatus("free-response", state)).toBe("current");
	});
});

describe("dormant group material references", () => {
	it("refuses a signed oneOf row witnessing another submitted member", () => {
		const submitted = groupSubmission("oneOf", "signed");
		for (const g of [
			groupState("oneOf", submitted),
			JSON.parse(JSON.stringify(groupState("oneOf", submitted))),
		]) {
			const input = groupView(
				{ a: signedSubmitted, b: signedSubmitted, g },
				[
					row("a"),
					row("b"),
					{ id: "g", contentSignature: submitted.contentSignature, memberIds: ["b"] },
				],
				{ a: factsA, b: factsA },
				{ mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
			);
			expect(choiceDependencyStatus("a", input)).toBe("current");
			expect(choiceDependencyStatus("g", input)).toBe("history");
		}
	});

	it("refuses a signed all row scoring a member outside its full dependency set", () => {
		const submitted = groupSubmission("all", "signed");
		for (const g of [
			groupState("all", submitted),
			JSON.parse(JSON.stringify(groupState("all", submitted))),
		])
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: signedSubmitted, g }, [
						row(),
						{ id: "g", contentSignature: submitted.contentSignature, memberIds: ["missing"] },
					]),
				),
			).toBe("history");
	});

	it("all row witnesses remain scored subsets in signed and unsigned aggregates", () => {
		const submitted: ChoiceGroupSubmission = {
			payload: {
				mode: "all",
				selectedMemberId: null,
				dependencies: [
					["a", signatureA],
					["b", signatureA],
					["reflection", null],
				],
			},
			contentSignature: "sha256:1ee98b4b31ad7f0ef127314c1cf7717834f28643076415c816e27066c8a8dc06",
		};
		for (const captured of [undefined, submitted]) {
			for (const [memberIds, status] of [
				[undefined, "current"],
				[[], "current"],
				[["a"], "current"],
				[["a", "b"], "current"],
				[["missing"], "history"],
				["a", "history"],
			] as const) {
				const input = groupView(
					{
						a: captured ? signedSubmitted : legacySubmitted,
						b: captured ? signedSubmitted : legacySubmitted,
						g: groupState("all", captured),
					},
					[
						{
							id: "g",
							...(captured ? { contentSignature: captured.contentSignature } : {}),
							memberIds,
						},
					] as unknown as ChoiceDependencyView["rows"],
					{ a: factsA, b: factsA },
					{
						mode: "all",
						memberIds: ["a", "b", "reflection"],
						requiredIds: ["a", "b", "reflection"],
					},
				);
				expect(choiceDependencyStatus("g", input)).toBe(status);
			}
		}
	});

	it.each(["signed", "unsigned"] as const)(
		"refuses an all row scoring an optional member without evidence, %s aggregate",
		(format) => {
			const submitted = format === "signed" ? groupSubmission("all", "signed") : undefined;
			const input = groupView(
				{
					a: submitted ? signedSubmitted : legacySubmitted,
					b: undefined,
					g: groupState("all", submitted),
				},
				[
					{
						id: "g",
						...(submitted ? { contentSignature: submitted.contentSignature } : {}),
						memberIds: ["a", "b"],
					},
				],
				{ a: factsA, b: factsA },
				{ mode: "all", memberIds: ["a", "b"], requiredIds: ["a"] },
			);
			expect(choiceDependencyStatus("g", input)).toBe("history");
		},
	);

	it.each([false, true])(
		"a new member answer cannot revive a changed legacy aggregate, viaDraft=%s",
		(viaDraft) => {
			let a: SavedAssessmentState = legacyRetry;
			const status = (
				saved: SavedAssessmentState,
				facts: ChoiceAssessmentFacts,
				contentSignature?: string,
			) =>
				choiceDependencyStatus(
					"g",
					groupView(
						{ a: JSON.parse(JSON.stringify(saved)), g: groupState("all") },
						[{ id: "a", contentSignature, correct: saved.checked }, { id: "g" }],
						{ a: facts },
					),
				);
			expect(status(a, factsA)).toBe("current");
			if (viaDraft)
				a = prepareChoiceAssessmentState(a, { ...legacyRetry, answer: ["a"] }, factsA, {
					writtenAt: 1,
				});
			a = prepareChoiceAssessmentState(a, { ...legacySubmitted, attemptCount: 2 }, factsA, {
				writtenAt: 2,
			});
			expect(status(a, factsA, signatureA)).toBe("current");
			expect(status(a, factsB, signatureA)).toBe("history");
			const repaired = prepareChoiceAssessmentState(
				JSON.parse(JSON.stringify(a)),
				{ ...legacySubmitted, attemptCount: 2 },
				factsB,
				{ writtenAt: 3 },
			);
			expect(
				choiceDependencyStatus(
					"a",
					view({ a: repaired }, [{ id: "a", contentSignature: signatureB, correct: true }], {
						a: factsB,
					}),
				),
			).toBe("current");
			expect(status(repaired, factsB, signatureB)).toBe("history");
		},
	);

	it("direct legacy pending retains compact proof", () => {
		const first = prepareChoiceAssessmentState(
			legacyRetry,
			{ ...legacySubmitted, attemptCount: 2 },
			factsA,
			{ writtenAt: 1 },
		);
		const compatible = prepareChoiceAssessmentState(
			JSON.parse(JSON.stringify(first)),
			{ ...legacySubmitted, attemptCount: 2 },
			addedDistractor,
			{ writtenAt: 2 },
		);
		const input = groupView(
			{ a: JSON.parse(JSON.stringify(compatible)), g: groupState("all") },
			[{ id: "a", contentSignature: addedDistractor.signature, correct: true }, { id: "g" }],
			{ a: addedDistractor },
		);
		expect(choiceDependencyStatus("g", input)).toBe("current");
		expect(choiceDependencyStatus("a", input)).toBe("current");
	});

	it("keeps the signed pending claim when a replaced distractor is removed before resubmission", () => {
		const factsE = factPair({
			...question,
			options: [...question.options, { id: "e", materialSignature: `sha256:${"e".repeat(64)}` }],
		});
		const status = (
			saved: SavedAssessmentState,
			facts: ChoiceAssessmentFacts,
			contentSignature: string,
		) =>
			choiceDependencyStatus(
				"g",
				groupView(
					{ a: JSON.parse(JSON.stringify(saved)), g: groupState("all") },
					[{ id: "a", contentSignature, correct: saved.correct }, { id: "g" }],
					{ a: facts },
				),
			);
		const draftUnderA = prepareChoiceAssessmentState(
			legacyRetry,
			{ ...legacyRetry, answer: ["a"] },
			factsA,
			{ writtenAt: 1 },
		);
		const submittedWithC = prepareChoiceAssessmentState(
			JSON.parse(JSON.stringify(draftUnderA)),
			{ ...legacySubmitted, attemptCount: 2, correct: false, completed: true, answer: ["b"] },
			addedDistractor,
			{ writtenAt: 2 },
		);
		expect(status(submittedWithC, addedDistractor, addedDistractor.signature)).toBe("current");
		expect(status(submittedWithC, factsE, addedDistractor.signature)).toBe("history");
		const resubmittedWithE = prepareChoiceAssessmentState(
			JSON.parse(JSON.stringify(submittedWithC)),
			{ ...legacySubmitted, attemptCount: 2 },
			factsE,
			{ writtenAt: 3 },
		);
		expect(status(resubmittedWithE, factsE, factsE.signature)).toBe("current");
	});

	it("requires current latest evidence independently of a compatible legacy aggregate origin", () => {
		const a = { ...signedSubmitted, contentSignature: signatureB, history: [legacySubmitted] };
		expect(choiceDependencyStatus("g", groupView({ a, g: groupState("all") }, [{ id: "g" }]))).toBe(
			"history",
		);
	});

	it("a compatible signed retry draft cannot replace a missing unsigned aggregate origin", () => {
		const a = {
			...legacyRetry,
			contentSignature: signatureA,
			materialProof: { optionIds: ["a", "b"] },
			history: [signedSubmitted],
		};
		const input = groupView({ a, g: groupState("all") }, [{ id: "g" }]);
		expect(choiceDependencyStatus("a", input)).toBe("current");
		expect(choiceDependencyStatus("g", input)).toBe("history");
	});

	it("rejects an empty oneOf group and a required empty member ID before capturing", () => {
		for (const group of [
			{ mode: "oneOf", memberIds: [], requiredIds: [] },
			{ mode: "all", memberIds: [""], requiredIds: [""] },
		] as const) {
			const input = groupView({}, [{ id: "g" }], {}, group);
			expect(choiceGroupDependencyIds("g", input)).toEqual([]);
			expect(prepareChoiceGroupSubmission("g", input)).toBeNull();
			expect(choiceDependencyStatus("g", input)).toBe("history");
		}
	});
	it.each(["all", "oneOf"] as const)(
		"keeps legacy %s submissions but refuses fresh zero-attempt retries",
		(mode) => {
			for (const submitted of [undefined, groupSubmission(mode, "legacy")]) {
				for (const a of [legacyRetry, legacySubmitted]) {
					const input = groupView(
						{ a, g: groupState(mode, submitted) },
						[{ id: "g", ...(submitted ? { contentSignature: submitted.contentSignature } : {}) }],
						{ a: factsA },
						{ mode, memberIds: ["a"], requiredIds: ["a"] },
					);
					expect(choiceDependencyStatus("g", input)).toBe("current");
				}
				const input = groupView(
					{ a: { ...legacyRetry, attemptCount: 0 }, g: groupState(mode, submitted) },
					[
						{ id: "a", correct: false },
						{ id: "g", ...(submitted ? { contentSignature: submitted.contentSignature } : {}) },
					],
					{ a: factsA },
					{ mode, memberIds: ["a"], requiredIds: ["a"] },
				);
				expect(choiceDependencyStatus("g", input)).toBe("history");
			}
		},
	);

	it.each([
		{ version: 2 },
		{ kind: "other" },
		{ mode: "all" },
		{ completed: "yes" },
		{ selectedMemberId: 3 },
		{ selectedMemberId: "removed" },
	])("defaults instead of trusting an invalid saved selection %j", (invalid) => {
		const input = groupView(
			{
				a: legacySubmitted,
				b: legacySubmitted,
				g: { ...groupState("oneOf", undefined, "b"), ...invalid },
			},
			[{ id: "g", memberIds: ["a"] }],
			{ a: factsA, b: factsA },
			{ mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
		);
		expect(choiceGroupDependencyIds("g", input)).toEqual(["a"]);
		if (invalid.mode === undefined) expect(choiceDependencyStatus("g", input)).toBe("current");
	});
	it.each(["all", "oneOf"] as const)(
		"captures literal %s payloads from submissions, never outer drafts",
		(mode) => {
			for (const [state, material] of [
				[signedSubmitted, "signed"],
				[legacySubmitted, "legacy"],
				[{ ...retryDraft, history: [signedSubmitted] }, "signed"],
				[legacyRetry, "legacy"],
			] as const) {
				const input = groupView(
					{ a: state },
					[],
					{ a: factsA },
					{ mode, memberIds: ["a"], requiredIds: ["a"] },
				);
				const expected = groupSubmission(mode, material);
				expect(prepareChoiceGroupSubmission("g", input)).toEqual(expected);
				expect(choiceGroupSignature(expected.payload)).toBe(groupDigests[mode][material]);
			}
			for (const state of [
				undefined,
				{ ...legacyRetry, attemptCount: 0 },
				{ ...signedSubmitted, contentSignature: signatureB },
			])
				expect(
					prepareChoiceGroupSubmission(
						"g",
						groupView(
							{ a: state },
							[],
							{ a: factsA },
							{ mode, memberIds: ["a"], requiredIds: ["a"] },
						),
					),
				).toBeNull();
		},
	);

	it("captures the full sorted set with required ungraded and private submitted members and non-choice null", () => {
		const group: ChoiceStateGroup = {
			mode: "all",
			memberIds: ["reflection", "b", "a", "optional"],
			requiredIds: ["a", "reflection"],
		};
		const ungraded = { ...factsA, question: { ...question, graded: false } };
		const states = {
			a: signedSubmitted,
			b: { ...legacyRetry, history: [signedSubmitted] },
			optional: { ...legacyRetry, attemptCount: 0, answer: ["a"] },
		};
		const input = groupView(states, [], { a: ungraded, b: factsA, optional: factsA }, group);
		expect(choiceGroupDependencyIds("g", input)).toEqual(["a", "b", "reflection"]);
		const expected: ChoiceGroupSubmission = {
			payload: {
				mode: "all",
				selectedMemberId: null,
				dependencies: [
					["a", signatureA],
					["b", signatureA],
					["reflection", null],
				],
			},
			contentSignature: "sha256:1ee98b4b31ad7f0ef127314c1cf7717834f28643076415c816e27066c8a8dc06",
		};
		expect(prepareChoiceGroupSubmission("g", input)).toEqual(expected);
		expect(choiceGroupSignature(expected.payload)).toBe(expected.contentSignature);
		const saved = { ...states, g: groupState("all", expected) };
		expect(
			choiceDependencyStatus(
				"g",
				groupView(saved, [], { a: ungraded, b: factsA, optional: factsA }, group),
			),
		).toBe("current");
		// A newly submitted optional/private member changes the full set, even with no scored row.
		expect(
			choiceDependencyStatus(
				"g",
				groupView(
					{ ...saved, optional: signedSubmitted },
					[],
					{ a: ungraded, b: factsA, optional: factsA },
					group,
				),
			),
		).toBe("history");
		expect(
			choiceDependencyStatus(
				"g",
				groupView(saved, [], { a: factsB, b: factsA, optional: factsA }, group),
			),
		).toBe("history");
		const rowOnly = groupView(
			{ a: signedSubmitted },
			[{ id: "b" }],
			{ a: factsA },
			{ mode: "all", memberIds: ["b", "a"], requiredIds: ["a"] },
		);
		expect(choiceGroupDependencyIds("g", rowOnly)).toEqual(["a", "b"]);
	});

	it.each(["all", "oneOf"] as const)(
		"retains real unsigned %s aggregate origins through retry, repeated drafts, reload and a delayed group event",
		(mode) => {
			const original = { ...legacySubmitted, answer: ["b"], correct: false, completed: false };
			const originalBytes = JSON.stringify(original);
			const group = { mode, memberIds: ["a"], requiredIds: ["a"] };
			let member: SavedAssessmentState = original;
			let memberRow: ChoiceDependencyView["rows"][number] = { id: "a", correct: false };
			const rows = () => [memberRow, { id: "g", memberIds: ["a"] }];
			const assertCurrent = () =>
				expect(
					choiceDependencyStatus(
						"g",
						groupView({ a: member, g: groupState(mode) }, rows(), { a: factsA }, group),
					),
				).toBe("current");
			assertCurrent();
			member = prepareChoiceAssessmentState(member, legacyRetry, factsA, { writtenAt: 11 });
			expect(member.history).toEqual([original]);
			assertCurrent();
			member = prepareChoiceAssessmentState(member, { ...legacyRetry, answer: ["a"] }, factsA, {
				writtenAt: 12,
			});
			assertCurrent();
			member = JSON.parse(JSON.stringify(member));
			assertCurrent();
			member = prepareChoiceAssessmentState(
				member,
				{ ...legacySubmitted, attemptCount: 2 },
				factsA,
				{ writtenAt: 13 },
			);
			memberRow = { id: "a", contentSignature: signatureA, correct: true };
			assertCurrent();
			expect(member.history?.[0]).toEqual(original);
			expect(JSON.stringify(original)).toBe(originalBytes);
			const changed = { ...member, history: [{ ...original, answer: ["removed"] }] };
			expect(choiceDependencyStatus("a", groupView({ a: changed }, rows()))).toBe("current");
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: changed, g: groupState(mode) }, rows(), { a: factsA }, group),
				),
			).toBe("history");
		},
	);

	it.each(["signed", "legacy"] as const)(
		"keeps a captured %s reference through added-distractor retry and compatible checked resubmission",
		(material) => {
			const submitted = groupSubmission("all", material);
			const snapshotBytes = JSON.stringify(submitted);
			let member = material === "legacy" ? legacySubmitted : signedSubmitted;
			let memberRow: ChoiceDependencyView["rows"][number] = {
				id: "a",
				correct: true,
				...(material === "signed" ? { contentSignature: signatureA } : {}),
			};
			const check = () =>
				expect(
					choiceDependencyStatus(
						"g",
						groupView(
							{ a: member, g: groupState("all", submitted) },
							[memberRow, { id: "g", contentSignature: submitted.contentSignature }],
							{ a: addedDistractor },
						),
					),
				).toBe("current");
			check();
			member = prepareChoiceAssessmentState(member, legacyRetry, addedDistractor, {
				writtenAt: 20,
			});
			check();
			member = prepareChoiceAssessmentState(
				JSON.parse(JSON.stringify(member)),
				legacyRetry,
				addedDistractor,
				{ writtenAt: 21 },
			);
			check();
			member = prepareChoiceAssessmentState(
				member,
				{ ...legacySubmitted, attemptCount: 2 },
				addedDistractor,
				{ writtenAt: 22 },
			);
			memberRow = { id: "a", correct: true, contentSignature: addedDistractor.signature };
			check();
			expect(JSON.stringify(submitted)).toBe(snapshotBytes);
			// The newer full option set cannot vouch for a missing original compact proof.
			if (material === "signed") {
				const missing = { ...member, history: [{ ...signedSubmitted, materialProof: undefined }] };
				expect(
					choiceDependencyStatus(
						"a",
						groupView({ a: missing }, [memberRow], { a: addedDistractor }),
					),
				).toBe("current");
				expect(
					choiceDependencyStatus(
						"g",
						groupView(
							{ a: missing, g: groupState("all", submitted) },
							[{ id: "g", contentSignature: submitted.contentSignature }, memberRow],
							{ a: addedDistractor },
						),
					),
				).toBe("history");
			}
		},
	);

	it("retains explicit erased legacy pending evidence when a checked resubmission replaces it", () => {
		const snapshot = groupSubmission("all", "legacy");
		const next = prepareChoiceAssessmentState(
			legacyRetry,
			{ ...legacySubmitted, attemptCount: 2 },
			factsA,
			{ writtenAt: 30 },
		);
		expect(next.history).toEqual([
			{
				...legacyRetry,
				legacyPending: true,
				contentSignature: signatureA,
				materialProof: { optionIds: ["a", "b"] },
			},
		]);
		for (const submitted of [undefined, snapshot]) {
			const rows = [
				{ id: "g", ...(submitted ? { contentSignature: submitted.contentSignature } : {}) },
				row(),
			];
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: JSON.parse(JSON.stringify(next)), g: groupState("all", submitted) }, rows),
				),
			).toBe("current");
			const missing = { ...next, history: [] };
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: missing, g: groupState("all", submitted) }, rows),
				),
			).toBe("history");
		}
	});

	it.each(["all", "oneOf"] as const)(
		"requires deliberate %s group resubmission after real repair and never falls back A/B/A",
		(mode) => {
			const group = { mode, memberIds: ["a"], requiredIds: ["a"] };
			const old = groupSubmission(mode, "signed");
			const rows = [row(), { id: "g", contentSignature: old.contentSignature }];
			expect(
				choiceDependencyStatus(
					"g",
					groupView(
						{ a: signedSubmitted, g: groupState(mode, old) },
						rows,
						{ a: repairedFacts },
						group,
					),
				),
			).toBe("history");
			const repaired = prepareChoiceAssessmentState(
				signedSubmitted,
				{ ...legacySubmitted, answer: ["b"] },
				repairedFacts,
				{ writtenAt: 40 },
			);
			const memberRow = { id: "a", contentSignature: repairedFacts.signature, correct: true };
			const input = groupView(
				{ a: repaired, g: groupState(mode, old) },
				[memberRow, rows[1]],
				{ a: repairedFacts },
				group,
			);
			expect(choiceDependencyStatus("a", input)).toBe("current");
			expect(choiceDependencyStatus("g", input)).toBe("history");
			const expected = groupSubmission(mode, "repaired");
			expect(prepareChoiceGroupSubmission("g", input)).toEqual(expected);
			expect(
				choiceDependencyStatus(
					"g",
					groupView(
						{ a: repaired, g: groupState(mode, expected) },
						[memberRow, { id: "g", contentSignature: expected.contentSignature }],
						{ a: repairedFacts },
						group,
					),
				),
			).toBe("current");
			const changed = groupSubmission(mode, "changed");
			const reverted = {
				...signedSubmitted,
				history: [{ ...signedSubmitted, contentSignature: signatureB }],
			};
			const g = { ...groupState(mode, changed), history: [groupState(mode, old)] };
			expect(
				choiceDependencyStatus(
					"g",
					groupView(
						{ a: reverted, g },
						[
							row(),
							{ id: "g", contentSignature: old.contentSignature },
							{ id: "g", contentSignature: changed.contentSignature },
						],
						{ a: factsA },
						group,
					),
				),
			).toBe("history");
		},
	);

	it("oneOf uses validated saved selection or the first-member default, and ignores unselected history", () => {
		const group: ChoiceStateGroup = {
			mode: "oneOf",
			memberIds: ["a", "b"],
			requiredIds: ["a", "b"],
		};
		for (const g of [
			undefined,
			groupState("oneOf"),
			{ ...groupState("oneOf"), selectedMemberId: "removed" },
			{ ...groupState("oneOf", undefined, "b"), version: 2 },
		]) {
			const input = groupView(
				{ a: legacySubmitted, b: { ...signedSubmitted, contentSignature: signatureB }, g },
				[{ id: "g", memberIds: ["a"] }],
				{ a: factsA, b: factsA },
				group,
			);
			expect(choiceGroupDependencyIds("g", input)).toEqual(["a"]);
			expect(choiceDependencyStatus("g", input)).toBe("current");
		}
		const bSnapshot: ChoiceGroupSubmission = {
			payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["b", signatureA]] },
			contentSignature: "sha256:da91b6029d6dc99307995b21dff3bdb3d72934a70bff2dccba4935653b81e612",
		};
		const selected = groupView(
			{
				a: { ...signedSubmitted, contentSignature: signatureB },
				b: signedSubmitted,
				g: groupState("oneOf", bSnapshot, "b"),
			},
			[],
			{ a: factsA, b: factsA },
			group,
		);
		expect(choiceGroupDependencyIds("g", selected)).toEqual(["b"]);
		expect(choiceDependencyStatus("g", selected)).toBe("current");
		expect(prepareChoiceGroupSubmission("g", selected)).toEqual(bSnapshot);
		expect(
			choiceDependencyStatus(
				"g",
				groupView(
					{ a: signedSubmitted, b: signedSubmitted, g: groupState("oneOf", bSnapshot, "a") },
					[],
					{ a: factsA, b: factsA },
					group,
				),
			),
		).toBe("history");
	});

	it("honours a witnessed legacy oneOf selection even with completed false or absent state", () => {
		const group: ChoiceStateGroup = {
			mode: "oneOf",
			memberIds: ["a", "b"],
			requiredIds: ["a", "b"],
		};
		for (const g of [undefined, groupState("oneOf"), groupState("oneOf", undefined, "a", true)]) {
			for (const [memberIds, expected] of [
				[["a"], "current"],
				[["b"], "history"],
				[[], "history"],
				[["a", "b"], "history"],
				["a", "history"],
			] as const) {
				const rows = [{ id: "g", memberIds }] as unknown as ChoiceDependencyView["rows"];
				expect(
					choiceDependencyStatus(
						"g",
						groupView(
							{ a: legacySubmitted, b: legacySubmitted, g },
							rows,
							{ a: factsA, b: factsA },
							group,
						),
					),
				).toBe(expected);
			}
		}
	});

	it("pins the byte-identical unwitnessed legacy oneOf retry/reselection exception for ungraded members", () => {
		const group: ChoiceStateGroup = {
			mode: "oneOf",
			memberIds: ["a", "b"],
			requiredIds: ["a", "b"],
		};
		const ungraded = { ...factsA, question: { ...question, graded: false } };
		const retryBytes =
			'{"version":1,"kind":"assessmentGroup","mode":"oneOf","selectedMemberId":"b","completed":false}';
		const reselectionBytes =
			'{"version":1,"kind":"assessmentGroup","mode":"oneOf","selectedMemberId":"b","completed":false}';
		// assessment-group-runtime.ts onChange and onSubmit can persist these same legacy bytes.
		for (const g of [
			undefined,
			groupState("oneOf"),
			JSON.parse(retryBytes),
			JSON.parse(reselectionBytes),
		])
			expect(
				choiceDependencyStatus(
					"g",
					groupView(
						{ a: legacySubmitted, b: legacySubmitted, g },
						[{ id: "g" }],
						{ a: ungraded, b: ungraded },
						group,
					),
				),
			).toBe("current");
	});

	it("all legacy scored memberIds never replace the full dependencies", () => {
		const group: ChoiceStateGroup = { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] };
		const ungraded = { ...factsA, question: { ...question, graded: false } };
		const states = {
			a: legacySubmitted,
			b: { ...legacySubmitted, answer: ["removed"] },
			g: groupState("all"),
		};
		const input = groupView(
			states,
			[{ id: "g", memberIds: ["a"] }],
			{ a: factsA, b: ungraded },
			group,
		);
		expect(choiceGroupDependencyIds("g", input)).toEqual(["a", "b"]);
		expect(choiceDependencyStatus("g", input)).toBe("history");
	});

	it("requires both the retained original reference and latest evidence, with no backwards search", () => {
		const submitted = groupSubmission("all", "signed");
		const badLatest = {
			...signedSubmitted,
			contentSignature: signatureB,
			history: [signedSubmitted],
		};
		expect(
			choiceDependencyStatus(
				"g",
				groupView({ a: badLatest, g: groupState("all", submitted) }, [
					{ id: "g", contentSignature: submitted.contentSignature },
				]),
			),
		).toBe("history");
		const newest = {
			...signedSubmitted,
			history: [legacySubmitted, { ...legacySubmitted, answer: ["removed"] }],
		};
		// The first original is the legacy aggregate's origin; later legacy history cannot replace it.
		expect(
			choiceDependencyStatus("g", groupView({ a: newest, g: groupState("all") }, [{ id: "g" }])),
		).toBe("current");
		const badOrigin = {
			...signedSubmitted,
			history: [{ ...legacySubmitted, answer: ["removed"] }, legacySubmitted],
		};
		expect(
			choiceDependencyStatus("g", groupView({ a: badOrigin, g: groupState("all") }, [{ id: "g" }])),
		).toBe("history");
		// A draft with positive attempts does not supply a missing signed reference.
		expect(
			choiceDependencyStatus(
				"g",
				groupView({ a: legacyRetry, g: groupState("all", submitted) }, [
					{ id: "g", contentSignature: submitted.contentSignature },
				]),
			),
		).toBe("history");
	});

	it("resolves old incorrect references in their own context, shares compact proof after JSON, and archives direct submissions", () => {
		const original = { ...signedSubmitted, correct: false, completed: false, answer: ["b"] };
		const second = prepareChoiceAssessmentState(
			original,
			{ ...legacySubmitted, attemptCount: 2 },
			factsA,
			{ writtenAt: 51 },
		);
		expect(second.history).toEqual([original]);
		const third = prepareChoiceAssessmentState(
			second,
			{ ...legacyRetry, attemptCount: 2 },
			factsA,
			{ writtenAt: 52 },
		);
		const shared = JSON.parse(JSON.stringify(third));
		expect(shared.history).toEqual([
			original,
			{
				...legacySubmitted,
				attemptCount: 2,
				contentSignature: signatureA,
				writtenAt: 51,
			},
		]);
		const snapshot = groupSubmission("all", "signed");
		expect(
			choiceDependencyStatus(
				"g",
				groupView(
					{ a: shared, g: groupState("all", snapshot) },
					[row(), { id: "g", contentSignature: snapshot.contentSignature }],
					{ a: addedDistractor },
				),
			),
		).toBe("current");
	});

	it("does not treat editable group selection as a submitted aggregate", () => {
		for (const mode of ["all", "oneOf"] as const)
			expect(
				choiceDependencyStatus(
					"g",
					groupView(
						{ a: signedSubmitted, g: groupState(mode) },
						[],
						{ a: factsA },
						{ mode, memberIds: ["a"], requiredIds: ["a"] },
					),
				),
			).toBe("unanswered");
	});

	const malformedPayloads: { name: string; payload: unknown }[] = [
		{
			name: "array-like dependencies",
			payload: { mode: "all", selectedMemberId: null, dependencies: { 0: ["a", null], length: 1 } },
		},
		{
			name: "array-like pair",
			payload: {
				mode: "all",
				selectedMemberId: null,
				dependencies: [{ 0: "a", 1: null, length: 2 }],
			},
		},
		{
			name: "unknown mode with a valid oneOf selection",
			payload: { mode: "unknown", selectedMemberId: "a", dependencies: [["a", null]] },
		},
		{ name: "not an object", payload: null },
		{
			name: "not a dependency list",
			payload: { mode: "all", selectedMemberId: null, dependencies: "a" },
		},
		{
			name: "empty dependencies",
			payload: { mode: "all", selectedMemberId: null, dependencies: [] },
		},
		{ name: "not a pair", payload: { mode: "all", selectedMemberId: null, dependencies: ["a"] } },
		{
			name: "long pair",
			payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null, null]] },
		},
		{
			name: "empty ID",
			payload: { mode: "all", selectedMemberId: null, dependencies: [["", null]] },
		},
		{
			name: "non-string ID",
			payload: { mode: "all", selectedMemberId: null, dependencies: [[1, null]] },
		},
		{
			name: "duplicate ID",
			payload: {
				mode: "all",
				selectedMemberId: null,
				dependencies: [
					["a", null],
					["a", null],
				],
			},
		},
		{
			name: "unsorted IDs",
			payload: {
				mode: "all",
				selectedMemberId: null,
				dependencies: [
					["b", null],
					["a", null],
				],
			},
		},
		{
			name: "invalid reference",
			payload: { mode: "all", selectedMemberId: null, dependencies: [["a", "bad"]] },
		},
		{
			name: "unknown mode",
			payload: { mode: "unknown", selectedMemberId: null, dependencies: [["a", null]] },
		},
		{
			name: "all selection",
			payload: { mode: "all", selectedMemberId: "a", dependencies: [["a", null]] },
		},
		{
			name: "oneOf multiple dependencies",
			payload: {
				mode: "oneOf",
				selectedMemberId: "a",
				dependencies: [
					["a", null],
					["b", null],
				],
			},
		},
		{
			name: "oneOf mismatched selection",
			payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["a", null]] },
		},
	];
	it.each(malformedPayloads)("refuses malformed captured payload: $name", ({ payload }) => {
		expect(() => choiceGroupSignature(payload as ChoiceGroupPayload)).toThrow(TypeError);
		const submitted = { ...groupSubmission("all", "signed"), payload };
		expect(
			choiceDependencyStatus(
				"g",
				groupView({ a: signedSubmitted, g: { ...groupState("all"), submitted } }, [
					{ id: "g", contentSignature: groupDigests.all.signed },
				]),
			),
		).toBe("history");
	});

	it.each([
		{ name: "self-cycle", group: { mode: "all", memberIds: ["g"], requiredIds: ["g"] } },
		{ name: "empty group", group: { mode: "all", memberIds: [], requiredIds: [] } },
		{ name: "duplicate member", group: { mode: "all", memberIds: ["a", "a"], requiredIds: ["a"] } },
		{
			name: "foreign requirement",
			group: { mode: "all", memberIds: ["a"], requiredIds: ["missing"] },
		},
		{ name: "empty member ID", group: { mode: "all", memberIds: [""], requiredIds: [] } },
		{ name: "invalid mode", group: { mode: "other", memberIds: ["a"], requiredIds: ["a"] } },
	])("refuses invalid group facts: $name", ({ group }) => {
		const input = groupView(
			{ a: signedSubmitted, g: groupState("all") },
			[{ id: "g" }],
			{ a: factsA },
			group as ChoiceStateGroup,
		);
		expect(choiceGroupDependencyIds("g", input)).toEqual([]);
		expect(prepareChoiceGroupSubmission("g", input)).toBeNull();
		expect(choiceDependencyStatus("g", input)).toBe("history");
	});

	it("refuses nested group cycles and refuses a non-choice member claiming choice material", () => {
		const input = groupView(
			{},
			[{ id: "g" }],
			{},
			{ mode: "all", memberIds: ["other"], requiredIds: ["other"] },
		);
		input.groups = {
			...input.groups,
			other: { mode: "all", memberIds: ["g"], requiredIds: ["g"] },
		};
		expect(choiceDependencyStatus("g", input)).toBe("history");
		expect(prepareChoiceGroupSubmission("g", input)).toBeNull();
		const submitted = groupSubmission("all", "signed");
		expect(
			choiceDependencyStatus("g", groupView({ g: groupState("all", submitted) }, [], {})),
		).toBe("history");
	});

	it("refuses signed aggregates with missing or contradictory rows, invalid envelopes, mismatched modes, sets or digests", () => {
		const submitted = groupSubmission("all", "signed");
		for (const g of [
			undefined,
			groupState("all"),
			{ ...groupState("all", submitted), version: 2 },
			{ ...groupState("all", submitted), kind: "assessment" },
			{ ...groupState("all", submitted), completed: "yes" },
			groupState("oneOf", submitted),
			{ ...groupState("all"), submitted: null },
			groupState("all", { ...submitted, contentSignature: signatureB }),
		]) {
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: signedSubmitted, g }, [
						{ id: "g", contentSignature: submitted.contentSignature },
					]),
				),
			).toBe("history");
		}
		for (const contentSignature of [undefined, groupDigests.all.changed])
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: signedSubmitted, g: groupState("all", submitted) }, [
						{ id: "g", contentSignature },
					]),
				),
			).toBe("history");
		const oneOf = groupSubmission("oneOf", "signed");
		expect(
			choiceDependencyStatus(
				"g",
				groupView({ a: signedSubmitted, g: groupState("all", oneOf) }, [
					{ id: "g", contentSignature: oneOf.contentSignature },
				]),
			),
		).toBe("history");
		expect(
			choiceDependencyStatus(
				"g",
				groupView({ a: signedSubmitted, g: groupState("oneOf") }, [{ id: "g" }]),
			),
		).toBe("history");
		const extra = { mode: "all", memberIds: ["a", "b"], requiredIds: ["a", "b"] } as const;
		expect(
			choiceDependencyStatus(
				"g",
				groupView(
					{ a: signedSubmitted, b: signedSubmitted, g: groupState("all", submitted) },
					[],
					{ a: factsA, b: factsA },
					extra,
				),
			),
		).toBe("history");
		for (const badRow of [
			{ id: "a", contentSignature: signatureB, correct: true },
			{ id: "a", contentSignature: signatureA, correct: false },
		])
			expect(
				choiceDependencyStatus(
					"g",
					groupView({ a: signedSubmitted, g: groupState("all", submitted) }, [
						badRow,
						{ id: "g", contentSignature: submitted.contentSignature },
					]),
				),
			).toBe("history");
	});
});
