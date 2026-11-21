import { describe, expect, it } from "vitest";
import { applyKeyboardNavFloor, mergePageNavToggles } from "../src/page-nav-overrides.ts";

describe("keyboard nav floor", () => {
	it("restores arrow keys when nothing visible can change page", () => {
		const stranded = {
			navOutline: false,
			navPrevNext: false,
			navEdgeArrows: false,
			navHamburgerMenu: false,
			navFloatingToc: false,
			navSwipeGestures: true,
			navKeyboardArrows: false,
		};
		expect(applyKeyboardNavFloor(stranded).navKeyboardArrows).toBe(true);
	});

	it("leaves the author's choice alone when any visible control survives", () => {
		for (const affordance of [
			"navOutline",
			"navPrevNext",
			"navEdgeArrows",
			"navHamburgerMenu",
			"navFloatingToc",
		] as const) {
			const toggles = applyKeyboardNavFloor({
				navOutline: false,
				navPrevNext: false,
				navEdgeArrows: false,
				navHamburgerMenu: false,
				navFloatingToc: false,
				navKeyboardArrows: false,
				[affordance]: true,
			});
			expect(toggles.navKeyboardArrows, `${affordance} should keep arrows off`).toBe(false);
		}
	});

	it("does not count dots or breadcrumbs — neither navigates", () => {
		const toggles = applyKeyboardNavFloor({
			navOutline: false,
			navPrevNext: false,
			navEdgeArrows: false,
			navHamburgerMenu: false,
			navFloatingToc: false,
			navBreadcrumbs: true,
			navProgressStyle: "dots" as const,
			navKeyboardArrows: false,
		});
		expect(toggles.navKeyboardArrows).toBe(true);
	});

	it("changes nothing when the author never disabled arrows", () => {
		const toggles = { navOutline: false, navPrevNext: false, navKeyboardArrows: true };
		expect(applyKeyboardNavFloor(toggles)).toBe(toggles);
	});

	it("repairs the page-override case that produced this rule", () => {
		const resolved = mergePageNavToggles(
			{ navOutline: true, navPrevNext: true, navKeyboardArrows: true },
			{ nav: "minimal", navKeyboardArrows: false },
		);
		expect(resolved.navKeyboardArrows).toBe(false);
		expect(applyKeyboardNavFloor(resolved).navKeyboardArrows).toBe(true);
	});
});
