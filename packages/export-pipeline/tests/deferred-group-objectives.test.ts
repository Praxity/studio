import { createHash } from "node:crypto";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import {
	withLearnerStateAuthority,
	writeCourseOutcome,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
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
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import * as tracking from "../src/scorm/tracking";
import { CourseTracker, type TrackingConfig } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import {
	initializeCourseHost,
	initializeScormCourseHost,
	readCourseDeploymentConfig,
} from "../template/src/hosts/course-host";
import { selfCheckDocument } from "../template/src/self-check-document";
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
const groupState = (_unused?: number) => ({
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

function launch(format: "scorm12" | "scorm2004" | "xapi" | "standalone") {
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
				: format === "scorm2004"
					? new Scorm2004Runtime(dom.window as unknown as Window)
					: format === "standalone"
						? new LocalStorageRuntime(dom.window.localStorage, "course")
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
				tracker.trackInteraction("g", `${score}%`, passed, score);
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

function installHost(
	host: ReturnType<typeof launch>,
	format: "scorm12" | "scorm2004" | "xapi" | "standalone",
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
		(format === "xapi" || format === "standalone"
			? initializeCourseHost
			: initializeScormCourseHost)(
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const objectiveValues = (host: ReturnType<typeof launch>) =>
	host.objectives().map(([, value]) => value);

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
	const provider = win.__praxityBlockState!;
	const accepted = provider.stageSubmission
		? provider.stageSubmission("g", () => save() && report())
		: report();
	if (accepted && !provider.stageSubmission) save();
	return { event, accepted };
}

describe.each(["scorm12", "scorm2004"] as const)("%s revised lifecycle literals", (format) => {
	it("1: objective-first signed event, interaction, capture, Commit and two waiting reloads replay the frozen result", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		const { accepted, event } = submitEvent(host, win);
		expect(accepted).toBe(true);
		expect(event.defaultPrevented).toBe(false);
		expect(host.runtime.commit()).toBe(true);
		owner.dispose();
		host.replace(true);
		host.tracker.checkCompletion();
		host.replace(true);
		expect(objectiveValues(host)).toEqual([]);
		host.repair();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("2: refused clear survives check, Commit preparation, tracker replacement and two reopened adapters", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.trackInteraction("q", "a", true, 100);
		host.refuse(true);
		host.tracker.checkCompletion();
		host.tracker.prepareCommit();
		host.replace(false);
		host.tracker.checkCompletion();
		host.replace(true);
		host.tracker.checkCompletion();
		host.replace(true);
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.refuse(false);
		host.tracker.checkCompletion();
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});

	it("2: a native objective callback can replace the tracker without replaying or clearing its successor", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const original = host.runtime.trackObjective!.bind(host.runtime);
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((id, score, passed) => {
			original(id, score, passed);
			host.replace(true);
			host.tracker.checkCompletion();
			host.provider.set("q", answer(changed));
			host.submit(0, false);
		});
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(host.stored().submitted.deferredObjective).toMatchObject({ score: 0, passed: false });
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});

	for (const score of [NaN, Infinity, -Infinity, "100", -1, 101, 1e21])
		it(`3: invalid incoming score ${score} preserves the exact prior capture and bytes`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const before = host.runtime.getSuspendData();
			expect(
				host.tracker.trackGroupObjective(
					"g",
					score as number,
					true,
					host.runtime,
					undefined,
					groupSignature,
				),
			).toBe(false);
			expect(host.runtime.getSuspendData()).toBe(before);
			host.repair();
			expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		});
	it("3: nonboolean pass flag refuses without replacing evidence", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const before = host.runtime.getSuspendData();
		expect(
			host.tracker.trackGroupObjective(
				"g",
				100,
				"yes" as never,
				host.runtime,
				undefined,
				groupSignature,
			),
		).toBe(false);
		expect(host.runtime.getSuspendData()).toBe(before);
	});

	for (const raw of [
		null,
		{ id: "broken", score: 100, passed: true },
		...[-1, 101, 1e21, null].map((score) => ({
			id: "79db090b-3852-4eab-8a6e-49eaa106c3ff",
			score,
			passed: true,
		})),
	])
		it(`4/10/17: saved ${JSON.stringify(raw)} stays rejected while a valid capture proceeds`, () => {
			const host = launch(format);
			host.seed();
			host.provider.set("g", {
				...groupState(),
				submitted: {
					...submission(),
					deferredObjective: raw,
					unknownOldCaptureField: "do not copy",
				},
			} as LearnerStateValue);
			host.replace(true);
			host.tracker.checkCompletion();
			expect(objectiveValues(host)).toEqual([]);
			const { win, owner } = installHost(host, format);
			const commit = vi.spyOn(host.runtime, "commit");
			const { accepted, event } = submitEvent(host, win);
			expect(accepted).toBe(true);
			expect(event.defaultPrevented).toBe(false);
			expect(commit).toHaveBeenCalled();
			expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 100 });
			const state = win.__praxityBlockState?.get("g") as Record<string, unknown>;
			expect(state.rejectedObjectives).toEqual([{ field: "deferredObjective", value: raw }]);
			expect(state.submitted).not.toHaveProperty("unknownOldCaptureField");
			expect(state.submitted).toMatchObject({
				deferredObjective: { id: expect.stringMatching(uuidPattern), score: 100, passed: true },
			});
			owner.dispose();
			host.replace(true);
			host.repair();
			expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		});
	for (const score of [0, 99.5, 100])
		it(`4: boundary score ${score} replays literally`, () => {
			const host = launch(format);
			host.seed();
			host.submit(score, false);
			host.replace(true);
			host.repair();
			expect(objectiveValues(host)).toEqual(["g", String(score), "failed"]);
		});

	it("6: ordinary evidence is built once; a candidate cannot replay another saved group's obligation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const ordinaryView = () => {
			const view = host.evidence();
			return {
				...view,
				groups: {
					...view.groups,
					other: { mode: "all" as const, memberIds: ["a"], requiredIds: ["a"] },
				},
			};
		};
		const build = vi.fn(ordinaryView);
		const tracker = new CourseTracker(host.runtime, {
			...host.config(),
			getChoiceDependencyView: build,
		});
		tracker.checkCompletion();
		expect(build).toHaveBeenCalledTimes(1);
		build.mockClear();
		const candidate = { ...ordinaryView(), status: () => "current" as const };
		tracker.trackGroupObjective("other", 0, false, host.runtime, candidate, groupSignature);
		expect(build).toHaveBeenCalledTimes(1);
		expect(objectiveValues(host)).toEqual(["other", "0", "failed"]);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
	});

	it("8: new launch on the same API clears acknowledgement and each identical submission has a UUID", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const first = host.stored().submitted.deferredObjective?.id;
		expect(first).toMatch(uuidPattern);
		host.submit();
		expect(host.stored().submitted.deferredObjective?.id).not.toBe(first);
		host.repair();
		const api = format === "scorm12" ? host.dom.window.API : host.dom.window.API_1484_11;
		resetSessionState(api!, host.dom.window as unknown as Window);
		host.values.clear();
		host.replace(true);
		host.seed();
		host.submit(0, false);
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});
	it("8: a retained refused-clear record may replay once in a new launch", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		host.tracker.checkCompletion();
		host.refuse(false);
		const api = format === "scorm12" ? host.dom.window.API : host.dom.window.API_1484_11;
		resetSessionState(api!, host.dom.window as unknown as Window);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "100", "passed"]);
	});

	for (const ref of [groupSignature, changed])
		it(`9: a refused ${ref === changed ? "changed" : "same"} signature capture keeps the old 100 as the replay source`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const before = host.runtime.getSuspendData();
			expect(host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, ref)).toBe(
				true,
			);
			expect(host.runtime.getSuspendData()).toBe(before);
			host.refuse(true);
			const save = () =>
				host.saveGroup({ ...groupState(), submitted: { ...submission(), contentSignature: ref } });
			if (host.provider.stageSubmission) {
				host.provider.stageSubmission("g", () => {
					save();
					return true;
				});
				expect(() => host.tracker.trackInteraction("g", "0%", false, 0)).toThrow();
			} else {
				host.tracker.trackInteraction("g", "0%", false, 0);
				save();
			}
			host.refuse(false);
			host.repair();
			host.replace(true);
			host.tracker.checkCompletion();
			expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		});

	for (const existing of [false, true])
		it(`11: unsigned event refuses before capture mutation, existing=${existing}; a signed successor succeeds`, () => {
			const host = launch(format);
			host.seed();
			if (existing) host.submit();
			host.tracker.trackGroupObjective("g", 100, true, host.runtime, undefined, groupSignature);
			const { win, owner } = installHost(host, format);
			const before = win.__praxityBlockState?.get("g");
			const bad = submitEvent(host, win, { contentSignature: undefined });
			expect(bad.accepted).toBe(false);
			expect(bad.event.defaultPrevented).toBe(true);
			expect(win.__praxityBlockState?.get("g")).toEqual(before);
			const good = submitEvent(host, win);
			expect(good.accepted).toBe(true);
			owner.dispose();
		});

	for (const raw of [-1, 1.5, "damaged", Number.MAX_SAFE_INTEGER])
		it(`14: raw sequence ${raw} survives picker, retry, clear and new submission without counter parsing`, () => {
			const host = launch(format);
			host.seed();
			host.provider.set("g", { ...groupState(), objectiveSequence: raw } as LearnerStateValue);
			expect(() => host.saveGroup({ ...groupState(), completed: false })).not.toThrow();
			host.submit();
			const first = host.stored().submitted.deferredObjective?.id;
			host.repair();
			host.saveGroup();
			host.provider.set("q", answer(changed));
			host.submit(0, false);
			expect(host.stored()).not.toHaveProperty("objectiveSequence");
			expect(host.stored()).toHaveProperty("rejectedObjectives", [
				{ field: "objectiveSequence", value: raw },
			]);
			expect(host.stored().submitted.deferredObjective?.id).toMatch(uuidPattern);
			expect(host.stored().submitted.deferredObjective?.id).not.toBe(first);
		});

	it("15: re-admission between event and capture retains the original handoff", () => {
		const host = launch(format);
		host.seed();
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, undefined, groupSignature);
		tracking.createDeferredGroupObjectiveWriter(host.provider, () => true, host.ledger()!);
		host.saveGroup();
		expect(host.stored().submitted.deferredObjective).toMatchObject({
			id: expect.stringMatching(uuidPattern),
			score: 100,
			passed: true,
		});
	});
	it("15: revoked queued authority explicitly refuses adoption and cannot replay or clear", () => {
		const host = launch(format);
		host.seed();
		let current = true;
		const writer = tracking.createDeferredGroupObjectiveWriter(
			host.provider,
			() => current,
			host.ledger()!,
		)!;
		writer(host.runtime, { kind: "waiting" }, host.evidence(), {
			id: "g",
			score: 100,
			passed: true,
			contentSignature: groupSignature,
		});
		current = false;
		const before = host.runtime.getSuspendData();
		expect(host.saveGroup()).toBe(false);
		expect(host.runtime.getSuspendData()).toBe(before);
		expect(writer(host.runtime, { kind: "decided" }, host.evidence())).toBe(false);
		expect(objectiveValues(host)).toEqual([]);
	});

	it("16: decided host retains objective, interaction, save order and optional refusal cannot cancel a valid capture", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("q", answer());
		const { win, owner } = installHost(host, format);
		const order: string[] = [];
		const report = host.runtime.trackObjective!.bind(host.runtime);
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((...args) => {
			order.push("objective");
			report(...args);
		});
		const interact = host.runtime.trackInteraction.bind(host.runtime);
		vi.spyOn(host.runtime, "trackInteraction").mockImplementation((...args) => {
			order.push("interaction");
			interact(...args);
		});
		const save = win.__praxityBlockState!.saveGroupObjective!.bind(win.__praxityBlockState!);
		vi.spyOn(win.__praxityBlockState!, "saveGroupObjective").mockImplementation(
			(id, state, current) => {
				if (id === "g") order.push("save");
				return save(id, state, current);
			},
		);
		expect(submitEvent(host, win).accepted).toBe(true);
		expect(order).toEqual(
			format === "scorm12"
				? ["save", "objective", "interaction"]
				: ["objective", "interaction", "save"],
		);
		vi.mocked(host.runtime.trackObjective!).mockImplementation(() => false);
		expect(submitEvent(host, win).accepted).toBe(true);
		owner.dispose();
	});

	it("18: SetValue acceptance with refused Commit cannot replay; a later successful Commit permits one invocation", () => {
		const host = launch(format);
		host.seed();
		host.runtime.commit();
		host.refuseCommit(true);
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, undefined, groupSignature);
		host.saveGroup();
		expect(host.runtime.commit()).toBe(false);
		host.provider.set("q", answer());
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual([]);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		expect(
			host.provider.confirmGroupObjective?.(
				"g",
				() => true,
				() => true,
			),
		).toBe(false);
		host.refuseCommit(false);
		host.tracker.checkCompletion();
		host.tracker.prepareCommit();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});
	it("18: refused removal Commit retains the committed obligation across document replacement without duplicate invocation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.commit();
		const native = host.runtime.trackObjective!.bind(host.runtime);
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((...args) => {
			native(...args);
			host.refuseCommit(true);
		});
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		host.crash();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		host.refuseCommit(false);
		host.tracker.checkCompletion();
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});
});

