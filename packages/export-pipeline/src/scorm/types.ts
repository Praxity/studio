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
	readonly destinations: RuntimeDestinations;
	initialize(): boolean;
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
	getInteractionEvidence?(): InteractionEvidence[] | null;
	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void;
	getCompletion(): string;
	setSuccess?(status: "passed" | "failed" | "unknown"): void;
	getSuccess?(): string;
	setCourseFailure?(failed: boolean): void;
	setScore(raw: number, min: number, max: number): void;
	getScore(): { raw: number; min: number; max: number } | null;
	setBookmark(pageId: string): void;
	getBookmark(): string | null;
	setSuspendData(data: string): void | boolean;
	getSuspendData(): string | null;
	getUnsavedBlockState?(blockId: string): LearnerStateValue | undefined;
	setUnsavedBlockState?(blockId: string, value: LearnerStateValue): boolean;
	stageSubmission?(blockId: string, write: () => boolean): boolean;
	abortSubmission?(blockId: string): void;
	getBlockSaveResult?(blockId: string): LearnerBlockSaveResult | undefined;
	getLearnerIdentity?(): { learnerId: string; attemptId?: string; newAttempt?: boolean } | null;
	setBlockStatePolicy?(policy: Readonly<Record<string, "device" | "lms">>): void;
	hasPersistentStorage?(): boolean;
	getBlockState?(blockId: string): LearnerStateValue | undefined;
	setBlockState?(blockId: string, value: LearnerStateValue): boolean;
	setCommitPreparation?(prepare: () => void): void;
	commit(): boolean;
	trackNavigation?(fromPageId: string, toPageId: string, trigger: string): void;
	trackObjective?(id: string, score: number, passed: boolean): void;
}

export interface AssessmentAttemptMetadata {
	contentSignature?: string;
	choiceEvidenceInvalid?: true;
	attemptsUsed?: number;
	maxAttempts?: number;
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

export function assessmentEvidenceMetadata(input?: unknown): AssessmentAttemptMetadata {
	const metadata = assessmentAttemptMetadata(input);
	if (!input || typeof input !== "object") return metadata;
	const { contentSignature, choiceEvidenceInvalid, memberIds } = input as AssessmentAttemptMetadata;
	const validSignature = isChoiceContentSignature(contentSignature);
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

export interface RejectedInteractionEvidence {
	id: string;
	choiceEvidenceInvalid: true;
	[key: string]: unknown;
}

export type InteractionEvidence = InteractionRecord | RejectedInteractionEvidence;

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

export function assessmentRowEvidence(input: unknown): InteractionEvidence | null {
	if (!input || typeof input !== "object") return null;
	const record = input as Record<string, unknown>;
	const metadata = assessmentEvidenceMetadata(record);
	const signed = record.contentSignature !== undefined || metadata.choiceEvidenceInvalid === true;
	if (signed && !isNonemptyString(record.id))
		throw new Error("Unidentifiable interaction evidence");
	if (!isInteractionRecord(record) || metadata.choiceEvidenceInvalid === true) {
		return signed ? { ...record, id: record.id as string, choiceEvidenceInvalid: true } : null;
	}
	return record as unknown as InteractionRecord;
}

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
	onResponseTruncated?: (responseLimit: number) => void;
	result?: "neutral";
	choiceDefinition?: {
		interactionType: "choice";
		choices: Array<{ id: string; description: Record<string, string> }>;
	};
	assessmentType?: string;
	description?: string;
	language?: string;
}

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
