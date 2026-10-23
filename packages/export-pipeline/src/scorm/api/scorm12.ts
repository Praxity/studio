import { filterPrivateSuspendData } from "@praxity/shared-blocks/block-state-policy";
import type { LearnerBlockSaveResult } from "@praxity/shared-blocks/learner-block-state";
import {
	LEARNER_STATE_MAX_BYTES,
	type LearnerStateValue,
} from "@praxity/shared-blocks/learner-state";
import { findWindowProperty } from "../api-discovery.ts";
import { truncateInteractionResponse } from "../interaction-response";
import { LocalStorageRuntime } from "../local-storage-runtime";
import type {} from "../privacy-capability";
import { appendPrivateScorm12Interaction } from "../private-scorm12-policy";
import {
	fitScorm12SuspendData,
	parseScorm12SuspendData,
	preflightScorm12SuspendData,
	SCORM12_SUSPEND_DATA_LIMIT,
	type Scorm12SuspendData,
	type Scorm12SuspendDataCodec,
	serializeScorm12SuspendData,
} from "../scorm12-suspend-data";
import {
	assessmentAttemptMetadata,
	assessmentRowsEvidence,
	type InteractionEvidence,
	type InteractionRecord,
	LMS_DESTINATIONS,
	prepareRuntimeCommit,
	type SCORMRuntime,
	type TrackInteractionOptions,
} from "../types.ts";
import { deviceAttemptId } from "./device-attempt";
import {
	configureSessionOutcome,
	getSessionState,
	readSessionState,
	type ScormSessionState,
	sessionAllowsCalls,
	withGroupObjectiveState,
	writeScormSuspendData,
	writeSessionState,
} from "./session.ts";
import { sessionTime } from "./session-time.ts";

/** Dormant export so ordinary adapter instances do not retain evidence code in bundles. */
export function readScorm12InteractionEvidence(raw: string): InteractionEvidence[] | null {
	const data = parseScorm12SuspendData(raw);
	return data ? assessmentRowsEvidence(data.interactions) : null;
}

// See docs/context/scorm-xapi-standards.md for spec references

/**
 * SCORM 1.2 LMS API shape (window.API).
 * All methods accept and return strings per the SCORM 1.2 RTE specification.
 */
interface SCORM12API {
	LMSInitialize(param: string): string;
	LMSFinish(param: string): string;
	LMSGetValue(element: string): string;
	LMSSetValue(element: string, value: string): string;
	LMSCommit(param: string): string;
	LMSGetLastError(): string;
	LMSGetErrorString(errorCode: string): string;
	LMSGetDiagnostic(errorCode: string): string;
}

export { SCORM12_SUSPEND_DATA_LIMIT, type Scorm12SuspendData, serializeScorm12SuspendData };

/**
 * SCORM 1.2 runtime wrapper implementing the unified SCORMRuntime interface.
 *
 * Data model elements used:
 *  - cmi.core.lesson_status   completion / pass-fail status
 *  - cmi.core.score.raw/min/max   numeric score
 *  - cmi.core.lesson_location   bookmark (current page id)
 *  - cmi.suspend_data   JSON blob holding visited pages, interactions, and
 *                        arbitrary user data (SCORM 1.2 allows up to 4096 chars)
 */
export interface Scorm12Runtime {
	setBlockStatePolicy(policy: Readonly<Record<string, "device" | "lms">>): void;
	getLearnerIdentity(): { learnerId: string; attemptId: string; newAttempt: boolean } | null;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The static capability block installs these methods; interface declarations erase without emitting fields that shadow the prototype.
export class Scorm12Runtime implements SCORMRuntime {
	configureOutcome(policy: { waiting: boolean }): void {
		configureSessionOutcome(this.session, policy);
	}
	readonly destinations = LMS_DESTINATIONS;
	static {
		if (globalThis.__praxityPrivateState !== false) {
			Scorm12Runtime.prototype.setBlockStatePolicy = function (
				this: Scorm12Runtime,
				policy: Readonly<Record<string, "device" | "lms">>,
			): void {
				this.blockStatePolicy = { ...policy };
			};
			Scorm12Runtime.prototype.getLearnerIdentity = function (
				this: Scorm12Runtime,
			): { learnerId: string; attemptId: string; newAttempt: boolean } | null {
				this.ensureInitialized();
				const learnerId = this.lmsGetValue("cmi.core.student_id").trim();
				return learnerId
					? {
							learnerId,
							...deviceAttemptId(this, this.session, this.lmsGetValue("cmi.core.entry")),
						}
					: null;
			};
		}
	}

