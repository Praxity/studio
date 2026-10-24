import { readFileSync } from "node:fs";
import { compileBlockStatePolicy } from "@praxity/shared-blocks/block-state-policy";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import { VariableStore } from "@praxity/shared-blocks/logic";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { initAssessmentGroups } from "@praxity/shared-blocks/viewer/assessment-group-runtime";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { generateHtmlIndex } from "../src/html-gen";
import { SCORM12_SUSPEND_DATA_LIMIT, Scorm12Runtime } from "../src/scorm/api/scorm12";
import { type SCORM2004API, Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";
import { readSessionState, resetSessionState } from "../src/scorm/api/session";
import { CourseTracker } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { type CourseHostConfig, initializeCourseHost } from "../template/src/hosts/course-host";
import { createPrivateBlockStateRuntime } from "../template/src/hosts/private-block-state";

const g = globalThis as Record<string, unknown>;

class StrictScorm12Api {
	calls: Array<[string, ...string[]]> = [];
	errors: string[] = [];
	data = new Map<string, string>([
		["cmi.core.lesson_status", "not attempted"],
		["cmi.suspend_data", ""],
	]);
	private initialized = false;
	private finished = false;
	private lastError = "0";

	LMSInitialize(param: string): string {
		this.calls.push(["LMSInitialize", param]);
		if (param !== "") return this.fail("201");
		if (this.initialized) return this.fail("101");
		this.initialized = true;
		this.finished = false;
		return this.ok();
	}

	LMSFinish(param: string): string {
		this.calls.push(["LMSFinish", param]);
		if (param !== "" || !this.initialized) return this.fail("301");
		this.finished = true;
		this.initialized = false;
		return this.ok();
	}

	LMSGetValue(element: string): string {
		this.calls.push(["LMSGetValue", element]);
		if (!this.initialized) {
			this.fail("301");
			return "";
		}
		this.ok();
		return element === "cmi.objectives._count"
			? String([...this.data.keys()].filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key)).length)
			: (this.data.get(element) ?? "");
	}

	LMSSetValue(element: string, value: string): string {
		this.calls.push(["LMSSetValue", element, value]);
		if (!this.initialized || this.finished) return this.fail("301");
		if (!this.isValidSetValue(element, value)) return this.fail("405");
		this.data.set(element, value);
		return this.ok();
	}

	LMSCommit(param: string): string {
		this.calls.push(["LMSCommit", param]);
		if (param !== "" || !this.initialized || this.finished) return this.fail("301");
		return this.ok();
	}

	LMSGetLastError(): string {
		return this.lastError;
	}

	LMSGetErrorString(errorCode: string): string {
		const errors: Record<string, string> = {
			"0": "No error",
			"101": "General exception",
			"201": "Invalid argument error",
			"301": "Not initialized",
			"405": "Incorrect data type",
		};
		return errors[errorCode] ?? "Unknown error";
	}

	LMSGetDiagnostic(errorCode: string): string {
		return `strict SCORM 1.2 diagnostic ${errorCode}`;
	}

	private ok(): "true" {
		this.lastError = "0";
		return "true";
	}

	private fail(code: string): "false" {
		this.errors.push(code);
		this.lastError = code;
		return "false";
	}

	private isValidSetValue(element: string, value: string): boolean {
		if (element === "cmi.core.session_time") return /^\d{4}:[0-5]\d:[0-5]\d\.\d{2}$/.test(value);
		if (element === "cmi.core.exit") return ["", "suspend", "time-out", "logout"].includes(value);
		if (element === "cmi.core.lesson_status") {
			return ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"].includes(
				value,
			);
		}
		if (element === "cmi.suspend_data") {
			return value.length <= SCORM12_SUSPEND_DATA_LIMIT;
		}
		if (["cmi.core.score.raw", "cmi.core.score.min", "cmi.core.score.max"].includes(element)) {
			return value.trim() !== "" && Number.isFinite(Number(value));
		}
		if (element === "cmi.core.lesson_location") {
			return value.length <= 255;
		}
		if (/^cmi\.interactions\.\d+\.result$/.test(element)) {
			return ["correct", "wrong", "unanticipated", "neutral"].includes(value);
		}
		if (/^cmi\.interactions\.\d+\.type$/.test(element)) {
			return [
				"true-false",
				"choice",
				"fill-in",
				"matching",
				"performance",
				"sequencing",
				"likert",
				"numeric",
			].includes(value);
		}
		if (/^cmi\.interactions\.\d+\.(id|student_response|weighting)$/.test(element)) {
			return value.length > 0;
		}
		if (/^cmi\.objectives\.\d+\.status$/.test(element)) {
			return ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"].includes(
				value,
			);
		}
		if (/^cmi\.objectives\.\d+\.(id|score\.raw)$/.test(element)) {
			return value.length > 0;
		}
		return false;
	}
}

class StrictScorm2004Api implements SCORM2004API {
	calls: Array<[string, ...string[]]> = [];
	errors: string[] = [];
	data = new Map<string, string>([["cmi.suspend_data", ""]]);
	private initialized = false;
	private terminated = false;
	private lastError = "0";

	Initialize(param: string): string {
		this.calls.push(["Initialize", param]);
		if (param !== "" || this.initialized) return this.fail("103");
		this.initialized = true;
		this.terminated = false;
		return this.ok();
	}

	Terminate(param: string): string {
		this.calls.push(["Terminate", param]);
		if (param !== "" || !this.initialized) return this.fail("112");
		this.terminated = true;
		this.initialized = false;
		return this.ok();
	}

	GetValue(element: string): string {
		this.calls.push(["GetValue", element]);
		if (!this.initialized) {
			this.fail("122");
			return "";
		}
		this.ok();
		return element === "cmi.objectives._count"
			? String([...this.data.keys()].filter((key) => /^cmi\.objectives\.\d+\.id$/.test(key)).length)
			: (this.data.get(element) ?? "");
	}

	SetValue(element: string, value: string): string {
		this.calls.push(["SetValue", element, value]);
		if (!this.initialized || this.terminated) return this.fail("132");
		if (!this.isValidSetValue(element, value)) return this.fail("406");
		this.data.set(element, value);
		return this.ok();
	}

	Commit(param: string): string {
		this.calls.push(["Commit", param]);
		if (param !== "" || !this.initialized || this.terminated) return this.fail("142");
		return this.ok();
	}

	GetLastError(): string {
		return this.lastError;
	}

	GetErrorString(errorCode: string): string {
		const errors: Record<string, string> = {
			"0": "No error",
			"103": "Already initialized",
			"112": "Termination before initialization",
			"122": "Retrieve data before initialization",
			"132": "Store data before initialization",
			"142": "Commit before initialization",
			"406": "Data model element type mismatch",
		};
		return errors[errorCode] ?? "Unknown error";
	}

	GetDiagnostic(errorCode: string): string {
		return `strict SCORM 2004 diagnostic ${errorCode}`;
	}

	private ok(): "true" {
		this.lastError = "0";
		return "true";
	}

	private fail(code: string): "false" {
		this.errors.push(code);
		this.lastError = code;
		return "false";
	}

	private isValidSetValue(element: string, value: string): boolean {
		if (element === "cmi.session_time")
			return /^PT(?:\d+H)?(?:\d+M)?\d+(?:\.\d{1,2})?S$/.test(value);
		if (element === "cmi.exit")
			return ["", "normal", "suspend", "time-out", "logout"].includes(value);
		if (element === "cmi.completion_status") {
			return ["completed", "incomplete", "not attempted", "unknown"].includes(value);
		}
		if (element === "cmi.success_status") {
			return ["passed", "failed", "unknown"].includes(value);
		}
		if (["cmi.score.raw", "cmi.score.min", "cmi.score.max"].includes(element)) {
			return value.trim() !== "" && Number.isFinite(Number(value));
		}
		if (element === "cmi.score.scaled") {
			const numeric = Number(value);
			return Number.isFinite(numeric) && numeric >= -1 && numeric <= 1;
		}
		if (element === "cmi.location") {
			return value.length <= 1000;
		}
		if (element === "cmi.suspend_data") {
			return value.length <= 64_000;
		}
		if (/^cmi\.interactions\.\d+\.type$/.test(element)) {
			return [
				"choice",
				"true-false",
				"fill-in",
				"long-fill-in",
				"matching",
				"performance",
				"sequencing",
				"likert",
				"numeric",
				"other",
			].includes(value);
		}
		if (/^cmi\.interactions\.\d+\.result$/.test(element)) {
			return ["correct", "incorrect", "unanticipated", "neutral"].includes(value);
		}
		if (/^cmi\.interactions\.\d+\.timestamp$/.test(element)) {
			return (
				// SCORM 2004 RTE 4.1.1.7 time(second,10,0): YYYY[-MM[-DD[Thh[:mm[:ss[.s[TZD]]]]]]].
				// A time zone designator requires fractional seconds, at most two digits.
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,2}(?:Z|[+-]\d{2}(?::\d{2})?)?)?$/.test(
					value,
				) && !Number.isNaN(Date.parse(value))
			);
		}
		if (/^cmi\.interactions\.\d+\.(id|learner_response|description|weighting)$/.test(element)) {
			return value.length > 0;
		}
		if (/^cmi\.objectives\.\d+\.success_status$/.test(element)) {
			return ["passed", "failed", "unknown"].includes(value);
		}
		if (/^cmi\.objectives\.\d+\.(id|score\.raw)$/.test(element)) {
			return value.length > 0;
		}
		return false;
	}
}

function installScorm12Api(api: StrictScorm12Api): void {
	const win = { API: api, parent: undefined as unknown, opener: undefined };
	win.parent = win;
	g.window = win;
}

function createScorm2004Runtime(api: StrictScorm2004Api): Scorm2004Runtime {
	const win: WindowLike = { API_1484_11: api, parent: null as unknown as WindowLike };
	win.parent = win;
	return new Scorm2004Runtime(win);
}

describe("SCORM 1.2 retry metadata across resume", () => {
	it("rejects malformed restored attempt counts and membership before course decisions", () => {
		const api = new StrictScorm12Api();
		installScorm12Api(api);
		const runtime = new Scorm12Runtime();
		expect(runtime.initialize()).toBe(true);
		runtime.trackInteraction("question", "partial", false, 40);
		const payload = JSON.parse(api.data.get("cmi.suspend_data") ?? "{}");
		Object.assign(payload.interactions[0], { attemptsUsed: "1", maxAttempts: 2, memberIds: [""] });
		api.data.set("cmi.suspend_data", JSON.stringify(payload));
		expect(runtime.getInteractions()[0].attemptsUsed).toBeUndefined();
		expect(runtime.getInteractions()[0].memberIds).toBeUndefined();
		new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "allPages",
			passMark: 80,
			scoredAssessmentIds: ["question"],
			deferRetryableFailure: true,
		}).checkCompletion();
		expect(runtime.getCompletion()).toBe("failed");
	});

	it.each([false, true])(
		"explicit finish preserves a retryable failure with retained utility adapter=%s",
		(utility) => {
			const api = new StrictScorm12Api();
			installScorm12Api(api);
			const runtime = new Scorm12Runtime();
			expect(runtime.initialize()).toBe(true);
			const retained = new Scorm12Runtime();
			expect(retained.initialize()).toBe(true);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "allPages",
				passMark: 80,
				scoredAssessmentIds: ["question"],
				deferRetryableFailure: true,
			});
			tracker.trackPageVisit("page");
			tracker.trackInteraction("question", "partial", false, 40, {
				attemptsUsed: 1,
				maxAttempts: 2,
			});
			expect(runtime.commit()).toBe(true);
			expect((utility ? retained : runtime).terminate(true)).toBe(true);
			expect(api.data.get("cmi.core.lesson_status")).toBe("incomplete");
			expect(api.data.get("cmi.core.score.raw")).toBe("40");
			expect(api.data.get("cmi.core.exit")).toBe("suspend");
			expect(api.calls.filter(([name]) => name === "LMSFinish")).toHaveLength(1);
		},
	);

	it("retains unlimited attempts and aggregate membership in suspend data", () => {
		const api = new StrictScorm12Api();
		installScorm12Api(api);
		const runtime = new Scorm12Runtime();
		expect(runtime.initialize()).toBe(true);
		const config = {
			totalPages: 1,
			completionMethod: "allPages" as const,
			passMark: 80,
			scoredAssessmentIds: ["group"],
			deferRetryableFailure: true,
		};
		const tracker = new CourseTracker(runtime, config);
		tracker.trackPageVisit("page");
		tracker.trackInteraction("member", "partial", false, 40, {
			attemptsUsed: 1,
			maxAttempts: Number.POSITIVE_INFINITY,
		});
		tracker.trackInteraction("group", "40%", false, 40, { memberIds: ["member"] });
		expect(runtime.commit()).toBe(true);
		expect(api.data.get("cmi.core.lesson_status")).toBe("incomplete");
		expect(api.data.get("cmi.core.score.raw")).toBe("40");
		expect(api.data.get("cmi.core.exit")).toBe("suspend");
		expect(runtime.terminate()).toBe(true);
		const resumedApi = new StrictScorm12Api();
		resumedApi.data = new Map(api.data);
		installScorm12Api(resumedApi);
		const resumed = new Scorm12Runtime();
		expect(resumed.initialize()).toBe(true);
		expect(resumed.getInteractions()).toMatchObject([
			{ id: "member", attemptsUsed: 1, maxAttempts: 0 },
			{ id: "group", memberIds: ["member"] },
		]);
		new CourseTracker(resumed, config).checkCompletion();
		expect(resumed.getCompletion()).toBe("incomplete");
	});
});

