import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ChoiceDependencyView,
	choiceDependencyStatus,
} from "../../shared-blocks/src/choice-learner-state";
import { finishRuntimeCourse, writeCourseOutcome } from "../../shared-blocks/src/tracking";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime, type XapiStatement } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { initializeCourseHost, initializeScormCourseHost } from "../template/src/hosts/course-host";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

const documents: JSDOM[] = [];
const signature = `sha256:${"a".repeat(64)}`;
const question = {
	selectionMode: "single" as const,
	dontKnow: false,
	canAutoScore: true,
	graded: true,
	maxAttempts: 2,
	correctAnswerSignature: signature,
	materialSignature: signature,
	options: [{ id: "a", materialSignature: signature }],
};
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
});

function launch(format: "scorm12" | "scorm2004" | "xapi" | "standalone", initialize = true) {
	const dom = new JSDOM("<main></main>", { url: "https://course.example/one.html" });
	documents.push(dom);
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("document", dom.window.document);
	const values: Record<string, string> = {
		"cmi.core.lesson_status": "incomplete",
		"cmi.completion_status": "incomplete",
		"cmi.success_status": "unknown",
	};
	const writes: unknown[][] = [];
	const set = (key: string, value: string) => {
		values[key] = value;
		writes.push([key, value]);
		return "true";
	};
	const get = (key: string) => values[key] ?? "";
	Object.assign(dom.window, {
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
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			const statement = JSON.parse(String(init?.body)) as XapiStatement;
			writes.push([statement.verb.id, statement.result]);
			return new Response(null, { status: 200 });
		}),
	);
	const runtime: SCORMRuntime =
		format === "standalone"
			? new LocalStorageRuntime(dom.window.localStorage, "course")
			: format === "scorm12"
				? new Scorm12Runtime()
				: format === "scorm2004"
					? new Scorm2004Runtime(dom.window as unknown as Window)
					: new XapiRuntime(
							{
								endpoint: "https://lrs.example/statements",
								auth: "",
								actorMode: "manual",
								actor: { name: "Learner", mbox: "mailto:learner@example.com" },
							},
							"course",
							dom.window.localStorage,
						);
	if (initialize) expect(runtime.initialize()).toBe(true);
	const outcomes = () =>
		writes.filter(
			([key]) =>
				/^(?:cmi\.(?:objectives|score|success_status|completion_status)|cmi\.core\.(?:score|lesson_status))/.test(
					String(key),
				) || /\/(?:completed|passed|failed)$/.test(String(key)),
		);
	return { runtime, dom, values, writes, outcomes };
}

function groupView(runtime: SCORMRuntime) {
	const states: Record<string, unknown> = {
		g: {
			version: 1,
			kind: "assessmentGroup",
			mode: "oneOf",
			selectedMemberId: "b",
			completed: false,
		},
	};
	return (): ChoiceDependencyView => ({
		rows: runtime
			.getInteractions()
			.map((row) => (row.id === "g" ? { ...row, memberIds: ["a"] } : row)),
		questions: {},
		signatures: {},
		groups: { g: { mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] } },
		readState: (id) => states[id],
	});
}

