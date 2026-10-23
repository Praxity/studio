import { afterEach, describe, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime, type WindowLike } from "../src/scorm/api/scorm2004";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe.each(["1.2", "2004"] as const)("SCORM %s interaction indices", (version) => {
	it.each(["0", "101"])(
		"reuses a refused ID's index for later interactions and permits retry with error %s",
		(refusalError) => {
			const values = new Map<string, string>();
			let count = 0;
			let error = "0";
			let refused = false;
			const get = (key: string) =>
				key === "cmi.interactions._count" ? String(count) : (values.get(key) ?? "");
			const set = (key: string, value: string) => {
				error = "0";
				const row = /^cmi\.interactions\.(\d+)\.(.+)$/.exec(key);
				if (row) {
					const index = Number(row[1]);
					// Moodle rejects indices beyond the next row and fields without an ID.
					if (index > count || (row[2] !== "id" && !values.has(`cmi.interactions.${index}.id`))) {
						error = version === "2004" ? "351" : "101";
						return "false";
					}
					if (row[2] === "id") {
						if (value === "refused" && !refused) {
							refused = true;
							error = refusalError;
							return "false";
						}
						if (index === count) count++;
					}
				}
				values.set(key, value);
				return "true";
			};
			const api = {
				Initialize: () => "true",
				Terminate: () => "true",
				GetValue: get,
				SetValue: set,
				Commit: () => "true",
				GetLastError: () => error,
				GetErrorString: () => "Write refused",
				GetDiagnostic: () => "",
			};
			const win = {
				API_1484_11: api,
				API: {
					LMSInitialize: api.Initialize,
					LMSFinish: api.Terminate,
					LMSGetValue: get,
					LMSSetValue: set,
					LMSCommit: api.Commit,
					LMSGetLastError: api.GetLastError,
					LMSGetErrorString: api.GetErrorString,
					LMSGetDiagnostic: api.GetDiagnostic,
				},
				parent: null as unknown as WindowLike,
			};
			win.parent = win;
			vi.stubGlobal("window", win);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const runtime = version === "2004" ? new Scorm2004Runtime(win) : new Scorm12Runtime();
			expect(runtime.initialize()).toBe(true);

			runtime.trackInteraction("refused", "first-answer", true);
			expect(count).toBe(0);
			runtime.trackInteraction("second", "second-answer", true);
			runtime.trackInteraction("third", "third-answer", false);
			runtime.trackInteraction("refused", "retry-answer", true);

			const responseField = version === "2004" ? "learner_response" : "student_response";
			expect([0, 1, 2].map((index) => values.get(`cmi.interactions.${index}.id`))).toEqual([
				"second",
				"third",
				"refused",
			]);
			expect(
				[0, 1, 2].map((index) => values.get(`cmi.interactions.${index}.${responseField}`)),
			).toEqual(["second-answer", "third-answer", "retry-answer"]);
			expect(count).toBe(3);
		},
	);
});
