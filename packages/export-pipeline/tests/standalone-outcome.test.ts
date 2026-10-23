import { JSDOM } from "jsdom";
import { assert, describe, expect, it } from "vitest";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker } from "../src/scorm/tracking";
import { initializeCourseHost } from "../template/src/hosts/course-host";

function fixture(passMark: number | undefined, ids = ["question"]) {
	const dom = new JSDOM("", { url: "https://course.example/summary.html" });
	const runtime = new LocalStorageRuntime(dom.window.localStorage, "outcome", "default");
	const config = {
		totalPages: 1,
		completionMethod: "allPages" as const,
		passMark,
		reportOutcome: false,
		scoredAssessmentIds: ids,
		isAssessmentFinal: (id: string) => {
			const state = runtime.getBlockState(id);
			return (
				typeof state === "object" &&
				state !== null &&
				!Array.isArray(state) &&
				state.completed === true
			);
		},
	};
	const tracker = new CourseTracker(runtime, config);
	return { dom, runtime, tracker, config };
}

describe("standalone course outcome", () => {
	it("the standalone host derives outcomes without saving score or success", () => {
		const { dom, runtime } = fixture(80);
		dom.window.document.body.innerHTML = `<script id="praxity-host-config" type="application/json">${JSON.stringify(
			{
				version: 1,
				courseId: "outcome",
				pageId: "summary",
				pageTitle: "Summary",
				currentPage: 1,
				totalPages: 1,
				currentSlug: "summary",
				availableSlugs: ["summary"],
				pageIdMap: { summary: "summary" },
				completionMethod: "allPages",
				pageRole: "content",
				strings: {},
				passMark: 80,
				scoredAssessmentIds: ["question"],
			},
		)}</script><script id="praxity-deployment-config" type="application/json">{"format":"standalone"}</script>`;
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		initializeCourseHost(
			{ format: "standalone", createRuntime: () => runtime },
			{
				win: dom.window as unknown as Window,
				doc: dom.window.document,
				location: dom.window.location,
				history: dom.window.history,
			},
		);
		const host = dom.window as unknown as Window;
		runtime.setBlockState("question", { completed: false });
		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-response", {
				detail: {
					blockId: "question",
					responseText: "Yes",
					correct: false,
					score: 0,
					maxScore: 100,
					attemptsUsed: 1,
					maxAttempts: 2,
				},
			}),
		);
		expect(host.__praxityTracker?.getOutcome?.()).toBeUndefined();
		runtime.setBlockState("question", { completed: true });
		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-response", {
				detail: {
					blockId: "question",
					responseText: "Yes",
					correct: true,
					score: 80,
					maxScore: 100,
					attemptsUsed: 2,
					maxAttempts: 2,
				},
			}),
		);
		const key = dom.window.localStorage.key(0);
		assert(key);
		const saved = dom.window.localStorage.getItem(key);
		expect(host.__praxityTracker?.getOutcome?.()).toEqual({ score: 80, passed: true });
		expect(dom.window.localStorage.getItem(key)).toBe(saved);
		expect(runtime.getScore()).toBeNull();
		expect(runtime.getCompletion()).toBe("completed");
		expect(dom.window.localStorage.length).toBe(1);
		dom.window.close();
	});
	it.each([
		[0, false],
		[79, false],
		[80, true],
		[100, true],
	] as const)("80 pass mark with %i score has passed=%s", (score, passed) => {
		const { dom, runtime, tracker } = fixture(80);
		runtime.setBlockState("question", { completed: true });
		tracker.trackInteraction("question", "Answer", passed, score);
		expect(tracker.getOutcome()).toEqual({ score, passed });
		dom.window.close();
	});
	it("waits for a pending required question", () => {
		const { dom, runtime, tracker } = fixture(80, ["question", "pending"]);
		runtime.setBlockState("question", { completed: true });
		tracker.trackInteraction("question", "Answer", true, 100);
		expect(tracker.getOutcome()).toBeUndefined();
		dom.window.close();
	});
	it.each([0, 80])("waits for a retryable failure even at %i overall", (score) => {
		const { dom, runtime, tracker } = fixture(80);
		runtime.setBlockState("question", { completed: false });
		tracker.trackInteraction("question", "Answer", false, score, {
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		expect(tracker.getOutcome()).toBeUndefined();
		runtime.setBlockState("question", { completed: true });
		tracker.trackInteraction("question", "Final answer", false, 0, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(tracker.getOutcome()).toEqual({ score: 0, passed: false });
		dom.window.close();
	});
	it("has no outcome without an authored pass mark", () => {
		const { dom, runtime, tracker } = fixture(undefined);
		runtime.setBlockState("question", { completed: true });
		tracker.trackInteraction("question", "Answer", true, 100);
		expect(tracker.getOutcome()).toBeUndefined();
		dom.window.close();
	});
	it.each([
		[79, false],
		[80, true],
		[0, undefined],
	] as const)("restores %i outcome from the existing answers", (score, passed) => {
		const { dom, runtime, tracker, config } = fixture(80);
		runtime.setBlockState("question", { completed: passed !== undefined });
		tracker.trackInteraction("question", "Answer", passed === true, score);
		const restored = new LocalStorageRuntime(dom.window.localStorage, "outcome", "default");
		const reloaded = new CourseTracker(restored, {
			...config,
			isAssessmentFinal: (id) => {
				const state = restored.getBlockState(id);
				return (
					typeof state === "object" &&
					state !== null &&
					!Array.isArray(state) &&
					state.completed === true
				);
			},
		});
		expect(reloaded.getOutcome()).toEqual(passed === undefined ? undefined : { score, passed });
		dom.window.close();
	});
});
