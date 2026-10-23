import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { writeLearnerBlockState } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { readDeferredGroupObjective } from "@praxity/shared-blocks/learner-state";
import { dispatchSelfCheckEvent } from "@praxity/shared-blocks/self-check-consumers";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
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

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const changed = `sha256:${"b".repeat(64)}`;
const submitted = {
	payload: { mode: "all", selectedMemberId: null, dependencies: [["a", null]] },
	contentSignature: "sha256:ff48f614173329077a69ba761d6e6ad76f6b39d24d5502419ea626dfacac7af2",
};
const groupState = {
	version: 1,
	kind: "assessmentGroup",
	mode: "all",
	selectedMemberId: null,
	completed: true,
	submitted,
};
const answer = (contentSignature: string) => ({
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

type Format = "scorm12" | "scorm2004";

function launch(format: Format, evidence = false, waiting = false, owned = false) {
	const dom = new JSDOM("", { url: "https://course.example/one.html" });
	documents.push(dom);
	const win = dom.window as unknown as Window & typeof globalThis;
	vi.stubGlobal("window", win);
	vi.stubGlobal("document", win.document);
	vi.stubGlobal("Event", win.Event);
	vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "objective-capture");
	vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
	const values = new Map<string, string>();
	const writes: string[][] = [];
	let refuseState = false;
	const set = (key: string, value: string) => {
		writes.push([key, value]);
		if (refuseState && key === "cmi.suspend_data") return "false";
		values.set(key, value);
		return "true";
	};
	const get = (key: string) => values.get(key) ?? "";
	Object.assign(win, {
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
	const open = (): SCORMRuntime =>
		format === "scorm12" ? new Scorm12Runtime("course") : new Scorm2004Runtime(win);
	const runtime = open();
	const view = () =>
		withChoiceDependencyStatus({
			rows: runtime.getInteractions().map((row) => ({
				...row,
				...(row.id === "q" ? { contentSignature: signature } : {}),
				...(row.id === "g" ? { contentSignature: submitted.contentSignature } : {}),
			})),
			questions: { q: question },
			signatures: { q: signature },
			groups: { g: { mode: "all", memberIds: ["a"], requiredIds: ["a"] } },
			readState: (id) => win.__praxityBlockState?.get(id),
		});
	const owner = owned ? selfCheckDocument(win.document, true) : undefined;
	const installProvider = Object.getOwnPropertyDescriptor(win, "__praxityBlockState")?.set;
	if (evidence) {
		let provider: LearnerBlockStateRuntime | undefined;
		Object.defineProperty(win, "__praxityBlockState", {
			configurable: true,
			get: () => provider,
			set: (value: LearnerBlockStateRuntime) => {
				provider = value;
				provider.getChoiceDependencyView = view;
				Reflect.set(provider, "getChoiceReporting", (current: () => boolean) => ({
					getChoiceDependencyView: view,
					writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(value, current),
				}));
				installProvider?.call(win, value);
			},
		});
	}
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
		initializeScormCourseHost({
			format,
			readEntry: () => null,
			readDeploymentConfig: readCourseDeploymentConfig,
			createRuntime: () => runtime,
		}),
	).toBe(true);
	const provider = win.__praxityBlockState;
	if (!provider) throw new Error("Missing provider installation");
	if (evidence) {
		provider.set("q", answer(waiting ? changed : signature));
		runtime.trackInteraction("q", "a", true, 100);
		runtime.trackInteraction("a", "answer", true, 100);
		// Production still has no evidence binding. Inject the existing tracker capability.
		if (!owned)
			win.__praxityTracker = new CourseTracker(runtime, {
				totalPages: 2,
				completionMethod: "allPages",
				requiredAssessmentIds: ["q"],
				getChoiceDependencyView: view,
				writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(provider, () => true),
			} as TrackingConfig);
		expect(view().status("q")).toBe(waiting ? "history" : "current");
	}
	writes.length = 0;
	return {
		win,
		runtime,
		provider,
		open,
		writes,
		view,
		refuse(value: boolean) {
			refuseState = value;
		},
		values,
		owner,
	};
}

/** Keep the group owner's dispatch refusal and stage/report/save order. */
function submit(
	host: ReturnType<typeof launch>,
	detail: Record<string, unknown> = {},
	state: LearnerStateValue = groupState,
) {
	const event = new host.win.CustomEvent("praxity:assessment-group-complete", {
		detail: {
			groupId: "g",
			score: 100,
			passed: true,
			correct: true,
			completed: true,
			memberIds: ["a"],
			contentSignature: submitted.contentSignature,
			...detail,
		},
		cancelable: true,
	});
	const save = () => writeLearnerBlockState("g", state, () => true, host.win.document);
	const report = () => dispatchSelfCheckEvent(event, () => true, host.win.document);
	const accepted = host.provider.stageSubmission
		? host.provider.stageSubmission("g", () => save() && report())
		: report();
	const saved = accepted && !host.provider.stageSubmission ? save() : accepted;
	return { accepted, event, saved };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pending = (host: ReturnType<typeof launch>) =>
	readDeferredGroupObjective(host.provider.get("g"));
const objectives = (host: ReturnType<typeof launch>) =>
	host.writes.filter(([key]) => key.startsWith("cmi.objectives.")).map(([, value]) => value);
const save = (host: ReturnType<typeof launch>, state: LearnerStateValue = groupState) =>
	writeLearnerBlockState("g", state, () => true, host.win.document);

describe.each(["scorm12", "scorm2004"] as const)("%s objective capture persistence", (format) => {
	it("ordinary null block state keeps its existing save behavior without admission", () => {
		const host = launch(format);
		expect(save(host, null)).toBe(true);
		expect(host.provider.get("g")).toBeNull();
		expect(host.provider.prepareGroupState).toBeUndefined();
	});

	it("an absent evidence view is read once for an ordinary objective", () => {
		const host = launch(format);
		const view = vi.fn(() => undefined);
		const tracker = new CourseTracker(host.runtime, {
			totalPages: 2,
			completionMethod: "allPages",
			getChoiceDependencyView: view,
		});
		tracker.trackGroupObjective("g", 100, true);
		expect(view).toHaveBeenCalledTimes(1);
		expect(objectives(host)).toEqual(["g", "100", "passed"]);
	});

	it("freezes a fresh UUID and values with each waiting capture, without replay", () => {
		const host = launch(format, true, true);
		expect(submit(host).accepted).toBe(true);
		const first = pending(host);
		expect(first).toEqual({ id: expect.stringMatching(uuid), score: 100, passed: true });
		expect(objectives(host)).toEqual([]);
		expect(submit(host, { score: 0, passed: false }).accepted).toBe(true);
		expect(pending(host)).toEqual({ id: expect.stringMatching(uuid), score: 0, passed: false });
		expect(pending(host)?.id).not.toBe(first?.id);
		host.provider.set("q", answer(signature));
		(host.win.__praxityTracker as CourseTracker).checkCompletion();
		expect(objectives(host)).toEqual([]);
		const reopened = host.open();
		expect(reopened.initialize()).toBe(true);
		expect(readDeferredGroupObjective(createBlockStateRuntime(reopened).get("g"))).toEqual(
			pending(host),
		);
	});

	for (const different of [false, true])
		it(`9: refused replacement preserves preceding capture and record; changed signature=${different}`, () => {
			const host = launch(format, true, true);
			submit(host);
			const before = host.provider.get("g");
			const bytes = host.values.get("cmi.suspend_data");
			const contentSignature = different ? changed : submitted.contentSignature;
			const next = { ...groupState, submitted: { ...submitted, contentSignature } };
			host.refuse(true);
			const tracker = host.win.__praxityTracker as CourseTracker;
			tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, contentSignature);
			expect(save(host, next)).toBe(false);
			expect(host.values.get("cmi.suspend_data")).toBe(bytes);
			expect(host.provider.get("g")).toEqual(before);
			host.provider.set("q", answer(signature));
			tracker.checkCompletion();
			expect(host.provider.get("g")).toEqual(before);
			const reopened = host.open();
			expect(reopened.initialize()).toBe(true);
			expect(createBlockStateRuntime(reopened).get("g")).toEqual(before);
			host.refuse(false);
			expect(save(host, next)).toBe(true);
			expect(pending(host)).toMatchObject({ score: 0, passed: false });
		});

	for (const waiting of [false, true])
		for (const corrupt of [null, { id: "bad", score: 101, passed: true }])
			it(`10: valid ${waiting ? "waiting" : "decided"} dispatch replaces corrupt objective ${JSON.stringify(corrupt)}`, () => {
				const host = launch(format, true, waiting);
				host.provider.set("g", {
					...groupState,
					submitted: { ...submitted, deferredObjective: corrupt },
				});
				const commit = vi.spyOn(host.runtime, "commit");
				const { accepted, event, saved } = submit(host, { score: 0, passed: false });
				expect(accepted).toBe(true);
				expect(event.defaultPrevented).toBe(false);
				expect(saved).toBe(true);
				expect(host.provider.get("g")).toHaveProperty("rejectedObjectives", [
					{ field: "deferredObjective", value: corrupt },
				]);
				expect(pending(host)).toEqual(
					waiting ? { id: expect.stringMatching(uuid), score: 0, passed: false } : undefined,
				);
				expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 0 });
				expect(commit).toHaveBeenCalled();
				expect(objectives(host)).toEqual(waiting ? [] : ["g", "0", "failed"]);
			});

	for (const existing of [false, true])
		it(`11: unsigned evidence-aware event refuses atomically; existing=${existing}`, () => {
			const host = launch(format, true, true);
			if (existing) submit(host);
			const before = host.provider.get("g");
			const tracker = host.win.__praxityTracker as CourseTracker;
			tracker.trackGroupObjective(
				"g",
				100,
				true,
				host.runtime,
				undefined,
				submitted.contentSignature,
			);
			const result = submit(host, { contentSignature: undefined });
			expect(result.accepted).toBe(false);
			expect(result.event.defaultPrevented).toBe(true);
			expect(host.provider.get("g")).toEqual(before);
			// A rejected successor cannot leave an earlier handoff for an ordinary save.
			expect(save(host)).toBe(true);
			expect(pending(host)).toEqual(readDeferredGroupObjective(before));
			expect(submit(host).accepted).toBe(true);
			expect(pending(host)).toMatchObject({ score: 100, passed: true });
		});

	it("15: tracker re-admission retains the hook and original UUID across a refused save", () => {
		const host = launch(format, true, true);
		const tracker = host.win.__praxityTracker as CourseTracker;
		const allocate = vi.spyOn(crypto, "randomUUID");
		tracker.trackGroupObjective(
			"g",
			100,
			true,
			host.runtime,
			undefined,
			submitted.contentSignature,
		);
		expect(allocate).toHaveBeenCalledTimes(1);
		const id = allocate.mock.results[0].value;
		const prepare = host.provider.prepareGroupState;
		expect(prepare).toBeTypeOf("function");
		host.refuse(true);
		expect(save(host)).toBe(false);
		host.win.__praxityTracker = new CourseTracker(host.runtime, {
			totalPages: 2,
			completionMethod: "allPages",
			requiredAssessmentIds: ["q"],
			getChoiceDependencyView: host.view,
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(host.provider, () => true),
		} as TrackingConfig);
		expect(host.provider.prepareGroupState).toBe(prepare);
		host.refuse(false);
		expect(save(host)).toBe(true);
		expect(pending(host)).toEqual({ id, score: 100, passed: true });
	});

	it("15: revoked queued authority explicitly refuses adoption", () => {
		const host = launch(format, true, true);
		let current = true;
		const tracker = new CourseTracker(host.runtime, {
			totalPages: 2,
			completionMethod: "allPages",
			requiredAssessmentIds: ["q"],
			getChoiceDependencyView: host.view,
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(host.provider, () => current),
		} as TrackingConfig);
		tracker.trackGroupObjective(
			"g",
			100,
			true,
			host.runtime,
			undefined,
			submitted.contentSignature,
		);
		current = false;
		expect(save(host)).toBe(false);
		expect(host.provider.get("g")).toBeUndefined();
		expect(save(host)).toBe(true);
		expect(pending(host)).toBeUndefined();
	});

	it("a persisted handoff is retired before checking its former writer's authority", () => {
		const host = launch(format, true, true);
		let current = true;
		const tracker = new CourseTracker(host.runtime, {
			totalPages: 2,
			completionMethod: "allPages",
			requiredAssessmentIds: ["q"],
			getChoiceDependencyView: host.view,
			writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(host.provider, () => current),
		} as TrackingConfig);
		tracker.trackGroupObjective(
			"g",
			100,
			true,
			host.runtime,
			undefined,
			submitted.contentSignature,
		);
		expect(save(host)).toBe(true);
		const first = pending(host);
		expect(first).toMatchObject({ score: 100, passed: true });
		current = false;
		expect(save(host, { ...groupState, completed: false })).toBe(true);
		expect(pending(host)).toEqual(first);
	});

	it("15: an assembled host announcement cannot silently discard a queued submission", () => {
		const host = launch(format, true, true, true);
		const tracker = host.win.__praxityTracker as CourseTracker;
		const allocate = vi.spyOn(crypto, "randomUUID");
		tracker.trackGroupObjective(
			"g",
			100,
			true,
			host.runtime,
			undefined,
			submitted.contentSignature,
		);
		expect(allocate).toHaveBeenCalledTimes(1);
		const id = allocate.mock.results[0].value;
		const prepare = host.provider.prepareGroupState;
		host.owner?.reset();
		expect(host.win.__praxityTracker).not.toBe(tracker);
		expect(host.provider.prepareGroupState).toBe(prepare);
		const accepted = save(host);
		// Reset revokes the queued writer. Admission must refuse instead of dropping its UUID.
		expect(accepted).toBe(false);
		expect(host.provider.get("g")).toBeUndefined();
		expect(id).toMatch(uuid);
		host.owner?.dispose();
	});

	it("a saved handoff cannot resurrect after its capture is replaced", () => {
		const host = launch(format, true, true);
		submit(host);
		expect(pending(host)).toMatchObject({ score: 100, passed: true });
		expect(
			save(host, { ...groupState, submitted: { ...submitted, contentSignature: changed } }),
		).toBe(true);
		expect(pending(host)).toBeUndefined();
		expect(save(host)).toBe(true);
		expect(pending(host)).toBeUndefined();
	});

	it("a decided staged or ordinary dispatch retires the previous record without an extra Commit", () => {
		const host = launch(format, true, true);
		submit(host);
		host.provider.set("q", answer(signature));
		const commit = vi.spyOn(host.runtime, "commit");
		expect(submit(host, { score: 0, passed: false }).accepted).toBe(true);
		expect(pending(host)).toBeUndefined();
		expect(objectives(host)).toEqual(["g", "0", "failed"]);
		expect(commit).toHaveBeenCalledExactlyOnceWith();
	});

	for (const field of ["score", "passed", "contentSignature"] as const)
		it(`invalid incoming ${field} discards the handoff and preserves preceding bytes`, () => {
			const host = launch(format, true, true);
			submit(host);
			const bytes = host.values.get("cmi.suspend_data");
			const first = pending(host);
			const tracker = host.win.__praxityTracker as CourseTracker;
			tracker.trackGroupObjective(
				"g",
				100,
				true,
				host.runtime,
				undefined,
				submitted.contentSignature,
			);
			expect(
				tracker.trackGroupObjective(
					"g",
					field === "score" ? 101 : 100,
					field === "passed" ? ("false" as unknown as boolean) : true,
					host.runtime,
					undefined,
					field === "contentSignature" ? "broken" : submitted.contentSignature,
				),
			).toBe(false);
			expect(host.values.get("cmi.suspend_data")).toBe(bytes);
			expect(save(host)).toBe(true);
			expect(pending(host)).toEqual(first);
		});

	it("ordinary objectives outside the admitted group map still reach the existing writer", () => {
		const host = launch(format, true, false);
		const tracker = host.win.__praxityTracker as CourseTracker;
		expect(tracker.trackGroupObjective("other", 100, true)).toBe(true);
		expect(objectives(host)).toEqual(["other", "100", "passed"]);
		expect(host.provider.get("other")).toBeUndefined();
	});

	for (const queued of [false, true])
		it(`native group saves refuse revoked authority even outside the caller's save helper; queued=${queued}`, () => {
			const host = launch(format, true, true);
			let current = true;
			if (queued) {
				const tracker = new CourseTracker(host.runtime, {
					totalPages: 2,
					completionMethod: "allPages",
					requiredAssessmentIds: ["q"],
					getChoiceDependencyView: host.view,
					writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
						host.provider,
						() => current,
					),
				} as TrackingConfig);
				tracker.trackGroupObjective(
					"g",
					100,
					true,
					host.runtime,
					undefined,
					submitted.contentSignature,
				);
			}
			current = false;
			const bytes = host.values.get("cmi.suspend_data");
			expect(host.provider.saveGroupObjective?.("g", groupState, () => queued || current)).toBe(
				false,
			);
			expect(host.values.get("cmi.suspend_data")).toBe(bytes);
			expect(host.provider.get("g")).toBeUndefined();
		});

	for (const when of [
		"before call",
		"state read",
		"outcome write",
		"save preparation",
		"native save",
	] as const)
		it(`revocation during ${when} refuses the queued writer`, () => {
			const host = launch(format, true, true);
			const allocate = vi.spyOn(crypto, "randomUUID");
			let current = true;
			const tracker = new CourseTracker(host.runtime, {
				totalPages: 2,
				completionMethod: "allPages",
				requiredAssessmentIds: ["q"],
				getChoiceDependencyView: host.view,
				writeObjectives: tracking.createDeferredGroupObjectiveWriter?.(
					host.provider,
					() => current,
				),
			} as TrackingConfig);
			if (when === "before call") current = false;
			if (when === "state read") {
				const get = host.provider.get.bind(host.provider);
				vi.spyOn(host.provider, "get").mockImplementation((id) => {
					if (id === "g") current = false;
					return get(id);
				});
			}
			if (when === "outcome write") {
				const configure = host.runtime.configureOutcome?.bind(host.runtime);
				vi.spyOn(host.runtime, "configureOutcome").mockImplementation((policy) => {
					configure?.(policy);
					current = false;
				});
			}
			const accepted = tracker.trackGroupObjective(
				"g",
				100,
				true,
				host.runtime,
				undefined,
				submitted.contentSignature,
			);
			if (when === "save preparation") {
				host.provider.getSaveResult = () => {
					current = false;
					return undefined;
				};
				expect(save(host)).toBe(false);
			} else if (when === "native save") {
				const api = Reflect.get(host.win, format === "scorm12" ? "API" : "API_1484_11") as Record<
					string,
					(key: string, value: string) => string
				>;
				const set = api[format === "scorm12" ? "LMSSetValue" : "SetValue"];
				Reflect.set(
					api,
					format === "scorm12" ? "LMSSetValue" : "SetValue",
					(key: string, value: string) => {
						const result = set(key, value);
						if (key === "cmi.suspend_data") current = false;
						return result;
					},
				);
				expect(save(host)).toBe(false);
			} else {
				expect(accepted).toBe(false);
				expect(host.provider.get("g")).toBeUndefined();
				if (when === "before call" || when === "state read")
					expect(allocate).not.toHaveBeenCalled();
			}
		});

	it("P2-2: a mismatched retry save drops the handoff and keeps the ordinary write", () => {
		const host = launch(format, true, true);
		submit(host);
		const first = pending(host);
		const tracker = host.win.__praxityTracker as CourseTracker;
		tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, changed);
		host.refuse(true);
		expect(
			save(host, { ...groupState, submitted: { ...submitted, contentSignature: changed } }),
		).toBe(false);
		host.refuse(false);
		expect(save(host, { ...groupState, completed: false })).toBe(true);
		expect(host.provider.get("g")).toHaveProperty("completed", false);
		expect(pending(host)).toEqual(first);
		expect(
			save(host, { ...groupState, submitted: { ...submitted, contentSignature: changed } }),
		).toBe(true);
		expect(pending(host)).toBeUndefined();
	});

	it("P2-3: a decided successor retires its predecessor only in its following accepted save", () => {
		const host = launch(format, true, true);
		submit(host);
		const first = pending(host);
		expect(first).toMatchObject({ score: 100, passed: true });
		host.provider.set("q", answer(signature));
		const tracker = host.win.__praxityTracker as CourseTracker;
		tracker.trackGroupObjective("g", 0, false, host.runtime, undefined, submitted.contentSignature);
		expect(objectives(host)).toEqual(["g", "0", "failed"]);
		expect(pending(host)).toEqual(first);
		host.refuse(true);
		expect(save(host)).toBe(false);
		expect(pending(host)).toEqual(first);
		host.refuse(false);
		expect(save(host)).toBe(true);
		expect(pending(host)).toBeUndefined();
		const reopened = host.open();
		expect(reopened.initialize()).toBe(true);
		expect(readDeferredGroupObjective(createBlockStateRuntime(reopened).get("g"))).toBeUndefined();
	});
});

