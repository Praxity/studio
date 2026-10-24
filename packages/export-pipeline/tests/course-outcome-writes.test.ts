import { finishLearnerCourse } from "@praxity/shared-blocks/learner-block-state";
import { navigatePageAction } from "@praxity/shared-blocks/viewer/navigate-page";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import type { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import {
	type CourseHostConfig,
	initializeCourseHost,
	initializeScormCourseHost,
} from "../template/src/hosts/course-host";

type Format =
	| "scorm12"
	| "scorm2004"
	| "xapi"
	| "standalone"
	| "scorm12-fallback"
	| "scorm2004-fallback";
type Mode =
	| "tracker"
	| "percentage"
	| "groups-all"
	| "groups-oneOf"
	| "deck"
	| "quiz"
	| "pass-mark";
type Trigger = "answer" | "End" | "Finish" | "termination" | "group objective";
type State = "unanswered" | "retryable" | "pending aggregate" | "failed" | "passed";
const documents: JSDOM[] = [];

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	let statementId = 0;
	vi.spyOn(crypto, "randomUUID").mockImplementation(
		() => `00000000-0000-4000-8000-${String(++statementId).padStart(12, "0")}`,
	);
});
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function launch(format: Format, mode: Mode) {
	const fallback = format.endsWith("-fallback");
	const hostFormat =
		format === "scorm12-fallback"
			? "scorm12"
			: format === "scorm2004-fallback"
				? "scorm2004"
				: format;
	const log: unknown[][] = [];
	const values: Record<string, string> = {};
	const call = (name: string, ...args: string[]) => {
		log.push([name, ...args]);
		return "true";
	};
	const set = (key: string, value: string) => {
		values[key] = value;
		if (/^cmi\.interactions\.\d+\.id$/.test(key))
			values["cmi.interactions._count"] = String(
				Object.keys(values).filter((key) => /^cmi\.interactions\.\d+\.id$/.test(key)).length,
			);
		return call("set", key, value);
	};
	const api =
		format === "scorm12"
			? {
					LMSInitialize: () => call("initialize"),
					LMSFinish: () => call("terminate"),
					LMSGetValue: (key: string) =>
						key === "cmi.objectives._count"
							? String(
									Object.keys(values).filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key))
										.length,
								)
							: (values[key] ?? ""),
					LMSSetValue: set,
					LMSCommit: () => call("commit"),
					LMSGetLastError: () => "0",
					LMSGetErrorString: () => "",
					LMSGetDiagnostic: () => "",
				}
			: {
					Initialize: () => call("initialize"),
					Terminate: () => call("terminate"),
					GetValue: (key: string) =>
						key === "cmi.objectives._count"
							? String(
									Object.keys(values).filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key))
										.length,
								)
							: (values[key] ?? ""),
					SetValue: set,
					Commit: () => call("commit"),
					GetLastError: () => "0",
					GetErrorString: () => "",
					GetDiagnostic: () => "",
				};
	const group = mode.startsWith("groups-");
	const config: CourseHostConfig = {
		version: 1,
		courseId: "outcome-log",
		pageId: "one",
		pageTitle: "One",
		currentPage: 1,
		totalPages: 2,
		currentSlug: "one",
		availableSlugs: ["one", "two"],
		pageIdMap: { one: "one", two: "two" },
		pageRole: "content",
		strings: {},
		completionMethod: mode === "quiz" ? "quiz" : mode === "percentage" ? "percentage" : "allPages",
		completionThreshold: 50,
		...(mode === "pass-mark" || group
			? { passMark: 80, scoredAssessmentIds: [group ? "group" : "a", ...(group ? [] : ["b"])] }
			: {}),
		...(group || mode === "deck" ? { requiredAssessmentIds: [group ? "group" : "a"] } : {}),
		...(mode === "deck" ? { deck: true } : {}),
	};
	const dom = new JSDOM(
		`<script id="praxity-host-config" type="application/json">${JSON.stringify(config)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format: hostFormat })}</script>`,
		{ url: "https://course.example/one.html" },
	);
	documents.push(dom);
	Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
	Object.defineProperty(dom.window, "parent", {
		value: { [format === "scorm12" ? "API" : "API_1484_11"]: api },
	});
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("document", dom.window.document);
	vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
	vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
		log.push(["POST", init.body]);
		return new Response(null, { status: 200 });
	});
	if (format === "standalone" || fallback) {
		const setItem = dom.window.Storage.prototype.setItem;
		dom.window.Storage.prototype.setItem = function (key, value) {
			log.push(["storage", key, value]);
			setItem.call(this, key, value);
		};
	}
	const runtime: SCORMRuntime =
		format === "standalone" || fallback
			? new LocalStorageRuntime(dom.window.localStorage, "outcome-log", "default")
			: format === "scorm12"
				? new Scorm12Runtime()
				: format === "scorm2004"
					? new Scorm2004Runtime(dom.window)
					: new XapiRuntime(
							{
								endpoint: "https://lrs.example/statements",
								auth: "Basic synthetic",
								actorMode: "manual",
								actor: { name: "Learner", mbox: "mailto:learner@example.com" },
							},
							"outcome-log",
							dom.window.localStorage,
						);
	const environment = {
		win: dom.window as unknown as Window,
		doc: dom.window.document,
		location: dom.window.location,
		history: dom.window.history,
	};
	const adapter = {
		format: hostFormat,
		isFallback: () => fallback,
		createRuntime: () => runtime,
		readEntry: () => "",
		readDeploymentConfig: () => ({ format: hostFormat }),
	};
	expect(
		format === "xapi" || format === "standalone"
			? initializeCourseHost(adapter, environment)
			: initializeScormCourseHost(adapter, environment),
	).toBe(true);
	const win = dom.window as unknown as Window & { __praxityTracker: CourseTracker };
	const tracker = win.__praxityTracker;
	const event = (name: string, detail: Record<string, unknown>) =>
		dom.window.document.dispatchEvent(new dom.window.CustomEvent(name, { detail }));
	const answer = (id: string, score: number, attemptsUsed = 1) =>
		event("praxity:assessment-response", {
			blockId: id,
			responseText: score ? "yes" : "no",
			correct: score === 100,
			score,
			maxScore: 100,
			attemptsUsed,
			maxAttempts: 2,
		});
	const aggregate = (score: number) =>
		event("praxity:assessment-group-complete", {
			groupId: "group",
			groupName: "Group",
			score,
			passed: score >= 80,
			memberIds: mode === "groups-oneOf" ? ["a"] : ["a", "b"],
		});
	return { log, runtime, tracker, win, group, answer, aggregate };
}

