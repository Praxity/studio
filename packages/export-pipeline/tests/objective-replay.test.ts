import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { writeLearnerBlockState } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import {
	prepareGroupObjectiveSave,
	readDeferredGroupObjective,
} from "@praxity/shared-blocks/learner-state";
import { dispatchSelfCheckEvent } from "@praxity/shared-blocks/self-check-consumers";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { getSessionState, resetSessionState } from "../src/scorm/api/session";
import * as tracking from "../src/scorm/tracking";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import {
	initializeScormCourseHost,
	readCourseDeploymentConfig,
} from "../template/src/hosts/course-host";
import { selfCheckDocument } from "../template/src/self-check-document";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

// Select the dormant evidence metadata reader only in this injected adapter suite.
vi.mock("../src/scorm/types", async (original) => {
	const types = await original<typeof import("../src/scorm/types")>();
	return { ...types, assessmentAttemptMetadata: types.assessmentEvidenceMetadata };
});

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
	vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
	const values = new Map<string, string>();
	const writes: string[][] = [];
	let refuseState = false;
	let refuseCommit = false;
	const committed = new Map<string, string>();
	const commit = () => {
		writes.push(["commit", refuseCommit ? "false" : "true"]);
		if (refuseCommit) return "false";
		committed.clear();
		for (const [key, value] of values) committed.set(key, value);
		return "true";
	};
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
			LMSCommit: commit,
			LMSGetValue: get,
			LMSSetValue: set,
			LMSGetLastError: () => "0",
			LMSGetErrorString: () => "",
			LMSGetDiagnostic: () => "",
		},
		API_1484_11: {
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: commit,
			GetValue: get,
			SetValue: set,
			GetLastError: () => "0",
			GetErrorString: () => "",
			GetDiagnostic: () => "",
		},
	});
	const ledger = () =>
		getSessionState(
			(dom.window as unknown as { API: object; API_1484_11: object })[
				format === "scorm12" ? "API" : "API_1484_11"
			],
		);
	const open = (): SCORMRuntime => {
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
				// Ordinary hosts leave signed row selection dormant until activation.
				...(row.id === "g" && row.contentSignature === undefined
					? { contentSignature: groupSignature }
					: {}),
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
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
				...([provider, () => current, ledger() ?? {}] as Parameters<
					typeof tracking.createDeferredGroupObjectiveWriter
				>),
			),
		}) as TrackingConfig;
	let current = true;
	let tracker = new CourseTracker(runtime, config());
	const objectives = () =>
		writes.filter(([key]) => key.startsWith("cmi.objectives.") || key.startsWith("objective."));
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
		revoke() {
			current = false;
		},
		ledger,
		replaceTracker() {
			tracker = new CourseTracker(runtime, config());
		},
		saveGroup(value: LearnerStateValue = groupState() as LearnerStateValue) {
			Object.assign(dom.window, { __praxityBlockState: provider });
			return writeLearnerBlockState("g", value, () => true, dom.window.document);
		},
		committed,
		refuseCommit(value: boolean) {
			refuseCommit = value;
		},
		crash() {
			values.clear();
			for (const [key, value] of committed) values.set(key, value);
			this.replace(true);
		},
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
			const report = () => {
				tracker.trackGroupObjective("g", score, passed, runtime, undefined, groupSignature);
				runtime.trackInteraction("g", `${score}%`, passed, score, {
					contentSignature: groupSignature,
					memberIds: ["a"],
				});
				return true;
			};
			const save = () => {
				Object.assign(dom.window, { __praxityBlockState: provider });
				return writeLearnerBlockState("g", groupState(), () => true, dom.window.document);
			};
			if (provider.stageSubmission) {
				expect(provider.stageSubmission("g", () => save() && report())).toBe(true);
			} else {
				report();
				save();
			}
			runtime.commit();
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

const objectiveValues = (host: ReturnType<typeof launch>) =>
	host.objectives().map(([, value]) => value);
