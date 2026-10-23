import { READING_PALETTES } from "@praxity/shared-blocks/themes/reading-palettes";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { describe, expect, it } from "vitest";
import { resolvePalette } from "../design-variants-to-css";
import { normalizeDesignVariants } from "../normalize-design-variants";
import { ensureContrast } from "../oklch";

describe("clean course theme preset", () => {
	it("resolves the pre-validated palette through live design", () => {
		const variants = normalizeDesignVariants({ palette: "clean" });
		expect(variants.palette).toBe("ink");
		expect(resolveDesignTokens(variants, "light")).toMatchObject({
			"--paper": "#ffffff",
			"--paper-2": "#f4f6f8",
			"--ink": "#18212d",
			"--ink-2": "#414a54",
			"--line": "#78808a",
			"--accent": "#294c78",
			"--praxity-color-button-background": "#294c78",
			"--praxity-color-button-text": "#ffffff",
		});
		expect(resolveDesignTokens(variants, "dark")).toMatchObject({
			"--paper": "#121417",
			"--paper-2": "#1c2025",
			"--ink": "#eceef0",
			"--ink-2": "#ccd2d9",
			"--line": "#78828e",
			"--accent": "#c9dff8",
			"--praxity-color-button-background": "#c9dff8",
			"--praxity-color-button-text": "#121417",
		});
	});

	it("resolves the saved Standard alias", () => {
		const variants = normalizeDesignVariants({ palette: "standard" });
		expect(resolveDesignTokens(variants, "light")["--accent"]).toBe("#294c78");
		expect(resolveDesignTokens(variants, "dark")["--accent"]).toBe("#c9dff8");
	});

	it("registers Waves without changing legacy Minimal", () => {
		const variants = normalizeDesignVariants({ palette: "waves" });
		expect(variants.palette).toBe("ink");
		expect(resolveDesignTokens(variants, "light")["--accent"]).toBe("#294c78");
		expect(resolveDesignTokens(variants, "dark")["--accent"]).toBe("#c9dff8");
		expect(normalizeDesignVariants({ palette: "bauhaus" }).palette).toBe("forest");
		expect(normalizeDesignVariants({ palette: "minimal" }).palette).toBe("ink");
	});

	it("resolves clean defaults for a new slides course", () => {
		const variants = normalizeDesignVariants({ palette: "clean", navArchetype: "slides" });

		expect(variants).toMatchObject({
			palette: "ink",
			navArchetype: "slides",
			colorBackgroundLight: READING_PALETTES.clean.light.colorBackground,
			colorBackgroundDark: READING_PALETTES.clean.dark.colorBackground,
			colorText: READING_PALETTES.clean.light.colorText,
			colorAccent: READING_PALETTES.clean.light.colorAccent,
			colorButtonBackground: READING_PALETTES.clean.light.colorButtonBackground,
			colorButtonText: READING_PALETTES.clean.light.colorButtonText,
			typography: {
				body: { fontFamily: ["Source Sans 3", "sans-serif"] },
				headings: { fontFamily: ["Source Sans 3", "sans-serif"] },
			},
			borderRadius: 8,
			shadowIntensity: "flat",
			dividerStyle: "none",
		});
	});

	it("silently ignores the retired branding setting in persisted design data", () => {
		const variants = normalizeDesignVariants({ showBrandingPill: true });
		expect(variants).not.toHaveProperty("showBrandingPill");
	});

	it("normalizes the default Card transition", () => {
		expect(normalizeDesignVariants({ slideTransition: "zoom" }).slideTransition).toBe("zoom");
		expect(normalizeDesignVariants({ slideTransition: "spin" }).slideTransition).toBe("none");
	});

	it("keeps text at WCAG AA and the accent at UI contrast in both modes", () => {
		const variants = normalizeDesignVariants({ palette: "clean" });

		for (const [mode, palette] of [
			["light", resolvePalette(variants, false)],
			["dark", resolvePalette(variants, true)],
		] as const) {
			const pairs = [
				["text", palette.colorText, palette.colorBackground, 4.5],
				["muted text", palette.colorTextMuted, palette.colorBackground, 4.5],
				["accent", palette.colorAccent, palette.colorBackground, 3],
				["button text", palette.colorButtonText, palette.colorButtonBackground, 4.5],
			] as const;

			for (const [token, foreground, background, minimum] of pairs) {
				expect(foreground, `${mode} ${token} token`).toBeDefined();
				if (!foreground) continue;
				expect(
					ensureContrast(foreground, background).wcagRatio,
					`${mode} ${token} contrast`,
				).toBeGreaterThanOrEqual(minimum);
			}
		}
	});
});
