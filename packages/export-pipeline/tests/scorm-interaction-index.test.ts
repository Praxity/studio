import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";
import { CourseTracker } from "../src/scorm/tracking";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe.each(["1.2", "2004"] as const)("SCORM %s interaction indices", (version) => {
	it.each(["0", "101"])(
		"reuses a refused ID's index for later interactions and permits retry with error %s",
		(refusalError) => {
			const values = new Map<string, string>();
			const writes: [string, string][] = [];
			let count = 0;
			let error = "0";
			let refused = false;
			const get = (key: string) => {
				error = "0";
				return key === "cmi.interactions._count" ? String(count) : (values.get(key) ?? "");
			};
			const set = (key: string, value: string) => {
				error = "0";
				writes.push([key, value]);
				const row = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(key);
				if (row) {
					const index = Number(row[1]);
					// The fake requires contiguous rows and IDs before fields; Moodle's latter rule is 2004 only.
					if (index > count || (row[2] !== "id" && !values.has(`cmi.interactions.${index}.id`))) {
						error = version === "2004" ? "351" : "101";
						return "false";
					}
					if (row[2] === "id") {
						if (value === "refused" && !refused) {
							refused = true;
							error = refusalError;
							return "false";
						}
						if (index === count) count++;
					}
				}
				values.set(key, value);
				return "true";
			};
			const api = {
				Initialize: () => "true",
				Terminate: () => "true",
				GetValue: get,
				SetValue: set,
				Commit: () => "true",
				GetLastError: () => error,
				GetErrorString: () => "Write refused",
				GetDiagnostic: () => "",
			};
			const win = {
				API_1484_11: api,
				API: {
					LMSInitialize: api.Initialize,
					LMSFinish: api.Terminate,
					LMSGetValue: get,
					LMSSetValue: set,
					LMSCommit: api.Commit,
					LMSGetLastError: api.GetLastError,
					LMSGetErrorString: api.GetErrorString,
					LMSGetDiagnostic: api.GetDiagnostic,
				},
				parent: null as unknown as WindowLike,
			};
			win.parent = win;
			vi.stubGlobal("window", win);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.spyOn(Date, "now").mockReturnValue(1000);
			const runtime = version === "2004" ? new Scorm2004Runtime(win) : new Scorm12Runtime();
			expect(runtime.initialize()).toBe(true);

			runtime.trackInteraction("refused", "first-answer", true, 100);
			expect(count).toBe(0);
			expect(writes.filter(([key]) => key.startsWith("cmi.interactions."))).toEqual([
				["cmi.interactions.0.id", "refused"],
			]);
			expect(JSON.parse(values.get("cmi.suspend_data") ?? "{}").interactions).toEqual([
				{ id: "refused", response: "first-answer", correct: true, score: 100, timestamp: 1000 },
			]);
			const next = version === "2004" ? new Scorm2004Runtime(win) : new Scorm12Runtime();
			expect(next.initialize()).toBe(true);
			expect(next.getInteractions()).toEqual([
				{ id: "refused", response: "first-answer", correct: true, score: 100, timestamp: 1000 },
			]);
			expect(
				new CourseTracker(next, { totalPages: 1, completionMethod: "quiz" }).calculateScore(),
			).toBe(100);
			runtime.trackInteraction("second", "second-answer", true);
			runtime.trackInteraction("third", "third-answer", false);
			runtime.trackInteraction("refused", "retry-answer", true);

			const responseField = version === "2004" ? "learner_response" : "student_response";
			expect([0, 1, 2].map((index) => values.get(`cmi.interactions.${index}.id`))).toEqual([
				"second",
				"third",
				"refused",
			]);
			expect(
				[0, 1, 2].map((index) => values.get(`cmi.interactions.${index}.${responseField}`)),
			).toEqual(["second-answer", "third-answer", "retry-answer"]);
			expect(count).toBe(3);
		},
	);
});

function refusedIdRuntime(version: "1.2" | "2004", refusedId: string) {
	const values = new Map<string, string>();
	const writes: [string, string][] = [];
	let error = "0";
	const get = (key: string) => {
		error = "0";
		return key === "cmi.interactions._count" ? "0" : (values.get(key) ?? "");
	};
	const set = (key: string, value: string) => {
		error = "0";
		writes.push([key, value]);
		if (/^cmi\.interactions\.\d+\.id$/.test(key) && value === refusedId) {
			error = "406";
			return "false";
		}
		values.set(key, value);
		return "true";
	};
	const api = {
		Initialize: () => "true",
		Terminate: () => "true",
		Commit: () => "true",
		GetValue: get,
		SetValue: set,
		GetLastError: () => error,
		GetErrorString: () => "Write refused",
		GetDiagnostic: () => "",
	};
	const win = {
		API_1484_11: api,
		API: {
			LMSInitialize: api.Initialize,
			LMSFinish: api.Terminate,
			LMSCommit: api.Commit,
			LMSGetValue: get,
			LMSSetValue: set,
			LMSGetLastError: api.GetLastError,
			LMSGetErrorString: api.GetErrorString,
			LMSGetDiagnostic: api.GetDiagnostic,
		},
		parent: null as unknown as WindowLike,
	};
	win.parent = win;
	vi.stubGlobal("window", win);
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const runtime = version === "2004" ? new Scorm2004Runtime(win) : new Scorm12Runtime();
	expect(runtime.initialize()).toBe(true);
	return { runtime, values, writes };
}

describe.each(["1.2", "2004"] as const)("SCORM %s refused reporting ID", (version) => {
	it("keeps a correct submission's course score at 100", () => {
		const { runtime, values } = refusedIdRuntime(version, "question");
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			passMark: 80,
		});
		tracker.trackInteraction("question", "right-answer", true, 100);
		expect(values.get(version === "2004" ? "cmi.score.raw" : "cmi.core.score.raw")).toBe("100");
	});

	it("retains a permanently refused required answer in the course outcome", () => {
		const { runtime } = refusedIdRuntime(version, "bad id");
		runtime.trackInteraction("bad id", "answer", true, 1);
		const tracker = new CourseTracker(runtime, {
			totalPages: 1,
			completionMethod: "quiz",
			passMark: 0.5,
			scoredAssessmentIds: ["bad id"],
			requiredAssessmentIds: ["bad id"],
		});
		expect(runtime.getInteractions()).toMatchObject([
			{ id: "bad id", response: "answer", score: 1 },
		]);
		expect(tracker.outcome("check")).toMatchObject({ result: { score: 1, passed: true } });
		if (version === "2004") expect(tracker.outcome("check")).toMatchObject({ success: "passed" });
	});

	it("skips reporting fields but still notifies about a truncated saved response", () => {
		const { runtime, writes } = refusedIdRuntime(version, "question");
		const onResponseTruncated = vi.fn();
		runtime.trackInteraction("question", "x".repeat(5000), true, 100, { onResponseTruncated });
		expect(writes.filter(([key]) => key.startsWith("cmi.interactions."))).toEqual([
			["cmi.interactions.0.id", "question"],
		]);
		const limit = version === "2004" ? 3900 : 250;
		expect(onResponseTruncated).toHaveBeenCalledExactlyOnceWith(limit);
		expect(runtime.getInteractions()).toMatchObject([
			{ id: "question", response: "x".repeat(limit) },
		]);
	});
});
