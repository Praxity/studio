/**
 * Unified interface for SCORM/xAPI runtime communication.
 * Implementations exist for SCORM 1.2, SCORM 2004, xAPI, and localStorage fallback.
 */
import type { LearnerBlockSaveResult } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";

export interface RuntimeDestinations {
	readonly reporting: "device" | "lms";
	readonly state: "device" | "lms";
}

export const LMS_DESTINATIONS: RuntimeDestinations = { reporting: "lms", state: "lms" };
export const DEVICE_DESTINATIONS: RuntimeDestinations = { reporting: "device", state: "device" };

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
	getBlockSaveResult?(blockId: string): LearnerBlockSaveResult | undefined;
	/** Only host-provided identities may select a durable private learner store. */
	getLearnerIdentity?(): { learnerId: string; attemptId?: string; newAttempt?: boolean } | null;
	setBlockStatePolicy?(policy: Readonly<Record<string, "device" | "lms">>): void;
	/** Local and preview state owners expose whether their device store is available. */
	hasPersistentStorage?(): boolean;
	getBlockState?(blockId: string): LearnerStateValue | undefined;
	/** Read saved build evidence without migration or persistence. */
	getSavedBuildRevision?(): string | null;
	setBlockState?(blockId: string, value: LearnerStateValue): boolean;
	commit(): boolean;
	trackNavigation?(fromPageId: string, toPageId: string, trigger: string): void;
	trackObjective?(id: string, score: number, passed: boolean): void;
}

export interface AssessmentAttemptMetadata {
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
		...assessmentAttemptMetadata(input),
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
