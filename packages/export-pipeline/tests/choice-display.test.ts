// @vitest-environment jsdom
import {
	createChoiceDependencyView,
	restoreChoiceAssessmentState,
} from "@praxity/shared-blocks/choice-learner-state";
import { admitChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import * as learner from "@praxity/shared-blocks/learner-block-state";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
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

function evidence(runtime: SCORMRuntime, states: Record<string, unknown> = {}) {
	return createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateQuestions: { q: gateQuestion },
			choiceStateSignatures: { q: gateSignature },
		}),
		{ rows: runtime.getInteractions(), readState: (id) => states[id] },
	);
}

// Keep these probes executable on the prerequisite base, with its exact display fallback.
function displayedScore(tracker: CourseTracker, runtime: SCORMRuntime) {
	const current = tracker as CourseTracker & { getCurrentScore?: SCORMRuntime["getScore"] };
	return current.getCurrentScore ? current.getCurrentScore() : runtime.getScore();
}

function learnerScore() {
	const read = (
		learner as typeof learner & {
			learnerScore?: (
				current: () => boolean,
				doc: Document,
			) => ReturnType<SCORMRuntime["getScore"]> | undefined;
		}
	).learnerScore;
	return read ? read(() => true, document) : learner.learnerRuntime(() => true)?.getScore?.();
}

it.each([false, true])("characterization: completion-only display stays null, view=%s", (view) => {
	const runtime = new LocalStorageRuntime(localStorage, "completion");
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		...(view ? { getChoiceDependencyView: () => evidence(runtime) } : {}),
	});
	Object.assign(window, { __praxityRuntime: runtime, __praxityTracker: tracker });
	expect(tracker.getOutcome()).toBeUndefined();
	expect(displayedScore(tracker, runtime)).toBeNull();
	expect(learnerScore()).toBeNull();
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
		expect(learnerScore()).toEqual({ raw: 75, min: 0, max: 100 });
		expect(window.__praxityBlockState).not.toHaveProperty("getChoiceDependencyView");
	},
);

it.each([false, true])("characterization: current rows retain recorded score, view=%s", (view) => {
	const runtime = new LocalStorageRuntime(localStorage, "current");
	runtime.trackInteraction("q", "b", false, 0);
	runtime.trackInteraction("practice", "answer", true, 100);
	runtime.setScore(75, 0, 100);
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		passMark: 80,
		scoredAssessmentIds: ["q"],
		...(view
			? { getChoiceDependencyView: () => evidence(runtime, { q: exhaustedGateState }) }
			: {}),
	});
	expect(displayedScore(tracker, runtime)).toEqual({ raw: 75, min: 0, max: 100 });
	expect(tracker.getOutcome()).toBeUndefined();
});

it("history display uses only the latest current scores without changing recorded LMS state", () => {
	const runtime = new LocalStorageRuntime(localStorage, "history");
	runtime.trackInteraction("q", "b", false, 0);
	runtime.trackInteraction("other", "first", false, 0);
	runtime.trackInteraction("other", "second", true, 80);
	runtime.setScore(75, 0, 100);
	const states = { q: { ...exhaustedGateState, contentSignature: `sha256:${"d".repeat(64)}` } };
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		requiredAssessmentIds: ["q"],
		getChoiceDependencyView: () => evidence(runtime, states),
	});
	Object.assign(window, { __praxityRuntime: runtime, __praxityTracker: tracker });
	const before = localStorage.getItem("praxity:history:default:state");
	expect(evidence(runtime, states).status("q")).toBe("history");
	expect(tracker.getOutcome()).toBeUndefined();
	expect(displayedScore(tracker, runtime)).toEqual({ raw: 80, min: 0, max: 100 });
	expect(learnerScore()).toEqual({ raw: 80, min: 0, max: 100 });
	expect(runtime.getScore()).toEqual({ raw: 75, min: 0, max: 100 });
	expect(localStorage.getItem("praxity:history:default:state")).toBe(before);
});

it("history with no current scored rows displays null rather than the recorded score", () => {
	const runtime = new LocalStorageRuntime(localStorage, "history-empty");
	runtime.trackInteraction("q", "b", false, 0);
	runtime.setScore(75, 0, 100);
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		getChoiceDependencyView: () =>
			evidence(runtime, { q: { ...exhaustedGateState, contentSignature: "broken" } }),
	});
	Object.assign(window, { __praxityRuntime: runtime, __praxityTracker: tracker });
	expect(displayedScore(tracker, runtime)).toBeNull();
	expect(learnerScore()).toBeNull();
});

