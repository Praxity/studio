import { describe, expect, it } from "vitest";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";

const truncated = '{"visitedPages":["p1"],"interactions":[],"custom":"saved answers';
function fixture(original = truncated, completion = "passed") {
	const values: Record<string, string> = {
		"cmi.suspend_data": original,
		"cmi.entry": "resume",
		"cmi.completion_status": completion,
		"cmi.success_status": "passed",
		"cmi.score.raw": "100",
	};
	const writes: string[] = [];
	const win = {
		parent: null,
		API_1484_11: {
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: () => "true",
			GetLastError: () => "0",
			GetErrorString: () => "",
			GetDiagnostic: () => "",
			GetValue: (key: string) => values[key] ?? "",
			SetValue: (key: string, value: string) => {
				writes.push(key);
				values[key] = value;
				return "true";
			},
		},
	} as unknown as WindowLike;
	win.parent = win;
	const runtime = new Scorm2004Runtime(win);
	expect(runtime.initialize()).toBe(true);
	return { runtime, values, writes };
}

describe("SCORM 2004 unreadable suspend data", () => {
	it("preserves truncated saved answers after a resumed page visit and interaction", () => {
		const { runtime, values, writes } = fixture();
		expect(runtime.getValue("cmi.entry")).toBe("resume");
		runtime.trackPageVisit("p2");
		expect(() => runtime.trackInteraction("q", "answer", true, 100)).toThrow("ESCORM2004STORAGE");
		expect(writes).toEqual([]);
		expect(values["cmi.suspend_data"]).toBe(truncated);
		expect(runtime.getBlockSaveResult("q")).toEqual({
			status: "not-saved",
			code: "unreadable-state",
		});
	});
	it("refuses both public replacement paths even before a tracking read", () => {
		const { runtime, values, writes } = fixture();
		expect(runtime.setSuspendData('{"replacement":true}')).toBe(false);
		expect(runtime.setValue("cmi.suspend_data", '{"replacement":true}')).toBe(false);
		expect(writes).toEqual([]);
		expect(values["cmi.suspend_data"]).toBe(truncated);
	});
	it.each([
		["completed", "completed"],
		["unknown", "incomplete"],
		["", "incomplete"],
	])(
		"refuses outcome reporting after prior completion %j through commit and explicit finish",
		(completion, expectedCompletion) => {
			const { runtime, values, writes } = fixture(truncated, completion);
			expect(writes).toEqual(completion === "completed" ? [] : ["cmi.completion_status"]);
			writes.length = 0;
			runtime.setCompletion("completed");
			runtime.setCompletion("failed");
			runtime.setSuccess("failed");
			runtime.setScore(0, 0, 100);
			runtime.trackObjective("q", 0, false);
			runtime.setBookmark("p2");
			expect(runtime.commit()).toBe(true);
			expect(runtime.terminate(true)).toBe(true);
			expect(
				writes.filter(
					(key) => key !== "cmi.location" && key !== "cmi.exit" && key !== "cmi.session_time",
				),
			).toEqual([]);
			expect(values["cmi.suspend_data"]).toBe(truncated);
			expect(values["cmi.completion_status"]).toBe(expectedCompletion);
			expect(values["cmi.success_status"]).toBe("passed");
			expect(values["cmi.score.raw"]).toBe("100");
		},
	);
	it("holds the parse failure even if the host later returns empty data", () => {
		const { runtime, values, writes } = fixture();
		runtime.getVisitedPages();
		values["cmi.suspend_data"] = "";
		runtime.trackPageVisit("p2");
		expect(runtime.setSuspendData("{}")).toBe(false);
		expect(writes).toEqual([]);
	});
	it.each(["", '{"visitedPages":["p1"],"interactions":[]}'])(
		"still saves readable state %j",
		(original) => {
			const { runtime, values, writes } = fixture(original, "incomplete");
			runtime.trackPageVisit("p2");
			runtime.trackInteraction("q", "answer", true, 100);
			expect(writes).toContain("cmi.suspend_data");
			expect(JSON.parse(values["cmi.suspend_data"]).visitedPages).toContain("p2");
			expect(runtime.getInteractions()[0].response).toBe("answer");
		},
	);
});
