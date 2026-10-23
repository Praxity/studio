import {
	DEFAULT_TYPOGRAPHY,
	type DesignVariants,
	fontFamilyListToCss,
	type GrammarFrontmatter,
	normalizeTypography,
	resolveDeckDesign,
} from "@praxity/grammar";
import { toNavArchetype } from "@praxity/grammar/src/nav-archetype-layout.ts";
import { getNavPreset } from "@praxity/grammar/src/nav-archetype-presets.ts";
import { colorToHex } from "@praxity/shared-blocks/color-math";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import type { CourseExportInput } from "./build";

const DEFAULT_EXPORT_DESIGN = {
	colorMode: "light",
	dividerStyle: "none",
	backgroundTexture: "none",
	highlightStyle: "none",
	navLayout: "sidebar",
	navArchetype: "sidebar",
	navOutline: true,
	navHamburgerMenu: false,
	navOutlinePosition: "left",
	navPrevNext: true,
	navPrevNextPosition: "bottom",
	navProgressStyle: "bar",
	navBottomArrows: false,
	navTopBar: true,
	navReadingSupportPlacement: "topBar",
	navFloatingToc: false,
	navScrollProgress: false,
	navEdgeArrows: false,
	navSlideCounter: true,
	navBreadcrumbs: false,
	navCourseTitle: true,
	navLessonTitles: true,
	navLessonTitleAsHeading: true,
	navReadingTime: false,
	navSwipeGestures: false,
	navKeyboardArrows: true,
	showA11yPill: true,
	glossaryPage: true,
	imageStyle: "none",
	imageHoverEffect: "none",
	imageEffectsAuto: false,
} as const;

const LEGACY_NAV_LAYOUT_MAP: Record<string, "sidebar" | "bottomBar" | "none"> = {
	sidebar: "sidebar",
	bottomBar: "bottomBar",
	none: "none",
};

type DesktopDesignExtraction = Pick<
	CourseExportInput,
	| "cssVars"
	| "darkCssVars"
	| "theme"
	| "typography"
	| "navToggles"
	| "deckDesign"
	| "navigationStyle"
	| "defaultImageTreatment"
	| "imageEffects"
	| "imageEffectsAuto"
	| "brandLogo"
	| "showCourseNameInNav"
	| "showLessonNameInNav"
	| "showLessonNameAsTitle"
	| "customCss"
	| "colorMode"
	| "dividerStyle"
	| "sectionTransition"
	| "sectionRhythm"
	| "texture"
	| "slideTransition"
	| "motionEntrance"
	| "motionStagger"
	| "imageHoverEffect"
	| "glossaryTabEnabled"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asHexColor(value: unknown): string | undefined {
	return typeof value === "string" ? (colorToHex(value) ?? undefined) : undefined;
}

function cssVarsToCamelCase(cssVars: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(cssVars)) {
		if (!key.startsWith("--praxity-")) continue;
		const camelKey = key
			.replace("--praxity-", "")
			.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
		result[camelKey] = value;
	}
	return result;
}

function resolveNavigationStyle(
	design: Record<string, unknown>,
): CourseExportInput["navigationStyle"] {
	const rawNavArchetype = asString(design.navArchetype);
	const rawNavArchetypeBase = asString(design.navArchetypeBase);
	const rawLegacyLayout = asString(design.navLayout);
	const raw =
		(rawNavArchetype === "custom" ? rawNavArchetypeBase : rawNavArchetype) ??
		(rawLegacyLayout ? (LEGACY_NAV_LAYOUT_MAP[rawLegacyLayout] ?? "sidebar") : undefined);
	// Pass the archetype through instead of collapsing it to sidebar/bottomBar/none.
	// The old three-way narrowing meant `slides` — the default for a new project —
	// reached the exporter as `sidebar`.
	return toNavArchetype(raw);
}

