import { applyXapiPrivatePolicy } from "../private-xapi-policy";

import { filterPrivateSuspendData } from "@praxity/shared-blocks/block-state-policy";
import { declaredCourseActivityId, isAbsoluteIri } from "../activity-id.ts";
import {
	assessmentEvidenceMetadata,
	assessmentRowsEvidence,
	DEVICE_DESTINATIONS,
	type InteractionEvidence,
	type InteractionRecord,
	isInteractionRecord,
	type RuntimeCommitPreparation,
	type RuntimeDestinations,
	recordInteraction,
	type SCORMRuntime,
	type TrackInteractionOptions,
} from "../types.ts";
import { resolveLaunchAttempt } from "./device-attempt";
import { runtimeUuid } from "./runtime-uuid";

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

export function readXapiInteractionEvidence(raw: string): InteractionEvidence[] | null {
	try {
		const value = JSON.parse(raw) as { interactions?: unknown } | null;
		if (!Array.isArray(value?.interactions)) return null;
		return assessmentRowsEvidence(value.interactions);
	} catch {
		return null;
	}
}

export interface XapiActor {
	name?: string;
	mbox: string;
}

export interface XapiConfig {
	endpoint: string;
	auth: string;
	actor?: XapiActor;
	activityBase?: string;
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
	id: string;
	actor: XapiActor;
	verb: XapiVerb;
	object: XapiObject;
	result?: XapiResult;
	context?: {
		extensions?: Record<string, unknown>;
	};
	timestamp: string;
}

function browserStorage(name: "localStorage" | "sessionStorage"): Storage | null {
	try {
		return typeof window === "undefined" ? null : (window[name] ?? null);
	} catch {
		return null;
	}
}

export class XapiRuntime implements SCORMRuntime {
	get destinations(): RuntimeDestinations {
		return this.sendEnabled ? { reporting: "lms", state: "device" } : DEVICE_DESTINATIONS;
	}
	setBlockStatePolicy(policy: Readonly<Record<string, "device" | "lms">>): void {
		this.blockStatePolicy = { ...policy };
		Object.assign(
			this,
			applyXapiPrivatePolicy(policy, this.interactions, this.suspendData, this.outbox),
		);
	}
	getLearnerIdentity(): { learnerId: string; attemptId?: string } | null {
		if (this.config.actorMode !== "lms" || !this.actor) return null;
		const attemptId = this.courseId
			? resolveLaunchAttempt(this.courseId, this.actor.mbox)
			: undefined;
		return { learnerId: this.actor.mbox, ...(attemptId ? { attemptId } : {}) };
	}

