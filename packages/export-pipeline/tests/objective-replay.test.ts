import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { writeLearnerBlockState } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import {
	prepareGroupObjectiveSave,
	readDeferredGroupObjective,
} from "@praxity/shared-blocks/learner-state";
import { dispatchSelfCheckEvent } from "@praxity/shared-blocks/self-check-consumers";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { initAssessmentGroups } from "@praxity/shared-blocks/viewer/assessment-group-runtime";
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

		const nested = vi.fn(() => {
			const accepted = host.tracker.trackGroupObjective(
				"g",
				0,
				false,
				host.runtime,
				undefined,
				groupSignature,
			);
			host.refuse(true);
			return accepted;
		});
		let armed = true;
		host.runtime.setCommitPreparation?.(() => {
			if (armed) {
				armed = false;
				expect(nested()).toBe(false);
			}
		});
		host.tracker.checkCompletion();
		expect(nested).toHaveBeenCalledTimes(1);
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		host.tracker.checkCompletion();
		expect(pending(host)).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
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
		expect(reads).toBeGreaterThanOrEqual(2);
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
		expect(pending(host)).toBeUndefined();
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
	deferred = true,
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
				writeObjectives: deferred
					? tracking.createDeferredGroupObjectiveWriter?.(provider, current, host.ledger() ?? {})
					: undefined,
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

// Regression orderings retained from the independent replay review.
const apiOf = (host: ReturnType<typeof launch>, format: "scorm12" | "scorm2004") =>
	Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
const freshLaunch = (host: ReturnType<typeof launch>, format: "scorm12" | "scorm2004") => {
	resetSessionState(apiOf(host, format), host.dom.window as unknown as Window);
	host.replace(true);
};
const hookObjectiveSet = (
	host: ReturnType<typeof launch>,
	format: "scorm12" | "scorm2004",
	callback: () => void,
) => {
	const api = apiOf(host, format);
	const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
	const set = api[method].bind(api);
	let armed = true;
	api[method] = (key: string, value: string) => {
		const result = set(key, value);
		if (armed && key.startsWith("cmi.objectives.")) {
			armed = false;
			callback();
		}
		return result;
	};
	return () => {
		api[method] = set;
	};
};

describe.each(["scorm12", "scorm2004"] as const)("opus 7d r4 rerun %s", (format) => {
	it("r4 Sol P1-1: decided submission during confirmation supersedes the old obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());

		let once = true;
		host.runtime.setCommitPreparation?.(() => {
			if (!once) return;
			once = false;
			expect(
				host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
			).toBe(false);
			host.refuse(true);
		});
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("r4 Sol P1-2: a changed aggregate interaction during Commit cannot replay", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.trackInteraction("g", "100%", true, 100, {
			contentSignature: groupSignature,
			memberIds: ["a"],
		});
		expect(host.evidence().status("g")).toBe("current");
		let once = true;
		host.runtime.setCommitPreparation?.(() => {
			if (!once) return;
			once = false;
			host.runtime.trackInteraction("g", "0%", false, 0, {
				contentSignature: changed,
				memberIds: ["a"],
			});
		});
		host.tracker.checkCompletion();
		expect(host.evidence().status("g")).toBe("history");
		expect(objectiveValues(host)).toEqual([]);
	});

	it("r4 Sol control: a malformed following group save keeps capture and obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const before = host.runtime.getSuspendData();
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature);
		expect.soft(host.saveGroup({ ...groupState(), version: 2 } as LearnerStateValue)).toBe(false);
		expect.soft(host.runtime.getSuspendData()).toBe(before);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("r4 Sol P1-3: ordinary host keeps main's boolean normalization", () => {
		const host = launch(format);
		const win = host.dom.window as unknown as Window & typeof globalThis;
		vi.stubGlobal("document", win.document);
		vi.stubGlobal("Event", win.Event);
		vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "objectives");
		const owner = selfCheckDocument(win.document, true);
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
		expect(win.__praxityBlockState?.getChoiceReporting).toBeUndefined();
		const event = new win.CustomEvent("praxity:assessment-group-complete", {
			detail: { groupId: "g", score: 100, passed: "false", correct: false, memberIds: ["a"] },
		});
		dispatchSelfCheckEvent(event, () => true, win.document);
		expect(objectiveValues(host)).toEqual(["g", "100", "failed"]);
		owner.dispose();
	});

	it("r4 Opus P2-1: corrupt saved group state, decided event through the installed host", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("g", { version: 2, kind: "assessmentGroup" } as unknown as LearnerStateValue);
		host.provider.set("q", answer());
		const { win, owner } = installHost(host, format);
		const result = submitEvent(host, win, { score: 0, passed: false, correct: false });
		expect({
			accepted: result.accepted,
			prevented: result.event.defaultPrevented,
			objectives: objectiveValues(host),
		}).toEqual({ accepted: true, prevented: false, objectives: ["g", "0", "failed"] });
		owner.dispose();
	});

	it("r4 Opus P2-1b: corrupt saved group state, waiting event through the installed host", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("g", "garbage" as unknown as LearnerStateValue);
		const { win, owner } = installHost(host, format);
		const result = submitEvent(host, win);
		expect({ accepted: result.accepted, prevented: result.event.defaultPrevented }).toEqual({
			accepted: true,
			prevented: false,
		});
		owner.dispose();
	});

	it("r4 Opus P2-2: a refused changed-signature save leaves no handoff that refuses a retry draft", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const old = host.stored();
		expect(host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, changed)).toBe(
			true,
		);
		host.refuse(true);
		const save = () =>
			host.saveGroup({
				...groupState(),
				submitted: { ...submission(), contentSignature: changed },
			} as LearnerStateValue);
		if (host.provider.stageSubmission) {
			host.provider.stageSubmission("g", () => {
				save();
				return true;
			});
			try {
				host.tracker.trackInteraction("g", "0%", false, 0);
			} catch {}
		} else {
			host.tracker.trackInteraction("g", "0%", false, 0);
			save();
		}
		host.refuse(false);
		const saved = host.saveGroup({ ...old, completed: false } as LearnerStateValue);
		expect({ saved, completed: host.stored().completed }).toEqual({
			saved: true,
			completed: false,
		});
	});

	it("r4 Opus P3-1: a non-current pending record never commits on decided checks", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const base = host.evidence;
		const stale = () => {
			const view = base();
			return Object.assign(Object.create(Object.getPrototypeOf(view)), view, {
				status: (id: string) => (id === "g" ? "history" : view.status(id)),
			});
		};
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			getChoiceDependencyView: stale,
		} as TrackingConfig);
		const commits = () => host.writes.filter(([k]) => k === "commit").length;
		const before = commits();
		for (let i = 0; i < 5; i++) tracker.checkCompletion();
		expect({ commits: commits() - before, objectives: objectiveValues(host) }).toEqual({
			commits: 0,
			objectives: [],
		});
	});

	it("r4 Opus P2-3: superseding decided capture with refused Commit, then a fresh launch", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const oldId = host.stored().submitted.deferredObjective?.id;
		host.provider.set("q", answer());
		host.refuseCommit(true);
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(false);
		host.saveGroup();
		try {
			host.tracker.trackInteraction("g", "0%", false, 0);
		} catch {}
		const kept = host.stored().submitted.deferredObjective?.id;
		expect(objectiveValues(host)).toEqual([]);
		host.refuseCommit(false);
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		expect({ keptPredecessor: kept === oldId, objectives: objectiveValues(host) }).toEqual({
			keptPredecessor: true,
			objectives: ["g", "0", "failed"],
		});
	});
});

