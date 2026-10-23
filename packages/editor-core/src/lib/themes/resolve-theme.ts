import type { SectionPaletteName } from "@praxity/shared-blocks/constants";
import { getContrastRatio as contrastRatio, relativeLuminanceFromHex } from "../a11y/contrast";
import { ensureContrast, gamutClipOklch, oklchToSrgb, srgbToOklch } from "./oklch";

export interface SectionPalette {
	background: string;
	surface: string;
	text: string;
	textLight: string;
	accent: string;
	border: string;
}

export type SectionPalettes = Record<SectionPaletteName, SectionPalette>;

/**
 * Derive section palette colors from a theme's base colors.
 *
 * Each palette is a set of CSS custom properties that override the theme
 * defaults within a <section> element. Text colors are auto-derived to meet
 * WCAG 2.x 4.5:1 contrast ratio against the section background.
 */
export function deriveSectionPalettes(opts: {
	background: string;
	text: string;
	accent: string;
	sectionDarkBackground?: string;
	sectionAccentBackground?: string;
	accentOnDark?: string;
}): SectionPalettes {
	const { background, text, accent } = opts;

	const light: SectionPalette = {
		background,
		surface: deriveSectionSurface(background),
		text,
		textLight: deriveSectionTextLight(text, background),
		accent,
		border: deriveSectionBorderColor(text, background),
	};

	const darkBackground =
		opts.sectionDarkBackground ?? deriveSectionBackgroundOklch(background, "dark", accent);
	const darkText = deriveSectionTextColor(darkBackground, text);
	const dark: SectionPalette = {
		background: darkBackground,
		surface: deriveSectionSurface(darkBackground),
		text: darkText,
		textLight: deriveSectionTextLight(darkText, darkBackground),
		accent: opts.accentOnDark ?? deriveAccentForBackground(accent, darkBackground),
		border: deriveSectionBorderColor(darkText, darkBackground),
	};

	const accentBackground = opts.sectionAccentBackground ?? accent;
	const accentText = deriveSectionTextColor(accentBackground, text);
	const accentPalette: SectionPalette = {
		background: accentBackground,
		surface: deriveSectionSurface(accentBackground, 0.08),
		text: accentText,
		textLight: deriveSectionTextLight(accentText, accentBackground),
		accent: opts.accentOnDark ?? deriveAccentForBackground(accent, accentBackground),
		border: deriveSectionBorderColor(accentText, accentBackground),
	};

	const warmBackground = deriveSectionBackgroundOklch(background, "warm", accent);
	const warmText = deriveSectionTextColor(warmBackground, text);
	const warm: SectionPalette = {
		background: warmBackground,
		surface: deriveSectionSurface(warmBackground),
		text: warmText,
		textLight: deriveSectionTextLight(warmText, warmBackground),
		accent: deriveAccentForBackground(accent, warmBackground),
		border: deriveSectionBorderColor(warmText, warmBackground),
	};

	const coolBackground = deriveSectionBackgroundOklch(background, "cool", accent);
	const coolText = deriveSectionTextColor(coolBackground, text);
	const cool: SectionPalette = {
		background: coolBackground,
		surface: deriveSectionSurface(coolBackground),
		text: coolText,
		textLight: deriveSectionTextLight(coolText, coolBackground),
		accent: deriveAccentForBackground(accent, coolBackground),
		border: deriveSectionBorderColor(coolText, coolBackground),
	};

	const growthBackground = deriveSectionBackgroundOklch(background, "growth", accent);
	const growthText = deriveSectionTextColor(growthBackground, text);
	const growth: SectionPalette = {
		background: growthBackground,
		surface: deriveSectionSurface(growthBackground),
		text: growthText,
		textLight: deriveSectionTextLight(growthText, growthBackground),
		accent: deriveAccentForBackground(accent, growthBackground),
		border: deriveSectionBorderColor(growthText, growthBackground),
	};

	return { light, dark, accent: accentPalette, warm, cool, growth };
}

