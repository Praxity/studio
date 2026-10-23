import { describe, expect, it } from "vitest";
import { getContrastRatio } from "../../a11y/contrast";
import { ensureContrast, srgbToOklch } from "../oklch";
import { deriveSectionPalettes } from "../resolve-theme";

function expectBodyDualCompliance(fg: string, bg: string): void {
	const contrast = ensureContrast(fg, bg);
	expect(contrast.wcagRatio).toBeGreaterThanOrEqual(4.5);
	expect(Math.abs(contrast.apcaLc)).toBeGreaterThanOrEqual(75);
}

function expectMutedDualCompliance(fg: string, bg: string): void {
	const contrast = ensureContrast(fg, bg);
	expect(contrast.wcagRatio).toBeGreaterThanOrEqual(4.5);
	expect(Math.abs(contrast.apcaLc)).toBeGreaterThanOrEqual(60);
}

function expectEdgeCaseTextCompliance(fg: string, bg: string): void {
	const contrast = ensureContrast(fg, bg);
	expect(contrast.wcagRatio).toBeGreaterThanOrEqual(4.5);
	expect(Math.abs(contrast.apcaLc)).toBeGreaterThanOrEqual(45);
}

describe("deriveSectionPalettes", () => {
	it("derives light, dark, and accent palettes from default theme colors", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		expect(palettes.light).toBeDefined();
		expect(palettes.dark).toBeDefined();
		expect(palettes.accent).toBeDefined();
	});

	it("light palette uses the theme background", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		expect(palettes.light.background).toBe("#faf9f7");
		expect(palettes.light.text).toBe("#1e293b");
	});

	it("dark palette text meets WCAG 4.5:1 contrast against dark background", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		const ratio = getContrastRatio(palettes.dark.text, palettes.dark.background);
		expect(ratio).not.toBeNull();
		if (ratio === null) throw new Error("Expected a contrast ratio for dark palette");
		expect(ratio).toBeGreaterThanOrEqual(4.5);
		expectBodyDualCompliance(palettes.dark.text, palettes.dark.background);
	});

	it("accent palette text meets WCAG 4.5:1 contrast against accent background", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		const ratio = getContrastRatio(palettes.accent.text, palettes.accent.background);
		expect(ratio).not.toBeNull();
		if (ratio === null) throw new Error("Expected a contrast ratio for accent palette");
		expect(ratio).toBeGreaterThanOrEqual(4.5);
		expectBodyDualCompliance(palettes.accent.text, palettes.accent.background);
	});

	it("accepts manual overrides for advanced colors", () => {
		const palettes = deriveSectionPalettes({
			background: "#ffffff",
			text: "#000000",
			accent: "#ff0000",
			sectionDarkBackground: "#1a1a2e",
			sectionAccentBackground: "#cc0000",
			accentOnDark: "#ff6666",
		});

		expect(palettes.dark.background).toBe("#1a1a2e");
		expect(palettes.accent.background).toBe("#cc0000");
		expect(palettes.accent.accent).toBe("#ff6666");
	});

	it("keeps warm hues when deriving dark sections from warm backgrounds", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf7f2",
			text: "#2d1810",
			accent: "#8b4513",
		});

		const dark = srgbToOklch(palettes.dark.background);
		expect(dark.c).toBeGreaterThan(0.02);
		expect(palettes.dark.background).not.toBe("#404040");
	});

	it("derives warm, cool, and growth palettes", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		expect(palettes.warm).toBeDefined();
		expect(palettes.cool).toBeDefined();
		expect(palettes.growth).toBeDefined();
	});

	it("warm palette text meets WCAG 4.5:1 contrast", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		const ratio = getContrastRatio(palettes.warm.text, palettes.warm.background);
		expect(ratio).not.toBeNull();
		if (ratio === null) throw new Error("Expected a contrast ratio for warm palette");
		expect(ratio).toBeGreaterThanOrEqual(4.5);
		expectBodyDualCompliance(palettes.warm.text, palettes.warm.background);
	});

	it("cool palette text meets WCAG 4.5:1 contrast", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		const ratio = getContrastRatio(palettes.cool.text, palettes.cool.background);
		expect(ratio).not.toBeNull();
		if (ratio === null) throw new Error("Expected a contrast ratio for cool palette");
		expect(ratio).toBeGreaterThanOrEqual(4.5);
		expectBodyDualCompliance(palettes.cool.text, palettes.cool.background);
	});

	it("growth palette text meets WCAG 4.5:1 contrast", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		const ratio = getContrastRatio(palettes.growth.text, palettes.growth.background);
		expect(ratio).not.toBeNull();
		if (ratio === null) throw new Error("Expected a contrast ratio for growth palette");
		expect(ratio).toBeGreaterThanOrEqual(4.5);
		expectBodyDualCompliance(palettes.growth.text, palettes.growth.background);
	});

	it("muted text variants remain APCA/WCAG compliant", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		for (const key of ["light", "dark", "accent", "warm", "cool", "growth"] as const) {
			const palette = palettes[key];
			expectMutedDualCompliance(palette.textLight, palette.background);
		}
	});

	it("edge-case backgrounds keep section text stable and compliant", () => {
		const cases = [
			{ background: "#fefce8", text: "#1f2937", accent: "#b45309" },
			{ background: "#0b1020", text: "#f8fafc", accent: "#22d3ee" },
			{ background: "#ff6b6b", text: "#111827", accent: "#2563eb" },
		];

		for (const edgeCase of cases) {
			const palettes = deriveSectionPalettes(edgeCase);
			for (const key of ["light", "dark", "accent", "warm", "cool", "growth"] as const) {
				expectEdgeCaseTextCompliance(palettes[key].text, palettes[key].background);
			}
		}
	});

	it("each mood palette has all required fields", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		for (const key of ["warm", "cool", "growth"] as const) {
			const palette = palettes[key];
			expect(palette.background).toBeTruthy();
			expect(palette.surface).toBeTruthy();
			expect(palette.text).toBeTruthy();
			expect(palette.textLight).toBeTruthy();
			expect(palette.accent).toBeTruthy();
			expect(palette.border).toBeTruthy();
		}
	});

	it("derives a lifted surface for dark section backgrounds", () => {
		const palettes = deriveSectionPalettes({
			background: "#0f172a",
			text: "#f1f5f9",
			accent: "#3b82f6",
		});

		const darkBg = srgbToOklch(palettes.dark.background);
		const darkSurface = srgbToOklch(palettes.dark.surface);
		expect(darkSurface.l).toBeGreaterThan(darkBg.l);
	});

	it("each palette has all required fields", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		for (const key of ["light", "dark", "accent"] as const) {
			const palette = palettes[key];
			expect(palette.background).toBeTruthy();
			expect(palette.surface).toBeTruthy();
			expect(palette.text).toBeTruthy();
			expect(palette.textLight).toBeTruthy();
			expect(palette.accent).toBeTruthy();
			expect(palette.border).toBeTruthy();
		}
	});
});