describe.each(["xapi", "standalone"] as const)("%s missing objective sink", (format) => {
	for (const waiting of [true, false])
		it(`12: real adapter accepts a valid ${waiting ? "waiting" : "decided"} capture, records interaction and commits`, () => {
			const host = launch(format);
			host.seed();
			if (!waiting) host.repair();
			expect("trackObjective" in host.runtime).toBe(false);
			expect(host.provider.getSaveResult).toBeUndefined();
			expect(
				tracking.createDeferredGroupObjectiveWriter(host.provider, () => true, {}),
			).toBeUndefined();
			expect(host.provider.prepareGroupState).toBeUndefined();
			const { win, owner } = installHost(host, format);
			const commit = vi.spyOn(host.runtime, "commit");
			expect(submitEvent(host, win).accepted).toBe(true);
			expect(commit).toHaveBeenCalled();
			expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 100 });
			expect(win.__praxityBlockState?.get("g")).toEqual(groupState());
			expect(objectiveValues(host)).toEqual([]);
			expect(submitEvent(host, win, { contentSignature: changed }).accepted).toBe(false);
			owner.dispose();
			host.replace(true);
			expect(host.stored()).toEqual(groupState());
		});
	it("12: missing objective method is a successful no-op", () => {
		const host = launch(format);
		expect(
			writeCourseOutcome(host.runtime, {
				kind: "decided",
				objective: { id: "g", score: 100, passed: true },
			}),
		).toBe(true);
	});
});
it("13: refused real xAPI page-memory storage never installs an obligation or objective operation", () => {
	const host = launch("xapi");
	host.seed();
	vi.spyOn(Object.getPrototypeOf(host.dom.window.localStorage), "setItem").mockImplementation(
		() => {
			throw new Error("storage refused");
		},
	);
	const { win, owner } = installHost(host, "xapi");
	expect(submitEvent(host, win).accepted).toBe(true);
	host.repair();
	owner.dispose();
	host.replace(true);
	host.tracker.checkCompletion();
	expect(objectiveValues(host)).toEqual([]);
	expect(host.runtime.getSuspendData()).not.toContain("deferredObjective");
});
it("17: multiple rejected values survive capture replacement without old unknown fields", () => {
	const first = {
		...groupState(),
		submitted: { ...submission(), deferredObjective: null, oldOnly: true },
		objectiveSequence: "damaged",
	};
	const second = {
		...groupState(),
		submitted: { ...submission(), deferredObjective: { score: 101 } },
		objectiveSequence: -1,
	};
	const saved = prepareGroupObjectiveSave(first, second) as Record<string, LearnerStateValue>;
	expect(saved.submitted).toEqual(submission());
	expect(saved).not.toHaveProperty("objectiveSequence");
	expect(saved.rejectedObjectives).toEqual([
		{ field: "objectiveSequence", value: "damaged" },
		{ field: "deferredObjective", value: null },
		{ field: "objectiveSequence", value: -1 },
		{ field: "deferredObjective", value: { score: 101 } },
	]);
	expect(readDeferredGroupObjective(saved)).toBeUndefined();
});

