import { expect, it } from "vitest";
import {
	configureSessionOutcome,
	type ScormSessionState,
	writeSessionState,
} from "../src/scorm/api/session";

it("waiting cancels queued credit and decided releases the hold without restoring it", () => {
	const state: ScormSessionState = {
		initialized: true,
		closed: false,
		terminationSucceeded: false,
		pendingCompletion: "completed",
	};
	configureSessionOutcome(state, { waiting: true });
	expect(state.pendingCompletion).toBeUndefined();
	expect(state.outcomeWaiting).toBe(true);
	configureSessionOutcome(state, { waiting: false });
	expect(state.outcomeWaiting).toBe(false);
	expect(state.pendingCompletion).toBeUndefined();
});

it.each(["closed", "terminating"] as const)("%s sessions refuse policy changes", (kind) => {
	const state: ScormSessionState = {
		initialized: true,
		closed: kind === "closed",
		terminationSucceeded: false,
		pendingCompletion: "completed",
		...(kind === "terminating" ? { terminationInProgress: true } : {}),
	};
	const original = { ...state };
	configureSessionOutcome(state, { waiting: true });
	expect(state).toEqual(original);
	expect(() => configureSessionOutcome(null, { waiting: true })).not.toThrow();
});

it("a fresh launch clears waiting and the preceding queued completion", () => {
	const api = { Initialize: () => "true" };
	const state = writeSessionState(api, true);
	expect(state).not.toBeNull();
	if (!state) throw new Error("Missing session");
	configureSessionOutcome(state, { waiting: true });
	state.pendingCompletion = "completed";
	writeSessionState(api, false);
	const next = writeSessionState(api, true);
	expect(next?.outcomeWaiting).toBeUndefined();
	expect(next?.pendingCompletion).toBeUndefined();
});
