import {
	BOOLEAN_NAV_KEYS,
	type DesignVariants,
	getNavPreset,
	migrateCoursePresetDesign,
	normalizeDeckDesign,
	normalizeTypography,
	PROGRESS_STYLES,
	READING_SUPPORT_PLACEMENTS,
} from "@praxity/grammar";
import { NAV_PRESET_KEYS } from "@praxity/grammar/src/nav-archetype-presets.ts";
import { colorToHex } from "@praxity/shared-blocks/color-math";
import { DEFAULT_DESIGN_VARIANTS } from "./design-variant-defaults";
import {
	THEME_PRESET_ALIASES,
	THEME_PRESET_DEFAULTS,
	type ThemePresetId,
} from "./theme-preset-defaults";

const LOGO_PLACEMENTS = new Set(["sidebar", "header", "hidden"]);
const LOGO_SCOPES = new Set(["all-pages", "title-only"]);
const NAV_LAYOUTS = new Set(["sidebar", "bottomBar", "none"]);
const NAV_ARCHETYPES = new Set([
	"sidebar",
	"bottomBar",
	"slides",
	"scroll",
	"minimal",
	"embedded",
	"none",
	"custom",
]);
const NAV_OUTLINE_POSITIONS = new Set(["left", "right"]);
const NAV_PREV_NEXT_POSITIONS = new Set(["bottom", "top"]);
const NAV_PROGRESS_STYLES = new Set<string>(PROGRESS_STYLES);
const NAV_READING_SUPPORT_PLACEMENTS = new Set<string>(READING_SUPPORT_PLACEMENTS);
const MOTION_ENTRANCES = new Set(["none", "fade", "slide", "scale"]);
const MOTION_STAGGERS = new Set(["none", "sequential"]);
const SLIDE_TRANSITIONS = new Set(["none", "fade", "slide", "zoom"]);
const BLOCK_SPACINGS = new Set(["compact", "default", "spacious"]);
const LEGACY_BLOCK_SPACING_MAP: Record<string, NonNullable<DesignVariants["blockSpacing"]>> = {
	none: "compact",
	vsmall: "compact",
	small: "compact",
	medium: "default",
	large: "spacious",
	xlarge: "spacious",
};
const HIGHLIGHT_STYLES = new Set(["none", "marker", "gradient", "scribble"]);
const DEFAULT_DARK_BACKGROUND = "#111827";
const DEFAULT_LIGHT_BACKGROUND = "#faf9f7";

export const DESIGN_NUMBER_RANGES = {
	accentHue: { min: 0, max: 360, step: 1 },
	headingSize: { min: 1.6, max: 3.2, step: 0.2 },
	lineHeight: { min: 1.2, max: 2, step: 0.1 },
} as const;
type DesignNumberKey = keyof typeof DESIGN_NUMBER_RANGES;
export interface DesignNumberDiagnostic {
	key: DesignNumberKey;
	storedValue: unknown;
	value: number;
	reason: "notNumber" | "outOfRange";
}

