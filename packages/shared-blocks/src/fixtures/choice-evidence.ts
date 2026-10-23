import { choiceContentSignature, choiceStateQuestion } from "../assessment-choice";
import type {
	ChoiceDependencyView,
	ChoiceGroupSubmission,
	ChoiceStateGroup,
} from "../choice-learner-state";
import {
	type ChoiceAssessmentFacts,
	type ChoiceStateQuestion,
	choiceMaterialProof,
	choiceProofSignature,
} from "../choice-state-facts";
import type { SavedAssessmentState } from "../learner-state";
import type { AssessmentBlockData } from "../types";

// Independent SHA-256 literals for version-3 question payloads.
export const signatureA = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
export const signatureB = "sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702";
export const question: ChoiceStateQuestion = {
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
export const factsA: ChoiceAssessmentFacts = { question, signature: signatureA };
export const factsB: ChoiceAssessmentFacts = {
	question: { ...question, materialSignature: `sha256:${"d".repeat(64)}` },
	signature: signatureB,
};
export const repairedFacts: ChoiceAssessmentFacts = {
	question: {
		...question,
		materialSignature: `sha256:${"f".repeat(64)}`,
		correctAnswerSignature:
			"sha256:a8950f05d3443e7921e7ec6fbe06c8febe40966a5db58b15f767a995d561290b",
	},
	signature: "sha256:5c2b122cba5f1eb15ccabd6efddce1542fdbcf510e411f0b803e1d367b3929fa",
};
// Literal state written before signatures/history existed, including Try again's empty draft.
export const legacySubmitted: SavedAssessmentState = {
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
export const legacyRetry: SavedAssessmentState = {
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
export const signedSubmitted: SavedAssessmentState = {
	...legacySubmitted,
	contentSignature: signatureA,
	materialProof: { optionIds: ["a", "b"] },
	writtenAt: 10,
	legacyBuildRevision: "original-build",
};
export const retryDraft = {
	...legacyRetry,
	contentSignature: signatureB,
	materialProof: { optionIds: ["a", "b"] },
};
export const addedDistractor: ChoiceAssessmentFacts = {
	question: {
		...question,
		options: [...question.options, { id: "c", materialSignature: `sha256:${"d".repeat(64)}` }],
	},
	signature: "sha256:afa3e412c508c12e3e7492d67ae263b4a30df87893ba38fedd00e8e402963063",
};

export function factPair(question: ChoiceStateQuestion): ChoiceAssessmentFacts {
	return { question, signature: choiceProofSignature(choiceMaterialProof(question)) };
}

export function answer(correct = true, signed = true): SavedAssessmentState {
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
export const draft = (): SavedAssessmentState => ({
	...answer(),
	checked: false,
	correct: false,
	completed: false,
	attemptCount: 0,
	answer: [],
});
export const row = (id = "a", contentSignature = signatureA, correct = true) => ({
	id,
	contentSignature,
	correct,
});

export function view(
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
export const groupDigests = {
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

export function groupSubmission(
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

export function groupState(
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

export function groupView(
	states: Record<string, unknown>,
	rows: ChoiceDependencyView["rows"],
	facts: Record<string, ChoiceAssessmentFacts> = { a: factsA },
	group: ChoiceStateGroup = { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
): ChoiceDependencyView {
	return { ...view(states, rows, facts), groups: { g: group } };
}

export const memberCases = [
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

export const groupTable = [
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

/** The domain table's literal statuses also drive each activated consumer. */
export function choiceEvidenceCases() {
	const cases: {
		name: string;
		id: string;
		status: "current" | "unanswered" | "history";
		view: ChoiceDependencyView;
	}[] = [];
	for (const member of memberCases) {
		for (const privateState of [false, true])
			cases.push({
				name: `member ${member.name}, private ${privateState}`,
				id: "a",
				status: member.status as "current" | "unanswered" | "history",
				view: view({ a: member.state }, !privateState && member.row ? [member.row] : [], {
					a: member.facts,
				}),
			});
	}
	for (const mode of ["all", "oneOf"] as const)
		for (const { member, material, statuses } of groupTable)
			for (const [column, status] of statuses.entries())
				for (const staleReference of column === 3 ? [false, true] : [false])
					for (const completed of [false, true])
						for (const privateState of [false, true]) {
							const matching = groupSubmission(mode, material);
							const submitted =
								column < 2
									? undefined
									: column === 2
										? matching
										: staleReference
											? groupSubmission(mode, "changed")
											: { ...matching, contentSignature: signatureB };
							const rows = [
								...(!privateState && member.row ? [member.row] : []),
								...(column === 0
									? []
									: [
											{
												id: "g",
												...(submitted ? { contentSignature: submitted.contentSignature } : {}),
											},
										]),
							];
							cases.push({
								name: `${mode} ${member.name}, column ${column}, stale ${staleReference}, completed ${completed}, private ${privateState}`,
								id: "g",
								status,
								view: groupView(
									JSON.parse(
										JSON.stringify({
											a: member.state,
											g: column === 0 ? undefined : groupState(mode, submitted, "a", completed),
										}),
									),
									rows,
									{ a: member.facts },
									{ mode, memberIds: ["a"], requiredIds: ["a"] },
								),
							});
						}
	return [...cases, ...materialHistoryCases(), ...groupRegressionCases()];
}

export function groupRegressionCases() {
	const required = { mode: "all" as const, memberIds: ["a", "b"], requiredIds: ["a", "b"] };
	const ungraded = { ...factsB, question: { ...factsB.question, graded: false } };
	return [
		{
			name: "A passes, B aggregate passes, A incorrect before its aggregate event",
			id: "g",
			status: "history" as const,
			view: groupView(
				{
					a: {
						...signedSubmitted,
						answer: ["b"],
						correct: false,
						completed: true,
						attemptCount: 2,
					},
					b: signedSubmitted,
					g: {
						...groupState("oneOf", undefined, "a"),
						submitted: {
							payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["b", signatureA]] },
							contentSignature:
								"sha256:da91b6029d6dc99307995b21dff3bdb3d72934a70bff2dccba4935653b81e612",
						},
					},
				},
				[
					row("b"),
					{
						id: "g",
						contentSignature:
							"sha256:da91b6029d6dc99307995b21dff3bdb3d72934a70bff2dccba4935653b81e612",
						correct: true,
						memberIds: ["b"],
					},
					row("a", signatureA, false),
				],
				{ a: factsA, b: factsA },
				{ mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
			),
		},
		{
			name: "same-content member retry is newer than its signed aggregate",
			id: "g",
			status: "current" as const,
			view: groupView(
				{
					a: {
						...signedSubmitted,
						answer: ["b"],
						correct: false,
						attemptCount: 2,
						completed: true,
					},
					g: groupState("all", groupSubmission("all", "signed")),
				},
				[
					{ id: "g", contentSignature: groupDigests.all.signed, correct: true, memberIds: ["a"] },
					row("a", signatureA, false),
				],
			),
		},
		{
			name: "all required ungraded material changed, scored witness is only a",
			id: "g",
			status: "history" as const,
			view: groupView(
				{ a: signedSubmitted, b: signedSubmitted, g: groupState("all") },
				[
					row("a"),
					{ id: "b", contentSignature: signatureA },
					{ id: "g", correct: true, memberIds: ["a"] },
				],
				{ a: factsA, b: ungraded },
				required,
			),
		},
		{
			name: "oneOf B pending, A aggregate passed, A changed, reselect B without submitting",
			id: "g",
			status: "history" as const,
			view: groupView(
				{
					a: signedSubmitted,
					b: { ...legacySubmitted, answer: ["b"], correct: false, completed: false },
					g: groupState("oneOf", undefined, "b"),
				},
				[
					{ id: "b", correct: false },
					{ id: "g", correct: true, memberIds: ["a"] },
				],
				{ a: factsB, b: factsA },
				{ mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
			),
		},
		{
			name: "all optional private submitted material changed",
			id: "g",
			status: "history" as const,
			view: groupView(
				{ a: signedSubmitted, b: signedSubmitted, g: groupState("all") },
				[row("a"), { id: "g", correct: true, memberIds: ["a"] }],
				{ a: factsA, b: factsB },
				{ mode: "all", memberIds: ["a", "b"], requiredIds: ["a"] },
			),
		},
		{
			name: "all non-choice required member uses base null evidence",
			id: "g",
			status: "current" as const,
			view: groupView(
				{ g: groupState("all", groupSubmission("all", "legacy")) },
				[{ id: "g", contentSignature: groupDigests.all.legacy }],
				{},
				{ mode: "all", memberIds: ["a"], requiredIds: ["a"] },
			),
		},
	];
}

export function materialHistoryCases() {
	const edits = [
		["video source", '<video src="safe.mp4"></video>', '<video src="changed.mp4"></video>'],
		["audio source", '<audio src="safe.mp3"></audio>', '<audio src="changed.mp3"></audio>'],
		["ordered list start", '<ol start="1"><li>Stop</li></ol>', '<ol start="2"><li>Stop</li></ol>'],
		[
			"link association",
			'<a href="procedure.html">Stop</a> Go',
			'Stop <a href="procedure.html">Go</a>',
		],
		[
			"aria-hidden association",
			'<span aria-hidden="true">Stop</span><span>Go</span>',
			'<span>Stop</span><span aria-hidden="true">Go</span>',
		],
		["superscript", "Move 2", "Move <sup>2</sup>"],
		["subscript", "Move 2", "Move <sub>2</sub>"],
		["deleted text", "Move Stop", "Move <del>Stop</del>"],
	] as const;
	const data = (content: string): AssessmentBlockData => ({
		assessmentType: "choice",
		gradingMode: "exact",
		attempts: 1,
		feedback: {},
		stem: [{ id: "stem", type: "text", data: { content } }],
		response: {
			type: "choice",
			inputMethod: "click",
			display: "list",
			shuffle: false,
			selectionMode: "single",
			options: [
				{ id: "stop", label: "Stop", isCorrect: true },
				{ id: "go", label: "Go" },
			],
		},
	});
	return edits.map(([name, before, after]) => {
		const oldSignature = choiceContentSignature(data(before), false);
		const changed = {
			question: choiceStateQuestion(data(after), false),
			signature: choiceContentSignature(data(after), false),
		};
		const saved = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			answer: ["stop"],
			checked: true,
			correct: true,
			completed: true,
			interacted: true,
			attemptCount: 1,
			contentSignature: oldSignature,
		};
		return {
			name: `material change ${name}`,
			id: "a",
			status: "history" as const,
			view: view({ a: saved }, [{ id: "a", correct: true, contentSignature: oldSignature }], {
				a: changed,
			}),
		};
	});
}
