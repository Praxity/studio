import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN_VARIANTS } from "../design-variant-defaults";
import { designVariantsToCssProperties } from "../design-variants-to-css";
import { deriveSectionPalettes } from "../resolve-theme";

describe("designVariantsToCssProperties", () => {
	it("returns --praxity-* css vars from design variants", () => {
		const theme = designVariantsToCssProperties(DEFAULT_DESIGN_VARIANTS, false);
		expect(theme["--praxity-color-background"]).toBeDefined();
		expect(theme["--praxity-color-text"]).toBeDefined();
		expect(theme["--praxity-color-accent"]).toBeDefined();
		expect(theme["--praxity-font-family"]).toBeDefined();
	});

	it("uses explicit color overrides from DesignVariants", () => {
		const theme = designVariantsToCssProperties(
			{
				...DEFAULT_DESIGN_VARIANTS,
				colorBackgroundLight: "#010203",
				colorBackgroundDark: "#010203",
				colorText: "#fefefe",
				colorAccent: "#ff00aa",
				colorButtonBackground: "#111111",
				colorButtonText: "#ffffff",
			},
			false,
		);

		expect(theme["--praxity-color-background"]).toBe("#010203");
		expect(theme["--praxity-color-text"]).toBe("#fefefe");
		expect(theme["--praxity-color-button-background"]).toBe("#ff00aa");
		expect(theme["--praxity-color-button-text"]).toBe("#121417");
	});
});

describe("deriveSectionPalettes", () => {
	it("derives all named section palettes", () => {
		const palettes = deriveSectionPalettes({
			background: "#faf9f7",
			text: "#1e293b",
			accent: "#4269d0",
		});

		expect(palettes.light).toBeDefined();
		expect(palettes.dark).toBeDefined();
		expect(palettes.accent).toBeDefined();
		expect(palettes.warm).toBeDefined();
		expect(palettes.cool).toBeDefined();
		expect(palettes.growth).toBeDefined();
	});
});
