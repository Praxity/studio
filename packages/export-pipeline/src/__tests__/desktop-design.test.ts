import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { READING_PALETTES } from "@praxity/shared-blocks/themes/reading-palettes";
import { describe, expect, it } from "vitest";
import { designVariantsToCssProperties } from "../../../editor-core/src/lib/themes/design-variants-to-css.ts";
import { normalizeDesignVariants } from "../../../editor-core/src/lib/themes/normalize-design-variants.ts";
import { extractDesktopDesignFromFrontmatter } from "../desktop-design.ts";
import { generateCourseCss } from "../html-gen.ts";

describe("desktop design colours", () => {
	it.each(["light", "dark", "auto"] as const)(
		"preserves the persisted Book pairing in published %s CSS",
		(colorMode) => {
			const exported = extractDesktopDesignFromFrontmatter({
				design: normalizeDesignVariants({ typography: { pairing: "book" }, colorMode }),
			});
			expect(generateCourseCss(exported)).toContain(
				"--praxity-font-heading: 'Source Serif 4', serif;",
			);
		},
	);

	it("retains the preset ID and quiet paper at the published CSS boundary", () => {
		const exported = extractDesktopDesignFromFrontmatter({
			design: normalizeDesignVariants({ palette: "clay" }),
		});
		expect(exported.theme?.palette).toBe("clay");
		expect(generateCourseCss(exported)).toContain("--paper-2: #f4f6f8");
	});

	it("retires persisted bands, texture and image treatments", () => {
		const exported = extractDesktopDesignFromFrontmatter({
			design: {
				palette: "darkroom",
				sectionRhythmMode: "alternate",
				sectionDarkBackground: "#211a2c",
				backgroundTexture: "grain",
				imageStyle: "grayscale",
				imageHoverEffect: "lift",
				imageEffectsAuto: true,
				imageEffects: { grain: { intensity: 25 } },
			} as never,
		});
		expect(exported).toMatchObject({
			sectionRhythm: "uniform",
			texture: "none",
			dividerStyle: "none",
			defaultImageTreatment: "none",
			imageHoverEffect: "none",
			imageEffectsAuto: false,
		});
		expect(exported.imageEffects).toBeUndefined();
	});
	it("keeps a dark-only logo available after uploading it or removing the light logo", () => {
		expect(
			extractDesktopDesignFromFrontmatter({
				design: {
					brand: { logoUrl: undefined, logoDarkUrl: "/assets/dark.svg", logoPlacement: "header" },
				} as never,
			}).brandLogo,
		).toEqual({ url: "/assets/dark.svg", darkUrl: "/assets/dark.svg", placement: "header" });
	});
	it("carries local branding settings and honors hidden placement", () => {
		const brand = {
			logoUrl: "/assets/logo.svg",
			logoDarkUrl: "/assets/dark.svg",
			logoPlacement: "center",
			logoScope: "title-only",
		};
		expect(extractDesktopDesignFromFrontmatter({ design: { brand } as never }).brandLogo).toEqual({
			url: brand.logoUrl,
			darkUrl: brand.logoDarkUrl,
			placement: "header",
		});
		expect(
			extractDesktopDesignFromFrontmatter({
				design: { brand: { ...brand, logoPlacement: "hidden" } } as never,
			}).brandLogo,
		).toBeUndefined();
	});

	it.each(["sidebar", "header"] as const)("preserves %s logo placement", (placement) => {
		expect(
			extractDesktopDesignFromFrontmatter({
				design: { brand: { logoUrl: "/assets/logo.svg", logoPlacement: placement } } as never,
			}).brandLogo?.placement,
		).toBe(placement);
	});

	it.each(["#dc2626", "oklch(57.7% 0.215 27.3)"])(
		"normalizes %s identically for editor preview and export",
		(colorAccent) => {
			const frontmatter = { design: { colorAccent } as never };
			const preview = normalizeDesignVariants(frontmatter.design);
			const exported = extractDesktopDesignFromFrontmatter(frontmatter);

			expect(designVariantsToCssProperties(preview, false)["--praxity-color-accent"]).toBe(
				exported.cssVars?.["--praxity-color-accent"],
			);
		},
	);

	it("falls back identically when persisted colour input is malformed", () => {
		const frontmatter = { design: { colorAccent: "oklch(broken)" } as never };
		const preview = normalizeDesignVariants(frontmatter.design);
		const exported = extractDesktopDesignFromFrontmatter(frontmatter);

		expect(designVariantsToCssProperties(preview, false)["--praxity-color-accent"]).toBe(
			exported.cssVars?.["--praxity-color-accent"],
		);
		expect(preview.colorAccent).toBe(READING_PALETTES.standard.light.colorAccent);
	});

	it("exports separate compliant status colours for light and dark backgrounds", () => {
		const design = {
			colorBackgroundLight: "#ffffff",
			colorBackgroundDark: "#111827",
			colorSuccessOnLight: "#b7e4c7",
			colorSuccessOnDark: "#14532d",
			colorErrorOnLight: "#fecaca",
			colorErrorOnDark: "#7f1d1d",
			colorWarningOnLight: "#fde68a",
			colorWarningOnDark: "#78350f",
		};
		const lightVars = extractDesktopDesignFromFrontmatter({
			design: { ...design, colorMode: "light" } as never,
		}).cssVars;
		const darkVars = extractDesktopDesignFromFrontmatter({
			design: { ...design, colorMode: "dark" } as never,
		}).cssVars;

		for (const name of ["success", "error", "warning"] as const) {
			const light = lightVars?.[`--praxity-color-${name}-on-light`] ?? "";
			const dark = darkVars?.[`--praxity-color-${name}-on-dark`] ?? "";
			expect(contrastRatio(light, "#ffffff")).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(dark, "#111827")).toBeGreaterThanOrEqual(4.5);
			expect(light).not.toBe(dark);
		}
	});
});

it("extracts deck settings independently of standard navigation presets", () => {
	const deck = {
		preset: "custom",
		initialPanel: "transcript",
		outline: false,
		outlineDetail: "moduleLinks",
		slideCounter: false,
		followNarration: false,
		autoAdvance: false,
	} as const;
	for (const navArchetype of ["sidebar", "slides", "minimal"]) {
		expect(
			extractDesktopDesignFromFrontmatter({ design: { deck, navArchetype } as never }).deckDesign,
		).toEqual({ ...deck, sequentialLessons: false });
		expect(
			extractDesktopDesignFromFrontmatter({
				design: { deck: { ...deck, sequentialLessons: true }, navArchetype } as never,
			}).deckDesign,
		).toEqual({ ...deck, sequentialLessons: true });
	}
	expect(extractDesktopDesignFromFrontmatter({}).deckDesign).toMatchObject({
		outline: true,
		outlineDetail: "moduleLinks",
		initialPanel: "closed",
		slideCounter: true,
		followNarration: true,
		autoAdvance: false,
		sequentialLessons: false,
	});
});
