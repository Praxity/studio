import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { withLearnerStateAuthority } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const changed = "sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702";
const groupSignature = "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2";
const submission = () => ({
	payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
	contentSignature: groupSignature,
});
const groupState = () => ({
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
	submitted: submission(),
});
const answer = (contentSignature = signature) => ({
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
	materialProof: { optionIds: ["a", "b"] },
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

function launch(format: "scorm12" | "scorm2004") {
	const dom = new JSDOM("", { url: "https://course.example/one.html" });
	documents.push(dom);
	vi.stubGlobal("window", dom.window);
	const values = new Map<string, string>();
	const writes: string[][] = [];
	let refuseState = false;
	const set = (key: string, value: string) => {
		if (key === "cmi.suspend_data" && refuseState) return "false";
		values.set(key, value);
		writes.push([key, value]);
		return "true";
	};
	const get = (key: string) => values.get(key) ?? "";
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
	const open = () => {
		const runtime =
			format === "scorm12"
				? new Scorm12Runtime()
				: new Scorm2004Runtime(dom.window as unknown as Window);
		expect(runtime.initialize()).toBe(true);
		return runtime;
	};
	let runtime = open();
	let provider = createBlockStateRuntime(runtime);
	// Only the evidence view is injected. Storage and reporting use the real adapters.
	const evidence = () =>
		withChoiceDependencyStatus({
			rows: runtime.getInteractions().map((row) => ({
				...row,
				...(row.id === "q" ? { contentSignature: signature } : {}),
				...(row.id === "g" ? { contentSignature: groupSignature } : {}),
			})),
			questions: { q: question },
			signatures: { q: signature },
			groups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
			readState: (id) => provider.get(id),
		});
	const config = () =>
		({
			totalPages: 2,
			completionMethod: "allPages",
			requiredAssessmentIds: ["q"],
			getChoiceDependencyView: evidence,
			groupObjectiveState: provider,
		}) as TrackingConfig;
	let tracker = new CourseTracker(runtime, config());
	const objectives = () => writes.filter(([key]) => key.startsWith("cmi.objectives."));
	const stored = () =>
		provider.get("g") as ReturnType<typeof groupState> & {
			submitted: ReturnType<typeof submission> & {
				deferredObjective?: { id: string; score: number; passed: boolean };
			};
		};
	return {
		dom,
		values,
		writes,
		evidence,
		objectives,
		stored,
		get runtime() {
			return runtime;
		},
		get provider() {
			return provider;
		},
		get tracker() {
			return tracker;
		},
		config,
		refuse(value: boolean) {
			refuseState = value;
		},
		seed() {
			provider.set("q", answer(changed));
			provider.set("g", groupState() as LearnerStateValue);
			runtime.trackInteraction("a", "answer", true, 100);
			runtime.trackInteraction("q", "a", true, 100);
		},
		submit(score = 100, passed = true) {
			tracker.trackGroupObjective("g", score, passed);
			tracker.trackInteraction("g", `${score}%`, passed, score);
			expect(runtime.commit()).toBe(true);
		},
		repair() {
			provider.set("q", answer());
			tracker.trackInteraction("q", "a", true, 100);
		},
		replace(reopen: boolean) {
			if (reopen) runtime = open();
			provider = createBlockStateRuntime(runtime);
			tracker = new CourseTracker(runtime, config());
		},
	};
}

describe.each(["scorm12", "scorm2004"] as const)("%s deferred group objectives", (format) => {
	it("characterization: ordinary objectives stay first and save no obligation", () => {
		const host = launch(format);
		host.seed();
		const tracker = new CourseTracker(host.runtime, {
			totalPages: 2,
			completionMethod: "allPages",
		});
		host.writes.length = 0;
		tracker.trackGroupObjective("g", 100, true);
		expect(host.writes).toEqual([
			["cmi.objectives.0.id", "g"],
			["cmi.objectives.0.score.raw", "100"],
			[`cmi.objectives.0.${format === "scorm12" ? "status" : "success_status"}`, "passed"],
		]);
		expect(host.stored()).toEqual(groupState());
	});

	for (const replace of ["same tracker", "new tracker", "reopened adapter"] as const)
		it(`replays g=100/passed once through ${replace}`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			expect(host.objectives()).toEqual([]);
			if (replace !== "same tracker") host.replace(replace === "reopened adapter");
			host.repair();
			host.tracker.checkCompletion();
			host.tracker.prepareCommit();
			expect(host.objectives()).toEqual([
				["cmi.objectives.0.id", "g"],
				["cmi.objectives.0.score.raw", "100"],
				[`cmi.objectives.0.${format === "scorm12" ? "status" : "success_status"}`, "passed"],
			]);
			expect(host.stored()).toEqual(groupState());
			host.replace(true);
			host.tracker.checkCompletion();
			expect(host.objectives()).toHaveLength(3);
		});

	it("stores only an obligation identity and values beside submitted evidence", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const record = host.stored().submitted.deferredObjective;
		expect(record).toEqual({ id: expect.any(String), score: 100, passed: true });
		expect(record?.id).not.toBe("");
		expect(host.stored().submitted.payload).toEqual(submission().payload);
	});

	it("a superseding submission cannot replay an older objective", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("g", groupState() as LearnerStateValue);
		host.replace(true);
		host.repair();
		expect(host.objectives()).toEqual([]);
	});

	it("a stale group cannot replay even when it is outside the course wait set", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("g", { ...host.stored(), mode: "oneOf", selectedMemberId: "a" });
		expect(host.evidence().status("g")).toBe("history");
		host.replace(true);
		host.repair();
		expect(host.objectives()).toEqual([]);
	});

	it("refused persistence retains the previous evidence and obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const before = host.runtime.getSuspendData();
		host.refuse(true);
		host.tracker.trackGroupObjective("g", 0, false);
		expect(host.runtime.getSuspendData()).toBe(before);
		host.refuse(false);
		host.replace(true);
		host.repair();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
	});

	it("an unacknowledged authority write keeps the obligation for a successor", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const tracker = new CourseTracker(
			withLearnerStateAuthority(host.runtime, () => false),
			{
				...host.config(),
				groupObjectiveState: withLearnerStateAuthority(host.provider, () => false),
			} as TrackingConfig,
		);
		host.provider.set("q", answer());
		tracker.checkCompletion();
		expect(host.objectives()).toEqual([]);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
	});
});
