import { describe, expect, it } from "vitest";
import {
	accentDriftIndicator,
	ensureContrast,
	findCompliantAccent,
	oklchToSrgb,
	srgbToOklch,
	srgbToWcagLuminance,
} from "../oklch";

describe("ensureContrast", () => {
	it("keeps short hex and rejects alpha and invalid theme colors", () => {
		expect(ensureContrast("#000", "#fff").wcagRatio).toBe(21);
		for (const color of ["#00000000", "#0000", "000000", "#ggg", "#ff"]) {
			expect(srgbToWcagLuminance(color)).toBeNull();
			expect(ensureContrast(color, "#fff")).toEqual({
				wcagRatio: 0,
				apcaLc: 0,
				passesBody: false,
				passesLarge: false,
				passesUI: false,
			});
		}
	});

	it.each([
		["#0a0a0a", 0.003035269835488375],
		["#0b0b0b", 0.003346535763899161],
	] as const)("keeps the threshold-adjacent theme luminance for %s", (hex, expected) => {
		expect(srgbToWcagLuminance(hex)).toBeCloseTo(expected, 15);
	});

	it("fails identical colors and passes black on white", () => {
		const whiteOnWhite = ensureContrast("#ffffff", "#ffffff");
		expect(whiteOnWhite.wcagRatio).toBe(1);
		expect(whiteOnWhite.apcaLc).toBe(0);
		expect(whiteOnWhite.passesBody).toBe(false);
		expect(whiteOnWhite.passesLarge).toBe(false);
		expect(whiteOnWhite.passesUI).toBe(false);

		const blackOnWhite = ensureContrast("#000000", "#ffffff");
		expect(blackOnWhite.wcagRatio).toBe(21);
		expect(blackOnWhite.apcaLc).toBeCloseTo(106.04, 2);
		expect(blackOnWhite.passesBody).toBe(true);
		expect(blackOnWhite.passesLarge).toBe(true);
		expect(blackOnWhite.passesUI).toBe(true);
	});

	it("keeps the threshold matrix split between body and large/UI text", () => {
		const mutedGray = ensureContrast("#767676", "#ffffff");

		expect(mutedGray.wcagRatio).toBeGreaterThanOrEqual(4.5);
		expect(Math.abs(mutedGray.apcaLc)).toBeLessThan(75);
		expect(mutedGray.passesBody).toBe(false);
		expect(mutedGray.passesLarge).toBe(true);
		expect(mutedGray.passesUI).toBe(true);
	});

	it("preserves APCA polarity while WCAG stays symmetric", () => {
		const darkTextOnLight = ensureContrast("#111111", "#ffffff");
		const lightTextOnDark = ensureContrast("#ffffff", "#111111");

		expect(darkTextOnLight.wcagRatio).toBeCloseTo(lightTextOnDark.wcagRatio, 10);
		expect(darkTextOnLight.apcaLc).toBeGreaterThan(0);
		expect(lightTextOnDark.apcaLc).toBeLessThan(0);
		expect(
			Math.abs(Math.abs(darkTextOnLight.apcaLc) - Math.abs(lightTextOnDark.apcaLc)),
		).toBeGreaterThan(1);
	});
});

describe("findCompliantAccent", () => {
	it("finds body-compliant hard hues on white backgrounds", () => {
		for (const hue of [95, 200]) {
			const accent = findCompliantAccent(hue, "#ffffff");
			const contrast = ensureContrast(accent, "#ffffff");
			const adjusted = srgbToOklch(accent);

			expect(contrast.passesBody).toBe(true);
			expect(adjusted.l).toBeGreaterThan(0.45);
			expect(adjusted.l).toBeLessThan(0.5);
		}
	});

	it("reduces chroma when lightness-only search cannot satisfy body contrast", () => {
		const background = "#3ae3c4";
		const original = oklchToSrgb(0.48, 0.16, 0);
		const adjusted = findCompliantAccent(0, background);
		const adjustedOklch = srgbToOklch(adjusted);
		const contrast = ensureContrast(adjusted, background);

		expect(ensureContrast(original, background).passesBody).toBe(false);
		expect(contrast.passesBody).toBe(true);
		expect(adjustedOklch.c).toBeLessThan(0.07);
		expect(adjustedOklch.l).toBeLessThan(0.25);
		expect(accentDriftIndicator(original, adjusted)).toBeGreaterThan(0.2);
	});
});

describe("accentDriftIndicator", () => {
	it("returns delta-L for identical and adjusted colors", () => {
		const accent = oklchToSrgb(0.48, 0.16, 220);
		expect(accentDriftIndicator(accent, accent)).toBe(0);
		expect(accentDriftIndicator(accent, findCompliantAccent(0, "#3ae3c4"))).toBeGreaterThan(0.2);
	});
});
