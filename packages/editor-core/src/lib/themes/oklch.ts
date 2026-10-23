import {
	contrastRatioFromLuminances,
	linearRgbLuminance,
	srgbToLinear,
} from "@praxity/shared-blocks/color-math";
import { normalizeHex } from "./color-utils";

export interface OklchColor {
	l: number;
	c: number;
	h: number;
}

export interface ContrastCompliance {
	wcagRatio: number;
	apcaLc: number;
	passesBody: boolean;
	passesLarge: boolean;
	passesUI: boolean;
}

const MATRIX_M1 = {
	l: [0.4122214708, 0.5363325363, 0.0514459929] as const,
	m: [0.2119034982, 0.6806995451, 0.1073969566] as const,
	s: [0.0883024619, 0.2817188376, 0.6299787005] as const,
};

const MATRIX_M2 = {
	l: [0.2104542553, 0.793617785, -0.0040720468] as const,
	a: [1.9779984951, -2.428592205, 0.4505937099] as const,
	b: [0.0259040371, 0.7827717662, -0.808675766] as const,
};

const MATRIX_M2_INV = {
	l: [1, 0.3963377774, 0.2158037573] as const,
	m: [1, -0.1055613458, -0.0638541728] as const,
	s: [1, -0.0894841775, -1.291485548] as const,
};

const MATRIX_M1_INV = {
	r: [4.0767416621, -3.3077115913, 0.2309699292] as const,
	g: [-1.2684380046, 2.6097574011, -0.3413193965] as const,
	b: [-0.0041960863, -0.7034186147, 1.707614701] as const,
};

const APCA = {
	mainTRC: 2.4,
	r: 0.2126729,
	g: 0.7151522,
	b: 0.072175,
	normBG: 0.56,
	normTXT: 0.57,
	revTXT: 0.62,
	revBG: 0.65,
	blkThrs: 0.022,
	blkClmp: Math.SQRT2,
	scaleBoW: 1.14,
	scaleWoB: 1.14,
	loBoWoffset: 0.027,
	loWoBoffset: 0.027,
	deltaYmin: 0.0005,
	loClip: 0.1,
};

const BODY_WCAG_RATIO = 4.5;
const LARGE_WCAG_RATIO = 3;
const UI_WCAG_RATIO = 3;
const BODY_APCA_LC = 75;
const LARGE_APCA_LC = 60;
const UI_APCA_LC = 45;

const ACCENT_SEARCH_MIN_L = 0.2;
const ACCENT_SEARCH_MAX_L = 0.95;
const ACCENT_SEARCH_MIN_C = 0.04;
const ACCENT_CHROMA_STEP = 0.01;
const ACCENT_SEARCH_STEPS = 24;
const LIGHT_ACCENT_TARGET = { l: 0.48, c: 0.16 };
const DARK_ACCENT_TARGET = { l: 0.72, c: 0.14 };

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
	const normalized = hue % 360;
	return normalized < 0 ? normalized + 360 : normalized;
}

function hexToSrgb(hex: string): [number, number, number] | null {
	const normalized = normalizeHex(hex);
	if (!normalized) return null;

	const value = normalized.slice(1);
	const r = Number.parseInt(value.slice(0, 2), 16) / 255;
	const g = Number.parseInt(value.slice(2, 4), 16) / 255;
	const b = Number.parseInt(value.slice(4, 6), 16) / 255;
	return [r, g, b];
}

export function srgbToWcagLuminance(hex: string): number | null {
	const rgb = hexToSrgb(hex);
	if (!rgb) return null;

	const [r, g, b] = rgb.map(srgbToLinear);
	return linearRgbLuminance(r, g, b);
}

// APCA-W3 intentionally uses simple 2.4 power-law linearization (not WCAG's IEC 61966-2-1 piecewise function).
function srgbToApcaY(hex: string): number | null {
	const rgb = hexToSrgb(hex);
	if (!rgb) return null;

	return (
		APCA.r * rgb[0] ** APCA.mainTRC +
		APCA.g * rgb[1] ** APCA.mainTRC +
		APCA.b * rgb[2] ** APCA.mainTRC
	);
}

