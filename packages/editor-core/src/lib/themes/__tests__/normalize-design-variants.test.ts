import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { describe, expect, it } from "vitest";
import { getDesignNumberDiagnostics, normalizeDesignVariants } from "../normalize-design-variants";
import { THEME_PRESET_DEFAULTS } from "../theme-preset-defaults";

describe("stored design numbers", () => {
	it("keeps signed zero inside the hue range without a diagnostic", () => {
		expect(normalizeDesignVariants({ accentHue: -0 }).accentHue).toBe(-0);
		expect(getDesignNumberDiagnostics({ accentHue: -0 })).toEqual([]);
	});
	it.each([
		["headingSize", null, 2.375],
		["headingSize", "large", 2.375],
		["lineHeight", null, 1.55],
		["lineHeight", Number.NaN, 1.55],
		["headingSize", Number.POSITIVE_INFINITY, 2.375],
		["headingSize", -42.5, 1.6],
		["headingSize", 1_000_000, 3.2],
		["lineHeight", 0, 1.2],
		["lineHeight", 1_000_000, 2],
		["accentHue", -42.5, 0],
		["accentHue", 1_000_000, 360],
	] as const)("renders %s=%s as %s without changing the stored input", (key, value, expected) => {
		const input = Object.freeze({ [key]: value });
		expect(normalizeDesignVariants(input)[key]).toBe(expected);
		expect(input[key]).toBe(value);
	});
});

describe("normalizeDesignVariants image-effect boundaries", () => {
	it("normalizes current and legacy logo placement values", () => {
		expect(normalizeDesignVariants({ brand: { logoPlacement: "sidebar" } }).brand).toEqual({
			logoPlacement: "sidebar",
		});
		expect(normalizeDesignVariants({ brand: { logoPlacement: "hidden" } }).brand).toEqual({
			logoPlacement: "hidden",
		});
		for (const logoPlacement of [undefined, "left", "center", "elsewhere"]) {
			expect(normalizeDesignVariants({ brand: { logoPlacement } }).brand).toEqual({
				logoPlacement: "header",
			});
		}
	});

	it("retains legacy logo scope without exposing it as placement", () => {
		expect(
			normalizeDesignVariants({ brand: { logoPlacement: "left", logoScope: "title-only" } }).brand,
		).toEqual({ logoPlacement: "header", logoScope: "title-only" });
	});

	it("discards retired texture, section darkness and image treatments", () => {
		const design = normalizeDesignVariants({
			backgroundTexture: "grain",
			sectionRhythmMode: "alternate",
			sectionDarkBackground: "#221122",
			imageStyle: "grayscale",
			imageEffectsAuto: true,
			imageHoverEffect: "tilt",
			imageEffects: { grain: { intensity: 25 } },
		});
		expect(design).toMatchObject({
			backgroundTexture: "none",
			sectionRhythmMode: "uniform",
			imageStyle: "none",
			imageEffectsAuto: false,
			imageHoverEffect: "none",
		});
		expect(design.imageEffects).toBeUndefined();
		expect(design.sectionDarkBackground).toBeUndefined();
	});

	it("seeds every known palette while preserving aliases, overrides, and unknown IDs", () => {
		expect(normalizeDesignVariants({ palette: "campfire" }).colorAccent).toBe(
			THEME_PRESET_DEFAULTS.campfire.colorAccent,
		);
		expect(normalizeDesignVariants({ palette: "editorial", colorAccent: "#123456" })).toMatchObject(
			{
				palette: "clay",
				colorAccent: "#123456",
			},
		);
		expect(normalizeDesignVariants({ palette: "future-theme" }).palette).toBe("future-theme");
		expect(normalizeDesignVariants({ palette: "waves" })).toMatchObject({
			palette: "ink",
			colorAccent: THEME_PRESET_DEFAULTS.waves.colorAccent,
		});
		expect(normalizeDesignVariants({ palette: "minimal" }).palette).toBe("ink");
	});

	it.each(["constructor", "toString", "__proto__"])(
		"preserves the unknown %s palette without reading object prototypes",
		(palette) => {
			const normalized = normalizeDesignVariants({ palette });

			expect(normalized.palette).toBe(palette);
			expect(resolveDesignTokens(normalized, "light")["--praxity-color-background"]).toMatch(
				/^#[0-9a-f]{6}$/i,
			);
		},
	);
});

it("preserves absent identity switches and explicit header/title choices", () => {
	const absent = normalizeDesignVariants({});
	expect(absent.navTopBar).toBeUndefined();
	expect(absent.navCourseTitle).toBeUndefined();
	expect(absent.navLessonTitles).toBeUndefined();
	expect(
		normalizeDesignVariants({ navTopBar: true, navCourseTitle: false, navLessonTitles: false }),
	).toMatchObject({ navTopBar: true, navCourseTitle: false, navLessonTitles: false });
});

it("keeps navigation sparse while retaining explicit default-valued overrides", () => {
	for (const source of [undefined, {}]) {
		const normalized = normalizeDesignVariants(source);
		expect(normalized.navArchetype).toBeUndefined();
		expect(normalized.navPrevNext).toBeUndefined();
		expect(normalized.navProgressStyle).toBeUndefined();
	}
	expect(
		normalizeDesignVariants({
			navArchetype: "slides",
			navPrevNext: false,
			navOutline: true,
			navProgressStyle: "dots",
		}),
	).toMatchObject({
		navArchetype: "slides",
		navPrevNext: false,
		navOutline: true,
		navProgressStyle: "dots",
	});
});