const pending = (host: ReturnType<typeof launch>) =>
	readDeferredGroupObjective(host.provider.get("g"));

describe.each(["scorm12", "scorm2004"] as const)("%s confirmed objective replay", (format) => {
	it("1: capture, post-save Commit and two waiting reloads preserve the frozen objective", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const record = pending(host);
		expect(record).toMatchObject({ score: 100, passed: true });
		host.writes.length = 0;
		for (let i = 0; i < 2; i++) {
			host.replace(true);
			host.tracker.checkCompletion();
		}
		expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
		expect(objectiveValues(host)).toEqual([]);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toBeUndefined();
		host.tracker.checkCompletion();
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("2: refused clear, preparation, tracker replacement and adapter reopening invoke once", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
		host.tracker.checkCompletion();
		host.tracker.prepareCommit();
		host.replaceTracker();
		for (let i = 0; i < 2; i++) {
			host.replace(true);
			host.tracker.checkCompletion();
		}
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		host.tracker.checkCompletion();
		expect(pending(host)).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("P1-1: a decided submission during confirmation acknowledges the superseded UUID", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		const nested = vi.fn(() =>
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		);
		let armed = true;
		host.runtime.setCommitPreparation?.(() => {
			if (armed) {
				armed = false;
				expect(nested()).toBe(true);
			}
		});
		host.tracker.checkCompletion();
		expect(nested).toHaveBeenCalledTimes(1);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		host.refuse(false);
		host.tracker.checkCompletion();
		expect(pending(host)).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("P1-2: rows appended during confirmation require a fresh evidence view", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		expect(host.evidence().status("g")).toBe("current");
		let armed = true;
		const append = vi.fn(() =>
			host.runtime.trackInteraction("g", "0%", false, 0, {
				contentSignature: changed,
				memberIds: ["a"],
			}),
		);
		host.runtime.setCommitPreparation?.(() => {
			if (armed) {
				armed = false;
				append();
			}
		});
		host.tracker.checkCompletion();
		expect(append).toHaveBeenCalledTimes(1);
		expect(host.evidence().status("g")).toBe("history");
		expect(objectiveValues(host)).toEqual([]);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
	});

	for (const when of ["preparation", "native Commit"] as const)
		it(`18: ${when} changing required material leaves all outcome writes waiting`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.provider.set("q", answer());
			const change = vi.fn(() => host.provider.set("q", answer(changed)));
			if (when === "preparation") host.runtime.setCommitPreparation?.(change);
			else {
				const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
				const method = format === "scorm12" ? "LMSCommit" : "Commit";
				const commit = api[method].bind(api);
				api[method] = () => {
					change();
					return commit();
				};
			}
			host.writes.length = 0;
			host.tracker.checkCompletion();
			expect(change).toHaveBeenCalledTimes(1);
			expect(host.evidence().status("q")).toBe("history");
			expect(objectiveValues(host)).toEqual([]);
			expect(
				host.writes.filter(([key]) =>
					/(?:lesson_status|completion_status|success_status|score\.)/.test(key),
				),
			).toEqual([]);
			expect(pending(host)).toMatchObject({ score: 100, passed: true });
		});

	it("18: revoked confirmation releases the claim for a newly admitted writer", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const revoke = vi.fn(host.revoke);
		host.runtime.setCommitPreparation?.(revoke);
		host.tracker.checkCompletion();
		expect(revoke).toHaveBeenCalledTimes(1);
		expect(objectiveValues(host)).toEqual([]);
		host.runtime.setCommitPreparation?.(() => {});
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
				host.provider,
				() => true,
				host.ledger() ?? {},
			),
		});
		tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("18: a replacement capture in confirmation cannot replay the old record", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let armed = true;
		host.runtime.setCommitPreparation?.(() => {
			if (!armed) return;
			armed = false;
			host.provider.set("q", answer(changed));
			host.submit(0, false);
			host.provider.set("q", answer());
		});
		host.tracker.checkCompletion();
		expect(armed).toBe(false);
		expect(objectiveValues(host)).toEqual([]);
		expect(pending(host)).toMatchObject({ score: 0, passed: false });
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("fresh evidence construction cannot replace the confirmed capture behind the claim", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let reads = 0;
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			getChoiceDependencyView: () => {
				if (++reads === 2) {
					host.provider.set("q", answer(changed));
					host.submit(0, false);
					host.provider.set("q", answer());
				}
				return host.evidence();
			},
		});
		tracker.checkCompletion();
		expect(reads).toBe(2);
		expect(objectiveValues(host)).toEqual([]);
		expect(pending(host)).toMatchObject({ score: 0, passed: false });
		tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("revocation from an objective callback leaves its claim retryable", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
		const set = api[method].bind(api);
		let armed = true;
		api[method] = (key: string, value: string) => {
			const result = set(key, value);
			if (armed && key.startsWith("cmi.objectives.")) {
				armed = false;
				host.revoke();
			}
			return result;
		};
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
		new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
				host.provider,
				() => true,
				host.ledger() ?? {},
			),
		}).checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "100", "passed"]);
	});

	it("6: a decided candidate cannot replay unsaved ordinary history", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const candidate = withChoiceDependencyStatus({
			...host.evidence(),
			readState: (id) => (id === "q" ? answer() : host.provider.get(id)),
		});
		expect(candidate.status("q")).toBe("current");
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, candidate, groupSignature),
		).toBe(true);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("a writer without a fresh evidence owner cannot confirm a saved record", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const writer = tracking.createDeferredGroupObjectiveWriter?.(
			host.provider,
			() => true,
			host.ledger() ?? {},
		);
		host.writes.length = 0;
		let result: boolean | undefined;
		expect(() => {
			result = writer?.(host.runtime, { kind: "decided" }, host.evidence());
		}).not.toThrow();
		expect(result).toBe(true);
		expect(host.writes).toEqual([]);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
	});

	it("clear preserves a successor saved during its failed removal Commit", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
		const method = format === "scorm12" ? "LMSCommit" : "Commit";
		const commit = api[method].bind(api);
		let armed = true;
		api[method] = () => {
			if (armed && objectiveValues(host).length > 0 && !pending(host)) {
				armed = false;
				host.provider.set("q", answer(changed));
				host.submit(0, false);
				return "false";
			}
			return commit();
		};
		host.tracker.checkCompletion();
		expect(armed).toBe(false);
		expect(pending(host)).toMatchObject({ score: 0, passed: false });
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});

	it("an ordinary stale draft cannot reinstall an objective cleared by a callback", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const stale = host.provider.get("g") as LearnerStateValue;
		host.provider.set("q", answer());
		host.tracker.checkCompletion();
		expect(pending(host)).toBeUndefined();
		expect(host.saveGroup(stale)).toBe(true);
		expect(pending(host)).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("7c carry: a stale captured draft preserves the reentrant successor record", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const stale = host.provider.get("g") as LearnerStateValue;
		const get = host.provider.get.bind(host.provider);
		let armed = true;
		vi.spyOn(host.provider, "get").mockImplementation((id) => {
			if (id === "g" && armed) {
				armed = false;
				host.submit(0, false);
			}
			return get(id);
		});
		expect(host.saveGroup(stale)).toBe(true);
		expect(pending(host)).toMatchObject({ score: 0, passed: false });
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	for (const when of ["receipt", "state", "Commit", "readback"] as const)
		it(`confirmation rechecks authority after ${when}`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			let current = true;
			const read = when === "Commit" ? vi.spyOn(host.provider, "get") : undefined;
			if (when === "receipt") {
				const result = host.provider.getSaveResult?.bind(host.provider);
				host.provider.getSaveResult = (id) => {
					current = false;
					return result?.(id);
				};
			} else if (when === "state" || when === "readback") {
				const get = host.provider.get.bind(host.provider);
				let count = 0;
				vi.spyOn(host.provider, "get").mockImplementation((id) => {
					const value = get(id);
					if (++count === (when === "state" ? 1 : 2)) current = false;
					return value;
				});
			} else
				host.runtime.setCommitPreparation?.(() => {
					current = false;
				});
			host.writes.length = 0;
			expect(
				host.provider.confirmGroupObjective?.(
					"g",
					() => true,
					() => current,
				),
			).toBe(false);
			expect(current).toBe(false);
			if (when === "Commit") expect(read).toHaveBeenCalledTimes(1);
			if (when === "receipt" || when === "state") expect(host.writes).toEqual([]);
		});

	it("P3-1: non-current records do not confirm on decided checks", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.trackInteraction("g", "0%", false, 0, {
			contentSignature: changed,
			memberIds: ["a"],
		});
		host.writes.length = 0;
		for (let i = 0; i < 5; i++) host.tracker.checkCompletion();
		expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
		expect(objectiveValues(host)).toEqual([]);
		host.runtime.trackInteraction("g", "100%", true, 100, {
			contentSignature: groupSignature,
			memberIds: ["a"],
		});
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("confirmation refuses an unmatched identity and revoked authority without Commit", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.writes.length = 0;
		expect(
			host.provider.confirmGroupObjective?.(
				"g",
				() => false,
				() => true,
			),
		).toBe(false);
		const matches = vi.fn(() => true);
		const read = vi.spyOn(host.provider, "get");
		expect(host.provider.confirmGroupObjective?.("g", matches, () => false)).toBe(false);
		expect(read).not.toHaveBeenCalled();
		expect(matches).not.toHaveBeenCalled();
		expect(host.writes).toEqual([]);
	});

	for (const refusal of [
		"authority",
		"unmatched",
		"save",
		"authority after read",
		"authority after save",
	] as const)
		it(`clear ${refusal} refusal cannot acknowledge removal or Commit`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const first = pending(host);
			let current = refusal !== "authority";
			if (refusal === "save") host.refuse(true);
			if (refusal === "authority after read") {
				const get = host.provider.get.bind(host.provider);
				vi.spyOn(host.provider, "get").mockImplementation((id) => {
					const value = get(id);
					current = false;
					return value;
				});
			}
			if (refusal === "authority after save") {
				const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
				const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
				const set = api[method].bind(api);
				api[method] = (key: string, value: string) => {
					const result = set(key, value);
					if (key === "cmi.suspend_data") current = false;
					return result;
				};
			}
			host.writes.length = 0;
			const prepare = vi.fn((saved: LearnerStateValue | undefined) =>
				refusal === "unmatched"
					? undefined
					: prepareGroupObjectiveSave(saved, saved as LearnerStateValue, undefined, first?.id),
			);
			expect(host.provider.clearGroupObjective?.("g", prepare, () => current)).toBe(false);
			if (refusal === "authority") expect(prepare).not.toHaveBeenCalled();
			expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
			if (refusal !== "authority after save") expect(pending(host)).toEqual(first);
		});

	it("7c P3-2: mismatched handoffs drop before their revoked authority can refuse a draft", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const first = pending(host);
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, changed);
		host.refuse(true);
		expect(
			host.saveGroup({
				...groupState(),
				submitted: { ...submission(), contentSignature: changed },
			}),
		).toBe(false);
		host.refuse(false);
		host.revoke();
		expect(host.saveGroup({ ...groupState(), completed: false })).toBe(true);
		expect(host.provider.get("g")).toHaveProperty("completed", false);
		expect(pending(host)).toEqual(first);
	});

	it("7c P3-3: refused decided capture cannot revive its superseded pending result on a fresh launch", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const first = pending(host);
		host.provider.set("q", answer());
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, changed);
		host.runtime.trackInteraction("g", "0%", false, 0, {
			contentSignature: changed,
			memberIds: ["a"],
		});
		host.refuse(true);
		expect(
			host.saveGroup({
				...groupState(),
				submitted: { ...submission(), contentSignature: changed },
			}),
		).toBe(false);
		host.refuse(false);
		expect(host.saveGroup({ ...groupState(), completed: false })).toBe(true);
		expect(pending(host)).toEqual(first);
		expect(
			Reflect.get(host.ledger() ?? {}, "objectives")?.get(JSON.stringify(["g", first?.id])),
		).toBe("written");
		resetSessionState(
			Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11"),
			host.dom.window as unknown as Window,
		);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(host.evidence().status("g")).toBe("history");
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("6: ordinary and candidate writes build ordinary evidence once", () => {
		const host = launch(format);
		host.seed();
		const view = vi.fn(host.evidence);
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			getChoiceDependencyView: view,
		});
		tracker.checkCompletion();
		expect(view).toHaveBeenCalledTimes(1);
		view.mockClear();
		tracker.trackGroupObjective("g", 100, true, host.runtime, host.evidence(), groupSignature);
		expect(view).toHaveBeenCalledTimes(1);
	});

	it("8: a new launch on the same API resets acknowledgement", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		resetSessionState(
			Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11"),
			host.dom.window as unknown as Window,
		);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "100", "passed"]);
		host.refuse(false);
		host.tracker.checkCompletion();
		host.provider.set("q", answer(changed));
		host.submit(0, false);
		host.repair();
		expect(objectiveValues(host)).toEqual([
			"g",
			"100",
			"passed",
			"g",
			"100",
			"passed",
			"g",
			"0",
			"failed",
		]);
	});

	it("18: accepted SetValue with failed Commit cannot replay; later Commit permits one write", () => {
		const host = launch(format);
		host.seed();
		host.refuseCommit(true);
		host.submit();
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
		expect(host.committed.get("cmi.suspend_data")).toBeUndefined();
		host.repair();
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual([]);
		host.refuseCommit(false);
		host.tracker.prepareCommit();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toBeUndefined();
	});

	it("18: refused clear Commit restores the record and retries removal without another invocation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
		const set = api[method].bind(api);
		api[method] = (key: string, value: string) => {
			const result = set(key, value);
			if (key.startsWith("cmi.objectives.")) host.refuseCommit(true);
			return result;
		};
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
		host.crash();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuseCommit(false);
		host.tracker.checkCompletion();
		expect(pending(host)).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("acknowledging a replay preserves a successor handoff whose capture save was refused", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
		const set = api[method].bind(api);
		let armed = true;
		api[method] = (key: string, value: string) => {
			const result = set(key, value);
			if (armed && key.startsWith("cmi.objectives.")) {
				armed = false;
				host.provider.set("q", answer(changed));
				expect(
					host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
				).toBe(true);
				host.refuse(true);
				expect(host.saveGroup()).toBe(false);
				host.refuse(false);
			}
			return result;
		};
		host.tracker.checkCompletion();
		expect(host.saveGroup()).toBe(true);
		expect(pending(host)).toMatchObject({ score: 0, passed: false });
		host.runtime.trackInteraction("g", "0%", false, 0, {
			contentSignature: groupSignature,
			memberIds: ["a"],
		});
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});

	it("2: native objective reentry cannot invoke twice or clear a successor", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
		const set = api[method].bind(api);
		let armed = true;
		let afterSuccessor = 0;
		api[method] = (key: string, value: string) => {
			const result = set(key, value);
			if (armed && key.startsWith("cmi.objectives.")) {
				armed = false;
				host.replace(true);
				host.tracker.checkCompletion();
				host.provider.set("q", answer(changed));
				host.submit(0, false);
				afterSuccessor = host.writes.length;
			}
			return result;
		};
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toMatchObject({ score: 0, passed: false });
		expect(
			host.writes
				.slice(afterSuccessor)
				.filter(([key]) => key === "commit" || key === "cmi.suspend_data"),
		).toEqual([]);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});
});