it.each(["question", "group", "invalid"] as const)(
	"display detects %s history outside required dependencies",
	(kind) => {
		const runtime = new LocalStorageRuntime(localStorage, kind);
		runtime.trackInteraction("q", "b", false, 0);
		runtime.trackInteraction("other", "a", true, 100);
		runtime.setScore(75, 0, 100);
		const view = evidence(runtime);
		if (kind === "question")
			view.readState = () => ({ ...exhaustedGateState, contentSignature: "broken" });
		if (kind === "group") {
			view.questions = {};
			view.groups = { q: { mode: "all", memberIds: ["member"], requiredIds: ["member"] } };
			view.readState = () => ({ mode: "oneOf" });
		}
		if (kind === "invalid") {
			view.questions = {};
			view.invalidIds = ["q"];
		}
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			getChoiceDependencyView: () => view,
		});
		expect(view.status("q")).toBe("history");
		expect(displayedScore(tracker, runtime)).toEqual({ raw: 100, min: 0, max: 100 });
	},
);

it.each(["state", "callback"] as const)("history refuses otherwise final %s", (source) => {
	const runtime = new LocalStorageRuntime(localStorage, source);
	const config: TrackingConfig = {
		totalPages: 1,
		completionMethod: "allPages",
		getChoiceDependencyView: () =>
			evidence(runtime, { q: { ...exhaustedGateState, contentSignature: "broken" } }),
	};
	if (source === "state") config.getAssessmentState = () => exhaustedGateState;
	else config.isAssessmentFinal = () => true;
	expect(new CourseTracker(runtime, config).isAssessmentFinal("q")).toBe(false);
});

it("unanswered evidence cannot use a finality callback", () => {
	const runtime = new LocalStorageRuntime(localStorage, "unanswered");
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		isAssessmentFinal: () => true,
		getChoiceDependencyView: () => evidence(runtime),
	});
	expect(tracker.isAssessmentFinal("q")).toBe(false);
});

it("current evidence retains the host's unfinished saved-state decision", () => {
	const runtime = new LocalStorageRuntime(localStorage, "unfinished");
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		getAssessmentState: () => ({ completed: false }),
		getChoiceDependencyView: () => evidence(runtime, { q: exhaustedGateState }),
	});
	expect(tracker.isAssessmentFinal("q")).toBe(false);
});

for (const source of ["view", "host", "host override"] as const)
	it.each([
		[1, true, false],
		[2, false, true],
	] as const)(
		`round 1: ${source} legacy finality is admitted, attempts=%s, saved completed=%s`,
		(attemptCount, completed, expected) => {
			const runtime = new LocalStorageRuntime(localStorage, "normalized-finality");
			runtime.trackInteraction("q", "b", false, 0);
			const saved = Object.freeze({ ...exhaustedGateState, attemptCount, completed });
			const view = evidence(runtime, {
				q:
					source === "host override"
						? { ...saved, attemptCount: attemptCount === 1 ? 2 : 1, completed: !completed }
						: saved,
			});
			expect(view.status("q")).toBe("current");
			expect(
				restoreChoiceAssessmentState(saved, { question: gateQuestion, signature: gateSignature })
					.current?.completed,
			).toBe(expected);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "allPages",
				getChoiceDependencyView: () => view,
				...(source !== "view" ? { getAssessmentState: () => saved } : {}),
			});
			expect(tracker.isAssessmentFinal("q")).toBe(expected);
			expect(saved.completed).toBe(completed);
		},
	);

it("question finality refuses a status-only view without admission", () => {
	const runtime = new LocalStorageRuntime(localStorage, "status-only");
	const view = evidence(runtime, { q: exhaustedGateState });
	delete view.admitQuestionState;
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		getChoiceDependencyView: () => view,
	});
	expect(view.status("q")).toBe("current");
	expect(tracker.isAssessmentFinal("q")).toBe(false);
});

it("question admission does not claim another finality owner's state", () => {
	const runtime = new LocalStorageRuntime(localStorage, "other-finality");
	const view = evidence(runtime);
	expect(view.admitQuestionState?.("other", exhaustedGateState)).toBeNull();
});

it("question admission retains the saved preview build proof", () => {
	const view = createChoiceDependencyView(
		admitChoiceStateFacts({
			choiceStateQuestions: { q: gateQuestion },
			choiceStateSignatures: { q: gateSignature },
		}),
		{
			rows: [{ id: "q", correct: false }],
			readState: () => exhaustedGateState,
			preview: { currentRevision: "new-build", readSavedRevision: () => "old-build" },
		},
	);
	expect(view.status("q")).toBe("history");
	expect(view.admitQuestionState?.("q", exhaustedGateState)).toBeNull();
});