describe.each(["scorm12", "scorm2004"] as const)("opus 7d new probes %s", (format) => {
	it("N1: refused same-signature decided capture save cannot replay the superseded record on a fresh launch", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const first = pending(host);
		host.provider.set("q", answer());
		// Main's objective-first order: objective, interaction, event Commit, then the capture save.
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		host.runtime.trackInteraction("g", "0%", false, 0, {
			contentSignature: groupSignature,
			memberIds: ["a"],
		});
		host.refuse(true);
		host.runtime.commit();
		expect(host.saveGroup()).toBe(false);
		expect(pending(host)).toEqual(first);
		host.refuse(false);
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("N1b: same as N1, storage refused only at the capture save", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		host.runtime.trackInteraction("g", "0%", false, 0, {
			contentSignature: groupSignature,
			memberIds: ["a"],
		});
		host.refuse(true);
		expect(host.saveGroup()).toBe(false);
		host.refuse(false);
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("E: refused retirement cancels the submission without an objective; restored storage permits retry", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win).accepted).toBe(true);
		expect(host.runtime.commit()).toBe(true);
		host.provider.set("q", answer());
		const before = host.values.get("cmi.suspend_data");
		const first = pending(host);
		host.writes.length = 0;
		host.refuse(true);
		const refused = submitEvent(host, win, { score: 0, passed: false, correct: false });
		expect(refused.accepted).toBe(false);
		expect(refused.event.defaultPrevented).toBe(true);
		expect(objectiveValues(host)).toEqual([]);
		expect(host.values.get("cmi.suspend_data")).toBe(before);
		expect(pending(host)).toEqual(first);
		if (format === "scorm12")
			expect(win.__praxityBlockState?.getSaveResult?.("g")).toMatchObject({ status: "not-saved" });
		else expect(win.__praxityBlockState?.getSaveResult).toBeUndefined();
		host.refuse(false);
		const retried = submitEvent(host, win, { score: 0, passed: false, correct: false });
		expect(retried.accepted).toBe(true);
		expect(retried.event.defaultPrevented).toBe(false);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		expect(pending(host)).toBeUndefined();
		owner.dispose();
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("N2u: a refused decided supersession cannot delete an earlier replay acknowledgement", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const first = pending(host);
		host.provider.set("q", answer());
		host.refuse(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		const key = JSON.stringify(["g", first?.id]);
		expect(Reflect.get(host.ledger() ?? {}, "objectives")?.get(key)).toBe("written");
		host.refuse(false);
		// A separately admitted writer loses authority inside its own native objective callback.
		let authority = true;
		const outer = new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: tracking.createDeferredGroupObjectiveWriter(
				host.provider,
				() => authority,
				host.ledger() ?? {},
			),
		} as TrackingConfig);
		const restore = hookObjectiveSet(host, format, () => {
			authority = false;
		});
		outer.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature);
		restore();
		const ack = Reflect.get(host.ledger() ?? {}, "objectives")?.get(key);
		host.tracker.checkCompletion();
		host.tracker.checkCompletion();
		expect({ ack, objectives: objectiveValues(host) }).toEqual({
			ack: "written",
			objectives: ["g", "100", "passed", "g", "0", "failed"],
		});
	});

	it("N2: assembled host, re-admission inside a decided write's objective callback cannot replay an acknowledged record twice", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win).accepted).toBe(true);
		expect(host.runtime.commit()).toBe(true);
		const first = pending(host);
		expect(first).toMatchObject({ score: 100, passed: true });
		host.provider.set("q", answer());
		host.refuse(true);
		(win.__praxityTracker as CourseTracker).checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		const restore = hookObjectiveSet(host, format, () => owner.reset());
		const result = submitEvent(host, win, { score: 0, passed: false, correct: false });
		restore();
		(win.__praxityTracker as CourseTracker).checkCompletion();
		(win.__praxityTracker as CourseTracker).checkCompletion();
		expect({ accepted: result.accepted, objectives: objectiveValues(host) }).toEqual({
			accepted: result.accepted,
			objectives: ["g", "100", "passed", "g", "0", "failed"],
		});
		owner.dispose();
	});

	it("N3: assembled host, re-admission inside replay's native Commit invokes once and clears", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win).accepted).toBe(true);
		expect(host.runtime.commit()).toBe(true);
		host.provider.set("q", answer());
		const api = apiOf(host, format);
		const method = format === "scorm12" ? "LMSCommit" : "Commit";
		const commit = api[method].bind(api);
		let armed = true;
		api[method] = () => {
			if (armed) {
				armed = false;
				owner.reset();
			}
			return commit();
		};
		(win.__praxityTracker as CourseTracker).checkCompletion();
		api[method] = commit;
		(win.__praxityTracker as CourseTracker).checkCompletion();
		(win.__praxityTracker as CourseTracker).checkCompletion();
		expect({ objectives: objectiveValues(host), pending: pending(host) }).toEqual({
			objectives: ["g", "100", "passed"],
			pending: undefined,
		});
		owner.dispose();
	});

	it("N3b: tracker replacement and adapter reopening inside Commit preparation invoke once", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let armed = true;
		host.runtime.setCommitPreparation?.(() => {
			if (!armed) return;
			armed = false;
			host.replace(true);
			host.tracker.checkCompletion();
			host.tracker.prepareCommit();
		});
		host.tracker.checkCompletion();
		host.tracker.checkCompletion();
		host.replace(true);
		host.tracker.checkCompletion();
		expect({ objectives: objectiveValues(host), pending: pending(host) }).toEqual({
			objectives: ["g", "100", "passed"],
			pending: undefined,
		});
	});

	it("N4: rows appended and a check inside the replay's native objective callback cause no second write", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		// SCORM 1.2 keeps interaction evidence in suspend data, so storage stays writable here.
		const restore = hookObjectiveSet(host, format, () => {
			host.runtime.trackInteraction("g", "0%", false, 0, {
				contentSignature: changed,
				memberIds: ["a"],
			});
			host.tracker.checkCompletion();
		});
		host.tracker.checkCompletion();
		restore();
		host.tracker.checkCompletion();
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("N5: refused clear then a fresh launch replays once per launch and then clears", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		host.tracker.checkCompletion();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		host.tracker.checkCompletion();
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		expect({ objectives: objectiveValues(host), pending: pending(host) }).toEqual({
			objectives: ["g", "100", "passed", "g", "100", "passed"],
			pending: undefined,
		});
	});

	it("N6: a decided candidate with waiting ordinary evidence neither confirms nor loses its own outcome", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		expect(host.evidence().status("q")).toBe("history");
		const candidate = () => {
			const view = host.evidence();
			return Object.assign(Object.create(Object.getPrototypeOf(view)), view, {
				status: (id: string) => (id === "q" ? "current" : view.status(id)),
			});
		};
		expect(host.tracker.outcome("check", candidate()).kind).toBe("decided");
		const plain = new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: undefined,
		} as TrackingConfig);
		host.writes.length = 0;
		plain.checkCompletion(candidate());
		const expected = host.writes.splice(0);
		host.tracker.checkCompletion(candidate());
		const actual = host.writes.splice(0);
		expect({ actual, objectives: objectiveValues(host) }).toEqual({
			actual: expected,
			objectives: [],
		});
	});

	it("N7: a successor saved after a written replay survives the next clear attempt", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		host.provider.set("q", answer(changed));
		host.submit(0, false);
		const successor = pending(host);
		expect(successor).toMatchObject({ score: 0, passed: false });
		host.tracker.checkCompletion();
		expect(pending(host)).toEqual(successor);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});
	it("N6b: the candidate's decided score write survives a pending record elsewhere", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const candidate = () => {
			const view = host.evidence();
			return Object.assign(Object.create(Object.getPrototypeOf(view)), view, {
				status: (id: string) => (id === "q" ? "current" : view.status(id)),
			});
		};
		const configure = vi.spyOn(host.runtime, "configureOutcome");
		const plain = new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: undefined,
		} as TrackingConfig);
		plain.checkCompletion(candidate());
		const expected = configure.mock.calls.splice(0);
		host.tracker.checkCompletion(candidate());
		const actual = configure.mock.calls.splice(0);
		expect({ actual }).toEqual({ actual: expected });
	});
});

