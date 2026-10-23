import type { NavArchetype } from "./types.ts";

/**
 * The single mapping from an author's chosen navigation archetype to the layout
 * class the viewer and the exporter both use.
 *
 * There used to be two resolvers that disagreed. The runtime mapped
 * `navigationStyle` directly, while the exporter reverse-inferred a layout from
 * individual nav toggles (`navEdgeArrows && !navOutline` → slides, and so on).
 * That inference could not express `minimal` (its preset turns off outline,
 * prev/next and edge arrows, so the `none` branch claimed it first) or
 * `embedded` (absent from the chain entirely), and it silently downgraded a
 * course to `sidebar` whenever an author adjusted a toggle. A new project
 * scaffolded as `slides` exported as `sidebar`.
 *
 * Keep this the only place the mapping lives. Toggles still customise a layout;
 * they no longer decide which one it is.
 */
const LAYOUT_CLASS_BY_ARCHETYPE: Record<NavArchetype, string> = {
	sidebar: "praxity-layout-sidebar",
	bottomBar: "praxity-layout-bottombar",
	slides: "praxity-layout-slides",
	scroll: "praxity-layout-scroll",
	minimal: "praxity-layout-minimal",
	embedded: "praxity-layout-embedded",
	none: "praxity-layout-none",
	// `custom` means "the author took over the toggles"; it has no layout of its
	// own and inherits the sidebar chrome.
	custom: "praxity-layout-sidebar",
};

const ARCHETYPES = Object.keys(LAYOUT_CLASS_BY_ARCHETYPE) as NavArchetype[];

export function isNavArchetype(value: unknown): value is NavArchetype {
	return typeof value === "string" && (ARCHETYPES as string[]).includes(value);
}

/** Normalize any incoming value to a known archetype, defaulting to `sidebar`. */
export function toNavArchetype(value: unknown): NavArchetype {
	return isNavArchetype(value) ? value : "sidebar";
}

/** The `<body>` / viewer-shell layout class for an archetype. */
export function navArchetypeToLayoutClass(value: unknown): string {
	return LAYOUT_CLASS_BY_ARCHETYPE[toNavArchetype(value)];
}

/**
 * `none` means the author asked for no navigation chrome. The no-JS fallback nav
 * is the navigation on static pages, so it must be suppressed here too —
 * otherwise a "no navigation" course still shipped a full page list on every
 * text-only page while its other pages showed nothing.
 */
export function navArchetypeSuppressesNav(value: unknown): boolean {
	return toNavArchetype(value) === "none";
}

export { ARCHETYPES as NAV_ARCHETYPES };