type OklchPaletteKind = "dark" | "alt" | "warm" | "cool" | "growth";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isHexColor(value: string): boolean {
	return HEX_COLOR_PATTERN.test(value.trim());
}

function normalizeHue(hue: number): number {
	const normalized = hue % 360;
	return normalized < 0 ? normalized + 360 : normalized;
}

function rotateHueToward(currentHue: number, targetHue: number, weight: number): number {
	const diff = ((targetHue - currentHue + 540) % 360) - 180;
	return normalizeHue(currentHue + diff * weight);
}

function adjustNearbyLightness(lightness: number, amount: number): number {
	const isLight = lightness > 0.6;
	return Math.max(0, Math.min(1, lightness + (isLight ? -amount : amount)));
}

function deriveSectionBackgroundOklch(
	baseHex: string,
	palette: OklchPaletteKind,
	accentHex?: string,
): string {
	if (!isHexColor(baseHex)) return baseHex;

	const base = srgbToOklch(baseHex);
	let l = base.l;
	let c = base.c;
	let h = base.h;

	if (c < 0.01 && accentHex && isHexColor(accentHex)) {
		const accent = srgbToOklch(accentHex);
		if (accent.c < 0.01) {
			// Both base and accent are achromatic — stay achromatic (e.g. Minimal)
			c = 0;
		} else {
			h = accent.h;
			c = Math.max(0.03, accent.c * 0.3);
		}
	}

	switch (palette) {
		case "dark": {
			if (l > 0.85) {
				l = 0.22;
			} else if (l < 0.4) {
				l = Math.max(0, l - 0.08);
			}
			c *= 0.8;
			break;
		}
		case "alt":
			l = adjustNearbyLightness(l, 0.03);
			break;
		case "warm":
			l = adjustNearbyLightness(l, 0.02);
			c *= 1.1;
			h = normalizeHue(h + 18);
			break;
		case "cool":
			l = adjustNearbyLightness(l, 0.02);
			c *= 0.9;
			h = normalizeHue(h - 30);
			break;
		case "growth":
			l = adjustNearbyLightness(l, 0.02);
			h = rotateHueToward(h, 145, 0.5);
			break;
	}

	const clipped = gamutClipOklch(l, c, h);
	return oklchToSrgb(clipped.l, clipped.c, clipped.h);
}

function deriveSectionSurface(sectionBgHex: string, liftOverride?: number): string {
	if (!isHexColor(sectionBgHex)) return sectionBgHex;

	const sectionBg = srgbToOklch(sectionBgHex);
	if (sectionBg.l > 0.7) return sectionBgHex;

	// Use a larger lift for very dark backgrounds to ensure card boundaries
	// are perceptible (target >= 1.3:1 surface-to-background contrast).
	// At low L values, L+0.06 only produces ~1.15:1 due to luminance compression.
	const lift = liftOverride ?? (sectionBg.l < 0.4 ? 0.12 : 0.06);
	const clipped = gamutClipOklch(sectionBg.l + lift, sectionBg.c * 0.85, sectionBg.h);
	return oklchToSrgb(clipped.l, clipped.c, clipped.h);
}

