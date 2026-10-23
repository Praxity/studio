import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackingConfig } from "../src/scorm/tracking";
import { CourseTracker } from "../src/scorm/tracking";
import { type InteractionRecord, LMS_DESTINATIONS, type SCORMRuntime } from "../src/scorm/types";

// ---------------------------------------------------------------------------
// Mock SCORMRuntime
// ---------------------------------------------------------------------------

interface MockRuntime extends SCORMRuntime {
	initialize: Mock<() => boolean>;
	terminate: Mock<() => boolean>;
	trackPageVisit: Mock<(pageId: string) => void>;
	getVisitedPages: Mock<() => string[]>;
	trackInteraction: Mock<(id: string, response: string, correct: boolean, score?: number) => void>;
	getInteractions: Mock<() => InteractionRecord[]>;
	setCompletion: Mock<(status: "incomplete" | "completed" | "passed" | "failed") => void>;
	getCompletion: Mock<() => string>;
	setScore: Mock<(raw: number, min: number, max: number) => void>;
	getScore: Mock<() => { raw: number; min: number; max: number } | null>;
	setBookmark: Mock<(pageId: string) => void>;
	getBookmark: Mock<() => string | null>;
	setSuspendData: Mock<(data: string) => void>;
	getSuspendData: Mock<() => string | null>;
	commit: Mock<() => boolean>;
}

