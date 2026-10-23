const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const OKLCH_PATTERN =
	/^oklch\(\s*([+]?(?:\d+(?:\.\d*)?|\.\d+))(%?)\s+([+]?(?:\d+(?:\.\d*)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:deg)?\s*\)$/i;

function normalizeHex(hex: string): string | null {
	const match = HEX_PATTERN.exec(hex.trim());
	return match ? `#${match[1].toLowerCase()}` : null;
}

/** WCAG/OKLab transfer for a normalized sRGB channel; APCA uses its own curve. */
export function srgbToLinear(channel: number): number {
	return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function linearRgbLuminance(r: number, g: number, b: number): number {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatioFromLuminances(first: number, second: number): number {
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function linearToSrgb(channel: number): number {
	return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function hexToLinearRgb(hex: string): [number, number, number] | null {
	const normalized = normalizeHex(hex);
	if (!normalized) return null;
	const raw = normalized.slice(1);
	return [
		srgbToLinear(Number.parseInt(raw.slice(0, 2), 16) / 255),
		srgbToLinear(Number.parseInt(raw.slice(2, 4), 16) / 255),
		srgbToLinear(Number.parseInt(raw.slice(4, 6), 16) / 255),
	];
}

function linearRgbToHex(r: number, g: number, b: number): string {
	const toHex = (channel: number): string =>
		Math.round(Math.min(1, Math.max(0, linearToSrgb(channel))) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

function oklchToLinearRgb(L: number, C: number, H: number): [number, number, number] {
	const radians = (H * Math.PI) / 180;
	return oklabToLinearRgb(L, C * Math.cos(radians), C * Math.sin(radians));
}

function isInSrgbGamut(rgb: [number, number, number]): boolean {
	return rgb.every((channel) => channel >= 0 && channel <= 1);
}

export function hexToOklab(hex: string): [number, number, number] {
	const rgb = hexToLinearRgb(hex);
	if (!rgb) throw new TypeError(`Expected a 6-digit hex color, received: ${hex}`);
	return linearRgbToOklab(...rgb);
}

export function hexToOklch(hex: string): [number, number, number] {
	const [L, a, b] = hexToOklab(hex);
	const C = Math.sqrt(a * a + b * b);
	const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
	return [L, C, H];
}

export function oklchToHex(L: number, C: number, H: number): string {
	return linearRgbToHex(...oklchToLinearRgb(L, C, H));
}

/** Convert OKLCH to an in-gamut sRGB hex fallback without clipping RGB channels. */
export function oklchToHexGamutMapped(L: number, C: number, H: number): string {
	const lightness = Math.min(1, Math.max(0, L));
	const hue = ((H % 360) + 360) % 360;
	if (isInSrgbGamut(oklchToLinearRgb(lightness, C, hue))) {
		return oklchToHex(lightness, C, hue);
	}

	let low = 0;
	let high = Math.max(0, C);
	for (let index = 0; index < 16; index += 1) {
		const candidate = (low + high) / 2;
		if (isInSrgbGamut(oklchToLinearRgb(lightness, candidate, hue))) low = candidate;
		else high = candidate;
	}
	return oklchToHex(lightness, low, hue);
}

/** Parse an opaque author colour; keep rejected alpha distinct from malformed input. */
export function parseOpaqueColor(value: string): {
	hex: string | null;
	error: "alpha" | "invalid" | null;
} {
	const short = /^#?([0-9a-fA-F]{3})$/.exec(value.trim());
	const normalized = short
		? `#${short[1]
				.split("")
				.map((digit) => digit + digit)
				.join("")
				.toLowerCase()}`
		: normalizeHex(value);
	if (normalized) return { hex: normalized, error: null };
	if (/^#?(?:[0-9a-fA-F]{4}|[0-9a-fA-F]{8})$/.test(value.trim())) {
		return { hex: null, error: "alpha" };
	}

	const match = OKLCH_PATTERN.exec(value.trim());
	if (!match) return { hex: null, error: "invalid" };
	const L = Number(match[1]) / (match[2] ? 100 : 1);
	const C = Number(match[3]);
	const H = Number(match[4]);
	if (![L, C, H].every(Number.isFinite) || L < 0 || L > 1 || C < 0 || C > 0.5) {
		return { hex: null, error: "invalid" };
	}
	return { hex: oklchToHexGamutMapped(L, C, H), error: null };
}

/** Convert opaque hex or numeric `oklch()` author colours to canonical sRGB. */
export function colorToHex(value: string): string | null {
	return parseOpaqueColor(value).hex;
}

export function luminance(hex: string): number {
	const rgb = hexToLinearRgb(hex);
	if (!rgb) throw new TypeError(`Expected a 6-digit hex color, received: ${hex}`);
	return linearRgbLuminance(...rgb);
}

export function contrastRatio(first: string, second: string): number {
	const l1 = luminance(first);
	const l2 = luminance(second);
	return contrastRatioFromLuminances(l1, l2);
}

function searchLightness(
	foreground: string,
	background: string,
	minRatio: number,
	direction: "darker" | "lighter",
): { color: string; delta: number } | null {
	const [startL, C, H] = hexToOklch(foreground);
	const endpointL = direction === "darker" ? 0 : 1;
	const endpoint = oklchToHex(endpointL, C, H);
	if (contrastRatio(endpoint, background) < minRatio) return null;

	let failingL = startL;
	let passingL = endpointL;
	let best = endpoint;
	for (let index = 0; index < 32; index += 1) {
		const candidateL = (failingL + passingL) / 2;
		const candidate = oklchToHex(candidateL, C, H);
		if (contrastRatio(candidate, background) >= minRatio) {
			passingL = candidateL;
			best = candidate;
		} else {
			failingL = candidateL;
		}
	}
	return { color: best, delta: Math.abs(passingL - startL) };
}

/**
 * Return the closest WCAG-safe version of a foreground by moving only OKLCH
 * lightness. Both directions are considered because a mid-tone background can
 * make the direction implied by the starting luminance impossible.
 * Black/white are a last-resort gamut fallback.
 */
export function ensureContrast(foreground: string, background: string, minRatio: number): string {
	if (!normalizeHex(foreground) || !normalizeHex(background) || minRatio <= 1) return foreground;
	if (contrastRatio(foreground, background) >= minRatio) return foreground;

	const candidates = [
		searchLightness(foreground, background, minRatio, "darker"),
		searchLightness(foreground, background, minRatio, "lighter"),
	]
		.filter((candidate): candidate is { color: string; delta: number } => candidate !== null)
		.sort((a, b) => a.delta - b.delta);
	if (candidates[0]) return candidates[0].color;

	return contrastRatio("#000000", background) >= minRatio ? "#000000" : "#ffffff";
}

/**
 * Correct a foreground against every supplied surface. Each pass rechecks the
 * current worst surface because one correction can make another surface the
 * new lowest-contrast pairing.
 */
export function ensureContrastAll(
	foreground: string,
	minRatio: number,
	...surfaces: string[]
): string {
	const validSurfaces = surfaces.filter((surface) => normalizeHex(surface));
	let corrected = foreground;
	for (let pass = 0; pass < 8; pass += 1) {
		const worst = validSurfaces.reduce(
			(current, surface) =>
				contrastRatio(corrected, surface) < contrastRatio(corrected, current) ? surface : current,
			validSurfaces[0],
		);
		if (!worst || contrastRatio(corrected, worst) >= minRatio) return corrected;
		const next = ensureContrast(corrected, worst, minRatio);
		if (next === corrected) break;
		corrected = next;
	}
	return corrected;
}

/**
 * Serialize a hex colour as `oklch(L% C H)`.
 *
 * Non-hex input (`transparent`, an existing `rgba()`/`oklch()` seed) is passed
 * through untouched.
 */
export function formatOklch(value: string, alpha = 1): string {
	const normalized = normalizeHex(value);
	if (!normalized) return value;

	const [L, C, H] = hexToOklch(normalized);
	const l = (L * 100).toFixed(2).replace(/\.?0+$/, "");
	const c = C.toFixed(4).replace(/\.?0+$/, "");
	const h = C < 0.0005 ? "0" : H.toFixed(2).replace(/\.?0+$/, "");
	const a = alpha >= 1 ? "" : ` / ${Number(alpha.toFixed(4))}`;
	return `oklch(${l}% ${c} ${h}${a})`;
}

/** Composite a translucent foreground over an opaque background. */
export function compositeOver(foreground: string, alpha: number, background: string): string {
	const fg = hexToLinearRgb(foreground);
	const bg = hexToLinearRgb(background);
	if (!fg || !bg) return background;

	const clamped = Math.min(1, Math.max(0, alpha));
	return linearRgbToHex(
		fg[0] * clamped + bg[0] * (1 - clamped),
		fg[1] * clamped + bg[1] * (1 - clamped),
		fg[2] * clamped + bg[2] * (1 - clamped),
	);
}

/** Mix two hex colours by `amount` of `first` in linear RGB. */
export function mixColors(first: string, second: string, amount: number): string {
	return compositeOver(first, amount, second);
}

/** Pick whichever foreground candidate contrasts better with the background. */
export function pickReadableForeground(background: string, light: string, dark: string): string {
	return contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
}
