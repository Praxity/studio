import {
	compileBlockStatePolicy,
	filterPrivateSuspendData,
} from "@praxity/shared-blocks/block-state-policy";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { VariableStore } from "@praxity/shared-blocks/logic";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { CourseHostConfig, CourseHostFormat } from "../../template/src/hosts/course-host";
import {
	initializeCourseHost,
	readCourseDeploymentConfig,
} from "../../template/src/hosts/course-host";
import { bufferPrivateBlockState } from "../../template/src/hosts/privacy-bootstrap";
import { privacySupport } from "../../template/src/hosts/privacy-support";
import { createPrivateBlockStateRuntime } from "../../template/src/hosts/private-block-state";
import { type CourseConfig, prepareHtmlCourse } from "../html-gen";
import { enhanceHighlight } from "../patterns/highlight/enhance";
import { renderHighlight } from "../patterns/highlight/render";
import { Scorm12Runtime } from "../scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../scorm/api/scorm2004";
import { XapiRuntime } from "../scorm/api/xapi";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";
import type { SCORMRuntime } from "../scorm/types";

const draft = {
	version: 1,
	kind: "self-check",
	draft: { answer: "PRIVATE DRAFT", ticked: ["private-tick"], shown: false },
	submitted: null,
};

function host(
	options: {
		storage?: Storage;
		learner?: string;
		attempt?: string;
		newAttempt?: boolean;
		course?: string;
		reported?: boolean;
		denyStorage?: boolean;
		policy?: Record<string, "device" | "lms">;
	} = {},
) {
	const dom = new JSDOM(
		`<!doctype html><script id="praxity-host-config" type="application/json">${JSON.stringify({
			version: 1,
			courseId: options.course ?? "course",
			pageId: "page",
			pageTitle: "Practice",
			currentPage: 1,
			totalPages: 2,
			currentSlug: "page",
			availableSlugs: ["page"],
			pageIdMap: { page: "page" },
			completionMethod: "allPages",
			pageRole: "content",
			strings: {},
			blockStatePolicy: options.policy ?? { check: options.reported ? "lms" : "device" },
		})}</script><script id="praxity-deployment-config" type="application/json">{"format":"scorm12"}</script>`,
		{ url: "https://course.example/page.html" },
	);
	Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
	if (options.storage)
		Object.defineProperty(dom.window, "localStorage", { value: options.storage });
	const runtime = new LocalStorageRuntime(dom.window.localStorage, "reporting");
	if (options.denyStorage)
		Object.defineProperty(dom.window, "localStorage", {
			get: () => {
				throw new DOMException("", "SecurityError");
			},
		});
	const setSuspendData = vi.spyOn(runtime, "setSuspendData");
	const trackInteraction = vi.spyOn(runtime, "trackInteraction");
	const adapterRuntime = Object.assign(runtime, {
		getLearnerIdentity: () =>
			options.learner
				? {
						learnerId: options.learner,
						attemptId: options.attempt ?? "attempt-1",
						newAttempt: options.newAttempt ?? false,
					}
				: null,
	});
	initializeCourseHost(
		{ format: "scorm12", createRuntime: () => adapterRuntime },
		{
			win: dom.window as unknown as Window,
			doc: dom.window.document,
			location: dom.window.location,
			history: dom.window.history,
		},
	);
	const state = (dom.window as unknown as { __praxityBlockState: LearnerBlockStateRuntime })
		.__praxityBlockState;
	return { dom, state, setSuspendData, trackInteraction };
}

