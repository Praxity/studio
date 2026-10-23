import { createTypography, type DesignVariants } from "@praxity/grammar";
import { READING_PALETTES } from "@praxity/shared-blocks/themes/reading-palettes";
import { describe, expect, it } from "vitest";
import { getContrastRatio } from "../../a11y/contrast";
import { DEFAULT_DESIGN_VARIANTS } from "../design-variant-defaults";
import { designVariantsToCssProperties } from "../design-variants-to-css";
import { THEME_PRESET_DEFAULTS, type ThemePresetId } from "../theme-preset-defaults";

function makeVariants(overrides: Partial<DesignVariants> = {}): DesignVariants {
	return {
		palette: "standard",
		colorMode: "light",
		accentHue: 220,
		colorBackgroundLight: "#faf9f7",
		colorBackgroundDark: "#111827",
		typography: createTypography("Inter", "Inter"),
		headingSize: 2,
		lineHeight: 1.6,
		density: "comfortable",
		sectionGap: 48,
		contentMaxWidth: 720,
		borderRadius: 8,
		shadowIntensity: "subtle",
		dividerStyle: "thin",
		backgroundTexture: "none",
		highlightStyle: "none",
		componentDefaults: {},
		...overrides,
	};
}

describe("designVariantsToCssProperties", () => {
	it("default variants produce expected canonical CSS properties", () => {
		const vars = designVariantsToCssProperties(makeVariants(), false);

		expect(vars).toHaveProperty("--praxity-color-background");
		expect(vars).toHaveProperty("--praxity-color-text");
		expect(vars).toHaveProperty("--praxity-color-accent");
		expect(vars).toHaveProperty("--praxity-color-surface");
		expect(vars).toHaveProperty("--praxity-color-border");
		expect(vars).toHaveProperty("--praxity-color-activity-surface");
		expect(vars).toHaveProperty("--praxity-color-activity-border");
		expect(vars).toHaveProperty("--praxity-color-background-alt");
		expect(vars).toHaveProperty("--praxity-color-text-light");
		expect(vars).toHaveProperty("--praxity-color-text-muted");
		expect(vars).toHaveProperty("--praxity-color-success");
		expect(vars).toHaveProperty("--praxity-color-error");
		expect(vars).toHaveProperty("--praxity-color-warning");
		expect(vars).toHaveProperty("--praxity-color-button-background");
		expect(vars).toHaveProperty("--praxity-color-button-text");
		expect(vars).toHaveProperty("--praxity-font-family");
		expect(vars).toHaveProperty("--praxity-font-weight-body", "400");
		expect(vars).toHaveProperty("--praxity-font-weight-h1", "600");
		expect(vars).not.toHaveProperty("--praxity-max-width");
		expect(vars).not.toHaveProperty("--praxity-line-height-base");
		expect(vars).not.toHaveProperty("--praxity-border-radius");
		expect(vars).not.toHaveProperty("--praxity-radius-content");
		expect(vars).not.toHaveProperty("--praxity-radius-action");
		expect(vars).not.toHaveProperty("--praxity-radius-container");
		expect(vars).not.toHaveProperty("--praxity-spacing-xs");
		expect(vars).not.toHaveProperty("--praxity-spacing-sm");
		expect(vars).not.toHaveProperty("--praxity-spacing-md");
		expect(vars).not.toHaveProperty("--praxity-block-spacing");
		expect(vars).not.toHaveProperty("--praxity-shadow-sm");
		expect(vars).not.toHaveProperty("--praxity-shadow-md");
		expect(vars).not.toHaveProperty("--praxity-shadow-lg");

		expect(
			getContrastRatio(vars["--praxity-color-accent-text"], vars["--praxity-color-background"]),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("preserves the authored accent when accentHue changes", () => {
		const cool = designVariantsToCssProperties(
			makeVariants({ accentHue: 220, accentHueCustomized: true }),
			false,
		);
		const warm = designVariantsToCssProperties(
			makeVariants({ accentHue: 20, accentHueCustomized: true }),
			false,
		);

		expect(cool["--praxity-color-accent"]).toBe(READING_PALETTES.standard.light.colorAccent);
		expect(warm["--praxity-color-accent"]).toBe(READING_PALETTES.standard.light.colorAccent);
	});

	it("maps body and per-level heading typography", () => {
		const vars = designVariantsToCssProperties(
			makeVariants({
				typography: {
					fontDisplay: "optional",
					body: {
						fontFamily: ["Merriweather", "serif"],
						fontWeight: 500,
						fontStyle: "italic",
					},
					headings: {
						fontFamily: ["Inter", "sans-serif"],
						fontWeight: 600,
						fontStyle: "normal",
						h2: { fontFamily: ["Lora", "serif"], fontWeight: 400, fontStyle: "italic" },
					},
				},
			}),
			false,
		);

		expect(vars["--praxity-font-family"]).toBe("'Source Sans 3', sans-serif");
		expect(vars["--praxity-font-weight-body"]).toBe("400");
		expect(vars["--praxity-font-style-body"]).toBe("normal");
		expect(vars["--praxity-font-family-h2"]).toBe("'Source Sans 3', sans-serif");
		expect(vars["--praxity-font-weight-h2"]).toBe("600");
		expect(vars["--praxity-font-style-h2"]).toBe("normal");
	});

	it('colorMode: "auto" + prefersDark: true uses the normalized dark background', () => {
		const vars = designVariantsToCssProperties(
			makeVariants({
				colorMode: "auto",
				colorBackground: "#111111",
				colorText: "#eeeeee",
				colorButtonBackground: "#222222",
			}),
			true,
		);

		expect(vars["--praxity-color-background"]).toBe("#111827");
		expect(vars["--praxity-color-button-background"]).toBe(vars["--accent"]);
	});

	it('colorMode: "auto" + prefersDark: false keeps normalized light colors', () => {
		const vars = designVariantsToCssProperties(
			makeVariants({
				colorMode: "auto",
				colorBackgroundLight: "#fefefe",
				colorText: "#111111",
				colorButtonBackground: "#345678",
			}),
			false,
		);

		expect(vars["--praxity-color-background"]).toBe("#fefefe");
		expect(vars["--praxity-color-text"]).toBe("#111111");
		expect(vars["--praxity-color-button-background"]).toBe(vars["--accent"]);
	});

	it("preview override wins over explicit dark mode", () => {
		const vars = designVariantsToCssProperties(
			makeVariants({
				colorMode: "dark",
				colorAccent: "#4269d0",
				accentHue: 24,
				accentHueCustomized: true,
			}),
			true,
			"light",
		);

		expect(vars["--praxity-color-background"]).toBe("#faf9f7");
		expect(
			getContrastRatio(vars["--praxity-color-accent-text"], vars["--praxity-color-background"]),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("preview override wins over explicit light mode", () => {
		const vars = designVariantsToCssProperties(
			makeVariants({
				colorMode: "light",
				colorAccent: "#4269d0",
				accentHue: 24,
				accentHueCustomized: true,
			}),
			false,
			"dark",
		);

		expect(vars["--praxity-color-background"]).toBe("#111827");
		expect(
			getContrastRatio(vars["--praxity-color-accent-text"], vars["--praxity-color-background"]),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("preserves explicit colorAccent and derives a readable text role", () => {
		const defaults = designVariantsToCssProperties(
			makeVariants({ colorAccent: "#123456", accentHue: 220 }),
			false,
		);
		const customHue = designVariantsToCssProperties(
			makeVariants({ colorAccent: "#123456", accentHue: 20 }),
			false,
		);
		const explicitDefaultHueOverride = designVariantsToCssProperties(
			makeVariants({
				colorAccent: "#123456",
				accentHue: 220,
				accentHueCustomized: true,
			}),
			false,
		);

		for (const vars of [defaults, customHue, explicitDefaultHueOverride]) {
			expect(vars["--praxity-color-accent"]).toBe("#123456");
			expect(
				getContrastRatio(vars["--praxity-color-accent-text"], vars["--praxity-color-background"]),
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("treats non-finite accentHue as the default hue instead of forcing custom mode", () => {
		const baseline = designVariantsToCssProperties(
			makeVariants({ colorAccent: "#123456", accentHue: 220 }),
			false,
		);
		const corrupted = designVariantsToCssProperties(
			makeVariants({ colorAccent: "#123456", accentHue: Number.NaN }),
			false,
		);

		expect(corrupted["--praxity-color-accent"]).toBe(baseline["--praxity-color-accent"]);
	});

	it("keeps the button outline distinct from its surrounding surfaces", () => {
		const vars = designVariantsToCssProperties(
			makeVariants({ colorButtonBackground: "#00aa00" }),
			false,
		);

		for (const surface of ["background", "surface", "navigation-surface"] as const) {
			expect(
				getContrastRatio(
					vars["--praxity-color-button-outline"],
					vars[`--praxity-color-${surface}`],
				),
			).toBeGreaterThanOrEqual(3);
		}
	});

	it("keeps the derived accent text role compliant across all preset themes", () => {
		for (const [presetId, preset] of Object.entries(THEME_PRESET_DEFAULTS)) {
			const variants = {
				...DEFAULT_DESIGN_VARIANTS,
				...preset,
				palette: presetId as ThemePresetId,
			};
			const light = designVariantsToCssProperties(variants, false, "light");
			const dark = designVariantsToCssProperties(variants, true, "dark");

			expect(
				getContrastRatio(light["--praxity-color-accent-text"], light["--praxity-color-background"]),
			).toBeGreaterThanOrEqual(4.5);
			expect(
				getContrastRatio(dark["--praxity-color-accent-text"], dark["--praxity-color-background"]),
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("lightens elevated surfaces and borders only in dark mode", () => {
		const marquee = {
			...DEFAULT_DESIGN_VARIANTS,
			...THEME_PRESET_DEFAULTS.marquee,
			palette: "marquee",
		};
		const light = designVariantsToCssProperties(marquee, false, "light");
		const dark = designVariantsToCssProperties(marquee, true, "dark");

		expect(light["--praxity-color-surface"]).toBe("#f4f6f8");
		expect(dark["--praxity-color-surface"]).not.toBe(dark["--praxity-color-background"]);
		expect(dark["--praxity-color-border"]).not.toBe(light["--praxity-color-border"]);
	});

	it("keeps separate light and dark status colours at 4.5:1", () => {
		const variants = makeVariants({
			colorBackgroundLight: "#ffffff",
			colorBackgroundDark: "#111827",
			colorSuccessOnLight: "#b7e4c7",
			colorSuccessOnDark: "#14532d",
			colorErrorOnLight: "#fecaca",
			colorErrorOnDark: "#7f1d1d",
			colorWarningOnLight: "#fde68a",
			colorWarningOnDark: "#78350f",
		});
		const light = designVariantsToCssProperties(variants, false, "light");
		const dark = designVariantsToCssProperties(variants, true, "dark");

		for (const name of ["success", "error", "warning"] as const) {
			const lightColor = light[`--praxity-color-${name}-on-light`];
			const darkColor = dark[`--praxity-color-${name}-on-dark`];
			expect(light[`--praxity-color-${name}`]).toBe(lightColor);
			expect(dark[`--praxity-color-${name}`]).toBe(darkColor);
			expect(getContrastRatio(lightColor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
			expect(getContrastRatio(darkColor, "#111827")).toBeGreaterThanOrEqual(4.5);
			expect(lightColor).not.toBe(darkColor);
		}
	});

	it("keeps brand URLs out of the published design token record", () => {
		const vars = designVariantsToCssProperties(
			makeVariants({ brand: { logoUrl: "https://cdn.example.com/logo.svg?v=1" } }),
			false,
		);

		expect(vars["--praxity-brand-logo-url"]).toBeUndefined();
	});
});

describe("reads explicit color fields directly", () => {
	it("uses explicit colorBackgroundLight from variants, not from palette lookup", () => {
		const vars = designVariantsToCssProperties(
			{ ...DEFAULT_DESIGN_VARIANTS, colorBackgroundLight: "#ff0000" },
			false,
		);
		expect(vars["--praxity-color-background"]).toBe("#ff0000");
	});

	it("falls back to defaults when color fields are undefined", () => {
		const vars = designVariantsToCssProperties(DEFAULT_DESIGN_VARIANTS, false);
		expect(vars["--praxity-color-background"]).toBe(
			READING_PALETTES.standard.light.colorBackground,
		);
	});

	it("produces --praxity-color-focus", () => {
		const vars = designVariantsToCssProperties(DEFAULT_DESIGN_VARIANTS, false);
		expect(vars["--praxity-color-focus"]).toBeDefined();
	});

	it("produces --praxity-color-accent-light", () => {
		const vars = designVariantsToCssProperties(DEFAULT_DESIGN_VARIANTS, false);
		expect(vars["--praxity-color-accent-light"]).toBeDefined();
	});

	it("produces light semantic color variants", () => {
		const vars = designVariantsToCssProperties(DEFAULT_DESIGN_VARIANTS, false);
		expect(vars["--praxity-color-success-light"]).toBeDefined();
		expect(vars["--praxity-color-error-light"]).toBeDefined();
		expect(vars["--praxity-color-warning-light"]).toBeDefined();
	});

	it("produces --praxity-color-button-outline", () => {
		const vars = designVariantsToCssProperties(DEFAULT_DESIGN_VARIANTS, false);
		expect(vars["--praxity-color-button-outline"]).toBeDefined();
	});
});
