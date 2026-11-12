import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { VariableStore } from "../../shared-blocks/src/logic/variable-store";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";

const definitions = [{ name: "label", dataType: "text" as const }];
afterEach(() => vi.unstubAllGlobals());
it("keeps all SCORM 1.2 keys and propagates storage-full when a variable cannot fit", () => {
	const values: Record<string, string> = { "cmi.core.lesson_status": "incomplete" };
	const dom = new JSDOM("", { url: "https://course.example/" });
	const writes: string[] = [];
	const commit = vi.fn(() => "true");
	Object.assign(dom.window, {
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: commit,
			LMSGetLastError: () => "0",
			LMSGetErrorString: () => "",
			LMSGetDiagnostic: () => "",
			LMSGetValue: (key: string) => values[key] ?? "",
			LMSSetValue: (key: string, value: string) => {
				values[key] = value;
				writes.push(key);
				return "true";
			},
		},
	});
	vi.stubGlobal("window", dom.window);
	try {
		const runtime = new Scorm12Runtime();
		expect(runtime.initialize()).toBe(true);
		runtime.trackPageVisit("p1");
		runtime.trackInteraction("q", "saved answer", true, 100);
		const custom = JSON.stringify({
			deck: { released: ["gate"] },
			answers: { q: "saved answer" },
			padding: "x".repeat(3400),
		});
		expect(runtime.setSuspendData(custom)).toBe(true);
		const original = values["cmi.suspend_data"];
		const store = new VariableStore(definitions, runtime);
		writes.length = 0;
		expect(store.set("label", "v".repeat(1000))).toBe(false);
		expect(values["cmi.suspend_data"]).toBe(original);
		expect(runtime.getSuspendData()).toBe(custom);
		expect(runtime.getVisitedPages()).toEqual(["p1"]);
		expect(runtime.getInteractions()[0].response).toBe("saved answer");
		expect(writes).toEqual([]);
		expect(commit).not.toHaveBeenCalled();
	} finally {
		dom.window.close();
	}
});
it("leaves unparseable SCORM 2004 bytes untouched and reports unreadable state on a variable write", () => {
	const original = '{"deck":{"released":["gate"]},"answers":';
	let saved = original;
	const write = vi.fn((key: string, value: string) => {
		if (key === "cmi.suspend_data") saved = value;
		return "true";
	});
	const commit = vi.fn(() => "true");
	const win = {
		parent: null,
		API_1484_11: {
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: commit,
			GetLastError: () => "0",
			GetErrorString: () => "",
			GetDiagnostic: () => "",
			GetValue: (key: string) => (key === "cmi.suspend_data" ? saved : ""),
			SetValue: write,
		},
	} as unknown as WindowLike;
	win.parent = win;
	const runtime = new Scorm2004Runtime(win);
	expect(runtime.initialize()).toBe(true);
	expect(write).toHaveBeenCalledExactlyOnceWith("cmi.completion_status", "incomplete");
	write.mockClear();
	const store = new VariableStore(definitions, runtime);
	expect(store.set("label", "new value")).toBe(false);
	expect(saved).toBe(original);
	expect(write).not.toHaveBeenCalled();
	expect(commit).not.toHaveBeenCalled();
	expect(runtime.getBlockSaveResult("q")).toEqual({
		status: "not-saved",
		code: "unreadable-state",
	});
});
it.each(["parse", "commit", "refused-write", "refused-commit"])(
	"never retries a %s failure with variables alone",
	(failure) => {
		const original =
			failure === "parse"
				? '{"answers":'
				: '{"answers":{"q":"saved"},"deck":{"released":["gate"]}}';
		let saved = original;
		const error = new Error("Commit refused");
		const write = vi.fn((value: string) => {
			if (failure === "refused-write") return false;
			saved = value;
			return true;
		});
		const commit = vi.fn(() => {
			if (failure === "commit") throw error;
			if (failure === "refused-commit") return false;
		});
		const store = new VariableStore(definitions, {
			getSuspendData: () => saved,
			setSuspendData: write,
			commit,
		});
		expect(store.set("label", "value")).toBe(false);
		expect(write).toHaveBeenCalledTimes(failure === "parse" ? 0 : 1);
		if (failure === "commit" || failure === "refused-commit") {
			expect(JSON.parse(saved)).toEqual({
				answers: { q: "saved" },
				deck: { released: ["gate"] },
				v: { label: "value" },
			});
		} else {
			expect(saved).toBe(original);
			expect(commit).not.toHaveBeenCalled();
		}
	},
);
