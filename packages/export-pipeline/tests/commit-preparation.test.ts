import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariableStore } from "../../shared-blocks/src/logic/variable-store";
import { initAssessmentGroups } from "../../shared-blocks/src/viewer/assessment-group-runtime";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { resetSessionState } from "../src/scorm/api/session";
import { XapiRuntime, type XapiStatement } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import { CourseTracker } from "../src/scorm/tracking";
import type { SCORMRuntime } from "../src/scorm/types";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";
import { initDeck } from "../template/src/islands/island-deck";
import { selfCheckDocument } from "../template/src/self-check-document";

type Format = "scorm12" | "scorm2004";
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function launch(format: Format) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	const writes: string[][] = [];
	const values = new Map<string, string>([
		["cmi.core.lesson_status", "incomplete"],
		["cmi.completion_status", "incomplete"],
		["cmi.success_status", "unknown"],
	]);
	let commitSucceeds = true;
	let onCompletion: (() => void) | undefined;
	const status = format === "scorm12" ? "cmi.core.lesson_status" : "cmi.completion_status";
	const set = (key: string, value: string) => {
		writes.push([key, value]);
		values.set(key, value);
		if (key === status) onCompletion?.();
		return "true";
	};
	const commit = () => {
		writes.push(["commit"]);
		return String(commitSucceeds);
	};
	const terminate = () => {
		writes.push(["terminate"]);
		return "true";
	};
	const api =
		format === "scorm12"
			? {
					LMSInitialize: () => "true",
					LMSFinish: terminate,
					LMSCommit: commit,
					LMSGetValue: (key: string) => values.get(key) ?? "",
					LMSSetValue: set,
					LMSGetLastError: () => "0",
					LMSGetErrorString: () => "",
					LMSGetDiagnostic: () => "",
				}
			: {
					Initialize: () => "true",
					Terminate: terminate,
					Commit: commit,
					GetValue: (key: string) => values.get(key) ?? "",
					SetValue: set,
					GetLastError: () => "0",
					GetErrorString: () => "",
					GetDiagnostic: () => "",
				};
	const lms = { [format === "scorm12" ? "API" : "API_1484_11"]: api };
	const page = (withOwner = false) => {
		const config = {
			version: 1,
			courseId: "preparation",
			pageId: "one",
			pageTitle: "One",
			currentPage: 1,
			totalPages: 1,
			currentSlug: "one",
			availableSlugs: ["one"],
			pageIdMap: { one: "one" },
			completionMethod: "allPages",
			pageRole: "content",
			strings: {},
		};
		const dom = new JSDOM(
			`<main></main><script id="praxity-host-config" type="application/json">${JSON.stringify(config)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`,
			{
				url: "https://course.example/one.html",
				pretendToBeVisual: true,
			},
		);
		cleanups.push(() => dom.window.close());
		Object.defineProperty(dom.window, "parent", { value: lms });
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("document", dom.window.document);
		vi.stubGlobal("CSS", { escape: (value: string) => value });
		vi.stubGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
		vi.stubGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
		const win = dom.window as unknown as Window & typeof globalThis;
		if (withOwner) {
			vi.stubGlobal("Event", win.Event);
			vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "preparation");
			selfCheckDocument(win.document, true);
		}
		const runtime = format === "scorm12" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
		expect(
			initializeScormCourseHost(
				{ format, readEntry: () => null, createRuntime: () => runtime },
				{
					win,
					doc: win.document,
					location: { href: win.location.href, search: "", replace() {} },
					history: win.history,
				},
			),
		).toBe(true);
		return { dom, win, runtime };
	};
	return {
		page,
		writes,
		values,
		api,
		status,
		failCommit: () => {
			commitSucceeds = false;
		},
		allowCommit: () => {
			commitSucceeds = true;
		},
		onCompletion: (callback: () => void) => {
			onCompletion = callback;
		},
	};
}

const triggers = ["variable", "deck save", "pagehide", "beforeunload", "Finish"] as const;
function trigger(
	name: (typeof triggers)[number],
	win: Window & typeof globalThis,
	runtime: SCORMRuntime,
) {
	if (name === "variable") {
		new VariableStore([{ name: "flag", dataType: "boolean", defaultValue: false }], runtime).set(
			"flag",
			true,
		);
	} else if (name === "deck save") {
		runtime.setSuspendData(JSON.stringify({ deck: { released: ["gate"] } }));
		return runtime.commit();
	} else if (name === "Finish") return win.__praxityFinishCourse?.();
	else win.dispatchEvent(new win.Event(name));
}

