import { createHash } from "node:crypto";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import {
	withLearnerStateAuthority,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { dispatchSelfCheckEvent } from "@praxity/shared-blocks/self-check-consumers";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { getSessionState } from "../src/scorm/api/session";
import { XapiRuntime } from "../src/scorm/api/xapi";
import * as tracking from "../src/scorm/tracking";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";
import { selfCheckDocument } from "../template/src/self-check-document";
import { withChoiceDependencyStatus } from "./fixtures/choice-facts";

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const uuid = (seed: string) => {
	const hex = createHash("sha256").update(seed).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

describe("deferred objective storage boundary", () => {
	it("with no history, saves 42 UUID originals without an obligation and reloads every answer and row", () => {
		const host = launch("scorm12");
		Object.assign(host.dom.window, { __praxityBlockState: host.provider });
		const now = vi.spyOn(Date, "now");
		const originals = Array.from({ length: 42 }, (_, index) => {
			const id = uuid(`question-${index}`);
			const selected = uuid(`option-${index}-0`);
			return {
				id,
				state: {
					version: 1,
					kind: "assessment",
					assessmentType: "choice",
					attemptCount: 1,
					answer: [selected],
					checked: true,
					correct: true,
					completed: true,
					interacted: true,
				},
				row: {
					id,
					response: selected,
					correct: true,
					score: 100,
					attemptsUsed: 1,
					maxAttempts: 2,
					timestamp: 1760000000000 + index,
				},
			};
		});
		for (const [index, original] of originals.entries()) {
			now.mockReturnValue(original.row.timestamp);
			expect(host.tracker.outcome().kind).toBe("decided");
			expect(
				host.provider.stageSubmission?.(original.id, () => {
					writeLearnerBlockState(original.id, original.state, () => true, host.dom.window.document);
					return host.provider.getSaveResult?.(original.id)?.status !== "not-saved";
				}),
			).toBe(true);
			host.tracker.trackInteraction(original.id, original.row.response, true, 100, {
				assessmentType: "choice",
				attemptsUsed: 1,
				maxAttempts: 2,
			});
			expect(host.provider.getSaveResult?.(original.id)?.status).not.toBe("not-saved");
			const reload = new Scorm12Runtime();
			expect(reload.initialize()).toBe(true);
			const restored = createBlockStateRuntime(reload);
			expect(reload.getInteractions()).toEqual(
				originals.slice(0, index + 1).map((item) => item.row),
			);
			for (const item of originals.slice(0, index + 1))
				expect(restored.get(item.id)).toEqual(item.state);
			expect(host.values.get("cmi.suspend_data")?.length).toBeLessThanOrEqual(4096);
			expect(reload.getSuspendData()).not.toContain("deferredObjective");
			expect(reload.getSuspendData()).not.toContain("objectiveSequence");
		}
		expect(host.runtime.getInteractions()).toHaveLength(42);
		const before = host.values.get("cmi.suspend_data");
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, groupSignature);
		expect(host.values.get("cmi.suspend_data")).toBe(before);
	});

	it.each(["q", "g"])(
		"an oversized %s save with a pending objective preserves bytes, receipt, answer and obligation",
		(id) => {
			const host = launch("scorm12");
			host.seed();
			host.submit();
			Object.assign(host.dom.window, { __praxityBlockState: host.provider });
			const previousAnswer = host.provider.get("q");
			const previousGroup = host.stored();
			expect(previousGroup.submitted.deferredObjective).toEqual({
				id: "1",
				score: 100,
				passed: true,
			});
			const before = host.values.get("cmi.suspend_data");
			const notes = Array.from({ length: 512 }, (_, index) =>
				createHash("sha256").update(`retained-note-${index}`).digest("hex"),
			).join("");
			const proposed = id === "q" ? { ...answer(), notes } : { ...groupState(), notes };
			expect(
				host.provider.stageSubmission?.(id, () => {
					writeLearnerBlockState(id, proposed, () => true, host.dom.window.document);
					return host.provider.getSaveResult?.(id)?.status !== "not-saved";
				}),
			).toBe(true);
			expect(() => host.tracker.trackInteraction(id, "a", true, 100)).toThrow(/ESCORM12STORAGE/);
			expect(host.values.get("cmi.suspend_data")).toBe(before);
			expect(host.provider.getSaveResult?.(id)).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			});
			expect(host.runtime.commit()).toBe(true);
			expect(host.provider.getSaveResult?.(id)).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			});
			expect(host.provider.get("q")).toEqual(previousAnswer);
			expect(host.stored()).toEqual(previousGroup);
			expect(host.objectives()).toEqual([]);
			expect(
				host.writes
					.filter(([key]) => key === "cmi.suspend_data")
					.every(([, value]) => value.length <= 4096),
			).toBe(true);
			host.replace(true);
			expect(host.provider.get("q")).toEqual(previousAnswer);
			expect(host.stored()).toEqual(previousGroup);
			host.repair();
			host.tracker.checkCompletion();
			expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		},
	);
});

