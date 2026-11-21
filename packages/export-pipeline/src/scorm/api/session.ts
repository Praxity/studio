import { findWindowProperty, type WindowLike } from "../api-discovery";
import type { RuntimeCommitPreparation } from "../types";

export interface ScormSessionState extends RuntimeCommitPreparation {
	initialized: boolean;
	closed: boolean;
	terminationSucceeded: boolean;
	commitRefused?: boolean;
	startedAt?: number;
	successTracked?: boolean;
	courseFailure?: boolean;
	pendingCompletion?: "incomplete" | "completed" | "passed" | "failed";
	attemptId?: string;
}

interface SessionApi {
	__praxityScormSession?: ScormSessionState;
	LMSGetValue?: (element: string) => string;
	LMSGetLastError?: () => string;
	GetValue?: (element: string) => string;
	GetLastError?: () => string;
}

const SESSION_STORE = "__praxityScormSessions";
type SessionStore = WeakMap<object, ScormSessionState>;

export function sessionAllowsCalls(state: ScormSessionState | null): boolean {
	return !!state && !state.closed;
}

export function commitScormSession(
	state: ScormSessionState,
	commit: () => string | undefined,
	win: WindowLike = globalThis.window,
): boolean {
	const view = win as unknown as Window & typeof globalThis;
	try {
		if (commit() === "true") return true;
	} catch {}
	state.closed = state.commitRefused = true;
	state.terminationSucceeded = false;
	view?.dispatchEvent?.(new view.Event("praxity:scorm-session-ended"));
	return false;
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
		} catch {}
	}
	return null;
}

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
	return !!state?.initialized && sessionAllowsCalls(state);
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
	if (initialized && !state.initialized) {
		state.startedAt = state.pendingCompletion = state.courseFailure = undefined;
	}
	state.initialized = initialized && !state.closed;
	storeSessionState(api, state, win);
	return getSessionState(api, win) === state ? state : null;
}

export function resetScormSessions(win: WindowLike): void {
	for (const name of ["API", "API_1484_11"]) {
		resetSessionState(findWindowProperty(win, name) as object | null, win);
	}
}

export function resetSessionState(api: object | null, win: WindowLike): void {
	if (!api) return;
	const state = getSessionState(api, win);
	if (state && !state.closed) {
		state.prepareCommit = undefined;
		if (!state.initialized) return;
		const sessionApi = api as SessionApi;
		if (sessionApi.LMSGetValue) {
			sessionApi.LMSGetValue("cmi.core.lesson_status");
			if (String(sessionApi.LMSGetLastError?.()) !== "301") return;
		} else {
			sessionApi.GetValue?.("cmi.completion_status");
			if (String(sessionApi.GetLastError?.()) !== "122") return;
		}
		state.initialized = false;
		state.attemptId = undefined;
	} else if (state && !state.commitRefused) {
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
		(sessionStore(win) ?? createWindowStore(win))?.set(api, state);
	}
}
