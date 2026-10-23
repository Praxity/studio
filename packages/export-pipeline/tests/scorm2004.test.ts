import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SCORM2004API, Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";

// ---------------------------------------------------------------------------
// Mock SCORM 2004 API (API_1484_11)
// ---------------------------------------------------------------------------

function createMockAPI(): SCORM2004API & {
	Initialize: ReturnType<typeof vi.fn>;
	Terminate: ReturnType<typeof vi.fn>;
	GetValue: ReturnType<typeof vi.fn>;
	SetValue: ReturnType<typeof vi.fn>;
	Commit: ReturnType<typeof vi.fn>;
	GetLastError: ReturnType<typeof vi.fn>;
	GetErrorString: ReturnType<typeof vi.fn>;
	GetDiagnostic: ReturnType<typeof vi.fn>;
} {
	const objectives = new Map<string, string>();
	return {
		Initialize: vi.fn().mockReturnValue("true"),
		Terminate: vi.fn().mockReturnValue("true"),
		GetValue: vi.fn((key: string) =>
			key === "cmi.objectives._count"
				? String(
						[...objectives.keys()].filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key)).length,
					)
				: (objectives.get(key) ?? ""),
		),
		SetValue: vi.fn((key: string, value: string) => {
			if (key.startsWith("cmi.objectives.")) objectives.set(key, value);
			return "true";
		}),
		Commit: vi.fn().mockReturnValue("true"),
		GetLastError: vi.fn().mockReturnValue("0"),
		GetErrorString: vi.fn().mockReturnValue(""),
		GetDiagnostic: vi.fn().mockReturnValue(""),
	};
}

/**
 * Create a fake window object whose `parent` points to itself (top-level).
 * Optionally attach an API_1484_11 mock.
 */
