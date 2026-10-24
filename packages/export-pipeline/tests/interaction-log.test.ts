import { createLearnerState } from "@praxity/shared-blocks/learner-state";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker } from "../src/scorm/tracking";
import type { InteractionRecord, SCORMRuntime } from "../src/scorm/types";

const documents: JSDOM[] = [];
const signature = "s96:3w14l18FIDxpK_Py";
const formats = ["scorm12", "scorm2004", "xapi", "local", "local-legacy"] as const;

afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function launch(format: (typeof formats)[number], restoredRows?: InteractionRecord[]) {
	const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
	documents.push(dom);
	vi.stubGlobal("window", dom.window);
	vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
	const values = new Map<string, string>();
	const writes: [string, string][] = [];
	let count = 0;
	if (restoredRows) {
		values.set(
			"cmi.suspend_data",
			JSON.stringify({ visitedPages: [], interactions: restoredRows }),
		);
		count = restoredRows.length;
	}
	const get = (key: string) =>
		key === "cmi.interactions._count" ? String(count) : (values.get(key) ?? "");
	const set = (key: string, value: string) => {
		if (/^cmi\.interactions\.\d+\.id$/.test(key)) count++;
		if (key === "cmi.suspend_data" && format === "scorm12" && value.length > 4096) return "false";
		values.set(key, value);
		writes.push([key, value]);
		return "true";
	};
	const ok = () => "true";
	Object.assign(dom.window, {
		API: {
			LMSInitialize: ok,
			LMSFinish: ok,
			LMSGetValue: get,
			LMSSetValue: set,
			LMSCommit: ok,
			LMSGetLastError: () => "0",
		},
		API_1484_11: {
			Initialize: ok,
			Terminate: ok,
			GetValue: get,
			SetValue: set,
			Commit: ok,
			GetLastError: () => "0",
		},
	});
	let runtime: SCORMRuntime;
	if (format === "scorm12") runtime = new Scorm12Runtime();
	else if (format === "scorm2004") runtime = new Scorm2004Runtime();
	else if (format === "xapi") {
		const actor = { name: "Learner", mbox: "mailto:learner@example.com" };
		if (restoredRows) {
			dom.window.localStorage.setItem(
				"praxity-xapi:course:mailto%3Alearner%40example.com",
				JSON.stringify({ interactions: restoredRows }),
			);
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
		}
		runtime = new XapiRuntime(
			{ endpoint: "", auth: "", ...(restoredRows ? { actor } : {}) },
			"course",
			dom.window.localStorage,
		);
	} else {
		if (restoredRows) {
			if (format === "local") {
				const state = createLearnerState({ courseId: "course", attemptId: "default" });
				state.interactions = restoredRows;
				dom.window.localStorage.setItem("praxity:course:default:state", JSON.stringify(state));
			} else {
				dom.window.localStorage.setItem("praxity_interactions", JSON.stringify(restoredRows));
			}
		}
		runtime = new LocalStorageRuntime(
			dom.window.localStorage,
			format === "local" ? "course" : undefined,
		);
	}
	expect(runtime.initialize()).toBe(true);
	return { runtime, values, writes };
}

describe.each(formats)("%s interaction log", (format) => {
	it("retains the last scored row from restored append history after an unscored submission", () => {
		const rows = [
			{ id: "a", response: "old", correct: true, score: 100, timestamp: 1 },
			{ id: "a", response: "new", correct: false, score: 0, timestamp: 2 },
		];
		const { runtime } = launch(format, rows);
		expect(runtime.getInteractions()).toEqual(rows);
		runtime.trackInteraction("a", "unscored");
		expect(
			runtime.getInteractions().map(({ id, response, score }) => [id, response, score]),
		).toEqual([
			["a", "new", 0],
			["a", "unscored", undefined],
		]);
		expect(
			new CourseTracker(runtime, { totalPages: 1, completionMethod: "quiz" }).calculateScore(),
		).toBe(0);
	});

	it("retains the latest scored and latest row, moving the retried ID to the end", () => {
		const { runtime } = launch(format);
		runtime.trackInteraction("a", "old", true, 100);
		runtime.trackInteraction("a", "scored", false, 0, { contentSignature: signature });
		runtime.trackInteraction("a", "unscored", true);
		runtime.trackInteraction("b", "other", true, 50);
		runtime.trackInteraction("a", "latest", undefined, undefined, {
			contentSignature: signature,
		});
		expect(runtime.getInteractions()).toMatchObject([
			{ id: "b", response: "other", score: 50 },
			{ id: "a", response: "scored", score: 0, contentSignature: signature },
			{ id: "a", response: "latest", contentSignature: signature },
		]);
		expect(runtime.getInteractions().at(-1)?.score).toBeUndefined();
		expect(
			new CourseTracker(runtime, { totalPages: 1, completionMethod: "quiz" }).calculateScore(),
		).toBe(25);
		runtime.trackInteraction("a", "replacement", true, 80);
		expect(runtime.getInteractions().map(({ id, response }) => [id, response])).toEqual([
			["b", "other"],
			["a", "replacement"],
		]);
	});

	it.each(["authored", "legacy"])(
		"keeps a retried member pending until its newer aggregate arrives (%s)",
		(mode) => {
			const { runtime } = launch(format);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "quiz",
				passMark: 80,
				...(mode === "authored" ? { scoredAssessmentIds: ["group"] } : {}),
				deferRetryableFailure: true,
			});
			runtime.trackInteraction("a", "wrong", false, 0);
			runtime.trackInteraction("group", "0%", false, 0, {
				memberIds: ["a"],
				contentSignature: signature,
			});
			expect(tracker.outcome().result).toMatchObject({ passed: false });
			runtime.trackInteraction("a", "right", true, 100);
			expect(tracker.outcome().result).toBeNull();
			runtime.trackInteraction("group", "100%", true, 100, {
				memberIds: ["a"],
				contentSignature: signature,
			});
			expect(tracker.outcome().result).toMatchObject({ score: 100, passed: true });
		},
	);
});

it.each(["scorm12", "scorm2004"] as const)(
	"%s journals every retry with constant suspend length",
	(format) => {
		const { runtime, values, writes } = launch(format);
		runtime.trackInteraction("question", "answer", true, 100);
		const firstLength = values.get("cmi.suspend_data")?.length;
		expect(firstLength).toBeGreaterThan(0);
		for (let retry = 0; retry < 80; retry++) {
			runtime.trackInteraction("question", "answer", true, 100);
			expect(values.get("cmi.suspend_data")?.length).toBe(firstLength);
		}
		expect(writes.filter(([key]) => /^cmi\.interactions\.\d+\.id$/.test(key))).toEqual(
			Array.from({ length: 81 }, (_, index) => [`cmi.interactions.${index}.id`, "question"]),
		);
	},
);
