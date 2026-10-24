import type {} from "../privacy-capability";
/**
 * SCORM 2004 (4th Edition) runtime wrapper.
 *
 * Communicates with the LMS via the `API_1484_11` object that the LMS injects
 * into the content frame hierarchy.  Method names follow the IEEE 1484.11.2
 * standard: Initialize, GetValue, SetValue, Commit, Terminate (no "LMS" prefix).
 *
 * Key data-model differences from SCORM 1.2:
 * - Completion is split: `cmi.completion_status` + `cmi.success_status`
 * - Scores use `cmi.score.{raw,min,max,scaled}`
 * - Bookmarks use `cmi.location` (not cmi.core.lesson_location)
 * - Interactions use `cmi.interactions.N.*` with `learner_response` (not student_response)
 */

// See docs/context/scorm-xapi-standards.md for spec references

import { filterPrivateSuspendData } from "@praxity/shared-blocks/block-state-policy";
import { findWindowProperty, type WindowLike } from "../api-discovery.ts";
import { truncateInteractionResponse } from "../interaction-response";
import {
	assessmentAttemptMetadata,
	assessmentRowsEvidence,
	type InteractionEvidence,
	type InteractionRecord,
	interactionDescription,
	LMS_DESTINATIONS,
	prepareRuntimeCommit,
	type SCORMRuntime,
	type TrackInteractionOptions,
} from "../types.ts";
import { deviceAttemptId } from "./device-attempt";
import { writeObjectiveId } from "./objective-slots";
import {
	configureSessionOutcome,
	getSessionState,
	readSessionState,
	type ScormSessionState,
	sessionAllowsCalls,
	writeSessionState,
} from "./session.ts";
import { sessionTime } from "./session-time.ts";

/** Dormant export so ordinary adapter instances do not retain evidence code in bundles. */
export function readScorm2004InteractionEvidence(raw: string): InteractionEvidence[] | null {
	try {
		const value = JSON.parse(raw) as { interactions?: unknown } | null;
		if (!Array.isArray(value?.interactions)) return null;
		return assessmentRowsEvidence(value.interactions);
	} catch {
		return null;
	}
}

export const SCORM2004_RESPONSE_LIMIT = 3900;

function scormInteractionType(assessmentType?: string): string {
	if (assessmentType === "textResponse" || assessmentType === "fillBlank") return "long-fill-in";
	if (assessmentType === "sequence") return "sequencing";
	if (assessmentType === "matrix") return "likert";
	return assessmentType === "matching" || assessmentType === "likert" ? assessmentType : "choice";
}

/** Shape of the SCORM 2004 API_1484_11 object exposed by the LMS. */
export interface SCORM2004API {
	Initialize(param: string): string;
	Terminate(param: string): string;
	GetValue(element: string): string;
	SetValue(element: string, value: string): string;
	Commit(param: string): string;
	GetLastError(): string;
	GetErrorString(errorCode: string): string;
	GetDiagnostic(errorCode: string): string;
}

/**
 * Minimal subset of `Window` used by the API-discovery logic.
 * Accepting this interface (instead of the global `window` directly) allows
 * the class to be unit-tested in a Node environment without jsdom.
 */
export type { WindowLike } from "../api-discovery.ts";

export interface Scorm2004Runtime {
	setBlockStatePolicy(policy: Readonly<Record<string, "device" | "lms">>): void;
	getLearnerIdentity(): { learnerId: string; attemptId: string; newAttempt: boolean } | null;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The static capability block installs these methods; interface declarations erase without emitting fields that shadow the prototype.
export class Scorm2004Runtime implements SCORMRuntime {
	configureOutcome(policy: { waiting: boolean }): void {
		configureSessionOutcome(this.session, policy);
	}
	readonly destinations = LMS_DESTINATIONS;
	static {
		if (globalThis.__praxityPrivateState !== false) {
			Scorm2004Runtime.prototype.setBlockStatePolicy = function (
				this: Scorm2004Runtime,
				policy: Readonly<Record<string, "device" | "lms">>,
			): void {
				this.blockStatePolicy = { ...policy };
			};
			Scorm2004Runtime.prototype.getLearnerIdentity = function (
				this: Scorm2004Runtime,
			): { learnerId: string; attemptId: string; newAttempt: boolean } | null {
				const learnerId = this.getValue("cmi.learner_id").trim();
				return learnerId
					? {
							learnerId,
							...deviceAttemptId(this, this.session, this.getValue("cmi.entry")),
						}
					: null;
			};
		}
	}

	private api: SCORM2004API | null = null;
	private initialized = false;
	private session: ScormSessionState | null = null;
	private interactionCount = 0;
	private win: WindowLike;
	private blockStatePolicy: Readonly<Record<string, "device" | "lms">> = {};