describe.each(["scorm12", "scorm2004"] as const)("opus 7d killers %s", (format) => {
	for (const when of ["preparation", "objective"] as const)
		it(`K: material changed in a ${when} callback leaves the final ordinary write waiting`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.runtime.trackPageVisit("one");
			host.runtime.trackPageVisit("two");
			host.provider.set("q", answer());
			const change = vi.fn(() => host.provider.set("q", answer(changed)));
			if (when === "preparation") {
				let armed = true;
				host.runtime.setCommitPreparation?.(() => {
					if (!armed) return;
					armed = false;
					change();
				});
			} else hookObjectiveSet(host, format, change);
			const configure = vi.spyOn(host.runtime, "configureOutcome");
			host.tracker.checkCompletion();
			expect(change).toHaveBeenCalledTimes(1);
			expect(host.evidence().status("q")).toBe("history");
			// SCORM defers completion SetValues to Commit, so the outer write's outcome is the observable.
			expect(configure.mock.calls.at(-1)).toEqual([{ waiting: true }]);
		});
});

describe.each(["scorm12", "scorm2004"] as const)(
	"storage read and candidate regressions %s",
	(format) => {
		it("a native saved-state read that changes evidence must not Commit a non-current record", () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.provider.set("q", answer());
			const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
			const method = format === "scorm12" ? "LMSGetValue" : "GetValue";
			const get = api[method].bind(api);
			const view = vi.fn(host.evidence);
			const tracker = new CourseTracker(host.runtime, {
				...host.config(),
				getChoiceDependencyView: view,
			});
			let armed = true;
			api[method] = (key: string) => {
				const result = get(key);
				if (armed && view.mock.results.length === 1 && key === "cmi.suspend_data") {
					armed = false;
					host.runtime.trackInteraction("g", "0%", false, 0, {
						contentSignature: changed,
						memberIds: ["a"],
					});
				}
				return result;
			};
			host.writes.length = 0;
			tracker.checkCompletion();
			expect(armed).toBe(false);
			expect(host.evidence().status("g")).toBe("history");
			expect(objectiveValues(host)).toEqual([]);
			expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
		});
		it("a speculative decided candidate must not confirm an ordinary waiting record", () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const candidate = withChoiceDependencyStatus({
				...host.evidence(),
				readState: (id) => (id === "q" ? answer() : host.provider.get(id)),
			});
			expect(candidate.status("q")).toBe("current");
			host.writes.length = 0;
			host.tracker.checkCompletion(candidate);
			expect(objectiveValues(host)).toEqual([]);
			expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
		});
	},
);
describe.each(["scorm12", "scorm2004"] as const)(
	"independent 7d acknowledgement and clear %s",
	(format) => {
		it("a revoked later decided attempt must not erase an existing supersession acknowledgement", () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.provider.set("q", answer());
			const first = pending(host);
			host.refuse(true);
			host.tracker.checkCompletion();
			const key = JSON.stringify(["g", first?.id]);
			expect(host.ledger()?.objectives?.get(key)).toBe("written");
			host.refuse(false);
			let current = true;
			const tracker = new CourseTracker(host.runtime, {
				...host.config(),
				writeObjectives: tracking.createDeferredGroupObjectiveWriter(
					host.provider,
					() => current,
					host.ledger() ?? {},
				),
			});
			const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
			const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
			const set = api[method].bind(api);
			let armed = true;
			api[method] = (key: string, value: string) => {
				const result = set(key, value);
				if (armed && key.startsWith("cmi.objectives.")) {
					armed = false;
					current = false;
				}
				return result;
			};
			expect(
				tracker.trackGroupObjective("g", 50, false, host.runtime, undefined, groupSignature),
			).toBe(false);
			expect.soft(host.ledger()?.objectives?.get(key)).toBe("written");
			host.tracker.checkCompletion();
			expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "50", "failed"]);
		});
		for (const when of ["before", "after"] as const)
			it(`clear must preserve a successor saved ${when} the native removal SetValue`, () => {
				const host = launch(format);
				host.seed();
				host.submit();
				host.provider.set("q", answer());
				const api = Reflect.get(host.dom.window, format === "scorm12" ? "API" : "API_1484_11");
				const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
				const set = api[method].bind(api);
				let armed = true;
				let successor: ReturnType<typeof pending>;
				api[method] = (key: string, value: string) => {
					const replace = () => {
						if (armed && key === "cmi.suspend_data" && objectiveValues(host).length > 0) {
							armed = false;
							host.provider.set("q", answer(changed));
							host.submit(0, false);
							successor = pending(host);
							expect(successor).toMatchObject({ score: 0, passed: false });
						}
					};
					if (when === "before") replace();
					const result = set(key, value);
					if (when === "after") replace();
					return result;
				};
				host.tracker.checkCompletion();
				expect(armed).toBe(false);
				expect.soft(pending(host)).toEqual(successor);
				host.replace(true);
				host.repair();
				expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
			});
	},
);
describe.each(["scorm12", "scorm2004"] as const)(
	"independent 7d final evidence read %s",
	(format) => {
		it("a row changed by the final capture read cannot replay from the preceding evidence view", () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.provider.set("q", answer());
			const confirm = host.provider.confirmGroupObjective?.bind(host.provider);
			let confirmed = false;
			host.provider.confirmGroupObjective = (...args) => {
				const result = confirm?.(...args);
				confirmed = true;
				return result ?? false;
			};
			const get = host.provider.get.bind(host.provider);
			let afterConfirm = 0;
			let changedRow = false;
			vi.spyOn(host.provider, "get").mockImplementation((id) => {
				const value = get(id);
				if (confirmed && id === "g" && ++afterConfirm === 2) {
					changedRow = true;
					host.runtime.trackInteraction("g", "0%", false, 0, {
						contentSignature: changed,
						memberIds: ["a"],
					});
				}
				return value;
			});
			host.tracker.checkCompletion();
			expect(changedRow).toBe(true);
			expect.soft(host.evidence().status("g")).toBe("history");
			expect(objectiveValues(host)).toEqual([]);
		});
	},
);
describe.each(["scorm12", "scorm2004"] as const)(
	"independent 7d verified second-group candidate %s",
	(format) => {
		it("a verified candidate for h must not confirm g while ordinary h is history", () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.provider.set("q", answer());
			const old = {
				payload: {
					mode: "all",
					selectedMemberId: null,
					dependencies: [["a", `sha256:${"b".repeat(64)}`]],
				},
				contentSignature: "sha256:855046ca0ab3006f658988e444dc7e03da69af411410c1947d688ffe7dc8b3b8",
			};
			host.provider.set("h", { ...groupState(), submitted: old });
			host.runtime.trackInteraction("h", "100%", true, 100, {
				contentSignature: old.contentSignature,
				memberIds: ["a"],
			});
			const evidence = () =>
				withChoiceDependencyStatus({
					...host.evidence(),
					groups: {
						...host.evidence().groups,
						h: { mode: "all", memberIds: ["a"], requiredIds: ["a"] },
					},
				});
			const ordinary = evidence();
			expect(ordinary.status("g")).toBe("current");
			expect(ordinary.status("h")).toBe("history");
			const candidate = ordinary.verifyGroupSubmission?.(
				"h",
				{ completed: true, contentSignature: groupSignature },
				{ correct: false, memberIds: ["a"] },
			);
			expect(candidate).not.toBeNull();
			expect(candidate?.status("h")).toBe("current");
			const tracker = new CourseTracker(host.runtime, {
				...host.config(),
				requiredAssessmentIds: ["h"],
				getChoiceDependencyView: evidence,
			});
			expect(tracker.outcome("check", ordinary).kind).toBe("waiting");
			expect(tracker.outcome("check", candidate).kind).toBe("decided");
			host.writes.length = 0;
			tracker.checkCompletion(candidate ?? undefined);
			expect(objectiveValues(host)).toEqual([]);
			expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
		});
	},
);

