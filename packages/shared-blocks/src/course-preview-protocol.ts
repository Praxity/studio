import type { MessageRef } from "@praxity/grammar";
import { LEARNER_STATE_MAX_BYTES } from "./learner-state";

export const COURSE_PREVIEW_PROTOCOL_VERSION = 1;
// Bound both a frame's freeze reply and the host's checkpoint save.
export const COURSE_PREVIEW_STATE_FLUSH_TIMEOUT_MS = 3_000;
// A literal lets query-only browser imports omit the unused URL limit.
export const COURSE_PREVIEW_URL_MAX_BYTES = 8_192;

export interface PreviewHtmlFragment {
	id: string;
	html: string;
	island?: string;
}
export interface PreviewNodeRender {
	seq: number;
	pageId: string;
	fragments: PreviewHtmlFragment[];
}
/** Per-page draft sequences are independent of admitted operation revisions.
 * A transaction settles only its own latest draft, never a newer gesture. */
export interface PreviewDraftRender extends PreviewNodeRender {
	transactionId: string;
	state: "draft" | "saved" | "reverted";
}
export interface PreviewPatch extends PreviewNodeRender {
	order: string[];
	shellStale: boolean;
}
export interface PreviewCompileDiagnostic {
	message: string;
	line?: number;
	file?: string;
	messageRef?: MessageRef;
}
export type PreviewRenderEvent =
	| { type: "pageCompiled"; patch: PreviewPatch; documentRegions: PreviewHtmlFragment[] }
	| { type: "nodesRendered"; render: PreviewNodeRender }
	| { type: "draftRendered"; render: PreviewDraftRender }
	| { type: "compileFailed"; seq: number; pageId: string; diagnostics: PreviewCompileDiagnostic[] }
	/** The course's pages changed: added, removed, reordered or given new identities. */
	| { type: "pagesChanged"; pageIds: string[] };

export type CoursePreviewFatalCode = "invalid-state" | "runtime-start";

export interface CoursePreviewIdentity {
	channel: string;
	courseId: string;
	revision: string;
	pageId: string;
}

type CoursePreviewCommandBase = {
	source: "praxity-studio";
	version: 1;
};

type CoursePreviewEventBase = {
	source: "praxity-course";
	version: 1;
};

export type CoursePreviewCommand =
	| (CoursePreviewCommandBase & CoursePreviewIdentity & { action: "connect" })
	| (CoursePreviewCommandBase &
			CoursePreviewIdentity & {
				action: "restore";
				state: string;
				writable: boolean;
			})
	| (CoursePreviewCommandBase & CoursePreviewIdentity & { action: "freeze" })
	| (CoursePreviewCommandBase & CoursePreviewIdentity & { action: "utility-closed" })
	| (CoursePreviewCommandBase &
			CoursePreviewIdentity & {
				action: "resume";
				state: string;
			})
	| (CoursePreviewCommandBase &
			CoursePreviewIdentity & {
				action: "logic";
				enabled: boolean;
			})
	| (CoursePreviewCommandBase &
			CoursePreviewIdentity & {
				action: "focus";
				edge: "first" | "last";
			});

export type CoursePreviewEvent =
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & { event: "active-page"; activePageId: string })
	| (CoursePreviewEventBase & CoursePreviewIdentity & { event: "connected" })
	| (CoursePreviewEventBase & CoursePreviewIdentity & { event: "open-utility"; url: string })
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "ready";
				activePageId?: string;
				mode: "learner" | "inspection";
			})
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "persist";
				state: string;
			})
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "frozen";
				state: string;
			})
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "navigate";
				state: string;
				url: string;
			})
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "author-bypass";
				direction: "previous" | "next";
			})
	| (CoursePreviewEventBase & CoursePreviewIdentity & { event: "escape" })
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "focus-boundary";
				direction: "forward" | "backward";
			})
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "open-external";
				url: string;
			})
	| (CoursePreviewEventBase &
			CoursePreviewIdentity & {
				event: "fatal";
				code: CoursePreviewFatalCode;
			});

/**
 * An inspection frame's origin is opaque, so no postMessage target can name it.
 * The frame offers its own private port instead, and the host never posts to its window.
 */
export interface CoursePreviewInspectionOffer {
	source: "praxity-course";
	version: 1;
	event: "inspect";
	channel: string;
}

export function isSmallPreviewDocument(search: string): boolean {
	return new URLSearchParams(search).get("praxity-small-preview") === "1";
}

export function readCoursePreviewChannel(search: string): string | null {
	const channel = new URLSearchParams(search).get("praxity-channel");
	return channel && /^[A-Za-z0-9_-]{32,128}$/.test(channel) ? channel : null;
}

/** `"null"` names a file renderer, which has no exact postMessage target. */
export function readCoursePreviewParentOrigin(search: string): string | null {
	return new URLSearchParams(search).get("praxity-parent-origin");
}

export function isCoursePreviewInspectionOffer(
	value: unknown,
	channel: string,
): value is CoursePreviewInspectionOffer {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return (
		Reflect.ownKeys(candidate).length === 4 &&
		candidate.source === "praxity-course" &&
		candidate.version === COURSE_PREVIEW_PROTOCOL_VERSION &&
		candidate.event === "inspect" &&
		candidate.channel === channel
	);
}