	/**
	 * @param win - The window reference used for API discovery.  Defaults to
	 *              the global `window` when running in a browser.  Pass a mock
	 *              object in tests.
	 */
	constructor(win?: WindowLike) {
		this.win =
			win ??
			(typeof window !== "undefined"
				? (window as unknown as WindowLike)
				: ({ parent: null as unknown as WindowLike } as WindowLike));
	}

	// -------------------------------------------------------------------
	// API discovery
	// -------------------------------------------------------------------

	/**
	 * Walk up the `window.parent` chain (and check `window.opener`) to locate
	 * the `API_1484_11` object injected by the LMS.  Returns `true` when the
	 * API is found.
	 */
	findAPI(): boolean {
		this.api = (findWindowProperty(this.win, "API_1484_11") as SCORM2004API | null) ?? null;
		return this.api !== null;
	}

	// -------------------------------------------------------------------
	// Core SCORM methods
	// -------------------------------------------------------------------

	initialize(): boolean {
		if (this.session?.closed || this.session?.terminationInProgress) return false;
		if (this.initialized) return true;
		if (!this.api && !this.findAPI()) {
			return false;
		}
		this.session ??=
			getSessionState(this.api, this.win) ??
			writeSessionState(this.api, readSessionState(this.api, this.win), this.win);
		if (!this.session || !this.canCallLms()) return false;
		const startedAt = Date.now();
		if (!readSessionState(this.api, this.win)) {
			const result = this.api?.Initialize("");
			if (!this.canCallLms()) return false;
			if (result !== "true") {
				const code = String(this.api?.GetLastError() ?? "0");
				if (!this.canCallLms() || code !== "103") return false;
			}
		}
		this.session = writeSessionState(this.api, true, this.win);
		if (!this.session || !this.canCallLms()) return false;
		this.session.startedAt ??= startedAt;
		const completion = this.getLmsValue("cmi.completion_status") || "unknown";
		if (["unknown", "not attempted"].includes(completion)) {
			if (!this.setLmsValue("cmi.completion_status", "incomplete")) return false;
		}
		this.interactionCount =
			Number.parseInt(this.getLmsValue("cmi.interactions._count") || "0", 10) || 0;
		if (!this.canCallLms()) return false;
		this.initialized = true;
		return true;
	}

	terminate(explicitFinish = false): boolean {
		if (this.session?.closed) return this.session.terminationSucceeded;
		if (!this.initialized || !this.canCallLms() || !this.session) return false;
		const session = this.session;
		if (!prepareRuntimeCommit(session)) return false;
		// Block every retained adapter before the first final-state LMS callback.
		session.terminationInProgress = true;
		try {
			if (!this.flushCompletion(true)) return false;
			if (
				explicitFinish &&
				!session.outcomeWaiting &&
				!session.courseFailure &&
				!this.setLmsValue("cmi.completion_status", "completed", true)
			)
				return false;
			if (!this.commitToLms(true) || !this.canCallLms(true)) return false;
			// Terminate failure leaves LMS state uncertain, so no caller may retry.
			session.closed = true;
			session.initialized = false;
			this.initialized = false;
			session.terminationSucceeded = this.api?.Terminate("") === "true";
			return session.terminationSucceeded;
		} finally {
			// Exit or commit failures keep the shared launch open for a later retry.
			session.terminationInProgress = false;
		}
	}

	getValue(element: string): string {
		return this.initialized ? this.getLmsValue(element) : "";
	}

	setValue(element: string, value: string): boolean {
		if (element === "cmi.suspend_data")
			if (globalThis.__praxityPrivateState !== false)
				value = filterPrivateSuspendData(value, this.blockStatePolicy);
		return this.initialized && this.setLmsValue(element, value);
	}

	setCommitPreparation(prepare: () => void): void {
		if (this.session) this.session.prepareCommit = prepare;
	}

	commit(): boolean {
		return this.initialized && this.commitToLms();
	}

	private commitToLms(terminating = false): boolean {
		if (
			!this.canCallLms(terminating) ||
			(!terminating && !prepareRuntimeCommit(this.session as ScormSessionState)) ||
			!this.flushCompletion(terminating) ||
			!this.prepareExit(terminating) ||
			!this.canCallLms(terminating)
		)
			return false;
		if (
			!this.session ||
			!this.setLmsValue("cmi.session_time", sessionTime(this.session, "2004"), terminating)
		)
			return false;
		const result = this.api?.Commit("");
		return this.canCallLms(terminating) && result === "true";
	}

	private flushCompletion(terminating = false): boolean {
		if (!this.canCallLms(terminating)) return false;
		const pending = this.session?.pendingCompletion;
		if (pending === undefined) return true;
		// Keep immediate course decisions, but send status after the save's score and
		// success values. Cornerstone locks transcript score when completion arrives.
		if (!this.setLmsValue("cmi.completion_status", pending, terminating)) return false;
		if (this.session?.pendingCompletion === pending) delete this.session.pendingCompletion;
		return true;
	}

