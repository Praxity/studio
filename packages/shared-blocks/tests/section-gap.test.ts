import { describe, expect, it } from "vitest";
import { sectionGapCssValue, sectionGapScale } from "../src/section-gap";

describe("sectionGap resolution", () => {
	it("treats pixel-era values as a scale against the historical 48px default", () => {
		expect(sectionGapScale(48)).toBe(1);
		expect(sectionGapScale(24)).toBe(0.5);
		expect(sectionGapScale(96)).toBe(2);
	});

	it("treats small values as multipliers already", () => {
		expect(sectionGapScale(1)).toBe(1);
		expect(sectionGapScale(1.5)).toBe(1.5);
	});

	it("clamps and falls back on malformed persisted data", () => {
		expect(sectionGapScale(1000)).toBe(2);
		expect(sectionGapScale(0)).toBe(0.5);
		expect(sectionGapScale(undefined)).toBe(1);
		expect(sectionGapScale("48")).toBe(1);
		expect(sectionGapScale(Number.NaN)).toBe(1);
	});

	it("emits a rhythm-token calc so preview and export cannot diverge", () => {
		expect(sectionGapCssValue(48)).toBe("calc(var(--praxity-space-section) * 1)");
	});
});
