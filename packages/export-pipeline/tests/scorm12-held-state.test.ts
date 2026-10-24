import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { CourseTracker } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import compactVectors from "./fixtures/scorm12-compact-vectors";

const unreadable =
	'{"visitedPages":["p1"],"interactions":[{"id":"q","response":"Stop","correct":true,"score":100,"timestamp":1800000000000}],"custom":{}}';
function fixture(status = "passed", original = unreadable) {
	const values: Record<string, string> = {
		"cmi.suspend_data": original,
		"cmi.core.lesson_status": status,
		"cmi.core.score.raw": "100",
		"cmi.core.student_id": "learner",
	};
	const writes: string[] = [];
	const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
	Object.assign(dom.window, {
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: () => "true",
			LMSGetLastError: () => "0",
			LMSGetValue: (key: string) => values[key] ?? "",
			LMSSetValue: (key: string, value: string) => {
				writes.push(key);
				values[key] = value;
				return "true";
			},
		},
	});
	vi.stubGlobal("window", dom.window);
	return { values, writes, dom };
}
afterEach(() => vi.unstubAllGlobals());
it.each(compactVectors)(
	"restores the exact $name compact vector through the ordinary reader without rewriting it",
	({ wire, expected }) => {
		const { values, writes, dom } = fixture("passed", wire);
		try {
			const runtime = new Scorm12Runtime("course");
			expect(runtime.initialize()).toBe(true);
			expect(runtime.getVisitedPages()).toEqual(expected.visitedPages);
			expect(runtime.getInteractions()).toEqual(expected.interactions);
			expect(runtime.getSuspendData()).toBe(expected.custom);
			expect(writes).toEqual([]);
			expect(values["cmi.suspend_data"]).toBe(wire);
		} finally {
			dom.window.close();
		}
	},
);
it.each(compactVectors)(
	"holds the damaged $name compact vector without replacement writes",
	({ wire }) => {
		const envelope = JSON.parse(wire);
		envelope[4] = (envelope[4] + 1) >>> 0; // Damage the decoded CRC, retaining a valid envelope.
		const damaged = JSON.stringify(envelope);
		const { values, writes, dom } = fixture("passed", damaged);
		try {
			const runtime = new Scorm12Runtime("course");
			expect(runtime.initialize()).toBe(true);
			expect(runtime.getInteractions()).toEqual([]);
			expect(runtime.getSuspendData()).toBeNull();
			const provider = createBlockStateRuntime(runtime);
			expect(provider.get("q")).toBeUndefined();
			provider.set("q", { answer: "draft", checked: false });
			expect(provider.getSaveResult?.("q")).toEqual({
				status: "not-saved",
				code: "unreadable-state",
			});
			expect(runtime.setSuspendData('{"replacement":true}')).toBe(false);
			runtime.setCompletion("completed");
			runtime.setCompletion("failed");
			runtime.setScore(0, 0, 100);
			runtime.trackObjective("q", 0, false);
			expect(runtime.commit()).toBe(true);
			expect(runtime.terminate(true)).toBe(true);
			expect(
				writes.filter(
					(key) =>
						key === "cmi.suspend_data" ||
						key === "cmi.core.lesson_status" ||
						key.startsWith("cmi.core.score.") ||
						key.startsWith("cmi.objectives."),
				),
			).toEqual([]);
			expect(values["cmi.suspend_data"]).toBe(damaged);
			expect(values["cmi.core.lesson_status"]).toBe("passed");
			expect(values["cmi.core.score.raw"]).toBe("100");
		} finally {
			dom.window.close();
		}
	},
);
it.each(["passed", "failed", ""])(
	"reports no completion, success or score over unreadable data with prior status %j",
	(status) => {
		const { values, writes, dom } = fixture(status);
		try {
			const runtime = new Scorm12Runtime("course");
			expect(runtime.initialize()).toBe(true);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "allPages",
				passMark: 80,
				scoredAssessmentIds: ["q"],
			});
			tracker.trackPageVisit("p1");
			runtime.setCompletion("incomplete");
			runtime.setScore(0, 0, 100);
			runtime.trackObjective("q", 0, false);
			expect(runtime.commit()).toBe(true);
			expect(runtime.terminate(true)).toBe(true);
			expect(
				writes.filter(
					(key) =>
						key === "cmi.core.lesson_status" ||
						key.startsWith("cmi.core.score.") ||
						key.startsWith("cmi.objectives."),
				),
			).toEqual([]);
			expect(values["cmi.core.lesson_status"]).toBe(status);
			expect(values["cmi.core.score.raw"]).toBe("100");
			expect(values["cmi.suspend_data"]).toBe(unreadable);
		} finally {
			dom.window.close();
		}
	},
);
it("keeps unsaved drafts scoped to the tab, course, learner and damaged original", () => {
	const { values, dom } = fixture();
	const draft = {
		version: 1,
		kind: "assessment",
		assessmentType: "textResponse",
		attemptCount: 0,
		checked: false,
		correct: false,
		completed: false,
		interacted: true,
		answer: "Wet floor by the door",
	};
	const provider = (course = "course") => {
		const runtime = new Scorm12Runtime(course);
		runtime.initialize();
		return createBlockStateRuntime(runtime);
	};
	try {
		const initial = provider();
		initial.set("open", draft);
		expect(initial.getSaveResult?.("open")).toEqual({
			status: "not-saved",
			code: "unreadable-state",
		});
		expect(provider().get("open")).toEqual(draft);
		initial.set("cleared", null);
		expect(provider().get("cleared")).toBeNull();
		expect(provider("other-course").get("open")).toBeUndefined();
		values["cmi.core.student_id"] = "other-learner";
		expect(provider().get("open")).toBeUndefined();
		values["cmi.core.student_id"] = "learner";
		values["cmi.suspend_data"] = `${unreadable} `;
		expect(provider().get("open")).toBeUndefined();
		values["cmi.suspend_data"] = unreadable;
		expect(provider().get("open")).toEqual(draft);
		values["cmi.suspend_data"] = "";
		const fresh = new Scorm12Runtime("course");
		fresh.initialize();
		expect(createBlockStateRuntime(fresh).get("open")).toBeUndefined();
		fresh.setCompletion("completed");
		fresh.setScore(80, 0, 100);
		fresh.commit();
		expect(values["cmi.core.lesson_status"]).toBe("completed");
		expect(values["cmi.core.score.raw"]).toBe("80");
	} finally {
		dom.window.close();
	}
});
it("keeps an editable unsaved receipt when tab recovery storage is blocked", () => {
	const { values, dom } = fixture();
	try {
		Object.defineProperty(dom.window, "sessionStorage", {
			get() {
				throw new DOMException("blocked", "SecurityError");
			},
		});
		const runtime = new Scorm12Runtime("course");
		runtime.initialize();
		const provider = createBlockStateRuntime(runtime);
		provider.set("open", { answer: "Wet floor by the door", checked: false });
		expect(provider.get("open")).toEqual({ answer: "Wet floor by the door", checked: false });
		expect(provider.getSaveResult?.("open")).toEqual({
			status: "not-saved",
			code: "unreadable-state",
		});
		expect(values["cmi.suspend_data"]).toBe(unreadable);
		expect(runtime.getInteractions()).toEqual([]);
	} finally {
		dom.window.close();
	}
});