describe.each(["scorm12", "scorm2004"] as const)("%s lifecycle controls", (format) => {
	it("1: ordinary unsigned callers retain the literal objective-first log with no record", () => {
		const host = launch(format);
		host.seed();
		const tracker = new CourseTracker(host.runtime, {
			totalPages: 2,
			completionMethod: "allPages",
		});
		host.writes.length = 0;
		tracker.trackGroupObjective("g", 100, true);
		expect(host.writes.map(([, value]) => value)).toEqual(["g", "100", "passed"]);
		expect(host.stored()).toEqual(groupState());
	});
	it("2: replacement from Commit preparation cannot race the launch claim after a refused clear", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.refuse(true);
		let once = true;
		host.runtime.setCommitPreparation?.(() => {
			if (once) {
				once = false;
				host.replace(true);
				host.tracker.checkCompletion();
			}
		});
		host.tracker.checkCompletion();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});
	it("2/16: a decided native callback cannot replay the superseded pending result", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const native = host.runtime.trackObjective!.bind(host.runtime);
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((...args) => {
			native(...args);
			host.replace(true);
			host.tracker.checkCompletion();
		});
		host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature);
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
	});
	it("3/16: invalid signed score cancels the assembled candidate before its interaction or capture", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const { win, owner } = installHost(host, format);
		const before = win.__praxityBlockState?.get("g");
		const rows = host.runtime.getInteractions();
		expect(submitEvent(host, win, { score: 101 }).accepted).toBe(false);
		expect(win.__praxityBlockState?.get("g")).toEqual(before);
		expect(host.runtime.getInteractions()).toEqual(rows);
		owner.dispose();
	});
	it("9: retrying a refused save retains the UUID allocated for that submission", () => {
		const host = launch(format);
		host.seed();
		const id = "79db090b-3852-4eab-8a6e-49eaa106c3ff";
		vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, undefined, groupSignature);
		host.refuse(true);
		host.saveGroup();
		host.refuse(false);
		host.saveGroup();
		expect(host.stored().submitted.deferredObjective).toEqual({ id, score: 100, passed: true });
	});

	it("10: corrupt metadata permits a decided 0/false event through the assembled refusal flow", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("g", {
			...groupState(),
			submitted: { ...submission(), deferredObjective: null },
		});
		host.provider.set("q", answer());
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win, { score: 0, passed: false, correct: false }).accepted).toBe(true);
		expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 0 });
		expect(objectiveValues(host)).toEqual(["g", "0", "failed"]);
		expect(win.__praxityBlockState?.get("g")).toHaveProperty("rejectedObjectives", [
			{ field: "deferredObjective", value: null },
		]);
		owner.dispose();
	});
	it("11: an invalid successor discards an earlier queued handoff", () => {
		const host = launch(format);
		host.seed();
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, undefined, groupSignature);
		expect(host.tracker.trackGroupObjective("g", 0, false)).toBe(false);
		host.saveGroup();
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});
	it("15: re-admission never overwrites the provider preparation hook", () => {
		const host = launch(format);
		const prepare = host.provider.prepareGroupState;
		tracking.createDeferredGroupObjectiveWriter(host.provider, () => true, host.ledger()!);
		expect(host.provider.prepareGroupState).toBe(prepare);
	});
	it("18: removing an acknowledged record may not replace a reentrant successor", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const api = format === "scorm12" ? host.dom.window.API! : host.dom.window.API_1484_11!;
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const native = (api as unknown as Record<string, (key: string, value: string) => string>)[
			method
		];
		let once = true;
		vi.spyOn(
			api as unknown as Record<string, (key: string, value: string) => string>,
			method,
		).mockImplementation((key, value) => {
			const result = native(key, value);
			if (key === "cmi.suspend_data" && once) {
				once = false;
				host.provider.set("q", answer(changed));
				host.submit(0, false);
			}
			return result;
		});
		host.tracker.checkCompletion();
		expect(host.stored().submitted.deferredObjective).toMatchObject({ score: 0, passed: false });
		host.repair();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed", "g", "0", "failed"]);
	});
	it("4: missing sink and explicit refusal do not acknowledge a replay", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const report = vi.spyOn(host.runtime, "trackObjective").mockImplementation(() => false);
		host.tracker.checkCompletion();
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		report.mockRestore();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});
});