describe.each(["scorm12", "scorm2004", "xapi"] as const)("%s dormant waiting", (format) => {
	it("quiz waits for a scored compiled group whose selected member changed", () => {
		const { runtime, writes, outcomes } = launch(format);
		runtime.trackInteraction("a", "answer", true, 100);
		runtime.trackInteraction("b", "answer", true, 100);
		runtime.trackInteraction("g", "100%", true, 100, { memberIds: ["a"] });
		const view = groupView(runtime);
		expect(choiceDependencyStatus("a", view())).toBe("current");
		expect(choiceDependencyStatus("b", view())).toBe("current");
		expect(choiceDependencyStatus("g", view())).toBe("history");
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			passMark: 60,
			getChoiceDependencyView: () => withChoiceDependencyStatus(view()),
		});
		writes.length = 0;
		tracker.trackInteraction("new", "answer", true, 100);
		tracker.trackGroupObjective("other", 100, true);
		expect(tracker.outcome().kind).toBe("waiting");
		tracker.finish(true);
		expect(outcomes()).toEqual([]);
	});

	it("invalid x=0 beside a=b=100 waits instead of reporting 100/pass", () => {
		const { runtime, writes, outcomes } = launch(format);
		for (const [id, score] of [
			["a", 100],
			["b", 100],
			["x", 0],
		] as const)
			runtime.trackInteraction(id, "answer", score === 100, score);
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			getChoiceDependencyView: () =>
				withChoiceDependencyStatus({
					rows: runtime.getInteractions(),
					questions: {},
					signatures: {},
					invalidIds: ["x"],
					readState: () => undefined,
				}),
		});
		writes.length = 0;
		tracker.trackInteraction("b", "answer", true, 100);
		expect(outcomes()).toEqual([]);
		expect(tracker.outcome().kind).toBe("waiting");
	});

	it("a removed scored ID cannot freeze quiz completion", () => {
		const { runtime } = launch(format);
		runtime.trackInteraction("removed", "answer", true, 100);
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			getChoiceDependencyView: () =>
				withChoiceDependencyStatus({
					rows: runtime.getInteractions(),
					questions: {},
					signatures: {},
					readState: () => undefined,
				}),
		});
		expect(tracker.outcome()).toMatchObject({ kind: "decided", completion: "passed" });
	});

	it.each(["graded history", "ungraded history", "unanswered"] as const)(
		"quiz includes submitted compiled questions only when graded: %s",
		(kind) => {
			const { runtime } = launch(format);
			if (kind !== "unanswered")
				runtime.trackInteraction("q", "answer", false, kind === "ungraded history" ? undefined : 0);
			const view = (): ChoiceDependencyView => ({
				rows: runtime.getInteractions().map((row) => ({ ...row, choiceEvidenceInvalid: true })),
				questions: { q: { ...question, graded: kind !== "ungraded history" } },
				signatures: { q: signature },
				readState: () => undefined,
			});
			expect(choiceDependencyStatus("q", view())).toBe(
				kind === "unanswered" ? "unanswered" : "history",
			);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "quiz",
				getChoiceDependencyView: () => withChoiceDependencyStatus(view()),
			});
			expect(tracker.outcome().kind).toBe(kind === "graded history" ? "waiting" : "decided");
		},
	);

	it.each(["g", "invalid", "*"])(
		"unscored or sentinel history %s does not become a quiz dependency",
		(id) => {
			const { runtime } = launch(format);
			runtime.trackInteraction("other", "answer", true, 100);
			runtime.trackInteraction(id, "answer", false, id === "*" ? 0 : undefined, {
				memberIds: ["a"],
			});
			const view = groupView(runtime);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "quiz",
				getChoiceDependencyView: () =>
					withChoiceDependencyStatus({ ...view(), invalidIds: id === "g" ? [] : [id] }),
			});
			expect(tracker.outcome().kind).toBe("decided");
		},
	);

	it("completion-only ignores optional historical scored groups", () => {
		const { runtime } = launch(format);
		runtime.trackInteraction("g", "100%", true, 100, { memberIds: ["a"] });
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			scoredAssessmentIds: ["g"],
			getChoiceDependencyView: () => withChoiceDependencyStatus(groupView(runtime)()),
		});
		expect(tracker.outcome().kind).toBe("decided");
	});

	it("quiz waits for a historical finite-score row even when its facts say ungraded", () => {
		const { runtime } = launch(format);
		runtime.trackInteraction("q", "answer", false, 0);
		runtime.trackInteraction("other", "answer", true, 100);
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			getChoiceDependencyView: () =>
				withChoiceDependencyStatus({
					rows: runtime
						.getInteractions()
						.map((row) => (row.id === "q" ? { ...row, choiceEvidenceInvalid: true } : row)),
					questions: { q: { ...question, graded: false } },
					signatures: { q: signature },
					readState: () => undefined,
				}),
		});
		expect(tracker.outcome("score")).toEqual({ kind: "waiting" });
	});

	it("decided quiz arithmetic matches main when ungraded history has no score", () => {
		const { runtime } = launch(format);
		runtime.trackInteraction("q", "answer", false);
		runtime.trackInteraction("other", "answer", true, 100);
		const config: TrackingConfig = { totalPages: 1, completionMethod: "quiz" };
		expect(new CourseTracker(runtime, config).outcome("score")).toEqual({
			kind: "decided",
			score: 100,
		});
		config.getChoiceDependencyView = () =>
			withChoiceDependencyStatus({
				rows: runtime
					.getInteractions()
					.map((row) => (row.id === "q" ? { ...row, choiceEvidenceInvalid: true } : row)),
				questions: { q: { ...question, graded: false } },
				signatures: { q: signature },
				readState: () => undefined,
			});
		expect(new CourseTracker(runtime, config).outcome("score")).toEqual({
			kind: "decided",
			score: 100,
		});
	});

	it.each(["allPages", "percentage", "quiz"] as const)(
		"%s waits before every outcome intent",
		(completionMethod) => {
			const { runtime, writes, outcomes } = launch(format);
			runtime.trackInteraction("q", "answer", false, 0);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod,
				requiredAssessmentIds: ["q"],
				getChoiceDependencyView: () =>
					withChoiceDependencyStatus({
						rows: runtime.getInteractions(),
						questions: {},
						signatures: {},
						invalidIds: ["q"],
						readState: () => undefined,
					}),
			});
			for (const intent of [
				"check",
				"score",
				"display",
				"prepareCommit",
				"end",
				"finish",
				{ id: "g", score: 100, passed: true },
			] as const)
				expect(tracker.outcome(intent).kind).toBe("waiting");
			writes.length = 0;
			tracker.trackPageVisit("one");
			tracker.trackInteraction("practice", "answer", true, 100);
			tracker.trackGroupObjective("g", 100, true);
			tracker.prepareCommit();
			expect(outcomes()).toEqual([]);
		},
	);
});