for (const version of ["1.2", "2004"] as const) {
	describe(`SCORM ${version} private block host contract`, () => {
		function host(api: StrictScorm12Api | StrictScorm2004Api, reported = false, storage?: Storage) {
			if (api instanceof StrictScorm12Api) installScorm12Api(api);
			const runtime =
				api instanceof StrictScorm12Api ? new Scorm12Runtime() : createScorm2004Runtime(api);
			const format = version === "1.2" ? "scorm12" : "scorm2004";
			const page = {
				version: 1,
				courseId: "course",
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
				blockStatePolicy: { check: reported ? "lms" : "device" },
			};
			const dom = new JSDOM(
				`<!doctype html><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`,
				{ url: "https://course.example/page.html" },
			);
			Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
			if (storage) Object.defineProperty(dom.window, "localStorage", { value: storage });
			expect(
				initializeCourseHost(
					{ format, createRuntime: () => runtime },
					{
						win: dom.window as unknown as Window,
						doc: dom.window.document,
						location: dom.window.location,
						history: dom.window.history,
					},
				),
			).toBe(true);
			const state = (dom.window as unknown as { __praxityBlockState: LearnerBlockStateRuntime })
				.__praxityBlockState;
			return { dom, state, runtime };
		}
		const saved = {
			version: 1,
			kind: "self-check",
			draft: { answer: "PRIVATE-DRAFT", ticked: ["PRIVATE-TICK"], shown: false },
			submitted: {
				answer: "PRIVATE-SUBMITTED",
				ticked: ["PRIVATE-TICK"],
				shown: true,
				contentRevision: "sha256:private-revision",
			},
		};
		const response = {
			blockId: "check",
			assessmentType: "textResponse",
			responseText: "The report arrives Tuesday.",
			questionText: "Explain the delay.",
			language: "en",
			result: "neutral",
			submitted: true,
		};
		it("keeps drafts, ticks, submissions and flags out of every actual LMS call and response event", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			api.data.set(version === "1.2" ? "cmi.core.student_id" : "cmi.learner_id", "learner-a");
			const { dom, state, runtime } = host(api);
			const seen = vi.fn();
			dom.window.document.addEventListener("praxity:assessment-response", seen);
			expect(state.set("check", saved)).toEqual({ status: "saved", destination: "device" });
			expect(state.get("check")).toEqual(saved);
			// Logic/deck round trips and retained runtime callers use the same policy.
			runtime.setSuspendData(
				JSON.stringify({
					blockState: { check: saved },
					interactions: [{ id: "check", response: "PRIVATE-SUBMITTED", correct: true }],
					variables: { ordinary: 1 },
				}),
			);
			runtime.trackInteraction("check", "PRIVATE-SUBMITTED", true, 100);
			runtime.trackObjective("check", 100, true);
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", {
					detail: { ...response, responseText: "PRIVATE-SUBMITTED", completed: true },
				}),
			);
			expect(runtime.commit()).toBe(true);
			expect(runtime.terminate()).toBe(true);
			expect(seen).not.toHaveBeenCalled();
			for (const marker of [
				"PRIVATE-DRAFT",
				"PRIVATE-TICK",
				"PRIVATE-SUBMITTED",
				"private-revision",
				'"shown"',
				'"completed"',
				'"check"',
			])
				expect(JSON.stringify(api.calls)).not.toContain(marker);
			expect(api.data.get("cmi.suspend_data")).not.toContain("blockState");
			expect(
				api.calls.filter(
					([method, key]) =>
						(method === "SetValue" || method === "LMSSetValue") &&
						key?.startsWith("cmi.interactions."),
				),
			).toEqual([]);
			dom.window.close();
		});
		it("creates a device attempt without randomUUID on an HTTP LMS", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			api.data.set(version === "1.2" ? "cmi.core.student_id" : "cmi.learner_id", "learner-a");
			api.data.set(version === "1.2" ? "cmi.core.entry" : "cmi.entry", "ab-initio");
			vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
			try {
				if (version === "1.2") installScorm12Api(api as StrictScorm12Api);
				const runtime =
					version === "1.2"
						? new Scorm12Runtime()
						: createScorm2004Runtime(api as StrictScorm2004Api);
				expect(runtime.initialize()).toBe(true);
				let identity: ReturnType<typeof runtime.getLearnerIdentity> | undefined;
				expect(() => {
					identity = runtime.getLearnerIdentity();
				}).not.toThrow();
				expect(identity).toEqual({
					learnerId: "learner-a",
					attemptId: "ffffffff-ffff-4fff-bfff-ffffffffffff",
					newAttempt: true,
				});
				expect(runtime.getSuspendData()).toContain(
					'"deviceAttemptId":"ffffffff-ffff-4fff-bfff-ffffffffffff"',
				);
			} finally {
				vi.unstubAllGlobals();
			}
		});
		it("resumes only the same learner and attempt, and separates a new ab-initio attempt", () => {
			const identityKey = version === "1.2" ? "cmi.core.student_id" : "cmi.learner_id";
			const entryKey = version === "1.2" ? "cmi.core.entry" : "cmi.entry";
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			api.data.set(identityKey, "learner-a");
			api.data.set(entryKey, "ab-initio");
			const first = host(api);
			first.state.set("check", saved);
			first.runtime.terminate();
			const storage = first.dom.window.localStorage;
			for (const [learner, entry, expected] of [
				["learner-a", "resume", saved],
				["learner-b", "resume", undefined],
				["learner-a", "ab-initio", undefined],
			] as const) {
				const nextApi = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
				nextApi.data = new Map(api.data);
				nextApi.data.set(identityKey, learner);
				nextApi.data.set(entryKey, entry);
				const next = host(nextApi, false, storage);
				expect(next.state.get("check")).toEqual(expected);
				if (learner === "learner-a" && entry === "ab-initio") {
					const values = Array.from({ length: storage.length }, (_, index) =>
						storage.getItem(storage.key(index) ?? ""),
					);
					expect(values.join("\n")).not.toContain("PRIVATE-DRAFT");
				}
				next.runtime.terminate();
				next.dom.window.close();
			}
			first.dom.window.close();
		});
		it("keeps both existing LMS shells' drafts when reopening either attempt", () => {
			const identityKey = version === "1.2" ? "cmi.core.student_id" : "cmi.learner_id";
			const entryKey = version === "1.2" ? "cmi.core.entry" : "cmi.entry";
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			api.data.set(identityKey, "learner-a");
			api.data.set(entryKey, "ab-initio");
			const first = host(api);
			first.state.set("check", saved);
			const secondApi = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			secondApi.data.set(identityKey, "learner-a");
			secondApi.data.set(entryKey, "resume");
			secondApi.data.set(
				"cmi.suspend_data",
				JSON.stringify({
					visitedPages: [],
					interactions: [],
					...(version === "1.2"
						? { custom: '{"deviceAttemptId":"00000000-0000-4000-8000-000000000002"}' }
						: { deviceAttemptId: "00000000-0000-4000-8000-000000000002" }),
				}),
			);
			const storage = first.dom.window.localStorage;
			const second = host(secondApi, false, storage);
			expect(second.state.get("check")).toBeUndefined();
			second.state.set("check", { answer: "SECOND SHELL" });
			const resume = host(api, false, storage);
			expect(resume.state.get("check")).toEqual(saved);
			const resumeSecond = host(secondApi, false, storage);
			expect(resumeSecond.state.get("check")).toEqual({ answer: "SECOND SHELL" });
			for (const instance of [first, second, resume, resumeSecond]) instance.dom.window.close();
		});
		it("separates a fresh launch when the LMS reuses an open API object", () => {
			const identityKey = version === "1.2" ? "cmi.core.student_id" : "cmi.learner_id";
			const entryKey = version === "1.2" ? "cmi.core.entry" : "cmi.entry";
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			api.data.set(identityKey, "learner-a");
			api.data.set(entryKey, "ab-initio");
			const first = host(api);
			first.state.set("check", saved);
			const oldData = new Map(api.data);
			const storage = first.dom.window.localStorage;
			resetSessionState(api, { [version === "1.2" ? "API" : "API_1484_11"]: api });
			Object.assign(api, version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api());
			api.data = oldData;
			const next = host(api, false, storage);
			expect(next.state.get("check")).toBeUndefined();
			expect(next.state.getSaveResult?.("check")).toBeUndefined();
			next.dom.window.close();
			first.dom.window.close();
		});

		it("keeps existing reporting state when a logic write is rejected", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const { dom, state, runtime } = host(api, true);
			state.set("check", { answer: "Saved answer" });
			const before = runtime.getSuspendData();
			const original =
				api instanceof StrictScorm12Api ? api.LMSSetValue.bind(api) : api.SetValue.bind(api);
			const spy =
				api instanceof StrictScorm12Api ? vi.spyOn(api, "LMSSetValue") : vi.spyOn(api, "SetValue");
			spy.mockImplementation((key, value) =>
				key === "cmi.suspend_data" && value.includes("blockState") ? "false" : original(key, value),
			);
			const variables = new VariableStore([{ name: "flag", dataType: "boolean" }], runtime);
			expect(() => variables.set("flag", true)).not.toThrow();
			expect(variables.get("flag")).toBe(true);
			expect(runtime.getSuspendData()).toBe(before);
			expect(state.get("check")).toEqual({ answer: "Saved answer" });
			dom.window.close();
		});

		it("filters older private suspend records before page tracking can rewrite them", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const custom = { blockState: { check: saved }, ordinary: "keep" };
			const interactions = [
				{
					id: "check",
					response: "PRIVATE-SUBMITTED",
					correct: true,
					score: 100,
					timestamp: 1800000000000,
				},
			];
			api.data.set(
				"cmi.suspend_data",
				JSON.stringify(
					version === "1.2"
						? { visitedPages: [], interactions, custom: JSON.stringify(custom) }
						: { visitedPages: [], interactions, ...custom },
				),
			);
			const { dom, runtime } = host(api);
			expect(runtime.getInteractions()).toEqual([]);
			expect(runtime.getSuspendData()).toContain('"ordinary":"keep"');
			for (const [method, key, value] of api.calls) {
				if ((method === "LMSSetValue" || method === "SetValue") && key === "cmi.suspend_data")
					expect(value).not.toContain("PRIVATE-");
			}
			dom.window.close();
		});
		it("writes reportable state and a neutral answer through the LMS API", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const { dom, state } = host(api, true);
			expect(state.set("check", saved)).toEqual({ status: "saved", destination: "lms" });
			dom.window.document.dispatchEvent(
				new dom.window.CustomEvent("praxity:assessment-response", { detail: response }),
			);
			expect(api.data.get("cmi.suspend_data")).toContain("PRIVATE-DRAFT");
			expect(
				api.data.get(
					`cmi.interactions.0.${version === "1.2" ? "student_response" : "learner_response"}`,
				),
			).toBe("The report arrives Tuesday.");
			expect(api.data.get("cmi.interactions.0.result")).toBe("neutral");
			expect(api.data.get("cmi.interactions.0.type")).toBe(
				version === "1.2" ? "fill-in" : "long-fill-in",
			);
			expect(api.data.has("cmi.interactions.0.weighting")).toBe(false);
			expect(api.data.get("cmi.interactions.0.id")).toBe("check");
			if (version === "2004")
				expect(api.data.get("cmi.interactions.0.description")).toBe("{lang=en}Explain the delay.");
			expect(
				[...api.data.keys()].filter((key) => /interactions.*(score|correct_responses)/.test(key)),
			).toEqual([]);
			dom.window.close();
		});
		it("discloses only answers cut by the report limit, with content-free metadata", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const { dom } = host(api, true);
			const limit = version === "1.2" ? 250 : 3900;
			const notices: unknown[] = [];
			dom.window.document.addEventListener("praxity:assessment-response-truncated", (event) =>
				notices.push((event as CustomEvent).detail),
			);
			for (const answer of ["a".repeat(limit), "a".repeat(limit) + "TAIL"]) {
				dom.window.document.dispatchEvent(
					new dom.window.CustomEvent("praxity:assessment-response", {
						detail: {
							...response,
							responseText: answer,
							questionText: "Expliquez le retard.",
							language: "fr",
						},
					}),
				);
			}
			expect(notices).toEqual([{ blockId: "check", responseLimit: limit }]);
			for (const row of [0, 1]) {
				expect(api.data.get(`cmi.interactions.${row}.id`)).toBe("check");
				expect(
					api.data.get(
						`cmi.interactions.${row}.${version === "1.2" ? "student_response" : "learner_response"}`,
					),
				).toBe("a".repeat(limit));
				expect(api.data.get(`cmi.interactions.${row}.result`)).toBe("neutral");
				expect(api.data.has(`cmi.interactions.${row}.weighting`)).toBe(false);
				if (version === "2004")
					expect(api.data.get(`cmi.interactions.${row}.description`)).toBe(
						"{lang=fr}Expliquez le retard.",
					);
			}
			expect(api.errors).toEqual([]);
			dom.window.close();
		});
		it("shows failed saves and keeps the answer usable when the LMS rejects suspend", () => {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const { dom, state } = host(api, true);
			if (api instanceof StrictScorm12Api) vi.spyOn(api, "LMSSetValue").mockReturnValue("false");
			else vi.spyOn(api, "SetValue").mockReturnValue("false");
			expect(state.set("check", saved)).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			});
			expect(state.getSaveResult?.("check")).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			});
			expect(state.get("check")).toEqual(saved);
			dom.window.close();
		});
		if (version === "1.2")
			it("shows the 4096-character save failure without truncating the draft", () => {
				const { dom, state } = host(new StrictScorm12Api(), true);
				const large = { ...saved, draft: { ...saved.draft, answer: "x".repeat(5000) } };
				expect(state.set("check", large)).toEqual({
					status: "not-saved",
					code: "runtime-write-failed",
				});
				expect(state.get("check")).toEqual(large);
				dom.window.close();
			});
	});
	describe(`SCORM ${version} score before completion`, () => {
		const completionKey = version === "1.2" ? "cmi.core.lesson_status" : "cmi.completion_status";
		const scorePrefix = version === "1.2" ? "cmi.core.score" : "cmi.score";
		const set = version === "1.2" ? "LMSSetValue" : "SetValue";
		const commit = version === "1.2" ? "LMSCommit" : "Commit";
		const finish = version === "1.2" ? "LMSFinish" : "Terminate";
		function setup() {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const makeRuntime = () => {
				if (api instanceof StrictScorm12Api) installScorm12Api(api);
				return api instanceof StrictScorm12Api ? new Scorm12Runtime() : createScorm2004Runtime(api);
			};
			const runtime = makeRuntime();
			expect(runtime.initialize()).toBe(true);
			api.calls.length = 0;
			return { api, runtime, makeRuntime };
		}
		function expectScoreBeforeCompletion(
			api: StrictScorm12Api | StrictScorm2004Api,
			scored = true,
		) {
			const completion = api.calls.findIndex(
				([name, key]) => name === set && key === completionKey,
			);
			const committed = api.calls.findIndex(([name]) => name === commit);
			expect(completion).toBeGreaterThan(-1);
			expect(committed).toBeGreaterThan(completion);
			for (const suffix of version === "1.2"
				? ["raw", "min", "max"]
				: ["raw", "min", "max", "scaled"]) {
				const score = api.calls.findIndex(
					([name, key]) => name === set && key === `${scorePrefix}.${suffix}`,
				);
				if (!scored) {
					// Completion-only courses send no score at all.
					expect(score).toBe(-1);
					continue;
				}
				expect(score).toBeGreaterThan(-1);
				expect(score).toBeLessThan(completion);
			}
			if (version === "2004") {
				for (const [index, [name, key]] of api.calls.entries()) {
					if (name === set && key === "cmi.success_status") expect(index).toBeLessThan(completion);
				}
			}
			expect(api.errors).toEqual([]);
		}

		it.each([
			["allPages", false, 100],
			["percentage", false, 100],
			["allPages", true, 100],
			["allPages", true, 0],
			["quiz", false, 100],
			["quiz", false, 0],
		] as const)(
			"orders %s pass-mark %s score %s before completion in one commit",
			(method, passMark, score) => {
				const { api, runtime } = setup();
				const tracker = new CourseTracker(runtime, {
					totalPages: 1,
					completionMethod: method,
					...(passMark ? { passMark: 80, scoredAssessmentIds: ["question"] } : {}),
				});
				tracker.trackPageVisit("page");
				tracker.trackInteraction("question", "answer", score === 100, score);
				const expected =
					version === "2004" || (!passMark && method !== "quiz")
						? "completed"
						: score === 100
							? "passed"
							: "failed";
				expect(runtime.getCompletion()).toBe(expected);
				expect(api.calls.some(([name, key]) => name === set && key === completionKey)).toBe(false);
				expect(runtime.commit()).toBe(true);
				expect(api.data.get(completionKey)).toBe(expected);
				expectScoreBeforeCompletion(api, passMark || method === "quiz");
				expect(api.calls.some(([name]) => name === finish)).toBe(false);
			},
		);

		it.each(["commit", "finish"] as const)(
			"flushes shared completion through a retained utility adapter on %s",
			(action) => {
				const { api, runtime, makeRuntime } = setup();
				runtime.setCompletion("completed");
				const utility = makeRuntime();
				expect(utility.initialize()).toBe(true);
				expect(utility.getCompletion()).toBe("completed");
				runtime.setScore(90, 0, 100);
				if (version === "2004") (runtime as Scorm2004Runtime).setSuccess("passed");
				expect(action === "commit" ? utility.commit() : utility.terminate(true)).toBe(true);
				expectScoreBeforeCompletion(api);
				expect(api.calls.filter(([name]) => name === finish)).toHaveLength(
					action === "finish" ? 1 : 0,
				);
			},
		);

		it.each([
			[false, false],
			[true, false],
			[false, true],
			[true, true],
		] as const)(
			"retains rejected completion for retry, throwing %s explicit finish %s",
			(throws, explicitFinish) => {
				const { api, runtime } = setup();
				runtime.setCompletion("passed");
				runtime.setScore(90, 0, 100);
				const original =
					api instanceof StrictScorm12Api ? api.LMSSetValue.bind(api) : api.SetValue.bind(api);
				const spy =
					api instanceof StrictScorm12Api
						? vi.spyOn(api, "LMSSetValue")
						: vi.spyOn(api, "SetValue");
				spy.mockImplementation((key, value) => {
					if (key !== completionKey) return original(key, value);
					if (throws) throw new Error("completion rejected");
					return "false";
				});
				const save = () => (explicitFinish ? runtime.terminate(true) : runtime.commit());
				if (throws) expect(save).toThrow("completion rejected");
				else expect(save()).toBe(false);
				expect(api.calls.some(([name]) => name === commit || name === finish)).toBe(false);
				expect(runtime.getCompletion()).toBe(version === "1.2" ? "passed" : "completed");
				spy.mockRestore();
				expect(save()).toBe(true);
				expectScoreBeforeCompletion(api);
			},
		);

		it("discards queued completion when the LMS starts a new launch", () => {
			const { api, runtime, makeRuntime } = setup();
			runtime.setCompletion("passed");
			const win = { [version === "1.2" ? "API" : "API_1484_11"]: api };
			expect(api instanceof StrictScorm12Api ? api.LMSFinish("") : api.Terminate("")).toBe("true");
			resetSessionState(api, win);
			api.data.set(completionKey, "incomplete");
			const next = makeRuntime();
			expect(next.initialize()).toBe(true);
			expect(next.getCompletion()).toBe("incomplete");
			expect(next.commit()).toBe(true);
			expect(api.data.get(completionKey)).toBe("incomplete");
		});

		it.each([false, true])(
			"orders host startup completion then submitted score, pass-mark %s",
			(passMark) => {
				const { api, runtime } = setup();
				const page = {
					version: 1,
					courseId: "course",
					pageId: "page",
					pageTitle: "Assessment",
					currentPage: 1,
					totalPages: 1,
					currentSlug: "page",
					availableSlugs: ["page"],
					pageIdMap: { page: "page" },
					completionMethod: "allPages",
					...(passMark ? { passMark: 80, scoredAssessmentIds: ["question"] } : {}),
					pageRole: "content",
					strings: {},
				};
				const format = version === "1.2" ? "scorm12" : "scorm2004";
				const dom = new JSDOM(
					`<!doctype html><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`,
					{ url: "https://course.example/page.html" },
				);
				try {
					Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
					expect(
						initializeCourseHost(
							{ format, createRuntime: () => runtime },
							{
								win: dom.window as unknown as Window,
								doc: dom.window.document,
								location: dom.window.location,
								history: dom.window.history,
							},
						),
					).toBe(true);
					expect(runtime.getCompletion()).toBe(
						passMark && version === "1.2" ? "incomplete" : "completed",
					);
					expect(api.calls.some(([name]) => name === commit)).toBe(false);
					dom.window.document.dispatchEvent(
						new dom.window.CustomEvent("praxity:assessment-response", {
							detail: {
								blockId: "question",
								responseText: "answer",
								correct: true,
								score: 90,
								maxScore: 100,
							},
						}),
					);
					expect(api.data.get(completionKey)).toBe(
						passMark && version === "1.2" ? "passed" : "completed",
					);
					expectScoreBeforeCompletion(api, passMark);
				} finally {
					dom.window.close();
				}
			},
		);
	});
}