function createMockRuntime(): MockRuntime {
	return {
		destinations: LMS_DESTINATIONS,
		initialize: vi.fn().mockReturnValue(true),
		terminate: vi.fn().mockReturnValue(true),
		trackPageVisit: vi.fn(),
		getVisitedPages: vi.fn().mockReturnValue([]),
		trackInteraction: vi.fn(),
		getInteractions: vi.fn().mockReturnValue([]),
		setCompletion: vi.fn(),
		getCompletion: vi.fn().mockReturnValue("incomplete"),
		setScore: vi.fn(),
		getScore: vi.fn().mockReturnValue(null),
		setBookmark: vi.fn(),
		getBookmark: vi.fn().mockReturnValue(null),
		setSuspendData: vi.fn(),
		getSuspendData: vi.fn().mockReturnValue(null),
		commit: vi.fn().mockReturnValue(true),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CourseTracker", () => {
	it("neutral self-check feedback does not change the course pass mark or page count", () => {
		const runtime = createMockRuntime();
		runtime.getInteractions.mockReturnValue([
			{ id: "graded", response: "Yes", correct: true, score: 80, timestamp: 1 },
			{ id: "self-check", response: "My answer", timestamp: 2 },
		]);
		const tracker = new CourseTracker(runtime, {
			totalPages: 2,
			completionMethod: "allPages",
			requiredAssessmentIds: ["graded"],
			scoredAssessmentIds: ["graded"],
			passMark: 80,
		});
		tracker.trackInteraction("self-check", "My answer");
		expect(runtime.setScore).not.toHaveBeenCalled();
		expect(tracker.calculateScore()).toBe(80);
		expect(runtime.trackPageVisit).not.toHaveBeenCalled();
		expect(runtime.getCompletion()).toBe("incomplete");
		runtime.getVisitedPages.mockReturnValue(["page-1", "page-2"]);
		tracker.trackPageVisit("page-2");
		expect(runtime.setScore).not.toHaveBeenCalled();
		expect(runtime.setCompletion).toHaveBeenLastCalledWith("passed");
	});
	it("self-check-only courses complete on pages without a scored or correct response", () => {
		const runtime = createMockRuntime();
		runtime.getVisitedPages.mockReturnValue(["page"]);
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			requiredAssessmentIds: [],
			scoredAssessmentIds: [],
			passMark: 80,
		});
		tracker.checkCompletion();
		expect(runtime.setCompletion).toHaveBeenLastCalledWith("completed");
		runtime.getInteractions.mockReturnValue([
			{ id: "self-check", response: "My answer", timestamp: 1 },
		]);
		tracker.trackInteraction("self-check", "My answer");
		expect(runtime.setCompletion).toHaveBeenLastCalledWith("completed");
		expect(runtime.setScore).not.toHaveBeenCalled();
	});
	let runtime: MockRuntime;

	beforeEach(() => {
		runtime = createMockRuntime();
	});

	// ---- trackPageVisit ---------------------------------------------------

	describe("trackPageVisit()", () => {
		it("records the visit and updates the resume bookmark", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			tracker.trackPageVisit("page-1");

			expect(runtime.trackPageVisit).toHaveBeenCalledWith("page-1");
			expect(runtime.setBookmark).toHaveBeenCalledWith("page-1");
		});
	});

	// ---- checkCompletion: allPages ----------------------------------------

	describe("checkCompletion() with allPages", () => {
		it("does not double-count a legacy slug and its durable page ID", () => {
			const tracker = new CourseTracker(runtime, {
				totalPages: 2,
				completionMethod: "allPages",
				pageAliases: { welcome: "page-stable-1" },
			});
			runtime.getVisitedPages.mockReturnValue(["welcome", "page-stable-1"]);

			tracker.checkCompletion();

			expect(runtime.setCompletion).not.toHaveBeenCalled();
		});

		it("sets 'completed' when all pages have been visited", () => {
			const config: TrackingConfig = {
				totalPages: 3,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			// Simulate 3 visited pages
			runtime.getVisitedPages.mockReturnValue(["page-1", "page-2", "page-3"]);

			tracker.trackPageVisit("page-3");

			expect(runtime.setCompletion).toHaveBeenCalledWith("completed");
		});

		it("does not set 'completed' when not all pages have been visited", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			runtime.getVisitedPages.mockReturnValue(["page-1", "page-2"]);

			tracker.trackPageVisit("page-2");

			expect(runtime.setCompletion).not.toHaveBeenCalled();
		});
	});

	// ---- checkCompletion: percentage --------------------------------------

	describe("checkCompletion() with percentage", () => {
		it("sets 'completed' when visited percentage meets the threshold", () => {
			const config: TrackingConfig = {
				totalPages: 10,
				completionMethod: "percentage",
				completionThreshold: 80,
			};
			const tracker = new CourseTracker(runtime, config);

			// 8 of 10 = 80%
			runtime.getVisitedPages.mockReturnValue(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);

			tracker.trackPageVisit("p8");

			expect(runtime.setCompletion).toHaveBeenCalledWith("completed");
		});

		it("does not set 'completed' when below threshold", () => {
			const config: TrackingConfig = {
				totalPages: 10,
				completionMethod: "percentage",
				completionThreshold: 80,
			};
			const tracker = new CourseTracker(runtime, config);

			// 7 of 10 = 70%, below 80%
			runtime.getVisitedPages.mockReturnValue(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);

			tracker.trackPageVisit("p7");

			expect(runtime.setCompletion).not.toHaveBeenCalled();
		});
	});

	describe("required knowledge checks", () => {
		it("requires every named check and the page threshold, using latest attempts", () => {
			const tracker = new CourseTracker(runtime, {
				totalPages: 2,
				completionMethod: "percentage",
				completionThreshold: 100,
				requiredAssessmentIds: ["q1", "group1"],
			});
			const history: InteractionRecord[] = [];
			runtime.getInteractions.mockImplementation(() => history);
			runtime.getVisitedPages.mockReturnValue(["p1", "p2"]);
			tracker.checkCompletion();
			expect(runtime.setCompletion).toHaveBeenLastCalledWith("incomplete");
			history.push(
				{ id: "q1", response: "wrong", score: 0, correct: false, timestamp: 1 },
				{ id: "group1", response: "passed", score: 80, correct: true, timestamp: 2 },
			);
			tracker.checkCompletion();
			expect(runtime.setCompletion).toHaveBeenLastCalledWith("incomplete");
			history.push({
				id: "q1",
				response: "correct retry",
				score: 100,
				correct: true,
				timestamp: 3,
			});
			runtime.getVisitedPages.mockReturnValue(["p1"]);
			runtime.setCompletion.mockClear();
			tracker.checkCompletion();
			expect(runtime.setCompletion).not.toHaveBeenCalled();
			runtime.getVisitedPages.mockReturnValue(["p1", "p2"]);
			tracker.checkCompletion();
			expect(runtime.setCompletion).toHaveBeenLastCalledWith("completed");
			// Optional surveys need no interaction; returning learners use the saved history.
			new CourseTracker(runtime, {
				totalPages: 2,
				completionMethod: "allPages",
				requiredAssessmentIds: ["q1", "group1"],
			}).checkCompletion();
			expect(runtime.setCompletion).toHaveBeenLastCalledWith("completed");
			history.push({
				id: "q1",
				response: "later incorrect retry",
				score: 0,
				correct: false,
				timestamp: 4,
			});
			tracker.checkCompletion();
			expect(runtime.setCompletion).toHaveBeenLastCalledWith("incomplete");
		});
	});

	// ---- checkCompletion: quiz --------------------------------------------

	describe("checkCompletion() with quiz", () => {
		it("sets 'passed' when calculated score >= passMark", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "quiz",
				passMark: 70,
			};
			const tracker = new CourseTracker(runtime, config);

			// Interactions with average score = 80
			const interactions: InteractionRecord[] = [
				{ id: "q1", response: "A", correct: true, score: 80, timestamp: 1 },
				{ id: "q2", response: "B", correct: true, score: 80, timestamp: 2 },
			];
			runtime.getInteractions.mockReturnValue(interactions);

			tracker.trackInteraction("q2", "B", true, 80);

			expect(runtime.setCompletion).toHaveBeenCalledWith("passed");
		});

		it("sets 'failed' when score < passMark and interactions exist", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "quiz",
				passMark: 70,
			};
			const tracker = new CourseTracker(runtime, config);

			// Interactions with average score = 40
			const interactions: InteractionRecord[] = [
				{ id: "q1", response: "A", correct: false, score: 30, timestamp: 1 },
				{ id: "q2", response: "C", correct: false, score: 50, timestamp: 2 },
			];
			runtime.getInteractions.mockReturnValue(interactions);

			tracker.trackInteraction("q2", "C", false, 50);

			expect(runtime.setCompletion).toHaveBeenCalledWith("failed");
		});
	});

	// ---- calculateScore ---------------------------------------------------

	describe("calculateScore()", () => {
		it("uses the latest scored attempt per question after resume without changing history", () => {
			const history: InteractionRecord[] = [
				{ id: "q1", response: "wrong", correct: false, score: 0, timestamp: 1 },
				{ id: "q2", response: "right", correct: true, score: 100, timestamp: 2 },
				{ id: "q1", response: "right", correct: true, score: 100, timestamp: 3 },
				{ id: "q2", response: "partial", correct: false, score: 40, timestamp: 4 },
				{ id: "q1", response: "reflection", timestamp: 5 },
				{ id: "unscored", response: "reflection", timestamp: 6 },
			];
			const restored: InteractionRecord[] = JSON.parse(JSON.stringify(history));
			runtime.getInteractions.mockReturnValue(restored);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "allPages",
			});

			expect(tracker.calculateScore()).toBe(70);
			expect(restored).toEqual(history);
		});

		it("returns the average of all interaction scores", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			const interactions: InteractionRecord[] = [
				{ id: "q1", response: "A", correct: true, score: 100, timestamp: 1 },
				{ id: "q2", response: "B", correct: false, score: 0, timestamp: 2 },
				{ id: "q3", response: "C", correct: true, score: 50, timestamp: 3 },
			];
			runtime.getInteractions.mockReturnValue(interactions);

			// (100 + 0 + 50) / 3 = 50
			expect(tracker.calculateScore()).toBe(50);
		});

		it("returns 0 when there are no interactions", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			runtime.getInteractions.mockReturnValue([]);

			expect(tracker.calculateScore()).toBe(0);
		});

		it("only averages interactions that have a score", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			const interactions: InteractionRecord[] = [
				{ id: "q1", response: "A", correct: true, score: 100, timestamp: 1 },
				{ id: "q2", response: "B", correct: true, timestamp: 2 }, // no score
				{ id: "q3", response: "C", correct: false, score: 60, timestamp: 3 },
			];
			runtime.getInteractions.mockReturnValue(interactions);

			// (100 + 60) / 2 = 80
			expect(tracker.calculateScore()).toBe(80);
		});
	});

	// ---- trackInteraction -------------------------------------------------

	describe("trackInteraction()", () => {
		it("replaces an incorrect answer's score on retry while retaining both attempts", () => {
			const history: InteractionRecord[] = [];
			runtime.getInteractions.mockReturnValue(history);
			runtime.trackInteraction.mockImplementation((id, response, correct, score) => {
				history.push({ id, response, correct, score, timestamp: history.length });
			});
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "quiz",
			});

			tracker.trackInteraction("q1", "wrong", false, 0);
			expect(runtime.setScore).toHaveBeenLastCalledWith(0, 0, 100);
			tracker.trackInteraction("q1", "right", true, 100);

			expect(runtime.setScore).toHaveBeenLastCalledWith(100, 0, 100);
			expect(runtime.setCompletion).toHaveBeenLastCalledWith("passed");
			expect(history.map(({ score }) => score)).toEqual([0, 100]);
		});

		it("delegates to runtime.trackInteraction()", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			tracker.trackInteraction("q1", "A", true, 100);

			expect(runtime.trackInteraction).toHaveBeenCalledWith("q1", "A", true, 100, undefined);
		});

		it("reports no score for a completion-only course without a pass mark", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "allPages",
			};
			const tracker = new CourseTracker(runtime, config);

			const interactions: InteractionRecord[] = [
				{ id: "q1", response: "A", correct: true, score: 80, timestamp: 1 },
			];
			runtime.getInteractions.mockReturnValue(interactions);

			tracker.trackInteraction("q1", "A", true, 80);

			expect(runtime.setScore).not.toHaveBeenCalled();
		});

		it("recalculates score and calls checkCompletion", () => {
			const config: TrackingConfig = {
				totalPages: 5,
				completionMethod: "quiz",
				passMark: 70,
			};
			const tracker = new CourseTracker(runtime, config);

			const interactions: InteractionRecord[] = [
				{ id: "q1", response: "A", correct: true, score: 90, timestamp: 1 },
			];
			runtime.getInteractions.mockReturnValue(interactions);

			tracker.trackInteraction("q1", "A", true, 90);

			// Score should be set
			expect(runtime.setScore).toHaveBeenCalledWith(90, 0, 100);
			// Completion should be evaluated (90 >= 70 => passed)
			expect(runtime.setCompletion).toHaveBeenCalledWith("passed");
		});
	});
});

