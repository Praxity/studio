import { isNavArchetype } from "./nav-archetype-layout.ts";
import {
	BOOLEAN_NAV_KEYS,
	getNavPreset,
	type NavToggleValues,
	PROGRESS_STYLES,
	READING_SUPPORT_PLACEMENTS,
} from "./nav-archetype-presets.ts";
import type { NavArchetype } from "./types.ts";

/**
 * Per-page navigation overrides, written as page-break params:
 *
 *   --- Knowledge check
 *   nav: minimal
 *   navKeyboardArrows: false
 *
 * Precedence (later wins): course-resolved toggles -> page `nav:` archetype
 * preset -> page individual keys. The compiler uses these helpers for both
 * preview and published output.
 */

/** The page's `nav:` archetype param, if valid. `custom` is meaningless per page. */
export function getPageNavArchetype(
	pageData: Record<string, unknown> | undefined,
): NavArchetype | undefined {
	const value = pageData?.nav;
	return isNavArchetype(value) && value !== "custom" ? value : undefined;
}

export function mergePageNavToggles<T extends Partial<NavToggleValues>>(
	base: T,
	pageData: Record<string, unknown> | undefined,
): T & Partial<NavToggleValues> {
	const archetype = getPageNavArchetype(pageData);
	const merged: T & Partial<NavToggleValues> = archetype
		? { ...base, ...getNavPreset(archetype) }
		: { ...base };
	if (!pageData) return merged;

	for (const key of BOOLEAN_NAV_KEYS) {
		const value = pageData[key];
		if (typeof value === "boolean") merged[key] = value;
	}
	const progress = pageData.navProgressStyle;
	if (typeof progress === "string" && (PROGRESS_STYLES as string[]).includes(progress)) {
		merged.navProgressStyle = progress as NavToggleValues["navProgressStyle"];
	}
	const readingSupport = pageData.navReadingSupportPlacement;
	if (
		typeof readingSupport === "string" &&
		(READING_SUPPORT_PLACEMENTS as string[]).includes(readingSupport)
	) {
		merged.navReadingSupportPlacement =
			readingSupport as NavToggleValues["navReadingSupportPlacement"];
	}
	// `duration: show|hide` predates this mechanism; it is sugar for navReadingTime.
	if (pageData.duration === "show") merged.navReadingTime = true;
	if (pageData.duration === "hide") merged.navReadingTime = false;
	return merged;
}

/** Author default for reading-focus on this page. Learner choice overrides (viewer-side). */
export function getPageFocusDefault(
	pageData: Record<string, unknown> | undefined,
): boolean | undefined {
	const value = pageData?.focus;
	if (value === "on" || value === true) return true;
	if (value === "off" || value === false) return false;
	return undefined;
}

/**
 * Whether this page carries any type-valid nav or focus override. The exporter
 * forces the full React viewer for such pages: static/islands pages render
 * course-level chrome server-side, so an override there would silently not
 * apply. `duration:` is deliberately excluded — it predates this mechanism,
 * renders viewer-side only, and must not flip existing static pages to the
 * heavier runtime.
 */
export function pageHasNavOverrides(pageData: Record<string, unknown> | undefined): boolean {
	if (!pageData) return false;
	if (getPageNavArchetype(pageData) !== undefined) return true;
	if (getPageFocusDefault(pageData) !== undefined) return true;
	for (const key of BOOLEAN_NAV_KEYS) {
		if (typeof pageData[key] === "boolean") return true;
	}
	const progress = pageData.navProgressStyle;
	if (typeof progress === "string" && (PROGRESS_STYLES as string[]).includes(progress)) return true;
	const readingSupport = pageData.navReadingSupportPlacement;
	return (
		typeof readingSupport === "string" &&
		(READING_SUPPORT_PLACEMENTS as string[]).includes(readingSupport)
	);
}

/**
 * The toggle->layout inference chain, extracted verbatim from
 * the legacy viewer so the compiler can compute the layout class for a
 * page whose overrides change individual toggles without naming an archetype.
 * Order matters — do not reorder branches.
 */
export function inferNavStyleFromToggles(
	nav: Partial<NavToggleValues>,
	fallback: NavArchetype,
): NavArchetype {
	if (nav.navScrollProgress || nav.navFloatingToc) return "scroll";
	if (nav.navBottomArrows && !nav.navOutline) return "slides";
	if (nav.navEdgeArrows && !nav.navOutline) return "slides";
	if (!nav.navOutline && nav.navSwipeGestures) return "minimal";
	if (!nav.navOutline && !nav.navPrevNext && !nav.navEdgeArrows) return "none";
	if (nav.navOutline && nav.navPrevNext && nav.navBreadcrumbs) return "bottomBar";
	if (!nav.navOutline && nav.navPrevNext) return "embedded";
	return fallback;
}

/**
 * The affordances a learner can actually use to change page.
 *
 * Progress dots and breadcrumbs are deliberately absent: dots render as
 * `role="progressbar"` with `aria-hidden` children, and breadcrumbs render as
 * text. Neither navigates. Swipe is absent because it is the failure mode this
 * guards against, not a remedy for it.
 */
const PAGE_NAV_AFFORDANCES = [
	"navOutline",
	"navPrevNext",
	"navEdgeArrows",
	"navBottomArrows",
	"navHamburgerMenu",
	"navFloatingToc",
] as const satisfies readonly (keyof NavToggleValues)[];

/**
 * Keyboard arrows cannot be the last thing switched off.
 *
 * A page can turn every visible control off — `nav: minimal` does most of it, and
 * the individual keys finish the job. With `navKeyboardArrows: false` on top, the
 * only way left to leave the page is a swipe: unusable with a keyboard (2.1.1
 * Keyboard, Level A) and unusable with a mouse, since a swipe is a dragging
 * movement with no single-pointer alternative (2.5.7 Dragging Movements, AA). The
 * kitchen-sink fixture had exactly this page, and a learner on a desktop was
 * stranded there.
 *
 * So when no visible affordance survives, arrow-key navigation comes back on. It
 * is invisible chrome, so it cannot spoil the minimal look the author asked for,
 * and it is the only repair that needs nothing from the author. Every other
 * toggle is left exactly as written.
 */
export function applyKeyboardNavFloor<T extends Partial<NavToggleValues>>(toggles: T): T {
	const hasVisibleNav = PAGE_NAV_AFFORDANCES.some((key) => toggles[key] === true);
	if (hasVisibleNav || toggles.navKeyboardArrows !== false) return toggles;
	return { ...toggles, navKeyboardArrows: true };
}
