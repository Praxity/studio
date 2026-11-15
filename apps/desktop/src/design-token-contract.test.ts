import { DEFAULT_DESIGN_VARIANTS } from "@praxity/editor-core/lib/themes/design-variant-defaults.ts";
import { normalizeDesignVariants } from "@praxity/editor-core/lib/themes/normalize-design-variants.ts";
import {
	THEME_PRESET_DEFAULTS,
	type ThemePresetId,
} from "@praxity/editor-core/lib/themes/theme-preset-defaults.ts";
import type { DesignVariants } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import { extractDesktopDesignFromFrontmatter } from "../../../packages/export-pipeline/src/desktop-design.ts";
import { generateCourseCss } from "../../../packages/export-pipeline/src/html-gen.ts";

const CASES: Array<{ name: string; overrides: Record<string, unknown> }> = [
	{ name: "no overrides", overrides: {} },
	{
		name: "representative overrides",
		overrides: {
			colorBackgroundLight: "#fff7ed",
			colorBackgroundDark: "#172033",
			colorText: "#5b2133",
			colorAccent: "#d946ef",
			colorButtonBackground: "#facc15",
			colorButtonText: "#ffffff",
			colorSuccess: "#86efac",
			colorError: "#fecaca",
			colorWarning: "#fde68a",
			colorSecondary: "#0f766e",
			colorTertiary: "#7c3aed",
			density: "compact",
			blockSpacing: "compact",
			borderRadius: 13,
			sectionGap: 57,
			shadowIntensity: "elevated",
		},
	},
	{
		name: "invalid values",
		overrides: {
			colorBackgroundLight: "not-a-color",
			colorBackgroundDark: "oklch(broken)",
			colorText: 42,
			colorAccent: "#nope",
			colorButtonBackground: {},
			colorButtonText: "rgb(nope)",
			colorSecondary: [],
			colorTertiary: "invalid",
			density: "dense",
			blockSpacing: "huge",
			borderRadius: Number.NaN,
			headingSize: Number.POSITIVE_INFINITY,
			lineHeight: "wide",
			contentMaxWidth: null,
			shadowIntensity: "dramatic",
			sectionGap: "wide",
		},
	},
	{
		name: "legacy aliases",
		overrides: {
			colorBackground: "#f5f1e8",
			blockSpacing: "large",
			dividerStyle: "decorative",
			sectionTransition: "wave",
		},
	},
];

const MATRIX = Object.entries(THEME_PRESET_DEFAULTS).flatMap(([preset, defaults]) =>
	CASES.map(({ name, overrides }) => ({
		name: `${preset}/${name}`,
		preset: preset as ThemePresetId,
		defaults,
		overrides,
	})),
);

function normalized(
	preset: ThemePresetId,
	defaults: object,
	overrides: Record<string, unknown>,
	colorMode: "light" | "dark" | "auto",
) {
	return normalizeDesignVariants({
		...DEFAULT_DESIGN_VARIANTS,
		...defaults,
		palette: preset,
		...overrides,
		colorMode,
	});
}

function renderAutoTheme(cssVars: Record<string, string>, darkCssVars: Record<string, string>) {
	return generateCourseCss({ colorMode: "auto", cssVars, darkCssVars });
}

function darkTokenBlock(css: string): string {
	const match = css.match(
		/:root\.praxity-theme-dark, :root\.praxity-theme-dark\[data-mantine-color-scheme\] \{ ([\s\S]*?) \}/,
	);
	expect(match).not.toBeNull();
	return match?.[1] ?? "";
}

describe("exported auto colour mode", () => {
	it.each(MATRIX)(
		"$name emits the explicit dark tokens in its dark block",
		({ preset, defaults, overrides }) => {
			const design = normalized(preset, defaults, overrides, "auto");
			const exported = extractDesktopDesignFromFrontmatter({ design: design as never });
			const explicitDark = extractDesktopDesignFromFrontmatter({
				design: { ...design, colorMode: "dark" } as DesignVariants,
			});
			expect(exported.darkCssVars).toEqual(explicitDark.cssVars);

			const css = renderAutoTheme(exported.cssVars ?? {}, exported.darkCssVars ?? {});
			const darkBlock = darkTokenBlock(css);
			const emittedKeys = new Set([...darkBlock.matchAll(/(--[\w-]+):/g)].map((match) => match[1]));
			expect(emittedKeys).toEqual(new Set(Object.keys(explicitDark.cssVars ?? {})));
			for (const [key, value] of Object.entries(explicitDark.cssVars ?? {})) {
				expect(darkBlock).toContain(`${key}: ${value};`);
			}
			expect(css).toContain(":root, :root[data-mantine-color-scheme]");
		},
	);

	it.each(["light", "dark"] as const)("a fixed %s mode exports no dark block", (mode) => {
		for (const { preset, defaults, overrides } of MATRIX) {
			const exported = extractDesktopDesignFromFrontmatter({
				design: normalized(preset, defaults, overrides, mode) as never,
			});
			expect(exported.darkCssVars).toBeUndefined();
		}
	});
});
