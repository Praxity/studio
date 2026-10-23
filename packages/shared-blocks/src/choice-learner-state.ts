import { DONT_KNOW } from "learning-patterns/patterns/dont-know/logic.js";
import {
	type AdmittedChoiceStateFacts,
	type ChoiceAssessmentFacts,
	type ChoiceStateGroup,
	type ChoiceStateQuestion,
	choiceAnswerSignature,
	choiceGroupFactsAreValid,
	choiceMaterialSignature,
	choiceProofSignature,
	isChoiceAssessmentFacts,
	isChoiceContentSignature,
} from "./choice-state-facts";

import type { LearnerStateV1, LearnerStateValue, SavedAssessmentState } from "./learner-state";

export type { ChoiceStateGroup } from "./choice-state-facts";

// Preview build evidence is supplied by its saved-state owner.
export interface LearnerBuildProof {
	savedRevision: string | null;
	currentRevision: string | null;
}

function validChoiceIds(question: ChoiceStateQuestion, answer: unknown): answer is string[] {
	const ids = new Set(question.options.map((option) => option.id));
	if (question.dontKnow) ids.add(DONT_KNOW);
	return (
		Array.isArray(answer) &&
		Array.from(answer).every((id) => typeof id === "string" && ids.has(id)) &&
		new Set(answer).size === answer.length
	);
}

function legacyChoiceStateIsCurrent(
	value: Record<string, unknown>,
	question: ChoiceStateQuestion,
	proof?: LearnerBuildProof,
): boolean {
	if (proof) {
		const build =
			value.legacyBuildRevision === undefined ? proof.savedRevision : value.legacyBuildRevision;
		return (
			typeof build === "string" &&
			build.length > 0 &&
			build === proof.savedRevision &&
			build === proof.currentRevision
		);
	}
	return (
		value.checked === true &&
		validChoiceIds(question, value.answer) &&
		value.answer.length > 0 &&
		value.correct ===
			(question.canAutoScore &&
				choiceAnswerSignature(value.answer) === question.correctAnswerSignature)
	);
}

function choiceStateMatchesSignature(
	value: Record<string, unknown>,
	{ signature, question }: ChoiceAssessmentFacts,
	proof?: LearnerBuildProof,
): boolean {
	if (value.contentSignature === undefined)
		return legacyChoiceStateIsCurrent(value, question, proof);
	if (value.contentSignature === signature) return true;
	const old = value.materialProof;
	if (!isRecord(old)) return false;
	if (Array.isArray(old.optionIds)) {
		const ids = old.optionIds;
		if (
			old.question !== undefined ||
			old.options !== undefined ||
			!ids.every(isNonemptyString) ||
			new Set(ids).size !== ids.length
		)
			return false;
		const options = question.options.filter((option) => ids.includes(option.id));
		// The old signature proves the question and every old option unchanged.
		// Since the question pins the correct set, any added options are distractors.
		return (
			options.length === ids.length &&
			choiceProofSignature({
				question: question.materialSignature,
				options: options.map((option) => option.materialSignature),
			}) === value.contentSignature
		);
	}
	if (
		!isChoiceContentSignature(old.question) ||
		!Array.isArray(old.options) ||
		!Array.from(old.options).every(isChoiceContentSignature)
	)
		return false;
	return (
		choiceProofSignature({ question: old.question, options: old.options }) ===
			value.contentSignature &&
		old.question === question.materialSignature &&
		old.options.every((option) =>
			question.options.some((current) => current.materialSignature === option),
		)
	);
}

