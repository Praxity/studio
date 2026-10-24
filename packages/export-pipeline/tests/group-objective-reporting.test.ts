import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import {
	writeCourseOutcome,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import { dispatchSelfCheckEvent } from "@praxity/shared-blocks/self-check-consumers";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import {
	initializeCourseHost,
	initializeScormCourseHost,
	readCourseDeploymentConfig,
} from "../template/src/hosts/course-host";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const changed = `sha256:${"b".repeat(64)}`;
const submitted = {
	payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
	contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
};
const groupState = {
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
	submitted,
};
const answer = (contentSignature: string) => ({
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: true,
	correct: true,
	completed: true,
	interacted: true,
	answer: ["a"],
	contentSignature,
});
const question = {
	selectionMode: "single" as const,
	dontKnow: false,
	canAutoScore: true,
	graded: true,
	maxAttempts: 2,
	correctAnswerSignature: "sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
	materialSignature: `sha256:${"a".repeat(64)}`,
	options: [
		{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
		{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
	],
};

type Format = "scorm12" | "scorm2004" | "xapi" | "standalone";

function launch(format: Format, evidence = false, history = false) {
	const dom = new JSDOM("", { url: "https://course.example/one.html" });
	documents.push(dom);
	const win = dom.window as unknown as Window & typeof globalThis;
	vi.stubGlobal("window", win);
	vi.stubGlobal("document", win.document);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(null, { status: 200 })),
	);
	const values = new Map<string, string>();
	const writes: string[][] = [];
	let refuseObjectives = false;
	const set = (key: string, value: string) => {
		writes.push([key, value]);
		if (refuseObjectives && key.startsWith("cmi.objectives.")) return "false";
		values.set(key, value);
		return "true";
	};
	const get = (key: string) =>
		key === "cmi.objectives._count"
			? String([...values.keys()].filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key)).length)
			: (values.get(key) ?? "");
	Object.assign(win, {
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: () => "true",
			LMSGetValue: get,
			LMSSetValue: set,
			LMSGetLastError: () => "0",
			LMSGetErrorString: () => "",
			LMSGetDiagnostic: () => "",
		},
		API_1484_11: {
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: () => "true",
			GetValue: get,
			SetValue: set,
			GetLastError: () => "0",
			GetErrorString: () => "",
			GetDiagnostic: () => "",
		},
	});
	const open = (): SCORMRuntime =>
		format === "scorm12"
			? new Scorm12Runtime("course")
			: format === "scorm2004"
				? new Scorm2004Runtime(win)
				: format === "standalone"
					? new LocalStorageRuntime(win.localStorage, "course")
					: new XapiRuntime(
							{
								endpoint: "https://lrs.example/statements",
								auth: "",
								actorMode: "manual",
								actor: { name: "Learner", mbox: "mailto:learner@example.com" },
							},
							"course",
							win.localStorage,
						);
	const runtime = open();
	const view = () =>
		withChoiceDependencyStatus({
			rows: runtime.getInteractions().map((row) => ({
				...row,
				...(row.id === "q" ? { contentSignature: signature } : {}),
				...(row.id === "g" ? { contentSignature: submitted.contentSignature } : {}),
			})),
			questions: { q: question },
			signatures: { q: signature },
			groups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
			readState: (id) => win.__praxityBlockState?.get(id),
		});
	if (evidence) {
		let provider: LearnerBlockStateRuntime | undefined;
		Object.defineProperty(win, "__praxityBlockState", {
			get: () => provider,
			set: (value: LearnerBlockStateRuntime) => {
				provider = value;
				provider.getChoiceDependencyView = view;
			},
		});
	}
	const page = {
		version: 1,
		courseId: "course",
		pageId: "one",
		pageTitle: "One",
		currentPage: 1,
		totalPages: 2,
		currentSlug: "one",
		availableSlugs: ["one"],
		pageIdMap: { one: "one" },
		completionMethod: "allPages",
		requiredAssessmentIds: ["q"],
		pageRole: "content",
		strings: {},
	};
	win.document.body.innerHTML = `<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
	Object.defineProperty(win.document, "readyState", { value: "complete" });
	const initialize =
		format === "scorm12" || format === "scorm2004"
			? initializeScormCourseHost
			: initializeCourseHost;
	expect(
		initialize({
			format,
			readEntry: () => null,
			readDeploymentConfig: readCourseDeploymentConfig,
			createRuntime: () => runtime,
		}),
	).toBe(true);
	const provider = win.__praxityBlockState;
	if (!provider) throw new Error("Missing provider installation");
	if (evidence) {
		provider.set("q", answer(history ? changed : signature));
		runtime.trackInteraction("q", "a", true, 100);
		runtime.trackInteraction("a", "answer", true, 100);
		// Retain ordinary outcome reporting alongside the injected provider evidence.
		win.__praxityTracker = new CourseTracker(runtime, {
			totalPages: 2,
			completionMethod: "allPages",
			requiredAssessmentIds: ["q"],
		});
		expect(view().status("q")).toBe(history ? "history" : "current");
	}
	writes.length = 0;
	return {
		win,
		runtime,
		provider,
		open,
		writes,
		view,
		refuseObjectives: () => {
			refuseObjectives = true;
		},
	};
}

/** Keep the group owner's dispatch refusal and stage/report/save order. */
function submit(host: ReturnType<typeof launch>, detail: Record<string, unknown> = {}) {
	const event = new host.win.CustomEvent("praxity:assessment-group-complete", {
		detail: {
			groupId: "g",
			score: 100,
			passed: true,
			correct: true,
			completed: true,
			memberIds: ["a"],
			contentSignature: submitted.contentSignature,
			...detail,
		},
		cancelable: true,
	});
	const save = () => writeLearnerBlockState("g", groupState, () => true, host.win.document);
	const report = () => dispatchSelfCheckEvent(event, () => true, host.win.document);
	const accepted = host.provider.stageSubmission
		? host.provider.stageSubmission("g", () => save() && report())
		: report();
	if (accepted && !host.provider.stageSubmission) save();
	return { accepted, event };
}

describe.each(["scorm12", "scorm2004"] as const)("%s optional objective reporting", (format) => {
	it("ordinary nonboolean pass flags retain the failed objective", () => {
		const host = launch(format);
		expect(host.provider.getChoiceDependencyView).toBeUndefined();
		expect(Reflect.get(host.provider, "getChoiceReporting")).toBeUndefined();
		expect(submit(host, { passed: "false" }).accepted).toBe(true);
		expect(
			host.writes.filter(([key]) => key.startsWith("cmi.objectives.")).map(([, v]) => v),
		).toEqual(["g", "100", "failed"]);
	});

	it("best-effort native objective refusal does not cancel an admitted capture", () => {
		const host = launch(format, true);
		host.refuseObjectives();
		const commit = vi.spyOn(host.runtime, "commit");
		const { accepted, event } = submit(host);
		expect(accepted).toBe(true);
		expect(event.defaultPrevented).toBe(false);
		expect(host.provider.get("g")).toEqual(groupState);
		expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 100 });
		expect(commit).toHaveBeenCalled();
	});
});

describe.each(["xapi", "standalone"] as const)("%s without an objective sink", (format) => {
	it("the shared writer treats the absent method as a successful no-op", () => {
		const host = launch(format);
		expect("trackObjective" in host.runtime).toBe(false);
		expect(
			writeCourseOutcome(host.runtime, {
				objective: { id: "g", score: 100, passed: true },
			}),
		).toBe(true);
	});

	for (const history of [true, false])
		for (const score of [100, undefined])
			it(`accepts a ${history ? "historical" : "current"} ${score === undefined ? "ungraded" : "graded"} signed capture; refuses a forged candidate`, () => {
				const host = launch(format, true, history);
				host.runtime.trackPageVisit("one");
				host.runtime.trackPageVisit("two");
				expect("trackObjective" in host.runtime).toBe(false);
				expect(host.provider.getSaveResult).toBeUndefined();
				expect(Reflect.get(host.provider, "prepareGroupState")).toBeUndefined();
				const commit = vi.spyOn(host.runtime, "commit");
				const { accepted, event } = submit(host, { score });
				expect(accepted).toBe(true);
				expect(event.defaultPrevented).toBe(false);
				expect(commit).toHaveBeenCalledExactlyOnceWith();
				expect(host.provider.get("g")).toEqual(groupState);
				expect(host.runtime.getInteractions().at(-1)?.id).toBe("g");
				expect(host.runtime.getInteractions().at(-1)?.score).toBe(score);
				expect(host.runtime.getCompletion()).toBe("completed");
				if (format === "xapi")
					expect(fetch).toHaveBeenCalledWith(
						"https://lrs.example/statements",
						expect.objectContaining({ body: expect.stringContaining('"completion":true') }),
					);
				const rows = host.runtime.getInteractions();
				expect(submit(host, { contentSignature: changed }).accepted).toBe(false);
				expect(host.provider.get("g")).toEqual(groupState);
				expect(host.runtime.getInteractions()).toEqual(rows);
				expect(commit).toHaveBeenCalledTimes(1);
				const reopened = host.open();
				expect(reopened.initialize()).toBe(true);
				expect(reopened.getCompletion()).toBe("completed");
				expect(createBlockStateRuntime(reopened).get("g")).toEqual(groupState);
			});
});

it("refused xAPI storage retains page memory without an objective obligation in either document", () => {
	const host = launch("xapi", true, true);
	const storage = vi
		.spyOn(Object.getPrototypeOf(host.win.localStorage), "setItem")
		.mockImplementation(() => {
			throw new Error("storage refused");
		});
	expect(submit(host).accepted).toBe(true);
	expect(storage).toHaveBeenCalled();
	expect(Reflect.get(host.provider, "prepareGroupState")).toBeUndefined();
	expect(host.provider.get("g")).toEqual(groupState);
	expect(host.provider.get("g")).not.toHaveProperty("submitted.deferredObjective");
	host.provider.set("q", answer(signature));
	host.runtime.trackInteraction("q", "a", true, 100);
	expect(host.view().status("q")).toBe("current");
	(host.win.__praxityTracker as CourseTracker).checkCompletion();
	expect("trackObjective" in host.runtime).toBe(false);
	expect(Reflect.get(host.provider, "prepareGroupState")).toBeUndefined();
	expect(host.provider.get("g")).not.toHaveProperty("submitted.deferredObjective");
	const reopened = host.open();
	expect(reopened.initialize()).toBe(true);
	expect("trackObjective" in reopened).toBe(false);
	const provider = createBlockStateRuntime(reopened);
	expect(Reflect.get(provider, "prepareGroupState")).toBeUndefined();
	expect(provider.get("g")).toBeUndefined();
	expect(reopened.getSuspendData()).not.toContain("deferredObjective");
});