function delinearize(channel: number): number {
	if (channel <= 0.0031308) return 12.92 * channel;
	return 1.055 * channel ** (1 / 2.4) - 0.055;
}

function oklchToLinearRgb(l: number, c: number, h: number): [number, number, number] {
	const hr = (normalizeHue(h) * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b = c * Math.sin(hr);

	const lPrime = MATRIX_M2_INV.l[0] * l + MATRIX_M2_INV.l[1] * a + MATRIX_M2_INV.l[2] * b;
	const mPrime = MATRIX_M2_INV.m[0] * l + MATRIX_M2_INV.m[1] * a + MATRIX_M2_INV.m[2] * b;
	const sPrime = MATRIX_M2_INV.s[0] * l + MATRIX_M2_INV.s[1] * a + MATRIX_M2_INV.s[2] * b;

	const lLinear = lPrime ** 3;
	const mLinear = mPrime ** 3;
	const sLinear = sPrime ** 3;

	const r =
		MATRIX_M1_INV.r[0] * lLinear + MATRIX_M1_INV.r[1] * mLinear + MATRIX_M1_INV.r[2] * sLinear;
	const g =
		MATRIX_M1_INV.g[0] * lLinear + MATRIX_M1_INV.g[1] * mLinear + MATRIX_M1_INV.g[2] * sLinear;
	const bLinear =
		MATRIX_M1_INV.b[0] * lLinear + MATRIX_M1_INV.b[1] * mLinear + MATRIX_M1_INV.b[2] * sLinear;

	return [r, g, bLinear];
}

function linearRgbToHex(rgb: [number, number, number]): string {
	const channels = rgb.map((channel) => clamp(delinearize(channel), 0, 1));
	const [r, g, b] = channels.map((channel) => Math.round(channel * 255));
	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function apcaContrastFromY(textY: number, backgroundY: number): number {
	if (
		!Number.isFinite(textY) ||
		!Number.isFinite(backgroundY) ||
		Math.min(textY, backgroundY) < 0 ||
		Math.max(textY, backgroundY) > 1.1
	) {
		return 0;
	}

	const clampedTextY =
		textY > APCA.blkThrs ? textY : textY + (APCA.blkThrs - textY) ** APCA.blkClmp;
	const clampedBackgroundY =
		backgroundY > APCA.blkThrs
			? backgroundY
			: backgroundY + (APCA.blkThrs - backgroundY) ** APCA.blkClmp;

	if (Math.abs(clampedBackgroundY - clampedTextY) < APCA.deltaYmin) {
		return 0;
	}

	if (clampedBackgroundY > clampedTextY) {
		const sapc = (clampedBackgroundY ** APCA.normBG - clampedTextY ** APCA.normTXT) * APCA.scaleBoW;
		return sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100;
	}

	const sapc = (clampedBackgroundY ** APCA.revBG - clampedTextY ** APCA.revTXT) * APCA.scaleWoB;
	return sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100;
}

function scoreBodyCompliance(contrast: ContrastCompliance): number {
	return Math.min(contrast.wcagRatio / BODY_WCAG_RATIO, Math.abs(contrast.apcaLc) / BODY_APCA_LC);
}

function toOklchColor(color: string | OklchColor): OklchColor {
	return typeof color === "string" ? srgbToOklch(color) : color;
}

function oklchToHex(color: OklchColor): string {
	return linearRgbToHex(oklchToLinearRgb(color.l, color.c, color.h));
}

type AccentCandidate = {
	color: OklchColor;
	hex: string;
	contrast: ContrastCompliance;
};

function buildAccentCandidate(
	l: number,
	c: number,
	h: number,
	background: string,
): AccentCandidate {
	const color = gamutClipOklch(l, c, h);
	const hex = oklchToHex(color);
	return {
		color,
		hex,
		contrast: ensureContrast(hex, background),
	};
}

function pickBetterFallbackCandidate(
	current: AccentCandidate,
	candidate: AccentCandidate,
	targetLightness: number,
): AccentCandidate {
	const currentScore = scoreBodyCompliance(current.contrast);
	const candidateScore = scoreBodyCompliance(candidate.contrast);
	if (candidateScore > currentScore) return candidate;
	if (candidateScore < currentScore) return current;

	const currentDelta = Math.abs(current.color.l - targetLightness);
	const candidateDelta = Math.abs(candidate.color.l - targetLightness);
	return candidateDelta < currentDelta ? candidate : current;
}

function findNearestBodyCompliantCandidate(
	hue: number,
	background: string,
	targetLightness: number,
	chroma: number,
	isDarkBackground: boolean,
): AccentCandidate | null {
	const initial = buildAccentCandidate(targetLightness, chroma, hue, background);
	if (initial.contrast.passesBody) return initial;

	if (isDarkBackground) {
		const brightest = buildAccentCandidate(ACCENT_SEARCH_MAX_L, chroma, hue, background);
		if (!brightest.contrast.passesBody) return null;

		let low = targetLightness;
		let high = ACCENT_SEARCH_MAX_L;
		let best = brightest;

		for (let index = 0; index < ACCENT_SEARCH_STEPS; index += 1) {
			const mid = (low + high) / 2;
			const candidate = buildAccentCandidate(mid, chroma, hue, background);

			if (candidate.contrast.passesBody) {
				best = candidate;
				high = mid;
			} else {
				low = mid;
			}
		}

		return best;
	}

	const darkest = buildAccentCandidate(ACCENT_SEARCH_MIN_L, chroma, hue, background);
	if (!darkest.contrast.passesBody) return null;

	let low = ACCENT_SEARCH_MIN_L;
	let high = targetLightness;
	let best = darkest;

	for (let index = 0; index < ACCENT_SEARCH_STEPS; index += 1) {
		const mid = (low + high) / 2;
		const candidate = buildAccentCandidate(mid, chroma, hue, background);

		if (candidate.contrast.passesBody) {
			best = candidate;
			low = mid;
		} else {
			high = mid;
		}
	}

	return best;
}

function inSrgbGamut(l: number, c: number, h: number): boolean {
	const [r, g, b] = oklchToLinearRgb(l, c, h);
	const epsilon = 1e-7;
	return (
		r >= -epsilon &&
		r <= 1 + epsilon &&
		g >= -epsilon &&
		g <= 1 + epsilon &&
		b >= -epsilon &&
		b <= 1 + epsilon
	);
}

export function srgbToOklch(hex: string): OklchColor {
	const rgb = hexToSrgb(hex);
	if (!rgb) return { l: 0, c: 0, h: 0 };

	const [r, g, b] = rgb.map(srgbToLinear);
	const lLinear = MATRIX_M1.l[0] * r + MATRIX_M1.l[1] * g + MATRIX_M1.l[2] * b;
	const mLinear = MATRIX_M1.m[0] * r + MATRIX_M1.m[1] * g + MATRIX_M1.m[2] * b;
	const sLinear = MATRIX_M1.s[0] * r + MATRIX_M1.s[1] * g + MATRIX_M1.s[2] * b;

	const lRoot = Math.cbrt(lLinear);
	const mRoot = Math.cbrt(mLinear);
	const sRoot = Math.cbrt(sLinear);

	const l = MATRIX_M2.l[0] * lRoot + MATRIX_M2.l[1] * mRoot + MATRIX_M2.l[2] * sRoot;
	const a = MATRIX_M2.a[0] * lRoot + MATRIX_M2.a[1] * mRoot + MATRIX_M2.a[2] * sRoot;
	const bLab = MATRIX_M2.b[0] * lRoot + MATRIX_M2.b[1] * mRoot + MATRIX_M2.b[2] * sRoot;

	const c = Math.sqrt(a * a + bLab * bLab);
	const h = c < 1e-8 ? 0 : normalizeHue((Math.atan2(bLab, a) * 180) / Math.PI);
	return { l, c, h };
}

export function gamutClipOklch(l: number, c: number, h: number): OklchColor {
	const safeL = clamp(l, 0, 1);
	const safeC = Math.max(0, c);
	const safeH = normalizeHue(h);

	if (inSrgbGamut(safeL, safeC, safeH)) {
		return { l: safeL, c: safeC, h: safeH };
	}

	let low = 0;
	let high = safeC;
	for (let i = 0; i < 10; i++) {
		const mid = (low + high) / 2;
		if (inSrgbGamut(safeL, mid, safeH)) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return { l: safeL, c: low, h: safeH };
}

export function oklchToSrgb(l: number, c: number, h: number): string {
	const clipped = gamutClipOklch(l, c, h);
	return oklchToHex(clipped);
}

export function ensureContrast(fg: string, bg: string): ContrastCompliance {
	const foregroundY = srgbToApcaY(fg);
	const backgroundY = srgbToApcaY(bg);
	const foregroundLuminance = srgbToWcagLuminance(fg);
	const backgroundLuminance = srgbToWcagLuminance(bg);

	if (
		foregroundY === null ||
		backgroundY === null ||
		foregroundLuminance === null ||
		backgroundLuminance === null
	) {
		return {
			wcagRatio: 0,
			apcaLc: 0,
			passesBody: false,
			passesLarge: false,
			passesUI: false,
		};
	}

	const wcagRatio = contrastRatioFromLuminances(foregroundLuminance, backgroundLuminance);
	const apcaLc = apcaContrastFromY(foregroundY, backgroundY);
	const absoluteLc = Math.abs(apcaLc);

	return {
		wcagRatio,
		apcaLc,
		passesBody: wcagRatio >= BODY_WCAG_RATIO && absoluteLc >= BODY_APCA_LC,
		passesLarge: wcagRatio >= LARGE_WCAG_RATIO && absoluteLc >= LARGE_APCA_LC,
		passesUI: wcagRatio >= UI_WCAG_RATIO && absoluteLc >= UI_APCA_LC,
	};
}

export function findCompliantAccent(hue: number, background: string): string {
	const backgroundLuminance = srgbToWcagLuminance(background) ?? 1;
	const isDarkBackground = backgroundLuminance < 0.5;
	const target = isDarkBackground ? DARK_ACCENT_TARGET : LIGHT_ACCENT_TARGET;
	const normalizedHue = normalizeHue(hue);

	let fallback = buildAccentCandidate(target.l, target.c, normalizedHue, background);
	if (fallback.contrast.passesBody) return fallback.hex;

	for (
		let chroma = target.c;
		chroma >= ACCENT_SEARCH_MIN_C - 1e-8;
		chroma = Number((chroma - ACCENT_CHROMA_STEP).toFixed(2))
	) {
		const candidate = findNearestBodyCompliantCandidate(
			normalizedHue,
			background,
			target.l,
			chroma,
			isDarkBackground,
		);
		if (candidate) return candidate.hex;

		const boundary = buildAccentCandidate(
			isDarkBackground ? ACCENT_SEARCH_MAX_L : ACCENT_SEARCH_MIN_L,
			chroma,
			normalizedHue,
			background,
		);
		fallback = pickBetterFallbackCandidate(fallback, boundary, target.l);
	}

	return fallback.hex;
}

export function accentDriftIndicator(
	original: string | OklchColor,
	adjusted: string | OklchColor,
): number {
	const originalColor = toOklchColor(original);
	const adjustedColor = toOklchColor(adjusted);
	return Math.abs(originalColor.l - adjustedColor.l);
}