describe("compiled block state privacy policy", () => {
	it("blocks the private-member group-complete reporting path at compiled admission, with a reporting control", () => {
		for (const privacy of [true, false]) {
			const { dom, trackInteraction } = host();
			try {
				const cfg: CourseConfig = {
					id: "course",
					title: "Course",
					sourceLocale: "en",
					totalPages: 1,
					pages: [
						{
							id: "page",
							title: "Page",
							blocks: [
								{ id: "group", type: "assessmentGroup", data: { memberBlockIds: ["choice"] } },
								{
									id: "choice",
									type: "assessment",
									data: {
										assessmentType: "choice",
										private: privacy,
										gradingMode: "none",
										response: { type: "choice", selectionMode: "single", options: [] },
									},
								},
							],
						},
					],
				};
				const publish = () => {
					prepareHtmlCourse(cfg);
					// This is the aggregate the group runtime emits after reading member correctness.
					dom.window.document.dispatchEvent(
						new dom.window.CustomEvent("praxity:assessment-group-complete", {
							detail: { groupId: "group", score: 100, passed: true, correct: true },
						}),
					);
				};
				if (privacy) {
					expect(publish).toThrowError(
						expect.objectContaining({ code: "private-choice-practice-only" }),
					);
					expect(trackInteraction).not.toHaveBeenCalled();
				} else {
					publish();
					expect(trackInteraction).toHaveBeenCalledOnce();
					expect(trackInteraction.mock.calls[0][0]).toBe("group");
				}
			} finally {
				dom.window.close();
			}
		}
	});

	it("writes ordinary and reporting blocks to the runtime before and after a rejected support promise", async () => {
		const { dom } = host();
		let suspend = JSON.stringify({ blockState: { ordinary: { answer: "RESUMED" } } });
		const calls: string[] = [];
		const runtime = Object.assign(new LocalStorageRuntime(dom.window.localStorage), {
			getBlockState: undefined,
			setBlockState: undefined,
			getSuspendData: () => suspend,
			setSuspendData: (value: string) => {
				calls.push(value);
				suspend = value;
			},
		});
		const page = JSON.parse(
			dom.window.document.getElementById("praxity-host-config")?.textContent ?? "null",
		);
		page.blockStatePolicy.reported = "lms";
		const state = bufferPrivateBlockState(
			[runtime, page, dom.window as unknown as Window],
			Promise.reject(new Error("EPRIVACYLOAD")),
		);
		expect(state.get("ordinary")).toEqual({ answer: "RESUMED" });
		state.set("ordinary", { answer: "ORDINARY EARLY" });
		state.set("reported", { answer: "REPORTED EARLY" });
		state.set("check", draft);
		await vi.waitFor(() =>
			expect(state.getSaveResult?.("check")).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			}),
		);
		state.set("ordinary", { answer: "ORDINARY FAILED" });
		state.set("reported", { answer: "REPORTED FAILED" });
		for (const answer of ["ORDINARY EARLY", "REPORTED EARLY", "ORDINARY FAILED", "REPORTED FAILED"])
			expect(calls.join("\n")).toContain(answer);
		expect(calls.join("\n")).not.toContain("PRIVATE DRAFT");
		dom.window.close();
	});

	it("retains private edits with a coded result when lazy support fails", async () => {
		const { dom } = host();
		const page = JSON.parse(
			dom.window.document.getElementById("praxity-host-config")?.textContent ?? "null",
		);
		const runtime = new LocalStorageRuntime(dom.window.localStorage, "course");
		const setSuspendData = vi.spyOn(runtime, "setSuspendData");
		const trackInteraction = vi.spyOn(runtime, "trackInteraction");
		const state = bufferPrivateBlockState(
			[runtime, page, dom.window as unknown as Window],
			Promise.reject(new Error("EPRIVACYLOAD")),
		);
		expect(state.set("check", draft)).toEqual({ status: "not-saved", code: "runtime-loading" });
		await vi.waitFor(() =>
			expect(state.getSaveResult?.("check")).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			}),
		);
		expect(state.get("check")).toEqual(draft);
		expect(state.set("check", { answer: "Another private edit" })).toEqual({
			status: "not-saved",
			code: "runtime-write-failed",
		});
		expect(setSuspendData).not.toHaveBeenCalled();
		expect(trackInteraction).not.toHaveBeenCalled();
		dom.window.close();
	});

	it("preserves existing journal persistence through the host interface", () => {
		const policy = compileBlockStatePolicy([
			{ id: "journal", type: "assessment", data: { private: true } },
		]);
		const first = host({ policy });
		expect(first.state.set("journal", { answer: "Saved journal" })).toEqual({
			status: "saved",
			destination: "device",
		});
		const restored = host({ policy, storage: first.dom.window.localStorage });
		expect(restored.state.get("journal")).toEqual({ answer: "Saved journal" });
		restored.dom.window.close();
		first.dom.window.close();
	});

	it.each([
		{ mode: "empty", policy: {}, id: "ordinary", expected: undefined },
		{
			mode: "reporting",
			policy: { ordinary: "lms" },
			id: "ordinary",
			expected: { status: "not-saved", code: "runtime-write-failed" },
		},
		{
			mode: "private",
			policy: { private: "device" },
			id: "private",
			expected: { status: "not-saved", code: "storage-unavailable" },
		},
		{
			mode: "mixed",
			policy: { private: "device" },
			id: "ordinary",
			expected: { status: "not-saved", code: "runtime-write-failed" },
		},
	])("preserves failed-read receipts for a $mode policy", ({ policy, id, expected }) => {
		const runtime = {
			destinations: { reporting: "lms", state: "lms" },
			getSuspendData() {
				throw new Error("LMS read refused");
			},
		} as unknown as SCORMRuntime;
		const device = {
			getBlockState() {
				throw new Error("Device read refused");
			},
		} as unknown as SCORMRuntime;
		const provider = createPrivateBlockStateRuntime(
			runtime,
			{ courseId: "course", strings: {}, blockStatePolicy: policy } as CourseHostConfig,
			{} as Window,
			device,
		);
		expect(provider.get(id)).toBeUndefined();
		expect(provider.getSaveResult?.(id)).toEqual(expected);
	});

	it("keeps the activity usable when the localStorage accessor itself is denied", () => {
		const { dom, state } = host({ learner: "learner", denyStorage: true });
		expect(state.getSaveResult?.("check")).toEqual({
			status: "not-saved",
			code: "storage-unavailable",
		});
		expect(state.set("check", draft)).toEqual({ status: "not-saved", code: "storage-unavailable" });
		expect(state.get("check")).toEqual(draft);
		dom.window.close();
	});
	it("saves an unidentified learner in the course and device scope and suppresses reporting", () => {
		const { dom, state, trackInteraction } = host();
		const observed = vi.fn();
		dom.window.document.addEventListener("praxity:assessment-response", observed);
		expect(state.set("check", draft)).toEqual({
			status: "saved",
			destination: "device",
		});
		expect(state.get("check")).toEqual(draft);
		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-response", {
				detail: {
					blockId: "check",
					responseText: "PRIVATE SUBMISSION",
					correct: true,
					score: 100,
					maxScore: 100,
				},
			}),
		);
		expect(observed).not.toHaveBeenCalled();
		expect(trackInteraction).not.toHaveBeenCalled();
		expect(state.getSaveResult?.("check")).toEqual({
			status: "saved",
			destination: "device",
		});
		dom.window.close();
	});

	it("separates learners, attempts and courses in the existing device store", () => {
		const first = host({ learner: "learner-a" });
		const storage = first.dom.window.localStorage;
		expect(first.state.set("check", draft)).toEqual({ status: "saved", destination: "device" });
		for (const options of [
			{ learner: "learner-b" },
			{ learner: "learner-a", attempt: "attempt-2" },
			{ learner: "learner-a", course: "other-course" },
		]) {
			const other = host({ ...options, storage });
			expect(other.state.get("check")).toBeUndefined();
			other.dom.window.close();
		}
		const resume = host({ learner: "learner-a", storage });
		expect(resume.state.get("check")).toEqual(draft);
		resume.dom.window.close();
		first.dom.window.close();
	});

	it("restores device state without an identity and isolates other courses and identified learners", () => {
		const first = host();
		const storage = first.dom.window.localStorage;
		first.state.set("check", draft);
		const resume = host({ storage });
		expect(resume.state.get("check")).toEqual(draft);
		for (const options of [{ course: "other" }, { learner: "learner" }]) {
			const other = host({ storage, ...options });
			expect(other.state.get("check")).toBeUndefined();
			other.dom.window.close();
		}
		resume.dom.window.close();
		first.dom.window.close();
	});

	it("removes earlier attempt bytes only for the same course and learner", () => {
		const first = host({ learner: "a" });
		const storage = first.dom.window.localStorage;
		first.state.set("check", { answer: "OLD ATTEMPT" });
		const otherLearner = host({ learner: "b", storage });
		otherLearner.state.set("check", { answer: "OTHER LEARNER" });
		const otherCourse = host({ learner: "a", course: "other", storage });
		otherCourse.state.set("check", { answer: "OTHER COURSE" });
		const device = host({ storage });
		device.state.set("check", { answer: "DEVICE ANSWER" });
		const next = host({ learner: "a", attempt: "attempt-2", newAttempt: true, storage });
		expect(next.state.get("check")).toBeUndefined();
		const values = Array.from({ length: storage.length }, (_, index) =>
			storage.getItem(storage.key(index) ?? ""),
		);
		expect(values.join("\n")).not.toContain("OLD ATTEMPT");
		expect(values.join("\n")).toContain("OTHER LEARNER");
		expect(values.join("\n")).toContain("OTHER COURSE");
		expect(values.join("\n")).toContain("DEVICE ANSWER");
		for (const instance of [first, otherLearner, otherCourse, device, next])
			instance.dom.window.close();
	});

	it("reports denied attempt cleanup and keeps the new draft usable", () => {
		const first = host({ learner: "a" });
		const storage = first.dom.window.localStorage;
		first.state.set("check", { answer: "OLD ATTEMPT" });
		const denied = vi.spyOn(Object.getPrototypeOf(storage), "removeItem").mockImplementation(() => {
			throw new DOMException("", "SecurityError");
		});
		try {
			const next = host({ learner: "a", attempt: "attempt-2", newAttempt: true, storage });
			expect(next.state.get("check")).toBeUndefined();
			expect(next.state.set("check", draft)).toEqual({
				status: "not-saved",
				code: "storage-unavailable",
			});
			expect(next.state.get("check")).toEqual(draft);
			expect(Object.values(storage).join("\n")).toContain("OLD ATTEMPT");
			next.dom.window.close();
		} finally {
			denied.mockRestore();
			first.dom.window.close();
		}
	});

	it("keeps edits in memory when storage rejects writes", () => {
		const source = host({ learner: "learner" });
		const storage = source.dom.window.localStorage;
		const denied = vi.spyOn(Object.getPrototypeOf(storage), "setItem").mockImplementation(() => {
			throw new DOMException("", "QuotaExceededError");
		});
		const attempt = host({ learner: "learner", storage });
		expect(attempt.state.set("check", draft)).toEqual({
			status: "not-saved",
			code: "storage-unavailable",
		});
		expect(attempt.state.get("check")).toEqual(draft);
		denied.mockRestore();
		attempt.dom.window.close();
		source.dom.window.close();
	});
});

