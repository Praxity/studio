import { describe, expect, it, vi } from "vitest";
import {
	findScormApi,
	readScormEntry,
	resolveScormResumeTarget,
	type WindowLike,
} from "../src/scorm/api-discovery";

function selfParent<T extends WindowLike>(win: T): T {
	win.parent = win;
	return win;
}

describe("shared SCORM API discovery", () => {
	it("finds a SCORM 2004 API on the parent window", () => {
		const api = {
			GetValue: vi
				.fn()
				.mockImplementation((element: string) => (element === "cmi.entry" ? "resume" : "")),
		};
		const parent = selfParent({ API_1484_11: api } as WindowLike);
		const sco = { parent, opener: null } as WindowLike;

		const discovered = findScormApi(sco, "2004");

		expect(discovered).toEqual({ version: "2004", api });
		expect(discovered && readScormEntry(discovered)).toBe("resume");
		expect(api.GetValue).toHaveBeenCalledWith("cmi.entry");
	});

	it("returns no API when the SCO is not running in an LMS", () => {
		const standalone = selfParent({ opener: null });

		expect(findScormApi(standalone, "1.2")).toBeNull();
	});

	it.each(["1.2", "2004"] as const)("selects the package's %s API when both exist", (version) => {
		const api12 = { LMSGetValue: vi.fn().mockReturnValue("resume") };
		const api2004 = { GetValue: vi.fn().mockReturnValue("ab-initio") };
		const parent = selfParent({ API: api12, API_1484_11: api2004 });
		const discovered = findScormApi({ parent }, version);
		expect(discovered).toEqual({ version, api: version === "1.2" ? api12 : api2004 });
		expect(discovered && readScormEntry(discovered)).toBe(
			version === "1.2" ? "resume" : "ab-initio",
		);
		expect(version === "1.2" ? api2004.GetValue : api12.LMSGetValue).not.toHaveBeenCalled();
	});

	it.each(["1.2", "2004"] as const)(
		"does not substitute the other API for package %s",
		(version) => {
			const wrong = version === "1.2" ? { API_1484_11: {} } : { API: {} };
			expect(findScormApi({ parent: selfParent(wrong) }, version)).toBeNull();
		},
	);

	it.each(["1.2", "2004"] as const)("searches nested opener parents for package %s", (version) => {
		const api = {};
		const expectedName = version === "1.2" ? "API" : "API_1484_11";
		const wrongName = version === "1.2" ? "API_1484_11" : "API";
		const lms = selfParent({ [expectedName]: api });
		const sco = { [wrongName]: {}, parent: selfParent({}), opener: { parent: lms } };
		expect(findScormApi(sco, version)).toEqual({ version, api });
	});
});

describe("SCORM resume target resolution", () => {
	const slugs = ["welcome", "safety", "summary"];

	it("restores a recorded page that still exists", () => {
		expect(resolveScormResumeTarget("safety", "welcome", slugs)).toBe("safety");
	});

	it("does not redirect when the recorded page no longer exists", () => {
		expect(resolveScormResumeTarget("deleted-lesson", "welcome", slugs)).toBeNull();
	});

	it("does not redirect when the learner is already on the recorded page", () => {
		expect(resolveScormResumeTarget("welcome", "welcome", slugs)).toBeNull();
	});
});
