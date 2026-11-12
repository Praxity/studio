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
function fixture(version: "1.2" | "2004", original: string) {
	const values: Record<string, string> = { "cmi.suspend_data": original };
	let error = "0";
	const get = vi.fn((key: string) => {
		const value = values[key] ?? "";
		error = version === "2004" && key === "cmi.suspend_data" && !value ? "403" : "0";
		return value;
	});
	const set = (key: string, value: string) => {
		values[key] = value;
		error = "0";
		return "true";
	};
	const dom = new JSDOM("", { url: "https://course.example/" });
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
	return { runtime, get };
}
it.each(["1.2", "2004"] as const)(
	"warns once with SCORM %s and damaged length, never learner content",
	(version) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const original = '{"answers":"private learner answer';
		const { runtime } = fixture(version, original);
		expect(runtime.initialize()).toBe(true);
		runtime.getVisitedPages();
		runtime.getBlockSaveResult("q");
		runtime.setScore(0, 0, 100);
		expect(warn).toHaveBeenCalledTimes(1);
		const message = String(warn.mock.calls[0][0]);
		expect(message).toContain(`SCORM ${version}`);
		expect(message).toContain(String(original.length));
		expect(message).toContain("unreadable");
		expect(message).not.toContain("private learner answer");
	},
);
it.each(["1.2", "2004"] as const)(
	"caches empty SCORM %s guard reads while explicit reads and successful saves stay current",
	(version) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { runtime, get } = fixture(version, "");
		runtime.getBlockSaveResult("q"); // A read before Initialize must not cache an unavailable LMS.
		expect(runtime.initialize()).toBe(true);
		for (let i = 0; i < 3; i++) {
			runtime.getBlockSaveResult("q");
			runtime.setCompletion("incomplete");
			runtime.setScore(0, 0, 100);
		}
		expect(get.mock.calls.filter(([key]) => key === "cmi.suspend_data")).toHaveLength(1);
		expect(warn).not.toHaveBeenCalled();
		expect(runtime.getVisitedPages()).toEqual([]);
		expect(runtime.getSuspendData()).toBeNull();
		expect(warn).not.toHaveBeenCalled();
		runtime.trackPageVisit("p1");
		expect(runtime.getVisitedPages()).toEqual(["p1"]);
		expect(runtime.setSuspendData('{"saved":true}')).toBe(true);
		expect(runtime.getSuspendData()).toBe('{"saved":true}');
	},
);