it("decided quiz retains main's unscored historical retry state", () => {
	const { runtime } = launch("scorm2004");
	runtime.trackInteraction("other", "answer", false, 50, {
		maxAttempts: 1,
		attemptsUsed: 1,
	});
	runtime.trackInteraction("u", "answer", false, undefined, {
		maxAttempts: 2,
		attemptsUsed: 1,
	});
	const config: TrackingConfig = {
		totalPages: 1,
		completionMethod: "quiz",
		deferRetryableFailure: true,
	};
	expect(new CourseTracker(runtime, config).outcome()).toMatchObject({
		kind: "decided",
		result: { score: 50, passed: false, retryable: true },
		completion: "incomplete",
	});
	config.getChoiceDependencyView = () =>
		withChoiceDependencyStatus({
			rows: runtime.getInteractions(),
			questions: {},
			signatures: {},
			invalidIds: ["u"],
			readState: () => undefined,
		});
	expect(config.getChoiceDependencyView()?.status("u")).toBe("history");
	expect(new CourseTracker(runtime, config).outcome()).toMatchObject({
		kind: "decided",
		result: { score: 50, passed: false, retryable: true },
		completion: "incomplete",
	});
});

it("pass-mark scored dependencies wait while an unrelated optional history row does not", () => {
	const { runtime } = launch("scorm2004");
	runtime.trackInteraction("q", "answer", true, 100);
	const config: TrackingConfig = {
		totalPages: 1,
		completionMethod: "allPages",
		passMark: 80,
		scoredAssessmentIds: ["q"],
		getChoiceDependencyView: () =>
			withChoiceDependencyStatus({
				rows: runtime.getInteractions(),
				questions: {},
				signatures: {},
				invalidIds: ["q"],
				readState: () => undefined,
			}),
	};
	expect(new CourseTracker(runtime, config).outcome().kind).toBe("waiting");
	config.getChoiceDependencyView = () =>
		withChoiceDependencyStatus({
			rows: runtime.getInteractions(),
			questions: {},
			signatures: {},
			invalidIds: ["optional"],
			readState: () => undefined,
		});
	expect(new CourseTracker(runtime, config).outcome().kind).toBe("decided");
});

for (const format of ["scorm12", "scorm2004"] as const)
	for (const success of format === "scorm12"
		? (["passed"] as const)
		: (["passed", "failed"] as const))
		it(`${format} completed/${success} waiting commit and End suspend without outcome writes`, () => {
			const { runtime, values, writes, outcomes } = launch(format);
			values["cmi.core.lesson_status"] = "passed";
			values["cmi.completion_status"] = "completed";
			values["cmi.success_status"] = success;
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "allPages",
				requiredAssessmentIds: ["q"],
				getChoiceDependencyView: () =>
					withChoiceDependencyStatus({
						rows: [],
						questions: {},
						signatures: {},
						invalidIds: ["q"],
						readState: () => undefined,
					}),
			});
			runtime.setCommitPreparation?.(() => tracker.prepareCommit());
			writes.length = 0;
			expect(runtime.commit()).toBe(true);
			expect(tracker.finish()).toBe(true);
			expect(outcomes()).toEqual([]);
			expect(
				writes.filter(([key]) => key === (format === "scorm12" ? "cmi.core.exit" : "cmi.exit")),
			).toEqual([
				[format === "scorm12" ? "cmi.core.exit" : "cmi.exit", "suspend"],
				[format === "scorm12" ? "cmi.core.exit" : "cmi.exit", "suspend"],
			]);
		});