describe.each(["scorm2004", "xapi"] as const)("%s objective-first submission", (format) => {
	for (const score of [100, 0])
		it(`the following group save retains ${score} and replays it after reload`, () => {
			const host = launch(format);
			host.provider.set("q", answer(changed));
			host.runtime.trackInteraction("a", "answer", true, 100);
			host.runtime.trackInteraction("q", "a", true, 100);
			if (score === 0) host.provider.set("g", groupState() as LearnerStateValue);
			// The host handles the event and interaction before the group owner saves its capture.
			host.tracker.trackGroupObjective("g", score, score === 100, host.runtime, groupSignature);
			host.tracker.trackInteraction("g", `${score}%`, score === 100, score);
			expect(host.saveGroup()).toBe(true);
			host.runtime.commit();
			expect(host.objectives()).toEqual([]);
			host.replace(true);
			host.repair();
			host.tracker.checkCompletion();
			expect(host.objectives().map(([, value]) => value)).toEqual([
				"g",
				String(score),
				score === 100 ? "passed" : "failed",
			]);
		});
});

describe.each(["scorm12", "scorm2004"] as const)("%s round-one regressions", (format) => {
	it("a refused acknowledgement clear does not repeat the objective after reload", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.trackInteraction("q", "a", true, 100);
		const before = host.runtime.getSuspendData();
		host.refuse(true);
		host.tracker.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		expect(host.runtime.getSuspendData()).toBe(before);
		host.refuse(false);
		host.replace(true);
		host.tracker.checkCompletion();
		host.tracker.prepareCommit();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});

	it("replacement during the objective write shares replay ownership and acknowledgement", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let current = true;
		const tracker = new CourseTracker(
			withLearnerStateAuthority(host.runtime, () => current),
			{
				...host.config(),
				writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
					host.provider,
					() => current,
					host.ledger() ?? {},
				),
			},
		);
		const original = host.runtime.trackObjective.bind(host.runtime);
		const report = vi
			.spyOn(host.runtime, "trackObjective")
			.mockImplementation((id, score, passed) => {
				original(id, score, passed);
				current = false;
				report.mockRestore();
				host.replace(true);
				host.tracker.checkCompletion();
			});
		tracker.checkCompletion();
		host.tracker.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});

	for (const score of [NaN, Infinity, -Infinity, -1, 101, 1e21, "100"])
		it(`incoming score ${score} refuses before changing any durable evidence`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const before = host.runtime.getSuspendData();
			expect(() => host.tracker.trackGroupObjective("g", score as number, true)).toThrow(
				"Invalid group objective values",
			);
			expect(host.runtime.getSuspendData()).toBe(before);
			host.replace(true);
			host.repair();
			expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		});

	it("invalid incoming pass/fail preserves the previous obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const before = host.runtime.getSuspendData();
		expect(() =>
			host.tracker.trackGroupObjective("g", 100, "passed" as unknown as boolean),
		).toThrow("Invalid group objective values");
		expect(host.runtime.getSuspendData()).toBe(before);
	});

	for (const score of [-1, 101, 1e21])
		it(`saved score ${score} keeps its raw record and refuses a later group overwrite`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const saved = host.stored();
			host.provider.set("g", {
				...saved,
				submitted: {
					...saved.submitted,
					deferredObjective: { ...saved.submitted.deferredObjective, score },
				},
			} as LearnerStateValue);
			host.replace(true);
			host.repair();
			expect(host.objectives()).toEqual([]);
			const before = host.runtime.getSuspendData();
			expect(() => host.saveGroup()).toThrow("Invalid deferred group objective");
			expect(host.runtime.getSuspendData()).toBe(before);
		});

	it("the admitted evidence view is built once for an outcome write", () => {
		const host = launch(format);
		host.seed();
		const getChoiceDependencyView = vi.fn(host.evidence);
		const tracker = new CourseTracker(host.runtime, { ...host.config(), getChoiceDependencyView });
		tracker.checkCompletion();
		expect(getChoiceDependencyView).toHaveBeenCalledTimes(1);
	});

	it("a later submission keeps a fresh identity after an acknowledged clear and group rewrite", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.repair();
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
		host.saveGroup();
		host.provider.set("q", answer(changed));
		host.tracker.trackGroupObjective("g", 0, false);
		expect(host.stored().submitted.deferredObjective?.id).toBe("2");
		host.replace(true);
		host.repair();
		expect(host.objectives().map(([, value]) => value)).toEqual([
			"g",
			"100",
			"passed",
			"g",
			"0",
			"failed",
		]);
	});

	for (const sequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER])
		it(`refuses sequence ${sequence} without replacing evidence`, () => {
			const host = launch(format);
			host.seed();
			host.provider.set("g", { ...groupState(), objectiveSequence: sequence } as LearnerStateValue);
			const before = host.runtime.getSuspendData();
			expect(() => host.tracker.trackGroupObjective("g", 0, false)).toThrow();
			expect(host.runtime.getSuspendData()).toBe(before);
		});

	it("a new submitted capture does not inherit the previous obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.saveGroup({
			...groupState(),
			submitted: { ...submission(), contentSignature: changed },
		} as LearnerStateValue);
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
		host.replace(true);
		host.repair();
		expect(host.objectives()).toEqual([]);
	});

	it("a malformed evidence reference refuses before writing", () => {
		const host = launch(format);
		host.seed();
		const before = host.runtime.getSuspendData();
		expect(() => host.tracker.trackGroupObjective("g", 0, false, host.runtime, "broken")).toThrow(
			"Missing group objective evidence",
		);
		expect(host.runtime.getSuspendData()).toBe(before);
	});
});

