import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";

const windows: JSDOM[] = [];
afterEach(() => {
	for (const dom of windows.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// Moodle-style getters reset the error on each call. Unset 2004 data also permits 403.
function host(version: "1.2" | "2004", unset: "0" | "403", original = "", failFirstRead = false) {
	const statusKey = version === "1.2" ? "cmi.core.lesson_status" : "cmi.completion_status";
	const values: Record<string, string> = {
		[statusKey]: version === "1.2" ? "not attempted" : "unknown",
		"cmi.suspend_data": original,
	};
	const writes: [string, string][] = [];
	let error = "0";
	let fail = failFirstRead;
	const get = (key: string) => {
		error = "0";
		if (key === "cmi.suspend_data") {
			if (fail) {
				fail = false;
				error = version === "1.2" ? "101" : "301";
				return "";
			}
			if (!values[key]) error = unset;
		}
		return values[key] ?? "";
	};
	const set = (key: string, value: string) => {
		error = "0";
		writes.push([key, value]);
		values[key] = value;
		return "true";
	};
	const dom = new JSDOM("", { url: "https://lms.example/" });
	windows.push(dom);
	Object.assign(
		dom.window,
		version === "1.2"
			? {
					API: {
						LMSInitialize: () => "true",
						LMSFinish: () => "true",
						LMSCommit: () => "true",
						LMSGetValue: get,
						LMSSetValue: set,
						LMSGetLastError: () => error,
						LMSGetErrorString: () => "",
						LMSGetDiagnostic: () => "",
					},
				}
			: {
					API_1484_11: {
						Initialize: () => "true",
						Terminate: () => "true",
						Commit: () => "true",
						GetValue: get,
						SetValue: set,
						GetLastError: () => error,
						GetErrorString: () => "",
						GetDiagnostic: () => "",
					},
				},
	);
	vi.stubGlobal("window", dom.window);
	const runtime =
		version === "1.2"
			? new Scorm12Runtime()
			: new Scorm2004Runtime(dom.window as unknown as WindowLike);
	return { runtime, values, writes, statusKey };
}
for (const version of ["1.2", "2004"] as const) {
	it.each(["parse", "read"])(
		`keeps unreadable SCORM ${version} launch incomplete after a %s failure and Finish`,
		(cause) => {
			const original =
				cause === "parse" ? '{"journal":' : '{"visitedPages":["old-page"],"interactions":[]}';
			const { runtime, values, writes, statusKey } = host(version, "0", original, cause === "read");
			expect(runtime.initialize()).toBe(true);
			expect(writes).toEqual([[statusKey, "incomplete"]]);
			runtime.setScore(90, 0, 100);
			runtime.setCompletion("passed");
			runtime.setCompletion("completed");
			runtime.trackPageVisit("new-page");
			expect(runtime.getBlockSaveResult("journal")).toEqual({
				status: "not-saved",
				code: "unreadable-state",
			});
			expect(runtime.commit()).toBe(true);
			expect(runtime.terminate(true)).toBe(true);
			expect(writes.filter(([key]) => key === statusKey)).toEqual([[statusKey, "incomplete"]]);
			expect(
				writes.filter(
					([key]) =>
						key.startsWith("cmi.core.score.") ||
						key.startsWith("cmi.score.") ||
						key === "cmi.success_status" ||
						key === "cmi.suspend_data",
				),
			).toEqual([]);
			expect(values[statusKey]).toBe("incomplete");
			expect(values["cmi.suspend_data"]).toBe(original);
		},
	);
}
// Retained review probe: an actual empty first launch must still report outcomes.
for (const [version, unset] of [
	["1.2", "0"],
	["2004", "403"],
	["2004", "0"],
] as const) {
	it(`first launch ${version} (unset ${unset}) reports score and completion without warnings`, () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { runtime, values, writes } = host(version, unset);
		expect(runtime.initialize()).toBe(true);
		runtime.trackPageVisit("p1");
		runtime.setScore(90, 0, 100);
		runtime.setCompletion("passed");
		expect(runtime.getBlockSaveResult("q")).toBeUndefined();
		expect(runtime.commit()).toBe(true);
		expect(runtime.terminate(true)).toBe(true);
		expect(JSON.parse(values["cmi.suspend_data"]).visitedPages).toEqual(["p1"]);
		expect(writes).toContainEqual([
			version === "1.2" ? "cmi.core.score.raw" : "cmi.score.raw",
			"90",
		]);
		expect(values[version === "1.2" ? "cmi.core.lesson_status" : "cmi.success_status"]).toBe(
			"passed",
		);
		if (version === "2004") expect(values["cmi.completion_status"]).toBe("completed");
		expect(warn).not.toHaveBeenCalled();
	});
}
