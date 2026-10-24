import { DONT_KNOW } from "learning-patterns/patterns/dont-know/logic.js";
import {
	type AdmittedChoiceStateFacts,
	type ChoiceAssessmentFacts,
	type ChoiceStateGroup,
	type ChoiceStateQuestion,
	choiceAnswerSignature,
	choiceGroupFactsAreValid,
	choiceMaterialSignature,
	isChoiceAssessmentFacts,
} from "./choice-state-facts";

import type { LearnerStateValue, SavedAssessmentState } from "./learner-state";
import { choiceEvidenceSignature, isChoiceContentSignature } from "./learner-state";

export type { ChoiceStateGroup } from "./choice-state-facts";

function validChoiceIds(question: ChoiceStateQuestion, answer: unknown): answer is string[] {
	const ids = new Set(question.options.map((option) => option.id));
	if (question.dontKnow) ids.add(DONT_KNOW);
	return (
		Array.isArray(answer) &&
		Array.from(answer).every((id) => typeof id === "string" && ids.has(id)) &&
		new Set(answer).size === answer.length
	);
}

/** Saved data is admitted here; restore and dependency status use the same decision. */
function admitChoiceAssessmentState(
	value: unknown,
	facts: ChoiceAssessmentFacts,
): SavedAssessmentState | null {
	const { question } = facts;
	if (
		!isChoiceAssessmentFacts(facts) ||
		!isRecord(value) ||
		value.version !== 1 ||
		value.kind !== "assessment" ||
		value.assessmentType !== "choice" ||
		!isCounter(value.attemptCount) ||
		typeof value.checked !== "boolean" ||
		typeof value.correct !== "boolean" ||
		typeof value.completed !== "boolean" ||
		typeof value.interacted !== "boolean" ||
		!validChoiceIds(question, value.answer)
	)
		return null;
	if (value.reviewedChoiceIds !== undefined && !validChoiceIds(question, value.reviewedChoiceIds))
		return null;
	const signed = value.contentSignature !== undefined;
	if (question.selectionMode === "single" && value.answer.length > 1) return null;
	// Only a never-submitted draft can omit material evidence.
	if (
		(signed || hasSubmittedChoice(value)) &&
		value.contentSignature !== choiceEvidenceSignature(facts.signature)
	)
		return null;
	if (
		!value.checked &&
		value.attemptCount > 0 &&
		!(
			Array.isArray(value.history) &&
			value.history.some((entry) => isRecord(entry) && entry.checked === true)
		)
	)
		return null;
	if (value.checked && (!value.answer.length || value.attemptCount === 0)) return null;
	const correct =
		value.checked &&
		question.canAutoScore &&
		choiceAnswerSignature(value.answer) === question.correctAnswerSignature;
	const maxAttempts = question.maxAttempts || Infinity;
	const completed =
		value.checked &&
		(!question.canAutoScore || correct || (value.attemptCount as number) >= maxAttempts);
	if (
		value.correct !== correct ||
		(signed && (value.completed !== completed || (value.attemptCount as number) > maxAttempts))
	)
		return null;
	return { ...value, correct, completed } as unknown as SavedAssessmentState;
}

export function restoreChoiceAssessmentState(
	value: unknown,
	facts: ChoiceAssessmentFacts,
): {
	status: "empty" | "current" | "review";
	current: SavedAssessmentState | null;
	history: LearnerStateValue[];
} {
	if (value === undefined) return { status: "empty", current: null, history: [] };
	const history =
		isRecord(value) && Array.isArray(value.history) ? (value.history as LearnerStateValue[]) : [];
	const current = admitChoiceAssessmentState(value, facts);
	if (current) return { status: "current", current, history };
	if (isRecord(value) && value.checked !== true) return { status: "empty", current: null, history };
	const { history: _history, ...previous } = isRecord(value) ? value : {};
	return {
		status: "review",
		current: null,
		history: [...history, (isRecord(value) ? previous : value) as LearnerStateValue],
	};
}

/** Only a deliberate write can sign state or archive a preceding submitted answer. */
export function prepareChoiceAssessmentState(
	previous: unknown,
	next: SavedAssessmentState,
	facts: ChoiceAssessmentFacts,
	write: { writtenAt: number },
): SavedAssessmentState {
	if (!isChoiceAssessmentFacts(facts)) throw new TypeError("Invalid compiled choice facts");
	const restored = restoreChoiceAssessmentState(previous, facts);
	const history = [...restored.history];
	const prior = restored.current;
	if (prior?.checked && (!next.checked || next.attemptCount !== prior.attemptCount)) {
		// Preserve the submitted answer and verdict before editing the next attempt.
		const { history: _history, ...attempt } = previous as SavedAssessmentState;
		history.push(attempt as unknown as LearnerStateValue);
	}
	return {
		...next,
		contentSignature: choiceEvidenceSignature(facts.signature),
		writtenAt: write.writtenAt,
		...(history.length ? { history } : {}),
	};
}