describe("SCORM runtime strict LMS contracts", () => {
	it.each([
		["unanswered optional", false, false, 100, "passed"],
		["all required", true, true, 50, "failed"],
		["unanswered required", true, false, 50, "failed"],
		["answered optional", false, true, 50, "failed"],
	] as const)(
		"reports a graded group with %s to SCORM",
		async (_case, optionalRequired, optionalAnswered, expectedScore, expectedStatus) => {
			const previous = {
				window: g.window,
				document: g.document,
				CSS: g.CSS,
				CustomEvent: g.CustomEvent,
			};
			const page = {
				version: 1,
				courseId: "course",
				pageId: "page",
				pageTitle: "Quiz",
				currentPage: 1,
				totalPages: 1,
				currentSlug: "page",
				availableSlugs: ["page"],
				pageIdMap: { page: "page" },
				completionMethod: "quiz",
				passMark: 70,
				scoredAssessmentIds: ["group"],
				pageRole: "content",
				strings: { scormResumeAnnouncement: "Page {current} of {total}: {title}" },
			};
			const dom = new JSDOM(
				`<!doctype html><body><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">{"format":"scorm12"}</script><div data-assessment-group-header="group"></div>${["required", "optional"].map((id) => `<div class="praxity-block" data-block-id="${id}"><div class="praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard" data-assessment-answered="${id === "required" || optionalAnswered}" data-score="0" data-max-score="100" data-passed="false"><button data-assessment-submit="true">Submit</button></div></div>`).join("")}</body>`,
				{ url: "https://course.example/page.html", pretendToBeVisual: true },
			);
			const api = new StrictScorm12Api();
			try {
				Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
				(dom.window as unknown as { API: StrictScorm12Api }).API = api;
				g.window = dom.window;
				g.document = dom.window.document;
				g.CSS = { escape: (value: string) => value };
				g.CustomEvent = dom.window.CustomEvent;
				initializeCourseHost(
					{ format: "scorm12", createRuntime: () => new Scorm12Runtime() },
					{
						win: dom.window as unknown as Window,
						doc: dom.window.document,
						location: dom.window.location,
						history: dom.window.history,
					},
				);
				for (const id of ["required", "optional"]) {
					const card = dom.window.document.querySelector<HTMLElement>(
						`[data-block-id="${id}"] [data-assessment-display]`,
					);
					card?.querySelector("button")?.addEventListener("click", () => {
						const correct = id === "required";
						card.setAttribute("data-result", correct ? "correct" : "incorrect");
						card.setAttribute("data-score", correct ? "100" : "0");
						card.setAttribute("data-passed", String(correct));
						card.setAttribute("data-completed", "true");
					});
				}
				const blocks = [
					{
						id: "group",
						type: "assessmentGroup",
						data: { memberBlockIds: ["required", "optional"], passingScore: 70 },
					},
					{ id: "required", type: "assessment", data: { gradingMode: "exact", required: true } },
					{
						id: "optional",
						type: "assessment",
						data: { gradingMode: "exact", required: optionalRequired },
					},
				] as PraxityBlock[];
				const dispose = initAssessmentGroups({ blocks, root: dom.window.document.body });
				await vi.waitFor(() =>
					expect(dom.window.document.querySelector(".praxity-ag-submit-btn")).not.toBeNull(),
				);
				dom.window.document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
				await vi.waitFor(() =>
					expect(api.data.get("cmi.objectives.0.score.raw")).toBe(String(expectedScore)),
				);
				expect(api.data.get("cmi.objectives.0.status")).toBe(expectedStatus);
				expect(api.data.get("cmi.core.score.raw")).toBe(String(expectedScore));
				expect(api.data.get("cmi.core.lesson_status")).toBe(expectedStatus);
				if (!optionalRequired && !optionalAnswered) {
					expect(
						dom.window.document
							.querySelector('[data-block-id="optional"] [data-assessment-display]')
							?.hasAttribute("data-result"),
					).toBe(false);
					expect(dom.window.document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
					dom.window.document
						.querySelector('[data-block-id="optional"] [data-assessment-display]')
						?.setAttribute("data-assessment-answered", "true");
					dom.window.document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
					await vi.waitFor(() => expect(api.data.get("cmi.objectives.0.score.raw")).toBe("50"));
					expect(api.data.get("cmi.core.score.raw")).toBe("50");
				}
				if (optionalRequired && !optionalAnswered)
					expect(dom.window.document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
				dispose();
			} finally {
				Object.assign(g, previous);
				dom.window.close();
			}
		},
	);

	it("commits a partial group save after its suspend data write", async () => {
		const previous = {
			window: g.window,
			document: g.document,
			CSS: g.CSS,
			CustomEvent: g.CustomEvent,
		};
		const page = {
			version: 1,
			courseId: "course",
			pageId: "page",
			pageTitle: "Journal",
			currentPage: 1,
			totalPages: 2,
			currentSlug: "page",
			availableSlugs: ["page", "next"],
			pageIdMap: { page: "page" },
			completionMethod: "allPages",
			pageRole: "content",
			strings: { scormResumeAnnouncement: "Page {current} of {total}: {title}" },
		};
		const dom = new JSDOM(
			`<!doctype html><body><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">{"format":"scorm12"}</script><div data-assessment-group-header="group"></div><div class="praxity-block" data-block-id="required"><div class="praxity-block-assessment" data-block-id="required" data-assessment-display="standard" data-assessment-answered="true"><button data-assessment-submit="true">Submit</button></div></div><div class="praxity-block" data-block-id="optional"><div class="praxity-block-assessment" data-block-id="optional" data-assessment-display="standard" data-assessment-answered="false"><button data-assessment-submit="true">Submit</button></div></div></body>`,
			{ url: "https://course.example/page.html", pretendToBeVisual: true },
		);
		const api = new StrictScorm12Api();
		const commits: string[] = [];
		const originalCommit = api.LMSCommit.bind(api);
		vi.spyOn(api, "LMSCommit").mockImplementation((param) => {
			commits.push(api.data.get("cmi.suspend_data") ?? "");
			return originalCommit(param);
		});
		try {
			Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
			(dom.window as unknown as { API: StrictScorm12Api }).API = api;
			g.window = dom.window;
			g.document = dom.window.document;
			g.CSS = { escape: (value: string) => value };
			g.CustomEvent = dom.window.CustomEvent;
			initializeCourseHost(
				{ format: "scorm12", createRuntime: () => new Scorm12Runtime() },
				{
					win: dom.window as unknown as Window,
					doc: dom.window.document,
					location: dom.window.location,
					history: dom.window.history,
				},
			);
			const required = dom.window.document.querySelector<HTMLElement>(
				'[data-block-id="required"] [data-assessment-display]',
			);
			required?.querySelector("button")?.addEventListener("click", () => {
				required.setAttribute("data-completed", "true");
				dom.window.document.dispatchEvent(
					new dom.window.CustomEvent("praxity:assessment-response", {
						detail: { blockId: "required", responseText: "Answer" },
					}),
				);
			});
			const blocks = [
				{
					id: "group",
					type: "assessmentGroup",
					data: { memberBlockIds: ["required", "optional"] },
				},
				{ id: "required", type: "assessment", data: { gradingMode: "none", required: true } },
				{ id: "optional", type: "assessment", data: { gradingMode: "none", required: true } },
			] as PraxityBlock[];
			const dispose = initAssessmentGroups({ blocks, root: dom.window.document.body });
			await vi.waitFor(() =>
				expect(dom.window.document.querySelector(".praxity-ag-submit-btn")).not.toBeNull(),
			);
			dom.window.document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
			await vi.waitFor(() =>
				expect(
					dom.window.document.querySelector("[data-assessment-group-results]")?.textContent,
				).toBe("Responses saved"),
			);
			expect(commits).toHaveLength(2);
			expect(JSON.parse(JSON.parse(commits[0]).custom ?? "{}").blockState?.group).toBeUndefined();
			expect(JSON.parse(JSON.parse(commits[1]).custom).blockState.group).toMatchObject({
				completed: false,
			});
			api.data.set("cmi.suspend_data", commits[1]);
			const resumed = new Scorm12Runtime();
			expect(resumed.initialize()).toBe(true);
			expect(JSON.parse(resumed.getSuspendData() ?? "{}").blockState.group).toMatchObject({
				completed: false,
			});
			dispose();
		} finally {
			Object.assign(g, previous);
			dom.window.close();
		}
	});
	it("uses valid SCORM 1.2 lifecycle, vocabulary, and interaction fields", () => {
		const api = new StrictScorm12Api();
		installScorm12Api(api);
		const runtime = new Scorm12Runtime();

		expect(runtime.initialize()).toBe(true);
		runtime.trackPageVisit("intro");
		runtime.trackInteraction("q1", "a", true, 10);
		runtime.trackObjective("objective-1", 90, true);
		runtime.setScore(90, 0, 100);
		runtime.setBookmark("summary");
		runtime.setCompletion("passed");
		expect(runtime.commit()).toBe(true);
		expect(runtime.terminate()).toBe(true);

		expect(api.data.get("cmi.core.lesson_status")).toBe("passed");
		expect(api.data.get("cmi.core.score.raw")).toBe("90");
		expect(api.data.get("cmi.core.lesson_location")).toBe("summary");
		expect(api.data.get("cmi.interactions.0.result")).toBe("correct");
		expect(api.data.get("cmi.objectives.0.status")).toBe("passed");
		expect(api.calls.map(([method]) => method)).toEqual(
			expect.arrayContaining(["LMSInitialize", "LMSCommit", "LMSFinish"]),
		);
	});

	it("rejects SCORM 1.2 suspend_data writes over the 4096-character limit", () => {
		const api = new StrictScorm12Api();
		installScorm12Api(api);
		const runtime = new Scorm12Runtime();

		expect(runtime.initialize()).toBe(true);
		expect(() => runtime.setSuspendData("x".repeat(SCORM12_SUSPEND_DATA_LIMIT))).toThrow(
			/SCORM 1\.2 suspend_data payload/,
		);
		expect(api.data.get("cmi.suspend_data")).toBe("");
	});

	it("uses valid SCORM 2004 lifecycle, vocabulary, and interaction fields", () => {
		const api = new StrictScorm2004Api();
		const runtime = createScorm2004Runtime(api);

		expect(runtime.initialize()).toBe(true);
		runtime.trackPageVisit("intro");
		runtime.trackInteraction("q1", "a", false, 0);
		runtime.trackObjective("objective-1", 40, false);
		runtime.setScore(40, 0, 100);
		runtime.setBookmark("summary");
		runtime.setCompletion("failed");
		expect(runtime.commit()).toBe(true);
		expect(runtime.terminate()).toBe(true);

		expect(api.data.get("cmi.completion_status")).toBe("completed");
		expect(api.data.get("cmi.success_status")).toBe("failed");
		expect(api.data.get("cmi.score.scaled")).toBe("0.4");
		expect(api.data.get("cmi.location")).toBe("summary");
		expect(api.data.get("cmi.interactions.0.result")).toBe("incorrect");
		// SCORM Cloud rejected the former "...:35Z" form with error 406.
		expect(api.data.get("cmi.interactions.0.timestamp")).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,2}Z$/,
		);
		expect(api.data.get("cmi.objectives.0.success_status")).toBe("failed");
		expect(api.calls.map(([method]) => method)).toEqual(
			expect.arrayContaining(["Initialize", "Commit", "Terminate"]),
		);
	});

	it("clamps SCORM 2004 scaled scores to the valid [-1, 1] range", () => {
		const api = new StrictScorm2004Api();
		const runtime = createScorm2004Runtime(api);

		expect(runtime.initialize()).toBe(true);
		runtime.setScore(150, 0, 100);
		expect(api.data.get("cmi.score.scaled")).toBe("1");

		runtime.setScore(-50, 0, 100);
		expect(api.data.get("cmi.score.scaled")).toBe("-0.5");
	});

	it("surfaces SCORM 2004 strict LMS errors for invalid direct writes", () => {
		const api = new StrictScorm2004Api();
		const runtime = createScorm2004Runtime(api);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(runtime.initialize()).toBe(true);
		expect(runtime.setValue("cmi.success_status", "completed")).toBe(false);

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Data model element type mismatch"),
		);
		warnSpy.mockRestore();
	});
});