function mountDeck(win: Window & typeof globalThis) {
	for (const key of [
		"HTMLElement",
		"Element",
		"Node",
		"Event",
		"CustomEvent",
		"AbortController",
		"localStorage",
		"sessionStorage",
		"location",
		"history",
	] as const)
		vi.stubGlobal(key, win[key]);
	vi.stubGlobal("getComputedStyle", win.getComputedStyle.bind(win));
	win.matchMedia = (media) =>
		Object.assign(new win.EventTarget(), {
			matches: false,
			media,
			onchange: null,
			addListener() {},
			removeListener() {},
		});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	win.HTMLElement.prototype.scrollIntoView = () => {};
	const pages = ["one", "two"].map((id) => ({
		id,
		title: id,
		slug: id,
		moduleSlug: "lesson",
		sequentialLessons: false,
		gates: [],
		stop: false,
		narrationSilent: true,
		segments: [],
	}));
	const config = win.document.createElement("script");
	config.id = "praxity-config";
	config.type = "application/json";
	config.textContent = JSON.stringify({
		courseId: "preparation",
		sourceLocale: "en",
		deckPages: pages,
	});
	win.document.body.append(config);
	const root = win.document.createElement("div");
	root.className = "praxity-deck";
	const controls = [
		"controls",
		"advance-status",
		"more-below",
		"script-scroll",
		"status",
		"follow",
		"advance",
		"resume-follow",
		"resume-follow-row",
		"follow-status",
		"position",
		"position-label",
		"more-position",
		"announcement",
		"narration",
		"more-playback",
		"sidebar-close",
		"script-title",
		"previous",
		"next",
		"sidebar",
		"script",
		"script-toggle",
		"outline-toggle",
		"outline-sidebar",
		"outline-close",
		"outline-title",
		"outline",
	];
	root.innerHTML = `<div class="deck-workspace"><main id="main-content"><div id="deck-slides">${pages.map((page) => `<article data-deck-slide="${page.id}">${page.title}</article>`).join("")}</div></main></div>${controls.map((id) => `<button id="deck-${id}">${id}</button>`).join("")}`;
	win.document.body.append(root);
	const cleanup = initDeck();
	expect(cleanup).toBeTypeOf("function");
	if (cleanup) cleanups.push(cleanup);
}