describe("private choice policy", () => {
	it("admits exactly private single choices, including nested choices", () => {
		const choice = (id: string, data = {}): PraxityBlock => ({
			id,
			type: "assessment",
			data: {
				assessmentType: "choice",
				response: { type: "choice", selectionMode: "single", options: [] },
				private: true,
				...data,
			},
		});
		expect(
			compileBlockStatePolicy([
				choice("one"),
				{ id: "container", type: "accordion", data: { items: [{ blocks: [choice("two")] }] } },
				choice("absent", { private: undefined }),
				choice("false", { private: false }),
				choice("multiple", {
					response: { type: "choice", selectionMode: "multiple", options: [] },
				}),
				choice("reflection", { assessmentType: "textResponse" }),
				{ id: "self-check", type: "selfCheck", data: { private: false } },
			]),
		).toEqual({ one: "device", two: "device", "self-check": "lms" });
	});
	it("filters legacy objective records without changing public state or variable bytes", () => {
		const raw = JSON.stringify({
			blockState: { one: { answer: ["SECRET"] }, public: { answer: ["ordinary"] } },
			interactions: [
				{ id: "two", response: "SECRET" },
				{ id: "public", response: "ordinary" },
			],
			objectives: [
				{ id: "one", score: 99 },
				{ id: "public", score: 10 },
			],
			v: { publicFlag: true },
		});
		expect(JSON.parse(filterPrivateSuspendData(raw, { one: "device", two: "device" }))).toEqual({
			blockState: { public: { answer: ["ordinary"] } },
			interactions: [{ id: "public", response: "ordinary" }],
			objectives: [{ id: "public", score: 10 }],
			v: { publicFlag: true },
		});
	});
});