// ---- course pass mark ------------------------------------------------------

/** In-memory runtime; `separateSuccess` models SCORM 2004 and xAPI. */
function memoryRuntime(separateSuccess: boolean) {
	const state = {
		visited: [] as string[],
		interactions: [] as InteractionRecord[],
		completion: "incomplete",
		success: "unknown",
		score: null as number | null,
	};
	const runtime: SCORMRuntime = {
		destinations: LMS_DESTINATIONS,
		initialize: () => true,
		terminate: () => true,
		trackPageVisit: (id) => {
			if (!state.visited.includes(id)) state.visited.push(id);
		},
		getVisitedPages: () => [...state.visited],
		trackInteraction: (id, response, correct, score, options) => {
			state.interactions.push({ id, response, correct, score, ...options, timestamp: Date.now() });
		},
		getInteractions: () => [...state.interactions],
		setCompletion: (status) => {
			state.completion = status;
		},
		getCompletion: () => state.completion,
		setScore: (raw) => {
			state.score = raw;
		},
		getScore: () => (state.score === null ? null : { raw: state.score, min: 0, max: 100 }),
		setBookmark: () => {},
		getBookmark: () => null,
		setSuspendData: () => {},
		getSuspendData: () => null,
		commit: () => true,
		...(separateSuccess
			? {
					setSuccess: (status: string) => {
						state.success = status;
					},
					getSuccess: () => state.success,
				}
			: {}),
	};
	return { runtime, state };
}

