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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const submitted = {
	payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
	contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
};
const old = {
	payload: {
		mode: "all",
		selectedMemberId: null,
		dependencies: [["a", `sha256:${"b".repeat(64)}`]],
	},
	contentSignature: "sha256:855046ca0ab3006f658988e444dc7e03da69af411410c1947d688ffe7dc8b3b8",
};
const groupState = {
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
} as const;

function launch(format: "scorm12" | "scorm2004", evidence: boolean) {
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
	const get = (key: string) => values.get(key) ?? "";
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
			groups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
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

function submit(contentSignature = submitted.contentSignature) {
	document.dispatchEvent(
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
			},
		}),
	);
}

for (const format of ["scorm12", "scorm2004"] as const) {
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
		// The installed tracker deliberately sees the previous aggregate as history.
		window.__praxityTracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			requiredAssessmentIds: ["g"],
			passMark: 80,
			scoredAssessmentIds: ["g"],
			getChoiceDependencyView: view,
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
	for (const violation of ["digest", "member"] as const) {
		it(`${format} refuses a candidate with an invalid ${violation} before any write`, () => {
			const { writes, invalidate } = launch(format, true);
			if (violation === "member") invalidate();
			submit(violation === "digest" ? `sha256:${"f".repeat(64)}` : submitted.contentSignature);
			expect(writes).toEqual([]);
		});
	}
}

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