function resolveDesignObject(frontmatter: GrammarFrontmatter): Record<string, unknown> {
	if (!isRecord(frontmatter.design)) {
		return { ...DEFAULT_EXPORT_DESIGN };
	}

	const design = frontmatter.design as Record<string, unknown>;
	const rawArchetype = asString(design.navArchetype);
	const archetype = toNavArchetype(
		(rawArchetype === "custom" ? asString(design.navArchetypeBase) : rawArchetype) ??
			(asString(design.navLayout)
				? (LEGACY_NAV_LAYOUT_MAP[asString(design.navLayout) ?? ""] ?? "sidebar")
				: undefined),
	);
	// Nav defaults come from the archetype's preset, never from the export fallbacks.
	// Merging sidebar defaults over the archetype meant every
	// unset nav key reached the exporter already "set" to the sidebar answer, so a
	// course whose only nav setting was `navArchetype: slides` published with
	// navOutline on and navEdgeArrows / navHamburgerMenu / navSlideCounter off:
	// the slides layout class with sidebar navigation, and no slide chrome at all.
	// Explicit author toggles still win — they are spread last.
	const merged: Record<string, unknown> = {
		...DEFAULT_EXPORT_DESIGN,
		...getNavPreset(archetype),
		...design,
	};
	merged.navArchetype = archetype;

	if (design.colorSecondary !== undefined && design.colorSecondary !== null) {
		merged.colorSecondary = asHexColor(design.colorSecondary);
	}
	if (design.colorTertiary !== undefined && design.colorTertiary !== null) {
		merged.colorTertiary = asHexColor(design.colorTertiary);
	}

	if (!isRecord(merged.imageEffects)) {
		merged.imageEffects = undefined;
	}

	return merged;
}

function hasExplicitNavigationToggles(frontmatter: GrammarFrontmatter): boolean {
	if (!isRecord(frontmatter.design)) return false;
	return Object.keys(frontmatter.design).some(
		(key) => key.startsWith("nav") && key !== "navLayout",
	);
}