describe.each(["scorm12", "scorm2004"] as const)("%s schema and authority controls", (format) => {
	it("15: mismatched queued capture is explicitly refused and cannot attach later", () => {
		const host = launch(format);
		host.seed();
		host.tracker.trackGroupObjective("g", 100, true, host.runtime, undefined, changed);
		const before = host.runtime.getSuspendData();
		expect(host.saveGroup()).toBe(false);
		expect(host.runtime.getSuspendData()).toBe(before);
		host.saveGroup({ ...groupState(), submitted: { ...submission(), contentSignature: changed } });
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});
	it("15: a provider requires the launch ledger and leaves non-group state unchanged", () => {
		const host = launch(format);
		expect(() =>
			tracking.createDeferredGroupObjectiveWriter(host.provider, () => true, undefined as never),
		).toThrow("launch replay ledger");
		expect(host.provider.prepareGroupState?.("ordinary", null)).toBeNull();
	});
	it("18: Commit callbacks that change material or revoke authority cannot authorize replay", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.setCommitPreparation?.(() => host.provider.set("q", answer(changed)));
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual([]);
		host.runtime.setCommitPreparation?.(() => {});
		host.provider.set("q", answer());
		let current = true;
		const writer = tracking.createDeferredGroupObjectiveWriter(
			host.provider,
			() => current,
			host.ledger()!,
		);
		host.runtime.setCommitPreparation?.(() => {
			current = false;
		});
		writer?.(host.runtime, { kind: "decided" }, host.evidence());
		expect(objectiveValues(host)).toEqual([]);
	});
	it("18: a Commit callback cannot confirm a replaced capture", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.runtime.setCommitPreparation?.(() => host.provider.set("g", groupState()));
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual([]);
	});
	it("2: authority revoked inside the native callback cannot clear and a new writer clears without another invocation", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let current = true;
		const writer = tracking.createDeferredGroupObjectiveWriter(
			host.provider,
			() => current,
			host.ledger()!,
		)!;
		const native = host.runtime.trackObjective!.bind(host.runtime);
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((...args) => {
			native(...args);
			current = false;
		});
		expect(writer(host.runtime, { kind: "decided" }, host.evidence())).toBe(false);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		host.replace(true);
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(host.stored().submitted.deferredObjective).toBeUndefined();
	});
	for (const field of ["id", "score", "passed"])
		it(`4: malformed saved ${field} is raw rejected evidence and never grants credit`, () => {
			const host = launch(format);
			host.seed();
			host.submit();
			const raw = { ...host.stored().submitted.deferredObjective, [field]: null };
			host.provider.set("g", {
				...groupState(),
				submitted: { ...submission(), deferredObjective: raw },
			});
			host.replace(true);
			host.repair();
			expect(objectiveValues(host)).toEqual([]);
			host.saveGroup();
			expect(host.stored()).toHaveProperty("rejectedObjectives", [
				{ field: "deferredObjective", value: raw },
			]);
		});
	it("16: refused decided delivery retains its older obligation without cancelling the valid capture", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		const report = vi.spyOn(host.runtime, "trackObjective").mockImplementation(() => false);
		expect(
			host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature),
		).toBe(true);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
		report.mockRestore();
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
	});
});
it("5/10: oversized rejected metadata refuses atomically without losing the accepted answer or obligation", () => {
	const host = launch("scorm12");
	host.seed();
	host.submit();
	const before = host.runtime.getSuspendData();
	const saved = host.stored();
	const raw = Array.from({ length: 512 }, (_, index) =>
		createHash("sha256").update(`rejected-${index}`).digest("hex"),
	).join("");
	host.provider.stageSubmission?.("g", () =>
		host.saveGroup({ ...groupState(), submitted: { ...submission(), deferredObjective: raw } }),
	);
	expect(() => host.tracker.trackInteraction("g", "0%", false, 0)).toThrow("ESCORM12STORAGE");
	expect(host.runtime.getSuspendData()).toBe(before);
	expect(host.stored()).toEqual(saved);
	expect(host.provider.get("q")).toEqual(answer(changed));
});