for (const version of ["1.2", "2004"] as const) {
	describe(`SCORM ${version} session time`, () => {
		const timeKey = version === "1.2" ? "cmi.core.session_time" : "cmi.session_time";
		const prefix = version === "1.2" ? "LMS" : "";
		const start = new Date("2026-10-03T12:00:00Z").getTime();
		const setup = () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(start);
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const lms: WindowLike = { [version === "1.2" ? "API" : "API_1484_11"]: api };
			lms.parent = lms;
			const makeRuntime = () => {
				const win = { parent: lms };
				vi.stubGlobal("window", win);
				return version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			};
			return { api, lms, makeRuntime };
		};

		it("reports cumulative wall time across documents and retained adapters on every commit and Finish", () => {
			const { api, makeRuntime } = setup();
			try {
				const first = makeRuntime();
				expect(first.initialize()).toBe(true);
				vi.setSystemTime(start + 12_349);
				expect(first.commit()).toBe(true);
				expect(api.data.get(timeKey)).toBe(version === "1.2" ? "0000:00:12.34" : "PT12.34S");
				vi.setSystemTime(start + 62_340);
				const second = makeRuntime();
				expect(second.initialize()).toBe(true);
				expect(second.commit()).toBe(true);
				expect(api.data.get(timeKey)).toBe(version === "1.2" ? "0000:01:02.34" : "PT1M2.34S");
				// History/bfcache can retain the first adapter while a later document has joined.
				vi.setSystemTime(start + 3_723_459);
				expect(first.commit()).toBe(true);
				expect(api.data.get(timeKey)).toBe(version === "1.2" ? "0001:02:03.45" : "PT1H2M3.45S");
				vi.setSystemTime(start + 3_724_560);
				expect(second.terminate(true)).toBe(true);
				expect(api.data.get(timeKey)).toBe(version === "1.2" ? "0001:02:04.56" : "PT1H2M4.56S");
				expect(api.calls.filter(([name]) => name === `${prefix}Initialize`)).toHaveLength(1);
				const writes = api.calls.filter(
					([name, key]) => name === `${prefix}SetValue` && key === timeKey,
				);
				expect(writes).toHaveLength(4);
				for (const [index, call] of api.calls.entries()) {
					if (call[0] === `${prefix}Commit`)
						expect(api.calls.slice(0, index).at(-1)).toEqual(writes.shift());
				}
				expect(
					api.calls.some(
						([name, key]) => name === `${prefix}SetValue` && key.endsWith("total_time"),
					),
				).toBe(false);
				expect(api.errors).toEqual([]);
			} finally {
				vi.useRealTimers();
				vi.unstubAllGlobals();
			}
		});

		it.each([false, true])(
			"restarts time only for a genuine new launch, previous launch closed %s",
			(closed) => {
				const { api, lms, makeRuntime } = setup();
				try {
					const first = makeRuntime();
					expect(first.initialize()).toBe(true);
					vi.setSystemTime(start + 60_000);
					expect(closed ? first.terminate() : first.commit()).toBe(true);
					// The LMS resets and reuses its API object, then index resets content bookkeeping.
					Object.assign(api, version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api());
					resetSessionState(api, { parent: lms });
					vi.setSystemTime(start + 600_000);
					const next = makeRuntime();
					expect(next.initialize()).toBe(true);
					vi.setSystemTime(start + 602_349);
					expect(next.commit()).toBe(true);
					expect(api.data.get(timeKey)).toBe(version === "1.2" ? "0000:00:02.34" : "PT2.34S");
					expect(api.errors).toEqual([]);
				} finally {
					vi.useRealTimers();
					vi.unstubAllGlobals();
				}
			},
		);

		it.each([
			[0, "0000:00:00.00", "PT0S"],
			[-1000, "0000:00:00.00", "PT0S"],
			[3_599_999, "0000:59:59.99", "PT59M59.99S"],
			[3_600_000, "0001:00:00.00", "PT1H0S"],
			[36_000_000_000, "9999:59:59.99", "PT10000H0S"],
		])(
			"formats %s milliseconds within the version's timespan range",
			(elapsed, scorm12, scorm2004) => {
				const { api, makeRuntime } = setup();
				try {
					const runtime = makeRuntime();
					expect(runtime.initialize()).toBe(true);
					vi.setSystemTime(start + Number(elapsed));
					expect(runtime.commit()).toBe(true);
					expect(api.data.get(timeKey)).toBe(version === "1.2" ? scorm12 : scorm2004);
					expect(api.errors).toEqual([]);
				} finally {
					vi.useRealTimers();
					vi.unstubAllGlobals();
				}
			},
		);

		it("keeps Finish retryable when the LMS rejects session time", () => {
			const { api, makeRuntime } = setup();
			try {
				const runtime = makeRuntime();
				expect(runtime.initialize()).toBe(true);
				const target = api as unknown as Record<string, (...args: string[]) => string>;
				const original = target[`${prefix}SetValue`].bind(api);
				target[`${prefix}SetValue`] = (key, value) =>
					key === timeKey ? "false" : original(key, value);
				vi.setSystemTime(start + 12_000);
				expect(runtime.terminate(true)).toBe(false);
				expect(
					api.calls.some(([name]) => ["LMSFinish", "Terminate", `${prefix}Commit`].includes(name)),
				).toBe(false);
				target[`${prefix}SetValue`] = original;
				vi.setSystemTime(start + 15_000);
				expect(runtime.terminate(true)).toBe(true);
				expect(api.data.get(timeKey)).toBe(version === "1.2" ? "0000:00:15.00" : "PT15S");
			} finally {
				vi.useRealTimers();
				vi.unstubAllGlobals();
			}
		});
	});

	describe(`SCORM ${version} communication session`, () => {
		const initialize = version === "1.2" ? "LMSInitialize" : "Initialize";
		const alreadyInitialized = version === "1.2" ? "101" : "103";
		const makeApi = () => (version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api());
		const makeRuntime = (api: StrictScorm12Api | StrictScorm2004Api) => {
			if (api instanceof StrictScorm12Api) {
				installScorm12Api(api);
				return new Scorm12Runtime();
			}
			return createScorm2004Runtime(api);
		};

		it("shares one initialization and retained data across documents", () => {
			const api = makeApi();
			const first = makeRuntime(api);
			expect(first.initialize()).toBe(true);
			first.trackPageVisit("intro");
			first.setBookmark("summary");
			expect(first.commit()).toBe(true);

			const second = makeRuntime(api);
			expect(second.initialize()).toBe(true);
			expect(second.initialize()).toBe(true);
			expect(second.getVisitedPages()).toEqual(["intro"]);
			expect(second.getBookmark()).toBe("summary");
			second.trackPageVisit("summary");
			expect(second.getVisitedPages()).toEqual(["intro", "summary"]);
			expect(second.commit()).toBe(true);
			expect(api.calls.filter(([name]) => name === initialize)).toHaveLength(1);
			expect(api.errors).not.toContain(alreadyInitialized);
			expect(api.errors).toEqual([]);
		});

		it("initializes a fresh API even while the previous API still carries its marker", () => {
			const previousApi = makeApi();
			expect(makeRuntime(previousApi).initialize()).toBe(true);
			const freshApi = makeApi();
			expect(makeRuntime(freshApi).initialize()).toBe(true);
			expect(freshApi.calls.filter(([name]) => name === initialize)).toHaveLength(1);
			expect(freshApi.errors).toEqual([]);
		});

		it("initializes once more after the index redirect clears a reused API's marker", async () => {
			const api = makeApi();
			expect(makeRuntime(api).initialize()).toBe(true);
			const calls = api.calls;
			// The LMS resets its communication state but reuses the API object and marker.
			Object.assign(api, makeApi(), { calls });
			expect(readSessionState(api)).toBe(true);
			const dom = new JSDOM(generateHtmlIndex("intro"));
			const url = new URL("https://course.example/index.html?token=launch#slide");
			const replace = vi.fn(() => expect(readSessionState(api)).toBe(false));
			try {
				vi.stubGlobal("window", { parent: { [version === "1.2" ? "API" : "API_1484_11"]: api } });
				vi.stubGlobal("document", dom.window.document);
				vi.stubGlobal("location", { href: url.href, search: url.search, hash: url.hash, replace });
				vi.resetModules();
				await import("../template/src/course-shell");
				expect(replace).toHaveBeenCalledExactlyOnceWith(
					"https://course.example/intro.html?token=launch#slide",
				);
			} finally {
				vi.unstubAllGlobals();
				dom.window.close();
			}
			expect(makeRuntime(api).initialize()).toBe(true);
			expect(makeRuntime(api).initialize()).toBe(true);
			expect(api.calls.filter(([name]) => name === initialize)).toHaveLength(2);
			expect(api.errors).toEqual([]);
		});

		it("accepts an already running API without a marker once, then shares it", () => {
			const api = makeApi();
			const result = api instanceof StrictScorm12Api ? api.LMSInitialize("") : api.Initialize("");
			expect(result).toBe("true");
			const runtime = makeRuntime(api);
			expect(runtime.initialize()).toBe(true);
			runtime.setBookmark("summary");
			expect(runtime.getBookmark()).toBe("summary");
			expect(makeRuntime(api).initialize()).toBe(true);
			expect(api.calls.filter(([name]) => name === initialize)).toHaveLength(2);
			expect(api.errors).toEqual([alreadyInitialized]);
		});

		it("shares callable bookkeeping when the API rejects custom properties", () => {
			const api = makeApi();
			Object.preventExtensions(api);
			expect(makeRuntime(api).initialize()).toBe(true);
			const runtime = makeRuntime(api);
			expect(runtime.initialize()).toBe(true);
			expect(runtime.initialize()).toBe(true);
			runtime.setBookmark("summary");
			expect(runtime.getBookmark()).toBe("summary");
			expect(api.calls.filter(([name]) => name === initialize)).toHaveLength(1);
			expect(api.errors).toEqual([]);
		});
	});

	describe(`SCORM ${version} exit persistence`, () => {
		function setup() {
			const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			if (api instanceof StrictScorm12Api) installScorm12Api(api);
			const runtime =
				api instanceof StrictScorm12Api ? new Scorm12Runtime() : createScorm2004Runtime(api);
			expect(runtime.initialize()).toBe(true);
			return { api, runtime, exitKey: version === "1.2" ? "cmi.core.exit" : "cmi.exit" };
		}
		it.each([
			{ score: 0, result: "failed" },
			{ score: 90, result: "passed" },
		])("keeps quiz pass-mark result $result separate from page completion", ({ score, result }) => {
			const { api, runtime } = setup();
			const tracker = new CourseTracker(runtime, {
				totalPages: 2,
				completionMethod: "quiz",
				passMark: 80,
				scoredAssessmentIds: ["q1"],
			});
			tracker.trackPageVisit("intro");
			tracker.trackInteraction("q1", "answer", score >= 80, score);
			expect(runtime.getScore()?.raw).toBe(score);
			if (version === "2004") {
				expect(api.data.get("cmi.completion_status")).toBe("incomplete");
				expect(api.data.get("cmi.success_status")).toBe(result);
			} else {
				expect(runtime.getCompletion()).toBe(result === "failed" ? "failed" : "incomplete");
			}
			tracker.trackPageVisit("summary");
			expect(runtime.getCompletion()).toBe(version === "1.2" ? result : "completed");
			expect(runtime.commit()).toBe(true);
			expect(
				api.data.get(version === "1.2" ? "cmi.core.lesson_status" : "cmi.completion_status"),
			).toBe(version === "1.2" ? result : "completed");
		});
		it("resumes a failed pass-mark attempt and passes after a retry", () => {
			const { api, runtime, exitKey } = setup();
			const config = {
				totalPages: 2,
				completionMethod: "allPages" as const,
				passMark: 70,
				scoredAssessmentIds: ["q1"],
			};
			const tracker = new CourseTracker(runtime, config);
			tracker.trackPageVisit("intro");
			tracker.trackPageVisit("summary");
			tracker.trackInteraction("q1", "wrong", false, 0);
			expect(runtime.commit()).toBe(true);
			expect(api.data.get(exitKey)).toBe("suspend");
			expect(runtime.getScore()?.raw).toBe(0);
			expect(runtime.getBookmark()).toBe("summary");
			expect(
				api.data.get(version === "1.2" ? "cmi.core.lesson_status" : "cmi.success_status"),
			).toBe("failed");
			expect(runtime.terminate()).toBe(true);

			// A resumed launch gets a new communication session, never reopens a terminated API.
			const resumedApi = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			resumedApi.data = new Map(api.data);
			if (resumedApi instanceof StrictScorm12Api) installScorm12Api(resumedApi);
			const resumed =
				resumedApi instanceof StrictScorm12Api
					? new Scorm12Runtime()
					: createScorm2004Runtime(resumedApi);
			expect(resumed.initialize()).toBe(true);
			expect(resumed.getVisitedPages()).toEqual(["intro", "summary"]);
			expect(resumed.getInteractions()).toHaveLength(1);
			expect(resumed.getBookmark()).toBe("summary");
			new CourseTracker(resumed, config).trackInteraction("q1", "correct", true, 100);
			expect(resumed.commit()).toBe(true);
			expect(resumed.getScore()?.raw).toBe(100);
			expect(resumed.getBookmark()).toBe("summary");
			expect(resumedApi.data.get(exitKey)).toBe(version === "1.2" ? "" : "normal");
			expect(
				resumedApi.data.get(version === "1.2" ? "cmi.core.lesson_status" : "cmi.success_status"),
			).toBe("passed");
			expect(resumed.getCompletion()).toBe(version === "1.2" ? "passed" : "completed");
		});
		it.each(["commit", "terminate"] as const)(
			"suspends unfinished attempts before %s",
			(method) => {
				const { api, runtime, exitKey } = setup();
				runtime.setCompletion("incomplete");
				expect(runtime[method]()).toBe(true);
				expect(api.data.get(exitKey)).toBe("suspend");
				const exitWrite = api.calls.findIndex(([, key]) => key === exitKey);
				const lifecycle = api.calls.findIndex(([name]) =>
					["LMSCommit", "Commit", "LMSFinish", "Terminate"].includes(name),
				);
				expect(exitWrite).toBeGreaterThan(-1);
				expect(exitWrite).toBeLessThan(lifecycle);
			},
		);
		it.each(["completed", "passed", "failed"] as const)(
			"uses the attempt exit policy after %s",
			(status) => {
				const { api, runtime, exitKey } = setup();
				runtime.setCompletion("incomplete");
				runtime.commit();
				runtime.setCompletion(status);
				expect(runtime.commit()).toBe(true);
				// Failed attempts keep their state for a retry in either version.
				expect(api.data.get(exitKey)).toBe(
					status === "failed" ? "suspend" : version === "1.2" ? "" : "normal",
				);
			},
		);
		if (version === "2004")
			it("keeps a pass-mark attempt suspended until it is completed and passed", () => {
				const { api, runtime, exitKey } = setup();
				if (!("setSuccess" in runtime)) throw new Error("SCORM 2004 reports success");
				runtime.setSuccess("unknown");
				runtime.setCompletion("completed");
				runtime.commit();
				expect(api.data.get(exitKey)).toBe("suspend");
				runtime.setSuccess("failed");
				runtime.commit();
				expect(api.data.get(exitKey)).toBe("suspend");
				runtime.setSuccess("passed");
				runtime.commit();
				expect(api.data.get(exitKey)).toBe("normal");
			});
		it("does not report a successful commit when the exit write is rejected", () => {
			const { api, runtime } = setup();
			if (api instanceof StrictScorm12Api) vi.spyOn(api, "LMSSetValue").mockReturnValue("false");
			else vi.spyOn(api, "SetValue").mockReturnValue("false");
			expect(runtime.commit()).toBe(false);
			expect(api.calls.some(([method]) => ["LMSCommit", "Commit"].includes(method))).toBe(false);
		});
	});
}