describe.each(["scorm12", "scorm2004"] as const)("%s commit preparation", (format) => {
	it("characterization preserves duplicate lifecycle commits and failed/reentrant Finish", () => {
		const lms = launch(format);
		const { win, runtime } = lms.page();
		for (const name of triggers.slice(0, -1)) trigger(name, win, runtime);
		lms.failCommit();
		const refused = win.__praxityFinishCourse?.();
		lms.allowCommit();
		const nested: unknown[] = [];
		lms.onCompletion(() => nested.push(win.__praxityFinishCourse?.()));
		const finished = win.__praxityFinishCourse?.();
		win.dispatchEvent(new win.Event("pagehide"));
		win.dispatchEvent(new win.Event("beforeunload"));
		expect({ refused, finished, nested, writes: lms.writes }).toMatchSnapshot();
	});

	it.each(triggers)("installed owner prepares before queued completion on %s", async (name) => {
		const lms = launch(format);
		const { win, runtime } = lms.page();
		win.document.querySelector("main")!.innerHTML = ["a", "b"]
			.map(
				(id) =>
					`<div class="praxity-block praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard"><p class="praxity-assessment-stem">Question ${id}</p><input type="radio" aria-label="Answer ${id}"><button data-assessment-submit="true">Submit</button></div>`,
			)
			.join("");
		const dispose = initAssessmentGroups({
			root: win.document.body,
			blocks: [
				{
					id: "g",
					type: "assessmentGroup",
					data: {
						mode: "oneOf",
						memberBlockIds: ["a", "b"],
						requireAll: true,
						showResultsSummary: true,
					},
				},
				...["a", "b"].map((id) => ({
					id,
					type: "assessment" as const,
					data: { gradingMode: "exact" as const },
				})),
			],
		});
		cleanups.push(dispose);
		await vi.waitFor(() =>
			expect(win.document.querySelector('input[name="ag-g"][value="b"]')).not.toBeNull(),
		);
		const picker = win.document.querySelector<HTMLInputElement>('input[name="ag-g"][value="b"]')!;
		expect(picker.disabled).toBe(false);
		picker.click();
		expect(win.__praxityBlockState?.get("g")).toMatchObject({ selectedMemberId: "b" });
		lms.writes.length = 0;
		// The installed tracker is the injection boundary, without activating evidence.
		Object.assign(win.__praxityTracker!, {
			prepareCommit: () => {
				lms.writes.push(["prepare"]);
			},
		});
		trigger(name, win, runtime);
		const prepared = lms.writes.findIndex(([key]) => key === "prepare");
		const flushed = lms.writes.findIndex(([key]) => key === lms.status);
		expect(prepared).toBeGreaterThanOrEqual(0);
		expect(flushed).toBeGreaterThan(prepared);
		expect(lms.writes.filter(([key]) => key === "prepare")).toEqual([["prepare"]]);
	});

	it("retained adapters use the next admitted owner and skip a revoked provider", () => {
		const lms = launch(format);
		const first = lms.page();
		const previous = vi.fn();
		Object.assign(first.win.__praxityTracker!, { prepareCommit: previous });
		const second = lms.page();
		const current = vi.fn();
		Object.assign(second.win.__praxityTracker!, { prepareCommit: current });
		first.runtime.commit();
		expect(previous).not.toHaveBeenCalled();
		expect(current).toHaveBeenCalledOnce();
		second.win.__praxityBlockState = { get: () => undefined, set() {} };
		first.runtime.commit();
		expect(current).toHaveBeenCalledOnce();
	});

	it("native deck navigation prepares its save before the queued completion", () => {
		const lms = launch(format);
		const { win, runtime } = lms.page();
		mountDeck(win);
		runtime.setCompletion("completed");
		lms.writes.length = 0;
		Object.assign(win.__praxityTracker!, {
			prepareCommit: () => {
				lms.writes.push(["prepare"]);
			},
		});
		win.document.getElementById("deck-next")!.click();
		expect(runtime.getBookmark()).toContain("two");
		const prepared = lms.writes.findIndex(([key]) => key === "prepare");
		expect(prepared).toBeGreaterThanOrEqual(0);
		expect(lms.writes.findIndex(([key]) => key === lms.status)).toBeGreaterThan(prepared);
	});

	it("runtime replacement revokes preparation without changing ordinary commits", () => {
		const lms = launch(format);
		const { win, runtime } = lms.page();
		const prepare = vi.fn();
		Object.assign(win.__praxityTracker!, { prepareCommit: prepare });
		runtime.commit();
		expect(prepare).toHaveBeenCalledOnce();
		Object.assign(win, { __praxityRuntime: new LocalStorageRuntime(win.localStorage) });
		expect(runtime.commit()).toBe(true);
		expect(prepare).toHaveBeenCalledOnce();
	});

	it("active launch reset clears preparation before a bare adapter adopts it", () => {
		const lms = launch(format);
		const { win, runtime } = lms.page();
		const prepare = vi.fn();
		runtime.setCommitPreparation?.(prepare);
		runtime.commit();
		expect(prepare).toHaveBeenCalledOnce();
		resetSessionState(lms.api, win);
		const next = format === "scorm12" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
		expect(() => next.setCommitPreparation?.(prepare)).not.toThrow();
		expect(next.initialize()).toBe(true);
		expect(next.commit()).toBe(true);
		expect(prepare).toHaveBeenCalledOnce();
	});

	it("readmission replaces preparation and pagehide revokes the captured lifetime", () => {
		const lms = launch(format);
		const { win, runtime } = lms.page(true);
		const old = vi.fn();
		Object.assign(win.__praxityTracker!, { prepareCommit: old });
		runtime.commit();
		expect(old).toHaveBeenCalledOnce();
		const owner = win.__praxitySelfCheckDocument!;
		owner.reset();
		const readmitted = vi.fn();
		Object.assign(win.__praxityTracker!, { prepareCommit: readmitted });
		runtime.commit();
		expect(readmitted).toHaveBeenCalledOnce();
		expect(old).toHaveBeenCalledOnce();
		win.dispatchEvent(new win.Event("pagehide"));
		runtime.commit();
		expect(readmitted).toHaveBeenCalledOnce();
		win.dispatchEvent(new win.PageTransitionEvent("pageshow", { persisted: true }));
		const returned = vi.fn();
		Object.assign(win.__praxityTracker!, { prepareCommit: returned });
		runtime.commit();
		expect(returned).toHaveBeenCalledOnce();
		owner.dispose();
	});

	it("preparation blocks reentry, resets after a throw and cannot reopen a closed launch", () => {
		const lms = launch(format);
		const first = lms.page();
		let calls = 0;
		const nested: boolean[] = [];
		first.runtime.setCommitPreparation?.(() => {
			if (++calls === 1) nested.push(first.runtime.commit(), first.runtime.terminate());
		});
		expect(first.runtime.commit()).toBe(true);
		expect(nested).toEqual([false, false]);
		expect(calls).toBe(1);
		first.runtime.setCommitPreparation?.(() => {
			throw new Error("preparation failed");
		});
		const before = [...lms.writes];
		expect(() => first.runtime.commit()).toThrow("preparation failed");
		expect(lms.writes).toEqual(before);
		first.runtime.setCommitPreparation?.(() => {
			calls++;
		});
		expect(first.runtime.terminate()).toBe(true);
		const closed = [...lms.writes];
		resetSessionState(lms.api, first.win);
		const second = lms.page();
		const current = vi.fn();
		second.runtime.setCommitPreparation?.(current);
		expect(first.runtime.terminate()).toBe(true);
		if (format === "scorm12") expect(() => first.runtime.commit()).toThrow("not initialized");
		else expect(first.runtime.commit()).toBe(false);
		expect(current).not.toHaveBeenCalled();
		expect(calls).toBe(2);
		expect(closed).toEqual(lms.writes.slice(0, closed.length));
	});
});