it("7b P3-2: incoming pending identity cannot also be its clear identity", () => {
	const objective = { id: "a0000000-0000-4000-8000-000000000001", score: 100, passed: true };
	const previous = {
		...groupState(),
		submitted: { ...submission(), deferredObjective: objective },
	};
	const before = JSON.stringify(previous);
	expect(
		prepareGroupObjectiveSave(
			previous,
			groupState(),
			{ ...objective, contentSignature: groupSignature },
			objective.id,
		),
	).toBeNull();
	expect(JSON.stringify(previous)).toBe(before);
});

function installHost(
	host: ReturnType<typeof launch>,
	format: "scorm12" | "scorm2004",
	requiredAssessmentIds = ["q"],
) {
	const win = host.dom.window as unknown as Window & typeof globalThis;
	vi.stubGlobal("document", win.document);
	vi.stubGlobal("Event", win.Event);
	vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "objectives");
	const owner = selfCheckDocument(win.document, true);
	const descriptor = Object.getOwnPropertyDescriptor(win, "__praxityBlockState");
	if (!descriptor?.set) throw new Error("Missing provider installation");
	const installProvider = descriptor.set.bind(win);
	Object.defineProperty(win, "__praxityBlockState", {
		...descriptor,
		set(provider: LearnerBlockStateRuntime) {
			provider.getChoiceDependencyView = host.evidence;
			provider.getChoiceReporting = (current) => ({
				getChoiceDependencyView: host.evidence,
				writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
					provider,
					current,
					host.ledger() ?? {},
				),
			});
			installProvider(provider);
		},
	});
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
		requiredAssessmentIds,
		pageRole: "content",
		strings: {},
	};
	win.document.body.innerHTML = `<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
	Object.defineProperty(win.document, "readyState", { value: "complete" });
	expect(
		initializeScormCourseHost(
			{
				format,
				readEntry: () => null,
				readDeploymentConfig: readCourseDeploymentConfig,
				createRuntime: () => host.runtime,
			},
			{
				win,
				doc: win.document,
				location: { href: win.location.href, search: "", replace() {} },
				history: win.history,
			},
		),
	).toBe(true);
	return { win, owner };
}

/** Match the group owner's stage/report/save flow, including dispatch refusal. */
function submitEvent(
	host: ReturnType<typeof launch>,
	win: Window & typeof globalThis,
	detail: Record<string, unknown> = {},
	state: LearnerStateValue = groupState(),
) {
	const event = new win.CustomEvent("praxity:assessment-group-complete", {
		detail: {
			groupId: "g",
			score: 100,
			passed: true,
			correct: true,
			memberIds: ["a"],
			completed: true,
			contentSignature: groupSignature,
			...detail,
		},
		cancelable: true,
	});
	const save = () => writeLearnerBlockState("g", state, () => true, win.document);
	const report = () => dispatchSelfCheckEvent(event, () => true, win.document);
	const provider = win.__praxityBlockState;
	if (!provider) throw new Error("Missing provider installation");
	const accepted = provider.stageSubmission
		? provider.stageSubmission("g", () => save() && report())
		: report();
	if (accepted && !provider.stageSubmission) save();
	return { event, accepted };
}

describe.each(["scorm12", "scorm2004"] as const)("%s assembled replay", (format) => {
	it("1/2: signed host dispatch and announce replacement retain one launch acknowledgement", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win).accepted).toBe(true);
		expect(host.runtime.commit()).toBe(true);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
		const first = win.__praxityTracker;
		owner.reset();
		expect(win.__praxityTracker).not.toBe(first);
		expect(objectiveValues(host)).toEqual([]);
		host.provider.set("q", answer());
		host.refuse(true);
		(win.__praxityTracker as CourseTracker).checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		owner.reset();
		(win.__praxityTracker as CourseTracker).checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		(win.__praxityTracker as CourseTracker).checkCompletion();
		expect(pending(host)).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		owner.dispose();
	});
});