describe.each(["scorm12", "scorm2004"] as const)("%s independent interface controls", (format) => {
	it("1: an uncompiled group cannot acquire an obligation", () => {
		const host = launch(format);
		host.seed();
		host.tracker.trackGroupObjective("other", 100, true, host.runtime, undefined, groupSignature);
		Object.assign(host.dom.window, { __praxityBlockState: host.provider });
		expect(
			writeLearnerBlockState("other", groupState(), () => true, host.dom.window.document),
		).toBe(true);
		expect(host.provider.get("other")).toEqual(groupState());
	});
	it("2: acknowledgement of a predecessor never saves the callback's successor again", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let successorWrites = 0;
		const native = host.runtime.trackObjective!.bind(host.runtime);
		vi.spyOn(host.runtime, "trackObjective").mockImplementation((...args) => {
			native(...args);
			host.provider.set("q", answer(changed));
			host.submit(0, false);
			successorWrites = host.writes.filter(([key]) => key === "cmi.suspend_data").length;
		});
		host.tracker.checkCompletion();
		expect(host.stored().submitted.deferredObjective).toMatchObject({ score: 0, passed: false });
		expect(host.writes.filter(([key]) => key === "cmi.suspend_data")).toHaveLength(successorWrites);
	});
	it("16: assembled host forwards the candidate as argument five when the submitted group repairs its own history", () => {
		const host = launch(format);
		host.seed();
		host.provider.set("q", answer());
		host.provider.set("g", { ...groupState(), mode: "oneOf", selectedMemberId: "a" });
		expect(host.evidence().status("g")).toBe("history");
		const { win, owner } = installHost(host, format, ["g"]);
		expect(submitEvent(host, win).accepted).toBe(true);
		expect(objectiveValues(host)).toEqual(["g", "100", "passed"]);
		expect(win.__praxityBlockState?.get("g")).not.toHaveProperty("submitted.deferredObjective");
		owner.dispose();
	});
	it("3: a signed nonfinite score refuses before interaction and capture", () => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		const before = win.__praxityBlockState?.get("g");
		const rows = host.runtime.getInteractions();
		expect(submitEvent(host, win, { score: NaN }).accepted).toBe(false);
		expect(win.__praxityBlockState?.get("g")).toEqual(before);
		expect(host.runtime.getInteractions()).toEqual(rows);
		owner.dispose();
	});
	it("18: an unmatched saved identity refuses native Commit", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const commit = vi.spyOn(host.runtime, "commit");
		expect(
			host.provider.confirmGroupObjective?.(
				"g",
				() => false,
				() => true,
			),
		).toBe(false);
		expect(commit).not.toHaveBeenCalled();
	});
	it("18: a revoked clear never enters its storage preparation callback", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const prepare = vi.fn(() => groupState());
		expect(host.provider.clearGroupObjective?.("g", prepare, () => false)).toBe(false);
		expect(prepare).not.toHaveBeenCalled();
	});
	it("18: native refusal overrides echoed runtime bytes and cannot authorize removal Commit", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		const api = format === "scorm12" ? host.dom.window.API! : host.dom.window.API_1484_11!;
		const method = format === "scorm12" ? "LMSSetValue" : "SetValue";
		const native = (api as unknown as Record<string, (key: string, value: string) => string>)[
			method
		];
		vi.spyOn(
			api as unknown as Record<string, (key: string, value: string) => string>,
			method,
		).mockImplementation((key, value) => {
			native(key, value);
			return key === "cmi.suspend_data" ? "false" : "true";
		});
		const commit = vi.spyOn(host.runtime, "commit");
		expect(
			host.provider.clearGroupObjective?.(
				"g",
				() => groupState(),
				() => true,
			),
		).toBe(false);
		expect(commit).not.toHaveBeenCalled();
	});
	it("2: revocation by outcome configuration prevents entering the objective sink", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		let current = true;
		const writer = tracking.createDeferredGroupObjectiveWriter(
			host.provider,
			() => current,
			host.ledger()!,
		);
		vi.spyOn(host.runtime, "configureOutcome").mockImplementation(() => {
			current = false;
		});
		expect(writer?.(host.runtime, { kind: "decided" }, host.evidence())).toBe(false);
		expect(objectiveValues(host)).toEqual([]);
	});
});

