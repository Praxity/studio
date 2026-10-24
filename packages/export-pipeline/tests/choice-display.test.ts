// @vitest-environment jsdom
import * as learner from "@praxity/shared-blocks/learner-block-state";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker } from "../src/scorm/tracking";
import {
	initializeCourseHost,
	readCourseDeploymentConfig,
} from "../template/src/hosts/course-host";
import { exhaustedGateState, gateQuestion, gateSignature } from "./fixtures/choice-gate";

afterEach(() => {
	delete window.__praxityTracker;
	delete window.__praxityRuntime;
	delete window.__praxityBlockState;
	delete (window as Window & { __praxityHostStarted?: string }).__praxityHostStarted;
	localStorage.clear();
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("characterization: completion-only display stays null", () => {
	const runtime = new LocalStorageRuntime(localStorage, "completion");
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
	});
	Object.assign(window, { __praxityRuntime: runtime, __praxityTracker: tracker });
	expect(tracker.getOutcome()).toBeUndefined();
	expect(learner.learnerRuntime(() => true)?.getScore?.()).toBeNull();
});

it.each(["scorm2004", "xapi"] as const)(
	"characterization: installed %s host keeps LMS grade 75 with no rows or history",
	(format) => {
		const values: Record<string, string> = {
			"cmi.score.raw": "75",
			"cmi.score.min": "0",
			"cmi.score.max": "100",
		};
		Object.assign(window, {
			API_1484_11: {
				Initialize: () => "true",
				Commit: () => "true",
				Terminate: () => "true",
				GetValue: (key: string) => values[key] ?? "",
				SetValue: (key: string, value: string) => {
					values[key] = value;
					return "true";
				},
				GetLastError: () => "0",
				GetErrorString: () => "",
				GetDiagnostic: () => "",
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 200 })),
		);
		const runtime =
			format === "scorm2004"
				? new Scorm2004Runtime(window)
				: new XapiRuntime(
						{
							endpoint: "https://lrs.example/statements",
							auth: "Basic test",
							actorMode: "manual",
							actor: { name: "Learner", mbox: "mailto:learner@example.com" },
						},
						"display",
						localStorage,
					);
		if (format === "xapi") runtime.setScore(75, 0, 100);
		document.body.innerHTML = `<main></main><script id="praxity-host-config" type="application/json">${JSON.stringify(
			{
				version: 1,
				courseId: "display",
				pageId: "one",
				pageTitle: "One",
				currentPage: 1,
				totalPages: 1,
				currentSlug: "one",
				availableSlugs: ["one"],
				pageIdMap: { one: "one" },
				completionMethod: "allPages",
				passMark: 80,
				scoredAssessmentIds: ["q"],
				pageRole: "content",
				deferVisits: true,
				strings: {},
				choiceStateQuestions: { q: gateQuestion },
				choiceStateSignatures: { q: gateSignature },
			},
		)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format, xapiConfig: { endpoint: "https://lrs.example/statements", auth: "Basic test", actorMode: "manual", actor: { name: "Learner", mbox: "mailto:learner@example.com" } } })}</script>`;
		expect(
			initializeCourseHost(
				{ format, readDeploymentConfig: readCourseDeploymentConfig, createRuntime: () => runtime },
				{
					win: window,
					doc: document,
					location: { href: "https://course.example/one.html", search: "", replace() {} },
					history,
				},
			),
		).toBe(true);
		expect(runtime.getInteractions()).toEqual([]);
		expect(window.__praxityTracker?.getOutcome?.()).toBeUndefined();
		expect(learner.learnerRuntime(() => true)?.getScore?.()).toEqual({ raw: 75, min: 0, max: 100 });
		expect(window.__praxityBlockState?.getChoiceDependencyView?.()?.rows).toEqual([]);
	},
);

it("characterization: scored rows retain recorded score", () => {
	const runtime = new LocalStorageRuntime(localStorage, "recorded");
	runtime.trackInteraction("q", "b", false, 0);
	runtime.trackInteraction("practice", "answer", true, 100);
	runtime.setScore(75, 0, 100);
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		passMark: 80,
		scoredAssessmentIds: ["q"],
	});
	Object.assign(window, { __praxityRuntime: runtime, __praxityTracker: tracker });
	expect(learner.learnerRuntime(() => true)?.getScore?.()).toEqual({ raw: 75, min: 0, max: 100 });
	expect(tracker.getOutcome()).toBeUndefined();
});

it.each([false, true])("saved-state finality retains completed=%s", (completed) => {
	const runtime = new LocalStorageRuntime(localStorage, "finality");
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		getAssessmentState: () => ({ ...exhaustedGateState, completed }),
	});
	expect(tracker.isAssessmentFinal("q")).toBe(completed);
});

it.each([false, true])("host finality callback retains final=%s", (final) => {
	const runtime = new LocalStorageRuntime(localStorage, "callback");
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		getAssessmentState: () => ({ completed: !final }),
		isAssessmentFinal: () => final,
	});
	expect(tracker.isAssessmentFinal("q")).toBe(final);
});
