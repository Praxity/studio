import { navigatePage, navigatePageAction } from "@praxity/shared-blocks/viewer/navigate-page";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeScorm12Host } from "../../template/src/hosts/scorm12";
import { initializeScorm2004Host } from "../../template/src/hosts/scorm2004";
import type { SCORMRuntime } from "../scorm/types";

type Format = "scorm12" | "scorm2004";
const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
});

function launch(format: Format) {
	const calls: string[][] = [];
	const values: Record<string, string> = {};
	let commitSucceeds = true;
	const record = (name: string, ...args: string[]) => {
		calls.push([name, ...args]);
		return "true";
	};
	const get = (key: string) => {
		record("get", key);
		return values[key] ?? "";
	};
	const set = (key: string, value: string) => {
		record("set", key, value);
		values[key] = value;
		return "true";
	};
	const commit = () => {
		record("commit");
		return String(commitSucceeds);
	};
	const api =
		format === "scorm12"
			? {
					LMSInitialize: () => record("initialize"),
					LMSFinish: () => record("terminate"),
					LMSGetValue: get,
					LMSSetValue: set,
					LMSCommit: commit,
					LMSGetLastError: () => "0",
					LMSGetErrorString: () => "",
					LMSGetDiagnostic: () => "",
				}
			: {
					Initialize: () => record("initialize"),
					Terminate: () => record("terminate"),
					GetValue: get,
					SetValue: set,
					Commit: commit,
					GetLastError: () => "0",
					GetErrorString: () => "",
					GetDiagnostic: () => "",
				};
	const lms = { [format === "scorm12" ? "API" : "API_1484_11"]: api };
	const page = (role = "content") => {
		const config = {
			version: 1,
			courseId: "finish",
			pageId: "one",
			pageTitle: "One",
			currentPage: 1,
			totalPages: 2,
			currentSlug: "one",
			availableSlugs: ["one", "two"],
			pageIdMap: { one: "one", two: "two" },
			completionMethod: "allPages",
			pageRole: role,
			strings: {},
		};
		const dom = new JSDOM(
			`<script id="praxity-host-config" type="application/json">${JSON.stringify(config)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`,
			{ url: `https://course.example/${role === "content" ? "one" : role}.html` },
		);
		documents.push(dom);
		Object.defineProperty(dom.window, "parent", { value: lms });
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("document", dom.window.document);
		vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
		const started = format === "scorm12" ? initializeScorm12Host() : initializeScorm2004Host();
		const runtime = (dom.window as unknown as { __praxityRuntime: SCORMRuntime }).__praxityRuntime;
		return { dom, runtime, started };
	};
	return {
		calls,
		values,
		page,
		failCommit: () => {
			commitSucceeds = false;
		},
		allowCommit: () => {
			commitSucceeds = true;
		},
	};
}

const actionConfig = {
	currentPage: 1,
	currentSlug: "one",
	pages: [{ slug: "one" }, { slug: "two" }],
	pageIdMap: { one: "one", two: "two" },
};