	private config: XapiConfig;
	private actor: XapiActor | null;
	private sendEnabled: boolean;
	private initialized = false;
	private commitPreparation: RuntimeCommitPreparation = {};
	private completionStatus = "incomplete";
	private successStatus: "passed" | "failed" | "unknown" = "unknown";
	private score: { raw: number; min: number; max: number } | null = null;
	private bookmark: string | null = null;
	private suspendData: string | null = null;
	private visitedPages: string[] = [];
	private interactions: InteractionEvidence[] = [];
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
		this.courseId = courseId;
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
		if (courseId && this.actor) {
			this.storage = storage ?? browserStorage("localStorage");
			this.storageKey = `praxity-xapi:${encodeURIComponent(courseId)}:${encodeURIComponent(this.actor.mbox)}`;
			this.restore();
		}
	}

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
				this.interactions = value.interactions.flatMap((row) => {
					const admitted = assessmentRowsEvidence([row]);
					return admitted ?? [row];
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
			if (Array.isArray(value.outbox)) {
				this.outbox = value.outbox.filter(
					(item): item is XapiStatement =>
						!!item && typeof item === "object" && isString((item as XapiStatement).verb?.id),
				);
				let migrated = false;
				for (const statement of this.outbox) {
					if (!isString(statement.id)) {
						statement.id = runtimeUuid();
						migrated = true;
					}
				}
				if (migrated) this.persist();
			}
		} catch {}
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
			return false;
		}
	}

	buildStatement(verb: VerbKey, object: XapiObject, result?: XapiResult): XapiStatement {
		const id = runtimeUuid();
		const verbDef = VERBS[verb];
		const actor = this.actor ?? { name: "Unknown Learner", mbox: "mailto:unknown@example.com" };
		const statement: XapiStatement = {
			id,
			actor: {
				...(actor.name ? { name: actor.name } : {}),
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
			if (!response.ok && !(response.status === 409 && statement.id))
				throw new Error(`LRS responded ${response.status}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[xAPI] Failed to send statement: ${message}`);
			this.outbox = [...this.outbox, statement].slice(-50);
			this.persist();
		}
	}

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
			void this.sendStatement(statement);
		}

		return true;
	}

	terminate(): boolean {
		if (!this.initialized) {
			return false;
		}
		this.commitPreparation.prepareCommit?.();

		if (this.sendEnabled) {
			const verb = this.completionVerbKey();
			const result = this.buildCompletionResult();
			const statement = this.buildStatement(verb, this.courseObject(), result);
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
		if (this.blockStatePolicy[id] === "device") return;
		const record: InteractionRecord = {
			id,
			response,
			correct,
			score,
			...assessmentEvidenceMetadata(options),
			timestamp: Date.now(),
		};
		this.interactions = recordInteraction(this.interactions, record);
		this.persist();

		const language =
			typeof options?.language === "string" && options.language ? options.language : "en-US";
		const description = (options?.description ?? `Interaction ${id}`).replace(/\s+/gu, " ").trim();
		const reportingTextResponse =
			Object.keys(this.blockStatePolicy).length > 0 && options?.assessmentType === "textResponse";
		const object: XapiObject = {
			id: this.activityId(`interaction/${id}`),
			definition: {
				name: reportingTextResponse
					? { [language]: description }
					: { "en-US": `Interaction ${id}` },
				description: { [language]: description },
				type: "http://adlnet.gov/expapi/activities/cmi.interaction",
				...options?.choiceDefinition,
				...(reportingTextResponse ? { interactionType: "long-fill-in" as const } : {}),
			},
		};

		const result: XapiResult = { response };
		if (correct !== undefined) result.success = correct;

		if (score !== undefined) {
			result.score = { raw: score };
		}

		if (this.sendEnabled) {
			const statement = this.buildStatement("answered", object, result);
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

			void this.sendStatement(statement);
		}
	}

	getInteractions(): InteractionRecord[] {
		return this.interactions.filter(isInteractionRecord);
	}

	getInteractionEvidence(): InteractionEvidence[] | null {
		return assessmentRowsEvidence(this.interactions);
	}

	setCompletion(status: "incomplete" | "completed" | "passed" | "failed"): void {
		if (status === this.completionStatus) return;
		this.completionStatus = status;
		this.persist();

		if (status === "incomplete") {
			return;
		}

		if (this.sendEnabled) {
			const verb = this.statusToVerbKey(status);
			const result = this.buildCompletionResult();
			const statement = this.buildStatement(verb, this.courseObject(), result);
			void this.sendStatement(statement);
		}
	}

	getCompletion(): string {
		return this.completionStatus;
	}

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
		this.suspendData = filterPrivateSuspendData(data, this.blockStatePolicy);
		return this.persist();
	}

	getSuspendData(): string | null {
		return this.suspendData;
	}

	setCommitPreparation(prepare: () => void): void {
		this.commitPreparation.prepareCommit = prepare;
	}

	commit(): boolean {
		this.commitPreparation.prepareCommit?.();
		return true;
	}

	private activityId(path: string): string {
		const base = this.courseActivityId;
		const separator = base.endsWith("/") ? "" : "/";
		return `${base}${separator}${path}`;
	}

	private courseObject(): XapiObject {
		return {
			id: this.courseActivityId,
			definition: {
				name: { "en-US": "Course" },
				type: "http://adlnet.gov/expapi/activities/course",
			},
		};
	}

	private statusToVerbKey(status: "completed" | "passed" | "failed"): VerbKey {
		return status;
	}

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
			} catch {}
		}
		if (!actorJson) return null;

		try {
			const parsed = JSON.parse(actorJson) as { name?: string; mbox?: string };
			if (
				typeof parsed.mbox === "string" &&
				parsed.mbox &&
				(parsed.name === undefined || typeof parsed.name === "string")
			) {
				const actor: XapiActor = {
					mbox: parsed.mbox,
					...(parsed.name ? { name: parsed.name } : {}),
				};
				if (launched) session?.setItem(sessionKey, JSON.stringify(actor));
				return actor;
			}
		} catch {}

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
			if (isAbsoluteIri(value)) return value;
		}
		return null;
	}

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
