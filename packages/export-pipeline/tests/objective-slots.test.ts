import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";

afterEach(() => vi.unstubAllGlobals());

function lms(format: "scorm12" | "scorm2004") {
	const values = new Map<string, string>([["cmi.objectives._count", "0"]]);
	const writes: string[][] = [];
	const reads: string[] = [];
	const refusals: string[] = [];
	const unreadable = new Map<string, "error" | "throw" | "empty">();
	let error = "0";
	let refuseId = false;
	const get = (key: string) => {
		reads.push(key);
		error = "0";
		if (unreadable.get(key) === "throw") throw new Error("Unreadable objective");
		if (unreadable.has(key)) {
			error = unreadable.get(key) === "error" ? "401" : "0";
			return unreadable.get(key) === "error" ? (values.get(key) ?? "") : "";
		}
		return values.get(key) ?? "";
	};
	const set = (key: string, value: string) => {
		error = "0";
		if (key.startsWith("cmi.objectives.")) writes.push([key, value]);
		const match = /^cmi\.objectives\.(\d+)\.id$/.exec(key);
		if (match) {
			const index = Number(match[1]);
			const count = Number(values.get("cmi.objectives._count"));
			// Moodle scorm_13.js: duplicate ids and changing a saved id are refused.
			if (
				refuseId ||
				(format === "scorm2004" &&
					(Array.from({ length: count }, (_, n) => n).some(
						(n) => n !== index && values.get(`cmi.objectives.${n}.id`) === value,
					) ||
						(values.has(key) && values.get(key) !== value)))
			) {
				error = "351";
				refusals.push(error);
				return "false";
			}
			values.set("cmi.objectives._count", String(Math.max(count, index + 1)));
		}
		const field = /^cmi\.objectives\.(\d+)\.(score\.raw|success_status|status)$/.exec(key);
		if (field && !values.has(`cmi.objectives.${field[1]}.id`)) {
			error = "408";
			return "false";
		}
		values.set(key, value);
		return "true";
	};
	const open = () => {
		const api = {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: () => "true",
			LMSGetValue: get,
			LMSSetValue: set,
			LMSGetLastError: () => error,
			LMSGetErrorString: () => "Objective refused",
			LMSGetDiagnostic: () => "",
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: () => "true",
			GetValue: get,
			SetValue: set,
			GetLastError: () => error,
			GetErrorString: () => "Objective refused",
			GetDiagnostic: () => "",
		};
		const win: WindowLike = { API: api, API_1484_11: api, parent: null as unknown as WindowLike };
		win.parent = win;
		vi.stubGlobal("window", win);
		const runtime = format === "scorm12" ? new Scorm12Runtime() : new Scorm2004Runtime(win);
		expect(runtime.initialize()).toBe(true);
		return runtime;
	};
	const row = (n: number) => [
		values.get(`cmi.objectives.${n}.id`),
		values.get(`cmi.objectives.${n}.score.raw`),
		values.get(`cmi.objectives.${n}.${format === "scorm12" ? "status" : "success_status"}`),
	];
	return {
		set,
		reads,
		open,
		row,
		values,
		writes,
		refusals,
		unreadable,
		refuseId: (value: boolean) => {
			refuseId = value;
		},
	};
}