it("suspends an existing SCORM 1.2 session after navigating to a new page", () => {
	const api = new StrictScorm12Api();
	installScorm12Api(api);
	const first = new Scorm12Runtime();
	expect(first.initialize()).toBe(true);
	first.setCompletion("incomplete");
	const next = new Scorm12Runtime();
	expect(next.initialize()).toBe(true);
	expect(next.commit()).toBe(true);
	expect(api.data.get("cmi.core.exit")).toBe("suspend");
});

it.each(["", "unknown", "not attempted", "incomplete", "completed"])(
	"initializes SCORM 2004 completion from %j without reopening completed attempts",
	(status) => {
		const api = new StrictScorm2004Api();
		api.data.set("cmi.completion_status", status);
		const runtime = createScorm2004Runtime(api);
		expect(runtime.initialize()).toBe(true);
		expect(api.data.get("cmi.completion_status")).toBe(
			status === "completed" ? "completed" : "incomplete",
		);
	},
);

it("rejects SCORM 1.2 error 101 when the status read fails", () => {
	const api = new StrictScorm12Api();
	installScorm12Api(api);
	expect(api.LMSInitialize("")).toBe("true");
	vi.spyOn(api, "LMSGetValue").mockImplementation((element) => {
		api.calls.push(["LMSGetValue", element]);
		// A failing LMS call sets an error that the adapter must inspect.
		api.LMSSetValue("cmi.core.lesson_status", "invalid");
		return "";
	});
	Object.preventExtensions(api);
	const second = new Scorm12Runtime();
	expect(() => second.initialize()).toThrow("405");
	expect(() => second.getBookmark()).toThrow("not initialized");
	expect(api.calls.filter(([name]) => name === "LMSInitialize")).toHaveLength(2);
	expect(api.errors).toEqual(["101", "405"]);
});

it("makes no diagnostic calls after failed SCORM 1.2 Finish", () => {
	const api = new StrictScorm12Api();
	installScorm12Api(api);
	const runtime = new Scorm12Runtime();
	expect(runtime.initialize()).toBe(true);
	let finishAttempted = false;
	vi.spyOn(api, "LMSFinish").mockImplementation(() => {
		finishAttempted = true;
		api.calls.push(["LMSFinish", ""]);
		return "false";
	});
	for (const name of ["LMSGetLastError", "LMSGetErrorString", "LMSGetDiagnostic"] as const) {
		vi.spyOn(api, name).mockImplementation(() => {
			api.calls.push([name]);
			return name === "LMSGetLastError" ? (finishAttempted ? "101" : "0") : "LMS rejected Finish";
		});
	}
	try {
		runtime.terminate();
	} catch {
		/* Failure may reject the caller, never query the closed LMS. */
	}
	const finish = api.calls.findIndex(([name]) => name === "LMSFinish");
	expect(finish).toBeGreaterThanOrEqual(0);
	expect(api.calls.slice(finish + 1)).toEqual([]);
	expect(runtime.initialize()).toBe(false);
});

