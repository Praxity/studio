import type {} from "../privacy-capability";
import { applyXapiPrivatePolicy } from "../private-xapi-policy";

/**
 * xAPI (Experience API / Tin Can) runtime wrapper.
 *
 * Unlike SCORM 1.2 and 2004, xAPI does not use a window-injected API object.
 * Instead, it sends JSON statements to a Learning Record Store (LRS) via HTTP.
 * The LRS endpoint and authorization credentials are configured at build time.
 * Actor identity is resolved either from LMS launch context (`actorMode: "lms"`)
 * or from build-time config (`actorMode: "manual"`).
 *
 * Local state (bookmarks, visited pages, interactions, suspend data, completion
 * and success) is kept in memory and, when a course ID is given, persisted to
 * localStorage per course and learner, because the xAPI spec does not prescribe a
 * bookmarking or suspend-data mechanism and each course page creates a new runtime.
 */

// See docs/context/scorm-xapi-standards.md for spec references

import { filterPrivateSuspendData } from "@praxity/shared-blocks/block-state-policy";
import { declaredCourseActivityId, isAbsoluteIri } from "../activity-id.ts";
import {
	DEVICE_DESTINATIONS,
	type InteractionRecord,
	prepareRuntimeCommit,
	type RuntimeCommitPreparation,
	type RuntimeDestinations,
	type SCORMRuntime,
	type TrackInteractionOptions,
} from "../types.ts";
import { resolveLaunchAttempt } from "./device-attempt";

// ---------------------------------------------------------------------------
// ADL verb registry
// ---------------------------------------------------------------------------

const ADL_VERB_BASE = "http://adlnet.gov/expapi/verbs";

const VERBS = {
	initialized: { id: `${ADL_VERB_BASE}/initialized`, display: "initialized" },
	attempted: { id: `${ADL_VERB_BASE}/attempted`, display: "attempted" },
	completed: { id: `${ADL_VERB_BASE}/completed`, display: "completed" },
	passed: { id: `${ADL_VERB_BASE}/passed`, display: "passed" },
	failed: { id: `${ADL_VERB_BASE}/failed`, display: "failed" },
	answered: { id: `${ADL_VERB_BASE}/answered`, display: "answered" },
	experienced: { id: `${ADL_VERB_BASE}/experienced`, display: "experienced" },
} as const;

type VerbKey = keyof typeof VERBS;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface XapiActor {
	name: string;
	mbox: string;
}

export interface XapiConfig {
	/** LRS endpoint URL (e.g. "https://lrs.example.com/xapi/statements"). */
	endpoint: string;
	/** Authorization header value (e.g. "Basic dXNlcjpwYXNz"). */
	auth: string;
	/** Actor (learner) identity. */
	actor?: XapiActor;
	/** Explicit activity base. Its course object is `${activityBase}/course`. */
	activityBase?: string;
	/** Actor resolution mode. "lms" resolves from launch context; "manual" requires actor in config. */
	actorMode?: "lms" | "manual";
}

export interface XapiVerb {
	id: string;
	display: { "en-US": string };
}

export interface XapiObject {
	id: string;
	definition?: {
		name?: Record<string, string>;
		description?: Record<string, string>;
		type?: string;
		interactionType?: "choice" | "long-fill-in";
		choices?: Array<{ id: string; description: Record<string, string> }>;
	};
}

export interface XapiScore {
	raw?: number;
	min?: number;
	max?: number;
	scaled?: number;
}

export interface XapiResult {
	score?: XapiScore;
	success?: boolean;
	completion?: boolean;
	response?: string;
}

export interface XapiStatement {
	actor: {
		name: string;
		mbox: string;
	};
	verb: XapiVerb;
	object: XapiObject;
	result?: XapiResult;
	context?: {
		extensions?: Record<string, unknown>;
	};
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

/** Some LMS frames block Web Storage; even reading the property can throw. */
function browserStorage(name: "localStorage" | "sessionStorage"): Storage | null {
	try {
		return typeof window === "undefined" ? null : (window[name] ?? null);
	} catch {
		return null;
	}
}

export interface XapiRuntime {
	setBlockStatePolicy(policy: Readonly<Record<string, "device" | "lms">>): void;
	getLearnerIdentity(): { learnerId: string; attemptId?: string } | null;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The static capability block installs these methods; interface declarations erase without emitting fields that shadow the prototype.
export class XapiRuntime implements SCORMRuntime {
	get destinations(): RuntimeDestinations {
		return this.sendEnabled ? { reporting: "lms", state: "device" } : DEVICE_DESTINATIONS;
	}
	static {
		if (globalThis.__praxityPrivateState !== false) {
			XapiRuntime.prototype.setBlockStatePolicy = function (
				this: XapiRuntime,
				policy: Readonly<Record<string, "device" | "lms">>,
			): void {
				this.blockStatePolicy = { ...policy };
				Object.assign(
					this,
					applyXapiPrivatePolicy(policy, this.interactions, this.suspendData, this.outbox),
				);
			};
			XapiRuntime.prototype.getLearnerIdentity = function (
				this: XapiRuntime,
			): { learnerId: string; attemptId?: string } | null {
				if (this.config.actorMode !== "lms" || !this.actor) return null;
				const attemptId = this.courseId
					? resolveLaunchAttempt(this.courseId, this.actor.mbox)
					: undefined;
				return { learnerId: this.actor.mbox, ...(attemptId ? { attemptId } : {}) };
			};
		}
	}