describe.each([
	"scorm12",
	"scorm2004",
	"xapi",
	"standalone",
	"scorm12-fallback",
	"scorm2004-fallback",
] as const)("%s LMS write log on unchanged content", (format) => {
	for (const mode of [
		"tracker",
		"percentage",
		"groups-all",
		"groups-oneOf",
		"deck",
		"quiz",
		"pass-mark",
	] as const) {
		if (
			(format === "standalone" || format.endsWith("-fallback")) &&
			!["tracker", "pass-mark"].includes(mode)
		)
			continue;
		it.each(["answer", "End", "Finish", "termination", "group objective"] as const)(
			`${mode}: %s`,
			(trigger: Trigger) => {
				const logs: Record<string, unknown> = {};
				for (const state of [
					"unanswered",
					"retryable",
					"pending aggregate",
					"failed",
					"passed",
				] as const satisfies readonly State[]) {
					const fixture = launch(format, mode);
					const { log, runtime, tracker, win, answer, aggregate, group } = fixture;
					if (mode === "deck") tracker.trackPageVisit("one");
					if (state !== "unanswered") {
						answer("a", state === "passed" ? 100 : 0, state === "failed" ? 2 : 1);
						answer("b", 100);
						if (group) aggregate(state === "passed" ? 100 : 50);
						if (state === "pending aggregate") answer("a", 100, 2);
					}
					tracker.trackPageVisit("two");
					runtime.commit();
					log.push(["trigger", trigger]);
					if (trigger === "answer") {
						answer("practice", 20);
						answer("a", 100, 2);
						if (group) aggregate(100);
						answer("a", 0, 2);
						if (group) aggregate(50);
					} else if (trigger === "End") {
						expect(
							navigatePageAction("__end_lesson__", {
								currentPage: 1,
								currentSlug: "one",
								pages: [{ slug: "one" }, { slug: "two" }],
								pageIdMap: { one: "one", two: "two" },
							}),
						).toBe(true);
					} else if (trigger === "Finish") {
						expect(finishLearnerCourse(() => true)).toBe(true);
					} else if (trigger === "termination") {
						expect(runtime.terminate(false)).toBe(true);
					} else aggregate(80);
					logs[state] = log;
					// Release each document before the next launch and keep its complete raw writes.
					delete win.__praxityFinishCourse;
				}
				expect(JSON.stringify(logs, null, 2)).toMatchSnapshot();
			},
		);
	}

	it("runtime-only End and Finish retain the complete write log", () => {
		const logs: Record<string, unknown> = {};
		for (const trigger of ["End", "Finish"] as const) {
			const { log, win } = launch(format, "pass-mark");
			delete win.__praxityFinishCourse;
			delete (win as Window).__praxityTracker;
			if (trigger === "End")
				expect(
					navigatePageAction("__end_lesson__", {
						currentPage: 1,
						currentSlug: "one",
						pages: [{ slug: "one" }, { slug: "two" }],
						pageIdMap: { one: "one", two: "two" },
					}),
				).toBe(true);
			else expect(finishLearnerCourse(() => true)).toBe(true);
			logs[trigger] = log;
		}
		expect(JSON.stringify(logs, null, 2)).toMatchSnapshot();
	});
});

// Generated on main before restoring the refactor. Calls and return values share one log.
describe.each(["standalone", "xapi"] as const)("%s Finish caller authority", (format) => {
	it.each(["caller", "provider"] as const)("revoked %s during completion", (revoked) => {
		const { runtime, win } = launch(format, "tracker");
		const log: unknown[][] = [];
		let current = true;
		runtime.setCompletion = (status) => {
			log.push(["setCompletion", status]);
			if (revoked === "caller") current = false;
			else win.__praxityBlockState = undefined;
		};
		runtime.commit = () => {
			log.push(["commit"]);
			return true;
		};
		log.push(["result", finishLearnerCourse(() => current)]);
		expect(log).toEqual(
			revoked === "caller"
				? [
						["setCompletion", "completed"],
						["result", false],
					]
				: [["setCompletion", "completed"], ["commit"], ["result", true]],
		);
		expect(JSON.stringify(log, null, 2)).toMatchSnapshot();
	});
});