export interface ChoiceDependencyView {
	invalidIds?: readonly string[];
	rows: readonly {
		id: string;
		contentSignature?: string;
		correct?: boolean;
		memberIds?: readonly string[];
		choiceEvidenceInvalid?: true;
	}[];
	questions: Readonly<Record<string, ChoiceStateQuestion>>;
	signatures: Readonly<Record<string, string>>;
	groups?: Readonly<Record<string, ChoiceStateGroup>>;
	readState: (id: string) => unknown;
}

/** Readers receive the status owner with the evidence, without importing admission code. */
export interface ChoiceDependencyEvidence extends ChoiceDependencyView {
	status(id: string, candidate?: ChoiceDependencyView): ReturnType<typeof choiceDependencyStatus>;
	/** Group consumers use the owner without loading dormant admission into ordinary bundles. */
	prepareGroupSubmission?(
		id: string,
		candidate: ChoiceDependencyView,
	): ChoiceGroupSubmission | null;
	prepareGroupState?(
		previous: LearnerStateValue | undefined,
		draft: Record<string, LearnerStateValue>,
		submitted?: ChoiceGroupSubmission,
	): LearnerStateValue | null;
	verifyGroupSubmission?(
		id: string,
		input: Record<string, unknown>,
		row: Pick<ChoiceDependencyView["rows"][number], "correct" | "memberIds">,
	): ChoiceDependencyEvidence | null;
}

/** Bind dormant group operations beside the status owner, outside ordinary consumer bundles. */
export function bindChoiceDependencyView(view: ChoiceDependencyView): ChoiceDependencyEvidence {
	const bound: ChoiceDependencyEvidence = {
		...view,
		status: (id, candidate = bound) => choiceDependencyStatus(id, candidate),
		prepareGroupSubmission: prepareChoiceGroupSubmission,
		prepareGroupState: prepareChoiceGroupState,
		verifyGroupSubmission: (id, input, row) => {
			const group = view.groups?.[id];
			const state = {
				version: 1,
				kind: "assessmentGroup",
				mode: group?.mode,
				selectedMemberId: group?.mode === "oneOf" ? input.selectedMemberId : null,
				completed: input.completed === true,
			};
			const selected = {
				...view,
				readState: (member: string) => (member === id ? state : view.readState(member)),
			};
			const submitted = prepareChoiceGroupSubmission(id, selected);
			if (!submitted || submitted.contentSignature !== input.contentSignature) return null;
			return bindChoiceDependencyView({
				...view,
				rows: [...view.rows, { ...row, id, contentSignature: submitted.contentSignature }],
				readState: (member) => (member === id ? { ...state, submitted } : view.readState(member)),
			});
		},
	};
	return bound;
}

function prepareChoiceGroupState(
	previous: LearnerStateValue | undefined,
	draft: Record<string, LearnerStateValue>,
	submitted?: ChoiceGroupSubmission,
): LearnerStateValue | null {
	const retained =
		previous && typeof previous === "object" && !Array.isArray(previous)
			? previous.submitted
			: undefined;
	const snapshot = submitted
		? {
				payload: {
					mode: submitted.payload.mode,
					selectedMemberId: submitted.payload.selectedMemberId,
					dependencies: submitted.payload.dependencies,
				},
				contentSignature: submitted.contentSignature,
			}
		: retained;
	const next = { ...draft, ...(snapshot !== undefined ? { submitted: snapshot } : {}) };
	return snapshot !== undefined && JSON.stringify(previous) === JSON.stringify(next) ? null : next;
}

/** One context for future readers; construction never admits, signs or writes an answer. */
export function createChoiceDependencyView(
	facts: AdmittedChoiceStateFacts,
	evidence: {
		rows: ChoiceDependencyView["rows"];
		readState: ChoiceDependencyView["readState"];
	},
): ChoiceDependencyEvidence {
	if (facts.choiceStateInvalidIds.includes("*")) throw new Error("Invalid choice facts");
	return bindChoiceDependencyView({
		invalidIds: facts.choiceStateInvalidIds,
		rows: evidence.rows,
		questions: facts.choiceStateQuestions,
		signatures: facts.choiceStateSignatures,
		...(facts.choiceStateGroups ? { groups: facts.choiceStateGroups } : {}),
		readState: evidence.readState,
	});
}

