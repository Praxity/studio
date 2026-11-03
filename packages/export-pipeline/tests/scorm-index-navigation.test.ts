/** @vitest-environment jsdom */

import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { initializeCourseShell } from "../template/src/course-shell";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
});

function launch(format: "scorm12" | "scorm2004", frozen: boolean) {
	const log: string[][] = [];
	let defaults: Record<string, string> = {
		"cmi.core.lesson_status": "not attempted",
		"cmi.completion_status": "unknown",
		"cmi.interactions._count": "0",
	};
	let values: Record<string, string> = { ...defaults };
	let stored: Record<string, string> = {};
	let active = false;
	let error = "0";
	let readError: string | undefined;
	const initialize = () => {
		log.push(["initialize"]);
		// Moodle 1.2 replays committed interaction defaults onto a missing row object.
		if (format === "scorm12" && active && stored["cmi.interactions.0.id"]) {
			throw new TypeError("Cannot set properties of undefined (setting 'id')");
		}
		// Moodle rebuilds cmi even when rejecting an already initialized call.
		values = { ...defaults };
		error = active ? (format === "scorm12" ? "101" : "103") : "0";
		active = true;
		return String(error === "0");
	};
	const get = (key: string) => {
		log.push(["get", key]);
		error = readError ?? (active ? "0" : format === "scorm12" ? "301" : "122");
		return error === "0" ? (values[key] ?? "") : "";
	};
	const lastError = () => {
		log.push(["error", error]);
		return error;
	};
	const set = (key: string, value: string) => {
		log.push(["set", key, value]);
		values[key] = value;
		const interaction = /^cmi\.interactions\.(\d+)\.id$/.exec(key);
		if (interaction) values["cmi.interactions._count"] = String(Number(interaction[1]) + 1);
		error = "0";
		return "true";
	};
	const commit = () => {
		log.push(["commit"]);
		stored = { ...values };
		// Moodle 1.2 updates defaults when collecting data; 2004 keeps launch defaults.
		if (format === "scorm12") defaults = { ...values };
		return "true";
	};
	const terminate = () => {
		active = false;
		return "true";
	};
	const api =
		format === "scorm12"
			? {
					LMSInitialize: initialize,
					LMSGetValue: get,
					LMSGetLastError: lastError,
					LMSSetValue: set,
					LMSCommit: commit,
					LMSFinish: terminate,
					LMSGetErrorString: () => "",
					LMSGetDiagnostic: () => "",
				}
			: {
					Initialize: initialize,
					GetValue: get,
					GetLastError: lastError,
					SetValue: set,
					Commit: commit,
					Terminate: terminate,
					GetErrorString: () => "",
					GetDiagnostic: () => "",
				};
	if (frozen) Object.freeze(api);
	const lms = { [format === "scorm12" ? "API" : "API_1484_11"]: api };
	const document = (name: string, config: object, id: string) => {
		const dom = new JSDOM(
			`<script id="${id}" type="application/json">${JSON.stringify(config)}</script>`,
			{
				url: `https://course.example/${name}.html`,
			},
		);
		documents.push(dom);
		Object.defineProperty(dom.window, "parent", { value: lms });
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("document", dom.window.document);
		return dom;
	};
	return {
		log,
		stored: () => stored,
		newLaunch: () => {
			active = false;
		},
		readError: (code?: string) => {
			readError = code;
		},
		index: () => {
			const dom = document(
				"index",
				{
					version: 1,
					kind: "redirect",
					target: "one.html",
					pageIdMap: { one: "one", two: "two" },
				},
				"praxity-shell-config",
			);
			vi.stubGlobal("location", {
				href: dom.window.location.href,
				search: "",
				hash: "",
				replace: vi.fn(),
			});
			initializeCourseShell();
		},
		page: (name: "one" | "two") => {
			const dom = document(
				name,
				{
					version: 1,
					courseId: "index-navigation",
					pageId: name,
					pageTitle: name,
					currentPage: name === "one" ? 1 : 2,
					totalPages: 2,
					currentSlug: name,
					availableSlugs: ["one", "two"],
					pageIdMap: { one: "one", two: "two" },
					completionMethod: "allPages",
					pageRole: "content",
					strings: {},
				},
				"praxity-host-config",
			);
			const deployment = dom.window.document.createElement("script");
			deployment.id = "praxity-deployment-config";
			deployment.type = "application/json";
			deployment.textContent = JSON.stringify({ format });
			dom.window.document.body.append(deployment);
			const win = dom.window as unknown as Window;
			const ready = vi.fn();
			win.addEventListener("praxity:runtime-ready", ready);
			const runtime = format === "scorm12" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
			expect(
				initializeScormCourseHost(
					{ format, createRuntime: () => runtime, readEntry: () => null },
					{
						win,
						doc: dom.window.document,
						location: dom.window.location,
						history: dom.window.history,
					},
				),
			).toBe(true);
			expect(ready).toHaveBeenCalledOnce();
			return {
				runtime,
				state: win.__praxityBlockState,
				answer: () => {
					win.__praxityBlockState?.set(`answer-${name}`, { response: name });
					dom.window.document.dispatchEvent(
						new dom.window.CustomEvent("praxity:assessment-response", {
							detail: {
								blockId: `answer-${name}`,
								responseText: name,
								correct: true,
								score: 1,
								maxScore: 1,
							},
						}),
					);
				},
				exit: () => dom.window.dispatchEvent(new dom.window.Event("pagehide")),
			};
		},
	};
}