	private prepareExit(terminating = false): boolean {
		// ADL RTE: suspended exit preserves the attempt and yields entry=resume. With a pass
		// mark, keep the attempt open until it is passed so the learner can finish or retry.
		const finished =
			!this.session?.outcomeWaiting &&
			this.getLmsValue("cmi.completion_status", terminating) === "completed" &&
			(!this.session?.successTracked ||
				this.getLmsValue("cmi.success_status", terminating) === "passed");
		return this.setLmsValue("cmi.exit", finished ? "normal" : "suspend", terminating);
	}

	private canCallLms(terminating = false): boolean {
		return !!this.api && sessionAllowsCalls(this.session, terminating);
	}

	private getLmsValue(element: string, terminating = false): string {
		if (!this.canCallLms(terminating)) return "";
		const value = this.api?.GetValue(element) ?? "";
		if (!this.canCallLms(terminating)) return "";
		this.checkError(terminating, element);
		return value;
	}

	private setLmsValue(element: string, value: string, terminating = false): boolean {
		if (!this.canCallLms(terminating)) return false;
		const result = this.api?.SetValue(element, value);
		if (!this.canCallLms(terminating)) return false;
		this.checkError(terminating, element);
		return result === "true";
	}

	// -------------------------------------------------------------------
	// Error handling
	// -------------------------------------------------------------------

	getLastError(): string {
		if (!this.canCallLms()) {
			return "0";
		}
		return this.api?.GetLastError() ?? "0";
	}

	private checkError(terminating: boolean, element: string): void {
		if (!this.canCallLms(terminating)) return;
		const code = this.api?.GetLastError() ?? "0";
		if (!this.canCallLms(terminating)) return;
		if (code !== "0") {
			const message = this.api?.GetErrorString(code);
			if (!this.canCallLms(terminating)) return;
			const diagnostic = this.api?.GetDiagnostic(code);
			if (!this.canCallLms(terminating)) return;
			console.warn(
				`[SCORM 2004] ${element} Error ${code}: ${message}${diagnostic ? ` (${diagnostic})` : ""}`,
			);
		}
	}

	// -------------------------------------------------------------------
	// Page tracking (stored in cmi.suspend_data as JSON)
	// -------------------------------------------------------------------

	trackPageVisit(pageId: string): void {
		const data = this.loadSuspendDataObject();
		const pages: string[] = (data.visitedPages as string[]) ?? [];
		if (!pages.includes(pageId)) {
			pages.push(pageId);
			data.visitedPages = pages;
			this.saveSuspendDataObject(data);
		}
	}

	getVisitedPages(): string[] {
		const data = this.loadSuspendDataObject();
		return (data.visitedPages as string[]) ?? [];
	}

	// -------------------------------------------------------------------
	// Interactions (cmi.interactions.N.*)
	// -------------------------------------------------------------------

	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		options?: TrackInteractionOptions,
	): void {
		if (globalThis.__praxityPrivateState !== false && this.blockStatePolicy[id] === "device")
			return;
		const n = this.interactionCount;
		const storedResponse =
			options?.assessmentType === "choice"
				? response
				: truncateInteractionResponse(response, SCORM2004_RESPONSE_LIMIT);

		const accepted = this.setValue(`cmi.interactions.${n}.id`, id);
		// An accepted ID consumes the row, even if a later reporting field fails.
		if (accepted) this.interactionCount++;

		// Mirror in suspend_data for offline retrieval
		const data = this.loadSuspendDataObject();
		((data.interactions ??= []) as InteractionRecord[]).push({
			id,
			response: storedResponse,
			correct,
			score,
			...assessmentAttemptMetadata(options),
			timestamp: Date.now(),
		});
		this.saveSuspendDataObject(data);

		if (accepted) {
			this.report(`cmi.interactions.${n}.type`, scormInteractionType(options?.assessmentType));
			this.report(`cmi.interactions.${n}.learner_response`, storedResponse);
			this.report(
				`cmi.interactions.${n}.result`,
				options?.result ?? (correct === undefined ? "neutral" : correct ? "correct" : "incorrect"),
			);
			this.report(
				`cmi.interactions.${n}.description`,
				interactionDescription(
					options?.description ?? `Interaction ${id}`,
					options?.language ?? "",
				),
			);

			if (score !== undefined) {
				this.report(`cmi.interactions.${n}.weighting`, String(score));
			}

			this.report(
				`cmi.interactions.${n}.timestamp`,
				// RTE 4.1.1.7: a time zone designator requires fractional seconds (at most two digits).
				new Date().toISOString().replace(/\dZ$/, "Z"),
			);
		}
		if (storedResponse.length < response.length)
			options?.onResponseTruncated?.(storedResponse.length);
	}

