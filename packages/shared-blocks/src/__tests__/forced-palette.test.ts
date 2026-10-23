import { afterEach, describe, expect, it, vi } from "vitest";
import { forcedPalette } from "../forced-palette";

afterEach(() => vi.unstubAllGlobals());

describe("forced palette", () => {
	it.each([
		[false, false, false],
		[false, true, false],
		[true, false, false],
		[true, true, true],
	])("query=%s, support=%s yields %s", (active, supported, expected) => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: query === "(forced-colors: active)" && active,
		}));
		vi.stubGlobal("CSS", {
			supports: (property: string, value: string) =>
				property === "forced-color-adjust" && value === "auto" && supported,
		});
		expect(forcedPalette()).toBe(expected);
	});

	it("does not force a palette without browser capability APIs", () => {
		vi.stubGlobal("matchMedia", undefined);
		vi.stubGlobal("CSS", undefined);
		expect(forcedPalette()).toBe(false);
	});

	it("does not force a palette without property support detection", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		vi.stubGlobal("CSS", undefined);
		expect(forcedPalette()).toBe(false);
		vi.stubGlobal("CSS", {});
		expect(forcedPalette()).toBe(false);
	});
});