describe.each(["scorm12", "scorm2004"] as const)("supersession boundaries %s", (format) => {
	it("no pending record keeps main's objective, interaction and save log", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
		try {
			const run = (deferred: boolean) => {
				const host = launch(format);
				host.seed();
				host.provider.set("q", answer());
				const { win, owner } = installHost(host, format, ["q"], deferred);
				host.writes.length = 0;
				expect(pending(host)).toBeUndefined();
				expect(submitEvent(host, win, { score: 0, passed: false, correct: false }).accepted).toBe(
					true,
				);
				const log = host.writes.map((row) => [...row]);
				owner.dispose();
				return log;
			};
			expect(run(true)).toEqual(run(false));
		} finally {
			vi.useRealTimers();
		}
	});

	it("a failed retirement Commit leaves original bytes and cancels before reporting", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win).accepted).toBe(true);
		host.runtime.commit();
		host.provider.set("q", answer());
		const before = host.values.get("cmi.suspend_data");
		const first = pending(host);
		host.refuseCommit(true);
		const refused = submitEvent(host, win, { score: 0, passed: false, correct: false });
		expect(refused.accepted).toBe(false);
		expect(refused.event.defaultPrevented).toBe(true);
		expect(objectiveValues(host)).toEqual([]);
		expect(host.values.get("cmi.suspend_data")).toBe(before);
		expect(pending(host)).toEqual(first);
		host.refuseCommit(false);
		expect(submitEvent(host, win, { score: 0, passed: false, correct: false }).accepted).toBe(true);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		owner.dispose();
	});
});