it("decided preparation releases waiting without inventing a completion write", () => {
	const { runtime, values, writes, outcomes } = launch("scorm2004");
	values["cmi.completion_status"] = "completed";
	let waiting = true;
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "allPages",
		requiredAssessmentIds: ["q"],
		getChoiceDependencyView: () =>
			withChoiceDependencyStatus({
				rows: [],
				questions: {},
				signatures: {},
				invalidIds: waiting ? ["q"] : [],
				readState: () => undefined,
			}),
	});
	runtime.setCommitPreparation?.(() => tracker.prepareCommit());
	runtime.commit();
	expect(values["cmi.exit"]).toBe("suspend");
	waiting = false;
	writes.length = 0;
	runtime.commit();
	expect(values["cmi.exit"]).toBe("normal");
	expect(outcomes()).toEqual([]);
});

for (const pageKind of ["utility", "deferred content", "resume redirect"] as const)
	for (const success of ["unknown", "failed"] as const)
		it(`characterization: no-history ${pageKind}, completed/${success}, keeps normal before tracked success`, () => {
			const { runtime, dom, values, writes } = launch("scorm2004", false);
			values["cmi.completion_status"] = "completed";
			values["cmi.success_status"] = success;
			values["cmi.location"] = "two";
			const page = {
				version: 1,
				courseId: "course",
				pageId: "one",
				pageTitle: "One",
				currentPage: 1,
				totalPages: 2,
				currentSlug: "one",
				availableSlugs: ["one", "two"],
				pageIdMap: { one: "one", two: "two" },
				completionMethod: "allPages",
				passMark: 80,
				scoredAssessmentIds: ["q"],
				deferVisits: true,
				pageRole: pageKind === "utility" ? "resources" : "content",
				strings: {},
			};
			dom.window.document.body.innerHTML += `<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">{"format":"scorm2004"}</script>`;
			Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
			const replace = vi.fn();
			expect(
				initializeScormCourseHost(
					{
						format: "scorm2004",
						readEntry: () => (pageKind === "resume redirect" ? "resume" : null),
						createRuntime: () => runtime,
					},
					{
						win: dom.window as unknown as Window,
						doc: dom.window.document,
						location: { href: dom.window.location.href, search: "", replace },
						history: dom.window.history,
					},
				),
			).toBe(true);
			if (pageKind === "resume redirect") expect(replace).toHaveBeenCalledOnce();
			writes.length = 0;
			dom.window.dispatchEvent(new dom.window.Event("pagehide"));
			expect(writes.filter(([key]) => key !== "cmi.session_time")).toEqual([
				["cmi.exit", "normal"],
			]);
		});

it.each(["end", "finish"] as const)(
	"xAPI waiting %s suppresses only its own termination result",
	(intent) => {
		const { runtime, writes, outcomes } = launch("xapi");
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			requiredAssessmentIds: ["q"],
			getChoiceDependencyView: () =>
				withChoiceDependencyStatus({
					rows: [],
					questions: {},
					signatures: {},
					invalidIds: ["q"],
					readState: () => undefined,
				}),
		});
		writes.length = 0;
		expect(tracker.finish(intent === "finish")).toBe(true);
		expect(outcomes()).toEqual([]);
		expect(runtime.initialize()).toBe(true);
		writes.length = 0;
		expect(runtime.terminate()).toBe(true);
		expect(outcomes()).toHaveLength(1);
	},
);

it("runtime-only End accepts a waiting outcome and never forces completion", () => {
	const { runtime, writes, outcomes } = launch("xapi");
	writes.length = 0;
	expect(finishRuntimeCourse(runtime, { kind: "waiting", finish: "complete" })).toBe(true);
	expect(outcomes()).toEqual([]);
});

it("the waiting writer cancels credit before any intent and terminates with explicitFinish=false", () => {
	const calls: unknown[][] = [];
	const runtime = {
		configureOutcome: (policy: { waiting: boolean }) => calls.push(["policy", policy]),
		setCompletion: () => calls.push(["completion"]),
		setScore: () => calls.push(["score"]),
		setSuccess: () => calls.push(["success"]),
		trackObjective: () => calls.push(["objective"]),
		suppressTerminationResult: () => calls.push(["suppress"]),
		terminate: (explicitFinish?: boolean) => {
			calls.push(["terminate", explicitFinish]);
			return false;
		},
	};
	expect(writeCourseOutcome(runtime, { kind: "waiting" })).toBe(true);
	expect(calls).toEqual([["policy", { waiting: true }]]);
	calls.length = 0;
	expect(writeCourseOutcome(runtime, { kind: "waiting", finish: "terminate" })).toBe(false);
	expect(calls).toEqual([["policy", { waiting: true }], ["suppress"], ["terminate", false]]);
});

