import { isNavArchetype } from "./nav-archetype-layout.ts";
import {
	BOOLEAN_NAV_KEYS,
	getNavPreset,
	type NavToggleValues,
	PROGRESS_STYLES,
	READING_SUPPORT_PLACEMENTS,
} from "./nav-archetype-presets.ts";
import type { NavArchetype } from "./types.ts";

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
	if (pageData.duration === "show") merged.navReadingTime = true;
	if (pageData.duration === "hide") merged.navReadingTime = false;
	return merged;
}

export function getPageFocusDefault(
	pageData: Record<string, unknown> | undefined,
): boolean | undefined {
	const value = pageData?.focus;
	if (value === "on" || value === true) return true;
	if (value === "off" || value === false) return false;
	return undefined;
}

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

const PAGE_NAV_AFFORDANCES = [
	"navOutline",
	"navPrevNext",
	"navEdgeArrows",
	"navBottomArrows",
	"navHamburgerMenu",
	"navFloatingToc",
] as const satisfies readonly (keyof NavToggleValues)[];

export function applyKeyboardNavFloor<T extends Partial<NavToggleValues>>(toggles: T): T {
	const hasVisibleNav = PAGE_NAV_AFFORDANCES.some((key) => toggles[key] === true);
	if (hasVisibleNav || toggles.navKeyboardArrows !== false) return toggles;
	return { ...toggles, navKeyboardArrows: true };
}