export function extractDesktopDesignFromFrontmatter(
	frontmatter: GrammarFrontmatter,
): DesktopDesignExtraction {
	const design = resolveDesignObject(frontmatter);
	const useNavigationToggles = hasExplicitNavigationToggles(frontmatter);
	const colorMode =
		design.colorMode === "dark" || design.colorMode === "auto" ? design.colorMode : "light";
	const normalizedDesign = design as unknown as DesignVariants;
	const cssVars = resolveDesignTokens(normalizedDesign, colorMode === "dark" ? "dark" : "light");
	const darkCssVars =
		colorMode === "auto" ? resolveDesignTokens(normalizedDesign, "dark") : undefined;
	const typography = normalizeTypography(design.typography, DEFAULT_TYPOGRAPHY);
	const bodyFont = fontFamilyListToCss(typography.body.fontFamily);
	const headingFont = fontFamilyListToCss(typography.headings.fontFamily);
	const secondary = asHexColor(design.colorSecondary);
	const tertiary = asHexColor(design.colorTertiary);
	const theme = cssVarsToCamelCase(cssVars);
	theme.customCss = asString(design.customCss) ?? "";
	theme.colorMode = colorMode;
	theme.palette = asString(design.palette) ?? "ink";
	theme.fontFamily = bodyFont;
	theme.fontHeading = headingFont;
	theme.colorBackground = cssVars["--praxity-color-background"];
	theme.colorText = cssVars["--praxity-color-text"];
	theme.colorAccent = cssVars["--praxity-color-accent"];
	theme.colorSuccess = cssVars["--praxity-color-success"];
	theme.colorError = cssVars["--praxity-color-error"];
	theme.colorWarning = cssVars["--praxity-color-warning"];
	theme.highlightStyle = cssVars["--praxity-highlight-style"];

	const navToggles: NonNullable<CourseExportInput["navToggles"]> = {
		navOutline: asBoolean(design.navOutline, DEFAULT_EXPORT_DESIGN.navOutline),
		navHamburgerMenu: asBoolean(design.navHamburgerMenu, DEFAULT_EXPORT_DESIGN.navHamburgerMenu),
		navOutlinePosition:
			design.navOutlinePosition === "right" ? "right" : DEFAULT_EXPORT_DESIGN.navOutlinePosition,
		navPrevNext: asBoolean(design.navPrevNext, DEFAULT_EXPORT_DESIGN.navPrevNext),
		navPrevNextPosition:
			design.navPrevNextPosition === "top" ? "top" : DEFAULT_EXPORT_DESIGN.navPrevNextPosition,
		navProgressStyle:
			design.navProgressStyle === "dots" ||
			design.navProgressStyle === "segments" ||
			design.navProgressStyle === "none"
				? design.navProgressStyle
				: DEFAULT_EXPORT_DESIGN.navProgressStyle,
		navBottomArrows: asBoolean(design.navBottomArrows, DEFAULT_EXPORT_DESIGN.navBottomArrows),
		navTopBar: asBoolean(design.navTopBar, DEFAULT_EXPORT_DESIGN.navTopBar),
		navReadingSupportPlacement:
			design.navReadingSupportPlacement === "topBar" ||
			design.navReadingSupportPlacement === "bottomBar" ||
			design.navReadingSupportPlacement === "sidebar" ||
			design.navReadingSupportPlacement === "none"
				? design.navReadingSupportPlacement
				: DEFAULT_EXPORT_DESIGN.navReadingSupportPlacement,
		navFloatingToc: asBoolean(design.navFloatingToc, DEFAULT_EXPORT_DESIGN.navFloatingToc),
		navScrollProgress: asBoolean(design.navScrollProgress, DEFAULT_EXPORT_DESIGN.navScrollProgress),
		navEdgeArrows: asBoolean(design.navEdgeArrows, DEFAULT_EXPORT_DESIGN.navEdgeArrows),
		navSlideCounter: asBoolean(design.navSlideCounter, DEFAULT_EXPORT_DESIGN.navSlideCounter),
		navBreadcrumbs: asBoolean(design.navBreadcrumbs, DEFAULT_EXPORT_DESIGN.navBreadcrumbs),
		navCourseTitle: asBoolean(design.navCourseTitle, DEFAULT_EXPORT_DESIGN.navCourseTitle),
		navLessonTitles: asBoolean(design.navLessonTitles, DEFAULT_EXPORT_DESIGN.navLessonTitles),
		navLessonTitleAsHeading: asBoolean(
			design.navLessonTitleAsHeading,
			DEFAULT_EXPORT_DESIGN.navLessonTitleAsHeading,
		),
		navReadingTime: asBoolean(design.navReadingTime, DEFAULT_EXPORT_DESIGN.navReadingTime),
		navSwipeGestures: asBoolean(design.navSwipeGestures, DEFAULT_EXPORT_DESIGN.navSwipeGestures),
		navKeyboardArrows: asBoolean(design.navKeyboardArrows, DEFAULT_EXPORT_DESIGN.navKeyboardArrows),
		showA11yPill: asBoolean(design.showA11yPill, DEFAULT_EXPORT_DESIGN.showA11yPill),
		colorSecondary: secondary ?? null,
		colorTertiary: tertiary ?? null,
	};

	const brand = isRecord(design.brand) ? design.brand : {};
	const logoUrl = asString(brand.logoUrl)?.trim() || asString(brand.logoDarkUrl)?.trim();
	const brandLogo: CourseExportInput["brandLogo"] =
		logoUrl && brand.logoPlacement !== "hidden"
			? {
					url: logoUrl,
					darkUrl: asString(brand.logoDarkUrl)?.trim(),
					placement: brand.logoPlacement === "sidebar" ? "sidebar" : "header",
				}
			: undefined;
	const customCss = asString(design.customCss);

	const slideTransition = asString(design.slideTransition);
	const motionEntrance = asString(design.motionEntrance);
	const motionStagger = asString(design.motionStagger);

	return {
		deckDesign: resolveDeckDesign(design.deck),
		cssVars,
		darkCssVars,
		theme,
		typography,
		navToggles: useNavigationToggles ? navToggles : undefined,
		// Author-facing key is `design.glossaryPage`; the published config calls it
		// `glossaryTabEnabled`, which is what html-gen reads.
		glossaryTabEnabled: asBoolean(design.glossaryPage, DEFAULT_EXPORT_DESIGN.glossaryPage),
		navigationStyle: resolveNavigationStyle(design),
		defaultImageTreatment: "none",
		imageEffects: undefined,
		imageEffectsAuto: false,
		brandLogo,
		showCourseNameInNav: navToggles.navCourseTitle,
		showLessonNameInNav: navToggles.navLessonTitles,
		showLessonNameAsTitle: navToggles.navLessonTitleAsHeading,
		customCss,
		colorMode: colorMode === "auto" ? "auto" : colorMode,
		dividerStyle: "none",
		sectionTransition: "none",
		sectionRhythm: "uniform",
		texture: "none",
		slideTransition:
			slideTransition === "fade" || slideTransition === "slide" || slideTransition === "zoom"
				? slideTransition
				: "none",
		motionEntrance:
			motionEntrance === "fade" || motionEntrance === "slide" || motionEntrance === "scale"
				? motionEntrance
				: "none",
		motionStagger: motionStagger === "sequential" ? "sequential" : "none",
		imageHoverEffect: "none",
	};
}
