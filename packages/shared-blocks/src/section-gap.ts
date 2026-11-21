export const LEGACY_SECTION_GAP_PX = 48;

const MULTIPLIER_CEILING = 3;

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

export function sectionGapScale(value: unknown): number {
	const raw = typeof value === "number" && Number.isFinite(value) ? value : LEGACY_SECTION_GAP_PX;
	const scale = raw <= MULTIPLIER_CEILING ? raw : raw / LEGACY_SECTION_GAP_PX;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function sectionGapCssValue(value: unknown): string {
	return `calc(var(--praxity-space-section) * ${sectionGapScale(value)})`;
}