	private api: SCORM12API | null = null;
	private initialized = false;
	private session: ScormSessionState | null = null;
	private blockStatePolicy: Readonly<Record<string, "device" | "lms">> = {};

	private submission?: { blockId: string; data: Scorm12SuspendData };
	private reportingSubmission = false;
	private unreadableSuspendData = false;
	private heldDrafts?: LocalStorageRuntime;
	private heldMemory = new Map<string, LearnerStateValue>();
	constructor(
		private readonly courseId?: string,
		private readonly suspendDataCodec?: Scorm12SuspendDataCodec,
	) {}
	getUnsavedBlockState(blockId: string) {
		return this.heldMemory.has(blockId)
			? this.heldMemory.get(blockId)
			: this.heldDrafts?.getBlockState(blockId);
	}
	setUnsavedBlockState(blockId: string, value: LearnerStateValue): boolean {
		this.heldMemory.set(blockId, value);
		return this.heldDrafts?.setBlockState(blockId, value) ?? false;
	}
	private blockSaveResults = new Map<string, LearnerBlockSaveResult>();

	/** The checked state is provisional until its matching row fits the same suspend write. */
	stageSubmission(blockId: string, write: () => boolean): boolean {
		this.ensureInitialized();
		if (this.submission) throw new Error("A SCORM submission is already pending");
		const data = this.loadSuspendPayload();
		if (this.unreadableSuspendData) return false;
		this.submission = { blockId, data };
		try {
			this.blockSaveResults.set(blockId, { status: "pending" });
			if (write()) return true;
		} catch (error) {
			this.submission = undefined;
			this.blockSaveResults.set(blockId, { status: "not-saved", code: "runtime-write-failed" });
			throw error;
		}
		this.submission = undefined;
		this.blockSaveResults.set(blockId, { status: "not-saved", code: "runtime-write-failed" });
		return false;
	}

	abortSubmission(blockId: string): void {
		if (this.submission?.blockId !== blockId) return;
		this.submission = undefined;
		this.blockSaveResults.set(blockId, { status: "not-saved", code: "runtime-write-failed" });
	}

	withSavedState(write: () => boolean): boolean {
		return withGroupObjectiveState(this.session, () => {
			const staged = this.submission;
			this.submission = undefined;
			try {
				return write();
			} finally {
				if (staged) {
					const draft = JSON.parse(staged.data.custom ?? "{}");
					const saved = this.loadSuspendPayload();
					const custom = JSON.parse(saved.custom ?? "{}");
					// Retain this stage's group capture while adopting all newly saved rows and other blocks.
					custom.blockState = {
						...custom.blockState,
						[staged.blockId]: draft.blockState?.[staged.blockId],
					};
					saved.custom = JSON.stringify(custom);
					staged.data = saved;
				}
				this.submission = staged;
			}
		});
	}

	getBlockSaveResult(blockId: string) {
		this.loadSuspendPayload();
		return this.unreadableSuspendData
			? { status: "not-saved" as const, code: "unreadable-state" as const }
			: this.blockSaveResults.get(blockId);
	}

	// ---- lifecycle ----------------------------------------------------------