function createMockWindow(api?: SCORM2004API): WindowLike {
	const win: WindowLike = {
		API_1484_11: api,
		parent: null as unknown as WindowLike,
		opener: null,
	};
	win.parent = win; // top-level: parent === self
	return win;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Scorm2004Runtime", () => {
	let runtime: Scorm2004Runtime;
	let mockAPI: ReturnType<typeof createMockAPI>;
	let mockWin: WindowLike;

	beforeEach(() => {
		mockAPI = createMockAPI();
		mockWin = createMockWindow(mockAPI);
		runtime = new Scorm2004Runtime(mockWin);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// 1. findAPI() discovers API_1484_11 on window
	// -----------------------------------------------------------------------
	describe("findAPI()", () => {
		it("discovers API_1484_11 on the current window", () => {
			const found = runtime.findAPI();

			expect(found).toBe(true);
		});

		// -------------------------------------------------------------------
		// 2. findAPI() discovers API_1484_11 on parent window
		// -------------------------------------------------------------------
		it("discovers API_1484_11 on a parent window", () => {
			const parentWin = createMockWindow(mockAPI);

			// Child window has no API, but its parent does
			const childWin: WindowLike = {
				parent: parentWin,
				opener: null,
			};

			const childRuntime = new Scorm2004Runtime(childWin);
			const found = childRuntime.findAPI();

			expect(found).toBe(true);
		});

		it("discovers API_1484_11 via window.opener", () => {
			const openerWin = createMockWindow(mockAPI);

			// Current window has no API and no useful parent, but has an opener
			const childWin: WindowLike = {
				parent: null as unknown as WindowLike,
				opener: openerWin,
			};
			childWin.parent = childWin;

			const childRuntime = new Scorm2004Runtime(childWin);
			const found = childRuntime.findAPI();

			expect(found).toBe(true);
		});

		it("returns false when no API_1484_11 exists anywhere", () => {
			const emptyWin = createMockWindow(); // no API
			const emptyRuntime = new Scorm2004Runtime(emptyWin);

			const found = emptyRuntime.findAPI();

			expect(found).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// 3. initialize() calls Initialize
	// -----------------------------------------------------------------------
	describe("initialize()", () => {
		it("calls Initialize on the API", () => {
			const result = runtime.initialize();

			expect(result).toBe(true);
			expect(mockAPI.Initialize).toHaveBeenCalledWith("");
		});

		it("continues a multi-page session that is already initialized", () => {
			mockAPI.Initialize.mockReturnValue("false");
			mockAPI.GetLastError.mockReturnValue("103");
			mockAPI.GetValue.mockImplementation((element: string) =>
				element === "cmi.interactions._count" ? "2" : "",
			);

			expect(runtime.initialize()).toBe(true);
			runtime.trackInteraction("q3", "answer", undefined, undefined, {
				assessmentType: "textResponse",
			});
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.2.id", "q3");
		});

		it("returns false when API is not found", () => {
			const emptyWin = createMockWindow();
			const emptyRuntime = new Scorm2004Runtime(emptyWin);

			const result = emptyRuntime.initialize();

			expect(result).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// 4. getValue() returns correct values
	// -----------------------------------------------------------------------
	describe("getValue()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("returns the value from GetValue", () => {
			mockAPI.GetValue.mockReturnValueOnce("completed");

			const value = runtime.getValue("cmi.completion_status");

			expect(value).toBe("completed");
			expect(mockAPI.GetValue).toHaveBeenCalledWith("cmi.completion_status");
		});

		it("returns empty string when API is not available", () => {
			const emptyWin = createMockWindow();
			const standalone = new Scorm2004Runtime(emptyWin);
			const value = standalone.getValue("cmi.completion_status");

			expect(value).toBe("");
		});
	});

	// -----------------------------------------------------------------------
	// 5. setValue() calls SetValue
	// -----------------------------------------------------------------------
	describe("setValue()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("calls SetValue with the correct arguments", () => {
			const result = runtime.setValue("cmi.completion_status", "completed");

			expect(result).toBe(true);
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.completion_status", "completed");
		});
	});

	// -----------------------------------------------------------------------
	// 6. commit() calls Commit
	// -----------------------------------------------------------------------
	describe("commit()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("calls Commit on the API", () => {
			const result = runtime.commit();

			expect(result).toBe(true);
			expect(mockAPI.Commit).toHaveBeenCalledWith("");
		});
	});

	// -----------------------------------------------------------------------
	// 7. terminate() calls Terminate
	// -----------------------------------------------------------------------
	describe("terminate()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("calls Terminate on the API", () => {
			const result = runtime.terminate();

			expect(result).toBe(true);
			expect(mockAPI.Terminate).toHaveBeenCalledWith("");
		});
	});

	// -----------------------------------------------------------------------
	// 8. Error handling when GetLastError returns non-zero
	// -----------------------------------------------------------------------
	describe("error handling", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("logs a warning when GetLastError returns a non-zero code", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			mockAPI.GetLastError.mockReturnValue("301");
			mockAPI.GetErrorString.mockReturnValue("Not initialized");
			mockAPI.GetDiagnostic.mockReturnValue("Call Initialize first");

			runtime.getValue("cmi.completion_status");

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Error 301"));
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Not initialized"));
		});

		it("does not log when GetLastError returns zero", () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			mockAPI.GetLastError.mockReturnValue("0");

			runtime.getValue("cmi.completion_status");

			expect(warnSpy).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// 9. trackPageVisit() stores in suspend_data
	// -----------------------------------------------------------------------
	describe("trackPageVisit()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("stores the page id in suspend_data as JSON", () => {
			runtime.trackPageVisit("page-1");

			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.suspend_data",
				expect.stringContaining("page-1"),
			);

			// Verify the structure
			const call = mockAPI.SetValue.mock.calls.find((c: string[]) => c[0] === "cmi.suspend_data");
			const stored = JSON.parse(call?.[1]);
			expect(stored.visitedPages).toEqual(["page-1"]);
		});

		it("does not duplicate page ids", () => {
			// First visit writes to suspend_data
			runtime.trackPageVisit("page-1");

			// Make GetValue return what was just written for subsequent reads
			const firstWrite = mockAPI.SetValue.mock.calls.find(
				(c: string[]) => c[0] === "cmi.suspend_data",
			);
			mockAPI.GetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") {
					return firstWrite?.[1];
				}
				return "";
			});

			runtime.trackPageVisit("page-1");

			// Should still only have one entry
			const lastCall = mockAPI.SetValue.mock.calls
				.filter((c: string[]) => c[0] === "cmi.suspend_data")
				.pop();
			const stored = JSON.parse(lastCall?.[1]);
			expect(stored.visitedPages).toEqual(["page-1"]);
		});
	});

	// -----------------------------------------------------------------------
	// 10. getVisitedPages() parses from suspend_data
	// -----------------------------------------------------------------------
	describe("getVisitedPages()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("returns visited pages from suspend_data", () => {
			const data = JSON.stringify({ visitedPages: ["page-1", "page-2"] });
			mockAPI.GetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") {
					return data;
				}
				return "";
			});

			const pages = runtime.getVisitedPages();

			expect(pages).toEqual(["page-1", "page-2"]);
		});

		it("returns empty array when no suspend_data exists", () => {
			mockAPI.GetValue.mockReturnValue("");

			const pages = runtime.getVisitedPages();

			expect(pages).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// 11. trackInteraction() writes to cmi.interactions.N.* with 2004 fields
	// -----------------------------------------------------------------------
	describe("trackInteraction()", () => {
		it("keeps the base letter when its combining mark exceeds the response cap", () => {
			const expected = `${"x".repeat(3899)}e`;
			mockAPI.GetValue.mockImplementation(
				(key: string) =>
					[...mockAPI.SetValue.mock.calls]
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
				mockAPI.SetValue.mock.calls.find(
					(call: string[]) => call[0] === "cmi.interactions.0.learner_response",
				)?.[1],
			).toBe(expected);
			expect(runtime.getInteractions()[0].response).toBe(expected);
		});
		it.each([3898, 3899, 3900])(
			"keeps whole code points at the response cap after %s units",
			(prefixLength) => {
				const prefix = "x".repeat(prefixLength);
				const response = `${prefix}\u{1f600}tail`;
				mockAPI.GetValue.mockImplementation(
					(key: string) =>
						[...mockAPI.SetValue.mock.calls]
							.reverse()
							.find((call: string[]) => call[0] === key)?.[1] ?? "",
				);
				runtime.trackInteraction("unicode-boundary", response, undefined, undefined, {
					assessmentType: "textResponse",
				});
				const stored = mockAPI.SetValue.mock.calls.find(
					(call: string[]) => call[0] === "cmi.interactions.0.learner_response",
				)?.[1];
				expect(stored).toBe(prefixLength === 3898 ? `${prefix}\u{1f600}` : prefix);
				expect(stored.isWellFormed()).toBe(true);
				expect(runtime.getInteractions()[0].response).toBe(stored);
			},
		);
		beforeEach(() => {
			runtime.initialize();
		});

		it("writes interaction data to cmi.interactions.0.*", () => {
			runtime.trackInteraction("q1", "option-a", true, 1);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.id", "q1");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.type", "choice");
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.learner_response",
				"option-a",
			);
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.result", "correct");
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.description",
				"{lang=en}Interaction q1",
			);
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.timestamp",
				// RTE 4.1.1.7: a time zone designator requires fractional seconds.
				expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,2}Z$/),
			);
		});

		it("increments the interaction counter for subsequent calls", () => {
			runtime.trackInteraction("q1", "a", true);

			// Make suspend_data round-trip work for second call
			const suspendCall = mockAPI.SetValue.mock.calls.find(
				(c: string[]) => c[0] === "cmi.suspend_data",
			);
			mockAPI.GetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") {
					return suspendCall?.[1];
				}
				return "";
			});

			runtime.trackInteraction("q2", "b", false);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.1.id", "q2");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.1.result", "incorrect");
		});

		it("stores interaction records in suspend_data", () => {
			runtime.trackInteraction("q1", "option-a", true, 1);

			const suspendCall = mockAPI.SetValue.mock.calls.find(
				(c: string[]) => c[0] === "cmi.suspend_data",
			);
			const stored = JSON.parse(suspendCall?.[1]);
			expect(stored.interactions).toHaveLength(1);
			expect(stored.interactions[0]).toMatchObject({
				id: "q1",
				response: "option-a",
				correct: true,
				score: 1,
			});
		});

		it("records open responses as neutral long-fill-in interactions", () => {
			runtime.trackInteraction("comments", "A long response", undefined, undefined, {
				assessmentType: "textResponse",
			});

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.type", "long-fill-in");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.result", "neutral");
		});

		it("keeps complete choice identifiers when their set exceeds the free-text cap", () => {
			const response = Array.from({ length: 16 }, (_, index) => `${index}-${"a".repeat(247)}`).join(
				"[,]",
			);
			runtime.trackInteraction("choices", response, undefined, undefined, {
				assessmentType: "choice",
			});
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.learner_response",
				response,
			);
		});

		it("bounds descriptions by Unicode characters and never cuts a word", () => {
			runtime.trackInteraction("unicode", "", undefined, undefined, {
				description: `${"😀 ".repeat(130)}end`,
			});
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.description",
				`{lang=en}${"😀 ".repeat(124).trim()}…`,
			);
			runtime.trackInteraction("word", "", undefined, undefined, { description: "a".repeat(251) });
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.1.description", "{lang=en}…");
		});

		it("excludes the validated language delimiter from the 250-character SPM", () => {
			runtime.trackInteraction("question", "", undefined, undefined, {
				description: "a".repeat(250),
				language: "fr-CA",
			});
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.description",
				`{lang=fr-CA}${"a".repeat(250)}`,
			);
		});

		it.each([undefined, "", " fr", "fr_CA", "{lang=fr}", "fr-tooLongTag"])(
			"preserves literal delimiter text with missing or invalid language %s",
			(language) => {
				runtime.trackInteraction("question", "", undefined, undefined, {
					description: "{lang= fr} Quelle réponse?",
					language,
				});
				expect(mockAPI.SetValue).toHaveBeenCalledWith(
					"cmi.interactions.0.description",
					"{lang=en}{lang= fr} Quelle réponse?",
				);
				runtime.trackInteraction("plain", "", undefined, undefined, {
					description: "Question",
					language,
				});
				expect(mockAPI.SetValue).toHaveBeenCalledWith(
					"cmi.interactions.1.description",
					"{lang=en}Question",
				);
			},
		);

		it("logs a rejected description and preserves both answers in distinct rows", () => {
			const data = new Map<string, string>();
			let error = "0";
			mockAPI.GetValue.mockImplementation((key: string) => data.get(key) ?? "");
			mockAPI.GetLastError.mockImplementation(() => error);
			mockAPI.SetValue.mockImplementation((key: string, value: string) => {
				error = key === "cmi.interactions.0.description" ? "351" : "0";
				if (error !== "0") return "false";
				data.set(key, value);
				return "true";
			});
			const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
			expect(() =>
				runtime.trackInteraction("question", "answer", undefined, undefined, {
					description: "Question",
					language: "fr",
				}),
			).not.toThrow();
			expect(warnings).toHaveBeenCalledWith(expect.stringContaining("Error 351"));
			runtime.trackInteraction("next", "next-answer");
			expect(data.get("cmi.interactions.0.id")).toBe("question");
			expect(data.get("cmi.interactions.0.learner_response")).toBe("answer");
			expect(data.get("cmi.interactions.1.id")).toBe("next");
			expect(runtime.getInteractions()).toEqual([
				expect.objectContaining({ id: "question", response: "answer" }),
				expect.objectContaining({ id: "next", response: "next-answer" }),
			]);
		});

		it("records blank selections as scored long-fill-in responses", () => {
			const response = JSON.stringify({ first: "light blue", second: "red" });
			runtime.trackInteraction("blanks", response, true, 1, { assessmentType: "fillBlank" });
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.type", "long-fill-in");
			expect(mockAPI.SetValue).toHaveBeenCalledWith(
				"cmi.interactions.0.learner_response",
				response,
			);
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.interactions.0.result", "correct");
		});
	});

	// -----------------------------------------------------------------------
	// 12. setCompletion("passed") sets both completion_status and success_status
	// -----------------------------------------------------------------------
	describe("setCompletion()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("reports success separately without changing completion", () => {
			mockAPI.SetValue.mockClear();
			runtime.setSuccess("failed");

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.success_status", "failed");
			expect(mockAPI.SetValue).not.toHaveBeenCalledWith("cmi.completion_status", expect.anything());
		});

		it('sets both completion_status and success_status for "passed"', () => {
			runtime.setCompletion("passed");
			expect(runtime.getCompletion()).toBe("completed");
			expect(runtime.commit()).toBe(true);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.completion_status", "completed");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.success_status", "passed");
		});

		it('sets both completion_status and success_status for "failed"', () => {
			runtime.setCompletion("failed");
			expect(runtime.getCompletion()).toBe("completed");
			expect(runtime.commit()).toBe(true);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.completion_status", "completed");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.success_status", "failed");
		});

		// -------------------------------------------------------------------
		// 13. setCompletion("incomplete") only sets completion_status
		// -------------------------------------------------------------------
		it('only sets completion_status for "incomplete"', () => {
			runtime.setCompletion("incomplete");
			expect(runtime.getCompletion()).toBe("incomplete");
			expect(runtime.commit()).toBe(true);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.completion_status", "incomplete");
			expect(mockAPI.SetValue).not.toHaveBeenCalledWith("cmi.success_status", expect.any(String));
		});

		it('only sets completion_status for "completed"', () => {
			runtime.setCompletion("completed");
			expect(runtime.getCompletion()).toBe("completed");
			expect(runtime.commit()).toBe(true);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.completion_status", "completed");
			expect(mockAPI.SetValue).not.toHaveBeenCalledWith("cmi.success_status", expect.any(String));
		});
	});

	// -----------------------------------------------------------------------
	// 14. setScore() sets raw/min/max/scaled scores
	// -----------------------------------------------------------------------
	describe("setScore()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("sets raw, min, max, and scaled scores", () => {
			runtime.setScore(80, 0, 100);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.score.raw", "80");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.score.min", "0");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.score.max", "100");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.score.scaled", "0.8");
		});

		it("computes scaled score correctly for non-zero min", () => {
			runtime.setScore(75, 50, 100);

			// scaled = (75 - 50) / (100 - 50) = 0.5
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.score.scaled", "0.5");
		});
	});

	// -----------------------------------------------------------------------
	// 15. setBookmark() uses cmi.location
	// -----------------------------------------------------------------------
	describe("setBookmark() / getBookmark()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("sets cmi.location", () => {
			runtime.setBookmark("page-3");

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.location", "page-3");
		});

		it("returns the bookmark from cmi.location", () => {
			mockAPI.GetValue.mockImplementation((element: string) => {
				if (element === "cmi.location") {
					return "page-5";
				}
				return "";
			});

			const bookmark = runtime.getBookmark();

			expect(bookmark).toBe("page-5");
		});

		it("returns null when no bookmark is set", () => {
			mockAPI.GetValue.mockReturnValue("");

			const bookmark = runtime.getBookmark();

			expect(bookmark).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// 16. setSuspendData() and getSuspendData() use cmi.suspend_data
	// -----------------------------------------------------------------------
	describe("setSuspendData() / getSuspendData()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("sets cmi.suspend_data", () => {
			runtime.setSuspendData('{"key":"value"}');

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.suspend_data", '{"key":"value"}');
		});

		it("returns suspend data from cmi.suspend_data", () => {
			mockAPI.GetValue.mockImplementation((element: string) => {
				if (element === "cmi.suspend_data") {
					return '{"key":"value"}';
				}
				return "";
			});

			const data = runtime.getSuspendData();

			expect(data).toBe('{"key":"value"}');
		});

		it("returns null when no suspend data exists", () => {
			mockAPI.GetValue.mockReturnValue("");

			const data = runtime.getSuspendData();

			expect(data).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// getScore() / getCompletion() / getInteractions()
	// -----------------------------------------------------------------------
	describe("getScore()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("returns parsed score values", () => {
			mockAPI.GetValue.mockImplementation((element: string) => {
				const scores: Record<string, string> = {
					"cmi.score.raw": "85",
					"cmi.score.min": "0",
					"cmi.score.max": "100",
				};
				return scores[element] ?? "";
			});

			const score = runtime.getScore();

			expect(score).toEqual({ raw: 85, min: 0, max: 100 });
		});

		it("returns null when no score is set", () => {
			mockAPI.GetValue.mockReturnValue("");

			const score = runtime.getScore();

			expect(score).toBeNull();
		});
	});

	describe("getCompletion()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("returns completion status", () => {
			mockAPI.GetValue.mockImplementation((element: string) => {
				if (element === "cmi.completion_status") {
					return "completed";
				}
				return "";
			});

			expect(runtime.getCompletion()).toBe("completed");
		});

		it('returns "unknown" when no status is set', () => {
			mockAPI.GetValue.mockReturnValue("");

			expect(runtime.getCompletion()).toBe("unknown");
		});
	});

	describe("trackObjective", () => {
		it("sets cmi.objectives.N.id, score.raw, and success_status", () => {
			runtime.initialize();
			runtime.trackObjective("group-1", 85, true);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.objectives.0.id", "group-1");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.objectives.0.score.raw", "85");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.objectives.0.success_status", "passed");
		});

		it("increments objective index on multiple calls", () => {
			runtime.initialize();
			runtime.trackObjective("group-1", 85, true);
			runtime.trackObjective("group-2", 40, false);

			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.objectives.1.id", "group-2");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.objectives.1.score.raw", "40");
			expect(mockAPI.SetValue).toHaveBeenCalledWith("cmi.objectives.1.success_status", "failed");
		});
	});
});