function deriveSectionTextColor(sectionBg: string, themeText: string): string {
	const candidates = [
		themeText,
		relativeLuminanceFromHex(themeText) > 0.5 ? "#1e293b" : "#e2e8f0",
		"#000000",
		"#ffffff",
	];

	for (const candidate of candidates) {
		if (ensureContrast(candidate, sectionBg).passesBody) {
			return candidate;
		}
	}

	const bodyCompliantGray = findBodyCompliantGray(sectionBg);
	if (bodyCompliantGray) {
		return bodyCompliantGray;
	}

	let bestWcagCandidate = candidates[0];
	let bestWcag = 0;
	let bestApcaWithinWcagCandidate: string | null = null;
	let bestApcaWithinWcag = 0;
	for (const candidate of candidates) {
		const contrast = ensureContrast(candidate, sectionBg);
		if (contrast.wcagRatio > bestWcag) {
			bestWcag = contrast.wcagRatio;
			bestWcagCandidate = candidate;
		}
		if (contrast.wcagRatio >= 4.5 && Math.abs(contrast.apcaLc) > bestApcaWithinWcag) {
			bestApcaWithinWcag = Math.abs(contrast.apcaLc);
			bestApcaWithinWcagCandidate = candidate;
		}
	}

	return bestApcaWithinWcagCandidate ?? bestWcagCandidate;
}

function findBodyCompliantGray(sectionBg: string): string | null {
	if (relativeLuminanceFromHex(sectionBg) > 0.5) {
		let best: string | null = null;
		for (let value = 0; value <= 255; value += 1) {
			const gray = rgbToHex(value, value, value);
			if (ensureContrast(gray, sectionBg).passesBody) {
				best = gray;
			}
		}
		return best;
	}

	for (let value = 0; value <= 255; value += 1) {
		const gray = rgbToHex(value, value, value);
		if (ensureContrast(gray, sectionBg).passesBody) {
			return gray;
		}
	}

	return null;
}

function deriveSectionTextLight(text: string, background: string): string {
	for (let alpha = 0.65; alpha <= 0.98; alpha += 0.03) {
		const candidate = blendWithAlpha(text, background, alpha);
		const contrast = ensureContrast(candidate, background);
		if (contrast.wcagRatio >= 4.5 && Math.abs(contrast.apcaLc) >= 60) {
			return candidate;
		}
	}
	return text;
}

function deriveSectionBorderColor(text: string, background: string): string {
	return blendWithAlpha(text, background, 0.2);
}

function deriveAccentForBackground(accent: string, bg: string): string {
	const ratio = contrastRatio(accent, bg);
	if (ratio !== null && ratio >= 3) return accent;

	const bgIsLight = relativeLuminanceFromHex(bg) > 0.5;
	let adjusted = accent;
	for (let i = 0; i < 20; i++) {
		adjusted = shiftLightness(adjusted, bgIsLight ? -8 : 12);
		const newRatio = contrastRatio(adjusted, bg);
		if (newRatio !== null && newRatio >= 3) return adjusted;
	}

	return bgIsLight ? "#000000" : "#ffffff";
}

// --- Color math helpers ---

function parseHexToRgb(hex: string): [number, number, number] | null {
	const cleaned = hex.replace("#", "");
	if (cleaned.length === 3) {
		return [
			Number.parseInt(cleaned[0] + cleaned[0], 16),
			Number.parseInt(cleaned[1] + cleaned[1], 16),
			Number.parseInt(cleaned[2] + cleaned[2], 16),
		];
	}
	if (cleaned.length === 6) {
		return [
			Number.parseInt(cleaned.slice(0, 2), 16),
			Number.parseInt(cleaned.slice(2, 4), 16),
			Number.parseInt(cleaned.slice(4, 6), 16),
		];
	}
	return null;
}

function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function shiftLightness(hex: string, percent: number): string {
	const rgb = parseHexToRgb(hex);
	if (!rgb) return hex;
	const factor = 1 + percent / 100;
	return rgbToHex(rgb[0] * factor, rgb[1] * factor, rgb[2] * factor);
}

function blendWithAlpha(fgHex: string, bgHex: string, alpha: number): string {
	const fg = parseHexToRgb(fgHex);
	const bg = parseHexToRgb(bgHex);
	if (!fg || !bg) return fgHex;
	return rgbToHex(
		fg[0] * alpha + bg[0] * (1 - alpha),
		fg[1] * alpha + bg[1] * (1 - alpha),
		fg[2] * alpha + bg[2] * (1 - alpha),
	);
}