	/**
	 * Locate the LMS API and call LMSInitialize.
	 * Returns true on success, false if the API cannot be found or the LMS
	 * rejects the call.
	 *
	 * The API marker survives internal page navigation without a duplicate LMSInitialize.
	 */
	initialize(): boolean {
		if (this.session?.closed || this.session?.terminationInProgress) return false;
		if (this.initialized) return true;

		this.api =
			(findWindowProperty(window, "API") as unknown as SCORM12API | null | undefined) ?? null;
		if (!this.api) return false;
		this.session ??=
			getSessionState(this.api) ?? writeSessionState(this.api, readSessionState(this.api));
		if (!this.session || !this.canCallLms()) return false;

		const startedAt = Date.now();
		if (!readSessionState(this.api) && this.api.LMSInitialize("") !== "true") {
			// SCORM 1.2's 101 is a general exception, not proof of an active session.
			if (!this.canCallLms()) return false;
			const code = String(this.api.LMSGetLastError());
			if (!this.canCallLms()) return false;
			if (code !== "101") {
				this.throwIfError("LMSInitialize");
				return false;
			}
			this.lmsGetValue("cmi.core.lesson_status");
		}
		if (!this.canCallLms()) return false;
		this.session = writeSessionState(this.api, true);
		if (!this.session || !this.canCallLms()) return false;
		this.session.startedAt ??= startedAt;

		// Set initial status to "incomplete" if the LMS hasn't already set
		// a terminal status. Without this, SCORM Cloud auto-marks the registration
		// as COMPLETED when the session terminates without an explicit status.
		this.loadSuspendPayload();
		const currentStatus = this.lmsGetValue("cmi.core.lesson_status");
		if (
			!this.unreadableSuspendData &&
			(!currentStatus || currentStatus === "not attempted" || currentStatus === "browsed")
		) {
			if (!this.lmsSetValue("cmi.core.lesson_status", "incomplete")) return false;
		}
		if (!this.canCallLms()) return false;
		this.initialized = true;
		return true;
	}

	/**
	 * Call LMSFinish to end the SCORM session.
	 */
	terminate(explicitFinish = false): boolean {
		if (this.session?.closed) return this.session.terminationSucceeded;
		if (this.session?.terminationInProgress) return false;
		this.ensureInitialized();
		this.loadSuspendPayload();
		const session = this.session;
		if (!session) return false;
		if (!prepareRuntimeCommit(session)) return false;
		// LMS callbacks can synchronously reach any retained adapter. Only this
		// invocation may prepare and commit the final state while the guard is held.
		session.terminationInProgress = true;
		try {
			if (!this.flushCompletion(true)) return false;
			if (
				explicitFinish &&
				!session.outcomeWaiting &&
				!this.unreadableSuspendData &&
				!session.courseFailure &&
				!["failed", "passed"].includes(this.lmsGetValue("cmi.core.lesson_status", true)) &&
				!this.lmsSetValue("cmi.core.lesson_status", "completed", true)
			)
				return false;
			if (!this.commitToLms(true) || !this.canCallLms(true)) return false;
			// A failed or thrown Finish leaves LMS state uncertain. Close before calling it.
			session.closed = true;
			session.initialized = false;
			this.initialized = false;
			session.terminationSucceeded = this.api?.LMSFinish("") === "true";
			return session.terminationSucceeded;
		} finally {
			// Failed exit preparation or commit remains retryable.
			session.terminationInProgress = false;
		}
	}

	// ---- page visit tracking -----------------------------------------------

	trackPageVisit(pageId: string): void {
		this.ensureInitialized();
		const data = this.loadSuspendPayload();
		if (!data.visitedPages.includes(pageId)) {
			data.visitedPages.push(pageId);
		}
		this.saveSuspendPayload(data);
	}

	getVisitedPages(): string[] {
		this.ensureInitialized();
		return this.loadSuspendPayload().visitedPages;
	}

