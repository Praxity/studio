import type { NavArchetype } from "./types.ts";

const LAYOUT_CLASS_BY_ARCHETYPE: Record<NavArchetype, string> = {
	sidebar: "praxity-layout-sidebar",
	bottomBar: "praxity-layout-bottombar",
	slides: "praxity-layout-slides",
	scroll: "praxity-layout-scroll",
	minimal: "praxity-layout-minimal",
	embedded: "praxity-layout-embedded",
	none: "praxity-layout-none",
	custom: "praxity-layout-sidebar",
};

const ARCHETYPES = Object.keys(LAYOUT_CLASS_BY_ARCHETYPE) as NavArchetype[];

export function isNavArchetype(value: unknown): value is NavArchetype {
	return typeof value === "string" && (ARCHETYPES as string[]).includes(value);
}

export function toNavArchetype(value: unknown): NavArchetype {
	return isNavArchetype(value) ? value : "sidebar";
}

export function navArchetypeToLayoutClass(value: unknown): string {
	return LAYOUT_CLASS_BY_ARCHETYPE[toNavArchetype(value)];
}

export function navArchetypeSuppressesNav(value: unknown): boolean {
	return toNavArchetype(value) === "none";
}

export { ARCHETYPES as NAV_ARCHETYPES };
