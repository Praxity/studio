/**
 * Unified interface for SCORM/xAPI runtime communication.
 * Implementations exist for SCORM 1.2, SCORM 2004, xAPI, and localStorage fallback.
 */
import type { LearnerBlockSaveResult } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { isChoiceContentSignature } from "@praxity/shared-blocks/learner-state";

export interface RuntimeDestinations {
	readonly reporting: "device" | "lms";
	readonly state: "device" | "lms";
}

export const LMS_DESTINATIONS: RuntimeDestinations = { reporting: "lms", state: "lms" };
export const DEVICE_DESTINATIONS: RuntimeDestinations = { reporting: "device", state: "device" };

export interface RuntimeCommitPreparation {
	prepareCommit?: () => void;
}

export interface SCORMRuntime {
	/** The active adapter owns its reporting capability and state storage destination. */
	readonly destinations: RuntimeDestinations;
	initialize(): boolean;
	/** Explicit Finish completes the course inside the guarded final commit. */
	terminate(explicitFinish?: boolean): boolean;
	trackPageVisit(pageId: string): void;
	getVisitedPages(): string[];
	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		options?: TrackInteractionOptions,
	): void;
	getInteractions(): InteractionRecord[];
	/** Raw admitted rows retain rejected signed evidence in its original order. */
	getInteractionEvidence?(): InteractionEvidence[] | null;
	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void;
	getCompletion(): string;
	/**
	 * Report pass/fail separately from completion. Runtimes without a separate
	 * success status (SCORM 1.2, local storage) omit this and receive a single
	 * combined status through `setCompletion`.
	 */
	setSuccess?(status: "passed" | "failed" | "unknown"): void;
	getSuccess?(): string;
	/** Preserve the tracker's unfinished failure status when explicit Finish closes the launch. */
	setCourseFailure?(failed: boolean): void;
	setScore(raw: number, min: number, max: number): void;
	getScore(): { raw: number; min: number; max: number } | null;
	setBookmark(pageId: string): void;
	getBookmark(): string | null;
	setSuspendData(data: string): void | boolean;
	getSuspendData(): string | null;
	/** Editable device drafts while original LMS bytes are held unreadable. Never LMS credit. */
	getUnsavedBlockState?(blockId: string): LearnerStateValue | undefined;
	setUnsavedBlockState?(blockId: string, value: LearnerStateValue): boolean;
	stageSubmission?(blockId: string, write: () => boolean): boolean;
	/** Discard only the matching provisional submission when its host refuses reporting. */
	abortSubmission?(blockId: string): void;
	getBlockSaveResult?(blockId: string): LearnerBlockSaveResult | undefined;
	/** Only host-provided identities may select a durable private learner store. */
	getLearnerIdentity?(): { learnerId: string; attemptId?: string; newAttempt?: boolean } | null;
	setBlockStatePolicy?(policy: Readonly<Record<string, "device" | "lms">>): void;
	/** Local and preview state owners expose whether their device store is available. */
	hasPersistentStorage?(): boolean;
	getBlockState?(blockId: string): LearnerStateValue | undefined;
	setBlockState?(blockId: string, value: LearnerStateValue): boolean;
	/** Host admission supplies the current outcome owner before any commit or termination. */
	setCommitPreparation?(prepare: () => void): void;
	commit(): boolean;
	trackNavigation?(fromPageId: string, toPageId: string, trigger: string): void;
	trackObjective?(id: string, score: number, passed: boolean): void;
}

export interface AssessmentAttemptMetadata {
	/** Submitted material evidence, never inferred from an editable answer. */
	contentSignature?: string;
	/** Rejected evidence must remain distinguishable from unsigned rows. */
	choiceEvidenceInvalid?: true;
	/** Resolved UI attempt count, including attempts restored from learner state. */
	attemptsUsed?: number;
	/** Resolved UI limit. Zero represents unlimited attempts in suspend JSON. */
	maxAttempts?: number;
	/** Scored members contributing to this submitted aggregate, or the selected oneOf member. */
	memberIds?: string[];
}

export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function isNonemptyString(value: unknown): value is string {
	return isString(value) && value.length > 0;
}

export function isPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Validate event and restored metadata without coercing malformed persisted values. */
export function assessmentAttemptMetadata(input?: unknown): AssessmentAttemptMetadata {
	if (!input || typeof input !== "object") return {};
	const { attemptsUsed, maxAttempts, memberIds } = input as AssessmentAttemptMetadata;
	const limit = maxAttempts === Infinity ? 0 : maxAttempts;
	return {
		attemptsUsed: isPositiveInteger(attemptsUsed) ? attemptsUsed : undefined,
		maxAttempts: limit === 0 || isPositiveInteger(limit) ? limit : undefined,
		memberIds:
			Array.isArray(memberIds) && memberIds.length && memberIds.every(isNonemptyString)
				? memberIds
				: undefined,
	};
}