describe.each(["scorm12", "scorm2004"] as const)("retirement refusal notice %s", (format) => {
	for (const locale of ["en", "fr"])
		it(`${locale}: failed retirement keeps the not-saved notice and retry action`, async () => {
			const host = launch(format);
			host.seed();
			const { win, owner } = installHost(host, format);
			expect(submitEvent(host, win).accepted).toBe(true);
			host.runtime.commit();
			host.provider.set("q", answer());
			expect(host.saveGroup({ ...groupState(), completed: false })).toBe(true);
			vi.stubGlobal("CustomEvent", win.CustomEvent);
			vi.stubGlobal("MutationObserver", win.MutationObserver);
			vi.stubGlobal("HTMLElement", win.HTMLElement);
			vi.stubGlobal("CSS", { escape: (id: string) => id });
			win.requestAnimationFrame = (callback) => win.setTimeout(() => callback(0), 0);
			win.cancelAnimationFrame = (id) => win.clearTimeout(id);
			const root = win.document.createElement("main");
			win.document.body.append(root);
			root.innerHTML =
				'<div class="praxity-block" data-block-id="a"><div class="praxity-block-assessment" data-block-id="a" data-assessment-display="standard" data-assessment-answered="true" data-completed="true" data-result="incorrect" data-score="0" data-max-score="100" data-passed="false"><p class="praxity-assessment-stem">Question</p><button data-assessment-submit="true">Submit</button></div></div>';
			const dispose = initAssessmentGroups({
				root,
				labels: getStrings(locale),
				blocks: [
					{
						id: "g",
						type: "assessmentGroup",
						data: { mode: "all", memberBlockIds: ["a"], showResultsSummary: true },
					},
					{ id: "a", type: "assessment", data: { gradingMode: "exact" } },
				] as PraxityBlock[],
			});
			try {
				await vi.waitFor(() => expect(root.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
				const before = host.values.get("cmi.suspend_data");
				host.refuse(true);
				root.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
				await vi.waitFor(() =>
					expect(root.querySelector("[data-assessment-group-status]")?.textContent).toBe(
						getStrings(locale).assessmentStorageNotice,
					),
				);
				expect(
					root
						.querySelector("[data-assessment-group-status]")
						?.classList.contains("praxity-sr-only"),
				).toBe(false);
				expect(root.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.disabled).toBe(
					false,
				);
				expect(objectiveValues(host)).toEqual([]);
				expect(host.values.get("cmi.suspend_data")).toBe(before);
				host.refuse(false);
				root.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
				await vi.waitFor(() => expect(objectiveValues(host)).toEqual(["g", "0", "failed"]));
				expect(host.provider.get("g")).toHaveProperty("completed", true);
			} finally {
				dispose();
				owner.dispose();
			}
		});
});

it("a retired UUID cannot return in a changed-signature draft or pending proposal", () => {
	const objective = { id: "a0000000-0000-4000-8000-000000000001", score: 100, passed: true };
	const previous = {
		...groupState(),
		submitted: { ...submission(), deferredObjective: objective, retiredObjectiveId: objective.id },
	};
	const draft = {
		...groupState(),
		submitted: { ...submission(), contentSignature: changed, deferredObjective: objective },
	};
	const prepared = prepareGroupObjectiveSave(previous, draft);
	expect(readDeferredGroupObjective(prepared)).toBeUndefined();
	expect(prepared).toHaveProperty("submitted.retiredObjectiveId", objective.id);
	expect(
		prepareGroupObjectiveSave(previous, groupState(), {
			...objective,
			contentSignature: groupSignature,
		}),
	).toBeNull();
});

describe.each(["scorm12", "scorm2004"] as const)("retirement callback boundaries %s", (format) => {
	it("a decided submission in the native confirmation Commit retires its predecessor", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const api = apiOf(host, format);
		const method = format === "scorm12" ? "LMSCommit" : "Commit";
		const commit = api[method].bind(api);
		let armed = true;
		api[method] = () => {
			if (armed) {
				armed = false;
				expect(
					host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
				).toBe(true);
			}
			return commit();
		};
		host.tracker.checkCompletion();
		expect(armed).toBe(false);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		freshLaunch(host, format);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});

	it("a successor accepted before retirement cannot be retired by the predecessor's UUID", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const retire = host.provider.retireGroupObjective?.bind(host.provider);
		let successor: ReturnType<typeof pending>;
		host.provider.retireGroupObjective = (...args) => {
			host.provider.set("q", answer(changed));
			host.submit(0, false);
			successor = pending(host);
			return retire?.(...args) ?? false;
		};
		expect(
			host.tracker.trackGroupObjective("g", 50, false, host.runtime, undefined, groupSignature),
		).toBe(false);
		expect(pending(host)).toEqual(successor);
		expect(objectiveValues(host)).toEqual([]);
		host.provider.retireGroupObjective = retire;
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});
});