// Publication remains refused. Exercise the real host/transport owners directly.
describe.each(["choice", "write-distractors"] as const)(
	"private %s host transport proof",
	(pattern) => {
		const policy = compileBlockStatePolicy(
			["PRIVATE-ONE", "PRIVATE-TWO"].map((id) => ({
				id,
				type: pattern === "choice" ? "assessment" : "writeDistractors",
				data: {
					assessmentType: "choice",
					private: true,
					response: { type: "choice", selectionMode: "single", options: [] },
				},
			})),
		);
		const choiceEmpty = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			answer: [],
			attemptCount: 0,
			checked: false,
			correct: false,
			completed: false,
			interacted: false,
			reviewedChoiceIds: [],
		};
		const distractorEmpty = {
			version: 1,
			kind: "write-distractors",
			contentRevision: `sha256:${"1".repeat(64)}`,
			value: {
				answer: "",
				hadIt: null,
				shown: false,
				options: [{ text: "", misconception: "", custom: "" }],
			},
		};
		const empty = pattern === "choice" ? choiceEmpty : distractorEmpty;
		const stages =
			pattern === "choice"
				? [
						{ ...choiceEmpty, answer: ["PRIVATE-PICK"], interacted: true },
						{
							...choiceEmpty,
							answer: ["PRIVATE-PICK"],
							attemptCount: 913,
							checked: true,
							completed: true,
							interacted: true,
							reviewedChoiceIds: ["PRIVATE-PICK"],
						},
						{ ...choiceEmpty, attemptCount: 913, reviewedChoiceIds: ["PRIVATE-PICK"] },
					]
				: [null, false, true].map((hadIt) => ({
						...distractorEmpty,
						value: {
							answer: "PRIVATE-ANSWER",
							hadIt,
							shown: hadIt === true,
							options: [
								{
									text: "PRIVATE-OPTION",
									misconception: "private-label",
									custom: "PRIVATE-CUSTOM",
								},
							],
						},
					}));

		for (const format of ["scorm12", "scorm2004", "xapi", "standalone"] as const) {
			for (const identified of [false, true]) {
				it(`${format}, identified=${identified}: two private activities never reach outgoing seams across two attempts`, async () => {
					const source = new JSDOM("", { url: "https://course.example/" });
					const storage = source.window.localStorage;
					const deviceWrites = vi.spyOn(Object.getPrototypeOf(storage), "setItem");
					const windows: JSDOM[] = [source];
					const outgoing: string[] = [];
					const fetch = vi.fn().mockImplementation((_url, init) => {
						outgoing.push(String(init.body));
						return Promise.resolve(new Response(null, { status: 200 }));
					});
					vi.stubGlobal("fetch", fetch);
					try {
						for (const attempt of ["attempt-1", "attempt-2"]) {
							const actor = { name: "Learner", mbox: "mailto:learner@example.com" };
							const page = {
								version: 1,
								courseId: "choice-proof",
								pageId: "page",
								pageTitle: "Practice",
								currentPage: 1,
								totalPages: 2,
								currentSlug: "page",
								availableSlugs: ["page"],
								pageIdMap: { page: "page" },
								completionMethod: "allPages",
								pageRole: "content",
								strings: {},
								blockStatePolicy: policy,
							};
							const dom = new JSDOM(
								`<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`,
								{
									url: `https://course.example/page.html${identified ? `?actor=${encodeURIComponent(JSON.stringify(actor))}&registration=${attempt}` : ""}`,
								},
							);
							windows.push(dom);
							Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
							Object.defineProperty(dom.window, "localStorage", { value: storage });
							vi.stubGlobal("window", dom.window);
							const legacy = {
								blockState: {
									"PRIVATE-ONE":
										pattern === "choice" ? { ...choiceEmpty, answer: ["PRIVATE-PICK"] } : stages[2],
								},
								interactions: [{ id: "PRIVATE-TWO", response: "PRIVATE-RESULT", timestamp: 1 }],
								objectives: [{ id: "PRIVATE-ONE", score: 913 }],
								v: { publicFlag: true },
							};
							const data = new Map<string, string>([
								["cmi.interactions._count", "6"],
								["cmi.objectives._count", "2"],
								["cmi.core.lesson_status", "incomplete"],
								["cmi.completion_status", "incomplete"],
								[
									"cmi.suspend_data",
									JSON.stringify(
										format === "scorm12"
											? {
													visitedPages: [],
													interactions: legacy.interactions,
													custom: JSON.stringify(legacy),
												}
											: legacy,
									),
								],
							]);
							const get = (key: string) => data.get(key) ?? "";
							const set = (key: string, value: string) => {
								outgoing.push(JSON.stringify([key, value]));
								data.set(key, value);
								return "true";
							};
							const api = {
								LMSInitialize: () => "true",
								LMSFinish: () => "true",
								LMSCommit: () => "true",
								LMSGetValue: get,
								LMSSetValue: set,
								LMSGetLastError: () => "0",
								LMSGetErrorString: () => "",
								LMSGetDiagnostic: () => "",
								Initialize: () => "true",
								Terminate: () => "true",
								Commit: () => "true",
								GetValue: get,
								SetValue: set,
								GetLastError: () => "0",
								GetErrorString: () => "",
								GetDiagnostic: () => "",
							};
							Object.assign(dom.window, { API: api, API_1484_11: api });
							const xapiKey = `praxity-xapi:choice-proof:${encodeURIComponent(actor.mbox)}`;
							if (format === "xapi" && identified)
								storage.setItem(
									xapiKey,
									JSON.stringify({
										interactions: legacy.interactions,
										suspendData: JSON.stringify(legacy),
										outbox: [
											...["PRIVATE-ONE", "PRIVATE-TWO"].map((id) => ({
												actor,
												verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
												object: {
													id: `https://old-launch.example/another-course/interaction/${id}`,
												},
												result: { response: "PRIVATE-OUTBOX" },
											})),
											{
												actor,
												verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
												object: {
													id: "https://old-launch.example/another-course/interaction/ordinary-replay",
												},
												result: { response: "ordinary-replayed" },
											},
										],
									}),
								);
							const runtime: SCORMRuntime =
								format === "scorm12"
									? new Scorm12Runtime()
									: format === "scorm2004"
										? new Scorm2004Runtime(dom.window as unknown as WindowLike)
										: format === "xapi"
											? new XapiRuntime(
													{
														endpoint: "https://lrs.example/statements",
														auth: "test",
														actorMode: "lms",
													},
													"choice-proof",
													storage,
												)
											: new LocalStorageRuntime(storage, "ordinary-course");
							// Hold identity constant independently of the transport's opaque attempt token.
							runtime.getLearnerIdentity = () =>
								identified
									? {
											learnerId: "learner",
											attemptId: attempt,
											newAttempt: attempt === "attempt-2",
										}
									: null;
							const adapterWrites: string[] = [];
							let directProbe = false;
							for (const method of [
								"setBlockState",
								"setSuspendData",
								"trackInteraction",
								"trackObjective",
								"commit",
							] as const) {
								const originalMethod = runtime[method];
								if (originalMethod)
									vi.spyOn(runtime, method).mockImplementation((...args: unknown[]) => {
										if (!directProbe) adapterWrites.push(JSON.stringify(args));
										return Reflect.apply(originalMethod, runtime, args);
									});
							}
							const original = runtime.initialize.bind(runtime);
							vi.spyOn(runtime, "initialize").mockImplementation(() => {
								expect(runtime.getInteractions).toBeTypeOf("function");
								return original();
							});
							const setPolicy =
								runtime.setBlockStatePolicy && vi.spyOn(runtime, "setBlockStatePolicy");
							const events: string[] = [];
							// The capture guard must suppress even consumers registered before the host.
							dom.window.document.addEventListener("praxity:assessment-response", (event) =>
								events.push(JSON.stringify((event as CustomEvent).detail)),
							);
							expect(
								initializeCourseHost(
									{
										format,
										createRuntime: () => runtime,
										readDeploymentConfig: readCourseDeploymentConfig,
									},
									{
										win: dom.window as unknown as Window,
										doc: dom.window.document,
										location: dom.window.location,
										history: dom.window.history,
									},
								),
							).toBe(true);
							if (setPolicy)
								expect(setPolicy.mock.invocationCallOrder[0]).toBeLessThan(
									vi.mocked(runtime.initialize).mock.invocationCallOrder[0],
								);
							const state = dom.window.__praxityBlockState;
							if (!state) throw new Error("Missing block state provider");
							for (const id of ["PRIVATE-ONE", "PRIVATE-TWO"]) {
								if (attempt === "attempt-2" && identified) expect(state.get(id)).toBeUndefined();
								// select, submit and retry retain attempts and review history locally.
								for (const value of stages) {
									const beforeSave = outgoing.length;
									const beforeSaveAdapter = adapterWrites.length;
									const beforeSaveDevice = deviceWrites.mock.calls.length;
									expect(state.set(id, value)).toEqual({ status: "saved", destination: "device" });
									if (pattern === "write-distractors") {
										expect(outgoing).toHaveLength(beforeSave);
										expect(adapterWrites).toHaveLength(beforeSaveAdapter);
										expect(deviceWrites.mock.calls.length).toBeGreaterThan(beforeSaveDevice);
									}
									expect(state.get(id)).toEqual(value);
									dom.window.document.dispatchEvent(
										new dom.window.CustomEvent("praxity:assessment-response", {
											detail: {
												blockId: id,
												responseText: "PRIVATE-RESULT",
												assessmentType: "choice",
												correct: false,
												attemptsUsed: 913,
												completed: true,
											},
										}),
									);
									// Standalone has no outgoing adapter seam; its response guard is
									// exercised above. Reporting transports also defend direct calls.
									directProbe = true;
									if (format !== "standalone")
										runtime.trackInteraction(id, "PRIVATE-RESULT", false, 913);
									runtime.trackObjective?.(id, 913, false);
									directProbe = false;
								}
								const before = outgoing.length;
								const beforeDevice = deviceWrites.mock.calls.length;
								const beforeAdapter = adapterWrites.length;
								const restored = createPrivateBlockStateRuntime(
									runtime,
									page as CourseHostConfig,
									dom.window as unknown as Window,
									undefined,
									format,
								);
								expect(restored.get(id)).toEqual(stages[stages.length - 1]);
								expect(outgoing).toHaveLength(before); // passive restore never writes/reports
								expect(deviceWrites).toHaveBeenCalledTimes(beforeDevice);
								expect(adapterWrites).toHaveLength(beforeAdapter);
								state.set(id, empty); // existing reset owner clears the envelope
								expect(state.get(id)).toEqual(empty);
							}
							directProbe = true;
							runtime.setSuspendData(JSON.stringify(legacy));
							directProbe = false;
							dom.window.document.dispatchEvent(
								new dom.window.CustomEvent("praxity:assessment-response", {
									detail: {
										blockId: "public-choice",
										responseText: "ordinary-answer",
										assessmentType: "choice",
										correct: true,
										completed: true,
										submitted: true,
									},
								}),
							);
							expect(events).toHaveLength(1);
							expect(events[0]).toContain("ordinary-answer");
							expect(runtime.getInteractions()).toMatchObject([
								{ id: "public-choice", response: "ordinary-answer" },
							]);
							expect(JSON.stringify(runtime.getInteractions())).not.toContain("PRIVATE-");
							if (format !== "standalone")
								expect(runtime.getSuspendData() ?? "").not.toContain("PRIVATE-");
							const reportingSuspend =
								format === "standalone" ? "" : (runtime.getSuspendData() ?? "");
							runtime.commit();
							runtime.terminate();
							await Promise.resolve();
							expect(outgoing.join("\n")).not.toContain("PRIVATE-");
							expect(adapterWrites.join("\n")).not.toContain("PRIVATE-");
							expect(outgoing.join("\n")).not.toMatch(/attemptCount|reviewedChoiceIds/);
							if (pattern === "write-distractors") {
								for (const bytes of [
									outgoing.join("\n"),
									adapterWrites.join("\n"),
									reportingSuspend,
									storage.getItem(xapiKey) ?? "",
								]) {
									expect(bytes).not.toMatch(/write-distractors|sha256:1{64}|private-label/);
								}
							}
							if (format === "xapi" && identified) {
								expect(storage.getItem(xapiKey)).not.toContain("PRIVATE-");
								expect(
									fetch.mock.calls.filter(([, init]) => String(init.body).includes("/answered")),
								).toHaveLength(attempt === "attempt-1" ? 2 : 4);
								expect(
									fetch.mock.calls.filter(([, init]) => {
										const statement = JSON.parse(String(init.body));
										return (
											statement.object.id ===
												"https://old-launch.example/another-course/interaction/ordinary-replay" &&
											statement.result.response === "ordinary-replayed"
										);
									}),
								).toHaveLength(attempt === "attempt-1" ? 1 : 2);
							}
							if (format === "xapi" && !identified) expect(fetch).not.toHaveBeenCalled();
							if (format === "scorm12" || format === "scorm2004") {
								expect(
									Object.fromEntries(
										[...data].filter(([key]) => /^cmi.interactions.\d+\./.test(key)),
									),
								).toMatchObject({
									"cmi.interactions.6.id": "public-choice",
									"cmi.interactions.6.type": format === "scorm12" ? "performance" : "choice",
									"cmi.interactions.6.result": "correct",
									[`cmi.interactions.6.${format === "scorm12" ? "student_response" : "learner_response"}`]:
										"ordinary-answer",
								});
								// The row must be at the accepted index, not merely in suspend history.
								expect([...data].filter(([key]) => /^cmi.interactions.\d+\.id$/.test(key))).toEqual(
									[["cmi.interactions.6.id", "public-choice"]],
								);
								const raw = data.get("cmi.suspend_data") ?? "";
								const envelope = JSON.parse(raw);
								const suspend = format === "scorm12" ? JSON.parse(envelope.custom) : envelope;
								expect(suspend.v).toEqual({ publicFlag: true });
								expect(format === "scorm12" ? envelope.custom : raw).toContain(
									'"v":{"publicFlag":true}',
								);
							}
							if (format === "xapi") {
								const raw = runtime.getSuspendData() ?? "";
								expect(JSON.parse(raw).v).toEqual({ publicFlag: true });
								expect(raw).toContain('"v":{"publicFlag":true}');
							}
						}
					} finally {
						deviceWrites.mockRestore();
						for (const dom of windows) dom.window.close();
						vi.unstubAllGlobals();
					}
				});
			}
		}
	},
);