/** Saved data is admitted here; restore and dependency status use the same decision. */
function admitChoiceAssessmentState(
	value: unknown,
	facts: ChoiceAssessmentFacts,
	proof?: LearnerBuildProof,
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
	if ((signed || !value.checked) && question.selectionMode === "single" && value.answer.length > 1)
		return null;
	// An unsigned draft has no submitted verdict to migrate or credit.
	if ((signed || value.checked) && !choiceStateMatchesSignature(value, facts, proof)) return null;
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
	proof?: LearnerBuildProof,
): {
	status: "empty" | "current" | "review";
	current: SavedAssessmentState | null;
	history: LearnerStateValue[];
} {
	if (value === undefined) return { status: "empty", current: null, history: [] };
	const history =
		isRecord(value) && Array.isArray(value.history) ? (value.history as LearnerStateValue[]) : [];
	const current = admitChoiceAssessmentState(value, facts, proof);
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
	write: { writtenAt: number; proof?: LearnerBuildProof },
): SavedAssessmentState {
	if (!isChoiceAssessmentFacts(facts)) throw new TypeError("Invalid compiled choice facts");
	const restored = restoreChoiceAssessmentState(previous, facts, write.proof);
	const history = [...restored.history];
	const prior = restored.current;
	if (
		prior?.checked &&
		(prior.contentSignature !== facts.signature ||
			!next.checked ||
			next.attemptCount !== prior.attemptCount)
	) {
		// Preserve the stored verdict and finality, not today's normalized legacy view.
		const { history: _history, ...attempt } = previous as SavedAssessmentState;
		history.push(attempt as unknown as LearnerStateValue);
	}
	const proofs = new Set<string>();
	const previousBuild = isRecord(previous) ? previous.legacyBuildRevision : undefined;
	// A retry write cannot advance the origin of an unsigned submission or erased retry.
	const draftBuild =
		previousBuild !== undefined
			? typeof previousBuild === "string"
				? previousBuild
				: null
			: isRecord(previous) && previous.contentSignature === undefined
				? (write.proof?.savedRevision ?? null)
				: (write.proof?.currentRevision ?? null);
	const materialProof = { optionIds: facts.question.options.map((option) => option.id).sort() };
	if (
		next.checked &&
		admitLegacyRetry(previous, facts, undefined, write.proof) &&
		!history.some((entry) => isRecord(entry) && entry.checked === true)
	) {
		const { history: _history, ...pending } = previous as SavedAssessmentState;
		// Retain the same material claim as a draft write, even on direct resubmission.
		history.push({
			...pending,
			legacyPending: true,
			...(pending.contentSignature === undefined
				? { contentSignature: facts.signature, materialProof, legacyBuildRevision: draftBuild }
				: {}),
		} as unknown as LearnerStateValue);
	}
	// Keep an erased retry's existing material claim until a new submission replaces it.
	const erasedDraft =
		!next.checked &&
		isRecord(previous) &&
		previous.checked === false &&
		previous.contentSignature !== undefined &&
		hasSubmittedChoice(previous) &&
		!history.some((entry) => isRecord(entry) && entry.checked === true)
			? (previous as unknown as SavedAssessmentState)
			: undefined;
	return {
		...next,
		contentSignature: erasedDraft ? erasedDraft.contentSignature : facts.signature,
		materialProof: erasedDraft ? erasedDraft.materialProof : materialProof,
		writtenAt: write.writtenAt,
		legacyBuildRevision: draftBuild,
		...(history.length
			? {
					history: history.map((entry) => {
						if (
							!isRecord(entry) ||
							typeof entry.contentSignature !== "string" ||
							!isRecord(entry.materialProof)
						)
							return entry;
						const key = JSON.stringify([entry.contentSignature, entry.materialProof]);
						if (!proofs.has(key)) {
							proofs.add(key);
							return entry;
						}
						// Keep every selection, verdict and origin; share only identical material proof.
						const { materialProof: _proof, ...answer } = entry;
						return answer as LearnerStateValue;
					}),
				}
			: {}),
	};
}

/** Retain the last-write build before unrelated writes advance a preview envelope. */
export function retainLegacyChoiceBuild(state: LearnerStateV1): void {
	for (const value of Object.values(state.blockState)) {
		if (
			isRecord(value) &&
			value.kind === "assessment" &&
			value.assessmentType === "choice" &&
			value.contentSignature === undefined &&
			value.legacyBuildRevision === undefined
		)
			value.legacyBuildRevision = state.revision;
	}
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
	buildProof?: (id: string) => LearnerBuildProof | undefined;
}

/** One context for readers; construction never admits, signs or writes an answer. */
export function createChoiceDependencyView(
	facts: AdmittedChoiceStateFacts,
	evidence: {
		rows: ChoiceDependencyView["rows"];
		readState: ChoiceDependencyView["readState"];
		preview?: {
			currentRevision: string | null;
			readSavedRevision: (id: string) => string | null;
		};
	},
): ChoiceDependencyView {
	if (facts.choiceStateInvalidIds.includes("*")) throw new Error("Invalid choice facts");
	const preview = evidence.preview;
	return {
		invalidIds: facts.choiceStateInvalidIds,
		rows: evidence.rows,
		questions: facts.choiceStateQuestions,
		signatures: facts.choiceStateSignatures,
		...(facts.choiceStateGroups ? { groups: facts.choiceStateGroups } : {}),
		readState: evidence.readState,
		...(preview
			? {
					buildProof: (id: string) => ({
						savedRevision: preview.readSavedRevision(id),
						currentRevision: preview.currentRevision,
					}),
				}
			: {}),
	};
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
			evidence:
				| { kind: "submission"; answer: SavedAssessmentState }
				| { kind: "legacy-pending" }
				| { kind: "base" };
	  }
	| { status: "unanswered" | "history"; evidence: null };