for (const format of ["scorm12", "scorm2004"] as const) {
	for (const frozen of [false, true]) {
		it(`${format} preserves both answers and block state across index, frozen=${frozen}`, () => {
			const lms = launch(format, frozen);
			const one = lms.page("one");
			one.answer();
			one.exit();
			const beforeIndex = lms.log.length;
			expect(() => lms.index()).not.toThrow();
			const indexCalls = lms.log.slice(beforeIndex);
			// The index redirects to page one before the learner reopens page two.
			lms.page("one").exit();
			const two = lms.page("two");
			expect(indexCalls).toEqual([
				["get", format === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status"],
				["error", "0"],
			]);
			expect(two.state?.get("answer-one")).toEqual({ response: "one" });
			const beforeAnswer = lms.log.length;
			two.answer();
			two.exit();
			const laterCalls = lms.log.slice(beforeIndex);
			expect(laterCalls.some(([call]) => call === "initialize")).toBe(false);
			expect(laterCalls).toContainEqual(["set", "cmi.interactions.1.id", "answer-two"]);
			expect(
				lms.log
					.slice(beforeAnswer)
					.some(([call, key]) => call === "set" && key === "cmi.suspend_data"),
			).toBe(true);
			expect(lms.log.slice(beforeAnswer)).toContainEqual(["commit"]);
			expect(lms.log.filter(([call]) => call === "initialize")).toHaveLength(1);
			const stored = lms.stored();
			expect(stored["cmi.interactions.0.id"]).toBe("answer-one");
			expect(stored["cmi.interactions.1.id"]).toBe("answer-two");
			expect(stored["cmi.suspend_data"]).toContain("answer-one");
			expect(stored["cmi.suspend_data"]).toContain("answer-two");
			const payload = JSON.parse(stored["cmi.suspend_data"]);
			const learner = format === "scorm12" ? JSON.parse(payload.custom) : payload;
			expect(learner.blockState).toMatchObject({
				"answer-one": { response: "one" },
				"answer-two": { response: "two" },
			});
		});
		it(`${format} probes a persistent API and initializes a genuine new launch, frozen=${frozen}`, () => {
			const lms = launch(format, frozen);
			lms.page("one").exit();
			lms.newLaunch();
			const before = lms.log.length;
			lms.index();
			expect(lms.log.slice(before)).toEqual([
				["get", format === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status"],
				["error", format === "scorm12" ? "301" : "122"],
			]);
			lms.page("two").exit();
			expect(lms.log.filter(([call]) => call === "initialize")).toHaveLength(2);
		});
		it(`${format} replaces a successfully closed launch without probing, frozen=${frozen}`, () => {
			const lms = launch(format, frozen);
			expect(lms.page("one").runtime.terminate(true)).toBe(true);
			const before = lms.log.length;
			lms.index();
			expect(lms.log).toHaveLength(before);
			lms.page("two").exit();
			expect(lms.log.filter(([call]) => call === "initialize")).toHaveLength(2);
		});
		it(`${format} keeps the session when a read fails for another reason, frozen=${frozen}`, () => {
			const lms = launch(format, frozen);
			lms.page("one").exit();
			lms.readError("101");
			lms.index();
			lms.readError();
			lms.page("two").exit();
			expect(lms.log.filter(([call]) => call === "initialize")).toHaveLength(1);
		});
	}
}
