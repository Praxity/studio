import { findWindowProperty, type WindowLike } from "../api-discovery";
import type { RuntimeCommitPreparation } from "../types";

/** Shared by every runtime in one LMS launch, including cached older documents. */
export interface GroupObjectiveReplayLedger {
	objectives?: Map<string, "writing" | "written">;
}

export interface ScormSessionState extends RuntimeCommitPreparation, GroupObjectiveReplayLedger {
	initialized: boolean;
	closed: boolean;
	terminationSucceeded: boolean;
	startedAt?: number;
	successTracked?: boolean;
	outcomeWaiting?: boolean;
	/** CourseTracker's failure status that explicit Finish must preserve. */
	courseFailure?: boolean;
	pendingCompletion?: "incomplete" | "completed" | "passed" | "failed";
	terminationInProgress?: boolean;
	attemptId?: string;
}

/** Queue cancellation is shared by both SCORM versions, before their first flush. */
export function configureSessionOutcome(
	state: ScormSessionState | null,
	policy: { waiting: boolean },
): void {
	if (!state || !sessionAllowsCalls(state)) return;
	state.outcomeWaiting = policy.waiting;
	if (state.outcomeWaiting) delete state.pendingCompletion;
}

interface SessionApi {
	__praxityScormInitialized?: boolean;
}

const SESSION_STORE = "__praxityScormSessions";
type SessionStore = WeakMap<object, ScormSessionState | boolean>;

/** Only the final commit's owner may communicate while termination is in progress. */
export function sessionAllowsCalls(state: ScormSessionState | null, terminating = false): boolean {
	return !!state && !state.closed && (terminating || !state.terminationInProgress);
}

// An API proxy can reject custom properties. Share records on its accessible
// LMS window instead, including across separately bundled content documents.
function sessionStore(win: WindowLike | undefined): SessionStore | null {
	return win ? (findWindowProperty(win, SESSION_STORE) as SessionStore | null) : null;
}

function carrierStore(owner: object, method?: string): SessionStore | undefined {
	try {
		const target = method ? (owner as Record<string, unknown>)[method] : owner;
		return (target as Record<string, unknown> | undefined)?.[SESSION_STORE] as
			| SessionStore
			| undefined;
	} catch {
		// A restricted API getter must not hide its window or callable carrier.
	}
}

function createWindowStore(win: WindowLike | undefined): SessionStore | null {
	if (!win) return null;
	for (const key of ["opener", "parent"] as const) {
		try {
			const candidate: WindowLike | null | undefined = win[key];
			if (!candidate || candidate === win) continue;
			const owner = candidate as Record<string, unknown>;
			return (owner[SESSION_STORE] ??= new WeakMap()) as SessionStore;
		} catch {
			// A restricted parent may still expose the API; try another window.
		}
	}
	return null;
}

/** Read the shared record without creating bookkeeping on an unstarted API. */
export function getSessionState(
	api: object | null | undefined,
	win: WindowLike | undefined = globalThis.window,
): ScormSessionState | null {
	if (!api) return null;
	for (const read of [
		() => sessionStore(win)?.get(api),
		() => carrierStore(api)?.get(api),
		() => carrierStore(api, "Initialize")?.get(api),
		() => carrierStore(api, "LMSInitialize")?.get(api),
	]) {
		try {
			const state = read();
			if (state && typeof state === "object") return state;
		} catch {
			// Each carrier is independent. A restricted getter must not hide a usable fallback.
		}
	}
	return null;
}

export function readSessionState(
	api: object | null,
	win: WindowLike | undefined = globalThis.window,
): boolean {
	if (!api) return false;
	const state = getSessionState(api, win);
	if (state) return state.initialized && !state.closed && !state.terminationInProgress;
	try {
		const stored = sessionStore(win)?.get(api);
		return typeof stored === "boolean"
			? stored
			: (api as SessionApi).__praxityScormInitialized === true;
	} catch {
		return false;
	}
}

export function writeSessionState(
	api: object | null | undefined,
	initialized: boolean,
	win: WindowLike | undefined = globalThis.window,
): ScormSessionState | null {
	if (!api) return null;
	const state = getSessionState(api, win) ?? {
		initialized: false,
		closed: false,
		terminationSucceeded: false,
	};
	// Index marks the previous launch uninitialized. Initialize owns the next
	// session's clock and completion state; navigation into an active session keeps both.
	if (initialized && !state.initialized) {
		state.startedAt = state.pendingCompletion = state.courseFailure = undefined;
		state.outcomeWaiting = undefined;
		state.objectives = undefined;
	}
	state.initialized = initialized && !state.closed;
	storeSessionState(api, state, win);
	// A document-local record cannot close adapters retained from older pages.
	return getSessionState(api, win) === state ? state : null;
}

/** Index can adopt an active API again; a closed launch always gets a fresh record. */
export function resetScormSessions(win: WindowLike): void {
	for (const name of ["API", "API_1484_11"]) {
		resetSessionState(findWindowProperty(win, name) as object | null, win);
	}
}

export function resetSessionState(api: object | null, win: WindowLike): void {
	if (!api) return;
	// Retained adapters keep the old closed object and cannot enter the next launch.
	// Initialize publishes the next record. Index only resets existing carriers.
	for (const store of [
		findWindowProperty(win, SESSION_STORE) as SessionStore | null,
		carrierStore(api),
		carrierStore(api, "Initialize"),
		carrierStore(api, "LMSInitialize"),
	]) {
		try {
			const state = store?.get(api);
			if (state && typeof state === "object" && !state.closed) {
				state.initialized = false;
				state.attemptId = undefined;
				state.prepareCommit = undefined;
			} else store?.delete(api);
		} catch {
			// Restricted carriers are independent; reset every accessible one.
		}
	}
	try {
		(api as SessionApi).__praxityScormInitialized = false;
	} catch {
		// The shared record covers APIs that reject the legacy marker.
	}
}

function storeSessionState(
	api: object,
	state: ScormSessionState,
	win: WindowLike | undefined,
): void {
	// Frozen API facades still expose shared callables across document bundles.
	// Key by API identity because LMS implementations can reuse prototype methods.
	for (const name of ["Initialize", "LMSInitialize"] as const) {
		try {
			const method = (api as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
			if (!method) continue;
			const store = (method[SESSION_STORE] ??= new WeakMap()) as SessionStore;
			store.set(api, state);
			if (store.get(api) === state) break;
		} catch {
			// The other callable may retain the record when this store cannot write or read it.
		}
	}
	try {
		(sessionStore(win) ?? createWindowStore(win))?.set(api, state);
	} catch {
		// The API property can still share the record if the window store fails.
	}
	try {
		const owner = api as Record<string, unknown>;
		((owner[SESSION_STORE] ??= new WeakMap()) as SessionStore).set(api, state);
	} catch {
		// A locked API uses its shared window or callable store.
	}
	try {
		(api as SessionApi).__praxityScormInitialized = state.initialized && !state.closed;
	} catch {
		// Older document bundles can still use this marker when the API accepts it.
	}
}