for (const waiting of [false, true])
	for (const corrupt of ["garbage", { version: 2, kind: "assessmentGroup" }])
		it(`P2-1: SCORM 2004 ${waiting ? "waiting" : "decided"} submission replaces unreadable prior group ${JSON.stringify(corrupt)}`, () => {
			const host = launch("scorm2004", true, waiting);
			host.provider.set("g", corrupt);
			const { accepted, event, saved } = submit(host, { score: 0, passed: false });
			expect(accepted).toBe(true);
			expect(event.defaultPrevented).toBe(false);
			expect(saved).toBe(true);
			expect(host.provider.get("g")).toEqual(groupState);
			expect(objectives(host)).toEqual(waiting ? [] : ["g", "0", "failed"]);
			expect(host.runtime.getInteractions().at(-1)).toMatchObject({ id: "g", score: 0 });
		});

for (const state of [
	undefined,
	{ ...groupState, submitted: { ...submitted, contentSignature: changed } },
])
	it(`SCORM 1.2 refuses a provisional handoff without its matching capture; state=${JSON.stringify(state)}`, () => {
		const host = launch("scorm12", true, true);
		const tracker = host.win.__praxityTracker as CourseTracker;
		expect(
			host.provider.stageSubmission?.("g", () => {
				if (state) expect(save(host, state)).toBe(true);
				return tracker.trackGroupObjective(
					"g",
					100,
					true,
					host.runtime,
					undefined,
					submitted.contentSignature,
				);
			}),
		).toBe(false);
		expect(host.provider.get("g")).toBeUndefined();
	});