describe.each(["scorm12", "scorm2004"] as const)("retired record controls %s", (format) => {
	it("a retained raw record still requires a saved retirement before another decided submission", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		host.refuse(true);
		expect(
			host.tracker.trackGroupObjective("g", 50, false, host.runtime, undefined, groupSignature),
		).toBe(false);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		host.refuse(false);
		expect(
			host.tracker.trackGroupObjective("g", 50, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed", "g", "50", "failed"]);
	});
});

describe.each(["scorm12", "scorm2004"] as const)("clear read callbacks %s", (format) => {
	for (const readNumber of [2, 3, 4])
		it(`a successor saved inside clear read ${readNumber} survives a stale native read result`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const first = pending(host);
			const get = host.provider.get.bind(host.provider);
			let reads = 0;
			let successor: ReturnType<typeof pending>;
			vi.spyOn(host.provider, "get").mockImplementation((id) => {
				const value = get(id);
				if (id === "g" && ++reads === readNumber) {
					host.replace(false);
					host.submit(0, false);
					successor = pending(host);
				}
				return value;
			});
			const commitsBefore = host.writes.filter(([key]) => key === "commit").length;
			expect(
				host.provider.clearGroupObjective?.(
					"g",
					(value) =>
						prepareGroupObjectiveSave(value, value as LearnerStateValue, undefined, first?.id),
					() => true,
				),
			).toBe(false);
			expect(successor).toMatchObject({ score: 0, passed: false });
			expect(pending(host)).toEqual(successor);
			expect(host.writes.filter(([key]) => key === "commit").length - commitsBefore).toBe(
				readNumber === 4 ? 2 : 1,
			);
		});
	for (const readNumber of [2, 3, 4])
		it(`revocation inside clear read ${readNumber} prevents its Commit`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const first = pending(host);
			const get = host.provider.get.bind(host.provider);
			let reads = 0;
			let authority = true;
			vi.spyOn(host.provider, "get").mockImplementation((id) => {
				const value = get(id);
				if (++reads === readNumber) authority = false;
				return value;
			});
			host.writes.length = 0;
			expect(
				host.provider.clearGroupObjective?.(
					"g",
					(value) =>
						prepareGroupObjectiveSave(value, value as LearnerStateValue, undefined, first?.id),
					() => authority,
				),
			).toBe(false);
			expect(authority).toBe(false);
			if (readNumber === 2) expect(host.writes).toEqual([]);
			expect(host.writes.filter(([key]) => key === "commit")).toEqual(
				readNumber === 4 ? [["commit", "true"]] : [],
			);
		});
});