/** Shared signed metadata for reporting events and stored rows. */
export function assessmentEvidenceMetadata(input?: unknown): AssessmentAttemptMetadata {
	const metadata = assessmentAttemptMetadata(input);
	if (!input || typeof input !== "object") return metadata;
	const { contentSignature, choiceEvidenceInvalid, memberIds } = input as AssessmentAttemptMetadata;
	const validSignature = isChoiceContentSignature(contentSignature);
	// Empty witnesses are valid for groups with no scored members.
	const validMembers = Array.isArray(memberIds) && Array.from(memberIds).every(isNonemptyString);
	return {
		...metadata,
		...(choiceEvidenceInvalid !== undefined ||
		(contentSignature !== undefined && !validSignature) ||
		(memberIds !== undefined && !validMembers)
			? { choiceEvidenceInvalid: true as const }
			: {}),
		...(validSignature ? { contentSignature } : {}),
		memberIds: validMembers ? memberIds : undefined,
	};
}

/** Keep rejected raw fields beside their marker, without inventing an answer or result. */
export interface RejectedInteractionEvidence {
	id: string;
	choiceEvidenceInvalid: true;
	[key: string]: unknown;
}

export type InteractionEvidence = InteractionRecord | RejectedInteractionEvidence;

/** Keep the latest row and scored row per ID; retries follow older aggregates. */
export function recordInteraction<T extends InteractionEvidence>(rows: T[], record: T): T[] {
	const lastScored =
		typeof record.score === "number"
			? undefined
			: [...rows].reverse().find((row) => row.id === record.id && typeof row.score === "number");
	return [
		...rows.filter((row) => row.id !== record.id),
		...(lastScored ? [lastScored] : []),
		record,
	];
}

/** Row shape shared by scoring and evidence admission. */
export function isInteractionRecord(input: unknown): input is InteractionRecord {
	const record = input as Record<string, unknown> | null;
	const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
	return (
		!!record &&
		typeof record.id === "string" &&
		typeof record.response === "string" &&
		isNumber(record.timestamp) &&
		(record.correct === undefined || typeof record.correct === "boolean") &&
		(record.score === undefined || isNumber(record.score))
	);
}

/** Malformed signed evidence is history in every transport. */
export function assessmentRowEvidence(input: unknown): InteractionEvidence | null {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	const metadata = assessmentEvidenceMetadata(record);
	const signed = record.contentSignature !== undefined || metadata.choiceEvidenceInvalid === true;
	// Without identity, no dependency can be marked invalid. Refuse the whole evidence read.
	if (signed && !isNonemptyString(record.id))
		throw new Error("Unidentifiable interaction evidence");
	if (!isInteractionRecord(record) || metadata.choiceEvidenceInvalid === true) {
		return signed ? { ...record, id: record.id as string, choiceEvidenceInvalid: true } : null;
	}
	return record as unknown as InteractionRecord;
}

/** A missing identity refuses the complete read, never exposing an earlier credited row. */
export function assessmentRowsEvidence(rows: readonly unknown[]): InteractionEvidence[] | null {
	try {
		return rows.flatMap((input) => {
			const row = assessmentRowEvidence(input);
			return row ? [row] : [];
		});
	} catch {
		return null;
	}
}

export interface TrackInteractionOptions extends AssessmentAttemptMetadata {
	/** Report adapters own their field limits; learner UI may disclose a cut answer. */
	onResponseTruncated?: (responseLimit: number) => void;
	result?: "neutral";
	choiceDefinition?: {
		interactionType: "choice";
		choices: Array<{ id: string; description: Record<string, string> }>;
	};
	assessmentType?: string;
	/** Plain authored question text, or its group/page title when the stem is empty. */
	description?: string;
	language?: string;
}

/** Build runtime reporting options; each adapter owns its format validation. */
export function assessmentReportingOptions(
	input: Record<string, unknown>,
	fallbackTitle: string,
): TrackInteractionOptions {
	return {
		...assessmentEvidenceMetadata(input),
		result: input.result === "neutral" ? "neutral" : undefined,
		choiceDefinition: input.choiceDefinition as TrackInteractionOptions["choiceDefinition"],
		assessmentType: input.assessmentType as string | undefined,
		description: String(input.questionText || input.groupName || fallbackTitle),
		language: input.language as string | undefined,
	};
}

export { interactionDescription } from "./interaction-description";

export interface InteractionRecord extends AssessmentAttemptMetadata {
	id: string;
	response: string;
	correct?: boolean;
	score?: number;
	timestamp: number;
}

export type ExportFormat = "scorm12" | "scorm2004" | "xapi" | "html";

export type Scorm2004Edition = "3rd" | "4th";
