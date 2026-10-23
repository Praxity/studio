import { describe, expect, it } from "vitest";
import { getNavPreset } from "../src/nav-archetype-presets.ts";
import {
	getPageFocusDefault,
	getPageNavArchetype,
	inferNavStyleFromToggles,
	mergePageNavToggles,
	pageHasNavOverrides,
} from "../src/page-nav-overrides.ts";

describe("getPageNavArchetype", () => {
	it("returns a valid archetype from the page's nav param", () => {
		expect(getPageNavArchetype({ nav: "minimal" })).toBe("minimal");
	});
	it("rejects custom, unknown values, and missing data", () => {
		expect(getPageNavArchetype({ nav: "custom" })).toBeUndefined();
		expect(getPageNavArchetype({ nav: "bogus" })).toBeUndefined();
		expect(getPageNavArchetype({ nav: 3 })).toBeUndefined();
		expect(getPageNavArchetype(undefined)).toBeUndefined();
	});
});

describe("mergePageNavToggles", () => {
	const base = { navOutline: true, navPrevNext: true, navKeyboardArrows: true };

	it("returns base untouched when the page has no nav params", () => {
		expect(mergePageNavToggles(base, undefined)).toEqual(base);
		expect(mergePageNavToggles(base, { title: "Intro" })).toEqual(base);
	});

	it("applies the full archetype preset when nav: is set", () => {
		const merged = mergePageNavToggles(base, { nav: "minimal" });
		expect(merged).toEqual({ ...base, ...getNavPreset("minimal") });
		expect(merged.navOutline).toBe(false);
	});

	it("layers individual boolean keys over the archetype preset", () => {
		const merged = mergePageNavToggles(base, { nav: "minimal", navKeyboardArrows: false });
		expect(merged.navKeyboardArrows).toBe(false);
		expect(merged.navOutline).toBe(false); // from preset
	});

	it("applies individual keys without an archetype", () => {
		const merged = mergePageNavToggles(base, { navOutline: false });
		expect(merged.navOutline).toBe(false);
		expect(merged.navPrevNext).toBe(true);
	});

	it("ignores non-boolean values for boolean keys (old .prax files)", () => {
		const merged = mergePageNavToggles(base, { navOutline: "nope" });
		expect(merged.navOutline).toBe(true);
	});

	it("accepts navProgressStyle when valid, ignores when not", () => {
		expect(mergePageNavToggles(base, { navProgressStyle: "dots" }).navProgressStyle).toBe("dots");
		expect(
			mergePageNavToggles(base, { navProgressStyle: "sparkles" }).navProgressStyle,
		).toBeUndefined();
	});

	it("folds duration: show|hide into navReadingTime", () => {
		expect(mergePageNavToggles(base, { duration: "show" }).navReadingTime).toBe(true);
		expect(
			mergePageNavToggles({ ...base, navReadingTime: true }, { duration: "hide" }).navReadingTime,
		).toBe(false);
	});
});

describe("getPageFocusDefault", () => {
	it("maps on/off strings and booleans", () => {
		expect(getPageFocusDefault({ focus: "on" })).toBe(true);
		expect(getPageFocusDefault({ focus: "off" })).toBe(false);
		expect(getPageFocusDefault({ focus: true })).toBe(true);
		expect(getPageFocusDefault({ focus: false })).toBe(false);
	});
	it("returns undefined for missing or junk values", () => {
		expect(getPageFocusDefault(undefined)).toBeUndefined();
		expect(getPageFocusDefault({})).toBeUndefined();
		expect(getPageFocusDefault({ focus: "maybe" })).toBeUndefined();
	});
});

describe("pageHasNavOverrides", () => {
	it("is false for pages with no params or only title/duration/style params", () => {
		expect(pageHasNavOverrides(undefined)).toBe(false);
		expect(pageHasNavOverrides({ title: "Intro" })).toBe(false);
		// duration predates this mechanism and renders viewer-side only; it must
		// not flip existing static pages to the full viewer.
		expect(pageHasNavOverrides({ duration: "show" })).toBe(false);
		expect(pageHasNavOverrides({ style: "hero" })).toBe(false);
	});
	it("is true for archetype, focus, and type-valid individual keys", () => {
		expect(pageHasNavOverrides({ nav: "minimal" })).toBe(true);
		expect(pageHasNavOverrides({ focus: "off" })).toBe(true);
		expect(pageHasNavOverrides({ focus: "on" })).toBe(true);
		expect(pageHasNavOverrides({ navOutline: false })).toBe(true);
		expect(pageHasNavOverrides({ navProgressStyle: "dots" })).toBe(true);
	});
	it("is false for type-invalid override values", () => {
		expect(pageHasNavOverrides({ nav: "bogus" })).toBe(false);
		expect(pageHasNavOverrides({ navOutline: "nope" })).toBe(false);
	});
});

describe("inferNavStyleFromToggles", () => {
	// Mirrors the chain previously inlined at CourseViewer.tsx:194-202.
	it("reproduces the CourseViewer inference chain", () => {
		expect(inferNavStyleFromToggles({ navFloatingToc: true }, "sidebar")).toBe("scroll");
		expect(inferNavStyleFromToggles({ navBottomArrows: true, navOutline: false }, "sidebar")).toBe(
			"slides",
		);
		expect(inferNavStyleFromToggles({ navEdgeArrows: true, navOutline: false }, "sidebar")).toBe(
			"slides",
		);
		expect(inferNavStyleFromToggles({ navOutline: false, navSwipeGestures: true }, "sidebar")).toBe(
			"minimal",
		);
		expect(
			inferNavStyleFromToggles(
				{ navOutline: false, navPrevNext: false, navEdgeArrows: false },
				"sidebar",
			),
		).toBe("none");
		expect(
			inferNavStyleFromToggles(
				{ navOutline: true, navPrevNext: true, navBreadcrumbs: true },
				"sidebar",
			),
		).toBe("bottomBar");
		expect(inferNavStyleFromToggles({ navOutline: false, navPrevNext: true }, "sidebar")).toBe(
			"embedded",
		);
		expect(inferNavStyleFromToggles({ navOutline: true, navPrevNext: true }, "sidebar")).toBe(
			"sidebar",
		);
	});
});