describe("course pass mark", () => {
	const config: TrackingConfig = {
		totalPages: 2,
		completionMethod: "percentage",
		completionThreshold: 100,
		passMark: 50,
		scoredAssessmentIds: ["q1", "q2"],
	};

	it("keeps the result and score open until every scored question is answered", () => {
		const { runtime, state } = memoryRuntime(true);
		const tracker = new CourseTracker(runtime, config);
		tracker.trackPageVisit("p1");
		tracker.trackInteraction("q1", "a", false, 0);
		expect(state.success).toBe("unknown");
		expect(state.score).toBeNull();
		tracker.trackInteraction("q2", "b", false, 0);
		expect(state.success).toBe("failed");
		expect(state.score).toBe(0);
		expect(state.completion).toBe("incomplete");
	});

	it("reports completion from pages and success from the score separately", () => {
		const { runtime, state } = memoryRuntime(true);
		const tracker = new CourseTracker(runtime, config);
		tracker.trackPageVisit("p1");
		tracker.trackPageVisit("p2");
		expect(state.completion).toBe("completed");
		expect(state.success).toBe("unknown");
		tracker.trackInteraction("q1", "a", true, 100);
		tracker.trackInteraction("q2", "b", false, 0);
		expect(state.success).toBe("passed");
		expect(state.score).toBe(50);
	});

	it("uses the latest attempt, so a correct retry passes a failed course", () => {
		const { runtime, state } = memoryRuntime(true);
		const tracker = new CourseTracker(runtime, config);
		tracker.trackInteraction("q1", "a", false, 0);
		tracker.trackInteraction("q2", "b", false, 0);
		expect(state.success).toBe("failed");
		tracker.trackInteraction("q2", "c", true, 100);
		expect(state.success).toBe("passed");
	});

	it("counts an assessment group once by its group result", () => {
		const { runtime, state } = memoryRuntime(true);
		const tracker = new CourseTracker(runtime, { ...config, scoredAssessmentIds: ["group"] });
		tracker.trackInteraction("member-1", "a", true, 100);
		expect(state.success).toBe("unknown");
		tracker.trackInteraction("group", "40%", false, 40);
		expect(state.success).toBe("failed");
		expect(state.score).toBe(40);
	});

	it("never reports SCORM 1.2 completed before a result, and passes only with the page rule met", () => {
		const { runtime, state } = memoryRuntime(false);
		const tracker = new CourseTracker(runtime, config);
		tracker.trackPageVisit("p1");
		tracker.trackPageVisit("p2");
		expect(state.completion).toBe("incomplete");
		tracker.trackInteraction("q1", "a", true, 100);
		tracker.trackInteraction("q2", "b", true, 100);
		expect(state.completion).toBe("passed");

		const early = memoryRuntime(false);
		const partial = new CourseTracker(early.runtime, config);
		partial.trackPageVisit("p1");
		partial.trackInteraction("q1", "a", true, 100);
		partial.trackInteraction("q2", "b", true, 100);
		expect(early.state.completion).toBe("incomplete");
		partial.trackPageVisit("p2");
		expect(early.state.completion).toBe("passed");

		const failing = memoryRuntime(false);
		const failed = new CourseTracker(failing.runtime, config);
		failed.trackInteraction("q1", "a", false, 0);
		failed.trackInteraction("q2", "b", false, 0);
		expect(failing.state.completion).toBe("failed");
	});

	it("reports success before completion so a completion report carries the result", () => {
		const { runtime } = memoryRuntime(true);
		const calls: string[] = [];
		const setSuccess = runtime.setSuccess?.bind(runtime);
		const setCompletion = runtime.setCompletion.bind(runtime);
		runtime.setSuccess = (status) => {
			calls.push(`success:${status}`);
			setSuccess?.(status);
		};
		runtime.setCompletion = (status) => {
			calls.push(`completion:${status}`);
			setCompletion(status);
		};
		const tracker = new CourseTracker(runtime, { ...config, totalPages: 1 });
		tracker.trackInteraction("q1", "a", true, 100);
		tracker.trackInteraction("q2", "b", true, 100);
		tracker.trackPageVisit("p1");
		expect(calls.indexOf("success:passed")).toBeLessThan(calls.indexOf("completion:completed"));
		expect(calls.filter((call) => call === "completion:completed")).toHaveLength(1);
	});

	it("compares the score with the pass mark as the manifest rounds it", () => {
		const { runtime, state } = memoryRuntime(true);
		const tracker = new CourseTracker(runtime, {
			...config,
			passMark: 66.6665,
			scoredAssessmentIds: ["q1", "q2", "q3"],
		});
		tracker.trackInteraction("q1", "a", true, 100);
		tracker.trackInteraction("q2", "b", true, 100);
		tracker.trackInteraction("q3", "c", false, 0);
		// 66.666...% is below the 66.67% the manifest declares.
		expect(state.success).toBe("failed");
	});

	it("leaves courses without a pass mark on the page rule", () => {
		const { runtime, state } = memoryRuntime(true);
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "percentage",
			completionThreshold: 100,
		});
		tracker.trackInteraction("q1", "a", false, 0);
		tracker.trackPageVisit("p1");
		expect(state.completion).toBe("completed");
		expect(state.success).toBe("unknown");
		expect(state.score).toBeNull();
	});
});

