import { describe, expect, it, vi } from "vitest";
import { LearnerTracker } from "./learner-tracker";

function createMockRuntime(suspendData?: string, scormValues?: Record<string, string>) {
	let data = suspendData ?? null;
	return {
		getSuspendData: () => data,
		setSuspendData: (d: string) => {
			data = d;
		},
		commit: vi.fn(),
		getValue: scormValues ? (key: string) => scormValues[key] ?? null : undefined,
	};
}

describe("LearnerTracker", () => {
	it("tracks page visit count", () => {
		const runtime = createMockRuntime();
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		tracker.recordPageVisit();
		expect(tracker.getMetric("visitCount", "page")).toBe(1);
		tracker.recordPageVisit();
		expect(tracker.getMetric("visitCount", "page")).toBe(2);
	});

	it("returns page timeOn in seconds", () => {
		const runtime = createMockRuntime();
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		// timeOn should be >= 0 (just created)
		const time = tracker.getMetric("timeOn", "page");
		expect(time).toBeDefined();
		expect(time).toBeGreaterThanOrEqual(0);
	});

	it("persists and restores page visit count", () => {
		const runtime = createMockRuntime();
		const tracker1 = new LearnerTracker({ pageId: "p1", runtime });
		tracker1.recordPageVisit();
		tracker1.recordPageVisit();

		// Create a new tracker with same runtime (simulating page revisit)
		const tracker2 = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker2.getMetric("visitCount", "page")).toBe(2);
	});

	it("returns course grade from SCORM", () => {
		const runtime = createMockRuntime(undefined, {
			"cmi.core.score.raw": "85",
		});
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker.getMetric("grade", "course")).toBe(85);
	});

	it("returns course progress from SCORM lesson_status", () => {
		const runtime = createMockRuntime(undefined, {
			"cmi.core.lesson_status": "completed",
		});
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker.getMetric("progress", "course")).toBe(100);
	});

	it("returns 0 for incomplete course progress", () => {
		const runtime = createMockRuntime(undefined, {
			"cmi.core.lesson_status": "incomplete",
		});
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker.getMetric("progress", "course")).toBe(0);
	});

	it("returns undefined for lesson-level metrics", () => {
		const runtime = createMockRuntime();
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker.getMetric("visitCount", "lesson")).toBeUndefined();
		expect(tracker.getMetric("progress", "lesson")).toBeUndefined();
	});

	it("returns undefined for course metrics without getValue", () => {
		const runtime = createMockRuntime();
		// runtime.getValue is undefined (non-SCORM)
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker.getMetric("grade", "course")).toBeUndefined();
	});

	it("returns course visitCount as sum of all page visits", () => {
		const runtime = createMockRuntime();
		// Simulate visits across two pages
		const t1 = new LearnerTracker({ pageId: "p1", runtime });
		t1.recordPageVisit();
		t1.recordPageVisit();
		const t2 = new LearnerTracker({ pageId: "p2", runtime });
		t2.recordPageVisit();
		// course:visitCount should sum all persisted pages
		expect(t2.getMetric("visitCount", "course")).toBe(3);
	});

	it("parses SCORM time format", () => {
		const runtime = createMockRuntime(undefined, {
			"cmi.core.session_time": "01:30:45",
		});
		const tracker = new LearnerTracker({ pageId: "p1", runtime });
		expect(tracker.getMetric("timeOn", "course")).toBe(5445); // 1*3600 + 30*60 + 45
	});
});