	// ---- interaction tracking ----------------------------------------------

	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		options?: TrackInteractionOptions,
	): void {
		if (globalThis.__praxityPrivateState !== false && this.blockStatePolicy[id] === "device")
			return;
		this.ensureInitialized();
		if (this.submission && this.submission.blockId !== id)
			throw new Error("Another SCORM submission is pending");
		const data = this.loadSuspendPayload();
		if (options?.assessmentType === "choice" && response.length > 255) {
			this.submission = undefined;
			this.blockSaveResults.set(id, { status: "not-saved", code: "runtime-write-failed" });
			throw new Error("Choice response exceeds the SCORM 1.2 CMIFeedback limit");
		}
		const storedResponse =
			options?.assessmentType === "choice" ? response : truncateInteractionResponse(response, 250);
		data.interactions.push({
			id,
			response: storedResponse,
			correct,
			score,
			...assessmentAttemptMetadata(options),
			timestamp: Date.now(),
		});
		this.reportingSubmission = true;
		try {
			if (!this.saveSuspendPayload(data)) throw new Error("ESCORM12STORAGE");
			this.blockSaveResults.delete(id);
		} catch (error) {
			this.blockSaveResults.set(id, { status: "not-saved", code: "runtime-write-failed" });
			throw error;
		} finally {
			this.submission = undefined;
			this.reportingSubmission = false;
		}

		// The ordinary path also covers republishing after the last private choice is removed.
		try {
			const privateAppend =
				globalThis.__praxityPrivateState !== false &&
				Object.values(this.blockStatePolicy).includes("device");
			const idx = privateAppend
				? appendPrivateScorm12Interaction(
						this.session,
						(key) => this.lmsGetValue(key),
						(key, value) => this.lmsSetValue(key, value),
						id,
						data.interactions.length - 1,
					)
				: Math.max(
						data.interactions.length - 1,
						Number(this.api?.LMSGetValue("cmi.interactions._count")) || 0,
					);
			if (globalThis.__praxityPrivateState === false || idx !== undefined) {
				if (globalThis.__praxityPrivateState === false || !privateAppend)
					this.lmsSetValue(`cmi.interactions.${idx}.id`, id);
				this.setReportValue(
					`cmi.interactions.${idx}.type`,
					// ADL 1.2 choice tokens are single characters; performance permits readable labels.
					options?.assessmentType === "choice"
						? "performance"
						: options?.assessmentType === "textResponse" || options?.assessmentType === "fillBlank"
							? "fill-in"
							: "choice",
				);
				this.setReportValue(
					`cmi.interactions.${idx}.result`,
					options?.result ?? (correct === undefined ? "neutral" : correct ? "correct" : "wrong"),
				);
				if (score !== undefined) {
					this.setReportValue(`cmi.interactions.${idx}.weighting`, String(score));
				}
				this.setReportValue(`cmi.interactions.${idx}.student_response`, storedResponse);
			}
		} catch (error) {
			// Preserve the existing LMS error diagnostic without aborting course scoring.
			console.warn(error);
		}
		if (storedResponse.length < response.length)
			options?.onResponseTruncated?.(storedResponse.length);
	}

	private setReportValue(element: string, value: string): void {
		try {
			this.lmsSetValue(element, value);
		} catch (error) {
			console.warn(`${element}: ${error}`);
		}
	}

	getInteractions(): InteractionRecord[] {
		this.ensureInitialized();
		let interactions = this.loadSuspendPayload().interactions;
		if (globalThis.__praxityPrivateState !== false)
			interactions = interactions.filter((record) => this.blockStatePolicy[record.id] !== "device");
		return interactions.map((record) => ({ ...record, ...assessmentAttemptMetadata(record) }));
	}

	setCourseFailure(failed: boolean): void {
		this.ensureInitialized();
		if (this.session) this.session.courseFailure = failed;
	}

	// ---- objectives --------------------------------------------------------

	private objectiveCount = 0;

	trackObjective(id: string, score: number, passed: boolean): void {
		this.loadSuspendPayload();
		if (this.unreadableSuspendData) return;
		if (globalThis.__praxityPrivateState !== false && this.blockStatePolicy[id] === "device")
			return;
		this.ensureInitialized();
		try {
			const n = this.objectiveCount;
			this.optionalSetValue(`cmi.objectives.${n}.id`, id);
			this.optionalSetValue(`cmi.objectives.${n}.score.raw`, String(score));
			this.optionalSetValue(`cmi.objectives.${n}.status`, passed ? "passed" : "failed");
			this.objectiveCount++;
		} catch {
			// Non-critical: LMS objectives support varies.
		}
	}

	// ---- completion --------------------------------------------------------

	/**
	 * Map the unified status to SCORM 1.2 cmi.core.lesson_status values.
	 *
	 * SCORM 1.2 valid values:
	 *   passed, completed, failed, incomplete, browsed, not attempted
	 */
	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void {
		this.ensureInitialized();
		this.loadSuspendPayload();
		if (!this.unreadableSuspendData && this.session) this.session.pendingCompletion = status;
	}

	getCompletion(): string {
		this.ensureInitialized();
		return this.session?.pendingCompletion ?? this.lmsGetValue("cmi.core.lesson_status");
	}