describe.each(["scorm12", "scorm2004"] as const)("%s explicit finish host", (format) => {
	it("commits completion before terminating through authored End", () => {
		const launchState = launch(format);
		launchState.page();
		expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(true);
		expect(launchState.calls.slice(-2).map(([name]) => name)).toEqual(["commit", "terminate"]);
		expect(launchState.values[format === "scorm12" ? "cmi.core.exit" : "cmi.exit"]).toBe(
			format === "scorm12" ? "" : "normal",
		);
	});

	it.each(["button", "logic"])(
		"finishes through the %s End interface and makes no later LMS calls",
		(source) => {
			const { calls, values, page } = launch(format);
			const { dom } = page();
			const finish = () =>
				source === "button"
					? navigatePageAction("__end_lesson__", actionConfig)
					: navigatePage({ targetSlug: "two", direction: "forward", currentSlug: "one" });
			if (source === "logic")
				dom.window.__praxityLogicEngine = {
					evaluate: () => {},
					getJumpTarget: () => "__end_lesson__",
				};
			expect(finish()).toBe(true);
			expect(calls.filter(([name]) => name === "terminate")).toHaveLength(1);
			expect(calls.slice(-2).map(([name]) => name)).toEqual(["commit", "terminate"]);
			expect(values[format === "scorm12" ? "cmi.core.exit" : "cmi.exit"]).toBe(
				format === "scorm12" ? "" : "normal",
			);
			const finishedCalls = calls.length;
			expect(finish()).toBe(true);
			dom.window.dispatchEvent(new dom.window.Event("beforeunload"));
			dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pagehide"));
			expect(calls).toHaveLength(finishedCalls);
		},
	);

	it("keeps a failed final commit retryable through the authored action", () => {
		const { calls, page, failCommit, allowCommit } = launch(format);
		page();
		failCommit();
		expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(false);
		expect(calls.filter(([name]) => name === "terminate")).toHaveLength(0);
		allowCommit();
		expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(true);
		expect(calls.filter(([name]) => name === "terminate")).toHaveLength(1);
	});

	it("commits every pagehide and beforeunload without terminating", () => {
		const { calls, values, page } = launch(format);
		const { dom } = page();
		for (const persisted of [false, true]) {
			const commits = calls.filter(([name]) => name === "commit").length;
			dom.window.dispatchEvent(new dom.window.PageTransitionEvent("pagehide", { persisted }));
			expect(calls.filter(([name]) => name === "commit")).toHaveLength(commits + 1);
		}
		dom.window.dispatchEvent(new dom.window.Event("beforeunload"));
		expect(calls.filter(([name]) => name === "commit")).toHaveLength(3);
		expect(values[format === "scorm12" ? "cmi.core.exit" : "cmi.exit"]).toBe("suspend");
		expect(calls.filter(([name]) => name === "terminate")).toHaveLength(0);
	});

	it("lets a same-launch glossary commit without changing visits or bookmark", () => {
		const { calls, values, page } = launch(format);
		page();
		const bookmarkKey = format === "scorm12" ? "cmi.core.lesson_location" : "cmi.location";
		const bookmark = values[bookmarkKey];
		const saved = values["cmi.suspend_data"];
		const utility = page("glossary");
		expect(utility.started).toBe(true);
		utility.dom.window.dispatchEvent(new utility.dom.window.PageTransitionEvent("pagehide"));
		expect(calls.filter(([name]) => name === "commit")).toHaveLength(1);
		expect(values[bookmarkKey]).toBe(bookmark);
		expect(values["cmi.suspend_data"]).toBe(saved);
		expect(calls.filter(([name]) => name === "initialize")).toHaveLength(1);
		expect(calls.filter(([name]) => name === "terminate")).toHaveLength(0);
	});
});

it.each(["failed", "passed"] as const)("preserves SCORM 1.2 %s on explicit finish", (status) => {
	const { calls, values, page } = launch("scorm12");
	page().runtime.setCompletion(status);
	expect(navigatePageAction("__end_lesson__", actionConfig)).toBe(true);
	expect(values["cmi.core.lesson_status"]).toBe(status);
	expect(values["cmi.core.exit"]).toBe(status === "failed" ? "suspend" : "");
	expect(calls.filter(([name]) => name === "terminate")).toHaveLength(1);
});

it.each(["failed", "unknown", "passed"] as const)(
	"uses shared SCORM 2004 %s state on a resources page",
	(status) => {
		const { calls, values, page } = launch("scorm2004");
		const content = page();
		content.runtime.setCompletion("completed");
		content.runtime.setSuccess?.(status);
		const utility = page("resources");
		utility.dom.window.dispatchEvent(new utility.dom.window.Event("beforeunload"));
		expect(values["cmi.exit"]).toBe(status === "passed" ? "normal" : "suspend");
		utility.dom.window.dispatchEvent(new utility.dom.window.PageTransitionEvent("pagehide"));
		expect(calls.filter(([name]) => name === "commit")).toHaveLength(2);
	},
);
