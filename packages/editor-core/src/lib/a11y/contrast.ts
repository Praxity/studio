import {
	contrastRatioFromLuminances,
	linearRgbLuminance,
	srgbToLinear,
} from "@praxity/shared-blocks/color-math";

/**
 * Parse hex color string to [R, G, B]. Returns null for incomplete/invalid input.
 */
export function parseHex(hex: string): [number, number, number] | null {
	const cleaned = hex.replace("#", "");
	if (cleaned.length === 3) {
		return [
			Number.parseInt(cleaned[0] + cleaned[0], 16),
			Number.parseInt(cleaned[1] + cleaned[1], 16),
			Number.parseInt(cleaned[2] + cleaned[2], 16),
		];
	}
	if (cleaned.length === 6 || cleaned.length === 8) {
		const r = Number.parseInt(cleaned.slice(0, 2), 16);
		const g = Number.parseInt(cleaned.slice(2, 4), 16);
		const b = Number.parseInt(cleaned.slice(4, 6), 16);
		if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
		return [r, g, b];
	}
	return null;
}

function relativeLuminance(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map((channel) => srgbToLinear(channel / 255));
	return linearRgbLuminance(r, g, b);
}

export function getContrastRatio(fg: string, bg: string): number | null {
	const fgRgb = parseHex(fg);
	const bgRgb = parseHex(bg);
	if (!fgRgb || !bgRgb) return null;
	const lum1 = relativeLuminance(fgRgb);
	const lum2 = relativeLuminance(bgRgb);
	return contrastRatioFromLuminances(lum1, lum2);
}

/** WCAG relative luminance from a hex string. Returns 0 for invalid input. */
export function relativeLuminanceFromHex(hex: string): number {
	const rgb = parseHex(hex);
	if (!rgb) return 0;
	return relativeLuminance(rgb);
}

export interface ContrastWarning {
	pair: string;
	label: string;
	ratio: number;
	required: number;
}

export function checkContrastPairs(colors: {
	background: string;
	text: string;
	accent: string;
	buttonBackground: string;
	buttonText: string;
	success: string;
	error: string;
	warning: string;
}): ContrastWarning[] {
	const pairs: {
		fg: string | undefined;
		bg: string | undefined;
		pair: string;
		label: string;
		required: number;
	}[] = [
		{
			fg: colors.text,
			bg: colors.background,
			pair: "text-on-background",
			label: "Text on background",
			required: 4.5,
		},
		{
			fg: colors.buttonText,
			bg: colors.buttonBackground,
			pair: "button-text",
			label: "Button text on button",
			required: 4.5,
		},
		{
			fg: colors.accent,
			bg: colors.background,
			pair: "accent-on-background",
			label: "Accent (decorator) on background",
			required: 3,
		},
		{
			fg: colors.success,
			bg: colors.background,
			pair: "success-on-background",
			label: "Success on background",
			required: 4.5,
		},
		{
			fg: colors.warning,
			bg: colors.background,
			pair: "warning-on-background",
			label: "Warning on background",
			required: 4.5,
		},
		{
			fg: colors.error,
			bg: colors.background,
			pair: "error-on-background",
			label: "Error on background",
			required: 4.5,
		},
	];

	const warnings: ContrastWarning[] = [];
	for (const { fg, bg, pair, label, required } of pairs) {
		if (!fg || !bg) continue;
		const ratio = getContrastRatio(fg, bg);
		if (ratio === null) continue;
		if (ratio < required) {
			warnings.push({
				pair,
				label,
				ratio: Math.round(ratio * 10) / 10,
				required,
			});
		}
	}
	return warnings;
}
