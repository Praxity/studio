import {
	COURSE_PRESET_ALIASES,
	type COURSE_PRESET_IDS,
	createTypography,
	type DesignVariants,
	withCoursePresetAliases,
} from "@praxity/grammar";
import { READING_PALETTES } from "@praxity/shared-blocks/themes/reading-palettes";
import { DEFAULT_DESIGN_VARIANTS } from "./design-variant-defaults";
import { srgbToOklch } from "./oklch";

export type ThemePresetId = keyof typeof COURSE_PRESET_ALIASES;
export const THEME_PRESET_ALIASES = COURSE_PRESET_ALIASES as Record<
	string,
	(typeof COURSE_PRESET_IDS)[number]
>;
export const THEME_PRESET_ACCENT_COUNT = Object.fromEntries(
	Object.keys(COURSE_PRESET_ALIASES).map((id) => [id, 1]),
) as Record<ThemePresetId, 1>;

const shared = {
	...DEFAULT_DESIGN_VARIANTS,
	colorMode: "light",
	shadowIntensity: "flat",
	sectionRhythmMode: "uniform",
	sectionTransition: "none",
	dividerStyle: "none",
	backgroundTexture: "none",
	motionEntrance: "none",
	motionStagger: "none",
	slideTransition: "none",
	sectionDarkBackground: undefined,
	sectionAccentBackground: undefined,
	accentOnDark: undefined,
	imageStyle: "none",
	imageHoverEffect: "none",
	imageEffects: undefined,
	imageEffectsAuto: false,
	colorSuccessOnLight: undefined,
	colorSuccessOnDark: undefined,
	colorErrorOnLight: undefined,
	colorErrorOnDark: undefined,
	colorWarningOnLight: undefined,
	colorWarningOnDark: undefined,
} satisfies Partial<DesignVariants>;

function defaults(id: (typeof COURSE_PRESET_IDS)[number]): DesignVariants {
	const colors = READING_PALETTES[id];
	return {
		...shared,
		...colors.light,
		palette: id,
		colorBackgroundLight: colors.light.colorBackground,
		colorBackgroundDark: colors.dark.colorBackground,
		accentHue: Math.round(srgbToOklch(colors.light.colorAccent).h),
		accentHueCustomized: false,
		typography:
			id === "clear"
				? createTypography("Atkinson Hyperlegible Next", "Atkinson Hyperlegible Next")
				: createTypography("Source Sans 3", "Source Sans 3"),
	} satisfies Partial<DesignVariants>;
}

export const THEME_PRESET_DEFAULTS = withCoursePresetAliases({
	ink: defaults("ink"),
	forest: defaults("forest"),
	plum: defaults("plum"),
	clay: defaults("clay"),
	clear: defaults("clear"),
});
