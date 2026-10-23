import { beforeEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";

// ---------------------------------------------------------------------------
// Mock SCORM 1.2 API
// ---------------------------------------------------------------------------

interface MockSCORM12API {
	LMSInitialize: ReturnType<typeof vi.fn>;
	LMSFinish: ReturnType<typeof vi.fn>;
	LMSGetValue: ReturnType<typeof vi.fn>;
	LMSSetValue: ReturnType<typeof vi.fn>;
	LMSCommit: ReturnType<typeof vi.fn>;
	LMSGetLastError: ReturnType<typeof vi.fn>;
	LMSGetErrorString: ReturnType<typeof vi.fn>;
	LMSGetDiagnostic: ReturnType<typeof vi.fn>;
}

function createMockAPI(): MockSCORM12API {
	return {
		LMSInitialize: vi.fn().mockReturnValue("true"),
		LMSFinish: vi.fn().mockReturnValue("true"),
		LMSGetValue: vi.fn().mockReturnValue(""),
		LMSSetValue: vi.fn().mockReturnValue("true"),
		LMSCommit: vi.fn().mockReturnValue("true"),
		LMSGetLastError: vi.fn().mockReturnValue("0"),
		LMSGetErrorString: vi.fn().mockReturnValue("No error"),
		LMSGetDiagnostic: vi.fn().mockReturnValue(""),
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const g = globalThis as Record<string, unknown>;

/** Place the mock API on the global window object. */
function installAPI(api: MockSCORM12API, target: "window" | "parent" | "opener" = "window") {
	if (target === "window") {
		const win = { API: api, parent: undefined as unknown, opener: undefined };
		win.parent = win; // top-level frame
		g.window = win;
	} else if (target === "parent") {
		const parentWin = { API: api, parent: undefined as unknown };
		parentWin.parent = parentWin;
		g.window = { parent: parentWin, opener: undefined };
	} else if (target === "opener") {
		const openerWin = { API: api, parent: undefined as unknown };
		openerWin.parent = openerWin;
		const win = { parent: undefined as unknown, opener: openerWin };
		win.parent = win;
		g.window = win;
	}
}

function cleanupWindow() {
	g.window = undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Scorm12Runtime", () => {
	let api: MockSCORM12API;
	let runtime: Scorm12Runtime;

	beforeEach(() => {
		api = createMockAPI();
		runtime = new Scorm12Runtime();
		cleanupWindow();
	});

	// -- findAPI & initialize ------------------------------------------------

	describe("findAPI / initialize", () => {
		it("discovers API on the current window", () => {
			installAPI(api, "window");
			expect(runtime.initialize()).toBe(true);
			expect(api.LMSInitialize).toHaveBeenCalledWith("");
		});

		it("discovers API on a parent window", () => {
			installAPI(api, "parent");
			expect(runtime.initialize()).toBe(true);
			expect(api.LMSInitialize).toHaveBeenCalledWith("");
		});

		it("discovers API via window.opener", () => {
			installAPI(api, "opener");
			expect(runtime.initialize()).toBe(true);
			expect(api.LMSInitialize).toHaveBeenCalledWith("");
		});

		it("returns false when no API is found", () => {
			const win = { parent: undefined as unknown, opener: undefined };
			win.parent = win;
			g.window = win;

			expect(runtime.initialize()).toBe(false);
		});

		it("returns true without re-initializing if already initialized", () => {
			installAPI(api, "window");
			runtime.initialize();
			api.LMSInitialize.mockClear();

			expect(runtime.initialize()).toBe(true);
			expect(api.LMSInitialize).not.toHaveBeenCalled();
		});
	});

	// -- getValue / setValue --------------------------------------------------

	describe("getValue / setValue via LMS methods", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("getValue returns the value from LMSGetValue", () => {
			api.LMSGetValue.mockReturnValue("completed");
			const status = runtime.getCompletion();
			expect(api.LMSGetValue).toHaveBeenCalledWith("cmi.core.lesson_status");
			expect(status).toBe("completed");
		});

		it("setValue calls LMSSetValue with correct arguments", () => {
			runtime.setCompletion("passed");
			expect(runtime.getCompletion()).toBe("passed");
			expect(runtime.commit()).toBe(true);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.lesson_status", "passed");
		});
	});

	// -- commit --------------------------------------------------------------

	describe("commit", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("calls LMSCommit and returns true on success", () => {
			expect(runtime.commit()).toBe(true);
			expect(api.LMSCommit).toHaveBeenCalledWith("");
		});

		it("returns false when LMSCommit fails", () => {
			api.LMSCommit.mockReturnValue("false");
			api.LMSGetLastError.mockReturnValue("0");
			expect(runtime.commit()).toBe(false);
		});
	});

	// -- terminate -----------------------------------------------------------

	describe("terminate", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("calls LMSFinish and returns true", () => {
			expect(runtime.terminate()).toBe(true);
			expect(api.LMSFinish).toHaveBeenCalledWith("");
		});

		it("returns false when LMSFinish fails", () => {
			api.LMSFinish.mockReturnValue("false");
			api.LMSGetLastError.mockReturnValue("0");
			expect(runtime.terminate()).toBe(false);
		});
	});

	// -- error handling ------------------------------------------------------

	describe("error handling", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("throws descriptive error when LMSGetLastError returns non-zero", () => {
			api.LMSSetValue.mockReturnValue("false");
			api.LMSGetLastError.mockReturnValue("405");
			api.LMSGetErrorString.mockReturnValue("Incorrect Data Type");
			api.LMSGetDiagnostic.mockReturnValue("Expected integer value");

			runtime.setCompletion("completed");
			expect(() => runtime.commit()).toThrow(
				'SCORM 1.2 error in LMSSetValue("cmi.core.lesson_status", "completed"): ' +
					"[405] Incorrect Data Type (Expected integer value)",
			);
		});

		it("throws error without diagnostic when diagnostic is empty", () => {
			api.LMSSetValue.mockReturnValue("false");
			api.LMSGetLastError.mockReturnValue("201");
			api.LMSGetErrorString.mockReturnValue("Invalid argument error");
			api.LMSGetDiagnostic.mockReturnValue("");

			runtime.setCompletion("completed");
			expect(() => runtime.commit()).toThrow(
				'SCORM 1.2 error in LMSSetValue("cmi.core.lesson_status", "completed"): ' +
					"[201] Invalid argument error",
			);
		});

		it("throws if a method is called before initialize", () => {
			const uninitRuntime = new Scorm12Runtime();
			expect(() => uninitRuntime.getCompletion()).toThrow("SCORM 1.2 runtime is not initialized");
		});
	});

	// -- page visit tracking -------------------------------------------------

	describe("trackPageVisit / getVisitedPages", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("adds a page to the visited list stored in suspend_data", () => {
			runtime.trackPageVisit("page-1");

			// Verify suspend_data was written
			const setCall = api.LMSSetValue.mock.calls.find((c: string[]) => c[0] === "cmi.suspend_data");
			expect(setCall).toBeDefined();
			const payload = JSON.parse(setCall?.[1]);
			expect(payload.visitedPages).toContain("page-1");
		});

		it("does not duplicate a page ID on repeated visits", () => {
			runtime.trackPageVisit("page-1");

			// Make LMSGetValue return what was previously set
			const firstSetCall = api.LMSSetValue.mock.calls.find(
				(c: string[]) => c[0] === "cmi.suspend_data",
			);
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") return firstSetCall?.[1];
				return "";
			});

			runtime.trackPageVisit("page-1");

			const lastSetCall = [...api.LMSSetValue.mock.calls]
				.reverse()
				.find((c: string[]) => c[0] === "cmi.suspend_data");
			const payload = JSON.parse(lastSetCall?.[1]);
			expect(payload.visitedPages.filter((p: string) => p === "page-1")).toHaveLength(1);
		});

		it("returns parsed pages from suspend_data", () => {
			const stored = JSON.stringify({
				visitedPages: ["page-1", "page-2"],
				interactions: [],
			});
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") return stored;
				return "";
			});

			expect(runtime.getVisitedPages()).toEqual(["page-1", "page-2"]);
		});

		it("returns empty array when suspend_data is empty", () => {
			expect(runtime.getVisitedPages()).toEqual([]);
		});
	});

	// -- interaction tracking ------------------------------------------------

	describe("trackInteraction / getInteractions", () => {
		it("keeps the base letter when its combining mark exceeds the response cap", () => {
			const expected = `${"x".repeat(249)}e`;
			api.LMSGetValue.mockImplementation(
				(key: string) =>
					[...api.LMSSetValue.mock.calls]
						.reverse()
						.find((call: string[]) => call[0] === key)?.[1] ?? "",
			);
			runtime.trackInteraction(
				"combining-boundary",
				`${expected}\u0301tail`,
				undefined,
				undefined,
				{ assessmentType: "textResponse" },
			);
			expect(
				api.LMSSetValue.mock.calls.find(
					(call: string[]) => call[0] === "cmi.interactions.0.student_response",
				)?.[1],
			).toBe(expected);
			expect(runtime.getInteractions()[0].response).toBe(expected);
		});
		it.each([248, 249, 250])(
			"keeps whole code points at the response cap after %s units",
			(prefixLength) => {
				const prefix = "x".repeat(prefixLength);
				const response = `${prefix}\u{1f600}tail`;
				api.LMSGetValue.mockImplementation(
					(key: string) =>
						[...api.LMSSetValue.mock.calls]
							.reverse()
							.find((call: string[]) => call[0] === key)?.[1] ?? "",
				);
				runtime.trackInteraction("unicode-boundary", response, undefined, undefined, {
					assessmentType: "textResponse",
				});
				const stored = api.LMSSetValue.mock.calls.find(
					(call: string[]) => call[0] === "cmi.interactions.0.student_response",
				)?.[1];
				expect(stored).toBe(prefixLength === 248 ? `${prefix}\u{1f600}` : prefix);
				expect(stored.isWellFormed()).toBe(true);
				expect(runtime.getInteractions()[0].response).toBe(stored);
			},
		);
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("records interaction data in suspend_data", () => {
			const now = Date.now();
			vi.spyOn(Date, "now").mockReturnValue(now);

			runtime.trackInteraction("q1", "option-a", true, 1);

			const setCall = api.LMSSetValue.mock.calls.find((c: string[]) => c[0] === "cmi.suspend_data");
			const payload = JSON.parse(setCall?.[1]);
			expect(payload.interactions).toHaveLength(1);
			expect(payload.interactions[0]).toEqual({
				id: "q1",
				response: "option-a",
				correct: true,
				score: 1,
				timestamp: now,
			});

			vi.restoreAllMocks();
		});

		it("also writes to cmi.interactions data model", () => {
			runtime.trackInteraction("q1", "option-b", false);

			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.id", "q1");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.result", "wrong");
			expect(api.LMSSetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.student_response",
				"option-b",
			);
		});

		it("keeps the complete 255-character choice response in the API and history", () => {
			const response = `${"x".repeat(126)}[,]${"y".repeat(126)}`;
			runtime.trackInteraction("poll", response, undefined, undefined, {
				assessmentType: "choice",
			});
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.student_response", response);
			const state = api.LMSSetValue.mock.calls.find(
				(call: string[]) => call[0] === "cmi.suspend_data",
			);
			expect(JSON.parse(state?.[1]).interactions[0].response).toBe(response);
		});

		it("refuses an oversized choice response before recording a different selection", () => {
			api.LMSSetValue.mockClear();
			expect(() =>
				runtime.trackInteraction("poll", "x".repeat(256), undefined, undefined, {
					assessmentType: "choice",
				}),
			).toThrow("CMIFeedback limit");
			expect(api.LMSSetValue).not.toHaveBeenCalled();
			expect(runtime.getInteractions()).toEqual([]);
		});

		it("records open responses as neutral fill-in interactions", () => {
			const response = "x".repeat(300);
			runtime.trackInteraction("comments", response, undefined, undefined, {
				assessmentType: "textResponse",
			});

			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.type", "fill-in");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.result", "neutral");
			expect(api.LMSSetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.student_response",
				"x".repeat(250),
			);
		});

		it("records blank selections as scored fill-in responses", () => {
			const response = JSON.stringify({ first: "light blue", second: "red" });
			runtime.trackInteraction("blanks", response, true, 1, { assessmentType: "fillBlank" });
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.type", "fill-in");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.student_response", response);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.interactions.0.result", "correct");
		});

		it("returns all recorded interactions", () => {
			const stored = JSON.stringify({
				visitedPages: [],
				interactions: [
					{ id: "q1", response: "a", correct: true, score: 1, timestamp: 100 },
					{ id: "q2", response: "b", correct: false, timestamp: 200 },
				],
			});
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") return stored;
				return "";
			});

			const interactions = runtime.getInteractions();
			expect(interactions).toHaveLength(2);
			expect(interactions[0].id).toBe("q1");
			expect(interactions[1].correct).toBe(false);
		});
	});

	// -- completion ----------------------------------------------------------

	describe("setCompletion / getCompletion", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("sets lesson_status to 'completed'", () => {
			runtime.setCompletion("completed");
			expect(runtime.getCompletion()).toBe("completed");
			expect(runtime.commit()).toBe(true);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.lesson_status", "completed");
		});

		it("sets lesson_status to 'incomplete'", () => {
			runtime.setCompletion("incomplete");
			expect(runtime.getCompletion()).toBe("incomplete");
			expect(runtime.commit()).toBe(true);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.lesson_status", "incomplete");
		});

		it("sets lesson_status to 'passed'", () => {
			runtime.setCompletion("passed");
			expect(runtime.getCompletion()).toBe("passed");
			expect(runtime.commit()).toBe(true);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.lesson_status", "passed");
		});

		it("sets lesson_status to 'failed'", () => {
			runtime.setCompletion("failed");
			expect(runtime.getCompletion()).toBe("failed");
			expect(runtime.commit()).toBe(true);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.lesson_status", "failed");
		});

		it("returns the current lesson_status", () => {
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.core.lesson_status") return "passed";
				return "";
			});
			expect(runtime.getCompletion()).toBe("passed");
		});
	});

	// -- score ---------------------------------------------------------------

	describe("setScore / getScore", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("sets raw, min, and max score", () => {
			runtime.setScore(85, 0, 100);
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.score.raw", "85");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.score.min", "0");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.score.max", "100");
		});

		it("returns parsed score object", () => {
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.core.score.raw") return "85";
				if (element === "cmi.core.score.min") return "0";
				if (element === "cmi.core.score.max") return "100";
				return "";
			});

			expect(runtime.getScore()).toEqual({ raw: 85, min: 0, max: 100 });
		});

		it("returns null when no score has been set", () => {
			expect(runtime.getScore()).toBeNull();
		});
	});

	// -- bookmark ------------------------------------------------------------

	describe("setBookmark / getBookmark", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("sets cmi.core.lesson_location", () => {
			runtime.setBookmark("page-3");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.core.lesson_location", "page-3");
		});

		it("returns the current bookmark", () => {
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.core.lesson_location") return "page-3";
				return "";
			});
			expect(runtime.getBookmark()).toBe("page-3");
		});

		it("returns null when no bookmark is set", () => {
			expect(runtime.getBookmark()).toBeNull();
		});
	});

	// -- suspend data (custom) -----------------------------------------------

	describe("setSuspendData / getSuspendData", () => {
		beforeEach(() => {
			installAPI(api, "window");
			runtime.initialize();
		});

		it("stores custom data in the suspend_data payload", () => {
			runtime.setSuspendData("user-custom-data");

			const setCall = api.LMSSetValue.mock.calls.find((c: string[]) => c[0] === "cmi.suspend_data");
			expect(setCall).toBeDefined();
			const payload = JSON.parse(setCall?.[1]);
			expect(payload.custom).toBe("user-custom-data");
		});

		it("returns the custom data from suspend_data", () => {
			const stored = JSON.stringify({
				visitedPages: [],
				interactions: [],
				custom: "my-saved-state",
			});
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") return stored;
				return "";
			});

			expect(runtime.getSuspendData()).toBe("my-saved-state");
		});

		it("returns null when no custom data is set", () => {
			expect(runtime.getSuspendData()).toBeNull();
		});

		it("preserves visited pages and interactions when setting custom data", () => {
			const existing = JSON.stringify({
				visitedPages: ["page-1"],
				interactions: [{ id: "q1", response: "a", correct: true, timestamp: 100 }],
			});
			api.LMSGetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") return existing;
				return "";
			});

			runtime.setSuspendData("new-custom-data");

			const setCall = [...api.LMSSetValue.mock.calls]
				.reverse()
				.find((c: string[]) => c[0] === "cmi.suspend_data");
			const payload = JSON.parse(setCall?.[1]);
			expect(payload.visitedPages).toEqual(["page-1"]);
			expect(payload.interactions).toHaveLength(1);
			expect(payload.custom).toBe("new-custom-data");
		});
	});

	describe("trackObjective", () => {
		it("sets cmi.objectives.N.id, score.raw, and status", () => {
			const api = createMockAPI();
			installAPI(api);
			const runtime = new Scorm12Runtime();
			runtime.initialize();

			runtime.trackObjective("group-1", 85, true);

			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.objectives.0.id", "group-1");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.objectives.0.score.raw", "85");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.objectives.0.status", "passed");
		});

		it("increments objective index on multiple calls", () => {
			const api = createMockAPI();
			installAPI(api);
			const runtime = new Scorm12Runtime();
			runtime.initialize();

			runtime.trackObjective("group-1", 85, true);
			runtime.trackObjective("group-2", 40, false);

			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.objectives.1.id", "group-2");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.objectives.1.score.raw", "40");
			expect(api.LMSSetValue).toHaveBeenCalledWith("cmi.objectives.1.status", "failed");
		});
	});
});