describe("SCORM 1.2 retryable course failure", () => {
	const config = {
		totalPages: 1,
		completionMethod: "allPages" as const,
		passMark: 80,
		scoredAssessmentIds: ["question"],
		deferRetryableFailure: true,
	};

	it("keeps a partial failed score incomplete until attempts are exhausted", () => {
		const { runtime, state } = memoryRuntime(false);
		const tracker = new CourseTracker(runtime, config);
		tracker.trackPageVisit("page");
		tracker.trackInteraction("question", "partial", false, 40, { attemptsUsed: 1, maxAttempts: 2 });
		expect(state.score).toBe(40);
		expect(state.completion).toBe("incomplete");
		tracker.trackInteraction("question", "partial retry", false, 60, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(state.score).toBe(60);
		expect(state.completion).toBe("failed");
	});

	it("keeps unlimited failures incomplete and passes a retry only after the page rule", () => {
		const { runtime, state } = memoryRuntime(false);
		const tracker = new CourseTracker(runtime, config);
		tracker.trackInteraction("question", "wrong", false, 0, { attemptsUsed: 8, maxAttempts: 0 });
		expect(state.completion).toBe("incomplete");
		expect(state.score).toBe(0);
		tracker.trackInteraction("question", "right", true, 100, { attemptsUsed: 9, maxAttempts: 0 });
		expect(state.completion).toBe("incomplete");
		tracker.trackPageVisit("page");
		expect(state.completion).toBe("passed");
	});

	it("keeps a mixed-limit aggregate open even when the group already passes its own threshold", () => {
		const { runtime, state } = memoryRuntime(false);
		const tracker = new CourseTracker(runtime, { ...config, scoredAssessmentIds: ["group"] });
		tracker.trackPageVisit("page");
		tracker.trackInteraction("fixed", "right", true, 100, { attemptsUsed: 1, maxAttempts: 1 });
		tracker.trackInteraction("retry", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 2 });
		tracker.trackInteraction("group", "50%", true, 50, { memberIds: ["fixed", "retry"] });
		expect(state.score).toBe(50);
		expect(state.completion).toBe("incomplete");
		tracker.trackInteraction("retry", "wrong again", false, 0, { attemptsUsed: 2, maxAttempts: 2 });
		tracker.trackInteraction("group", "50%", true, 50, { memberIds: ["fixed", "retry"] });
		expect(state.completion).toBe("failed");
	});

	it("uses only selected group members, with successful members no longer retryable", () => {
		const { runtime, state } = memoryRuntime(false);
		const tracker = new CourseTracker(runtime, {
			...config,
			scoredAssessmentIds: ["group", "fixed"],
		});
		tracker.trackInteraction("unselected", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 0 });
		tracker.trackInteraction("selected", "right", true, 100, { attemptsUsed: 1, maxAttempts: 0 });
		tracker.trackInteraction("group", "100%", true, 100, { memberIds: ["selected"] });
		tracker.trackInteraction("fixed", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 1 });
		expect(state.score).toBe(50);
		expect(state.completion).toBe("failed");
	});

	it("keeps a stale aggregate pending through its member's last successful retry", () => {
		const { runtime, state } = memoryRuntime(false);
		const tracker = new CourseTracker(runtime, { ...config, scoredAssessmentIds: ["group"] });
		tracker.trackPageVisit("page");
		tracker.trackInteraction("member", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 2 });
		tracker.trackInteraction("group", "0%", false, 0, { memberIds: ["member"] });
		expect(state.completion).toBe("incomplete");
		tracker.trackInteraction("member", "right", true, 100, { attemptsUsed: 2, maxAttempts: 2 });
		expect(state.completion).toBe("incomplete");
		expect(state.score).toBe(0);
		tracker.trackInteraction("group", "100%", true, 100, { memberIds: ["member"] });
		expect(state.completion).toBe("passed");
		expect(state.score).toBe(100);
	});

	it("treats legacy missing metadata as a final one-attempt result", () => {
		const { runtime, state } = memoryRuntime(false);
		new CourseTracker(runtime, config).trackInteraction("question", "wrong", false, 0);
		expect(state.completion).toBe("failed");
	});

	it("leaves SCORM 2004 and xAPI failure reporting unchanged", () => {
		const { runtime, state } = memoryRuntime(true);
		new CourseTracker(runtime, config).trackInteraction("question", "wrong", false, 0, {
			attemptsUsed: 1,
			maxAttempts: 0,
		});
		expect(state.success).toBe("failed");
	});

	it("keeps legacy quiz knowledge checks with unlimited attempts incomplete", () => {
		const { runtime, state } = memoryRuntime(false);
		new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			deferRetryableFailure: true,
		}).trackInteraction("knowledge-check", "wrong", false, undefined, {
			attemptsUsed: 1,
			maxAttempts: 0,
		});
		expect(state.completion).toBe("incomplete");
	});

	it.each([
		{ defer: true, correct: true, score: 100, final: "passed" },
		{ defer: true, correct: false, score: 40, final: "failed" },
		{ defer: false, correct: true, score: 100, final: "passed" },
		{ defer: false, correct: false, score: 40, final: "failed" },
	])(
		"keeps legacy quiz aggregate pending with defer=$defer and final=$final",
		({ defer, correct, score, final }) => {
			const { runtime, state } = memoryRuntime(false);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "quiz",
				deferRetryableFailure: defer,
			});
			tracker.trackInteraction("member", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 2 });
			tracker.trackInteraction("group", "0%", false, 0, { memberIds: ["member"] });
			tracker.trackInteraction("member", "last retry", correct, score, {
				attemptsUsed: 2,
				maxAttempts: 2,
			});
			expect(tracker.calculateScore()).toBe(score / 2);
			expect(state.score).toBe(score / 2);
			expect(state.completion).toBe(defer ? "incomplete" : "failed");
			tracker.trackInteraction("group", `${score}%`, correct, score, { memberIds: ["member"] });
			expect(tracker.calculateScore()).toBe(score);
			expect(state.completion).toBe(final);
		},
	);
});