/** One status drives reporting, display and gates. */
export function choiceDependencyStatus(
	id: string,
	view: ChoiceDependencyView,
): "current" | "unanswered" | "history" {
	if (view.invalidIds?.includes(id)) return "history";
	if (
		(Object.hasOwn(view.questions, id) || Object.hasOwn(view.groups ?? {}, id)) &&
		latestChoiceRow(id, view)?.choiceEvidenceInvalid === true
	)
		return "history";
	if (view.groups && Object.hasOwn(view.groups, id)) return groupDependencyStatus(id, view);
	return resolveMember(id, view).status;
}

function admitLegacyRetry(
	value: unknown,
	facts: ChoiceAssessmentFacts,
	row: ChoiceDependencyView["rows"][number] | undefined,
	proof?: LearnerBuildProof,
): SavedAssessmentState | null {
	if (row?.contentSignature !== undefined || row?.correct === true) return null;
	const draft = admitChoiceAssessmentState(value, facts, proof);
	if (!draft || draft.checked || draft.attemptCount === 0) return null;
	if (
		proof &&
		!legacyChoiceStateIsCurrent(draft as unknown as Record<string, unknown>, facts.question, proof)
	)
		return null;
	// Pre-signature retries cannot prove old material; preserve base pending behavior.
	return draft;
}

/** Draft signatures never stand in for a submission; only the latest checked answer counts. */
function resolveSubmittedChoice(
	state: unknown,
	facts: ChoiceAssessmentFacts,
	row: ChoiceDependencyView["rows"][number] | undefined,
	proof?: LearnerBuildProof,
	reference?: { signature: string | null },
): SubmittedChoiceResolution {
	if (!row && !hasSubmittedChoice(state)) return { status: "unanswered", evidence: null };
	const history = isRecord(state) && Array.isArray(state.history) ? state.history : [];
	const submissions = [...history, state].filter(
		(entry) => isRecord(entry) && entry.checked === true,
	);
	// A material reference resolves in its own verdict/origin context, not the newest row's.
	let submitted = reference
		? submissions.find((entry) => (entry.contentSignature ?? null) === reference.signature)
		: submissions.at(-1);
	if (reference && !submitted) {
		const pending = history.find((entry) => isRecord(entry) && entry.legacyPending === true);
		return reference.signature === null &&
			admitLegacyRetry(pending ?? (submissions.length ? undefined : state), facts, undefined, proof)
			? { status: "current", evidence: { kind: "legacy-pending" } }
			: { status: "history", evidence: null };
	}
	if (!isRecord(submitted))
		return admitLegacyRetry(state, facts, row, proof)
			? { status: "current", evidence: { kind: "legacy-pending" } }
			: { status: "history", evidence: null };
	if (submitted.materialProof === undefined && submitted.contentSignature !== undefined) {
		const shared = history.find(
			(entry) =>
				isRecord(entry) &&
				entry.contentSignature === submitted.contentSignature &&
				entry.materialProof !== undefined,
		);
		if (isRecord(shared)) submitted = { ...submitted, materialProof: shared.materialProof };
	}
	if (
		submitted.contentSignature === undefined &&
		submitted.legacyBuildRevision === undefined &&
		isRecord(state) &&
		state.legacyBuildRevision !== undefined
	)
		submitted = { ...submitted, legacyBuildRevision: state.legacyBuildRevision };
	const answer = admitChoiceAssessmentState(submitted, facts, proof);
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
	return choiceMaterialSignature([
		"choice-group",
		1,
		payload.mode,
		payload.selectedMemberId,
		payload.dependencies,
	]);
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
		view.buildProof?.(id),
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
	// Legacy ungraded rows may omit a witness; any supplied witness must agree in both formats.
	if (
		row?.memberIds !== undefined &&
		(!Array.isArray(row.memberIds) ||
			(group.mode === "oneOf"
				? row.memberIds.length !== 1 || row.memberIds[0] !== ids[0]
				: Array.from(row.memberIds).some((member) => !ids.includes(member))))
	)
		return "history";
	if (submitted !== undefined || row?.contentSignature !== undefined) {
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
			JSON.stringify(submitted.payload.dependencies.map(([member]) => member)) !==
				JSON.stringify(ids)
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
	return ids.every(
		(member) =>
			resolveMember(member, view).status === "current" &&
			resolveMember(member, view, { signature: null }).status === "current",
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