it("privacy toggles abandon the prior store without migrating either direction", () => {
	const ordinary = host({ policy: {} });
	const storage = ordinary.dom.window.localStorage;
	ordinary.state.set("choice", { answer: ["OLD-ORDINARY"] });
	const device = host({ policy: { choice: "device" }, storage });
	expect(device.state.get("choice")).toBeUndefined();
	device.state.set("choice", { answer: ["NEW-PRIVATE"] });
	expect(device.setSuspendData).not.toHaveBeenCalled();
	const back = host({ policy: {}, storage });
	expect(back.state.get("choice")).toEqual({ answer: ["OLD-ORDINARY"] });
	const privateAgain = host({ policy: { choice: "device" }, storage });
	expect(privateAgain.state.get("choice")).toEqual({ answer: ["NEW-PRIVATE"] });
	for (const instance of [ordinary, device, back, privateAgain]) instance.dom.window.close();
});

it("buffers two private choice edits while support is held and keeps ordinary writes live", async () => {
	const { dom } = host({ policy: { one: "device", two: "device" } });
	const runtime = new LocalStorageRuntime(dom.window.localStorage, "held-reporting");
	const write = vi.spyOn(runtime, "setBlockState");
	const page = JSON.parse(
		dom.window.document.getElementById("praxity-host-config")?.textContent ?? "null",
	);
	let release!: (support: typeof privacySupport) => void;
	const loaded = new Promise<typeof privacySupport>((resolve) => {
		release = resolve;
	});
	const state = bufferPrivateBlockState([runtime, page, dom.window as unknown as Window], loaded);
	try {
		for (const id of ["one", "two"]) {
			state.set(id, { answer: [`PRIVATE-${id}`] });
			expect(state.getSaveResult?.(id)).toEqual({ status: "not-saved", code: "runtime-loading" });
		}
		state.set("public", { answer: ["ordinary"] });
		expect(write).toHaveBeenCalledExactlyOnceWith("public", { answer: ["ordinary"] });
		release(privacySupport);
		await vi.waitFor(() =>
			expect(state.getSaveResult?.("two")).toEqual({ status: "saved", destination: "device" }),
		);
		for (const id of ["one", "two"]) expect(state.get(id)).toEqual({ answer: [`PRIVATE-${id}`] });
		expect(write).toHaveBeenCalledTimes(1);
	} finally {
		dom.window.close();
	}
});

