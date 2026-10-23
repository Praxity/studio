/**
 * Canonical `--praxity-section-gap` resolution.
 *
 * `design.sectionGap` is a reading-scale-relative multiplier applied to the
 * `--praxity-space-section` rhythm token. It used to be a raw pixel value, so
 * pixel-era numbers are normalized against the historical 48px default.
 *
 * This lives in shared-blocks because BOTH the exporter and the editor preview
 * must produce the identical value. They previously did not: the exporter
 * emitted the scaled token while every preview surface emitted raw pixels, so
 * an author saw 48px while the export rendered ~39.6px — a WYSIWYG break at the
 * default value, before anyone touched the setting.
 *
 * Do not reimplement this. Import it.
 */

/** Historical pixel default, and the divisor for normalizing pixel-era values. */
export const LEGACY_SECTION_GAP_PX = 48;

/** Values at or below this are already multipliers rather than pixel counts. */
const MULTIPLIER_CEILING = 3;

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;

/** Resolve any persisted `sectionGap` value to a rhythm-token multiplier. */
export function sectionGapScale(value: unknown): number {
	const raw = typeof value === "number" && Number.isFinite(value) ? value : LEGACY_SECTION_GAP_PX;
	const scale = raw <= MULTIPLIER_CEILING ? raw : raw / LEGACY_SECTION_GAP_PX;
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The CSS value for `--praxity-section-gap`.
 *
 * Depends on `--praxity-space-section`, which is defined in `reading-rhythm.css`
 * and reaches every surface via `shared-blocks.css`. If a surface ever stops
 * loading that stylesheet this `calc()` becomes invalid and the declaration is
 * dropped, so keep the import chain intact.
 */
export function sectionGapCssValue(value: unknown): string {
	return `calc(var(--praxity-space-section) * ${sectionGapScale(value)})`;
}