describe.each(["scorm12", "scorm2004"] as const)("%s objective slots", (format) => {
	it("updates the same group in its original slot within a session", () => {
		const host = lms(format);
		const runtime = host.open();
		runtime.trackObjective("g", 100, true);
		runtime.trackObjective("g", 0, false);
		expect(host.row(0)).toEqual(["g", "0", "failed"]);
		expect(host.values.get("cmi.objectives._count")).toBe("1");
		expect(host.refusals).toEqual([]);
	});

	it("appends a different group in session 2 without changing session 1's group", () => {
		const host = lms(format);
		const first = host.open();
		first.trackObjective("g", 100, true);
		expect(first.terminate()).toBe(true);
		host.open().trackObjective("h", 0, false);
		expect(host.row(0)).toEqual(["g", "100", "passed"]);
		expect(host.row(1)).toEqual(["h", "0", "failed"]);
		expect(host.refusals).toEqual([]);
	});

	it("resubmits a saved group by id in session 2, including a nonzero index", () => {
		const host = lms(format);
		const first = host.open();
		first.trackObjective("other", 75, true);
		first.trackObjective("g", 100, true);
		expect(first.terminate()).toBe(true);
		host.open().trackObjective("g", 0, false);
		expect(host.row(0)).toEqual(["other", "75", "passed"]);
		expect(host.row(1)).toEqual(["g", "0", "failed"]);
		expect(host.values.get("cmi.objectives._count")).toBe("2");
		expect(host.refusals).toEqual([]);
	});

	it("sees objectives appended through another document adapter", () => {
		const host = lms(format);
		const first = host.open();
		first.trackObjective("g", 100, true);
		const second = host.open();
		second.trackObjective("h", 75, true);
		first.trackObjective("i", 0, false);
		expect(host.row(0)).toEqual(["g", "100", "passed"]);
		expect(host.row(1)).toEqual(["h", "75", "passed"]);
		expect(host.row(2)).toEqual(["i", "0", "failed"]);
	});

	it.each(["cmi.objectives._count", "cmi.objectives.0.id"])(
		"skips writes when %s cannot be read and retries after recovery",
		(element) => {
			const host = lms(format);
			const first = host.open();
			first.trackObjective("g", 100, true);
			expect(first.terminate()).toBe(true);
			const second = host.open();
			for (const failure of ["empty", "error", "throw"] as const) {
				host.unreadable.set(element, failure);
				host.writes.length = 0;
				expect(() => second.trackObjective("h", 0, false)).not.toThrow();
				expect(host.writes).toEqual([]);
				expect(host.row(0)).toEqual(["g", "100", "passed"]);
			}
			host.unreadable.clear();
			second.trackObjective("h", 0, false);
			expect(host.row(1)).toEqual(["h", "0", "failed"]);
		},
	);

	it("resubmits a group from another document in the same session into its slot", () => {
		const host = lms(format);
		const first = host.open();
		first.trackObjective("g", 100, true);
		const second = host.open();
		second.trackObjective("g", 0, false);
		expect(host.row(0)).toEqual(["g", "0", "failed"]);
		expect(host.values.get("cmi.objectives._count")).toBe("1");
	});

	it.each(["-1", "1.5", "1tail", "1e1", "9007199254740992"])(
		"skips malformed or unsafe objective count %s",
		(count) => {
			const host = lms(format);
			const runtime = host.open();
			host.values.set("cmi.objectives._count", count);
			expect(() => runtime.trackObjective("g", 0, false)).not.toThrow();
			expect(host.writes).toEqual([]);
			expect(host.reads.filter((key) => key.startsWith("cmi.objectives."))).toEqual([
				"cmi.objectives._count",
			]);
		},
	);

	it("never writes a result after a refused id, and retries the same free slot", () => {
		const host = lms(format);
		const runtime = host.open();
		host.refuseId(true);
		expect(() => runtime.trackObjective("g", 0, false)).not.toThrow();
		expect(host.writes).toEqual([["cmi.objectives.0.id", "g"]]);
		host.refuseId(false);
		runtime.trackObjective("h", 100, true);
		expect(host.row(0)).toEqual(["h", "100", "passed"]);
		expect(host.values.get("cmi.objectives._count")).toBe("1");
	});
});

it("reuses the first saved SCORM 1.2 slot when older submissions left duplicate ids", () => {
	const host = lms("scorm12");
	host.values.set("cmi.objectives._count", "2");
	host.values.set("cmi.objectives.0.id", "g");
	host.values.set("cmi.objectives.1.id", "g");
	host.values.set("cmi.objectives.1.score.raw", "75");
	host.open().trackObjective("g", 0, false);
	expect(host.row(0)).toEqual(["g", "0", "failed"]);
	expect(host.values.get("cmi.objectives.1.score.raw")).toBe("75");
	expect(host.values.get("cmi.objectives._count")).toBe("2");
});

it("the 2004 fake refuses duplicate and changed ids with error 351", () => {
	const host = lms("scorm2004");
	expect(host.set("cmi.objectives.0.id", "g")).toBe("true");
	expect(host.set("cmi.objectives.1.id", "g")).toBe("false");
	expect(host.set("cmi.objectives.0.id", "h")).toBe("false");
	expect(host.refusals).toEqual(["351", "351"]);
	expect(host.values.get("cmi.objectives.0.id")).toBe("g");
	expect(host.values.get("cmi.objectives._count")).toBe("1");
});