it("preview reset uses its supplied device owner and never writes a transport record", () => {
	const { dom } = host();
	const device = new LocalStorageRuntime(dom.window.localStorage, "preview-owner");
	const runtime = new LocalStorageRuntime(dom.window.localStorage, "transport-owner");
	const write = vi.spyOn(runtime, "setBlockState");
	const page = JSON.parse(
		dom.window.document.getElementById("praxity-host-config")?.textContent ?? "null",
	);
	const state = createPrivateBlockStateRuntime(
		runtime,
		page,
		dom.window as unknown as Window,
		device,
		"electron-preview",
	);
	try {
		state.set("check", { attemptCount: 2, answer: ["PRIVATE-PICK"], checked: true });
		device.resetState();
		expect(state.get("check")).toBeUndefined();
		expect(write).not.toHaveBeenCalled();
	} finally {
		dom.window.close();
	}
});

it("filters response publication while DOM initialization and privacy readiness are held", async () => {
	// Match the compiler's private host define while calling its source owner directly.

	const { dom: source } = host({ policy: { one: "device", two: "device" } });
	const dom = new JSDOM(source.serialize(), { url: "https://course.example/page.html" });
	const runtime = new LocalStorageRuntime(dom.window.localStorage, "held-init");
	const initialize = vi.spyOn(runtime, "initialize");
	const responses = vi.fn();
	const ready = vi.fn();
	dom.window.document.addEventListener("praxity:assessment-response", responses);
	dom.window.addEventListener("praxity:runtime-ready", ready);
	let release!: () => void;
	dom.window.__praxityPrivacyReady = new Promise<void>((resolve) => {
		release = resolve;
	});
	Object.defineProperty(dom.window.document, "readyState", {
		value: "loading",
		configurable: true,
	});
	try {
		initializeCourseHost(
			{ format: "scorm12", createRuntime: () => runtime },
			{
				win: dom.window as unknown as Window,
				doc: dom.window.document,
				location: dom.window.location,
				history: dom.window.history,
			},
		);
		expect(initialize).not.toHaveBeenCalled();
		for (const id of ["one", "two"])
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", {
					detail: { blockId: id, responseText: "PRIVATE-EARLY" },
				}),
			);
		expect(responses).not.toHaveBeenCalled();
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
		expect(initialize).toHaveBeenCalledOnce();
		expect(ready).not.toHaveBeenCalled();
		release();
		await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
	} finally {
		dom.window.close();
		source.window.close();
		vi.unstubAllGlobals();
	}
});

it("distractors have named device policy members even with private=false, including nested blocks", () => {
	expect(
		compileBlockStatePolicy([
			{ id: "wd-one", type: "writeDistractors", data: { private: false } },
			{
				id: "container",
				type: "accordion",
				data: { items: [{ blocks: [{ id: "wd-two", type: "writeDistractors", data: {} }] }] },
			},
			{
				id: "ordinary",
				type: "assessment",
				data: {
					assessmentType: "choice",
					response: { type: "choice", selectionMode: "single", options: [] },
				},
			},
		]),
	).toEqual({ "wd-one": "device", "wd-two": "device" });
});

it.each([false, true])(
	"preview distractors, identified=%s: device saves, silent restore, two attempts and reset never write transport",
	(identified) => {
		const { dom } = host();
		const policy = compileBlockStatePolicy(
			["PRIVATE-ONE", "PRIVATE-TWO"].map((id) => ({ id, type: "writeDistractors", data: {} })),
		);
		const runtime = new LocalStorageRuntime(dom.window.localStorage, "preview-reporting");
		const write = vi.spyOn(runtime, "setBlockState");
		const suspend = vi.spyOn(runtime, "setSuspendData");
		const page = JSON.parse(
			dom.window.document.getElementById("praxity-host-config")?.textContent ?? "null",
		);
		page.blockStatePolicy = policy;
		try {
			for (const attempt of ["one", "two"]) {
				const device = new LocalStorageRuntime(
					dom.window.localStorage,
					identified ? "learner" : "shared",
					attempt,
				);
				const save = vi.spyOn(device, "setBlockState");
				const state = createPrivateBlockStateRuntime(
					runtime,
					page,
					dom.window as unknown as Window,
					device,
					"electron-preview",
				);
				for (const id of ["PRIVATE-ONE", "PRIVATE-TWO"]) {
					expect(state.get(id)).toBeUndefined();
					state.set(id, {
						version: 1,
						kind: "write-distractors",
						value: { answer: "PRIVATE-ANSWER", options: ["PRIVATE-OPTION"] },
					});
					const count = save.mock.calls.length;
					const restored = createPrivateBlockStateRuntime(
						runtime,
						page,
						dom.window as unknown as Window,
						device,
						"electron-preview",
					);
					expect(restored.get(id)).toMatchObject({ value: { answer: "PRIVATE-ANSWER" } });
					expect(save).toHaveBeenCalledTimes(count);
				}
				expect(save).toHaveBeenCalledTimes(2);
				device.resetState();
				expect(state.get("PRIVATE-ONE")).toBeUndefined();
			}
			expect(write).not.toHaveBeenCalled();
			expect(suspend).not.toHaveBeenCalled();
		} finally {
			dom.window.close();
		}
	},
);