	private config: XapiConfig;
	private actor: XapiActor | null;
	private sendEnabled: boolean;
	private initialized = false;
	private terminationResult = true;
	private commitPreparation: RuntimeCommitPreparation = {};
	private completionStatus = "incomplete";
	private successStatus: "passed" | "failed" | "unknown" = "unknown";
	private score: { raw: number; min: number; max: number } | null = null;
	private bookmark: string | null = null;
	private suspendData: string | null = null;
	private visitedPages: string[] = [];
	private interactions: InteractionRecord[] = [];
	private pendingStatements: XapiStatement[] = [];
	/** Statements the LRS did not accept; resent when the next page initializes. */
	private outbox: XapiStatement[] = [];

	private storage: Storage | null = null;
	private storageKey = "";
	private courseActivityId: string;
	private courseId?: string;
	private blockStatePolicy: Readonly<Record<string, "device" | "lms">> = {};

	constructor(
		config: XapiConfig,
		courseId?: string,
		storage?: Storage,
		declaredActivityId?: string,
	) {
		this.config = config;
		if (globalThis.__praxityPrivateState !== false) this.courseId = courseId;
		this.courseActivityId =
			this.resolveLaunchActivityId(courseId) ??
			(declaredActivityId && isAbsoluteIri(declaredActivityId) ? declaredActivityId : undefined) ??
			(courseId
				? declaredCourseActivityId(courseId, config.activityBase)
				: config.activityBase
					? declaredCourseActivityId("", config.activityBase)
					: `${config.endpoint.replace(/\/$/, "")}/course`);
		if (config.actorMode === "manual") {
			this.actor = config.actor ?? null;
			this.sendEnabled = this.actor !== null;
		} else if (config.actorMode === "lms") {
			this.actor = this.resolveLaunchActor(courseId);
			this.sendEnabled = this.actor !== null;
		} else if (config.actor) {
			// Backward compatibility for direct actor-in-config usage.
			this.actor = config.actor;
			this.sendEnabled = true;
		} else {
			this.actor = null;
			this.sendEnabled = false;
		}

		if (!this.sendEnabled) {
			console.warn(
				"[Praxity Studio xAPI] xAPI actor not resolved from LMS launch context. Statements will not be sent.",
			);
		}
		// Persist only for an identified learner so two learners never share one saved state.
		if (courseId && this.actor) {
			this.storage = storage ?? browserStorage("localStorage");
			this.storageKey = `praxity-xapi:${encodeURIComponent(courseId)}:${encodeURIComponent(this.actor.mbox)}`;
			this.restore();
		}
	}

	/** Restore this learner's course state; stored data is untrusted, so each field is checked. */
	private restore(): void {
		try {
			const value = JSON.parse(this.storage?.getItem(this.storageKey) ?? "null") as Record<
				string,
				unknown
			> | null;
			if (!value || typeof value !== "object") return;
			const isString = (item: unknown): item is string => typeof item === "string";
			const isNumber = (item: unknown): item is number =>
				typeof item === "number" && Number.isFinite(item);
			if (Array.isArray(value.visitedPages))
				this.visitedPages = value.visitedPages.filter(isString);
			if (Array.isArray(value.interactions))
				this.interactions = value.interactions.flatMap((item) => {
					const record = item as Record<string, unknown>;
					return record &&
						isString(record.id) &&
						isString(record.response) &&
						isNumber(record.timestamp) &&
						(record.correct === undefined || typeof record.correct === "boolean") &&
						(record.score === undefined || isNumber(record.score))
						? [record as unknown as InteractionRecord]
						: [];
				});
			if (["incomplete", "completed", "passed", "failed"].includes(String(value.completionStatus)))
				this.completionStatus = value.completionStatus as string;
			if (value.successStatus === "passed" || value.successStatus === "failed")
				this.successStatus = value.successStatus;
			const score = value.score as Record<string, unknown> | null;
			if (score && isNumber(score.raw) && isNumber(score.min) && isNumber(score.max))
				this.score = { raw: score.raw, min: score.min, max: score.max };
			if (isString(value.bookmark)) this.bookmark = value.bookmark;
			if (isString(value.suspendData)) this.suspendData = value.suspendData;
			if (Array.isArray(value.outbox))
				this.outbox = value.outbox.filter(
					(item): item is XapiStatement =>
						!!item && typeof item === "object" && isString((item as XapiStatement).verb?.id),
				);
		} catch {
			// Unreadable or blocked storage starts a fresh in-memory state.
		}
	}

