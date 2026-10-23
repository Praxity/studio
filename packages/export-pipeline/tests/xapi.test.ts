import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { VariableStore } from "@praxity/shared-blocks/logic";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import type { XapiConfig, XapiStatement } from "../src/scorm/api/xapi";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { CourseTracker } from "../src/scorm/tracking";
import {
	initializeCourseHost,
	readCourseDeploymentConfig,
} from "../template/src/hosts/course-host";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createConfig(overrides?: Partial<XapiConfig>): XapiConfig {
	return {
		endpoint: "https://lrs.example.com/xapi/statements",
		auth: "Basic dXNlcjpwYXNz",
		actor: {
			name: "Test Learner",
			mbox: "mailto:learner@example.com",
		},
		...overrides,
	};
}

/**
 * Extract the statement body from the most recent fetch call.
 * Returns null if fetch was never called.
 */
function lastStatementSent(): XapiStatement | null {
	const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
	const calls = mockFetch.mock.calls;
	if (calls.length === 0) return null;
	const lastCall = calls[calls.length - 1];
	const init = lastCall[1] as RequestInit;
	return JSON.parse(init.body as string) as XapiStatement;
}

/**
 * Return all statement bodies sent via fetch, in order.
 */
function allStatementsSent(): XapiStatement[] {
	const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
	return mockFetch.mock.calls.map((call) => {
		const init = call[1] as RequestInit;
		return JSON.parse(init.body as string) as XapiStatement;
	});
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("XapiRuntime", () => {
	let runtime: XapiRuntime;
	let config: XapiConfig;

	beforeEach(() => {
		config = createConfig();
		runtime = new XapiRuntime(config);

		// Mock fetch globally
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("XapiRuntime — actor resolution", () => {
		it("uses manual actor when actorMode is manual", () => {
			const manualRuntime = new XapiRuntime({
				endpoint: "https://lrs.example.com/xapi/statements",
				auth: "Basic dGVzdDp0ZXN0",
				actor: { name: "Test User", mbox: "mailto:test@example.com" },
				actorMode: "manual",
			});
			expect(manualRuntime.initialize()).toBe(true);
		});

		it("fails safe when actorMode is lms and no launch actor available", () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const lmsRuntime = new XapiRuntime({
				endpoint: "https://lrs.example.com/xapi/statements",
				auth: "Basic dGVzdDp0ZXN0",
				actorMode: "lms",
			});
			expect(lmsRuntime.initialize()).toBe(true);
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("xAPI actor not resolved"));
			consoleSpy.mockRestore();
		});
	});

	it.each([
		[3, 3],
		[Infinity, 0],
	])(
		"keeps retried interaction metadata like SCORM 1.2 with limit %s",
		(maxAttempts, storedLimit) => {
			const values = new Map<string, string>();
			vi.stubGlobal("window", {
				API: {
					LMSInitialize: () => "true",
					LMSGetValue: (key: string) => values.get(key) ?? "",
					LMSSetValue: (key: string, value: string) => {
						values.set(key, value);
						return "true";
					},
					LMSGetLastError: () => "0",
				},
			});
			try {
				const options = { attemptsUsed: 2, maxAttempts, memberIds: ["q1", "q2"] };
				const scorm = new Scorm12Runtime();
				expect(scorm.initialize()).toBe(true);
				scorm.trackInteraction("group", "b", true, 100, options);
				runtime.trackInteraction("group", "b", true, 100, options);
				const expected = { attemptsUsed: 2, maxAttempts: storedLimit, memberIds: ["q1", "q2"] };
				expect(scorm.getInteractions()[0]).toMatchObject(expected);
				expect(runtime.getInteractions()[0]).toMatchObject(expected);
			} finally {
				vi.unstubAllGlobals();
			}
		},
	);

	// -------------------------------------------------------------------
	// 1. buildStatement() produces correct structure
	// -------------------------------------------------------------------
	describe("buildStatement()", () => {
		it("gives different statements distinct UUIDs", () => {
			runtime.trackPageVisit("p1");
			runtime.trackPageVisit("p2");
			const [first, second] = allStatementsSent();
			const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
			expect(first.id).toMatch(uuid);
			expect(second.id).toMatch(uuid);
			expect(first.id).not.toBe(second.id);
		});

		it("uses the native randomUUID when available", () => {
			vi.spyOn(crypto, "randomUUID").mockReturnValue("12345678-1234-4123-8123-123456789abc");
			runtime.trackPageVisit("p1");
			expect(lastStatementSent()?.id).toBe("12345678-1234-4123-8123-123456789abc");
		});

		it.each([
			[0, "00000000-0000-4000-8000-000000000000"],
			[255, "ffffffff-ffff-4fff-bfff-ffffffffffff"],
		])("builds a v4 UUID without randomUUID from random bytes %i", (byte, expected) => {
			vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(byte) });
			try {
				runtime.trackPageVisit("p1");
				expect(lastStatementSent()?.id).toBe(expected);
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("produces a statement with actor, verb, object, and timestamp", () => {
			const statement = runtime.buildStatement("initialized", {
				id: "https://example.com/course",
				definition: { name: { "en-US": "Test Course" } },
			});

			expect(statement.actor).toEqual({
				name: "Test Learner",
				mbox: "mailto:learner@example.com",
			});
			expect(statement.verb).toEqual({
				id: "http://adlnet.gov/expapi/verbs/initialized",
				display: { "en-US": "initialized" },
			});
			expect(statement.object.id).toBe("https://example.com/course");
			expect(statement.object.definition?.name?.["en-US"]).toBe("Test Course");
			expect(statement.timestamp).toBeDefined();
			expect(statement.result).toBeUndefined();
		});

		it("includes result when provided", () => {
			const statement = runtime.buildStatement(
				"answered",
				{ id: "https://example.com/q1" },
				{ success: true, score: { raw: 1 } },
			);

			expect(statement.result).toEqual({
				success: true,
				score: { raw: 1 },
			});
		});

		it("prefixes mbox with mailto: when not already present", () => {
			const bareConfig = createConfig({
				actor: { name: "Learner", mbox: "learner@example.com" },
			});
			const bareRuntime = new XapiRuntime(bareConfig);

			const statement = bareRuntime.buildStatement("initialized", {
				id: "https://example.com/course",
			});

			expect(statement.actor.mbox).toBe("mailto:learner@example.com");
		});

		it("does not double-prefix mbox when mailto: is already present", () => {
			const statement = runtime.buildStatement("initialized", {
				id: "https://example.com/course",
			});

			expect(statement.actor.mbox).toBe("mailto:learner@example.com");
		});

		it("sets a valid ISO 8601 timestamp", () => {
			const before = new Date().toISOString();
			const statement = runtime.buildStatement("initialized", {
				id: "https://example.com/course",
			});
			const after = new Date().toISOString();

			expect(statement.timestamp >= before).toBe(true);
			expect(statement.timestamp <= after).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// 2. sendStatement() POSTs to endpoint with correct headers
	// -------------------------------------------------------------------
	describe("sendStatement()", () => {
		it("reuses the built statement UUID after a failed send", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const fetch = globalThis.fetch as ReturnType<typeof vi.fn>;
			fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
			const statement = runtime.buildStatement("experienced", { id: "https://example.com/p1" });
			expect(statement).toHaveProperty("id", expect.any(String));
			await runtime.sendStatement(statement);
			runtime.initialize();
			const [first, retry] = allStatementsSent();
			expect(retry.id).toBe(statement.id);
			expect(retry).toEqual(first);
		});

		it("POSTs to the configured endpoint with correct headers", async () => {
			const statement = runtime.buildStatement("initialized", {
				id: "https://example.com/course",
			});

			await runtime.sendStatement(statement);

			const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
			expect(mockFetch).toHaveBeenCalledTimes(1);

			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe("https://lrs.example.com/xapi/statements");
			expect((init as RequestInit).method).toBe("POST");

			const headers = (init as RequestInit).headers as Record<string, string>;
			expect(headers["Content-Type"]).toBe("application/json");
			expect(headers.Authorization).toBe("Basic dXNlcjpwYXNz");
			expect(headers["X-Experience-API-Version"]).toBe("1.0.3");
		});

		it("sends the statement as a JSON body", async () => {
			const statement = runtime.buildStatement("experienced", {
				id: "https://example.com/page/1",
			});

			await runtime.sendStatement(statement);

			const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
			const [, init] = mockFetch.mock.calls[0];
			const body = JSON.parse((init as RequestInit).body as string) as XapiStatement;
			expect(body.verb.id).toBe("http://adlnet.gov/expapi/verbs/experienced");
			expect(body.object.id).toBe("https://example.com/page/1");
		});
	});

	// -------------------------------------------------------------------
	// 3. initialize() sends "initialized" verb
	// -------------------------------------------------------------------
	describe("initialize()", () => {
		it("sends an 'initialized' statement and returns true", () => {
			const result = runtime.initialize();

			expect(result).toBe(true);

			const statement = lastStatementSent();
			expect(statement).not.toBeNull();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/initialized");
		});

		it("returns true without re-sending if already initialized", () => {
			runtime.initialize();
			const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
			mockFetch.mockClear();

			const result = runtime.initialize();

			expect(result).toBe(true);
			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------
	// setSuccess() reports the course result separately from completion
	// -------------------------------------------------------------------
	describe("setSuccess()", () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends passed or failed once per change, with the result's success", () => {
			runtime.setSuccess("passed");
			expect(lastStatementSent()?.verb.id).toBe("http://adlnet.gov/expapi/verbs/passed");
			expect(lastStatementSent()?.result?.success).toBe(true);
			const sent = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
			runtime.setSuccess("passed");
			expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(sent);
			runtime.setSuccess("failed");
			expect(lastStatementSent()?.verb.id).toBe("http://adlnet.gov/expapi/verbs/failed");
			expect(runtime.getSuccess()).toBe("failed");
		});

		it("sends nothing while the result is unknown", () => {
			runtime.setSuccess("unknown");
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it.each([
			{ score: 0, result: "failed", success: false },
			{ score: 90, result: "passed", success: true },
		])(
			"reports quiz score $score as $result before page completion",
			({ score, result, success }) => {
				const tracker = new CourseTracker(runtime, {
					totalPages: 2,
					completionMethod: "quiz",
					passMark: 80,
					scoredAssessmentIds: ["q1"],
				});
				tracker.trackPageVisit("intro");
				tracker.trackInteraction("q1", "answer", success, score);
				const statement = lastStatementSent();
				expect(statement?.verb.id).toBe(`http://adlnet.gov/expapi/verbs/${result}`);
				expect(statement?.result).toMatchObject({
					success,
					completion: false,
					score: { raw: score, min: 0, max: 100, scaled: score / 100 },
				});
				tracker.trackPageVisit("summary");
				expect(lastStatementSent()?.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
			},
		);
	});

	// -------------------------------------------------------------------
	// 4. terminate() sends appropriate completion verb
	// -------------------------------------------------------------------
	describe("terminate()", () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends a 'completed' statement by default and returns true", () => {
			const result = runtime.terminate();

			expect(result).toBe(true);

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
		});

		it("sends 'passed' when completion status is passed", () => {
			runtime.setCompletion("passed");
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

			runtime.terminate();

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/passed");
		});

		it("sends 'failed' when completion status is failed", () => {
			runtime.setCompletion("failed");
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

			runtime.terminate();

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/failed");
		});

		it("includes score in the result when score has been set", () => {
			runtime.setScore(85, 0, 100);
			runtime.terminate();

			const statement = lastStatementSent();
			expect(statement?.result?.score).toEqual({
				raw: 85,
				min: 0,
				max: 100,
				scaled: 0.85,
			});
		});

		it("returns false when not initialized", () => {
			const uninitRuntime = new XapiRuntime(config);
			const result = uninitRuntime.terminate();

			expect(result).toBe(false);
		});
	});

	// -------------------------------------------------------------------
	// 5. trackPageVisit() sends "experienced" verb and tracks locally
	// -------------------------------------------------------------------
	describe("trackPageVisit()", () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends an 'experienced' statement for the page", () => {
			runtime.trackPageVisit("page-1");

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/experienced");
			expect(statement?.object.id).toContain("page/page-1");
		});

		it("adds the page to the local visited pages list", () => {
			runtime.trackPageVisit("page-1");

			expect(runtime.getVisitedPages()).toContain("page-1");
		});

		it("does not duplicate page IDs in the local list", () => {
			runtime.trackPageVisit("page-1");
			runtime.trackPageVisit("page-1");

			const pages = runtime.getVisitedPages();
			expect(pages.filter((p) => p === "page-1")).toHaveLength(1);
		});

		it("still sends a statement on duplicate visit (for analytics)", () => {
			runtime.trackPageVisit("page-1");
			runtime.trackPageVisit("page-1");

			const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});
	});

	// -------------------------------------------------------------------
	// 6. getVisitedPages() returns tracked pages
	// -------------------------------------------------------------------
	describe("getVisitedPages()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("returns an empty array when no pages have been visited", () => {
			expect(runtime.getVisitedPages()).toEqual([]);
		});

		it("returns all tracked page IDs in order", () => {
			runtime.trackPageVisit("page-1");
			runtime.trackPageVisit("page-2");
			runtime.trackPageVisit("page-3");

			expect(runtime.getVisitedPages()).toEqual(["page-1", "page-2", "page-3"]);
		});

		it("returns a copy, not a reference to the internal array", () => {
			runtime.trackPageVisit("page-1");
			const pages = runtime.getVisitedPages();
			pages.push("page-hacked");

			expect(runtime.getVisitedPages()).toEqual(["page-1"]);
		});
	});

	// -------------------------------------------------------------------
	// 7. trackInteraction() sends "answered" verb with result
	// -------------------------------------------------------------------
	describe("trackInteraction()", () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends an 'answered' statement with success and response", () => {
			runtime.trackInteraction("q1", "option-a", true, 1);

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/answered");
			expect(statement?.result?.success).toBe(true);
			expect(statement?.result?.response).toBe("option-a");
			expect(statement?.result?.score?.raw).toBe(1);
		});

		it("sends 'answered' with success=false for incorrect response", () => {
			runtime.trackInteraction("q1", "option-b", false);

			const statement = lastStatementSent();
			expect(statement?.result?.success).toBe(false);
		});

		it("uses the authored question description in its language", () => {
			runtime.trackInteraction("question", "ecole-astres", undefined, undefined, {
				description: "  Quel télescope\n souhaitez-vous?  ",
				language: "fr",
			});
			const statement = lastStatementSent();
			expect(statement?.object.definition?.description).toEqual({
				fr: "Quel télescope souhaitez-vous?",
			});
			expect(statement?.result?.response).toBe("ecole-astres");
		});

		it("keeps authored delimiter text literal without a SCORM prefix", () => {
			runtime.trackInteraction("question", "oui", undefined, undefined, {
				description: "{lang= fr} Quelle réponse?",
				language: "fr",
			});
			expect(lastStatementSent()?.object.definition?.description).toEqual({
				fr: "{lang= fr} Quelle réponse?",
			});
		});

		it("omits score from result when score is not provided", () => {
			runtime.trackInteraction("q1", "option-a", true);

			const statement = lastStatementSent();
			expect(statement?.result?.score).toBeUndefined();
		});

		it("stores interaction in local records with timestamp", () => {
			const now = Date.now();
			vi.spyOn(Date, "now").mockReturnValue(now);

			runtime.trackInteraction("q1", "option-a", true, 1);

			const interactions = runtime.getInteractions();
			expect(interactions).toHaveLength(1);
			expect(interactions[0]).toEqual({
				id: "q1",
				response: "option-a",
				correct: true,
				score: 1,
				timestamp: now,
			});
		});
	});

	// -------------------------------------------------------------------
	// 8. getInteractions() returns tracked interactions
	// -------------------------------------------------------------------
	describe("getInteractions()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("returns an empty array when no interactions have been tracked", () => {
			expect(runtime.getInteractions()).toEqual([]);
		});

		it("returns all tracked interactions in order", () => {
			runtime.trackInteraction("q1", "a", true);
			runtime.trackInteraction("q2", "b", false);

			const interactions = runtime.getInteractions();
			expect(interactions).toHaveLength(2);
			expect(interactions[0].id).toBe("q1");
			expect(interactions[1].id).toBe("q2");
		});

		it("returns a copy, not a reference to the internal array", () => {
			runtime.trackInteraction("q1", "a", true);
			const interactions = runtime.getInteractions();
			interactions.push({
				id: "hacked",
				response: "x",
				correct: false,
				timestamp: 0,
			});

			expect(runtime.getInteractions()).toHaveLength(1);
		});
	});

	// -------------------------------------------------------------------
	// 9. setCompletion("passed") sends "passed" verb
	// -------------------------------------------------------------------
	describe('setCompletion("passed")', () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends a 'passed' statement", () => {
			runtime.setCompletion("passed");

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/passed");
			expect(statement?.result?.success).toBe(true);
			expect(statement?.result?.completion).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// 10. setCompletion("failed") sends "failed" verb
	// -------------------------------------------------------------------
	describe('setCompletion("failed")', () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends a 'failed' statement", () => {
			runtime.setCompletion("failed");

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/failed");
			expect(statement?.result?.success).toBe(false);
			expect(statement?.result?.completion).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// setCompletion("completed") sends "completed" verb
	// -------------------------------------------------------------------
	describe('setCompletion("completed")', () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("sends a 'completed' statement", () => {
			runtime.setCompletion("completed");

			const statement = lastStatementSent();
			expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
			expect(statement?.result?.completion).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// setCompletion("incomplete") does not send a statement
	// -------------------------------------------------------------------
	describe('setCompletion("incomplete")', () => {
		beforeEach(() => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		});

		it("does not send any statement for incomplete", () => {
			runtime.setCompletion("incomplete");

			const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it("updates the local completion status", () => {
			runtime.setCompletion("incomplete");

			expect(runtime.getCompletion()).toBe("incomplete");
		});
	});

	// -------------------------------------------------------------------
	// 11. setScore() stores score for inclusion in statements
	// -------------------------------------------------------------------
	describe("setScore()", () => {
		beforeEach(() => {
			runtime.initialize();
		});

		it("stores the score locally", () => {
			runtime.setScore(85, 0, 100);

			expect(runtime.getScore()).toEqual({ raw: 85, min: 0, max: 100 });
		});

		it("returns null when no score has been set", () => {
			expect(runtime.getScore()).toBeNull();
		});

		it("includes score in completion statements", () => {
			runtime.setScore(90, 0, 100);
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

			runtime.setCompletion("passed");

			const statement = lastStatementSent();
			expect(statement?.result?.score).toEqual({
				raw: 90,
				min: 0,
				max: 100,
				scaled: 0.9,
			});
		});

		it("computes scaled score correctly for non-zero min", () => {
			runtime.setScore(75, 50, 100);
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

			runtime.setCompletion("completed");

			const statement = lastStatementSent();
			expect(statement?.result?.score?.scaled).toBe(0.5);
		});

		it("returns a copy, not a reference to the internal score", () => {
			runtime.setScore(80, 0, 100);
			const score = runtime.getScore();
			if (score) {
				score.raw = 999;
			}

			expect(runtime.getScore()?.raw).toBe(80);
		});
	});

	// -------------------------------------------------------------------
	// 12. setBookmark() / getBookmark() work with local storage
	// -------------------------------------------------------------------
	describe("setBookmark() / getBookmark()", () => {
		it("stores and retrieves a bookmark locally", () => {
			runtime.setBookmark("page-3");

			expect(runtime.getBookmark()).toBe("page-3");
		});

		it("returns null when no bookmark is set", () => {
			expect(runtime.getBookmark()).toBeNull();
		});

		it("overwrites the previous bookmark", () => {
			runtime.setBookmark("page-1");
			runtime.setBookmark("page-5");

			expect(runtime.getBookmark()).toBe("page-5");
		});
	});

	// -------------------------------------------------------------------
	// 13. setSuspendData() / getSuspendData() work with local storage
	// -------------------------------------------------------------------
	describe("setSuspendData() / getSuspendData()", () => {
		it("keeps logic usable when durable storage is unavailable", () => {
			const variables = new VariableStore([{ name: "answer", dataType: "text" }], runtime);
			expect(() => variables.set("answer", "Learner answer")).not.toThrow();
			expect(variables.get("answer")).toBe("Learner answer");
			expect(runtime.getSuspendData()).toBe('{"v":{"answer":"Learner answer"}}');
		});

		it("stores and retrieves suspend data locally", () => {
			expect(runtime.setSuspendData('{"progress":50}')).toBe(false);

			expect(runtime.getSuspendData()).toBe('{"progress":50}');
		});

		it("returns null when no suspend data is set", () => {
			expect(runtime.getSuspendData()).toBeNull();
		});

		it("overwrites previous suspend data", () => {
			expect(runtime.setSuspendData("old-data")).toBe(false);
			expect(runtime.setSuspendData("new-data")).toBe(false);

			expect(runtime.getSuspendData()).toBe("new-data");
		});
	});

	// -------------------------------------------------------------------
	// 14. commit() returns true
	// -------------------------------------------------------------------
	describe("commit()", () => {
		it("returns true", () => {
			runtime.initialize();

			expect(runtime.commit()).toBe(true);
		});

		it("clears pending statements", () => {
			runtime.initialize();
			runtime.trackPageVisit("page-1");

			const result = runtime.commit();

			expect(result).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// 15. Network failure in sendStatement is handled gracefully
	// -------------------------------------------------------------------
	describe("network failure handling", () => {
		it("does not throw when fetch rejects", async () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const statement = runtime.buildStatement("initialized", {
				id: "https://example.com/course",
			});

			// Should not throw
			await expect(runtime.sendStatement(statement)).resolves.toBeUndefined();

			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to send statement"));
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Network error"));
		});

		it("initialize() succeeds even when fetch fails", () => {
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
			vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = runtime.initialize();

			expect(result).toBe(true);
		});

		it("trackPageVisit() continues to track locally when fetch fails", () => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
			vi.spyOn(console, "warn").mockImplementation(() => {});

			runtime.trackPageVisit("page-1");

			expect(runtime.getVisitedPages()).toContain("page-1");
		});

		it("trackInteraction() continues to track locally when fetch fails", () => {
			runtime.initialize();
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));
			vi.spyOn(console, "warn").mockImplementation(() => {});

			runtime.trackInteraction("q1", "a", true, 1);

			expect(runtime.getInteractions()).toHaveLength(1);
		});
	});

	// -------------------------------------------------------------------
	// Activity ID construction
	// -------------------------------------------------------------------
	describe("activity ID construction", () => {
		it("uses endpoint as base when no activityBase is configured", () => {
			runtime.initialize();

			const statements = allStatementsSent();
			const initStatement = statements.find(
				(s) => s.verb.id === "http://adlnet.gov/expapi/verbs/initialized",
			);
			expect(initStatement?.object.id).toBe("https://lrs.example.com/xapi/statements/course");
		});

		it("uses activityBase when configured", () => {
			const customConfig = createConfig({
				activityBase: "https://courses.example.com/my-course",
			});
			const customRuntime = new XapiRuntime(customConfig);
			customRuntime.initialize();

			const statements = allStatementsSent();
			const initStatement = statements[statements.length - 1];
			expect(initStatement?.object.id).toBe("https://courses.example.com/my-course/course");
		});

		it("gives the LMS launch ID precedence over an explicit activityBase", () => {
			vi.stubGlobal("window", {
				location: { search: "?activity_id=https%3A%2F%2Flms.example.com%2Fcourse" },
			});
			try {
				new XapiRuntime(
					createConfig({ activityBase: "https://custom.example.com/activity" }),
					"course-1",
					undefined,
					"https://praxity.io/courses/course-1",
				).setCompletion("passed");
				expect(lastStatementSent()?.object.id).toBe("https://lms.example.com/course");
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("ignores a relative launch activity ID", () => {
			vi.stubGlobal("window", { location: { search: "?activity_id=%2Frelative-course" } });
			try {
				new XapiRuntime(
					createConfig(),
					"course-1",
					undefined,
					"https://praxity.io/courses/course-1",
				).setCompletion("completed");
				expect(lastStatementSent()?.object.id).toBe("https://praxity.io/courses/course-1");
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});

	// -------------------------------------------------------------------
	// getCompletion()
	// -------------------------------------------------------------------
	describe("getCompletion()", () => {
		it("returns 'incomplete' by default", () => {
			expect(runtime.getCompletion()).toBe("incomplete");
		});

		it("reflects the most recent setCompletion() call", () => {
			runtime.setCompletion("passed");
			expect(runtime.getCompletion()).toBe("passed");

			runtime.setCompletion("failed");
			expect(runtime.getCompletion()).toBe("failed");
		});
	});
});

it.each(["manual", undefined] as const)(
	"does not treat a %s build-time actor as an LMS learner",
	(actorMode) => {
		const runtime = new XapiRuntime(createConfig({ actorMode }), "course-1");
		expect(runtime.getLearnerIdentity()).toBeNull();
	},
);

describe("XapiRuntime course state across pages", () => {
	function host(reported: boolean, search = "", storage?: Storage) {
		const config = createConfig({ actorMode: "lms" });
		const actor = encodeURIComponent(JSON.stringify(config.actor));
		search = `${search || "?"}${search ? "&" : ""}actor=${actor}`;
		const page = {
			version: 1,
			courseId: "course-1",
			pageId: "page",
			pageTitle: "Practice",
			currentPage: 1,
			totalPages: 2,
			currentSlug: "page",
			availableSlugs: ["page"],
			pageIdMap: { page: "page" },
			completionMethod: "allPages",
			pageRole: "content",
			strings: {},
			blockStatePolicy: { check: reported ? "lms" : "device" },
		};
		const dom = new JSDOM(
			`<!doctype html><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format: "xapi", xapiConfig: config })}</script>`,
			{ url: `https://course.example/page.html${search}` },
		);
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		if (storage) Object.defineProperty(dom.window, "localStorage", { value: storage });
		vi.stubGlobal("window", dom.window);
		const runtime = new XapiRuntime(config, "course-1", dom.window.localStorage);
		initializeCourseHost(
			{
				format: "xapi",
				readDeploymentConfig: readCourseDeploymentConfig,
				createRuntime: () => runtime,
			},
			{
				win: dom.window as unknown as Window,
				doc: dom.window.document,
				location: dom.window.location,
				history: dom.window.history,
			},
		);
		return {
			dom,
			runtime,
			state: (dom.window as unknown as { __praxityBlockState: LearnerBlockStateRuntime })
				.__praxityBlockState,
		};
	}

	it("keeps private answers, ticks and submitted flags out of actual xAPI calls and the saved outbox", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
		const { dom, runtime, state } = host(false);
		try {
			expect(
				state.set("check", {
					version: 1,
					kind: "self-check",
					draft: { answer: "PRIVATE-DRAFT", ticked: ["PRIVATE-TICK"], shown: false },
					submitted: {
						answer: "PRIVATE-SUBMITTED",
						ticked: ["PRIVATE-TICK"],
						shown: true,
						contentRevision: "PRIVATE-REVISION",
					},
				}),
			).toEqual({ status: "saved", destination: "device" });
			const seen = vi.fn();
			dom.window.document.addEventListener("praxity:assessment-response", seen);
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", {
					detail: {
						blockId: "check",
						responseText: "PRIVATE-SUBMITTED",
						assessmentType: "textResponse",
						completed: true,
					},
				}),
			);
			runtime.commit();
			runtime.setSuspendData(
				JSON.stringify({
					blockState: { check: { answer: "PRIVATE-DRAFT" } },
					interactions: [{ id: "check", response: "PRIVATE-SUBMITTED" }],
				}),
			);
			runtime.trackInteraction("check", "PRIVATE-SUBMITTED", true, 100);
			const key = Array.from({ length: dom.window.localStorage.length }, (_, i) =>
				dom.window.localStorage.key(i),
			).find((key) => key?.startsWith("praxity-xapi:")) as string;
			await vi.waitFor(() => expect(dom.window.localStorage.getItem(key)).toContain('"verb"'));
			expect(seen).not.toHaveBeenCalled();
			expect(
				allStatementsSent().filter((statement) => statement.verb.id.endsWith("/answered")),
			).toEqual([]);
			for (const marker of [
				"PRIVATE-DRAFT",
				"PRIVATE-TICK",
				"PRIVATE-SUBMITTED",
				"PRIVATE-REVISION",
				'"shown"',
				'"check"',
			]) {
				expect(JSON.stringify(allStatementsSent())).not.toContain(marker);
				expect(dom.window.localStorage.getItem(key)).not.toContain(marker);
			}
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	});

	it.each([
		["en", "Explain the delay."],
		["fr", "Expliquez le retard."],
	])(
		"sends the neutral %s response with long-fill-in metadata in reporting mode",
		(language, task) => {
			const { dom, state } = host(true);
			try {
				expect(state.set("check", { answer: "draft", ticked: ["criterion"] })).toEqual({
					status: "saved",
					destination: "device",
				});
				dom.window.document.dispatchEvent(
					new dom.window.CustomEvent("praxity:assessment-response", {
						detail: {
							blockId: "check",
							assessmentType: "textResponse",
							responseText: "The report arrives Tuesday.",
							questionText: task,
							language,
							result: "neutral",
							submitted: true,
						},
					}),
				);
				const statement = lastStatementSent();
				expect(statement?.verb.id).toBe("http://adlnet.gov/expapi/verbs/answered");
				expect(statement?.object.definition).toEqual({
					name: { [language]: task },
					description: { [language]: task },
					type: "http://adlnet.gov/expapi/activities/cmi.interaction",
					interactionType: "long-fill-in",
				});
				expect(statement?.result).toEqual({ response: "The report arrives Tuesday." });
				expect(statement?.object.id).toBe("https://praxity.io/courses/course-1/interaction/check");
			} finally {
				dom.window.close();
				vi.unstubAllGlobals();
			}
		},
	);

	it("keeps the full reporting-mode answer without a SCORM truncation notice", () => {
		const { dom } = host(true);
		try {
			const notice = vi.fn();
			dom.window.document.addEventListener("praxity:assessment-response-truncated", notice);
			const answer = "a".repeat(3900) + "TAIL";
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", {
					detail: {
						blockId: "check",
						assessmentType: "textResponse",
						responseText: answer,
						questionText: "Explain the delay.",
						language: "en",
						result: "neutral",
					},
				}),
			);
			expect(lastStatementSent()?.result).toEqual({ response: answer });
			expect(notice).not.toHaveBeenCalled();
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	});
	it("reports a denied reporting-state save without losing the draft", () => {
		const storage = memoryStorage();
		vi.spyOn(storage, "setItem").mockImplementation(() => {
			throw new DOMException("denied", "QuotaExceededError");
		});
		const { dom, state } = host(true, "", storage);
		try {
			state.set("check", { answer: "Unsaved answer", ticked: ["criterion"] });
			expect(state.getSaveResult?.("check")).toEqual({
				status: "not-saved",
				code: "storage-unavailable",
			});
			expect(state.get("check")).toEqual({ answer: "Unsaved answer", ticked: ["criterion"] });
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	});

	it("separates two registration attempts on one device", () => {
		const first = host(false, "?registration=attempt-1");
		try {
			first.state.set("check", { answer: "first attempt" });
			const next = host(false, "?registration=attempt-2", first.dom.window.localStorage);
			expect(next.state.get("check")).toBeUndefined();
			expect(Object.values(first.dom.window.localStorage).join("\n")).not.toContain(
				"first attempt",
			);
			// Both registrations are now known; an existing shell can still save a draft.
			first.state.set("check", { answer: "first attempt resumed" });
			const revisit = host(false, "?registration=attempt-2", first.dom.window.localStorage);
			expect(revisit.state.get("check")).toBeUndefined();
			expect(first.state.get("check")).toEqual({ answer: "first attempt resumed" });
			revisit.dom.window.close();
			next.state.set("check", { answer: "second attempt" });
			const resume = host(false, "?registration=attempt-1", first.dom.window.localStorage);
			expect(resume.state.get("check")).toEqual({ answer: "first attempt resumed" });
			expect(next.state.get("check")).toEqual({ answer: "second attempt" });
			next.dom.window.close();
			resume.dom.window.close();
		} finally {
			first.dom.window.close();
			vi.unstubAllGlobals();
		}
	});

	it("remembers a cleaned registration and preserves another live registration on return", () => {
		const first = host(false, "?registration=attempt-1");
		try {
			first.state.set("check", { answer: "old draft" });
			const next = host(false, "?registration=attempt-2", first.dom.window.localStorage);
			next.state.set("check", { answer: "new draft" });
			const resume = host(false, "?registration=attempt-1", first.dom.window.localStorage);
			expect(resume.state.get("check")).toBeUndefined();
			expect(next.state.get("check")).toEqual({ answer: "new draft" });
			resume.dom.window.close();
			next.dom.window.close();
		} finally {
			first.dom.window.close();
			vi.unstubAllGlobals();
		}
	});

	it("drops a restored private outbox entry before any resend", async () => {
		const storage = memoryStorage();
		storage.setItem(
			"praxity-xapi:course-1:mailto%3Alearner%40example.com",
			JSON.stringify({
				interactions: [{ id: "check", response: "PRIVATE-SUBMITTED", timestamp: 1800000000000 }],
				suspendData: '{"blockState":{"check":{"answer":"PRIVATE-DRAFT"}}}',
				outbox: [
					{
						actor: { name: "Test Learner", mbox: "mailto:learner@example.com" },
						verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
						object: { id: "https://praxity.io/courses/course-1/interaction/check" },
						result: { response: "PRIVATE-SUBMITTED", success: true },
					},
				],
			}),
		);
		const { dom, runtime } = host(false, "", storage);
		try {
			expect(runtime.getInteractions()).toEqual([]);
			expect(runtime.getSuspendData()).toBe("{}");
			await vi.waitFor(() =>
				expect(storage.getItem("praxity-xapi:course-1:mailto%3Alearner%40example.com")).toContain(
					'"outbox":[]',
				),
			);
			expect(
				allStatementsSent().filter((statement) => statement.verb.id.endsWith("/answered")),
			).toEqual([]);
			expect(JSON.stringify(allStatementsSent())).not.toContain("PRIVATE-");
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	});
	function memoryStorage(): Storage {
		const items = new Map<string, string>();
		return {
			get length() {
				return items.size;
			},
			clear: () => items.clear(),
			getItem: (key) => items.get(key) ?? null,
			key: (index) => [...items.keys()][index] ?? null,
			removeItem: (key) => void items.delete(key),
			setItem: (key, value) => void items.set(key, value),
		};
	}

	beforeEach(() => {
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
	});

	it("restores visits, answers and results for the same course and learner", () => {
		const storage = memoryStorage();
		const first = new XapiRuntime(createConfig(), "course-1", storage);
		first.initialize();
		first.trackPageVisit("p1");
		first.trackInteraction("q1", "a", true, 100);
		first.setSuccess("passed");
		first.setCompletion("completed");

		const next = new XapiRuntime(createConfig(), "course-1", storage);
		next.initialize();
		expect(next.getVisitedPages()).toEqual(["p1"]);
		expect(next.getInteractions().map((item) => item.id)).toEqual(["q1"]);
		expect(next.getSuccess()).toBe("passed");
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
		next.setCompletion("completed");
		next.setSuccess("passed");
		expect(globalThis.fetch).not.toHaveBeenCalled();

		const otherLearner = new XapiRuntime(
			createConfig({ actor: { name: "Other", mbox: "mailto:other@example.com" } }),
			"course-1",
			storage,
		);
		expect(otherLearner.getVisitedPages()).toEqual([]);
	});

	it("ignores stored state that is not the expected shape", () => {
		const storage = memoryStorage();
		new XapiRuntime(createConfig(), "course-1", storage).trackPageVisit("p1");
		const key = storage.key(0) as string;
		storage.setItem(
			key,
			JSON.stringify({
				visitedPages: ["p1", 5],
				interactions: [{ id: "q1", response: 1 }],
				completionStatus: "done",
				score: { raw: "high" },
			}),
		);
		const restored = new XapiRuntime(createConfig(), "course-1", storage);
		expect(restored.getVisitedPages()).toEqual(["p1"]);
		expect(restored.getInteractions()).toEqual([]);
		expect(restored.getCompletion()).toBe("incomplete");
		expect(restored.getScore()).toBeNull();
	});

	it("carries the LMS launch actor to later pages in the same tab", () => {
		const launchWindow = {
			location: {
				search: `?actor=${encodeURIComponent(JSON.stringify({ name: "Ada", mbox: "mailto:ada@example.com" }))}&activity_id=${encodeURIComponent("https://lms.example.com/course-1")}`,
			},
			sessionStorage: memoryStorage(),
			localStorage: memoryStorage(),
		};
		vi.stubGlobal("window", launchWindow);
		try {
			const lms = createConfig({ actor: undefined, actorMode: "lms" });
			new XapiRuntime(lms, "course-1").trackPageVisit("p1");
			launchWindow.location.search = "";
			const laterPage = new XapiRuntime(lms, "course-1");
			expect(laterPage.getVisitedPages()).toEqual(["p1"]);
			(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
			laterPage.initialize();
			expect(lastStatementSent()?.actor.mbox).toBe("mailto:ada@example.com");
			expect(lastStatementSent()?.object.id).toBe("https://lms.example.com/course-1");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("does not save state for an unidentified learner", () => {
		const storage = memoryStorage();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		new XapiRuntime(
			createConfig({ actor: undefined, actorMode: "lms" }),
			"course-1",
			storage,
		).trackPageVisit("p1");
		expect(storage.length).toBe(0);
	});

	it("starts with in-memory state when the storage getter throws", () => {
		vi.stubGlobal("window", {
			location: { search: "" },
			get localStorage(): Storage {
				throw new DOMException("blocked", "SecurityError");
			},
		});
		try {
			const blocked = new XapiRuntime(createConfig(), "course-1");
			blocked.trackPageVisit("p1");
			expect(blocked.getVisitedPages()).toEqual(["p1"]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("resends statements the LRS rejected when the next page starts", async () => {
		const storage = memoryStorage();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
		const first = new XapiRuntime(createConfig(), "course-1", storage);
		first.setCompletion("completed");
		await vi.waitFor(() => expect(storage.getItem(storage.key(0) as string)).toContain('"verb"'));

		const original = allStatementsSent()[0];
		expect(original).toHaveProperty("id", expect.any(String));
		const saved = JSON.parse(storage.getItem(storage.key(0) as string) as string);
		expect(saved.outbox[0]).toEqual(original);
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		new XapiRuntime(createConfig(), "course-1", storage).initialize();
		expect(allStatementsSent()[0]).toEqual(original);
		expect(allStatementsSent().map((statement) => statement.verb.display["en-US"])).toEqual([
			"completed",
			"initialized",
		]);
		await vi.waitFor(() =>
			expect(storage.getItem(storage.key(0) as string)).toContain('"outbox":[]'),
		);
	});

	it("retires an already-stored statement when its resend receives 409", async () => {
		const storage = memoryStorage();
		const key = "praxity-xapi:course-1:mailto%3Alearner%40example.com";
		const accepted = new Set<string>();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.fetch = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
			const statement = JSON.parse(init.body as string) as XapiStatement;
			if (accepted.has(statement.id)) return new Response(null, { status: 409 });
			accepted.add(statement.id);
			if (statement.verb.id.endsWith("/completed")) throw new Error("Response lost after store");
			return new Response(null, { status: 204 });
		});
		const first = new XapiRuntime(createConfig(), "course-1", storage);
		const original = first.buildStatement("completed", { id: "https://example.com/course" });
		await first.sendStatement(original);
		expect(JSON.parse(storage.getItem(key) as string).outbox).toEqual([original]);
		new XapiRuntime(createConfig(), "course-1", storage).initialize();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(JSON.parse(storage.getItem(key) as string).outbox).toEqual([]);
		new XapiRuntime(createConfig(), "course-1", storage).initialize();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(allStatementsSent().filter((statement) => statement.id === original.id)).toEqual([
			original,
			original,
		]);
		expect(JSON.parse(storage.getItem(key) as string).outbox).toEqual([]);
	});

	it.each([409, 503])("retains a failed statement without an id on HTTP %i", async (status) => {
		const storage = memoryStorage();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
		const legacy = {
			actor: { name: "Learner", mbox: "mailto:learner@example.com" },
			verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "completed" } },
			object: { id: "https://example.com/course" },
			timestamp: "2026-01-01T00:00:00.000Z",
		};
		await new XapiRuntime(createConfig(), "course-1", storage).sendStatement(
			legacy as XapiStatement,
		);
		expect(JSON.parse(storage.getItem(storage.key(0) as string) ?? "{}").outbox).toEqual([legacy]);
	});

	it("assigns and saves a legacy outbox UUID before sending and reuses it across reloads", async () => {
		const storage = memoryStorage();
		const key = "praxity-xapi:course-1:mailto%3Alearner%40example.com";
		const legacy = {
			actor: { name: "Learner", mbox: "mailto:learner@example.com" },
			verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { "en-US": "completed" } },
			object: { id: "https://example.com/course" },
			timestamp: "2026-01-01T00:00:00.000Z",
		};
		storage.setItem(key, JSON.stringify({ outbox: [legacy] }));
		const restored = new XapiRuntime(createConfig(), "course-1", storage);
		const [migrated] = JSON.parse(storage.getItem(key) as string).outbox;
		expect(migrated).toEqual(
			expect.objectContaining({
				id: expect.stringMatching(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
				),
			}),
		);
		expect(migrated).toEqual({ ...legacy, id: migrated.id });
		vi.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
		restored.initialize();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(allStatementsSent()[0]).toEqual(migrated);
		globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		new XapiRuntime(createConfig(), "course-1", storage).initialize();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(allStatementsSent()[0]).toEqual(migrated);
		expect(JSON.parse(storage.getItem(key) as string).outbox).toEqual([]);
	});

	it("normalizes corrupt restored attempt metadata before course decisions", () => {
		const storage = memoryStorage();
		const row = {
			id: "q1",
			response: "a",
			timestamp: 1,
			correct: false,
			score: 0,
			attemptsUsed: "2",
			maxAttempts: -1,
			memberIds: 5,
		};
		storage.setItem(
			"praxity-xapi:course-1:mailto%3Alearner%40example.com",
			JSON.stringify({ interactions: [row] }),
		);
		const restored = new XapiRuntime(createConfig(), "course-1", storage);
		expect(restored.getInteractions()).toEqual([
			{
				id: "q1",
				response: "a",
				timestamp: 1,
				correct: false,
				score: 0,
				attemptsUsed: undefined,
				maxAttempts: undefined,
				memberIds: undefined,
			},
		]);
		const tracker = new CourseTracker(restored, {
			totalPages: 1,
			completionMethod: "allPages",
			passMark: 80,
			scoredAssessmentIds: ["q1"],
		});
		tracker.trackPageVisit("p1");
		expect(restored.getSuccess()).toBe("failed");
	});

	it("keeps only the latest attempt and latest scored attempt per question", () => {
		const storage = memoryStorage();
		const saved = new XapiRuntime(createConfig(), "course-1", storage);
		saved.trackInteraction("q1", "a", false, 0);
		saved.trackInteraction("q1", "b", true, 100);
		saved.trackInteraction("q1", "c", true);
		saved.trackInteraction("q2", "d", true, 100);
		const restored = new XapiRuntime(createConfig(), "course-1", storage);
		expect(restored.getInteractions().map((item) => [item.id, item.response])).toEqual([
			["q1", "b"],
			["q1", "c"],
			["q2", "d"],
		]);
	});
});
