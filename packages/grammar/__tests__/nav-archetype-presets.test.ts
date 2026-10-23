import { describe, expect, it } from "vitest";
import { getNavPreset, type NavToggleValues } from "../src/nav-archetype-presets.ts";

describe("getNavPreset", () => {
	it("returns sidebar defaults", () => {
		const preset = getNavPreset("sidebar");
		expect(preset.navOutline).toBe(true);
		expect(preset.navOutlinePosition).toBe("left");
		expect(preset.navPrevNext).toBe(true);
		expect(preset.navProgressStyle).toBe("bar");
		expect(preset.navSlideCounter).toBe(true);
		expect(preset.navKeyboardArrows).toBe(true);
		expect(preset.showA11yPill).toBe(true);
	});

	it("returns slides defaults", () => {
		const preset = getNavPreset("slides");
		expect(preset.navOutline).toBe(false);
		expect(preset.navHamburgerMenu).toBe(true);
		expect(preset.navPrevNext).toBe(false);
		expect(preset.navEdgeArrows).toBe(false);
		expect(preset.navSlideCounter).toBe(true);
		expect(preset.navSwipeGestures).toBe(true);
		expect(preset.navProgressStyle).toBe("dots");
	});

	it("returns scroll defaults with prevNext on for multi-page support", () => {
		const preset = getNavPreset("scroll");
		expect(preset.navPrevNext).toBe(true);
		expect(preset.navFloatingToc).toBe(true);
		expect(preset.navScrollProgress).toBe(true);
		expect(preset.navReadingTime).toBe(true);
		expect(preset.navSlideCounter).toBe(true);
		expect(preset.navKeyboardArrows).toBe(false);
	});

	it("returns minimal defaults", () => {
		const preset = getNavPreset("minimal");
		expect(preset.navOutline).toBe(false);
		expect(preset.navPrevNext).toBe(false);
		expect(preset.navSwipeGestures).toBe(true);
		expect(preset.navProgressStyle).toBe("dots");
		expect(preset.navReadingSupportPlacement).toBe("bottomBar");
		expect(preset.showA11yPill).toBe(true);
	});

	it("returns embedded defaults", () => {
		const preset = getNavPreset("embedded");
		expect(preset.navOutline).toBe(false);
		expect(preset.navPrevNext).toBe(true);
		expect(preset.navSlideCounter).toBe(true);
		expect(preset.navReadingSupportPlacement).toBe("bottomBar");
		expect(preset.showA11yPill).toBe(true);
	});

	it("returns none defaults with everything off", () => {
		const preset = getNavPreset("none");
		expect(preset.navOutline).toBe(false);
		expect(preset.navPrevNext).toBe(false);
		expect(preset.navKeyboardArrows).toBe(false);
		expect(preset.navProgressStyle).toBe("none");
	});

	it("returns sidebar defaults for custom (fallback)", () => {
		const preset = getNavPreset("custom");
		const keyCount = Object.keys(preset as NavToggleValues).length;
		expect(keyCount).toBeGreaterThan(0);
		expect(preset).toEqual(getNavPreset("sidebar"));
	});

	it("defaults the counter on wherever previous and next controls are shown", () => {
		for (const archetype of ["sidebar", "bottomBar", "scroll", "embedded"] as const) {
			const preset = getNavPreset(archetype);
			expect(preset.navPrevNext).toBe(true);
			expect(preset.navSlideCounter).toBe(true);
		}
	});
});