function normalizeDesignNumber(key: DesignNumberKey, value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DESIGN_VARIANTS[key];
	const { min, max } = DESIGN_NUMBER_RANGES[key];
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export function designNumberControlValue(value: number): string {
	const rounded = value.toFixed(1);
	return Number(rounded) === value ? rounded : String(value);
}

export function getDesignNumberDiagnostics(design: unknown): DesignNumberDiagnostic[] {
	if (!design || typeof design !== "object" || Array.isArray(design)) return [];
	const raw = design as Record<string, unknown>;
	return (Object.keys(DESIGN_NUMBER_RANGES) as DesignNumberKey[]).flatMap((key) => {
		const storedValue = raw[key];
		if (storedValue === undefined) return [];
		const value = normalizeDesignNumber(key, storedValue);
		if (Object.is(value, storedValue)) return [];
		return [
			{
				key,
				storedValue,
				value,
				reason:
					typeof storedValue === "number" && Number.isFinite(storedValue)
						? "outOfRange"
						: "notNumber",
			},
		];
	});
}

function parseColor(value: unknown): string | null {
	return typeof value === "string" ? colorToHex(value) : null;
}

function deriveInverseBackground(hex: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return luminance > 0.5 ? DEFAULT_DARK_BACKGROUND : DEFAULT_LIGHT_BACKGROUND;
}

function normalizeBrand(brand: unknown): DesignVariants["brand"] {
	if (!brand || typeof brand !== "object" || Array.isArray(brand)) {
		return undefined;
	}

	const raw = brand as Record<string, unknown>;
	const normalized: NonNullable<DesignVariants["brand"]> = {};

	if (typeof raw.logoUrl === "string" && raw.logoUrl.length > 0) {
		normalized.logoUrl = raw.logoUrl;
	}
	if (typeof raw.logoDarkUrl === "string" && raw.logoDarkUrl.length > 0) {
		normalized.logoDarkUrl = raw.logoDarkUrl;
	}
	if (typeof raw.logoPlacement === "string" && LOGO_PLACEMENTS.has(raw.logoPlacement)) {
		normalized.logoPlacement = raw.logoPlacement as NonNullable<
			DesignVariants["brand"]
		>["logoPlacement"];
	} else {
		normalized.logoPlacement = "header";
	}
	if (typeof raw.logoScope === "string" && LOGO_SCOPES.has(raw.logoScope)) {
		normalized.logoScope = raw.logoScope as NonNullable<DesignVariants["brand"]>["logoScope"];
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeDesignVariants(design: unknown): DesignVariants {
	if (!design || typeof design !== "object" || Array.isArray(design)) {
		return normalizeDesignVariants({});
	}

	const inputDesign = migrateCoursePresetDesign(design as Record<string, unknown>);
	const rawPalette = typeof inputDesign.palette === "string" ? inputDesign.palette : undefined;
	const palette =
		rawPalette && Object.hasOwn(THEME_PRESET_ALIASES, rawPalette)
			? THEME_PRESET_ALIASES[rawPalette]
			: rawPalette;
	const presetDefaults =
		palette && Object.hasOwn(THEME_PRESET_DEFAULTS, palette)
			? THEME_PRESET_DEFAULTS[palette as ThemePresetId]
			: undefined;
	const rawDesign: Record<string, unknown> = {
		...presetDefaults,
		...inputDesign,
		...(palette ? { palette } : {}),
	};
	const colorMode =
		rawDesign.colorMode === "light" ||
		rawDesign.colorMode === "dark" ||
		rawDesign.colorMode === "auto"
			? rawDesign.colorMode
			: DEFAULT_DESIGN_VARIANTS.colorMode;
	const motionEntrance =
		typeof rawDesign.motionEntrance === "string" && MOTION_ENTRANCES.has(rawDesign.motionEntrance)
			? (rawDesign.motionEntrance as NonNullable<DesignVariants["motionEntrance"]>)
			: DEFAULT_DESIGN_VARIANTS.motionEntrance;
	const navLayout =
		typeof rawDesign.navLayout === "string" && NAV_LAYOUTS.has(rawDesign.navLayout)
			? (rawDesign.navLayout as NonNullable<DesignVariants["navLayout"]>)
			: DEFAULT_DESIGN_VARIANTS.navLayout;
	const motionStagger =
		typeof rawDesign.motionStagger === "string" && MOTION_STAGGERS.has(rawDesign.motionStagger)
			? (rawDesign.motionStagger as NonNullable<DesignVariants["motionStagger"]>)
			: DEFAULT_DESIGN_VARIANTS.motionStagger;
	const slideTransition =
		typeof rawDesign.slideTransition === "string" &&
		SLIDE_TRANSITIONS.has(rawDesign.slideTransition)
			? (rawDesign.slideTransition as NonNullable<DesignVariants["slideTransition"]>)
			: DEFAULT_DESIGN_VARIANTS.slideTransition;
	const highlightStyle =
		typeof rawDesign.highlightStyle === "string" && HIGHLIGHT_STYLES.has(rawDesign.highlightStyle)
			? (rawDesign.highlightStyle as DesignVariants["highlightStyle"])
			: DEFAULT_DESIGN_VARIANTS.highlightStyle;
	const blockSpacing =
		typeof rawDesign.blockSpacing === "string" && BLOCK_SPACINGS.has(rawDesign.blockSpacing)
			? (rawDesign.blockSpacing as NonNullable<DesignVariants["blockSpacing"]>)
			: typeof rawDesign.blockSpacing === "string"
				? (LEGACY_BLOCK_SPACING_MAP[rawDesign.blockSpacing] ?? DEFAULT_DESIGN_VARIANTS.blockSpacing)
				: DEFAULT_DESIGN_VARIANTS.blockSpacing;
	// Not a nav key: the glossary page survives an archetype change, so it must not be
	// reset from a nav preset like the keys in BOOLEAN_NAV_KEYS are.
	const glossaryPage = typeof rawDesign.glossaryPage === "boolean" ? rawDesign.glossaryPage : true;
	const navArchetype =
		typeof rawDesign.navArchetype === "string" && NAV_ARCHETYPES.has(rawDesign.navArchetype)
			? (rawDesign.navArchetype as NonNullable<DesignVariants["navArchetype"]>)
			: navLayout;
	const navArchetypeBase =
		typeof rawDesign.navArchetypeBase === "string" && NAV_ARCHETYPES.has(rawDesign.navArchetypeBase)
			? (rawDesign.navArchetypeBase as NonNullable<DesignVariants["navArchetypeBase"]>)
			: undefined;
	const resolvedNavArchetype =
		navArchetype === "custom" ? (navArchetypeBase ?? "sidebar") : navArchetype;
	// The enum-valued nav keys default from the archetype for the same reason the
	// boolean ones do (see the loop below). Reading the global default table here
	// meant a `slides` course silently resolved `navProgressStyle: "bar"` instead
	// of the preset's `"dots"`, so CourseViewer never rendered ProgressDots at all
	// — the dots were absent from the DOM, not hidden by CSS.
	const navArchetypePreset = getNavPreset(resolvedNavArchetype ?? "sidebar");
	const navOutlinePosition =
		typeof rawDesign.navOutlinePosition === "string" &&
		NAV_OUTLINE_POSITIONS.has(rawDesign.navOutlinePosition)
			? (rawDesign.navOutlinePosition as NonNullable<DesignVariants["navOutlinePosition"]>)
			: navArchetypePreset.navOutlinePosition;
	const navPrevNextPosition =
		typeof rawDesign.navPrevNextPosition === "string" &&
		NAV_PREV_NEXT_POSITIONS.has(rawDesign.navPrevNextPosition)
			? (rawDesign.navPrevNextPosition as NonNullable<DesignVariants["navPrevNextPosition"]>)
			: navArchetypePreset.navPrevNextPosition;
	const navProgressStyle =
		typeof rawDesign.navProgressStyle === "string" &&
		NAV_PROGRESS_STYLES.has(rawDesign.navProgressStyle)
			? (rawDesign.navProgressStyle as NonNullable<DesignVariants["navProgressStyle"]>)
			: navArchetypePreset.navProgressStyle;
	const navReadingSupportPlacement =
		typeof rawDesign.navReadingSupportPlacement === "string" &&
		NAV_READING_SUPPORT_PLACEMENTS.has(rawDesign.navReadingSupportPlacement)
			? (rawDesign.navReadingSupportPlacement as NonNullable<
					DesignVariants["navReadingSupportPlacement"]
				>)
			: navArchetypePreset.navReadingSupportPlacement;
	const colorSecondary =
		parseColor(rawDesign.colorSecondary) ??
		(rawDesign.colorSecondary === null ? null : DEFAULT_DESIGN_VARIANTS.colorSecondary);
	const colorTertiary =
		parseColor(rawDesign.colorTertiary) ??
		(rawDesign.colorTertiary === null ? null : DEFAULT_DESIGN_VARIANTS.colorTertiary);
	const colorText = parseColor(rawDesign.colorText) ?? DEFAULT_DESIGN_VARIANTS.colorText;
	const colorAccent = parseColor(rawDesign.colorAccent) ?? DEFAULT_DESIGN_VARIANTS.colorAccent;
	const colorButtonBackground =
		parseColor(rawDesign.colorButtonBackground) ?? DEFAULT_DESIGN_VARIANTS.colorButtonBackground;
	const colorButtonText =
		parseColor(rawDesign.colorButtonText) ?? DEFAULT_DESIGN_VARIANTS.colorButtonText;
	const colorSuccess = parseColor(rawDesign.colorSuccess) ?? DEFAULT_DESIGN_VARIANTS.colorSuccess;
	const colorError = parseColor(rawDesign.colorError) ?? DEFAULT_DESIGN_VARIANTS.colorError;
	const colorWarning = parseColor(rawDesign.colorWarning) ?? DEFAULT_DESIGN_VARIANTS.colorWarning;
	const colorSuccessOnLight = parseColor(rawDesign.colorSuccessOnLight) ?? undefined;
	const colorSuccessOnDark = parseColor(rawDesign.colorSuccessOnDark) ?? undefined;
	const colorErrorOnLight = parseColor(rawDesign.colorErrorOnLight) ?? undefined;
	const colorErrorOnDark = parseColor(rawDesign.colorErrorOnDark) ?? undefined;
	const colorWarningOnLight = parseColor(rawDesign.colorWarningOnLight) ?? undefined;
	const colorWarningOnDark = parseColor(rawDesign.colorWarningOnDark) ?? undefined;
	const accentHue = normalizeDesignNumber("accentHue", rawDesign.accentHue);
	const legacyBackground = parseColor(rawDesign.colorBackground);
	const explicitBackgroundLight = parseColor(rawDesign.colorBackgroundLight);
	const explicitBackgroundDark = parseColor(rawDesign.colorBackgroundDark);
	const colorBackgroundLight =
		explicitBackgroundLight ??
		(legacyBackground && colorMode !== "dark" ? legacyBackground : null) ??
		(explicitBackgroundDark ? deriveInverseBackground(explicitBackgroundDark) : null) ??
		(legacyBackground ? deriveInverseBackground(legacyBackground) : null) ??
		DEFAULT_DESIGN_VARIANTS.colorBackgroundLight ??
		DEFAULT_LIGHT_BACKGROUND;
	const colorBackgroundDark =
		explicitBackgroundDark ??
		(legacyBackground && colorMode === "dark" ? legacyBackground : null) ??
		(explicitBackgroundLight ? deriveInverseBackground(explicitBackgroundLight) : null) ??
		(legacyBackground ? deriveInverseBackground(legacyBackground) : null) ??
		DEFAULT_DESIGN_VARIANTS.colorBackgroundDark ??
		DEFAULT_DARK_BACKGROUND;
	const colorBackground = colorMode === "dark" ? colorBackgroundDark : colorBackgroundLight;
	// Pairing migration reads persisted fields before palette defaults are merged.
	const typography = normalizeTypography(inputDesign.typography);

	const result: DesignVariants = {
		...DEFAULT_DESIGN_VARIANTS,
		...(rawDesign as Partial<DesignVariants>),
		colorMode,
		accentHue,
		headingSize: normalizeDesignNumber("headingSize", rawDesign.headingSize),
		lineHeight: normalizeDesignNumber("lineHeight", rawDesign.lineHeight),
		colorBackgroundLight,
		colorBackgroundDark,
		colorBackground,
		colorText,
		colorAccent,
		colorButtonBackground,
		colorButtonText,
		colorSuccess,
		colorError,
		colorWarning,
		colorSuccessOnLight,
		colorSuccessOnDark,
		colorErrorOnLight,
		colorErrorOnDark,
		colorWarningOnLight,
		colorWarningOnDark,
		typography,
		dividerStyle: "none",
		sectionRhythmMode: "uniform",
		sectionDarkBackground: undefined,
		sectionAccentBackground: undefined,
		sectionTransition: "none",
		...(rawDesign.deck === undefined ? {} : { deck: normalizeDeckDesign(rawDesign.deck) }),
		navLayout,
		navArchetype,
		navArchetypeBase,
		navOutlinePosition,
		navPrevNextPosition,
		navProgressStyle,
		navReadingSupportPlacement,
		colorSecondary,
		colorTertiary,
		motionEntrance,
		motionStagger,
		slideTransition,
		imageStyle: "none",
		imageHoverEffect: "none",
		backgroundTexture: "none",
		highlightStyle,
		blockSpacing,
		imageEffects: undefined,
		imageEffectsAuto: false,
		glossaryPage,
		brand: normalizeBrand(rawDesign.brand),
	};
	// Retired persisted setting: old .prax files may still carry it, but it must
	// not be normalized back into editor state or saved again.
	delete (result as unknown as Record<string, unknown>).showBrandingPill;

	// Defaults for unset nav keys come from the archetype's preset. Filling
	// sidebar defaults here reads as explicit author overrides downstream and
	// silently cancels `navArchetype` (e.g. frontmatter-only `slides`).
	for (const key of BOOLEAN_NAV_KEYS) {
		const presetValue = navArchetypePreset[key as keyof typeof navArchetypePreset];
		result[key] =
			typeof rawDesign[key] === "boolean"
				? (rawDesign[key] as DesignVariants[typeof key])
				: ((typeof presetValue === "boolean"
						? presetValue
						: DEFAULT_DESIGN_VARIANTS[key]) as DesignVariants[typeof key]);
	}

	// Defaults belong to the effective navigation resolver, not authored lesson data.
	// Materializing them here would override course settings on any later design edit.
	for (const key of [
		...NAV_PRESET_KEYS,
		"navLayout",
		"navArchetype",
		"navArchetypeBase",
		"glossaryPage",
	] as const) {
		if (inputDesign[key] === undefined) delete result[key];
	}

	return result;
}