	// ---- scoring -----------------------------------------------------------

	setScore(raw: number, min: number, max: number): void {
		this.ensureInitialized();
		this.loadSuspendPayload();
		if (this.unreadableSuspendData) return;
		this.lmsSetValue("cmi.core.score.raw", String(raw));
		this.lmsSetValue("cmi.core.score.min", String(min));
		this.lmsSetValue("cmi.core.score.max", String(max));
	}

	getScore(): { raw: number; min: number; max: number } | null {
		this.ensureInitialized();
		const raw = this.lmsGetValue("cmi.core.score.raw");
		if (raw === "") return null;
		return {
			raw: Number(raw),
			min: Number(this.lmsGetValue("cmi.core.score.min")),
			max: Number(this.lmsGetValue("cmi.core.score.max")),
		};
	}

	// ---- bookmark ----------------------------------------------------------

	setBookmark(pageId: string): void {
		this.ensureInitialized();
		this.lmsSetValue("cmi.core.lesson_location", pageId);
	}

	getBookmark(): string | null {
		this.ensureInitialized();
		const val = this.lmsGetValue("cmi.core.lesson_location");
		return val === "" ? null : val;
	}

	// ---- suspend data (public custom data) ---------------------------------

	/**
	 * Set arbitrary user-facing suspend data.  This is stored inside the JSON
	 * payload alongside visited pages and interactions.
	 */
	setSuspendData(data: string): boolean {
		this.ensureInitialized();
		const payload = this.loadSuspendPayload();
		payload.custom = data;
		return this.saveSuspendPayload(payload);
	}

	getSuspendDataRevision(): number {
		return this.session?.suspendRevision ?? 0;
	}

	getSuspendData(): string | null {
		this.ensureInitialized();
		const payload = this.loadSuspendPayload();
		return payload.custom ?? null;
	}

	// ---- commit ------------------------------------------------------------

	setCommitPreparation(prepare: () => void): void {
		if (this.session) this.session.prepareCommit = prepare;
	}

	commit(): boolean {
		this.ensureInitialized();
		this.loadSuspendPayload();
		if (!prepareRuntimeCommit(this.session as ScormSessionState)) return false;
		return this.commitToLms();
	}

	private commitToLms(terminating = false): boolean {
		if (
			!this.flushCompletion(terminating) ||
			!this.prepareExit(terminating) ||
			!this.canCallLms(terminating)
		)
			return false;
		if (
			!this.session ||
			!this.lmsSetValue("cmi.core.session_time", sessionTime(this.session, "1.2"), terminating)
		)
			return false;
		const result = this.api?.LMSCommit("");
		if (!this.canCallLms(terminating)) return false;
		if (result !== "true") {
			this.throwIfError("LMSCommit", terminating);
			return false;
		}
		return true;
	}

	// ---- internal helpers ---------------------------------------------------

	private flushCompletion(terminating = false): boolean {
		if (!this.canCallLms(terminating)) return false;
		if (this.unreadableSuspendData) return true;
		const pending = this.session?.pendingCompletion;
		if (pending === undefined) return true;
		// A page can complete before an assessment submits in the same save. Transfer
		// status after its score; Cornerstone locks transcript score at completion.
		if (!this.lmsSetValue("cmi.core.lesson_status", pending, terminating)) return false;
		if (this.session?.pendingCompletion === pending) delete this.session.pendingCompletion;
		return true;
	}

	private prepareExit(terminating = false): boolean {
		// Persist the attempt across a window close; page navigation only commits. A failed
		// attempt stays suspended so the learner can resume it and retry toward the pass mark.
		const terminal =
			!this.session?.outcomeWaiting &&
			["completed", "passed"].includes(this.lmsGetValue("cmi.core.lesson_status", terminating));
		return this.lmsSetValue("cmi.core.exit", terminal ? "" : "suspend", terminating);
	}

	private canCallLms(terminating = false): boolean {
		return !!this.api && sessionAllowsCalls(this.session, terminating);
	}

	private ensureInitialized(): void {
		if (!this.initialized || !this.canCallLms()) {
			throw new Error("SCORM 1.2 runtime is not initialized. Call initialize() first.");
		}
	}