describe.each(["scorm12", "scorm2004"] as const)("flight invalidation %s", (format) => {
	for (const callback of ["check", "readmission"])
		it(`${callback} during admission rereads material before confirming`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			host.provider.set("q", answer());
			let requiredSignature = signature;
			let armed = true;
			let tracker: CourseTracker;
			const evidence = () => {
				const view = withChoiceDependencyStatus({
					...host.evidence(),
					signatures: { q: requiredSignature },
				});
				return {
					...view,
					status: (id: string) => {
						if (armed && id === "g") {
							armed = false;
							requiredSignature = changed;
							if (callback === "check") tracker.checkCompletion();
							else
								tracking.createDeferredGroupObjectiveWriter(
									host.provider,
									() => true,
									host.ledger() ?? {},
								);
						}
						return view.status(id);
					},
				};
			};
			tracker = new CourseTracker(host.runtime, {
				...host.config(),
				getChoiceDependencyView: evidence,
			});
			host.writes.length = 0;
			tracker.checkCompletion();
			expect(armed).toBe(false);
			expect(objectiveValues(host)).toEqual([]);
			expect(host.writes.filter(([key]) => key === "commit")).toEqual([]);
		});

	it("a reentrant check cannot confirm an incoming attempt's writing claim", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const retire = host.provider.retireGroupObjective?.bind(host.provider);
		host.provider.retireGroupObjective = (...args) => {
			host.tracker.checkCompletion();
			return retire?.(...args) ?? false;
		};
		host.writes.length = 0;
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		expect(host.writes.filter(([key]) => key === "commit")).toEqual([["commit", "true"]]);
	});
});

describe.each(["scorm12", "scorm2004"] as const)("native clear comparisons %s", (format) => {
	for (const readNumber of [2, 3, 4])
		it(`a native successor observed by clear read ${readNumber} survives without an adapter write`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const first = pending(host);
			const successor = { id: "b0000000-0000-4000-8000-000000000001", score: 0, passed: false };
			const get = host.provider.get.bind(host.provider);
			let reads = 0;
			vi.spyOn(host.provider, "get").mockImplementation((id) => {
				if (id === "g" && ++reads === readNumber) {
					const envelope = JSON.parse(host.values.get("cmi.suspend_data") ?? "{}");
					const custom = format === "scorm12" ? JSON.parse(envelope.custom) : envelope;
					custom.blockState.g = {
						...groupState(),
						submitted: { ...submission(), deferredObjective: successor },
					};
					if (format === "scorm12") envelope.custom = JSON.stringify(custom);
					host.values.set("cmi.suspend_data", JSON.stringify(envelope));
				}
				return get(id);
			});
			host.writes.length = 0;
			expect(
				host.provider.clearGroupObjective?.(
					"g",
					(value) =>
						prepareGroupObjectiveSave(value, value as LearnerStateValue, undefined, first?.id),
					() => true,
				),
			).toBe(false);
			expect(pending(host)).toEqual(successor);
			expect(host.writes.filter(([key]) => key === "commit")).toEqual(
				readNumber === 4 ? [["commit", "true"]] : [],
			);
		});
});