/** References retained member material, never copies of answers or editable selection. */
export interface ChoiceGroupPayload {
	mode: "all" | "oneOf";
	selectedMemberId: string | null;
	dependencies: [string, string | null][];
}

export interface ChoiceGroupSubmission {
	payload: ChoiceGroupPayload;
	contentSignature: string;
}

function latestChoiceRow(id: string, view: ChoiceDependencyView) {
	for (let index = view.rows.length - 1; index >= 0; index--) {
		if (view.rows[index].id === id) return view.rows[index];
	}
}

function hasSubmittedChoice(value: unknown): boolean {
	return (
		isRecord(value) &&
		(value.checked === true ||
			(isCounter(value.attemptCount) && (value.attemptCount as number) > 0) ||
			(Array.isArray(value.history) &&
				value.history.some((entry) => isRecord(entry) && entry.checked === true)))
	);
}

// Members and aggregate references consume the same admitted submitted evidence.
type SubmittedChoiceResolution =
	| {
			status: "current";
			evidence: { kind: "submission"; answer: SavedAssessmentState } | { kind: "base" };
	  }
	| { status: "unanswered" | "history"; evidence: null };

/** One status drives future reporting, display and gates. No production caller yet. */
export function choiceDependencyStatus(
	id: string,
	view: ChoiceDependencyView,
): "current" | "unanswered" | "history" {
	if (view.invalidIds?.includes(id)) return "history";
	if (
		Object.hasOwn(view.groups ?? {}, id) &&
		latestChoiceRow(id, view)?.choiceEvidenceInvalid === true
	)
		return "history";
	if (view.groups && Object.hasOwn(view.groups, id)) return groupDependencyStatus(id, view);
	return resolveMember(id, view).status;
}

/** Draft signatures never stand in for a submission; only the latest checked answer counts. */
function resolveSubmittedChoice(
	state: unknown,
	facts: ChoiceAssessmentFacts,
	row: ChoiceDependencyView["rows"][number] | undefined,
	reference?: { signature: string | null },
): SubmittedChoiceResolution {
	if (!row && !hasSubmittedChoice(state)) return { status: "unanswered", evidence: null };
	const history = isRecord(state) && Array.isArray(state.history) ? state.history : [];
	const submissions = [...history, state].filter(
		(entry) => isRecord(entry) && entry.checked === true,
	);
	// Resolve a captured reference independently of the newest reporting row.
	const submitted = reference
		? submissions.find((entry) => entry.contentSignature === reference.signature)
		: submissions.at(-1);
	if (!isRecord(submitted)) return { status: "history", evidence: null };
	const answer = admitChoiceAssessmentState(submitted, facts);
	return answer?.checked &&
		(!row ||
			(row.contentSignature === answer.contentSignature &&
				(row.correct === undefined || row.correct === answer.correct)))
		? { status: "current", evidence: { kind: "submission", answer } }
		: { status: "history", evidence: null };
}

function dependencyGroup(id: string, view: ChoiceDependencyView): ChoiceStateGroup | null {
	const group = view.groups && Object.hasOwn(view.groups, id) ? view.groups[id] : undefined;
	return group && choiceGroupFactsAreValid(group, view.groups ?? {}) ? group : null;
}

function savedGroupSelection(state: unknown, group: ChoiceStateGroup): string | null {
	if (
		!(
			isRecord(state) &&
			state.version === 1 &&
			state.kind === "assessmentGroup" &&
			state.mode === group.mode &&
			typeof state.completed === "boolean"
		)
	)
		return null;
	return group.memberIds.find((member) => member === state.selectedMemberId) ?? null;
}

/** Includes private submitted members; optional fresh selections contribute nothing. */
export function choiceGroupDependencyIds(id: string, view: ChoiceDependencyView): string[] {
	const group = dependencyGroup(id, view);
	if (!group) return [];
	if (group.mode === "oneOf")
		return [savedGroupSelection(view.readState(id), group) ?? group.memberIds[0]];
	return group.memberIds
		.filter(
			(member) =>
				group.requiredIds.includes(member) ||
				latestChoiceRow(member, view) !== undefined ||
				hasSubmittedChoice(view.readState(member)),
		)
		.sort();
}