describe("objective-first save handoff", () => {
	it("keeps non-group saves, including null, unchanged", () => {
		const host = launch("scorm2004");
		Object.assign(host.dom.window, { __praxityBlockState: host.provider });
		expect(writeLearnerBlockState("ordinary", null, () => true, host.dom.window.document)).toBe(
			true,
		);
		expect(host.provider.get("ordinary")).toBeNull();
	});

	it("requires a launch ledger rather than silently using a writer-local acknowledgement", () => {
		const host = launch("scorm2004");
		expect(() =>
			tracking.createDeferredGroupObjectiveWriter?.(host.provider, () => true, undefined as never),
		).toThrow("launch replay ledger");
	});

	it("a revoked obligation owner refuses a following save without changing durable bytes", () => {
		const host = launch("scorm2004");
		host.seed();
		tracking.createDeferredGroupObjectiveWriter?.(host.provider, () => false, host.ledger() ?? {});
		const before = host.runtime.getSuspendData();
		expect(() => host.saveGroup()).toThrow("EACTIVITYPROVIDER");
		expect(host.runtime.getSuspendData()).toBe(before);
	});

	it("a capture mismatch consumes the handoff without attaching it to a later save", () => {
		const host = launch("scorm2004");
		host.seed();
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, changed);
		host.saveGroup();
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
		host.saveGroup({
			...groupState(),
			submitted: { ...submission(), contentSignature: changed },
		} as LearnerStateValue);
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});

	it("a mismatched handoff preserves the preceding saved obligation", () => {
		const host = launch("scorm2004");
		host.seed();
		host.submit();
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, changed);
		host.saveGroup();
		expect(host.stored().submitted.deferredObjective).toEqual({
			id: "1",
			score: 100,
			passed: true,
		});
	});

	it("clearing an older acknowledgement does not consume the following submission's handoff", () => {
		const host = launch("scorm2004");
		host.seed();
		host.submit();
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, changed);
		host.repair();
		host.saveGroup({
			...groupState(),
			submitted: { ...submission(), contentSignature: changed },
		} as LearnerStateValue);
		expect(host.stored().submitted.deferredObjective).toEqual({ id: "2", score: 0, passed: false });
	});

	it("a refused first group save cannot attach the old handoff to a later save", () => {
		const host = launch("scorm2004");
		host.provider.set("q", answer(changed));
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, groupSignature);
		host.refuse(true);
		host.saveGroup();
		host.refuse(false);
		expect(host.provider.get("g")).toBeUndefined();
		host.saveGroup();
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});

	it("finishing one save does not discard a reentrant successor handoff", () => {
		const host = launch("scorm2004");
		host.provider.set("q", answer(changed));
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, groupSignature);
		const set = host.provider.set.bind(host.provider);
		let once = true;
		vi.spyOn(host.provider, "set").mockImplementation((id, value) => {
			set(id, value);
			if (id === "g" && once) {
				once = false;
				host.tracker.trackGroupObjective("g", 0, false, host.runtime, changed);
			}
		});
		host.saveGroup();
		host.saveGroup({
			...groupState(),
			submitted: { ...submission(), contentSignature: changed },
		} as LearnerStateValue);
		expect(host.stored().submitted.deferredObjective).toEqual({ id: "2", score: 0, passed: false });
	});
});

