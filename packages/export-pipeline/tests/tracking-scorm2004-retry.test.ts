import { describe, expect, it } from "vitest";
import { type SCORM2004API, Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";

const passingRequired: TrackingConfig = {
	totalPages: 1,
	completionMethod: "allPages",
	passMark: 80,
	scoredAssessmentIds: ["question"],
	deferRetryableFailure: true,
};

function launch(config: TrackingConfig = passingRequired, restored?: unknown) {
	const values: Record<string, string> = {
		"cmi.completion_status": "incomplete",
		...(restored ? { "cmi.suspend_data": JSON.stringify(restored) } : {}),
	};
	const writes: [string, string][] = [];
	const api: SCORM2004API = {
		Initialize: () => "true",
		Terminate: () => "true",
		GetValue: (key) => values[key] ?? "",
		SetValue: (key, value) => {
			values[key] = value;
			writes.push([key, value]);
			return "true";
		},
		Commit: () => "true",
		GetLastError: () => "0",
		GetErrorString: () => "",
		GetDiagnostic: () => "",
	};
	const win: WindowLike = { API_1484_11: api, parent: null as unknown as WindowLike };
	win.parent = win;
	const runtime = new Scorm2004Runtime(win);
	expect(runtime.initialize()).toBe(true);
	return { values, writes, runtime, win, tracker: new CourseTracker(runtime, config) };
}

describe("SCORM 2004 passing-required retry", () => {
	it("keeps categorize answer keys, scores and retries through SCORM resume", () => {
		const config = { ...passingRequired, scoredAssessmentIds: ["categorize"] };
		const first = launch(config);
		const wrong = JSON.stringify({
			'["Listen carefully",0]': "unhelpful",
			'["Interrupt",0]': "unhelpful",
		});
		first.tracker.trackPageVisit("page");
		first.tracker.trackInteraction("categorize", wrong, false, 0, {
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		expect(first.runtime.commit()).toBe(true);
		expect(first.values["cmi.success_status"]).toBe("failed");
		expect(first.values["cmi.completion_status"]).toBe("incomplete");
		const resumed = launch(config, JSON.parse(first.values["cmi.suspend_data"]));
		expect(resumed.runtime.getInteractions()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "categorize", response: wrong, correct: false, score: 0 }),
			]),
		);
		const right = JSON.stringify({
			'["Listen carefully",0]': "helpful",
			'["Interrupt",0]': "unhelpful",
		});
		resumed.tracker.trackInteraction("categorize", right, true, 100, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(resumed.runtime.commit()).toBe(true);
		expect(resumed.values).toMatchObject({
			"cmi.score.raw": "100",
			"cmi.success_status": "passed",
			"cmi.completion_status": "completed",
		});
		expect(resumed.runtime.getInteractions().at(-1)?.response).toBe(right);
	});

	it.each([2, 0])(
		"keeps failed success and score incomplete with maxAttempts=%s",
		(maxAttempts) => {
			const { tracker, runtime, values, writes } = launch();
			tracker.trackPageVisit("page");
			tracker.trackInteraction("question", "partial", false, 40, { attemptsUsed: 1, maxAttempts });
			expect(runtime.getCompletion()).toBe("incomplete");
			expect(runtime.commit()).toBe(true);
			expect(values).toMatchObject({
				"cmi.completion_status": "incomplete",
				"cmi.success_status": "failed",
				"cmi.score.raw": "40",
				"cmi.score.scaled": "0.4",
				"cmi.exit": "suspend",
			});
			const keys = writes.map(([key]) => key);
			const completion = keys.lastIndexOf("cmi.completion_status");
			expect(keys.lastIndexOf("cmi.score.scaled")).toBeLessThan(completion);
			expect(keys.lastIndexOf("cmi.success_status")).toBeLessThan(completion);
		},
	);

	it("completes final failure and passes a successful retry with the existing page rule", () => {
		const { tracker, runtime, values } = launch({ ...passingRequired, totalPages: 2 });
		tracker.trackPageVisit("one");
		tracker.trackInteraction("question", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 2 });
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		tracker.trackInteraction("question", "final wrong", false, 20, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		tracker.trackPageVisit("two");
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("failed");
		expect(values["cmi.exit"]).toBe("suspend");

		const passing = launch({ ...passingRequired, totalPages: 2 });
		passing.tracker.trackPageVisit("one");
		passing.tracker.trackInteraction("question", "wrong", false, 0, {
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		passing.tracker.trackInteraction("question", "right", true, 100, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(passing.runtime.commit()).toBe(true);
		expect(passing.values["cmi.completion_status"]).toBe("incomplete");
		expect(passing.values["cmi.success_status"]).toBe("passed");
		passing.tracker.trackPageVisit("two");
		expect(passing.runtime.commit()).toBe(true);
		expect(passing.values["cmi.completion_status"]).toBe("completed");
		expect(passing.values["cmi.exit"]).toBe("normal");
	});

	it("keeps required-assessment gates on exhausted and passing results", () => {
		const { tracker, runtime, values } = launch({
			...passingRequired,
			requiredAssessmentIds: ["required"],
		});
		tracker.trackPageVisit("page");
		tracker.trackInteraction("question", "final wrong", false, 0, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		tracker.trackInteraction("question", "right", true, 100);
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		tracker.trackInteraction("required", "right", true, 100);
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
	});

	it("keeps pages-only completion with failed success seeded through the runtime interface", () => {
		const { tracker, runtime, values } = launch({
			totalPages: 1,
			completionMethod: "allPages",
			deferRetryableFailure: true,
		});
		tracker.trackPageVisit("page");
		tracker.trackInteraction("question", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 0 });
		runtime.setSuccess("failed");
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("failed");
		expect(values["cmi.exit"]).toBe("suspend");
	});

	it("keeps unknown success suspended and ungraded completion normal", () => {
		const unknown = launch();
		unknown.tracker.trackPageVisit("page");
		expect(unknown.runtime.commit()).toBe(true);
		expect(unknown.values["cmi.completion_status"]).toBe("completed");
		expect(unknown.values["cmi.success_status"]).toBe("unknown");
		expect(unknown.values["cmi.exit"]).toBe("suspend");
		const ungraded = launch({ totalPages: 1, completionMethod: "allPages" });
		ungraded.tracker.trackPageVisit("page");
		expect(ungraded.runtime.commit()).toBe(true);
		expect(ungraded.values["cmi.exit"]).toBe("normal");
	});

	it("reports legacy quiz failure separately while authored retries remain", () => {
		const { tracker, runtime, values } = launch({
			totalPages: 1,
			completionMethod: "quiz",
			deferRetryableFailure: true,
		});
		tracker.trackInteraction("question", "wrong", false, 20, { attemptsUsed: 1, maxAttempts: 2 });
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		expect(values["cmi.success_status"]).toBe("failed");
		expect(values["cmi.exit"]).toBe("suspend");
		tracker.trackInteraction("question", "final wrong", false, 40, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("failed");
	});

	it("reports legacy unscored quiz failure separately and passes a correct retry", () => {
		const { tracker, runtime, values } = launch({
			totalPages: 1,
			completionMethod: "quiz",
			deferRetryableFailure: true,
		});
		tracker.trackInteraction("question", "wrong", false, undefined, {
			attemptsUsed: 1,
			maxAttempts: 0,
		});
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		expect(values["cmi.success_status"]).toBe("failed");
		tracker.trackInteraction("question", "right", true, 100, { attemptsUsed: 2, maxAttempts: 0 });
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("passed");
		expect(values["cmi.exit"]).toBe("normal");
	});

	it("restores a retryable aggregate and waits for its member's final result", () => {
		const { tracker, runtime, values } = launch(
			{ ...passingRequired, scoredAssessmentIds: ["group"] },
			{
				visitedPages: ["page"],
				interactions: [
					{ id: "fixed", correct: true, score: 100, attemptsUsed: 1, maxAttempts: 1 },
					{ id: "retry", correct: false, score: 0, attemptsUsed: 1, maxAttempts: 2 },
					{ id: "group", correct: true, score: 50, memberIds: ["fixed", "retry"] },
				],
			},
		);
		tracker.checkCompletion();
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		tracker.trackInteraction("retry", "right", true, 100, { attemptsUsed: 2, maxAttempts: 2 });
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		expect(values["cmi.success_status"]).toBe("unknown");
		tracker.trackInteraction("group", "100%", true, 100, { memberIds: ["fixed", "retry"] });
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("passed");
	});

	it("rejects malformed restored retry counts instead of extending an exhausted result", () => {
		const { tracker, runtime, values } = launch(passingRequired, {
			visitedPages: ["page"],
			interactions: [
				{ id: "question", correct: false, score: 40, attemptsUsed: -1, maxAttempts: 2 },
			],
		});
		tracker.checkCompletion();
		expect(runtime.commit()).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("failed");
	});

	it("preserves failed incomplete on explicit Finish through a retained utility adapter", () => {
		const { tracker, runtime, win, values } = launch();
		const utility = new Scorm2004Runtime(win);
		expect(utility.initialize()).toBe(true);
		tracker.trackPageVisit("page");
		tracker.trackInteraction("question", "wrong", false, 0, { attemptsUsed: 1, maxAttempts: 0 });
		expect(utility.terminate(true)).toBe(true);
		expect(values["cmi.completion_status"]).toBe("incomplete");
		expect(values["cmi.success_status"]).toBe("failed");
		expect(values["cmi.exit"]).toBe("suspend");
		expect(runtime.commit()).toBe(false);
	});

	it("retains explicit Finish completion for final failure before the page threshold", () => {
		const { tracker, runtime, win, values } = launch({ ...passingRequired, totalPages: 2 });
		tracker.trackPageVisit("one");
		tracker.trackInteraction("question", "final wrong", false, 20, {
			attemptsUsed: 2,
			maxAttempts: 2,
		});
		expect(runtime.getCompletion()).toBe("incomplete");
		const utility = new Scorm2004Runtime(win);
		expect(utility.initialize()).toBe(true);
		expect(utility.terminate(true)).toBe(true);
		expect(values["cmi.completion_status"]).toBe("completed");
		expect(values["cmi.success_status"]).toBe("failed");
		expect(values["cmi.score.raw"]).toBe("20");
		expect(values["cmi.exit"]).toBe("suspend");
	});
});
