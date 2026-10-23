import { describe, expect, it } from "vitest";
import {
	filterThemeFamilies,
	getFamilyPreviewColors,
	getThemeFamily,
	themeFamilies,
} from "../registry";

describe("theme family ordering", () => {
	it("leads the grid with the app's own Default theme", () => {
		// Regression: `default` used to sort last, below Gotham, so the card the
		// app actually ships with was the one nobody could find.
		expect(themeFamilies[0]?.id).toBe("default");
	});

	it("offers Default in every appearance filter", () => {
		for (const filter of ["all", "light", "dark"] as const) {
			const ids = filterThemeFamilies(filter).map((family) => family.id);
			expect(ids, `filter=${filter}`).toContain("default");
		}
	});

	it("gives Default both variants, so the settings card can render", () => {
		// The card returns null without a usable preview colour for the current
		// appearance — a missing variant would silently drop it from the grid.
		const family = getThemeFamily("default");
		expect(family?.hasLight).toBe(true);
		expect(family?.hasDark).toBe(true);

		const preview = getFamilyPreviewColors("default");
		expect(preview.light).not.toBeNull();
		expect(preview.dark).not.toBeNull();
	});

	it("lists every family exactly once", () => {
		const ids = themeFamilies.map((family) => family.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