it("xAPI prepares before building and sending the termination result", () => {
	const dom = new JSDOM("", { url: "https://course.example/" });
	cleanups.push(() => dom.window.close());
	vi.stubGlobal("window", dom.window);
	const writes: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			const statement = JSON.parse(String(init?.body)) as XapiStatement;
			writes.push({ verb: statement.verb.id, result: statement.result });
			return new Response(null, { status: 200 });
		}),
	);
	const runtime = new XapiRuntime(
		{
			endpoint: "https://lrs.example/xapi/statements",
			auth: "",
			actorMode: "manual",
			actor: { name: "Learner", mbox: "mailto:learner@example.com" },
		},
		"course",
		dom.window.localStorage,
	);
	expect(runtime.initialize()).toBe(true);
	runtime.setCompletion("completed");
	runtime.setCommitPreparation?.(() => {
		writes.push("prepare");
		runtime.setCompletion("incomplete");
	});
	writes.length = 0;
	expect(runtime.terminate()).toBe(true);
	expect(writes).toEqual([
		"prepare",
		{ verb: "http://adlnet.gov/expapi/verbs/completed", result: { completion: false } },
	]);
});

it.each(["local", "xapi"] as const)(
	"%s prepares its real commit and termination boundary",
	(format) => {
		const dom = new JSDOM("", { url: "https://course.example/" });
		cleanups.push(() => dom.window.close());
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 200 })),
		);
		const runtime: SCORMRuntime =
			format === "local"
				? new LocalStorageRuntime(dom.window.localStorage)
				: new XapiRuntime(
						{
							endpoint: "",
							auth: "",
							actorMode: "manual",
							actor: { name: "Learner", mbox: "mailto:learner@example.com" },
						},
						"course",
						dom.window.localStorage,
					);
		const prepare = vi.fn();
		runtime.initialize();
		runtime.setCommitPreparation?.(prepare);
		expect(runtime.commit()).toBe(true);
		expect(prepare).toHaveBeenCalledOnce();
		expect(runtime.terminate()).toBe(true);
		expect(prepare).toHaveBeenCalledTimes(2);
		const nested: boolean[] = [];
		let calls = 0;
		runtime.initialize();
		runtime.setCommitPreparation?.(() => {
			if (++calls === 1) nested.push(runtime.commit(), runtime.terminate());
		});
		expect(runtime.commit()).toBe(true);
		expect(nested).toEqual([false, false]);
		expect(calls).toBe(1);
	},
);
