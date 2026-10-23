import type { DesignVariants } from "@praxity/grammar";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { describe, expect, it } from "vitest";
import { ensureContrast } from "../oklch";
import { THEME_PRESET_DEFAULTS, type ThemePresetId } from "../theme-preset-defaults";

const prefix = "--praxity-color-";

describe("reading palette contrast", () => {
	for (const palette of Object.keys(THEME_PRESET_DEFAULTS) as ThemePresetId[]) {
		for (const mode of ["light", "dark"] as const) {
			it(`${palette} ${mode} keeps focus at 3:1 on every learner surface`, () => {
				const tokens = resolveDesignTokens(
					{ ...THEME_PRESET_DEFAULTS[palette], palette } as DesignVariants,
					mode,
				);
				const surfaces = Object.entries(tokens).filter(
					([key]) =>
						[
							"background",
							"surface",
							"navigation-surface",
							"background-alt",
							"activity-surface",
							"accent-light",
							"secondary-light",
							"tertiary-light",
							"success-light",
							"error-light",
							"warning-light",
						].includes(key.slice(prefix.length)) ||
						(key.startsWith(`${prefix}callout-`) && /-(low|high)$/.test(key)),
				);
				expect(surfaces.length).toBeGreaterThanOrEqual(6);
				for (const [surface, background] of surfaces) {
					// Measure the resolved colour directly; a correcting helper could hide a regression.
					expect(
						contrastRatio(tokens[`${prefix}focus`], background),
						`focus on ${surface}`,
					).toBeGreaterThanOrEqual(3);
				}
				expect(
					contrastRatio(tokens[`${prefix}focus-text`], tokens[`${prefix}focus`]),
				).toBeGreaterThanOrEqual(4.5);
			});
		}
	}
	it("keeps Plum light note body text above the small-text reading floor", () => {
		const tokens = resolveDesignTokens(
			{ ...THEME_PRESET_DEFAULTS.darkroom, palette: "darkroom" } as DesignVariants,
			"light",
		);
		const contrast = ensureContrast(tokens[`${prefix}text`], tokens[`${prefix}callout-note-high`]);
		// Published note copy is 17px/400; its project reading target is Lc90.
		expect(Math.abs(contrast.apcaLc)).toBeGreaterThanOrEqual(90);
	});
	for (const palette of [
		"clean",
		"waves",
		"standard",
		"bauhaus",
		"campfire",
		"darkroom",
	] as const) {
		for (const mode of ["light", "dark"] as const) {
			it(`${palette} ${mode} keeps dimmed learner labels readable on navigation and notes`, () => {
				const tokens = resolveDesignTokens({ palette } as DesignVariants, mode);
				for (const [surface, background] of Object.entries(tokens).filter(
					([key]) =>
						key === `${prefix}navigation-surface` ||
						(key.startsWith(`${prefix}callout-`) && /-(low|high)$/.test(key)),
				)) {
					const result = ensureContrast(tokens["--mantine-color-dimmed"], background);
					expect(result.wcagRatio, `dimmed on ${surface}: WCAG`).toBeGreaterThanOrEqual(4.5);
					expect(Math.abs(result.apcaLc), `dimmed on ${surface}: APCA`).toBeGreaterThanOrEqual(75);
				}
			});
			it(`${palette} ${mode} protects reading, labels, actions and focus`, () => {
				const tokens = resolveDesignTokens(
					{ ...THEME_PRESET_DEFAULTS[palette], palette } as DesignVariants,
					mode,
				);
				const surfaces = Object.entries(tokens).filter(
					([key, value]) =>
						/^#[0-9a-f]{6}$/i.test(value) &&
						(["background", "surface", "background-alt", "navigation-surface"].includes(
							key.slice(prefix.length),
						) ||
							(key.startsWith(`${prefix}callout-`) && /-(low|high)$/.test(key))),
				);
				for (const role of [
					"text",
					"text-muted",
					"text-light",
					"accent-text",
					"secondary-text",
					"tertiary-text",
					"success-text",
					"error-text",
					"warning-text",
				]) {
					if (!tokens[prefix + role]) continue;
					for (const [surface, background] of surfaces) {
						const result = ensureContrast(tokens[prefix + role], background);
						expect(result.wcagRatio, `${role} on ${surface}: WCAG`).toBeGreaterThanOrEqual(4.5);
						// Lc75 supports body >=18px/400 and non-body labels >=15px/400.
						expect(Math.abs(result.apcaLc), `${role} on ${surface}: APCA`).toBeGreaterThanOrEqual(
							75,
						);
					}
				}
				const button = ensureContrast(
					tokens[`${prefix}button-text`],
					tokens[`${prefix}button-background`],
				);
				expect(button.wcagRatio).toBeGreaterThanOrEqual(4.5);
				expect(Math.abs(button.apcaLc)).toBeGreaterThanOrEqual(75);
				for (const surface of ["background", "surface", "navigation-surface"] as const) {
					expect(
						ensureContrast(tokens[`${prefix}button-outline`], tokens[`${prefix}${surface}`])
							.wcagRatio,
					).toBeGreaterThanOrEqual(3);
				}
				for (const role of ["focus", "activity-border"]) {
					expect(
						ensureContrast(tokens[prefix + role], tokens[`${prefix}background`]).wcagRatio,
					).toBeGreaterThanOrEqual(3);
				}
			});
		}
	}
	it("keeps explicit custom colours instead of substituting a preset's dark colours", () => {
		const tokens = resolveDesignTokens(
			{
				...THEME_PRESET_DEFAULTS.standard,
				palette: "standard",
				colorAccent: "#d6c4f5",
				colorButtonBackground: "#34314a",
				colorButtonText: "#ffffff",
			} as DesignVariants,
			"dark",
		);
		expect(tokens[`${prefix}accent`]).toBe("#d6c4f5");
		expect(tokens[`${prefix}button-background`]).toBe("#d6c4f5");
		expect(tokens[`${prefix}button-text`]).toBe("#121417");
		const inherited = resolveDesignTokens(
			{ palette: "standard", colorAccent: "#34314a" } as DesignVariants,
			"dark",
		);
		expect(
			contrastRatio(inherited[`${prefix}button-background`], inherited[`${prefix}background`]),
		).toBeGreaterThanOrEqual(4.5);
		expect(
			contrastRatio(inherited[`${prefix}button-text`], inherited[`${prefix}button-background`]),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("does not apply curated surfaces to a custom page background", () => {
		const tokens = resolveDesignTokens(
			{
				...THEME_PRESET_DEFAULTS.clean,
				palette: "clean",
				colorBackgroundLight: "#fefefe",
			} as DesignVariants,
			"light",
		);

		expect(tokens[`${prefix}surface`]).toBe("#fefefe");
		expect(tokens[`${prefix}navigation-surface`]).toBe("#fefefe");
	});
});
