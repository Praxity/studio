import { ensureContrastAll, luminance } from "@praxity/shared-blocks/color-math";
import { enforceDesignTokenContrast } from "@praxity/shared-blocks/themes/resolve-design-tokens";

const NORMAL_TEXT_RATIO = 4.5;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

type ColorShades = {
	accent?: string[];
	success?: string[];
	error?: string[];
	warning?: string[];
};

function asHex(value: string | undefined): string | undefined {
	return value && HEX_PATTERN.test(value) ? value : undefined;
}

export function enforceTextColorContrast(color: string, ...surfaces: string[]): string {
	if (!asHex(color)) return color;
	return ensureContrastAll(color, NORMAL_TEXT_RATIO, ...surfaces);
}

export function enforceThemeTextContrast(theme: Record<string, string>): Record<string, string> {
	const cssVars = Object.fromEntries(
		Object.entries(theme).map(([key, value]) => [
			`--praxity-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`,
			value,
		]),
	);
	const corrected = enforceDesignTokenContrast(cssVars);
	const result = { ...theme };
	for (const [cssKey, value] of Object.entries(corrected)) {
		const themeKey = cssKey
			.replace("--praxity-", "")
			.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
		result[themeKey] = value;
	}
	return result;
}

/**
 * Mantine resolves semantic text to shade 6 in light mode and shade 4 in dark
 * mode. Correct those roles only; changing all ten shades would turn decorative
 * fills and tints into a high-contrast, visually flat palette.
 */
export function enforceColorShadeTextContrast(
	shades: ColorShades,
	background: string,
	colorMode: "light" | "dark" | "auto" = "light",
): ColorShades {
	if (!asHex(background)) return shades;
	const textShadeIndexes = colorMode === "light" ? [6] : [4, 6];
	const corrected: ColorShades = {};

	for (const [role, palette] of Object.entries(shades) as Array<
		[keyof ColorShades, string[] | undefined]
	>) {
		if (!palette) continue;
		const next = [...palette];
		for (const index of textShadeIndexes) {
			const shade = asHex(next[index]);
			if (!shade) continue;
			const surfaces = [background];
			// Assessment feedback puts semantic text on a pale tint of the same
			// status color. Shade 0 is the generated palette's conservative
			// approximation of that tint, and is harder than the plain surface.
			if (role !== "accent" && luminance(background) > 0.5) {
				const tint = asHex(next[0]);
				if (tint) surfaces.push(tint);
			}
			next[index] = ensureContrastAll(shade, NORMAL_TEXT_RATIO, ...surfaces);
		}
		corrected[role] = next;
	}
	return corrected;
}
