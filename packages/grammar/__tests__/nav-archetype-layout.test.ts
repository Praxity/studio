import { describe, expect, it } from "vitest";
import {
	isNavArchetype,
	NAV_ARCHETYPES,
	navArchetypeSuppressesNav,
	navArchetypeToLayoutClass,
	toNavArchetype,
} from "../src/nav-archetype-layout.ts";
import type { NavArchetype } from "../src/types.ts";

describe("navArchetypeToLayoutClass", () => {
	// Every archetype the Design panel offers must resolve to its own layout class.
	// The old reverse-inference collapsed `minimal` to `none` and `embedded` to
	// `bottombar`, and downgraded anything it could not recognise to `sidebar`.
	const cases: [NavArchetype, string][] = [
		["sidebar", "praxity-layout-sidebar"],
		["bottomBar", "praxity-layout-bottombar"],
		["slides", "praxity-layout-slides"],
		["scroll", "praxity-layout-scroll"],
		["minimal", "praxity-layout-minimal"],
		["embedded", "praxity-layout-embedded"],
		["none", "praxity-layout-none"],
		["custom", "praxity-layout-sidebar"],
	];

	for (const [archetype, expected] of cases) {
		it(`maps ${archetype} to ${expected}`, () => {
			expect(navArchetypeToLayoutClass(archetype)).toBe(expected);
		});
	}

	it("covers every archetype in the union", () => {
		expect(NAV_ARCHETYPES).toHaveLength(cases.length);
		for (const [archetype] of cases) {
			expect(NAV_ARCHETYPES).toContain(archetype);
		}
	});

	it("gives each non-custom archetype a distinct layout class", () => {
		const classes = cases.filter(([a]) => a !== "custom").map(([, c]) => c);
		expect(new Set(classes).size).toBe(classes.length);
	});

	it("falls back to sidebar for unknown or missing values", () => {
		expect(navArchetypeToLayoutClass(undefined)).toBe("praxity-layout-sidebar");
		expect(navArchetypeToLayoutClass("nonsense")).toBe("praxity-layout-sidebar");
		expect(navArchetypeToLayoutClass(null)).toBe("praxity-layout-sidebar");
	});
});

describe("toNavArchetype / isNavArchetype", () => {
	it("accepts known archetypes and rejects anything else", () => {
		expect(isNavArchetype("slides")).toBe(true);
		expect(isNavArchetype("Slides")).toBe(false);
		expect(isNavArchetype(7)).toBe(false);
		expect(toNavArchetype("minimal")).toBe("minimal");
		expect(toNavArchetype("bogus")).toBe("sidebar");
	});
});

describe("navArchetypeSuppressesNav", () => {
	it("is true only for none", () => {
		expect(navArchetypeSuppressesNav("none")).toBe(true);
		for (const archetype of NAV_ARCHETYPES.filter((a) => a !== "none")) {
			expect(navArchetypeSuppressesNav(archetype)).toBe(false);
		}
	});
});