it.each(["1.2", "2004"] as const)(
	"refuses %s initialization with frozen API and callable in a writable top-level document",
	(version) => {
		const initialize = vi.fn(() => "true");
		Object.freeze(initialize);
		const api = Object.freeze({ [version === "1.2" ? "LMSInitialize" : "Initialize"]: initialize });
		const win: WindowLike = { [version === "1.2" ? "API" : "API_1484_11"]: api };
		win.parent = win;
		vi.stubGlobal("window", win);
		try {
			const runtime = version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			expect(runtime.initialize()).toBe(false);
			expect(initialize).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

it.each(["1.2", "2004"] as const)(
	"refuses %s initialization without durable launch bookkeeping",
	async (version) => {
		const initialize = vi.fn(() => "true");
		Object.freeze(initialize);
		const api = Object.freeze({ [version === "1.2" ? "LMSInitialize" : "Initialize"]: initialize });
		const parent = Object.freeze({ [version === "1.2" ? "API" : "API_1484_11"]: api });
		const win = Object.freeze({ parent });
		vi.stubGlobal("window", win);
		try {
			const runtime = version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			expect(runtime.initialize()).toBe(false);
			expect(initialize).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

for (const version of ["1.2", "2004"] as const) {
	describe(`SCORM ${version} cold callable bookkeeping`, () => {
		it.each([
			["get", false],
			["set", false],
			["get", true],
			["set", true],
		] as const)(
			"handles primary %s failure with secondary locked %s",
			(restriction, secondaryLocked) => {
				const source = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
				const observed: string[] = [];
				const prefix = version === "1.2" ? "LMS" : "";
				const finish = version === "1.2" ? "LMSFinish" : "Terminate";
				const facade = Object.fromEntries(
					[
						"Initialize",
						"LMSInitialize",
						finish,
						`${prefix}GetValue`,
						`${prefix}SetValue`,
						`${prefix}Commit`,
						`${prefix}GetLastError`,
						`${prefix}GetErrorString`,
						`${prefix}GetDiagnostic`,
					].map((name) => [
						name,
						(...args: string[]) => {
							observed.push(name);
							return (
								(source as unknown as Record<string, (...args: string[]) => string>)[name]?.(
									...args,
								) ?? "true"
							);
						},
					]),
				);
				const primaryStore = new WeakMap<object, unknown>();
				Object.defineProperty(primaryStore, restriction, {
					value: () => {
						throw new Error(`restricted primary ${restriction}`);
					},
				});
				Object.defineProperty(facade.Initialize, "__praxityScormSessions", {
					value: primaryStore,
				});
				if (secondaryLocked) Object.freeze(facade.LMSInitialize);
				Object.freeze(facade);
				const parent = Object.freeze({ [version === "1.2" ? "API" : "API_1484_11"]: facade });
				const makeRuntime = () => {
					const win = Object.freeze({ parent });
					vi.stubGlobal("window", win);
					return version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
				};
				try {
					const first = makeRuntime();
					if (secondaryLocked) {
						expect(first.initialize()).toBe(false);
						expect(makeRuntime().initialize()).toBe(false);
						expect(observed).toEqual([]);
						return;
					}
					expect(first.initialize()).toBe(true);
					const second = makeRuntime();
					expect(second.initialize()).toBe(true);
					first.setBookmark("shared bookmark");
					expect(second.getBookmark()).toBe("shared bookmark");
					expect(second.terminate(true)).toBe(true);
					const before = observed.length;
					expect(first.initialize()).toBe(false);
					expect(second.initialize()).toBe(false);
					expect(makeRuntime().initialize()).toBe(false);
					if (version === "1.2") expect(() => first.commit()).toThrow(/not initialized/);
					else expect(first.commit()).toBe(false);
					expect(observed.slice(before)).toEqual([]);
					expect(observed.filter((name) => name === `${prefix}Initialize`)).toHaveLength(1);
					expect(observed.filter((name) => name === finish)).toHaveLength(1);
					expect(source.errors).toEqual([]);
				} finally {
					vi.unstubAllGlobals();
				}
			},
		);
	});
}

it.each(["1.2", "2004"] as const)(
	"closes every retained %s adapter across independent documents with restricted bookkeeping",
	async (version) => {
		const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
		const observed: string[] = [];
		const names =
			version === "1.2"
				? [
						"LMSInitialize",
						"LMSFinish",
						"LMSGetValue",
						"LMSSetValue",
						"LMSCommit",
						"LMSGetLastError",
						"LMSGetErrorString",
						"LMSGetDiagnostic",
					]
				: [
						"Initialize",
						"Terminate",
						"GetValue",
						"SetValue",
						"Commit",
						"GetLastError",
						"GetErrorString",
						"GetDiagnostic",
					];
		const facade = Object.freeze(
			Object.fromEntries(
				names.map((name) => [
					name,
					(...args: string[]) => {
						observed.push(name);
						return (api as unknown as Record<string, (...args: string[]) => string>)[name](...args);
					},
				]),
			),
		);
		const parent: WindowLike = { [version === "1.2" ? "API" : "API_1484_11"]: facade };
		parent.parent = parent;
		Object.defineProperty(parent, "__praxityScormSessions", {
			get: () => null,
			set: () => {
				throw new Error("blocked");
			},
		});
		const retained = [];
		try {
			for (let index = 0; index < 3; index++) {
				vi.resetModules();
				const win = { parent };
				vi.stubGlobal("window", win);
				const runtime =
					version === "1.2"
						? new (await import("../src/scorm/api/scorm12")).Scorm12Runtime()
						: new (await import("../src/scorm/api/scorm2004")).Scorm2004Runtime(win);
				expect(runtime.initialize()).toBe(true);
				retained.push(runtime);
			}
			expect(retained[2].terminate()).toBe(true);
			const count = observed.length;
			for (const runtime of retained) {
				expect(runtime.initialize()).toBe(false);
				for (const action of [
					() => runtime.getBookmark(),
					() => runtime.commit(),
					() => runtime.setBookmark("late"),
					() => runtime.getVisitedPages(),
					() => runtime.getInteractions(),
					() => runtime.getCompletion(),
					() => runtime.getSuspendData(),
					() => runtime.getScore(),
					() => runtime.terminate(),
					() => "getLastError" in runtime && runtime.getLastError(),
				]) {
					try {
						action();
					} catch {
						/* A closed 1.2 runtime rejects data methods. */
					}
				}
			}
			expect(observed.slice(count)).toEqual([]);
			expect(observed.filter((name) => name === names[0])).toHaveLength(1);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

it.each(["failed", "unknown", "passed"] as const)(
	"retains SCORM 2004 %s pass-mark policy across utility document adapters",
	(success) => {
		const api = new StrictScorm2004Api();
		const lms: WindowLike = { API_1484_11: api };
		lms.parent = lms;
		const content = new Scorm2004Runtime({ parent: lms });
		expect(content.initialize()).toBe(true);
		const tracker = new CourseTracker(content, {
			totalPages: 1,
			completionMethod: "allPages",
			passMark: 80,
			scoredAssessmentIds: ["q1"],
		});
		tracker.trackPageVisit("intro");
		if (success !== "unknown")
			tracker.trackInteraction(
				"q1",
				"answer",
				success === "passed",
				success === "passed" ? 100 : 0,
			);
		expect(content.commit()).toBe(true);
		const utility = new Scorm2004Runtime({ parent: lms });
		expect(utility.initialize()).toBe(true);
		expect(utility.terminate()).toBe(true);
		expect(api.data.get("cmi.completion_status")).toBe("completed");
		expect(api.data.get("cmi.success_status")).toBe(success);
		expect(api.data.get("cmi.exit")).toBe(success === "passed" ? "normal" : "suspend");
		expect(api.calls.filter(([name]) => name === "Initialize")).toHaveLength(1);
		expect(api.calls.at(-2)?.[0]).toBe("Commit");
		expect(api.calls.at(-1)?.[0]).toBe("Terminate");
	},
);

for (const version of ["1.2", "2004"] as const) {
	describe(`SCORM ${version} bounded lifecycle`, () => {
		const initialize = version === "1.2" ? "LMSInitialize" : "Initialize";
		const terminate = version === "1.2" ? "LMSFinish" : "Terminate";
		const commit = version === "1.2" ? "LMSCommit" : "Commit";
		const makeApi = () => (version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api());
		function launch(api = makeApi(), locked = false) {
			const lms: WindowLike = { [version === "1.2" ? "API" : "API_1484_11"]: api };
			lms.parent = lms;
			if (locked) Object.preventExtensions(lms);
			const makeRuntime = () => {
				const win: WindowLike = { parent: lms };
				if (locked) Object.preventExtensions(win);
				if (version === "2004") return new Scorm2004Runtime(win);
				g.window = win;
				return new Scorm12Runtime();
			};
			return { api, lms, makeRuntime };
		}
		function safelyCall(call: () => unknown) {
			try {
				return call();
			} catch {
				// SCORM 1.2 preserves its existing uninitialized error for blocked transfers.
				return undefined;
			}
		}
		function blockedTransfers(runtime: Scorm12Runtime | Scorm2004Runtime) {
			safelyCall(() => runtime.setBookmark("changed"));
			safelyCall(() => runtime.getBookmark());
			safelyCall(() => runtime.setCompletion("completed"));
			safelyCall(() => runtime.getCompletion());
			safelyCall(() => runtime.setScore(10, 0, 100));
			safelyCall(() => runtime.getScore());
			safelyCall(() => runtime.setSuspendData("changed"));
			safelyCall(() => runtime.getSuspendData());
			safelyCall(() => runtime.trackPageVisit("changed"));
			safelyCall(() => runtime.getVisitedPages());
			safelyCall(() => runtime.trackInteraction("changed", "answer"));
			safelyCall(() => runtime.getInteractions());
			safelyCall(() => runtime.trackObjective("changed", 10, false));
			safelyCall(() => runtime.commit());
		}

		it("commits bookmark, suspend data, status and exit before one termination", () => {
			const { api, makeRuntime } = launch();
			const runtime = makeRuntime();
			expect(runtime.initialize()).toBe(true);
			runtime.setBookmark("summary");
			runtime.trackPageVisit("intro");
			runtime.setCompletion("incomplete");
			expect(runtime.terminate()).toBe(true);
			const names = api.calls.map(([name]) => name);
			const commitIndex = names.indexOf(commit);
			const terminateIndex = names.indexOf(terminate);
			expect(commitIndex).toBeGreaterThan(-1);
			expect(commitIndex).toBeLessThan(terminateIndex);
			for (const key of [
				version === "1.2" ? "cmi.core.lesson_location" : "cmi.location",
				"cmi.suspend_data",
				version === "1.2" ? "cmi.core.lesson_status" : "cmi.completion_status",
				version === "1.2" ? "cmi.core.exit" : "cmi.exit",
			]) {
				const writeIndex = api.calls
					.map(([name, element]) => (["LMSSetValue", "SetValue"].includes(name) ? element : ""))
					.lastIndexOf(key);
				expect(writeIndex).toBeGreaterThan(-1);
				expect(writeIndex).toBeLessThan(commitIndex);
			}
			expect(runtime.terminate()).toBe(true);
			expect(api.calls.filter(([name]) => name === terminate)).toHaveLength(1);
			expect(api.errors).toEqual([]);
		});

		it.each([false, true])("closes every runtime in the launch with a locked API %s", (locked) => {
			const { api, makeRuntime } = launch();
			if (locked) Object.preventExtensions(api);
			const first = makeRuntime();
			const second = makeRuntime();
			expect(first.initialize()).toBe(true);
			expect(second.initialize()).toBe(true);
			expect(first.terminate()).toBe(true);
			expect(readSessionState(api)).toBe(false);
			const calls = [...api.calls];
			expect(first.initialize()).toBe(false);
			expect(second.initialize()).toBe(false);
			expect(makeRuntime().initialize()).toBe(false);
			expect(second.terminate()).toBe(true);
			blockedTransfers(first);
			blockedTransfers(second);
			expect(api.calls).toEqual(calls);
			expect(api.calls.filter(([name]) => name === initialize)).toHaveLength(1);
		});

		it("guards the same instance when API and windows reject bookkeeping", () => {
			const api = makeApi();
			Object.preventExtensions(api);
			const { makeRuntime } = launch(api, true);
			const runtime = makeRuntime();
			expect(runtime.initialize()).toBe(true);
			expect(runtime.terminate()).toBe(true);
			const calls = [...api.calls];
			expect(runtime.initialize()).toBe(false);
			expect(runtime.terminate()).toBe(true);
			blockedTransfers(runtime);
			expect(api.calls).toEqual(calls);
		});

		it.each([true])(
			"starts a reused API launch while old runtime stays closed after termination %s",
			(terminated) => {
				const { api, lms, makeRuntime } = launch();
				const old = makeRuntime();
				expect(old.initialize()).toBe(true);
				old.setBookmark("summary");
				if (terminated) expect(old.terminate()).toBe(true);
				const calls = api.calls;
				const data = api.data;
				Object.assign(api, makeApi(), { calls, data });
				resetSessionState(api, lms);
				const next = makeRuntime();
				expect(next.initialize()).toBe(true);
				expect(next.getBookmark()).toBe("summary");
				const afterInitialize = [...api.calls];
				expect(old.initialize()).toBe(false);
				expect(old.terminate()).toBe(terminated);
				blockedTransfers(old);
				expect(api.calls).toEqual(afterInitialize);
				expect(api.calls.filter(([name]) => name === initialize)).toHaveLength(2);
				expect(next.terminate()).toBe(true);
			},
		);

		it("keeps an active retained adapter usable after an index reset and adoption", () => {
			const { api, lms, makeRuntime } = launch();
			const retained = makeRuntime();
			expect(retained.initialize()).toBe(true);
			retained.setBookmark("intro");
			resetSessionState(api, { parent: lms });
			const arriving = makeRuntime();
			expect(arriving.initialize()).toBe(true);
			expect(retained.initialize()).toBe(true);
			retained.setBookmark("retained");
			expect(arriving.getBookmark()).toBe("retained");
			expect(retained.commit()).toBe(true);
			expect(api.calls.filter(([name]) => name === terminate)).toHaveLength(0);
			expect(arriving.terminate()).toBe(true);
			expect(api.calls.at(-2)?.[0]).toBe(commit);
			expect(api.calls.at(-1)?.[0]).toBe(terminate);
		});

		it.each(["false", "throw"])("closes communication after termination returns %s", (failure) => {
			const { api, makeRuntime } = launch();
			const first = makeRuntime();
			const second = makeRuntime();
			expect(first.initialize()).toBe(true);
			expect(second.initialize()).toBe(true);
			const reject = () => {
				api.calls.push([terminate, ""]);
				if (failure === "throw") throw new Error("LMS disconnected");
				return "false";
			};
			if (api instanceof StrictScorm12Api) vi.spyOn(api, "LMSFinish").mockImplementation(reject);
			else vi.spyOn(api, "Terminate").mockImplementation(reject);
			if (failure === "throw") expect(() => first.terminate()).toThrow("LMS disconnected");
			else expect(first.terminate()).toBe(false);
			const calls = [...api.calls];
			expect(first.terminate()).toBe(false);
			expect(second.terminate()).toBe(false);
			expect(first.initialize()).toBe(false);
			expect(second.initialize()).toBe(false);
			expect(makeRuntime().initialize()).toBe(false);
			blockedTransfers(first);
			blockedTransfers(second);
			expect(api.calls).toEqual(calls);
		});

		it.each(["exit", "commit", "commit throw"])(
			"keeps the session retryable after %s failure",
			(failure) => {
				const { api, makeRuntime } = launch();
				const runtime = makeRuntime();
				expect(runtime.initialize()).toBe(true);
				const spy =
					failure === "exit"
						? api instanceof StrictScorm12Api
							? vi.spyOn(api, "LMSSetValue")
							: vi.spyOn(api, "SetValue")
						: api instanceof StrictScorm12Api
							? vi.spyOn(api, "LMSCommit")
							: vi.spyOn(api, "Commit");
				if (failure === "commit throw")
					spy.mockImplementationOnce(() => {
						throw new Error("Commit failed");
					});
				else spy.mockReturnValueOnce("false");
				if (failure === "commit throw") expect(() => runtime.terminate()).toThrow("Commit failed");
				else expect(runtime.terminate()).toBe(false);
				expect(api.calls.filter(([name]) => name === terminate)).toHaveLength(0);
				expect(runtime.initialize()).toBe(true);
				runtime.setBookmark("retry");
				expect(runtime.getBookmark()).toBe("retry");
				expect(runtime.terminate()).toBe(true);
				expect(api.calls.at(-2)?.[0]).toBe(commit);
				expect(api.calls.at(-1)?.[0]).toBe(terminate);
			},
		);
	});
}

it("prevents SCORM 2004 data transfers after discovery or failed initialization", () => {
	const api = new StrictScorm2004Api();
	const runtime = createScorm2004Runtime(api);
	expect(runtime.findAPI()).toBe(true);
	const calls = [...api.calls];
	expect(runtime.getValue("cmi.location")).toBe("");
	expect(runtime.setValue("cmi.location", "summary")).toBe(false);
	expect(runtime.commit()).toBe(false);
	expect(runtime.terminate()).toBe(false);
	expect(api.calls).toEqual(calls);
	vi.spyOn(api, "Initialize").mockReturnValueOnce("false");
	expect(runtime.initialize()).toBe(false);
	expect(runtime.getValue("cmi.location")).toBe("");
	expect(runtime.setValue("cmi.location", "summary")).toBe(false);
	expect(runtime.commit()).toBe(false);
	expect(runtime.terminate()).toBe(false);
	expect(api.calls).toEqual(calls);
});

it("blocks SCORM 2004 transfers after initialization setup fails and retries without Initialize", () => {
	const api = new StrictScorm2004Api();
	const runtime = createScorm2004Runtime(api);
	vi.spyOn(api, "SetValue").mockReturnValueOnce("false");
	expect(runtime.initialize()).toBe(false);
	const calls = [...api.calls];
	expect(runtime.getValue("cmi.location")).toBe("");
	expect(runtime.setValue("cmi.location", "summary")).toBe(false);
	expect(runtime.commit()).toBe(false);
	expect(runtime.terminate()).toBe(false);
	expect(api.calls).toEqual(calls);
	expect(runtime.initialize()).toBe(true);
	expect(api.calls.filter(([name]) => name === "Initialize")).toHaveLength(1);
	expect(runtime.setValue("cmi.location", "summary")).toBe(true);
});

for (const version of ["1.2", "2004"] as const) {
	describe(`SCORM ${version} synchronous LMS callbacks`, () => {
		function setup(locked = false) {
			const source = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
			const calls: string[] = [];
			let callback: ((name: string, args: string[]) => void) | undefined;
			const prefix = version === "1.2" ? "LMS" : "";
			const finish = version === "1.2" ? "LMSFinish" : "Terminate";
			const facade = Object.fromEntries(
				[
					`${prefix}Initialize`,
					finish,
					`${prefix}GetValue`,
					`${prefix}SetValue`,
					`${prefix}Commit`,
					`${prefix}GetLastError`,
					`${prefix}GetErrorString`,
					`${prefix}GetDiagnostic`,
				].map((name) => [
					name,
					(...args: string[]) => {
						calls.push(name);
						callback?.(name, args);
						return (source as unknown as Record<string, (...args: string[]) => string>)[name](
							...args,
						);
					},
				]),
			);
			const lms: WindowLike = { [version === "1.2" ? "API" : "API_1484_11"]: facade };
			lms.parent = lms;
			if (locked) {
				Object.freeze(facade);
				Object.freeze(lms);
			}
			const makeRuntime = () => {
				const win = { parent: lms };
				g.window = win;
				return version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			};
			const first = makeRuntime();
			const second = makeRuntime();
			expect(first.initialize()).toBe(true);
			expect(second.initialize()).toBe(true);
			calls.length = 0;
			return {
				source,
				calls,
				facade,
				lms,
				first,
				second,
				makeRuntime,
				prefix,
				finish,
				onCall: (fn: typeof callback) => {
					callback = fn;
				},
			};
		}

		it.each([
			["GetValue", false],
			["SetValue", false],
			["GetValue", true],
			["SetValue", true],
		] as const)(
			"guards explicit Finish completion %s with locked carriers %s",
			(method, locked) => {
				const { first, second, calls, source, makeRuntime, prefix, finish, onCall } = setup(locked);
				const completion = version === "1.2" ? "cmi.core.lesson_status" : "cmi.completion_status";
				let entered = false;
				onCall((name, args) => {
					if (name !== `${prefix}${method}` || args[0] !== completion || entered) return;
					entered = true;
					const before = calls.length;
					for (const runtime of [first, second, makeRuntime()]) {
						expect(runtime.initialize()).toBe(false);
						expect(runtime.terminate(true)).toBe(false);
						for (const action of [
							() => runtime.commit(),
							() => runtime.getCompletion(),
							() => runtime.setCompletion("completed"),
							() => runtime.getBookmark(),
							() => "getLastError" in runtime && runtime.getLastError(),
						]) {
							try {
								action();
							} catch {
								/* SCORM 1.2 rejects blocked transfers. */
							}
						}
					}
					expect(calls.length).toBe(before);
				});
				expect(second.terminate(true)).toBe(true);
				expect(entered).toBe(true);
				expect(source.data.get(completion)).toBe("completed");
				expect(calls.slice(-2)).toEqual([`${prefix}Commit`, finish]);
				expect(calls.filter((name) => name === `${prefix}Commit`)).toHaveLength(1);
				expect(calls.filter((name) => name === finish)).toHaveLength(1);
				expect(source.errors).toEqual([]);
			},
		);

		it.each(["false", "throw"])(
			"retries explicit Finish after completion write returns %s",
			(failure) => {
				const { first, second, source, facade, calls, prefix, finish } = setup();
				const completion = version === "1.2" ? "cmi.core.lesson_status" : "cmi.completion_status";
				const original = facade[`${prefix}SetValue`];
				facade[`${prefix}SetValue`] = (...args: string[]) => {
					if (args[0] !== completion) return original(...args);
					if (failure === "throw") throw new Error("Completion write failed");
					return "false";
				};
				if (failure === "throw")
					expect(() => second.terminate(true)).toThrow("Completion write failed");
				else expect(second.terminate(true)).toBe(false);
				expect(calls).not.toContain(`${prefix}Commit`);
				expect(calls).not.toContain(finish);
				expect(source.data.get(completion)).toBe("incomplete");
				facade[`${prefix}SetValue`] = original;
				expect(first.initialize()).toBe(true);
				first.setBookmark("retry explicit finish");
				expect(first.getBookmark()).toBe("retry explicit finish");
				expect(first.terminate(true)).toBe(true);
				expect(source.data.get(completion)).toBe("completed");
				expect(calls.slice(-2)).toEqual([`${prefix}Commit`, finish]);
			},
		);

		it.each(["exit", "session_time", "commit", "finish", "diagnostic"])(
			"blocks nested LMS calls during final %s",
			(stage) => {
				const { first, second, calls, source, makeRuntime, prefix, finish, onCall } = setup();
				let entered = false;
				onCall((name, args) => {
					const target =
						stage === "exit" || stage === "session_time"
							? name === `${prefix}SetValue` && args[0].endsWith(stage)
							: name ===
								(stage === "finish"
									? finish
									: `${prefix}${stage === "commit" ? "Commit" : "GetLastError"}`);
					if (!target || entered) return;
					entered = true;
					const before = calls.length;
					for (const runtime of [first, second, makeRuntime()]) {
						expect(runtime.initialize()).toBe(false);
						expect(runtime.terminate()).toBe(false);
						for (const action of [
							() => runtime.commit(),
							() => runtime.setBookmark("nested"),
							() => runtime.getBookmark(),
							() => runtime.setScore(1, 0, 100),
							() => runtime.trackInteraction("nested", "answer"),
							() => "getLastError" in runtime && runtime.getLastError(),
						]) {
							try {
								action();
							} catch {
								/* 1.2 rejects blocked transfers. */
							}
						}
					}
					expect(calls.length).toBe(before);
				});
				expect(second.terminate()).toBe(true);
				expect(entered).toBe(true);
				expect(calls.filter((name) => name === `${prefix}Commit`)).toHaveLength(1);
				expect(calls.filter((name) => name === finish)).toHaveLength(1);
				expect(source.errors).toEqual([]);
			},
		);

		it.each(["false", "throw"])("releases the final commit guard after %s", (failure) => {
			const { first, second, facade, calls, prefix, finish } = setup();
			const original = facade[`${prefix}Commit`];
			facade[`${prefix}Commit`] = () => {
				expect(first.terminate()).toBe(false);
				if (failure === "throw") throw new Error("Commit callback failed");
				return "false";
			};
			if (failure === "throw") expect(() => second.terminate()).toThrow("Commit callback failed");
			else expect(second.terminate()).toBe(false);
			expect(calls).not.toContain(finish);
			facade[`${prefix}Commit`] = original;
			expect(first.initialize()).toBe(true);
			first.setBookmark("retry");
			expect(first.getBookmark()).toBe("retry");
			expect(first.terminate()).toBe(true);
			expect(calls.filter((name) => name === finish)).toHaveLength(1);
		});

		it.each(["SetValue", "GetLastError", "GetErrorString"])(
			"stops an ordinary transfer after closure in %s",
			(method) => {
				const { first, second, source, calls, prefix, finish, onCall } = setup();
				let entered = false;
				if (method === "GetErrorString") {
					const name = `${prefix}GetLastError`;
					(source as unknown as Record<string, () => string>)[name] = () => "101";
				}
				onCall((name) => {
					if (name !== `${prefix}${method}` || entered) return;
					entered = true;
					if (method === "GetErrorString")
						(source as unknown as Record<string, () => string>)[`${prefix}GetLastError`] = () =>
							"0";
					expect(second.terminate()).toBe(true);
				});
				try {
					if (method === "SetValue") first.setScore(50, 0, 100);
					else first.getScore();
				} catch {
					/* Diagnostic errors remain observable. */
				}
				expect(entered).toBe(true);
				expect(calls[calls.indexOf(finish) - 1]).toBe(`${prefix}Commit`);
				expect(calls.slice(calls.indexOf(finish) + 1)).toEqual([]);
			},
		);

		it("uses writable Initialize bookkeeping after an API property getter throws", () => {
			const { facade, first, lms, calls, source, makeRuntime, prefix, finish } = setup();
			resetSessionState(facade, { parent: lms });
			Object.defineProperty(facade, "__praxityScormSessions", {
				get: () => {
					throw new Error("restricted getter");
				},
			});
			Object.defineProperty(lms, "__praxityScormSessions", {
				get: () => null,
				set: () => {
					throw new Error("restricted window");
				},
			});
			Object.preventExtensions(facade);
			// This is a fresh LMS launch, so clear its lifecycle without changing callables.
			Object.assign(source, version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api());
			const next = makeRuntime();
			expect(next.initialize()).toBe(true);
			expect(first.initialize()).toBe(true);
			expect(next.terminate()).toBe(true);
			const count = calls.length;
			expect(first.initialize()).toBe(false);
			expect(makeRuntime().initialize()).toBe(false);
			expect(calls.slice(count)).toEqual([]);
			expect(calls.filter((name) => name === finish)).toHaveLength(1);
			expect(calls.filter((name) => name === `${prefix}Initialize`)).toHaveLength(1);
		});
	});
}

it.each(["failed", "unknown", "passed"] as const)(
	"retains legacy quiz %s success across SCORM 2004 utility pages",
	(success) => {
		const api = new StrictScorm2004Api();
		const lms: WindowLike = { API_1484_11: api };
		lms.parent = lms;
		const content = new Scorm2004Runtime({ parent: lms });
		expect(content.initialize()).toBe(true);
		if (success === "unknown") content.setSuccess("unknown");
		else content.setCompletion(success);
		content.setCompletion("completed");
		const utility = new Scorm2004Runtime({ parent: lms });
		expect(utility.initialize()).toBe(true);
		expect(utility.terminate()).toBe(true);
		expect(api.data.get("cmi.exit")).toBe(success === "passed" ? "normal" : "suspend");
		expect(api.calls.at(-2)?.[0]).toBe("Commit");
		expect(api.calls.at(-1)?.[0]).toBe("Terminate");
	},
);

it.each(["empty", "throwing"] as const)(
	"retains closed SCORM 1.2 communication when the primary callable has an %s API entry",
	(primaryEntry) => {
		const source = new StrictScorm12Api();
		const observed: string[] = [];
		let primaryRestricted = true;
		const primary = () => "true";
		const primaryStore = new WeakMap<object, unknown>();
		if (primaryEntry === "throwing") {
			Object.defineProperty(primaryStore, "get", {
				value: () => {
					throw new Error("restricted primary entry");
				},
			});
		}
		Object.defineProperty(primary, "__praxityScormSessions", { value: primaryStore });
		const facade = Object.freeze({
			get Initialize() {
				if (primaryRestricted) throw new Error("restricted primary callable");
				return primary;
			},
			...Object.fromEntries(
				[
					"LMSInitialize",
					"LMSFinish",
					"LMSGetValue",
					"LMSSetValue",
					"LMSCommit",
					"LMSGetLastError",
					"LMSGetErrorString",
					"LMSGetDiagnostic",
				].map((name) => [
					name,
					(...args: string[]) => {
						observed.push(name);
						return (source as unknown as Record<string, (...args: string[]) => string>)[name](
							...args,
						);
					},
				]),
			),
		});
		const parent = Object.freeze({ API: facade });
		vi.stubGlobal("window", { parent });
		try {
			const first = new Scorm12Runtime();
			expect(first.initialize()).toBe(true);
			if (primaryEntry === "throwing") {
				primaryRestricted = false;
				expect(new Scorm12Runtime().initialize()).toBe(true);
				primaryRestricted = true;
			}
			expect(first.terminate()).toBe(true);
			primaryRestricted = false;
			const before = observed.length;
			expect(first.initialize()).toBe(false);
			expect(new Scorm12Runtime().initialize()).toBe(false);
			expect(observed.slice(before)).toEqual([]);
			expect(observed.filter((name) => name === "LMSInitialize")).toHaveLength(1);
			expect(observed.filter((name) => name === "LMSFinish")).toHaveLength(1);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

it("suspends incomplete SCORM 2004 attempts even after a passed result", () => {
	const api = new StrictScorm2004Api();
	const runtime = createScorm2004Runtime(api);
	expect(runtime.initialize()).toBe(true);
	runtime.setSuccess("passed");
	runtime.setCompletion("incomplete");
	expect(runtime.terminate()).toBe(true);
	expect(api.data.get("cmi.exit")).toBe("suspend");
	expect(api.calls.at(-2)?.[0]).toBe("Commit");
	expect(api.calls.at(-1)?.[0]).toBe("Terminate");
});

it.each(["1.2", "2004"] as const)(
	"preserves failed legacy quiz tracking through a %s utility finish",
	(version) => {
		const api = version === "1.2" ? new StrictScorm12Api() : new StrictScorm2004Api();
		const win = { [version === "1.2" ? "API" : "API_1484_11"]: api };
		vi.stubGlobal("window", win);
		try {
			const content = version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			expect(content.initialize()).toBe(true);
			const tracker = new CourseTracker(content, { totalPages: 2, completionMethod: "quiz" });
			tracker.trackInteraction("legacy-question", "wrong", false, 0);
			const utility = version === "1.2" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			expect(utility.initialize()).toBe(true);
			expect(utility.terminate()).toBe(true);
			expect(api.data.get(version === "1.2" ? "cmi.core.exit" : "cmi.exit")).toBe("suspend");
			expect(
				api.data.get(version === "1.2" ? "cmi.core.lesson_status" : "cmi.success_status"),
			).toBe("failed");
			expect(api.calls.slice(-2).map(([name]) => name)).toEqual(
				version === "1.2" ? ["LMSCommit", "LMSFinish"] : ["Commit", "Terminate"],
			);
		} finally {
			vi.unstubAllGlobals();
		}
	},
);

// Captured runtime writes at 08a6a0d8d; privacy also seeds untrusted device data.
// These literal inputs are never regenerated by tests.
const frozenLearnerState: Record<string, Record<string, Record<string, string>>> = JSON.parse(
	readFileSync(new URL("./fixtures/scorm-learner-state.json", import.meta.url), "utf8"),
);

describe.each(["scorm12", "scorm2004"] as const)("%s frozen learner-state fixtures", (version) => {
	function restore(name: string, policy: Record<string, "device" | "lms"> = {}) {
		const values = frozenLearnerState[version][name];
		if (version === "scorm12") {
			const api = new StrictScorm12Api();
			for (const [key, value] of Object.entries(values)) api.data.set(key, value);
			installScorm12Api(api);
			const runtime = new Scorm12Runtime();
			runtime.setBlockStatePolicy(policy);
			expect(runtime.initialize()).toBe(true);
			return { runtime, data: api.data };
		}
		const api = new StrictScorm2004Api();
		for (const [key, value] of Object.entries(values)) api.data.set(key, value);
		const runtime = createScorm2004Runtime(api);
		runtime.setBlockStatePolicy(policy);
		expect(runtime.initialize()).toBe(true);
		return { runtime, data: api.data };
	}

	it("restores the literal bookmark", () => {
		const { runtime } = restore("bookmark");
		expect(runtime.getBookmark()).toBe("page-feedback");
		expect(runtime.getVisitedPages()).toStrictEqual([]);
	});

	it("restores the ordered visits without the duplicate visit", () => {
		const { runtime } = restore("visit");
		expect(runtime.getVisitedPages()).toStrictEqual(["page-intro", "page-practice"]);
		expect(runtime.getInteractions()).toStrictEqual([]);
	});

	it("restores the literal answer and block state through their current owners", () => {
		const { runtime } = restore("answer");
		expect(runtime.getInteractions()).toStrictEqual([
			{
				id: "question",
				response: "choice-a",
				correct: false,
				score: 40,
				attemptsUsed: 1,
				maxAttempts: 2,
				memberIds: undefined,
				timestamp: 1_800_000_000_000,
			},
		]);
		expect(createBlockStateRuntime(runtime).get("question")).toStrictEqual({
			answer: "choice-a",
			submitted: true,
		});
	});

	it("restores both retry records, exact attempt limits and aggregate membership", () => {
		const { runtime } = restore("retry");
		expect(runtime.getInteractions()).toStrictEqual([
			{
				id: "quiz",
				response: "choice-a",
				correct: false,
				score: 40,
				attemptsUsed: 1,
				maxAttempts: 2,
				memberIds: ["question"],
				timestamp: 1_800_000_000_000,
			},
			{
				id: "quiz",
				response: "choice-b",
				correct: true,
				score: 100,
				attemptsUsed: 2,
				maxAttempts: 2,
				memberIds: ["question"],
				timestamp: 1_800_000_001_000,
			},
		]);
	});

	it("excludes seeded device records on private restore and scrubs them on save", () => {
		const blockStatePolicy = { journal: "device", reported: "lms" } as const;
		const { runtime, data } = restore("privacy", blockStatePolicy);
		const dom = new JSDOM("", { url: "https://course.example/page.html" });
		const page: CourseHostConfig = {
			version: 1,
			courseId: "synthetic-course",
			pageId: "page",
			pageTitle: "Practice",
			currentPage: 1,
			totalPages: 1,
			currentSlug: "page",
			availableSlugs: ["page"],
			pageIdMap: { page: "page" },
			completionMethod: "allPages",
			pageRole: "content",
			strings: {},
			blockStatePolicy,
		};
		const state = createPrivateBlockStateRuntime(
			runtime,
			page,
			dom.window as unknown as Window,
			undefined,
			version,
		);
		try {
			expect(runtime.getInteractions()).toStrictEqual([
				{
					id: "reported",
					response: "SYNTHETIC REPORTED",
					attemptsUsed: undefined,
					maxAttempts: undefined,
					memberIds: undefined,
					timestamp: 1_800_000_000_000,
				},
			]);
			expect(state.get("reported")).toStrictEqual({ answer: "SYNTHETIC REPORTED" });
			expect(state.get("journal")).toBeUndefined();
			// The untrusted LMS input really contains both device-owned records.
			expect(data.get("cmi.suspend_data")).toContain("SYNTHETIC PRIVATE");
			expect(state.set("reported", { answer: "SYNTHETIC REPORTED" })).toStrictEqual({
				status: "saved",
				destination: "lms",
			});
			const saved = JSON.parse(data.get("cmi.suspend_data") ?? "null");
			const custom = version === "scorm12" ? JSON.parse(saved.custom) : saved;
			expect(saved.interactions).toStrictEqual([
				{ id: "reported", response: "SYNTHETIC REPORTED", timestamp: 1_800_000_000_000 },
			]);
			expect(custom.blockState).toStrictEqual({ reported: { answer: "SYNTHETIC REPORTED" } });
			expect(data.get("cmi.suspend_data")).not.toContain("SYNTHETIC PRIVATE");
		} finally {
			dom.window.close();
		}
	});

	it("preserves current-format state without attempt fields through restore and a later save", () => {
		const { runtime, data } = restore("current-without-attempt-fields");
		expect(runtime.getVisitedPages()).toStrictEqual(["legacy-page"]);
		expect(runtime.getInteractions()).toStrictEqual([
			{
				id: "legacy-question",
				response: "legacy answer",
				correct: false,
				score: 0,
				attemptsUsed: undefined,
				maxAttempts: undefined,
				memberIds: undefined,
				timestamp: 1_600_000_000_000,
			},
		]);
		const state = createBlockStateRuntime(runtime);
		expect(state.get("legacy-question")).toStrictEqual({ answer: "legacy answer" });
		runtime.trackPageVisit("later-page");
		state.set("later-question", { answer: "later answer" });
		expect(state.get("legacy-question")).toStrictEqual({ answer: "legacy answer" });
		const preserved = {
			visitedPages: ["legacy-page", "later-page"],
			interactions: [
				{
					id: "legacy-question",
					response: "legacy answer",
					correct: false,
					score: 0,
					timestamp: 1_600_000_000_000,
				},
			],
		};
		const custom = {
			blockState: {
				"legacy-question": { answer: "legacy answer" },
				"later-question": { answer: "later answer" },
			},
		};
		// The runtime has no learner-state epoch. Strict envelope equality guards
		// against adding one (or attempt fields) during restore and a later save.
		expect(JSON.parse(data.get("cmi.suspend_data") ?? "null")).toStrictEqual(
			version === "scorm12"
				? { ...preserved, custom: JSON.stringify(custom) }
				: { ...preserved, ...custom },
		);
		expect(JSON.parse(runtime.getSuspendData() ?? "null")).toStrictEqual(
			version === "scorm12" ? custom : { ...preserved, ...custom },
		);
	});
});

describe("SCORM 1.2 privacy append high water", () => {
	function setup(count: string, policy: Record<string, "device" | "lms"> = { secret: "device" }) {
		const api = new StrictScorm12Api();
		api.data.set("cmi.interactions._count", count);
		api.data.set("cmi.interactions.0.id", "earlier-public");
		api.data.set("cmi.interactions.3.id", "earlier-public-3");
		api.data.set(
			"cmi.suspend_data",
			JSON.stringify({
				visitedPages: [],
				interactions: [{ id: "secret", response: "SECRET", timestamp: 1 }],
			}),
		);
		installScorm12Api(api);
		const runtime = new Scorm12Runtime();
		runtime.setBlockStatePolicy(policy);
		expect(runtime.initialize()).toBe(true);
		return { api, runtime };
	}
	it("appends above filtered history, stale counts, optional failure, policy changes and a second adapter", () => {
		const { api, runtime } = setup("4");
		const original = api.LMSSetValue.bind(api);
		vi.spyOn(api, "LMSSetValue").mockImplementation((key, value) =>
			key.endsWith(".student_response") ? "false" : original(key, value),
		);
		runtime.trackInteraction("public-a", "ordinary");
		runtime.setBlockStatePolicy({ other: "device" });
		runtime.trackInteraction("public-b", "ordinary");
		const next = new Scorm12Runtime();
		next.setBlockStatePolicy({ secret: "device" });
		next.initialize();
		next.trackInteraction("public-c", "ordinary");
		expect(
			api.calls
				.filter(([name, key]) => name === "LMSSetValue" && /^cmi.interactions.\d+.id$/.test(key))
				.map(([, key]) => key),
		).toEqual(["cmi.interactions.4.id", "cmi.interactions.5.id", "cmi.interactions.6.id"]);
		expect(api.data.get("cmi.interactions.0.id")).toBe("earlier-public");
		expect(api.data.get("cmi.interactions.3.id")).toBe("earlier-public-3");
	});
	it("does not consume a rejected ID or write fields to that row", () => {
		const { api, runtime } = setup("4");
		const original = api.LMSSetValue.bind(api);
		let reject = true;
		vi.spyOn(api, "LMSSetValue").mockImplementation((key, value) => {
			if (key.endsWith(".id") && reject) {
				reject = false;
				return "false";
			}
			return original(key, value);
		});
		runtime.trackInteraction("rejected", "ordinary");
		expect(
			api.calls.filter(
				([name, key]) => name === "LMSSetValue" && key.startsWith("cmi.interactions."),
			),
		).toEqual([]);
		runtime.trackInteraction("accepted", "ordinary");
		expect(api.data.get("cmi.interactions.4.id")).toBe("accepted");
	});
	it("re-reads a growing count and retains truncation callbacks when a count is unavailable", () => {
		const { api, runtime } = setup("4");
		runtime.trackInteraction("public-a", "ordinary");
		api.data.set("cmi.interactions._count", "9");
		runtime.trackInteraction("public-b", "ordinary");
		expect(api.data.get("cmi.interactions.9.id")).toBe("public-b");
		api.data.set("cmi.interactions._count", "");
		const truncated = vi.fn();
		runtime.trackInteraction("long", "a".repeat(300), undefined, undefined, {
			assessmentType: "textResponse",
			onResponseTruncated: truncated,
		});
		expect(truncated).toHaveBeenCalledExactlyOnceWith(250);
	});

	it("accepts the largest safe count once and never rounds its successor into a reused row", () => {
		const { api, runtime } = setup(String(Number.MAX_SAFE_INTEGER));
		runtime.trackInteraction("public-a", "ordinary");
		runtime.trackInteraction("public-b", "ordinary");
		expect(api.data.get(`cmi.interactions.${Number.MAX_SAFE_INTEGER}.id`)).toBe("public-a");
		expect(
			api.calls.filter(
				([name, key]) => name === "LMSSetValue" && /^cmi.interactions.\d+.id$/.test(key),
			),
		).toHaveLength(1);
	});

	it.each(["-1", "1.5", "NaN", "9007199254740992", " 4", "4x"])(
		"skips optional rows for invalid device-policy count %s but retains ordinary history",
		(count) => {
			const { api, runtime } = setup(count);
			runtime.trackInteraction("public", "ordinary");
			expect(
				api.calls.filter(
					([name, key]) => name === "LMSSetValue" && key.startsWith("cmi.interactions."),
				),
			).toEqual([]);
			expect(runtime.getInteractions()).toMatchObject([{ id: "public", response: "ordinary" }]);
		},
	);
	it.each(["", "invalid", "-1", "2.5", "1e3", "9007199254740992"])(
		"retains history-index fallback without device members (%s)",
		(count) => {
			const { api, runtime } = setup(count, {});
			runtime.trackInteraction("public", "ordinary");
			expect(api.data.get("cmi.interactions.1.id")).toBe("public");
		},
	);
	it.each([
		{ value: "", selfCheck: false },
		{ value: "invalid", selfCheck: false },
		{ value: "", selfCheck: true },
		{ value: "invalid", selfCheck: true },
	])(
		"writes the full ordinary row on an LMS _count error ($value, self-check=$selfCheck)",
		({ value, selfCheck }) => {
			const policy = selfCheck
				? compileBlockStatePolicy([{ id: "secret", type: "selfCheck", data: {} } as PraxityBlock])
				: {};
			const { api, runtime } = setup("6", policy);
			let countError = false;
			const get = api.LMSGetValue.bind(api);
			const set = api.LMSSetValue.bind(api);
			vi.spyOn(api, "LMSGetValue").mockImplementation((key) => {
				const result = get(key);
				countError = key === "cmi.interactions._count";
				return countError ? value : result;
			});
			vi.spyOn(api, "LMSGetLastError").mockImplementation(() => (countError ? "401" : "0"));
			vi.spyOn(api, "LMSSetValue").mockImplementation((key, value) => {
				countError = false; // Every successful LMS call clears its preceding error.
				return set(key, value);
			});
			if (selfCheck) runtime.trackInteraction("secret", "PRIVATE ANSWER", true);
			runtime.trackInteraction("public", "ordinary-answer", true, undefined, {
				assessmentType: "choice",
			});
			expect(
				Object.fromEntries([...api.data].filter(([key]) => key.startsWith("cmi.interactions.1."))),
			).toEqual({
				"cmi.interactions.1.id": "public",
				"cmi.interactions.1.type": "performance",
				"cmi.interactions.1.result": "correct",
				"cmi.interactions.1.student_response": "ordinary-answer",
			});
			if (selfCheck) expect(api.data.get("cmi.suspend_data")).not.toContain("PRIVATE");
		},
	);

	it("preserves earlier LMS rows after republishing without the last private choice", () => {
		const { api, runtime } = setup("4", {});
		api.data.set(
			"cmi.suspend_data",
			JSON.stringify({
				visitedPages: [],
				interactions: [
					{ id: "earlier-public", response: "a", timestamp: 1 },
					{ id: "earlier-public-3", response: "b", timestamp: 2 },
				],
			}),
		);
		const original = api.LMSSetValue.bind(api);
		vi.spyOn(api, "LMSSetValue").mockImplementation((key, value) => {
			const result = original(key, value);
			const match = /^cmi.interactions.(\d+).id$/.exec(key);
			if (result === "true" && match)
				api.data.set(
					"cmi.interactions._count",
					String(Math.max(Number(api.data.get("cmi.interactions._count")), Number(match[1]) + 1)),
				);
			return result;
		});
		runtime.trackInteraction("public-c", "c");
		runtime.trackInteraction("public-d", "d");
		expect(api.data.get("cmi.interactions.4.id")).toBe("public-c");
		expect(api.data.get("cmi.interactions.5.id")).toBe("public-d");
		expect(api.data.get("cmi.interactions.3.id")).toBe("earlier-public-3");
	});
});