it("xAPI consumes a suppressed result even when termination is already uninitialized", () => {
	const { runtime, writes, outcomes } = launch("xapi");
	expect(runtime.terminate()).toBe(true);
	runtime.suppressTerminationResult?.();
	expect(runtime.terminate()).toBe(false);
	expect(runtime.initialize()).toBe(true);
	writes.length = 0;
	expect(runtime.terminate()).toBe(true);
	expect(outcomes()).toHaveLength(1);
});

for (const format of ["standalone", "scorm2004"] as const)
	it.each(["question", "group", "invalid facts"] as const)(
		`standalone quiz policy through ${format} host waits on historical %s outside pass-mark IDs`,
		(kind) => {
			const { runtime, dom, writes, outcomes } = launch(format);
			runtime.trackInteraction("q", "a", true, 100);
			runtime.trackInteraction("x", "a", false, 0);
			const page = {
				version: 1,
				courseId: "course",
				pageId: "one",
				pageTitle: "One",
				currentPage: 1,
				totalPages: 1,
				currentSlug: "one",
				availableSlugs: ["one"],
				pageIdMap: { one: "one" },
				completionMethod: "quiz",
				passMark: 80,
				scoredAssessmentIds: ["q"],
				pageRole: "content",
				strings: {},
			};
			dom.window.document.body.innerHTML += `<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
			Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
			const environment = {
				win: dom.window as unknown as Window,
				doc: dom.window.document,
				location: { href: dom.window.location.href, search: "", replace() {} },
				history: dom.window.history,
			};
			const installed =
				format === "standalone"
					? initializeCourseHost({ format, createRuntime: () => runtime }, environment)
					: initializeScormCourseHost(
							{ format, createRuntime: () => runtime, readEntry: () => null },
							environment,
						);
			expect(installed).toBe(true);
			const config: TrackingConfig = {
				totalPages: 1,
				completionMethod: "quiz",
				passMark: 80,
				scoredAssessmentIds: ["q"],
				reportOutcome: false,
			};
			new CourseTracker(runtime, config).checkCompletion();
			runtime.commit();
			expect(runtime.getCompletion()).toBe(format === "standalone" ? "failed" : "completed");
			if (format === "scorm2004") expect(runtime.getSuccess?.()).toBe("failed");
			config.getChoiceDependencyView = () =>
				withChoiceDependencyStatus({
					rows: runtime
						.getInteractions()
						.map((row) =>
							row.id !== "x"
								? row
								: kind === "group"
									? { ...row, memberIds: ["a"] }
									: { ...row, choiceEvidenceInvalid: true },
						),
					questions: kind === "question" ? { x: question } : {},
					signatures: kind === "question" ? { x: signature } : {},
					groups:
						kind === "group"
							? { x: { mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] } }
							: {},
					invalidIds: kind === "invalid facts" ? ["x"] : [],
					readState: () => ({
						version: 1,
						kind: "assessmentGroup",
						mode: "oneOf",
						selectedMemberId: "b",
						completed: false,
					}),
				});
			const tracker = new CourseTracker(runtime, config);
			expect(config.getChoiceDependencyView()?.status("x")).toBe("history");
			Object.assign(environment.win.__praxityTracker!, {
				prepareCommit: () => tracker.prepareCommit(),
			});
			Object.assign(environment.win, { __praxityTracker: tracker });
			writes.length = 0;
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", {
					detail: { blockId: "q", responseText: "a", correct: true, score: 100, maxScore: 100 },
				}),
			);
			expect(outcomes()).toEqual([]);
			expect(runtime.getCompletion()).toBe(format === "standalone" ? "failed" : "completed");
			if (format === "scorm2004") expect(runtime.getSuccess?.()).toBe("failed");
			for (const intent of ["check", "score", "display", "prepareCommit", "end", "finish"] as const)
				expect(tracker.outcome(intent).kind).toBe("waiting");
		},
	);

it("authored quiz reporting does not wait on optional history outside its score set", () => {
	const { runtime } = launch("scorm2004");
	runtime.trackInteraction("q", "a", true, 100);
	runtime.trackInteraction("x", "a", false, 0);
	const tracker = new CourseTracker(runtime, {
		totalPages: 1,
		completionMethod: "quiz",
		passMark: 80,
		scoredAssessmentIds: ["q"],
		getChoiceDependencyView: () =>
			withChoiceDependencyStatus({
				rows: runtime.getInteractions(),
				questions: { x: question },
				signatures: { x: signature },
				invalidIds: ["x"],
				readState: () => undefined,
			}),
	});
	expect(tracker.outcome().kind).toBe("decided");
});