// Pre-publication proof: real renderer/enhancer, course host and reporting adapters.
// Never weaken publication admission to exercise a learner activity.
const highlightHostFormats = {
	scorm12: true,
	scorm2004: true,
	xapi: true,
	standalone: true,
	"electron-preview": true,
} satisfies Record<CourseHostFormat, true>;
// A future host, including cmi5, must add a privacy proof before this typecheck passes.
for (const format of Object.keys(highlightHostFormats) as CourseHostFormat[]) {
	for (const identified of [false, true]) {
		it.each([false, true])(
			`highlight ${format}, identified=${identified}, deck=%s: zero activity calls/bytes with reporting controls`,
			async (deck) => {
				const storageOwner = new JSDOM("", { url: "https://course.example/" });
				const storage = storageOwner.window.localStorage;
				const windows: JSDOM[] = [storageOwner];
				const outgoing: string[] = [];
				let failNetwork = true;
				const fetch = vi.fn((_url: unknown, init?: RequestInit) => {
					outgoing.push(String(init?.body));
					return Promise.resolve(new Response(null, { status: failNetwork ? 503 : 200 }));
				});
				vi.stubGlobal("fetch", fetch);
				const writes: string[] = [];
				const responses: string[] = [];
				const storageCalls: string[] = [];
				const adapterCalls: string[] = [];
				const data = new Map<string, string>([
					["cmi.interactions._count", "0"],
					["cmi.objectives._count", "0"],
					["cmi.core.lesson_status", "incomplete"],
					["cmi.completion_status", "incomplete"],
				]);
				const set = (key: string, value: string) => {
					data.set(key, value);
					writes.push(JSON.stringify([key, value]));
					return "true";
				};
				const commit = () => {
					writes.push("commit");
					return "true";
				};
				const api = {
					LMSInitialize: () => "true",
					LMSFinish: () => "true",
					LMSCommit: commit,
					LMSGetValue: (key: string) => data.get(key) ?? "",
					LMSSetValue: set,
					LMSGetLastError: () => "0",
					LMSGetErrorString: () => "",
					LMSGetDiagnostic: () => "",
					Initialize: () => "true",
					Terminate: () => "true",
					Commit: commit,
					GetValue: (key: string) => data.get(key) ?? "",
					SetValue: set,
					GetLastError: () => "0",
					GetErrorString: () => "",
					GetDiagnostic: () => "",
				};
				let runtime: SCORMRuntime | undefined;
				const mounted: ReturnType<typeof enhanceHighlight>[] = [];
				const snapshot = () =>
					JSON.stringify({ outgoing, writes, adapterCalls, responses, storageCalls });
				try {
					for (const method of ["getItem", "setItem", "removeItem", "clear"] as const) {
						const original = storage[method];
						vi.spyOn(Object.getPrototypeOf(storage), method).mockImplementation(function (
							this: Storage,
							...args: unknown[]
						) {
							storageCalls.push(JSON.stringify([method, ...args]));
							return Reflect.apply(original, this, args);
						});
					}
					for (const reload of [false, true]) {
						failNetwork = !reload;
						const page: CourseHostConfig = {
							version: 1,
							courseId: "reporting-proof",
							pageId: "page",
							pageTitle: "Reading",
							currentPage: 1,
							totalPages: 2,
							currentSlug: "page",
							availableSlugs: ["page", "next"],
							pageIdMap: { page: "page", next: "next" },
							completionMethod: "allPages",
							pageRole: "content",
							strings: {},
							deck,
							deferVisits: deck,
							blockStatePolicy: {},
						};
						const actor = { name: "Learner", mbox: "mailto:learner@example.com" };
						const markup = (["en", "fr"] as const)
							.map(
								(lang, index) =>
									`<section ${index ? "hidden" : ""} data-block-id="HL-PRIVATE-${index}" data-block-type="highlight">${renderHighlight(
										{
											mode: index ? "evidence" : "key",
											title: `HL-PRIVATE-TITLE-${lang}`,
											question: `HL-PRIVATE-QUESTION-${lang}`,
											maxMarks: 2,
											paragraphs: [
												[
													{
														id: "HL-target-one",
														text: `HL-PRIVATE-TEXT-${lang}`,
														key: true,
														note: "HL-PRIVATE-NOTE",
													},
													{ id: "HL-target-two", text: "HL-PRIVATE-SECOND", key: true },
													{
														id: "HL-wrong",
														text: "HL-PRIVATE-WRONG",
														note: "HL-PRIVATE-WRONG-NOTE",
													},
												],
											],
										},
										{ prefix: `HL-PRIVATE-${index}`, lang, headingLevel: 2 },
									)}</section>`,
							)
							.join("");
						const dom = new JSDOM(
							`<script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format, ...(format === "electron-preview" ? { revision: "a".repeat(64) } : {}) })}</script>${markup}`,
							{
								url: `https://course.example/page.html${identified ? `?actor=${encodeURIComponent(JSON.stringify(actor))}&registration=attempt` : ""}`,
								pretendToBeVisual: true,
							},
						);
						windows.push(dom);
						const win = dom.window;
						Object.defineProperty(win, "localStorage", { value: storage });
						Object.defineProperty(win.document, "readyState", { value: "complete" });
						Object.assign(win, { API: { ...api }, API_1484_11: { ...api } });
						vi.stubGlobal("window", win);
						runtime =
							format === "scorm12"
								? new Scorm12Runtime()
								: format === "scorm2004"
									? new Scorm2004Runtime(win as unknown as WindowLike)
									: format === "xapi"
										? new XapiRuntime(
												{
													endpoint: "https://lrs.example/statements",
													auth: "test",
													actorMode: "lms",
												},
												"reporting-proof",
												storage,
											)
										: new LocalStorageRuntime(storage, "reporting-proof");
						runtime.getLearnerIdentity = () =>
							identified ? { learnerId: "learner", attemptId: "attempt", newAttempt: false } : null;
						for (const method of [
							"setBlockState",
							"getBlockState",
							"setSuspendData",
							"trackInteraction",
							"trackObjective",
							"setCompletion",
							"commit",
						] as const) {
							const original = runtime[method];
							if (original)
								vi.spyOn(runtime, method).mockImplementation((...args: unknown[]) => {
									adapterCalls.push(JSON.stringify([method, ...args]));
									return Reflect.apply(original, runtime, args);
								});
						}
						win.document.addEventListener("praxity:assessment-response", (event) =>
							responses.push(JSON.stringify((event as CustomEvent).detail)),
						);
						expect(
							initializeCourseHost(
								{
									format,
									createRuntime: () => runtime!,
									readDeploymentConfig: () => ({ format }),
									...(format === "electron-preview" ? { deviceStateRuntime: runtime } : {}),
								},
								{
									win: win as unknown as Window,
									doc: win.document,
									location: win.location,
									history: win.history,
								},
							),
						).toBe(true);
						const provider = win.__praxityBlockState!;
						const stateCalls: string[] = [];
						for (const method of ["get", "set"] as const) {
							const original = provider[method];
							vi.spyOn(provider, method).mockImplementation((...args: unknown[]) => {
								stateCalls.push(JSON.stringify([method, ...args]));
								return Reflect.apply(original, provider, args);
							});
						}
						for (const root of win.document.querySelectorAll<HTMLElement>("[data-highlight]")) {
							const before = snapshot();
							const instance = enhanceHighlight(root);
							mounted.push(instance);
							const chunks = [...root.querySelectorAll<HTMLElement>("[data-highlight-chunk]")];
							const button = (name: string) =>
								root.querySelector<HTMLButtonElement>(`[data-highlight-${name}]`)!;
							for (const selection of [[], [0], [0, 1], [2], [0, 1, 2]]) {
								for (const index of selection) chunks[index].click();
								if (selection.length === 3) {
									expect(chunks[2].getAttribute("aria-pressed")).toBe("false");
									expect(button("limit").hidden).toBe(false);
								}
								button("check").click();
								expect(root.querySelector<HTMLDetailsElement>("details")!.open).toBe(true);
								expect(enhanceHighlight(root)).toBe(instance);
								expect(snapshot()).toBe(before);
								expect(stateCalls).toEqual([]);
								expect(root.matches("[data-completed],[data-attempted]")).toBe(false);
								expect(root.querySelectorAll("[data-completed],[data-attempted]")).toHaveLength(0);
								const screen = root.outerHTML;
								win.dispatchEvent(new win.Event("beforeprint"));
								win.dispatchEvent(new win.Event("afterprint"));
								expect(root.outerHTML).toBe(screen);
								button("restart").click();
							}
							chunks[0].click();
							button("check").click();
							const screen = root.outerHTML;
							if (runtime instanceof LocalStorageRuntime) runtime.resetState();
							else runtime.setSuspendData("{}");
							expect(root.outerHTML).toBe(screen); // A provider reset cannot clear this mounted attempt.
							instance.destroy();
							const fresh = enhanceHighlight(root);
							mounted.push(fresh);
							expect(chunks.every((chunk) => chunk.getAttribute("aria-pressed") === "false")).toBe(
								true,
							);
						}
						// Independent positive controls at the existing host/provider interfaces.
						provider.set("public-choice", { answer: ["ordinary-answer"], checked: true });
						const variables = new VariableStore(
							[{ name: "publicFlag", dataType: "boolean", defaultValue: false }],
							runtime,
						);
						variables.set("publicFlag", true);
						win.document.dispatchEvent(
							new win.CustomEvent("praxity:assessment-response", {
								detail: {
									blockId: "public-choice",
									responseText: "ordinary-answer",
									assessmentType: "choice",
									correct: true,
									completed: true,
									submitted: true,
								},
							}),
						);
						expect(runtime.getInteractions()).toContainEqual(
							expect.objectContaining({ id: "public-choice", response: "ordinary-answer" }),
						);
						expect(runtime.getSuspendData()).toContain('"publicFlag":true');
						expect(stateCalls).toEqual([expect.stringContaining("public-choice")]);
						expect(responses).toContainEqual(expect.stringContaining("ordinary-answer"));
						const reportingSuspend = runtime.getSuspendData() ?? "";
						runtime.commit();
						win.dispatchEvent(new win.Event("beforeunload"));
						runtime.terminate();
						await Promise.resolve();
						for (const bytes of [
							snapshot(),
							JSON.stringify([...data]),
							JSON.stringify(
								Array.from({ length: storage.length }, (_, i) => [
									storage.key(i),
									storage.getItem(storage.key(i)!),
								]),
							),
							reportingSuspend,
						]) {
							expect(bytes).not.toMatch(/HL-PRIVATE|HL-target|HL-wrong|marked|shown|highlight/);
						}
						if (format === "scorm12" || format === "scorm2004") {
							expect(writes).toContain("commit");
							expect(data.get("cmi.interactions.0.id")).toBe("public-choice");
							const raw = data.get("cmi.suspend_data")!;
							const envelope = JSON.parse(raw);
							expect(format === "scorm12" ? JSON.parse(envelope.custom).v : envelope.v).toEqual({
								publicFlag: true,
							});
						}
						if (format === "xapi") {
							if (identified)
								expect(outgoing.some((bytes) => bytes.includes("ordinary-answer"))).toBe(true);
							else expect(outgoing).toEqual([]);
						}
						mounted.splice(0).forEach((instance) => instance.destroy());
					}
				} finally {
					mounted.forEach((instance) => instance.destroy());
					vi.restoreAllMocks();
					vi.unstubAllGlobals();
					windows.forEach((dom) => dom.window.close());
				}
			},
		);
	}
}