const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const changed = "sha256:b1b74fa98c26909745962fa6d5f98b01897f03a1fa9bcbf35461c4213b407702";
const groupSignature = "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2";
const submission = () => ({
	payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
	contentSignature: groupSignature,
});
const groupState = (objectiveSequence?: number) => ({
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
	submitted: submission(),
	...(objectiveSequence ? { objectiveSequence } : {}),
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

function launch(format: "scorm12" | "scorm2004" | "xapi") {
	const dom = new JSDOM("", { url: "https://course.example/one.html" });
	documents.push(dom);
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
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
	const xapiLedger: tracking.GroupObjectiveReplayLedger = {};
	const ledger = () =>
		format === "xapi"
			? xapiLedger
			: getSessionState(
					(dom.window as unknown as { API: object; API_1484_11: object })[
						format === "scorm12" ? "API" : "API_1484_11"
					],
				);
	const open = () => {
		const runtime =
			format === "scorm12"
				? new Scorm12Runtime()
				: format === "scorm2004"
					? new Scorm2004Runtime(dom.window as unknown as Window)
					: Object.assign(
							new XapiRuntime(
								{
									endpoint: "https://lrs.example/statements",
									auth: "",
									actorMode: "manual",
									actor: { name: "Learner", mbox: "mailto:learner@example.com" },
								},
								"course",
								dom.window.localStorage,
							),
							{
								trackObjective(id: string, score: number, passed: boolean) {
									writes.push(
										["objective.id", id],
										["objective.score", String(score)],
										["objective.status", passed ? "passed" : "failed"],
									);
								},
							},
						);
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
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
				provider,
				() => true,
				ledger() ?? {},
			),
		}) as TrackingConfig;
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
		ledger,
		saveGroup(value: LearnerStateValue = groupState() as LearnerStateValue) {
			Object.assign(dom.window, { __praxityBlockState: provider });
			return writeLearnerBlockState("g", value, () => true, dom.window.document);
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
			expect(host.stored()).toEqual(groupState(1));
			host.replace(true);
			host.tracker.checkCompletion();
			expect(host.objectives()).toHaveLength(3);
		});

	it("stores only an obligation identity and values beside submitted evidence", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const record = host.stored().submitted.deferredObjective;
		expect(record).toEqual({ id: "1", score: 100, passed: true });
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
				writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
					host.provider,
					() => false,
					host.ledger() ?? {},
				),
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

	it("reentrant checks write once and clear only the acknowledged obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const original = host.runtime.trackObjective.bind(host.runtime);
		const report = vi
			.spyOn(host.runtime, "trackObjective")
			.mockImplementation((id, score, passed) => {
				original(id, score, passed);
				host.tracker.checkCompletion();
				const saved = host.stored();
				host.provider.set("g", {
					...saved,
					submitted: {
						...saved.submitted,
						deferredObjective: { id: "successor", score: 0, passed: false },
					},
				});
			});
		host.provider.set("q", answer());
		host.tracker.checkCompletion();
		expect(report).toHaveBeenCalledTimes(1);
		expect(host.stored().submitted.deferredObjective).toEqual({
			id: "successor",
			score: 0,
			passed: false,
		});
		report.mockRestore();
		host.tracker.checkCompletion();
		host.tracker.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual([
			"g",
			"100",
			"passed",
			"g",
			"0",
			"failed",
		]);
	});

	it("a decided submission supersedes its deferred objective only after acknowledgement", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const report = vi.spyOn(host.runtime, "trackObjective").mockImplementation(() => false);
		host.tracker.trackGroupObjective("g", 0, false);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		report.mockRestore();
		host.tracker.trackGroupObjective("g", 0, false);
		host.tracker.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "0", "failed"]);
		expect(host.stored()).toEqual(groupState(1));
	});

	it("a reentrant capture removal cannot make acknowledgement overwrite it or throw", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const original = host.runtime.trackObjective.bind(host.runtime);
		const replacement = {
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: false,
		};
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((id, score, passed) => {
			original(id, score, passed);
			host.provider.set("g", replacement);
		});
		expect(() => host.tracker.checkCompletion()).not.toThrow();
		expect(host.provider.get("g")).toEqual(replacement);
	});

	it("unacknowledged provider memory cannot replay an unsaved obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const saved = host.stored();
		expect(saved.submitted.deferredObjective?.score).toBe(100);
		const provider = {
			...host.provider,
			getSaveResult: () => ({ status: "not-saved" as const, code: "storage-unavailable" as const }),
		};
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
				provider,
				() => true,
				host.ledger() ?? {},
			),
		} as TrackingConfig);
		host.provider.set("q", answer());
		tracker.checkCompletion();
		expect(host.objectives()).toEqual([]);
	});

	for (const field of ["id", "score", "passed"] as const)
		it(`rejects a malformed obligation ${field}`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const saved = host.stored();
			expect(saved.submitted.deferredObjective?.score).toBe(100);
			host.provider.set("g", {
				...saved,
				submitted: {
					...saved.submitted,
					deferredObjective: { ...saved.submitted.deferredObjective, [field]: null },
				},
			});
			host.replace(true);
			host.repair();
			expect(host.objectives()).toEqual([]);
			const before = host.runtime.getSuspendData();
			expect(() => host.saveGroup()).toThrow("Invalid deferred group objective");
			expect(host.runtime.getSuspendData()).toBe(before);
		});

	it("announce replacement replays the saved obligation with fresh provider authority", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("g", {
			version: 1,
			kind: "assessmentGroup",
			mode: "all",
			selectedMemberId: null,
			completed: false,
		});
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
			requiredAssessmentIds: ["q"],
			pageRole: "content",
			strings: {},
		};
		win.document.body.innerHTML = `<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
		Object.defineProperty(win.document, "readyState", { value: "complete" });
		expect(
			initializeScormCourseHost(
				{ format, readEntry: () => null, createRuntime: () => host.runtime },
				{
					win,
					doc: win.document,
					location: { href: win.location.href, search: "", replace() {} },
					history: win.history,
				},
			),
		).toBe(true);
		const first = win.__praxityTracker as CourseTracker;
		dispatchSelfCheckEvent(
			new win.CustomEvent("praxity:assessment-group-complete", {
				detail: { groupId: "g", score: 100, passed: true, contentSignature: groupSignature },
			}),
			() => true,
			win.document,
		);
		expect(
			writeLearnerBlockState("g", groupState() as LearnerStateValue, () => true, win.document),
		).toBe(true);
		host.runtime.commit();
		expect(host.objectives()).toEqual([]);
		owner.reset();
		const successor = win.__praxityTracker as CourseTracker;
		expect(successor).not.toBe(first);
		host.provider.set("q", answer());
		first.checkCompletion();
		expect(host.objectives()).toEqual([]);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		successor.trackInteraction("q", "a", true, 100);
		successor.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		owner.dispose();
	});

	it("a decided objective through the evidence view stays objective-first with no obligation", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("q", answer());
		host.writes.length = 0;
		host.tracker.trackGroupObjective("g", 100, true);
		expect(host.writes.map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		expect(host.stored()).toEqual(groupState());
	});

	it("only compiled groups can acquire a deferred objective", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		host.provider.set("other", groupState() as LearnerStateValue);
		const before = host.runtime.getSuspendData();
		host.tracker.trackGroupObjective("other", 100, true);
		expect(host.runtime.getSuspendData()).toBe(before);
	});

	it("a newer deferred submission owns a fresh identity and its latest objective values", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const previous = host.stored().submitted.deferredObjective;
		expect(previous?.score).toBe(100);
		host.tracker.trackGroupObjective("g", 0, false);
		const latest = host.stored().submitted.deferredObjective;
		expect(latest?.id).not.toBe(previous?.id);
		expect(latest?.score).toBe(0);
		host.replace(true);
		host.repair();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "0", "failed"]);
	});

	it("a null obligation is rejected without replacing durable evidence", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const saved = host.stored();
		expect(saved.submitted.deferredObjective?.score).toBe(100);
		host.provider.set("g", {
			...saved,
			submitted: { ...saved.submitted, deferredObjective: null },
		});
		const before = host.runtime.getSuspendData();
		expect(() => host.tracker.trackGroupObjective("g", 0, false)).toThrow(
			"Invalid deferred group objective",
		);
		expect(host.runtime.getSuspendData()).toBe(before);
		host.replace(true);
		host.repair();
		expect(host.objectives()).toEqual([]);
	});

	it("a refused replay keeps the obligation until a writer acknowledges it", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const report = vi.spyOn(host.runtime, "trackObjective").mockImplementation(() => false);
		host.tracker.checkCompletion();
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		report.mockRestore();
		host.tracker.checkCompletion();
		expect(host.objectives().map(([, value]) => value)).toEqual(["g", "100", "passed"]);
	});

	for (const [name, patch] of [
		["version", { version: 2 }],
		["kind", { kind: "assessment" }],
		["mode", { mode: "invalid", selectedMemberId: "a" }],
		["completed", { completed: null }],
		["all selection", { selectedMemberId: "a" }],
		["oneOf selection", { mode: "oneOf", selectedMemberId: null }],
		["submission", { submitted: null }],
		["signature", { submitted: { ...submission(), contentSignature: "broken" } }],
	] as const)
		it(`malformed group ${name} cannot replace durable evidence`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			expect(host.stored().submitted.deferredObjective?.score).toBe(100);
			host.provider.set("g", { ...host.stored(), ...patch } as LearnerStateValue);
			const before = host.runtime.getSuspendData();
			expect(() => host.tracker.trackGroupObjective("g", 0, false)).toThrow();
			expect(host.runtime.getSuspendData()).toBe(before);
		});
});