describe.each(["scorm12", "scorm2004"] as const)("%s storage admission controls", (format) => {
	it("4: a historical group outside the course wait set cannot replay", () => {
		const host = launch(format);
		host.seed();
		host.submit();
		host.provider.set("q", answer());
		host.provider.set("g", { ...host.stored(), mode: "oneOf", selectedMemberId: "a" });
		expect(host.evidence().status("g")).toBe("history");
		host.tracker.checkCompletion();
		expect(objectiveValues(host)).toEqual([]);
		expect(host.stored().submitted.deferredObjective?.score).toBe(100);
	});
});
it("18: a provisional SCORM 1.2 capture cannot be confirmed by an earlier Commit", () => {
	const host = launch("scorm12");
	host.seed();
	expect(
		host.provider.stageSubmission?.("g", () => {
			host.saveGroup();
			expect(host.provider.getSaveResult?.("g")?.status).toBe("pending");
			expect(
				host.provider.confirmGroupObjective?.(
					"g",
					() => true,
					() => true,
				),
			).toBe(false);
			return true;
		}),
	).toBe(true);
});
it("18: admitted SCORM 2004 keeps ordinary save receipts undefined", () => {
	const host = launch("scorm2004");
	host.seed();
	host.submit();
	expect(host.provider.getSaveResult).toBeUndefined();
});