	private persist(): boolean {
		try {
			if (!this.storage) return false;
			this.storage?.setItem(
				this.storageKey,
				JSON.stringify({
					visitedPages: this.visitedPages,
					interactions: this.interactions,
					completionStatus: this.completionStatus,
					successStatus: this.successStatus,
					score: this.score,
					bookmark: this.bookmark,
					suspendData: this.suspendData,
					outbox: this.outbox,
				}),
			);
			return true;
		} catch {
			// Full or blocked storage keeps the in-memory state for this page.
			return false;
		}
	}

	// -------------------------------------------------------------------
	// Statement building
	// -------------------------------------------------------------------

	/**
	 * Build a full xAPI statement with the configured actor and an ISO timestamp.
	 */
	buildStatement(verb: VerbKey, object: XapiObject, result?: XapiResult): XapiStatement {
		const verbDef = VERBS[verb];
		const actor = this.actor ?? { name: "Unknown Learner", mbox: "mailto:unknown@example.com" };
		const statement: XapiStatement = {
			actor: {
				name: actor.name,
				mbox: actor.mbox.startsWith("mailto:") ? actor.mbox : `mailto:${actor.mbox}`,
			},
			verb: {
				id: verbDef.id,
				display: { "en-US": verbDef.display },
			},
			object,
			timestamp: new Date().toISOString(),
		};

		if (result) {
			statement.result = result;
		}

		return statement;
	}

	/**
	 * POST a statement to the configured LRS endpoint.
	 * Failures are logged but never thrown -- the LRS may be unreachable when
	 * the learner is offline.
	 */
	async sendStatement(statement: XapiStatement): Promise<void> {
		if (!this.sendEnabled) {
			return;
		}

		try {
			const response = await fetch(this.config.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: this.config.auth,
					"X-Experience-API-Version": "1.0.3",
				},
				body: JSON.stringify(statement),
			});
			if (!response.ok) throw new Error(`LRS responded ${response.status}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[xAPI] Failed to send statement: ${message}`);
			// ponytail: keeps the newest 50 unsent statements; a longer LRS outage drops the oldest.
			this.outbox = [...this.outbox, statement].slice(-50);
			this.persist();
		}
	}

	// -------------------------------------------------------------------
	// SCORMRuntime interface
	// -------------------------------------------------------------------

	initialize(): boolean {
		if (this.initialized) {
			return true;
		}

		this.initialized = true;
		if (this.sendEnabled) {
			const unsent = this.outbox;
			this.outbox = [];
			this.persist();
			for (const statement of unsent) void this.sendStatement(statement);
			const statement = this.buildStatement("initialized", this.courseObject());
			this.pendingStatements.push(statement);
			void this.sendStatement(statement);
		}

		return true;
	}

	suppressTerminationResult(): void {
		this.terminationResult = false;
	}

	terminate(): boolean {
		const reportResult = this.terminationResult;
		this.terminationResult = true;
		if (!this.initialized) {
			return false;
		}
		if (!prepareRuntimeCommit(this.commitPreparation)) return false;

		if (this.sendEnabled && reportResult) {
			const verb = this.completionVerbKey();
			const result = this.buildCompletionResult();
			const statement = this.buildStatement(verb, this.courseObject(), result);
			this.pendingStatements.push(statement);
			void this.sendStatement(statement);
		}

		this.initialized = false;
		return true;
	}

	trackPageVisit(pageId: string): void {
		if (!this.visitedPages.includes(pageId)) {
			this.visitedPages.push(pageId);
			this.persist();
		}

		const object: XapiObject = {
			id: this.activityId(`page/${pageId}`),
			definition: {
				name: { "en-US": pageId },
				type: "http://adlnet.gov/expapi/activities/module",
			},
		};

		if (this.sendEnabled) {
			const statement = this.buildStatement("experienced", object);
			this.pendingStatements.push(statement);
			void this.sendStatement(statement);
		}
	}