export function isCoursePreviewCommand(
	value: unknown,
	expected: CoursePreviewIdentity,
): value is CoursePreviewCommand {
	if (!hasIdentity(value, expected) || value.source !== "praxity-studio") return false;

	switch (value.action) {
		case "connect":
			return hasExactKeys(value, ["source", "version", "action"]);
		case "restore":
			return (
				hasExactKeys(value, ["source", "version", "action", "state", "writable"]) &&
				isLearnerStateString(value.state) &&
				typeof value.writable === "boolean"
			);
		case "freeze":
		case "utility-closed":
			return hasExactKeys(value, ["source", "version", "action"]);
		case "resume":
			return (
				hasExactKeys(value, ["source", "version", "action", "state"]) &&
				isLearnerStateString(value.state)
			);
		case "logic":
			return (
				hasExactKeys(value, ["source", "version", "action", "enabled"]) &&
				typeof value.enabled === "boolean"
			);
		case "focus":
			return (
				hasExactKeys(value, ["source", "version", "action", "edge"]) &&
				(value.edge === "first" || value.edge === "last")
			);
		default:
			return false;
	}
}

export function isCoursePreviewEvent(
	value: unknown,
	expected: CoursePreviewIdentity,
): value is CoursePreviewEvent {
	if (!hasIdentity(value, expected) || value.source !== "praxity-course") return false;

	switch (value.event) {
		case "connected":
			return hasExactKeys(value, ["source", "version", "event"]);
		case "open-utility":
			return hasExactKeys(value, ["source", "version", "event", "url"]) && isBoundedUrl(value.url);
		case "active-page":
			return (
				hasExactKeys(value, ["source", "version", "event", "activePageId"]) &&
				typeof value.activePageId === "string" &&
				value.activePageId.length > 0 &&
				value.activePageId.length <= 1024
			);
		case "ready":
			return (
				hasExactKeys(value, [
					"source",
					"version",
					"event",
					"mode",
					...(value.activePageId === undefined ? [] : ["activePageId"]),
				]) &&
				(value.activePageId === undefined ||
					(typeof value.activePageId === "string" &&
						value.activePageId.length > 0 &&
						value.activePageId.length <= 1024)) &&
				(value.mode === "learner" || value.mode === "inspection")
			);
		case "persist":
		case "frozen":
			return (
				hasExactKeys(value, ["source", "version", "event", "state"]) &&
				isLearnerStateString(value.state)
			);
		case "navigate":
			return (
				hasExactKeys(value, ["source", "version", "event", "state", "url"]) &&
				isLearnerStateString(value.state) &&
				isBoundedUrl(value.url)
			);
		case "author-bypass":
			return (
				hasExactKeys(value, ["source", "version", "event", "direction"]) &&
				(value.direction === "previous" || value.direction === "next")
			);
		case "escape":
			return hasExactKeys(value, ["source", "version", "event"]);
		case "focus-boundary":
			return (
				hasExactKeys(value, ["source", "version", "event", "direction"]) &&
				(value.direction === "forward" || value.direction === "backward")
			);
		case "open-external":
			return (
				hasExactKeys(value, ["source", "version", "event", "url"]) && isSafeExternalUrl(value.url)
			);
		case "fatal":
			return (
				hasExactKeys(value, ["source", "version", "event", "code"]) &&
				(value.code === "invalid-state" || value.code === "runtime-start")
			);
		default:
			return false;
	}
}

function isBoundedUrl(value: unknown): value is string {
	if (!isBoundedUtf8String(value, COURSE_PREVIEW_URL_MAX_BYTES)) return false;
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

export function isSafeExternalUrl(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password;
	} catch {
		return false;
	}
}

function isLearnerStateString(value: unknown): value is string {
	return isBoundedUtf8String(value, LEARNER_STATE_MAX_BYTES);
}

function isBoundedUtf8String(value: unknown, maxBytes: number): value is string {
	return typeof value === "string" && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function hasIdentity(
	value: unknown,
	expected: CoursePreviewIdentity,
): value is Record<string, unknown> & CoursePreviewIdentity & { version: 1 } {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.version === COURSE_PREVIEW_PROTOCOL_VERSION &&
		candidate.channel === expected.channel &&
		candidate.courseId === expected.courseId &&
		candidate.revision === expected.revision &&
		candidate.pageId === expected.pageId
	);
}

function hasExactKeys(value: Record<string, unknown>, messageKeys: readonly string[]): boolean {
	const expectedKeys = new Set([...messageKeys, "channel", "courseId", "revision", "pageId"]);
	const actualKeys = Reflect.ownKeys(value);
	return (
		actualKeys.length === expectedKeys.size &&
		actualKeys.every((key) => expectedKeys.has(key as string))
	);
}

// Source diagnostics extend this transport through a type-only edge. Keeping
// author metadata outside this runtime module preserves learner bundle bytes.
import type {} from "./course-preview-diagnostics";