it("6: an unavailable ordinary evidence view is built once", () => {
	const host = launch("scorm2004");
	const build = vi.fn(() => undefined);
	const tracker = new CourseTracker(host.runtime, {
		...host.config(),
		getChoiceDependencyView: build,
	});
	tracker.checkCompletion();
	expect(build).toHaveBeenCalledTimes(1);
});

it("9: admitted SCORM 2004 consumes native save refusal without exposing an ordinary receipt", () => {
	const host = launch("scorm2004");
	host.seed();
	host.submit();
	const before = host.runtime.getSuspendData();
	host.tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, groupSignature);
	host.refuse(true);
	expect(host.saveGroup()).toBe(false);
	expect(host.runtime.getSuspendData()).toBe(before);
	expect(host.provider.getSaveResult).toBeUndefined();
});

it("18: a revoked admitted save does not enter native storage", () => {
	const host = launch("scorm2004");
	host.seed();
	const before = host.runtime.getSuspendData();
	expect(
		host.provider.saveGroupObjective?.("g", { ...groupState(), completed: false }, () => false),
	).toBe(false);
	expect(host.runtime.getSuspendData()).toBe(before);
});
it("18: an admitted native save rechecks authority after the LMS callback", () => {
	const host = launch("scorm2004");
	host.seed();
	let current = true;
	const api = host.dom.window.API_1484_11!;
	const native = api.SetValue;
	vi.spyOn(api, "SetValue").mockImplementation((key, value) => {
		const result = native(key, value);
		current = false;
		return result;
	});
	expect(
		host.provider.saveGroupObjective?.("g", { ...groupState(), completed: false }, () => current),
	).toBe(false);
});

it.each(["scorm12", "scorm2004", "xapi", "standalone"] as const)(
	"12/16: %s accepts an ungraded signed capture without an objective",
	(format) => {
		const host = launch(format);
		host.seed();
		const { win, owner } = installHost(host, format);
		expect(submitEvent(host, win, { score: undefined, correct: undefined }).accepted).toBe(true);
		expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g" });
		expect(win.__praxityBlockState?.get("g")).not.toHaveProperty("submitted.deferredObjective");
		expect(objectiveValues(host)).toEqual([]);
		owner.dispose();
	},
);