	getVisitedPages(): string[] {
		return [...this.visitedPages];
	}

	trackInteraction(
		id: string,
		response: string,
		correct?: boolean,
		score?: number,
		options?: TrackInteractionOptions,
	): void {
		if (globalThis.__praxityPrivateState !== false && this.blockStatePolicy[id] === "device")
			return;
		const record: InteractionRecord = {
			id,
			response,
			correct,
			score,
			timestamp: Date.now(),
		};
		// Keep the latest attempt per question, plus its latest scored one, so saved state stays bounded.
		const isScored = (item: InteractionRecord) => typeof item.score === "number";
		const lastScored = isScored(record)
			? undefined
			: [...this.interactions].reverse().find((item) => item.id === id && isScored(item));
		this.interactions = [
			...this.interactions.filter((item) => item.id !== id),
			...(lastScored ? [lastScored] : []),
			record,
		];
		this.persist();

		const language =
			typeof options?.language === "string" && options.language ? options.language : "en-US";
		const description = (options?.description ?? `Interaction ${id}`).replace(/\s+/gu, " ").trim();
		const object: XapiObject = {
			id: this.activityId(`interaction/${id}`),
			definition: {
				name:
					globalThis.__praxityPrivateState !== false && options?.assessmentType === "textResponse"
						? { [language]: description }
						: { "en-US": `Interaction ${id}` },
				description: { [language]: description },
				type: "http://adlnet.gov/expapi/activities/cmi.interaction",
				...options?.choiceDefinition,
				...(globalThis.__praxityPrivateState !== false && options?.assessmentType === "textResponse"
					? { interactionType: "long-fill-in" as const }
					: {}),
			},
		};

		const result: XapiResult = { response };
		if (correct !== undefined) result.success = correct;

		if (score !== undefined) {
			result.score = { raw: score };
		}

		if (this.sendEnabled) {
			const statement = this.buildStatement("answered", object, result);
			this.pendingStatements.push(statement);
			void this.sendStatement(statement);
		}
	}

	trackNavigation(fromPageId: string, toPageId: string, trigger: string): void {
		const object: XapiObject = {
			id: this.activityId(`page/${toPageId}`),
			definition: {
				name: { "en-US": toPageId },
				type: "http://adlnet.gov/expapi/activities/module",
			},
		};

		if (this.sendEnabled) {
			const base = this.buildStatement("experienced", object);
			const statement: XapiStatement = {
				...base,
				context: {
					extensions: {
						"https://praxity.io/xapi/from": fromPageId,
						"https://praxity.io/xapi/trigger": trigger,
					},
				},
			};

			this.pendingStatements.push(statement);
			void this.sendStatement(statement);
		}
	}

	getInteractions(): InteractionRecord[] {
		return [...this.interactions];
	}

	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void {
		// Each page reports the same status again; send a statement only when it changes.
		if (status === this.completionStatus) return;
		this.completionStatus = status;
		this.persist();

		if (status === "incomplete") {
			// No statement for "incomplete" -- it just updates local state.
			return;
		}

		if (this.sendEnabled) {
			const verb = this.statusToVerbKey(status);
			const result = this.buildCompletionResult();
			const statement = this.buildStatement(verb, this.courseObject(), result);
			this.pendingStatements.push(statement);
			void this.sendStatement(statement);
		}
	}

	getCompletion(): string {
		return this.completionStatus;
	}

	/** Send a passed or failed statement when the course result changes. */
	setSuccess(status: "passed" | "failed" | "unknown"): void {
		if (status === this.successStatus) return;
		this.successStatus = status;
		this.persist();
		if (status === "unknown" || !this.sendEnabled) return;
		const statement = this.buildStatement(
			status,
			this.courseObject(),
			this.buildCompletionResult(),
		);
		this.pendingStatements.push(statement);
		void this.sendStatement(statement);
	}

	getSuccess(): string {
		return this.successStatus;
	}

	setScore(raw: number, min: number, max: number): void {
		this.score = { raw, min, max };
		this.persist();
	}

	getScore(): { raw: number; min: number; max: number } | null {
		return this.score ? { ...this.score } : null;
	}

	setBookmark(pageId: string): void {
		this.bookmark = pageId;
		this.persist();
	}

	getBookmark(): string | null {
		return this.bookmark;
	}

