import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime, type XapiStatement } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

const documents: JSDOM[] = [];
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
	const get = (key: string) => (key === "cmi.objectives._count" ? "0" : (values[key] ?? ""));
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

it.each(["scorm12", "scorm2004", "xapi"] as const)(
	"%s quiz arithmetic retains an unscored history row",
	(format) => {
		const { runtime } = launch(format);
		runtime.trackInteraction("q", "answer", false);
		runtime.trackInteraction("other", "answer", true, 100);
		const config: TrackingConfig = { totalPages: 1, completionMethod: "quiz" };
		expect(new CourseTracker(runtime, config).outcome("score")).toEqual({
			score: 100,
		});
		config.getChoiceDependencyView = () =>
			withChoiceDependencyStatus({
				rows: runtime
					.getInteractions()
					.map((row) => (row.id === "q" ? { ...row, choiceEvidenceInvalid: true } : row)),
				questions: {},
				signatures: {},
				readState: () => undefined,
			});
		expect(new CourseTracker(runtime, config).outcome("score")).toEqual({
			score: 100,
		});
	},
);

it("quiz retains main's unscored historical retry state", () => {
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
		result: { score: 50, passed: false, retryable: true },
		completion: "incomplete",
	});
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

it.each(["scorm12", "scorm2004", "xapi", "standalone"] as const)(
	"%s reports the saved verdict even when its choice evidence is history",
	(format) => {
		const { runtime, values } = launch(format);
		runtime.trackInteraction("q", "answer", true, 100);
		const view = () =>
			withChoiceDependencyStatus({
				rows: runtime.getInteractions(),
				questions: {},
				signatures: {},
				invalidIds: ["q"],
				readState: () => undefined,
			});
		expect(view().status("q")).toBe("history");
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			getChoiceDependencyView: view,
		});
		tracker.trackInteraction("other", "answer", false, 0);
		expect(tracker.outcome()).toMatchObject({
			result: { score: 50, passed: false },
			completion: "failed",
		});
		expect(runtime.getScore()?.raw).toBe(50);
		expect(runtime.getCompletion()).toBe(format === "scorm2004" ? "completed" : "failed");
		if (format === "scorm2004") expect(runtime.getSuccess?.()).toBe("failed");
		tracker.trackGroupObjective("g", 50, false);
		if (format === "scorm12" || format === "scorm2004") {
			expect(values["cmi.objectives.0.id"]).toBe("g");
			expect(
				values[
					format === "scorm12" ? "cmi.objectives.0.status" : "cmi.objectives.0.success_status"
				],
			).toBe("failed");
		}
	},
);
