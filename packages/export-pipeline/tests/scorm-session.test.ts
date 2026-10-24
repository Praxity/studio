import { describe, expect, it } from "vitest";
import { readSessionState, resetSessionState, writeSessionState } from "../src/scorm/api/session";
import type { WindowLike } from "../src/scorm/api-discovery";

describe("SCORM communication session", () => {
	it.each(["API", "API_1484_11"])(
		"shares a session across SCO documents when %s rejects custom properties",
		(name) => {
			const api = Object.freeze({});
			const lms: WindowLike = { [name]: api };
			lms.parent = lms;
			const first = { parent: lms };
			const next = { parent: lms };
			expect(readSessionState(api, first)).toBe(false);
			writeSessionState(api, true, first);
			expect(readSessionState(api, next)).toBe(true);
			// index.html starts a new launch even when the LMS reuses its API object.
			resetSessionState(api, next);
			expect(readSessionState(api, first)).toBe(false);
		},
	);

	it("shares a popup session by API identity without adopting another API's state", () => {
		const api = Object.freeze({});
		const lms: WindowLike = { API_1484_11: api };
		lms.parent = lms;
		writeSessionState(api, true, { opener: lms });
		expect(readSessionState(api, { opener: lms })).toBe(true);
		expect(readSessionState(Object.freeze({}), { opener: lms })).toBe(false);
	});
});

it("a fresh launch clears the preceding queued completion", () => {
	const api = { Initialize: () => "true" };
	const state = writeSessionState(api, true);
	expect(state).not.toBeNull();
	if (!state) throw new Error("Missing session");
	state.pendingCompletion = "completed";
	writeSessionState(api, false);
	const next = writeSessionState(api, true);
	expect(next?.pendingCompletion).toBeUndefined();
});