function isGroupPayload(value: unknown): value is ChoiceGroupPayload {
	if (!isRecord(value) || !Array.isArray(value.dependencies) || !value.dependencies.length)
		return false;
	let previous = "";
	for (const pair of value.dependencies) {
		if (
			!Array.isArray(pair) ||
			pair.length !== 2 ||
			!isNonemptyString(pair[0]) ||
			pair[0] <= previous ||
			(pair[1] !== null && !isChoiceContentSignature(pair[1]))
		)
			return false;
		previous = pair[0];
	}
	return value.mode === "all"
		? value.selectedMemberId === null
		: value.mode === "oneOf" &&
				value.dependencies.length === 1 &&
				value.selectedMemberId === value.dependencies[0][0];
}

/** The digest verifies the captured payload, not a reconstruction from today's drafts. */
export function choiceGroupSignature(payload: ChoiceGroupPayload): string {
	if (!isGroupPayload(payload)) throw new TypeError("Invalid group submission payload");
	return choiceEvidenceSignature(
		choiceMaterialSignature([
			"choice-group",
			1,
			payload.mode,
			payload.selectedMemberId,
			payload.dependencies,
		]),
	);
}

/** Called only for a deliberate aggregate submission, after all dependencies admit. */
export function prepareChoiceGroupSubmission(
	id: string,
	view: ChoiceDependencyView,
): ChoiceGroupSubmission | null {
	const group = dependencyGroup(id, view);
	const ids = choiceGroupDependencyIds(id, view);
	if (!group || !ids.length) return null;
	const dependencies: ChoiceGroupPayload["dependencies"] = [];
	for (const member of ids) {
		const resolved = resolveMember(member, view);
		if (resolved.status !== "current") return null;
		dependencies.push([
			member,
			resolved.evidence.kind === "submission"
				? (resolved.evidence.answer.contentSignature ?? null)
				: null,
		]);
	}
	const payload: ChoiceGroupPayload = {
		mode: group.mode,
		selectedMemberId: group.mode === "oneOf" ? ids[0] : null,
		dependencies,
	};
	return { payload, contentSignature: choiceGroupSignature(payload) };
}

function resolveMember(
	id: string,
	view: ChoiceDependencyView,
	reference?: { signature: string | null },
): SubmittedChoiceResolution {
	if (view.invalidIds?.includes(id)) return { status: "history", evidence: null };
	if (!Object.hasOwn(view.questions, id))
		return reference?.signature != null
			? { status: "history", evidence: null }
			: { status: "current", evidence: { kind: "base" } };
	if (latestChoiceRow(id, view)?.choiceEvidenceInvalid === true)
		return { status: "history", evidence: null };
	return resolveSubmittedChoice(
		view.readState(id),
		{ question: view.questions[id], signature: view.signatures[id] },
		reference ? undefined : latestChoiceRow(id, view),
		reference,
	);
}

function groupDependencyStatus(
	id: string,
	view: ChoiceDependencyView,
): "current" | "unanswered" | "history" {
	const state = view.readState(id);
	const row = latestChoiceRow(id, view);
	const submitted = isRecord(state) ? state.submitted : undefined;
	// A selection alone does not claim an aggregate result. Signed private snapshots do.
	if (!row && submitted === undefined) return "unanswered";
	const group = dependencyGroup(id, view);
	const ids = choiceGroupDependencyIds(id, view);
	if (!group || !ids.length) return "history";
	if (isRecord(state) && state.mode !== undefined && state.mode !== group.mode) return "history";
	// Any supplied row witness must agree with the captured dependency set.
	if (
		row?.memberIds !== undefined &&
		(!Array.isArray(row.memberIds) ||
			(group.mode === "oneOf"
				? row.memberIds.length !== 1 || row.memberIds[0] !== ids[0]
				: Array.from(row.memberIds).some((member) => !ids.includes(member))))
	)
		return "history";
	if (
		!isRecord(state) ||
		state.version !== 1 ||
		state.kind !== "assessmentGroup" ||
		typeof state.completed !== "boolean" ||
		!isRecord(submitted) ||
		!isGroupPayload(submitted.payload) ||
		submitted.contentSignature !== choiceGroupSignature(submitted.payload) ||
		(row && row.contentSignature !== submitted.contentSignature) ||
		submitted.payload.mode !== group.mode ||
		// Valid oneOf payloads select their sole dependency, so this also checks selection.
		JSON.stringify(submitted.payload.dependencies.map(([member]) => member)) !== JSON.stringify(ids)
	)
		return "history";
	return submitted.payload.dependencies.every(
		([member, signature]) =>
			resolveMember(member, view).status === "current" &&
			resolveMember(member, view, { signature }).status === "current",
	)
		? "current"
		: "history";
}

function isCounter(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonemptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
