import { describe, expect, it } from "vitest";
import {
	checkContrastPairs,
	getContrastRatio,
	parseHex,
	relativeLuminanceFromHex,
} from "../contrast";

describe("parseHex", () => {
	it("parses 6-digit hex", () => {
		expect(parseHex("#ffffff")).toEqual([255, 255, 255]);
	});
	it("parses 3-digit hex", () => {
		expect(parseHex("#fff")).toEqual([255, 255, 255]);
	});
	it("returns null for incomplete hex", () => {
		expect(parseHex("#ff")).toBeNull();
		expect(parseHex("#f")).toBeNull();
		expect(parseHex("")).toBeNull();
	});
	it("parses without # prefix", () => {
		expect(parseHex("000000")).toEqual([0, 0, 0]);
	});
});

describe("getContrastRatio", () => {
	it("keeps short hex, optional hash and ignored eight-digit alpha", () => {
		expect(getContrastRatio("#000", "#fff")).toBe(21);
		expect(getContrastRatio("000000", "ffffff")).toBe(21);
		expect(getContrastRatio("#00000000", "#ffffff")).toBe(21);
		expect(getContrastRatio("#33669980", "#336699")).toBe(1);
	});

	it("keeps invalid input outcomes without tightening its parser", () => {
		expect(getContrastRatio("#ff", "#ffffff")).toBeNull();
		expect(relativeLuminanceFromHex("#ff")).toBe(0);
		expect(getContrastRatio("#ggg", "#fff")).toBeNaN();
		expect(relativeLuminanceFromHex("#ggg")).toBeNaN();
		expect(parseHex("#1g2h3i")).toEqual([1, 2, 3]);
	});

	it.each([
		["#0a0a0a", 0.003035269835488375],
		["#0b0b0b", 0.003346535763899161],
	] as const)("keeps the threshold-adjacent luminance for %s", (hex, expected) => {
		expect(relativeLuminanceFromHex(hex)).toBeCloseTo(expected, 15);
	});

	it("returns 21:1 for black on white", () => {
		const ratio = getContrastRatio("#000000", "#ffffff");
		expect(ratio).toBe(21);
	});
	it("returns 1:1 for same colors", () => {
		const ratio = getContrastRatio("#336699", "#336699");
		expect(ratio).toBe(1);
	});
	it("returns null for invalid hex input", () => {
		expect(getContrastRatio("#ff", "#ffffff")).toBeNull();
		expect(getContrastRatio("#ffffff", "#ff")).toBeNull();
	});
	it("is commutative", () => {
		const a = getContrastRatio("#336699", "#ffffff");
		const b = getContrastRatio("#ffffff", "#336699");
		expect(a).toEqual(b);
	});
});

describe("checkContrastPairs", () => {
	it("returns no warnings for high-contrast theme", () => {
		const warnings = checkContrastPairs({
			background: "#ffffff",
			text: "#000000",
			accent: "#0050a0",
			buttonBackground: "#000000",
			buttonText: "#ffffff",
			success: "#007000",
			error: "#cc0000",
			warning: "#805500",
		});
		expect(warnings).toHaveLength(0);
	});
	it("warns for low-contrast text on background", () => {
		const warnings = checkContrastPairs({
			background: "#ffffff",
			text: "#cccccc",
			accent: "#0050a0",
			buttonBackground: "#000000",
			buttonText: "#ffffff",
			success: "#007000",
			error: "#cc0000",
			warning: "#805500",
		});
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0].pair).toBe("text-on-background");
	});
	it("skips pairs with invalid colors", () => {
		const warnings = checkContrastPairs({
			background: "#ffffff",
			text: "#ff",
			accent: "#0050a0",
			buttonBackground: "#000000",
			buttonText: "#ffffff",
			success: "#007000",
			error: "#cc0000",
			warning: "#805500",
		});
		expect(Array.isArray(warnings)).toBe(true);
	});
	it("uses the 4.5:1 body-text threshold for every status colour", () => {
		const warnings = checkContrastPairs({
			background: "#ffffff",
			text: "#000000",
			accent: "#0050a0",
			buttonBackground: "#000000",
			buttonText: "#ffffff",
			success: "#777777",
			error: "#777777",
			warning: "#777777",
		});
		expect(warnings.map((warning) => warning.pair)).toEqual([
			"success-on-background",
			"warning-on-background",
			"error-on-background",
		]);
	});
});
