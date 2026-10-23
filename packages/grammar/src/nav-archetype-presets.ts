import type { NavArchetype } from "./types.ts";

/**
 * The nav toggles each archetype implies when the author has not overridden
 * them.
 *
 * These presets live in `grammar` rather than `editor-core` because both sides
 * of the pipeline need them and they must not drift: the desktop editor resolves
 * them for the live preview, and `export-pipeline`'s `desktop-design.ts` resolves
 * them for the published package. While the exporter had its own sidebar-shaped
 * default table, a course whose only nav setting was `navArchetype: slides`
 * exported with `navOutline: true`, `navEdgeArrows: false`,
 * `navHamburgerMenu: false`, `navSlideCounter: false` and `navProgressStyle: bar`
 * — the slides layout class with sidebar navigation, so the published slides had
 * no edge arrows, no hamburger outline, no counter and no dots.
 */
export interface NavToggleValues {
	navOutline: boolean;
	navHamburgerMenu: boolean;
	navOutlinePosition: "left" | "right";
	navPrevNext: boolean;
	navPrevNextPosition: "bottom" | "top";
	navProgressStyle: "bar" | "dots" | "segments" | "none";
	navBottomArrows: boolean;
	navTopBar: boolean;
	navReadingSupportPlacement: "topBar" | "bottomBar" | "sidebar" | "none";
	navFloatingToc: boolean;
	navScrollProgress: boolean;
	navEdgeArrows: boolean;
	navSlideCounter: boolean;
	navBreadcrumbs: boolean;
	navCourseTitle: boolean;
	navLessonTitles: boolean;
	navLessonTitleAsHeading: boolean;
	navReadingTime: boolean;
	navSwipeGestures: boolean;
	navKeyboardArrows: boolean;
	showA11yPill: boolean;
}

const PRESETS: Record<Exclude<NavArchetype, "custom">, NavToggleValues> = {
	sidebar: {
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
	},
	bottomBar: {
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
		navBreadcrumbs: true,
		navCourseTitle: true,
		navLessonTitles: true,
		navLessonTitleAsHeading: true,
		navReadingTime: false,
		navSwipeGestures: false,
		navKeyboardArrows: true,
		showA11yPill: true,
	},
	slides: {
		navOutline: false,
		navHamburgerMenu: true,
		navOutlinePosition: "left",
		navPrevNext: false,
		navPrevNextPosition: "bottom",
		navProgressStyle: "dots",
		navBottomArrows: true,
		navTopBar: false,
		navReadingSupportPlacement: "bottomBar",
		navFloatingToc: false,
		navScrollProgress: false,
		navEdgeArrows: false,
		navSlideCounter: true,
		navBreadcrumbs: false,
		navCourseTitle: false,
		navLessonTitles: false,
		navLessonTitleAsHeading: false,
		navReadingTime: false,
		navSwipeGestures: true,
		navKeyboardArrows: true,
		showA11yPill: true,
	},
	scroll: {
		navOutline: false,
		navHamburgerMenu: false,
		navOutlinePosition: "left",
		navPrevNext: true,
		navPrevNextPosition: "bottom",
		navProgressStyle: "none",
		navBottomArrows: false,
		navTopBar: false,
		navReadingSupportPlacement: "bottomBar",
		navFloatingToc: true,
		navScrollProgress: true,
		navEdgeArrows: false,
		navSlideCounter: true,
		navBreadcrumbs: false,
		navCourseTitle: false,
		navLessonTitles: false,
		navLessonTitleAsHeading: false,
		navReadingTime: true,
		navSwipeGestures: false,
		navKeyboardArrows: false,
		showA11yPill: true,
	},
	minimal: {
		navOutline: false,
		navHamburgerMenu: false,
		navOutlinePosition: "left",
		navPrevNext: false,
		navPrevNextPosition: "bottom",
		navProgressStyle: "dots",
		navBottomArrows: false,
		navTopBar: false,
		navReadingSupportPlacement: "bottomBar",
		navFloatingToc: false,
		navScrollProgress: false,
		navEdgeArrows: false,
		navSlideCounter: false,
		navBreadcrumbs: false,
		navCourseTitle: false,
		navLessonTitles: false,
		navLessonTitleAsHeading: false,
		navReadingTime: false,
		navSwipeGestures: true,
		navKeyboardArrows: true,
		showA11yPill: true,
	},
	embedded: {
		navOutline: false,
		navHamburgerMenu: false,
		navOutlinePosition: "left",
		navPrevNext: true,
		navPrevNextPosition: "bottom",
		navProgressStyle: "bar",
		navBottomArrows: false,
		navTopBar: false,
		navReadingSupportPlacement: "bottomBar",
		navFloatingToc: false,
		navScrollProgress: false,
		navEdgeArrows: false,
		navSlideCounter: true,
		navBreadcrumbs: false,
		navCourseTitle: false,
		navLessonTitles: false,
		navLessonTitleAsHeading: false,
		navReadingTime: false,
		navSwipeGestures: false,
		navKeyboardArrows: true,
		showA11yPill: true,
	},
	none: {
		navOutline: false,
		navHamburgerMenu: false,
		navOutlinePosition: "left",
		navPrevNext: false,
		navPrevNextPosition: "bottom",
		navProgressStyle: "none",
		navBottomArrows: false,
		navTopBar: false,
		navReadingSupportPlacement: "none",
		navFloatingToc: false,
		navScrollProgress: false,
		navEdgeArrows: false,
		navSlideCounter: false,
		navBreadcrumbs: false,
		navCourseTitle: false,
		navLessonTitles: false,
		navLessonTitleAsHeading: false,
		navReadingTime: false,
		navSwipeGestures: false,
		navKeyboardArrows: false,
		showA11yPill: false,
	},
};

/** Keys whose default comes from the archetype, not from a global default table. */
export const NAV_PRESET_KEYS = Object.keys(PRESETS.sidebar) as (keyof NavToggleValues)[];

export const BOOLEAN_NAV_KEYS = NAV_PRESET_KEYS.filter(
	(
		key,
	): key is Exclude<
		keyof NavToggleValues,
		"navProgressStyle" | "navOutlinePosition" | "navPrevNextPosition" | "navReadingSupportPlacement"
	> =>
		key !== "navProgressStyle" &&
		key !== "navOutlinePosition" &&
		key !== "navPrevNextPosition" &&
		key !== "navReadingSupportPlacement",
);

export const PROGRESS_STYLES: NavToggleValues["navProgressStyle"][] = [
	"bar",
	"dots",
	"segments",
	"none",
];
export const READING_SUPPORT_PLACEMENTS: NavToggleValues["navReadingSupportPlacement"][] = [
	"topBar",
	"bottomBar",
	"sidebar",
	"none",
];

export function getNavPreset(archetype: NavArchetype): NavToggleValues {
	if (archetype === "custom") return { ...PRESETS.sidebar };
	return { ...PRESETS[archetype] };
}