	private lmsGetValue(element: string, terminating = false): string {
		if (!this.canCallLms(terminating)) return "";
		const value = this.api?.LMSGetValue(element) ?? "";
		if (!this.canCallLms(terminating)) return "";
		this.throwIfError(`LMSGetValue("${element}")`, terminating);
		return value;
	}

	private lmsSetValue(element: string, value: string, terminating = false): boolean {
		const write = (bytes: string) => {
			if (!this.canCallLms(terminating)) return false;
			const result = this.api?.LMSSetValue(element, bytes);
			if (!this.canCallLms(terminating)) return false;
			if (result !== "true")
				this.throwIfError(`LMSSetValue("${element}", "${bytes}")`, terminating);
			return result === "true";
		};
		return element === "cmi.suspend_data" &&
			(this.session?.objectiveReplay || this.session?.suspendWrite)
			? writeScormSuspendData(this.session, value, write)
			: write(value);
	}

	private optionalSetValue(element: string, value: string): void {
		if (this.canCallLms()) this.api?.LMSSetValue(element, value);
	}

	/**
	 * Check LMSGetLastError and throw a descriptive Error when the error code
	 * is non-zero.
	 */
	private throwIfError(context: string, terminating = false): void {
		if (!this.canCallLms(terminating)) return;
		// String() guards against LMS implementations that return numbers.
		const code = String(this.api?.LMSGetLastError() ?? "0");
		if (!this.canCallLms(terminating)) return;
		if (code !== "0") {
			const message = String(this.api?.LMSGetErrorString(code) ?? "Unknown error");
			if (!this.canCallLms(terminating)) return;
			const diagnostic = String(this.api?.LMSGetDiagnostic(code) ?? "");
			if (!this.canCallLms(terminating)) return;
			throw new Error(
				`SCORM 1.2 error in ${context}: [${code}] ${message}${diagnostic ? ` (${diagnostic})` : ""}`,
			);
		}
	}

	// ---- suspend data payload management -----------------------------------

	private loadSuspendPayload(): Scorm12SuspendData {
		if (this.submission) return JSON.parse(JSON.stringify(this.submission.data));
		if (this.unreadableSuspendData) return { visitedPages: [], interactions: [] };
		const raw = this.canCallLms() ? this.api?.LMSGetValue("cmi.suspend_data") : "";
		if (raw) {
			const data = (this.suspendDataCodec?.parse ?? parseScorm12SuspendData)(raw);
			if (data) return data;
			// Keep the original LMS bytes until recovery, rather than certify an empty attempt.
			this.unreadableSuspendData = true;
			if (this.session) delete this.session.pendingCompletion;
			// Recovery stays in this tab and cannot cross courses, learners or damaged attempts.
			// Failure leaves the receipt not-saved and the on-screen draft editable.
			if (this.courseId && raw.length <= LEARNER_STATE_MAX_BYTES) {
				try {
					const learnerId = this.lmsGetValue("cmi.core.student_id").trim();
					if (learnerId)
						this.heldDrafts = new LocalStorageRuntime(
							window.sessionStorage,
							JSON.stringify(["scorm12-unsaved", this.courseId, learnerId, raw]),
						);
				} catch {
					this.heldDrafts = undefined;
				}
			}
		}
		return { visitedPages: [], interactions: [] };
	}

	private saveSuspendPayload(data: Scorm12SuspendData): boolean {
		if (this.unreadableSuspendData) return false;
		if (this.submission && !this.reportingSubmission) {
			this.submission.data = data;
			return true;
		}
		if (globalThis.__praxityPrivateState !== false && data.custom)
			data.custom = filterPrivateSuspendData(data.custom, this.blockStatePolicy);
		// Filter before compression; compressed bytes must never hide private fields from policy.
		if (globalThis.__praxityPrivateState !== false)
			data = JSON.parse(filterPrivateSuspendData(JSON.stringify(data), this.blockStatePolicy));
		const serialized = this.suspendDataCodec
			? preflightScorm12SuspendData(
					data,
					this.suspendDataCodec.serialize(data),
					this.suspendDataCodec.parse,
				)
			: fitScorm12SuspendData(data);
		return this.lmsSetValue("cmi.suspend_data", serialized);
	}
}