describe.each(["scorm12", "scorm2004"] as const)("final callback boundaries %s", (format) => {
	it("revocation drains a reentrant replacement immediately without a later check", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let authority = true;
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: tracking.createDeferredGroupObjectiveWriter(
				host.provider,
				() => authority,
				host.ledger() ?? {},
			),
		});
		const api = apiOf(host, format);
		const method = format === "scorm12" ? "LMSCommit" : "Commit";
		const commit = api[method].bind(api);
		let armed = true;
		api[method] = () => {
			if (armed) {
				armed = false;
				authority = false;
				const next = new CourseTracker(host.runtime, {
					...host.config(),
					writeObjectives: tracking.createDeferredGroupObjectiveWriter(
						host.provider,
						() => true,
						host.ledger() ?? {},
					),
				});
				next.checkCompletion();
			}
			return commit();
		};
		tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(pending(host)).toBeUndefined();
	});

	it("material changed during preparation cannot flush queued decided completion", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.trackPageVisit("one");
		host.runtime.trackPageVisit("two");
		new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: undefined,
		}).checkCompletion();
		host.runtime.setCommitPreparation?.(() => {
			host.provider.set("q", answer(changed));
			host.tracker.prepareCommit();
		});
		host.writes.length = 0;
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual([]);
		expect(
			host.writes.filter(
				([key, value]) =>
					/(?:lesson_status|completion_status)$/.test(key) &&
					["completed", "passed", "failed"].includes(value),
			),
		).toEqual([]);
	});

	it("a successor accepted in retirement's Commit prevents the older incoming objective", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const api = apiOf(host, format);
		const method = format === "scorm12" ? "LMSCommit" : "Commit";
		const commit = api[method].bind(api);
		let armed = true;
		let successor: ReturnType<typeof pending>;
		api[method] = () => {
			if (armed) {
				armed = false;
				host.provider.set("q", answer(changed));
				host.submit(50, false);
				successor = pending(host);
			}
			return commit();
		};
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(false);
		expect(objectiveValues(host)).toEqual([]);
		expect(pending(host)).toEqual(successor);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "50", "failed"]);
	});
});

it("retirement preserves the incoming provisional capture until its SCORM 1.2 aggregate save", () => {
	const host = launch("scorm12");
	host.seed();
	host.submit();
	host.provider.set("q", answer());
	expect(
		host.provider.stageSubmission?.("g", () => {
			expect(host.saveGroup({ ...groupState(), completed: false })).toBe(true);
			expect(
				host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
			).toBe(true);
			expect(host.provider.get("g")).toHaveProperty("completed", false);
			host.runtime.trackInteraction("g", "0%", false, 0, {
				contentSignature: groupSignature,
				memberIds: ["a"],
			});
			return true;
		}),
	).toBe(true);
	expect(host.provider.get("g")).toHaveProperty("completed", false);
	expect(pending(host)).toBeUndefined();
});

describe.each(["scorm12", "scorm2004"] as const)("acknowledged clear outcome %s", (format) => {
	it("a dirty capture read refreshes waiting before clear can flush queued completion", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.trackPageVisit("one");
		host.runtime.trackPageVisit("two");
		host.refuse(true);
		host.tracker.checkCompletion();
		host.refuse(false);
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		const get = host.provider.get.bind(host.provider);
		let armed = true;
		vi.spyOn(host.provider, "get").mockImplementation((id) => {
			const value = get(id);
			if (id === "g" && armed) {
				armed = false;
				host.provider.set("q", answer(changed));
			}
			return value;
		});
		host.writes.length = 0;
		host.tracker.checkCompletion();
		expect(armed).toBe(false);
		expect(
			host.writes.filter(
				([key, value]) =>
					/(?:lesson_status|completion_status)$/.test(key) &&
					["completed", "passed", "failed"].includes(value),
			),
		).toEqual([]);
		expect(pending(host)).toBeUndefined();
	});
});

describe.each(["scorm12", "scorm2004"] as const)("ordinary native reentry %s", (format) => {
	it("without replay or retirement keeps main's native storage order and result", () => {
		const host = launch(format);
		host.runtime.withSavedState?.(() => true);
		const api = apiOf(host, format);
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const set = api[method].bind(api);
		let armed = true;
		api[method] = (key: string, value: string) => {
			if (armed && key === "cmi.suspend_data") {
				armed = false;
				expect(host.runtime.setSuspendData('{"marker":"nested"}')).toBe(true);
			}
			return set(key, value);
		};
		host.writes.length = 0;
		expect(host.runtime.setSuspendData('{"marker":"outer"}')).toBe(true);
		expect(host.runtime.getSuspendData()).toBe('{"marker":"outer"}');
		expect(host.writes.filter(([key]) => key === "cmi.suspend_data")).toHaveLength(2);
	});
});

describe.each(["scorm12", "scorm2004"] as const)("retirement Commit epoch %s", (format) => {
	it("a newer decided write in retirement's Commit prevents the older objective even when capture bytes match", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const api = apiOf(host, format);
		const method = format === "scorm12" ? "LMSCommit" : "Commit";
		const commit = api[method].bind(api);
		let armed = true;
		api[method] = () => {
			if (armed) {
				armed = false;
				expect(
					host.tracker.trackGroupObjective("g", 50, false, host.runtime, undefined, groupSignature),
				).toBe(true);
			}
			return commit();
		};
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(false);
		expect(objectiveValues(host)).toEqual(["g", "50", "failed"]);
	});
});