	setSuspendData(data: string): boolean {
		this.suspendData =
			globalThis.__praxityPrivateState !== false
				? filterPrivateSuspendData(data, this.blockStatePolicy)
				: data;
		// Existing logic callers keep their page memory; the host reports failed durability.
		return this.persist();
	}

	getSuspendData(): string | null {
		return this.suspendData;
	}

	setCommitPreparation(prepare: () => void): void {
		this.commitPreparation.prepareCommit = prepare;
	}

	commit(): boolean {
		if (!prepareRuntimeCommit(this.commitPreparation)) return false;
		// All statements are sent eagerly via sendStatement(), so commit is a
		// no-op that clears the pending queue and returns true.
		this.pendingStatements = [];
		return true;
	}

	// -------------------------------------------------------------------
	// Internal helpers
	// -------------------------------------------------------------------

	/** Build a child activity ID under the course activity. */
	private activityId(path: string): string {
		const base = this.courseActivityId;
		const separator = base.endsWith("/") ? "" : "/";
		return `${base}${separator}${path}`;
	}

	/** Return the default course-level activity object. */
	private courseObject(): XapiObject {
		return {
			id: this.courseActivityId,
			definition: {
				name: { "en-US": "Course" },
				type: "http://adlnet.gov/expapi/activities/course",
			},
		};
	}

	/** Map a completion status string to a verb key for statement building. */
	private statusToVerbKey(status: "completed" | "passed" | "failed"): VerbKey {
		return status;
	}

	/**
	 * Determine which verb to use when terminating, based on the current
	 * completion status.
	 */
	private completionVerbKey(): VerbKey {
		switch (this.completionStatus) {
			case "passed":
				return "passed";
			case "failed":
				return "failed";
			case "completed":
				return "completed";
			default:
				return "completed";
		}
	}

	/**
	 * The LMS passes the actor only on the launch URL; later course pages carry it
	 * forward in this tab's sessionStorage.
	 */
	private resolveLaunchActor(courseId?: string): XapiActor | null {
		if (typeof window === "undefined") return null;

		const session = browserStorage("sessionStorage");
		const sessionKey = `praxity-xapi-actor:${encodeURIComponent(courseId ?? "")}`;
		const params = new URLSearchParams(window.location?.search || "");
		const launched = params.get("actor");
		let actorJson = launched;
		if (!actorJson) {
			try {
				actorJson = session?.getItem(sessionKey) ?? null;
			} catch {
				// Blocked storage leaves the actor unresolved.
			}
		}
		if (!actorJson) return null;

		try {
			const parsed = JSON.parse(actorJson) as { name?: string; mbox?: string };
			if (
				typeof parsed.name === "string" &&
				parsed.name &&
				typeof parsed.mbox === "string" &&
				parsed.mbox
			) {
				const actor = { name: parsed.name, mbox: parsed.mbox };
				if (launched) session?.setItem(sessionKey, JSON.stringify(actor));
				return actor;
			}
		} catch {
			// Ignore malformed actor payloads and blocked storage; fail safe.
		}

		return null;
	}

	private resolveLaunchActivityId(courseId?: string): string | null {
		if (typeof window === "undefined") return null;
		const session = browserStorage("sessionStorage");
		const key = `praxity-xapi-activity:${encodeURIComponent(courseId ?? "")}`;
		const params = new URLSearchParams(window.location?.search || "");
		const launched = params.get("activity_id");
		let value = launched;
		try {
			if (!params.has("activity_id")) value = session?.getItem(key) ?? null;
			if (isAbsoluteIri(value)) {
				if (launched) session?.setItem(key, value);
				return value;
			}
			if (params.has("activity_id")) session?.removeItem(key);
		} catch {
			// Blocked storage still permits a valid activity ID on the launch URL.
			if (isAbsoluteIri(value)) return value;
		}
		return null;
	}

	/** Build a result object for completion/pass/fail statements. */
	private buildCompletionResult(): XapiResult {
		const result: XapiResult = {
			completion: this.completionStatus !== "incomplete",
		};

		if (this.completionStatus === "passed" || this.successStatus === "passed") {
			result.success = true;
		} else if (this.completionStatus === "failed" || this.successStatus === "failed") {
			result.success = false;
		}

		if (this.score) {
			const range = this.score.max - this.score.min;
			result.score = {
				raw: this.score.raw,
				min: this.score.min,
				max: this.score.max,
				scaled: range > 0 ? (this.score.raw - this.score.min) / range : 0,
			};
		}

		return result;
	}
}