	private report(element: string, value: string): void {
		try {
			this.setValue(element, value);
		} catch (error) {
			console.warn(element, error);
		}
	}

	getInteractions(): InteractionRecord[] {
		const data = this.loadSuspendDataObject();
		const interactions = (data.interactions as InteractionRecord[]) ?? [];
		const reportable =
			globalThis.__praxityPrivateState !== false
				? interactions.filter((record) => this.blockStatePolicy[record.id] !== "device")
				: interactions;
		return reportable.map((record) => ({ ...record, ...assessmentAttemptMetadata(record) }));
	}

	setCourseFailure(failed: boolean): void {
		if (this.initialized && this.canCallLms() && this.session) this.session.courseFailure = failed;
	}

	// -------------------------------------------------------------------
	// Objectives (cmi.objectives.N.*)
	// -------------------------------------------------------------------

	trackObjective(id: string, score: number, passed: boolean): void {
		if (globalThis.__praxityPrivateState !== false && this.blockStatePolicy[id] === "device")
			return;
		try {
			const n = writeObjectiveId(
				id,
				(element) => {
					const value = this.getValue(element);
					return this.getLastError() === "0" ? value : null;
				},
				(element, value) => this.setValue(element, value),
			);
			if (n === undefined) return;
			this.setValue(`cmi.objectives.${n}.score.raw`, String(score));
			this.setValue(`cmi.objectives.${n}.success_status`, passed ? "passed" : "failed");
		} catch {
			// Non-critical: LMS objectives support varies.
		}
	}

	// -------------------------------------------------------------------
	// Completion & success status
	// -------------------------------------------------------------------

	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void {
		if (!this.initialized || !this.canCallLms() || !this.session) return;
		if (status === "incomplete" || status === "completed") {
			this.session.pendingCompletion = status;
		} else if (status === "passed" || status === "failed") {
			this.setSuccess(status);
			if (this.canCallLms()) this.session.pendingCompletion = "completed";
		}
	}

	getCompletion(): string {
		if (!this.initialized || !this.canCallLms()) return "unknown";
		return this.session?.pendingCompletion ?? (this.getValue("cmi.completion_status") || "unknown");
	}

	setSuccess(status: "passed" | "failed" | "unknown"): void {
		if (!this.initialized || !this.canCallLms()) return;
		// Success policy belongs to the launch, including legacy quiz and utility pages.
		if (this.session) this.session.successTracked = true;
		this.setValue("cmi.success_status", status);
	}

	getSuccess(): string {
		return this.getValue("cmi.success_status") || "unknown";
	}

	// -------------------------------------------------------------------
	// Scores (cmi.score.raw / min / max / scaled)
	// -------------------------------------------------------------------

	setScore(raw: number, min: number, max: number): void {
		this.setValue("cmi.score.raw", String(raw));
		this.setValue("cmi.score.min", String(min));
		this.setValue("cmi.score.max", String(max));

		// SCORM 2004 also supports a scaled score in [-1, 1]
		const range = max - min;
		if (range > 0) {
			const scaled = Math.max(-1, Math.min(1, (raw - min) / range));
			this.setValue("cmi.score.scaled", String(scaled));
		}
	}

	getScore(): { raw: number; min: number; max: number } | null {
		const raw = this.getValue("cmi.score.raw");
		const min = this.getValue("cmi.score.min");
		const max = this.getValue("cmi.score.max");
		if (!raw) {
			return null;
		}
		return {
			raw: Number.parseFloat(raw),
			min: Number.parseFloat(min) || 0,
			max: Number.parseFloat(max) || 100,
		};
	}

	// -------------------------------------------------------------------
	// Bookmarks (cmi.location)
	// -------------------------------------------------------------------

	setBookmark(pageId: string): void {
		this.setValue("cmi.location", pageId);
	}

	getBookmark(): string | null {
		const value = this.getValue("cmi.location");
		return value || null;
	}

	// -------------------------------------------------------------------
	// Suspend data (cmi.suspend_data)
	// -------------------------------------------------------------------

	setSuspendData(data: string): boolean {
		return this.setValue("cmi.suspend_data", data);
	}

	getSuspendData(): string | null {
		const value = this.getValue("cmi.suspend_data");
		return value || null;
	}

	// -------------------------------------------------------------------
	// Internal suspend-data helpers (JSON envelope)
	// -------------------------------------------------------------------

	private loadSuspendDataObject(): Record<string, unknown> {
		const raw = this.getValue("cmi.suspend_data");
		if (!raw) {
			return {};
		}
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	private saveSuspendDataObject(obj: Record<string, unknown>): void {
		this.setValue("cmi.suspend_data", JSON.stringify(obj));
	}
}
