// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeScorm12Host } from "../../template/src/hosts/scorm12";
import { initializeScorm2004Host } from "../../template/src/hosts/scorm2004";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";

const hostWindow = window as Window & {
	__praxityHostStarted?: string;
	__praxityRuntime?: unknown;
	__praxityTracker?: unknown;
	__praxityBlockState?: unknown;
};

afterEach(() => {
	document.body.innerHTML = "";
	delete hostWindow.__praxityHostStarted;
	delete hostWindow.__praxityRuntime;
	delete hostWindow.__praxityTracker;
	delete hostWindow.__praxityBlockState;
	delete window.__praxityResume;
	delete window.__praxityFinishCourse;
	window.localStorage.clear();
	vi.restoreAllMocks();
});

function prepareHost(format: "scorm12" | "scorm2004") {
	document.body.innerHTML = `<main><h1>Welcome</h1></main>
		<script id="praxity-host-config" type="application/json">${JSON.stringify({
			version: 1,
			courseId: "discovery-course",
			pageId: "page-welcome",
			pageTitle: "Welcome",
			currentPage: 1,
			totalPages: 2,
			currentSlug: "welcome",
			availableSlugs: ["welcome", "summary"],
			pageIdMap: { "page-welcome": "welcome", "page-summary": "summary" },
			completionMethod: "allPages",
			pageRole: "content",
			strings: {},
		})}</script>
		<script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
	vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
	return format === "scorm12" ? initializeScorm12Host : initializeScorm2004Host;
}

function lmsApi(version: "1.2" | "2004") {
	const data: Record<string, string> =
		version === "1.2"
			? {
					"cmi.core.entry": "resume",
					"cmi.core.lesson_location": "page-welcome",
					"cmi.core.lesson_status": "incomplete",
				}
			: {
					"cmi.entry": "resume",
					"cmi.location": "page-welcome",
					"cmi.completion_status": "incomplete",
					"cmi.success_status": "unknown",
				};
	const initialize = vi.fn().mockReturnValue("true");
	const getValue = vi.fn((element: string) => data[element] ?? "");
	const setValue = vi.fn((element: string, value: string) => {
		data[element] = value;
		return "true";
	});
	const prefix = version === "1.2" ? "LMS" : "";
	const api = {
		[`${prefix}Initialize`]: initialize,
		[`${prefix}GetValue`]: getValue,
		[`${prefix}SetValue`]: setValue,
		[`${prefix}Commit`]: vi.fn().mockReturnValue("true"),
		[`${prefix}GetLastError`]: vi.fn().mockReturnValue("0"),
	};
	return { api, initialize, getValue, setValue };
}

describe("package SCORM host discovery", () => {
	it.each(["scorm12", "scorm2004"] as const)(
		"initializes only %s when both parent APIs exist",
		(format) => {
			const initialize = prepareHost(format);
			const api12 = lmsApi("1.2");
			const api2004 = lmsApi("2004");
			const lms = { API: api12.api, API_1484_11: api2004.api };
			vi.spyOn(window, "parent", "get").mockReturnValue(lms as unknown as Window);
			expect(initialize()).toBe(true);
			const expected = format === "scorm12" ? api12 : api2004;
			const wrong = format === "scorm12" ? api2004 : api12;
			expect(expected.initialize).toHaveBeenCalledExactlyOnceWith("");
			expect(expected.getValue).toHaveBeenCalledWith(
				format === "scorm12" ? "cmi.core.entry" : "cmi.entry",
			);
			expect(wrong.initialize).not.toHaveBeenCalled();
			expect(wrong.getValue).not.toHaveBeenCalled();
			expect(wrong.setValue).not.toHaveBeenCalled();
			expect(window.__praxityResume).toEqual({ pageId: "page-welcome" });
		},
	);

	it.each(["scorm12", "scorm2004"] as const)(
		"uses local storage for %s when only the other API exists",
		(format) => {
			const initialize = prepareHost(format);
			const wrong = lmsApi(format === "scorm12" ? "2004" : "1.2");
			const lms = { [format === "scorm12" ? "API_1484_11" : "API"]: wrong.api };
			vi.spyOn(window, "parent", "get").mockReturnValue(lms as unknown as Window);
			expect(initialize()).toBe(true);
			expect(hostWindow.__praxityRuntime).toBeInstanceOf(LocalStorageRuntime);
			expect(wrong.initialize).not.toHaveBeenCalled();
			expect(wrong.getValue).not.toHaveBeenCalled();
			expect(wrong.setValue).not.toHaveBeenCalled();
			expect(window.__praxityResume).toBeUndefined();
		},
	);
});
