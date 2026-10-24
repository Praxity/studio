import { findWindowProperty, type WindowLike } from "../api-discovery";
import type { RuntimeCommitPreparation } from "../types";

/** Shared by every runtime in one LMS launch, including cached documents. */
export interface ScormSessionState extends RuntimeCommitPreparation {
	initialized: boolean;
	closed: boolean;
	terminationSucceeded: boolean;
	startedAt?: number;
	successTracked?: boolean;
	/** CourseTracker's failure status that explicit Finish must preserve. */
	courseFailure?: boolean;
	pendingCompletion?: "incomplete" | "completed" | "passed" | "failed";
	attemptId?: string;
}

interface SessionApi {
	__praxityScormSession?: ScormSessionState;
}

const SESSION_STORE = "__praxityScormSessions";
type SessionStore = WeakMap<object, ScormSessionState>;

/** Termination closes communication for every adapter in the launch. */
export function sessionAllowsCalls(state: ScormSessionState | null): boolean {
	return !!state && !state.closed;
}

function sessionStore(win: WindowLike | undefined): SessionStore | null {
	return win ? (findWindowProperty(win, SESSION_STORE) as SessionStore | null) : null;
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
	return (api as SessionApi).__praxityScormSession ?? sessionStore(win)?.get(api) ?? null;
}

export function readSessionState(
	api: object | null,
	win: WindowLike | undefined = globalThis.window,
): boolean {
	const state = getSessionState(api, win);
	return !!state?.initialized;
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
	const state = getSessionState(api, win);
	// Retained adapters keep a closed record when index starts another launch.
	if (state && !state.closed) {
		state.initialized = false;
		state.attemptId = undefined;
		state.prepareCommit = undefined;
	} else if (state) {
		delete (api as SessionApi).__praxityScormSession;
		sessionStore(win)?.delete(api);
	}
}

function storeSessionState(
	api: object,
	state: ScormSessionState,
	win: WindowLike | undefined,
): void {
	try {
		(api as SessionApi).__praxityScormSession = state;
	} catch {
		// Non-extensible API objects share the record on the LMS window instead.
		(sessionStore(win) ?? createWindowStore(win))?.set(api, state);
	}
}
