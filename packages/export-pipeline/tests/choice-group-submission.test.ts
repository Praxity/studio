import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import {
	type ChoiceDependencyEvidence,
	choiceDependencyStatus,
} from "../../shared-blocks/src/choice-learner-state";
import type { LearnerBlockStateRuntime } from "../../shared-blocks/src/learner-block-state";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { initializeCourseHost } from "../template/src/hosts/course-host";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const submitted = {
	payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
	contentSignature: "s96:_0j2FBczKQd6abp2",
};
const old = {
	payload: {
		mode: "all",
		selectedMemberId: null,
		dependencies: [["a", "s96:u7u7u7u7u7u7u7u7"]],
	},
	contentSignature: "s96:y8WPEeiHKtdqKWuB",
};
const groupState = {
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
} as const;

function launch(
	format: "scorm12" | "scorm2004",
	evidence: boolean,
	groups: ChoiceDependencyEvidence["groups"] = {
		g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
	},
) {
	const dom = new JSDOM("", { url: "https://course.example/practice.html" });
	documents.push(dom);
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("document", dom.window.document);
	vi.stubGlobal("localStorage", dom.window.localStorage);
	const errors: string[] = [];
	window.addEventListener("error", (event) => {
		errors.push(event.message);
		event.preventDefault();
	});
	const values = new Map<string, string>();
	const writes: string[][] = [];
	const order: string[] = [];
	let refuse = false;
	const get = (key: string) =>
		key === "cmi.objectives._count"
			? String([...values.keys()].filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key)).length)
			: (values.get(key) ?? "");
	const set = (key: string, value: string) => {
		writes.push([key, value]);
		if (key === "cmi.suspend_data") {
			order.push("save");
			if (refuse) return "false";
		}
		values.set(key, value);
		return "true";
	};
	Object.assign(window, {
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
	const makeRuntime = () =>
		format === "scorm12" ? new Scorm12Runtime("course") : new Scorm2004Runtime(window);
	const runtime = makeRuntime();
	runtime.initialize();
	const seed = createBlockStateRuntime(runtime);
	seed.set("g", { ...groupState, submitted: old });
	runtime.trackInteraction("g", "0%", false, 0, { memberIds: ["a"] });
	let provider: LearnerBlockStateRuntime;
	let invalid = false;
	const view = (): ChoiceDependencyEvidence =>
		withChoiceDependencyStatus({
			questions: {},
			signatures: {},
			groups,
			invalidIds: invalid ? ["a"] : [],
			rows: runtime.getInteractions(),
			readState: (id) => provider.get(id),
		});
	Object.defineProperty(window, "__praxityBlockState", {
		configurable: true,
		get: () => provider,
		set: (value) => {
			provider = value;
			if (evidence) Object.assign(provider, { getChoiceDependencyView: view });
		},
	});
	document.body.innerHTML = `<main></main><script id="praxity-host-config" type="application/json">${JSON.stringify({ version: 1, courseId: "course", pageId: "page", pageTitle: "Practice", currentPage: 1, totalPages: 1, currentSlug: "practice", availableSlugs: ["practice"], pageIdMap: { page: "practice" }, completionMethod: "allPages", pageRole: "content", strings: {}, passMark: 80, scoredAssessmentIds: ["g"], requiredAssessmentIds: ["g"] })}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
	Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
	expect(initializeCourseHost({ format, createRuntime: () => runtime })).toBe(true);
	const objective = runtime.trackObjective.bind(runtime);
	vi.spyOn(runtime, "trackObjective").mockImplementation((...args) => {
		order.push("objective");
		return objective(...args);
	});
	const interaction = runtime.trackInteraction.bind(runtime);
	vi.spyOn(runtime, "trackInteraction").mockImplementation((...args) => {
		order.push("interaction");
		return interaction(...args);
	});
	vi.spyOn(runtime, "setScore");
	vi.spyOn(runtime, "setCompletion");
	order.length = 0;
	writes.length = 0;
	return {
		runtime,
		makeRuntime,
		view,
		writes,
		order,
		values,
		errors,
		provider: window.__praxityBlockState as LearnerBlockStateRuntime,
		refuse: () => {
			refuse = true;
		},
		invalidate: () => {
			invalid = true;
		},
	};
}

function submit(
	contentSignature = submitted.contentSignature,
	detail: Record<string, unknown> = {},
) {
	return document.dispatchEvent(
		new window.CustomEvent("praxity:assessment-group-complete", {
			detail: {
				groupId: "g",
				score: 100,
				passed: true,
				correct: true,
				completed: true,
				memberIds: ["a"],
				selectedMemberId: null,
				contentSignature,
				...detail,
			},
			cancelable: true,
		}),
	);
}

for (const format of ["scorm12", "scorm2004"] as const) {
	it(`${format} verifies a oneOf candidate selecting the second member`, () => {
		const { provider, runtime, order } = launch(format, true, {
			g: { mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
		});
		const captured = {
			payload: { mode: "oneOf", selectedMemberId: "b", dependencies: [["b", null]] },
			contentSignature: "s96:gWS7c7A-PLTQRw-K",
		};
		if (provider.stageSubmission)
			expect(
				provider.stageSubmission("g", () => {
					provider.set("g", {
						...groupState,
						mode: "oneOf",
						selectedMemberId: "b",
						submitted: captured,
					});
					return true;
				}),
			).toBe(true);
		submit(captured.contentSignature, { selectedMemberId: "b", memberIds: ["b"] });
		expect(order.slice(0, 3)).toEqual(["objective", "interaction", "save"]);
		expect(runtime.trackObjective).toHaveBeenCalledExactlyOnceWith("g", 100, true);
		expect(runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 100 });
	});
	it(`${format} keeps the ordinary write log for a group absent from the view`, () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const ordinary = launch(format, false);
		submit();
		const unlisted = launch(format, true, {});
		submit();
		expect(unlisted.order).toEqual(ordinary.order);
		expect(unlisted.order.slice(0, 3)).toEqual(["objective", "interaction", "save"]);
		expect(unlisted.writes).toEqual(ordinary.writes);
	});
	it(`${format} without a view preserves objective, interaction, save order and receipt capability`, () => {
		const { provider, order, writes } = launch(format, false);
		submit();
		expect(order.slice(0, 3)).toEqual(["objective", "interaction", "save"]);
		expect(provider.getChoiceDependencyView).toBeUndefined();
		expect(writes.slice(0, 3)).toEqual([
			["cmi.objectives.0.id", "g"],
			["cmi.objectives.0.score.raw", "100"],
			[`cmi.objectives.0.${format === "scorm12" ? "status" : "success_status"}`, "passed"],
		]);
		if (format === "scorm2004") expect(provider.getSaveResult).toBeUndefined();
	});
	it(`${format} verifies the candidate against repaired members before objective-first reporting`, () => {
		const { provider, runtime, view, order } = launch(format, true);
		// The previous aggregate remains history while the host verifies its replacement.
		window.__praxityTracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			requiredAssessmentIds: ["g"],
			passMark: 80,
			scoredAssessmentIds: ["g"],
		});
		expect(choiceDependencyStatus("g", view())).toBe("history");
		if (provider.stageSubmission)
			expect(
				provider.stageSubmission("g", () => {
					provider.set("g", { ...groupState, submitted });
					return true;
				}),
			).toBe(true);
		submit();
		expect(order.slice(0, 3)).toEqual(["objective", "interaction", "save"]);
		expect(runtime.trackObjective).toHaveBeenCalledExactlyOnceWith("g", 100, true);
		expect(runtime.setScore).toHaveBeenCalledWith(100, 0, 100);
		expect(runtime.setCompletion).toHaveBeenCalledWith(
			format === "scorm12" ? "passed" : "completed",
		);
		expect(runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 100 });
	});
	for (const violation of ["digest", "member", "capability"] as const) {
		it(`${format} refuses a candidate with an invalid ${violation} before any write`, () => {
			const { writes, invalidate, provider, view } = launch(format, true);
			if (violation === "member") invalidate();
			if (violation === "capability")
				Object.assign(provider, {
					getChoiceDependencyView: () => ({ ...view(), verifyGroupSubmission: undefined }),
				});
			submit(violation === "digest" ? `sha256:${"f".repeat(64)}` : submitted.contentSignature);
			expect(writes).toEqual([]);
		});
	}
}

it("a rejected staged group releases the SCORM 1.2 runtime for later saves", () => {
	const { provider, runtime, writes, values, errors } = launch("scorm12", true);
	const previous = provider.get("g");
	expect(
		provider.stageSubmission?.("g", () => {
			provider.set("g", { ...groupState, submitted });
			return true;
		}),
	).toBe(true);
	const accepted = submit(`sha256:${"f".repeat(64)}`);
	expect(provider.getSaveResult?.("g")).toEqual({
		status: "not-saved",
		code: "runtime-write-failed",
	});
	expect(provider.get("g")).toEqual(previous);
	expect(accepted).toBe(false);
	expect(writes).toEqual([]);
	runtime.trackPageVisit("next");
	expect(writes.some(([key]) => key === "cmi.suspend_data")).toBe(true);
	expect(values.get("cmi.suspend_data")).toContain('"next"');
	expect(() => runtime.trackInteraction("q2", "answer")).not.toThrow();
	expect(() => provider.stageSubmission?.("g", () => false)).not.toThrow();
	expect(errors).toEqual([]);
});

it("rejecting a different group leaves the active SCORM 1.2 submission intact", () => {
	const { provider, runtime } = launch("scorm12", true);
	expect(
		provider.stageSubmission?.("q2", () => {
			provider.set("q2", { answer: "kept" });
			return true;
		}),
	).toBe(true);
	submit(`sha256:${"f".repeat(64)}`);
	expect(provider.getSaveResult?.("q2")).toEqual({ status: "pending" });
	expect(provider.get("q2")).toEqual({ answer: "kept" });
	expect(() => runtime.trackInteraction("q2", "answer")).not.toThrow();
	expect(provider.get("q2")).toEqual({ answer: "kept" });
	expect(provider.getSaveResult?.("q2")).toMatchObject({ status: "saved" });
});

it("SCORM 1.2 refused staged submission retains main's objective gap and rolls back answer and row", () => {
	const { provider, runtime, makeRuntime, values, order, refuse, errors } = launch("scorm12", true);
	const previous = values.get("cmi.suspend_data");
	const previousState = provider.get("g");
	const previousRows = runtime.getInteractions();
	expect(
		provider.stageSubmission?.("g", () => {
			provider.set("g", { ...groupState, submitted });
			return true;
		}),
	).toBe(true);
	refuse();
	submit();
	expect(errors).toEqual([]);
	expect(order.slice(0, 3)).toEqual(["objective", "interaction", "save"]);
	expect(provider.getSaveResult?.("g")).toEqual({
		status: "not-saved",
		code: "runtime-write-failed",
	});
	expect(values.get("cmi.suspend_data")).toBe(previous);
	expect(provider.get("g")).toEqual(previousState);
	expect(runtime.getInteractions()).toEqual(previousRows);
	const reload = makeRuntime();
	reload.initialize();
	expect(createBlockStateRuntime(reload).get("g")).toEqual(previousState);
	expect(reload.getInteractions()).toEqual(previousRows);
});

it("without a view preserves the refused-save exception and objective-first gap", () => {
	const { order, refuse, errors } = launch("scorm12", false);
	refuse();
	submit();
	expect(order.slice(0, 3)).toEqual(["objective", "interaction", "save"]);
	expect(errors).toEqual(["ESCORM12STORAGE"]);
});

it("candidate verification does not swallow an unrelated interaction error", () => {
	const { runtime, errors } = launch("scorm12", true);
	vi.mocked(runtime.trackInteraction).mockImplementationOnce(() => {
		throw Error("EOTHER");
	});
	submit();
	expect(errors).toEqual(["EOTHER"]);
});

it("ordinary non-staging local storage retains an undefined receipt capability", () => {
	const dom = new JSDOM("", { url: "https://course.example" });
	documents.push(dom);
	const runtime = new LocalStorageRuntime(dom.window.localStorage, "course");
	runtime.initialize();
	const provider = createBlockStateRuntime(runtime);
	provider.set("g", groupState);
	expect(provider.stageSubmission).toBeUndefined();
	expect(provider.getSaveResult).toBeUndefined();
});
