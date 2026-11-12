import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariableStore } from "../../shared-blocks/src/logic/variable-store";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";
import { createPrivateBlockStateRuntime } from "../template/src/hosts/private-block-state";

const windows: JSDOM[] = [];
afterEach(() => {
	for (const dom of windows.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function fixture(version: "1.2" | "2004") {
	const custom = {
		blockState: { journal: "saved answer" },
		deck: { released: ["gate"] },
		v: { count: 2 },
	};
	const original = JSON.stringify(
		version === "1.2"
			? { visitedPages: ["old-page"], interactions: [], custom: JSON.stringify(custom) }
			: { visitedPages: ["old-page"], ...custom },
	);
	const values: Record<string, string> = {
		"cmi.suspend_data": original,
		"cmi.completion_status": "incomplete",
		"cmi.core.lesson_status": "incomplete",
		"cmi.success_status": "unknown",
		"cmi.score.raw": "80",
		"cmi.core.score.raw": "80",
	};
	const writes: string[] = [];
	const events: string[] = [];
	let error: string | number = "0";
	let failure:
		| { code: string | number; raw: string; remaining: number; throws?: boolean }
		| undefined;
	const get = (key: string) => {
		error = "0";
		if (key === "cmi.suspend_data") {
			events.push("read");
			if (failure && --failure.remaining === 0) {
				const failed = failure;
				failure = undefined;
				if (failed.throws) throw new Error("LMS unavailable");
				error = failed.code;
				return failed.raw;
			}
		}
		return values[key] ?? "";
	};
	const lastError = () => {
		events.push("error");
		return error;
	};
	const set = (key: string, value: string) => {
		error = "0";
		writes.push(key);
		values[key] = value;
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
						LMSGetLastError: lastError,
						LMSGetErrorString: () => "General exception",
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
						GetLastError: lastError,
						GetErrorString: () => "General Get Failure",
						GetDiagnostic: () => "",
					},
				},
	);
	vi.stubGlobal("window", dom.window);
	const runtime =
		version === "1.2"
			? new Scorm12Runtime()
			: new Scorm2004Runtime(dom.window as unknown as WindowLike);
	expect(runtime.initialize()).toBe(true);
	writes.length = 0;
	return {
		runtime,
		values,
		writes,
		original,
		events,
		dom,
		fail(
			code: string | number = version === "1.2" ? "101" : "301",
			raw = "",
			remaining = 1,
			throws = false,
		) {
			failure = { code, raw, remaining, throws };
		},
	};
}
it("does not replace saved progress when the merge read fails then the guard read recovers", () => {
	let saved = JSON.stringify({
		visitedPages: ["old-page"],
		blockState: { journal: "saved answer" },
	});
	let error = "0";
	let failNext = false;
	const api = {
		Initialize: () => "true",
		Terminate: () => "true",
		Commit: () => "true",
		GetValue: (key: string) => {
			error = "0";
			if (key === "cmi.suspend_data") {
				if (failNext) {
					failNext = false;
					error = "301";
					return "";
				}
				return saved;
			}
			return key === "cmi.completion_status" ? "incomplete" : "";
		},
		SetValue: (key: string, value: string) => {
			error = "0";
			if (key === "cmi.suspend_data") saved = value;
			return "true";
		},
		GetLastError: () => error,
		GetErrorString: () => "General Get Failure",
		GetDiagnostic: () => "",
	};
	const win = { API_1484_11: api } as unknown as WindowLike;
	win.parent = win;
	const runtime = new Scorm2004Runtime(win);
	expect(runtime.initialize()).toBe(true);
	const original = saved;
	failNext = true;
	runtime.trackPageVisit("new-page");
	expect(saved).toBe(original);
});

for (const version of ["1.2", "2004"] as const)
	describe(`SCORM ${version} suspend read errors`, () => {
		it.each(["empty", "nonempty", "numeric", "thrown"])(
			"holds a %s failed page merge despite a later successful LMS read",
			(mode) => {
				const { runtime, fail, original, values, writes } = fixture(version);
				const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
				fail(
					mode === "numeric" ? (version === "1.2" ? 101 : 301) : version === "1.2" ? "101" : "301",
					mode === "nonempty" ? original : "",
					1,
					mode === "thrown",
				);
				expect(() => runtime.trackPageVisit("new-page")).not.toThrow();
				expect(values["cmi.suspend_data"]).toBe(original);
				expect(writes).toEqual([]);
				expect(runtime.getBlockSaveResult("journal")).toEqual({
					status: "not-saved",
					code: "unreadable-state",
				});
				// A subsequent host read could succeed, but this adapter must hold the refusal.
				expect(runtime.setSuspendData('{"replacement":true}')).toBe(false);
				runtime.setCompletion("passed");
				runtime.setScore(100, 0, 100);
				runtime.trackObjective("q", 100, true);
				expect(() => runtime.trackPageVisit("another-page")).not.toThrow();
				expect(runtime.commit()).toBe(true);
				expect(runtime.terminate(true)).toBe(true);
				expect(
					writes.filter(
						(key) =>
							key !== "cmi.exit" &&
							key !== "cmi.core.exit" &&
							key !== "cmi.session_time" &&
							key !== "cmi.core.session_time",
					),
				).toEqual([]);
				expect(values["cmi.suspend_data"]).toBe(original);
				expect(warn).toHaveBeenCalledTimes(1);
				expect(String(warn.mock.calls[0][0])).toContain(`SCORM ${version}`);
				expect(String(warn.mock.calls[0][0])).not.toContain("saved answer");
			},
		);
		it("keeps variables, journal and deck keys when the variable merge read fails", () => {
			const { runtime, fail, original, values, writes } = fixture(version);
			const store = new VariableStore([{ name: "count", dataType: "number" }], runtime);
			fail();
			expect(store.set("count", 3)).toBe(false);
			expect(values["cmi.suspend_data"]).toBe(original);
			expect(writes).toEqual([]);
		});
		it("holds a failed variable restoration read instead of permitting a later replacement", () => {
			const { runtime, fail, original, values, writes } = fixture(version);
			fail();
			const store = new VariableStore([{ name: "count", dataType: "number" }], runtime);
			expect(store.set("count", 3)).toBe(false);
			expect(values["cmi.suspend_data"]).toBe(original);
			expect(writes).toEqual([]);
		});
		it("retains saved block keys and an editable draft when a block-state merge read fails", () => {
			const { runtime, fail, original, values, writes, dom } = fixture(version);
			const blocks = createPrivateBlockStateRuntime(
				runtime,
				{
					version: 1,
					courseId: "course",
					pageId: "page",
					pageTitle: "Page",
					currentPage: 1,
					totalPages: 1,
					currentSlug: "index",
					availableSlugs: ["index"],
					pageIdMap: { index: "page" },
					completionMethod: "allPages",
					pageRole: "content",
					strings: {},
					blockStatePolicy: { "new-journal": "lms" },
				},
				dom.window as unknown as Window,
			);
			fail();
			blocks.set("new-journal", "new draft");
			expect(blocks.getSaveResult?.("new-journal")).toEqual({
				status: "not-saved",
				code: "unreadable-state",
			});
			expect(blocks.get("new-journal")).toBe("new draft");
			expect(values["cmi.suspend_data"]).toBe(original);
			expect(writes).toEqual([]);
		});
		it("classifies each successful suspend read before another LMS call can reset its error", () => {
			const { runtime, events } = fixture(version);
			runtime.getSuspendData();
			runtime.getVisitedPages();
			runtime.getInteractions();
			for (let i = 0; i < events.length; i++)
				if (events[i] === "read") expect(events[i + 1]).toBe("error");
		});
		it("allows a successful empty read to start and save a new attempt", () => {
			const { runtime, values, writes } = fixture(version);
			values["cmi.suspend_data"] = "";
			runtime.trackPageVisit("new-page");
			expect(JSON.parse(values["cmi.suspend_data"]).visitedPages).toEqual(["new-page"]);
			expect(writes).toContain("cmi.suspend_data");
		});
		it.each(["commit", "terminate"] as const)(
			"contains a failed read in %s while refusing progress outcomes",
			(method) => {
				const { runtime, fail, values, original, writes } = fixture(version);
				runtime.setCompletion("passed");
				writes.length = 0;
				fail();
				expect(() =>
					method === "commit" ? runtime.commit() : runtime.terminate(true),
				).not.toThrow();
				expect(runtime.terminate(true)).toBe(true);
				expect(values["cmi.suspend_data"]).toBe(original);
				expect(
					writes.filter(
						(key) =>
							key !== "cmi.exit" &&
							key !== "cmi.core.exit" &&
							key !== "cmi.session_time" &&
							key !== "cmi.core.session_time",
					),
				).toEqual([]);
			},
		);
	});
it("classifies the generic 2004 getValue suspend read before a later page merge", () => {
	const { runtime, fail, values, original, writes } = fixture("2004");
	fail();
	expect((runtime as Scorm2004Runtime).getValue("cmi.suspend_data")).toBe("");
	runtime.trackPageVisit("new-page");
	expect(values["cmi.suspend_data"]).toBe(original);
	expect(writes).toEqual([]);
});
it("holds an error on the second 2004 raw-read path during a variable merge", () => {
	const { runtime, fail, original, values, writes } = fixture("2004");
	const store = new VariableStore([{ name: "count", dataType: "number" }], runtime);
	fail("301", "", 2);
	expect(store.set("count", 3)).toBe(false);
	expect(values["cmi.suspend_data"]).toBe(original);
	expect(writes).toEqual([]);
});
it("treats 2004 error 403 as unset and allows a new save", () => {
	const { runtime, fail, values, writes } = fixture("2004");
	values["cmi.suspend_data"] = "";
	fail(403);
	runtime.trackPageVisit("new-page");
	expect(JSON.parse(values["cmi.suspend_data"]).visitedPages).toEqual(["new-page"]);
	expect(writes).toContain("cmi.suspend_data");
});
it("does not mistake SCORM 1.2 error 403 for a successful empty read", () => {
	const { runtime, fail, values, original, writes } = fixture("1.2");
	fail("403");
	runtime.trackPageVisit("new-page");
	expect(values["cmi.suspend_data"]).toBe(original);
	expect(writes).toEqual([]);
});
