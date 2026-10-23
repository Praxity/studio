import { describe, expect, it } from "vitest";
import {
	colorToHex,
	contrastRatio,
	contrastRatioFromLuminances,
	ensureContrast,
	hexToOklab,
	hexToOklch,
	linearRgbLuminance,
	luminance,
	oklchToHex,
	srgbToLinear,
} from "./color-math";

function parseHexRgb(hex: string): [number, number, number] {
	return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) =>
		Number.parseInt(part, 16),
	) as [number, number, number];
}

describe("hexToOklab", () => {
	it("converts sRGB red to Cartesian OKLab coordinates", () => {
		const [L, a, b] = hexToOklab("#ff0000");
		expect(L).toBeCloseTo(0.627955, 5);
		expect(a).toBeCloseTo(0.224863, 5);
		expect(b).toBeCloseTo(0.125846, 5);
	});

	it("rejects malformed hex colours", () => {
		expect(() => hexToOklab("not a colour")).toThrow(TypeError);
	});
});

describe("hexToOklch", () => {
	it("converts white", () => {
		const [L, C] = hexToOklch("#ffffff");
		expect(L).toBeCloseTo(1, 2);
		expect(C).toBeCloseTo(0, 2);
	});

	it("converts black", () => {
		const [L] = hexToOklch("#000000");
		expect(L).toBeCloseTo(0, 2);
	});

	it("round-trips a color", () => {
		const original = "#4269d0";
		const [L, C, H] = hexToOklch(original);
		const roundTripped = oklchToHex(L, C, H);
		const [r1, g1, b1] = parseHexRgb(original);
		const [r2, g2, b2] = parseHexRgb(roundTripped);

		expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
		expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
		expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
	});
});

describe("colorToHex", () => {
	it.each([
		["#fff", "#ffffff"],
		["abc", "#aabbcc"],
		[" #AbC ", "#aabbcc"],
	])("expands opaque shorthand %s", (value, expected) => {
		expect(colorToHex(value)).toBe(expected);
	});
	it("accepts hex and opaque OKLCH author colours", () => {
		expect(colorToHex("#4269D0")).toBe("#4269d0");
		expect(colorToHex("oklch(54.8% 0.169 264.4)")).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("rejects malformed, translucent, and out-of-range OKLCH", () => {
		expect(colorToHex("oklch(nope)")).toBeNull();
		expect(colorToHex("oklch(55% 0.2 220 / 0.5)")).toBeNull();
		expect(colorToHex("oklch(120% 0.2 220)")).toBeNull();
	});
});

describe("luminance", () => {
	it.each(["#fff", "#00000000", "#ff", "#ggg"])("keeps strict hex admission for %s", (hex) => {
		expect(() => luminance(hex)).toThrow(TypeError);
		expect(() => contrastRatio(hex, "#ffffff")).toThrow(TypeError);
	});

	it("accepts whitespace and six digits without a hash", () => {
		expect(luminance(" FFFFFF ")).toBe(1);
		expect(contrastRatio("000000", "ffffff")).toBe(21);
	});

	it.each([
		["#0a0a0a", 0.003035269835488375],
		["#0b0b0b", 0.003346535763899161],
	] as const)("preserves luminance around the transfer threshold for %s", (hex, expected) => {
		expect(luminance(hex)).toBeCloseTo(expected, 15);
	});
	it("returns expected luminance bounds", () => {
		expect(luminance("#000000")).toBeCloseTo(0, 5);
		expect(luminance("#ffffff")).toBeCloseTo(1, 5);
	});
});

describe("contrastRatio", () => {
	it("white on white is 1:1", () => {
		expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
	});

	it("black on white is 21:1", () => {
		expect(contrastRatio("#000000", "#ffffff")).toBe(21);
	});

	it("#999999 on #ffffff is ~2.85:1", () => {
		const ratio = contrastRatio("#999999", "#ffffff");
		expect(ratio).toBeGreaterThan(2.8);
		expect(ratio).toBeLessThan(2.9);
	});
});

describe("numeric WCAG color math", () => {
	it.each([
		[0.04, 0.0030959752321981426],
		[0.04045, 0.0031308049535603713],
		[0.04046, 0.003131594552688991],
	])("linearizes the normalized channel %s", (channel, expected) => {
		expect(srgbToLinear(channel)).toBeCloseTo(expected, 15);
	});

	it("weights linear channels and computes luminance contrast", () => {
		expect(linearRgbLuminance(1, 0, 0)).toBe(0.2126);
		expect(linearRgbLuminance(0, 1, 0)).toBe(0.7152);
		expect(linearRgbLuminance(0, 0, 1)).toBe(0.0722);
		expect(contrastRatioFromLuminances(0, 1)).toBe(21);
		expect(contrastRatioFromLuminances(1, 0)).toBe(21);
		expect(contrastRatioFromLuminances(0.5, 0.5)).toBe(1);
	});
});

describe("ensureContrast", () => {
	it("returns original color when contrast already passes", () => {
		expect(ensureContrast("#333333", "#ffffff", 4.5)).toBe("#333333");
	});

	it("darkens a light-mode color to meet 4.5:1", () => {
		const adjusted = ensureContrast("#999999", "#ffffff", 4.5);
		expect(contrastRatio(adjusted, "#ffffff")).toBeGreaterThanOrEqual(4.5);
	});

	it("lightens a dark-mode color to meet 4.5:1", () => {
		const adjusted = ensureContrast("#666666", "#1e1e2e", 4.5);
		expect(contrastRatio(adjusted, "#1e1e2e")).toBeGreaterThanOrEqual(4.5);
	});

	it("preserves hue when adjusting", () => {
		const original = hexToOklch("#8a9199");
		const adjusted = ensureContrast("#8a9199", "#fafafa", 4.5);
		const adjustedOklch = hexToOklch(adjusted);
		expect(Math.abs(original[2] - adjustedOklch[2])).toBeLessThan(5);
	});
});

describe("contrast safeguards", () => {
	it("produces a color with >= 3:1 against light backgrounds", () => {
		const ring = ensureContrast("#4269d0", "#ffffff", 3);
		expect(contrastRatio(ring, "#ffffff")).toBeGreaterThanOrEqual(3);
	});

	it("produces a color with >= 3:1 against dark backgrounds", () => {
		const ring = ensureContrast("#6b8cff", "#1e1e2e", 3);
		expect(contrastRatio(ring, "#1e1e2e")).toBeGreaterThanOrEqual(3);
	});

	it("searches both directions when the nearest endpoint cannot pass", () => {
		const adjusted = ensureContrast("#101010", "#303030", 4.5);
		expect(contrastRatio(adjusted, "#303030")).toBeGreaterThanOrEqual(4.5);
	});
});
