import { hexToOklch, oklchToHexGamutMapped } from "@praxity/shared-blocks/color-math";

const MAX_LIGHTNESS_STEP = 0.065;
const DEFAULT_COLOR = "#4269d0";
const LEGACY_LIGHTNESS_MAP = [0.96, 0.907, 0.805, 0.697, 0.605, 0.547, 0.518, 0.445, 0.395, 0.34];

function normalizeHex(value: string): string | null {
	const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value.trim());
	if (!match) return null;
	const hex =
		match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
	return `#${hex.toLowerCase()}`;
}

function legacyBaseIndex(hex: string): number {
	const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
	const lightness = (Math.max(...channels) + Math.min(...channels)) / 2;
	return LEGACY_LIGHTNESS_MAP.reduce(
		(best, target, index) =>
			Math.abs(target - lightness) < Math.abs(LEGACY_LIGHTNESS_MAP[best] - lightness)
				? index
				: best,
		0,
	);
}

/** Generate a Mantine-compatible light-to-dark palette with even OKLCH lightness steps. */
export function generateColorShades(hex: string): string[] {
	const seed = normalizeHex(hex) ?? DEFAULT_COLOR;
	const [L, C, H] = hexToOklch(seed);
	// Preserve the seed's historical shade index so existing Mantine role lookups move less.
	const baseIndex = legacyBaseIndex(seed);
	const step = Math.min(
		MAX_LIGHTNESS_STEP,
		baseIndex === 0 ? MAX_LIGHTNESS_STEP : (1 - L) / baseIndex,
		baseIndex === 9 ? MAX_LIGHTNESS_STEP : L / (9 - baseIndex),
	);

	return Array.from({ length: 10 }, (_, index) => {
		if (index === baseIndex) return seed;
		const targetL = L + (baseIndex - index) * step;
		const chromaFactor =
			index < baseIndex
				? 0.2 + 0.8 * (index / Math.max(1, baseIndex))
				: 1 - 0.25 * ((index - baseIndex) / Math.max(1, 9 - baseIndex));
		return oklchToHexGamutMapped(targetL, C * chromaFactor, H);
	});
}
