import type { SlideStyleDef } from "@praxity/content-model/types";

export type { SlideStyleDef } from "@praxity/content-model/types";

export interface ResolvedSlideStyle {
	cornerImage?: string;
	variables: Record<string, string>;
	chrome: NonNullable<SlideStyleDef["chrome"]>;
}

export const BUILT_IN_SLIDE_STYLES = {
	title: {
		align: "center",
		background: "ink",
		scale: "display",
	},
	section: {
		accentRule: true,
		scale: "display",
	},
	content: {},
	scenario: {
		mediaPlacement: "right",
	},
	quiz: {},
} satisfies Record<string, SlideStyleDef>;

const DEFAULT_SLIDE_STYLE = {
	accentRule: false,
	measure: "default",
	align: "center",
	background: "paper",
	scale: "default",
	chrome: "default",
	mediaPlacement: "stacked",
} satisfies Required<Omit<SlideStyleDef, "cornerImage">>;

const BACKGROUND_VARIABLES = {
	paper: {
		"--slide-bg": "var(--praxity-color-background)",
		"--slide-fg": "var(--praxity-color-text)",
	},
	surface: {
		"--slide-bg": "var(--praxity-color-background-alt)",
		"--slide-fg": "var(--praxity-color-text)",
	},
	accent: {
		"--slide-bg": "var(--praxity-color-accent)",
		"--slide-fg": "var(--praxity-color-background)",
	},
	ink: {
		"--slide-bg": "var(--praxity-color-text)",
		"--slide-fg": "var(--praxity-color-background)",
	},
} satisfies Record<NonNullable<SlideStyleDef["background"]>, Record<string, string>>;

const MEASURE_VARIABLES = {
	narrow: "36rem",
	default: "var(--praxity-max-width, 720px)",
	wide: "68rem",
	full: "100%",
} satisfies Record<NonNullable<SlideStyleDef["measure"]>, string>;

const HEADING_SCALE_VARIABLES = {
	default: "1",
	display: "1.35",
} satisfies Record<NonNullable<SlideStyleDef["scale"]>, string>;

const MEDIA_VARIABLES = {
	stacked: {
		"--slide-grid-columns": "minmax(0, 1fr)",
		"--slide-text-column": "1",
		"--slide-media-column": "1",
	},
	left: {
		"--slide-grid-columns": "minmax(0, 1fr) minmax(0, 1fr)",
		"--slide-text-column": "2",
		"--slide-media-column": "1",
	},
	right: {
		"--slide-grid-columns": "minmax(0, 1fr) minmax(0, 1fr)",
		"--slide-text-column": "1",
		"--slide-media-column": "2",
	},
} satisfies Record<NonNullable<SlideStyleDef["mediaPlacement"]>, Record<string, string>>;

function isSlideStyleDef(value: unknown): value is SlideStyleDef {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A CSS image accepts local assets or HTTPS, never executable schemes or raw CSS. */
function cornerImageUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return;
	const url = value.trim();
	if (!url || url === "none" || /[\u0000-\u001f\u007f\\]/u.test(url)) return;
	try {
		const parsed = new URL(url, "https://praxity.invalid/");
		if (parsed.protocol !== "https:") return;
		return url.replace(/[\s"'()<>;{}@]/gu, (character) =>
			encodeURIComponent(character).replace(
				/['()]/g,
				(part) => `%${part.charCodeAt(0).toString(16).toUpperCase()}`,
			),
		);
	} catch {
		return;
	}
}

export function resolveSlideStyle(
	name?: string,
	courseStyles?: Record<string, SlideStyleDef>,
): ResolvedSlideStyle {
	const normalizedName = name?.trim();
	const builtIn = normalizedName
		? (BUILT_IN_SLIDE_STYLES as Record<string, SlideStyleDef>)[normalizedName]
		: undefined;
	const courseStyleCandidate = normalizedName ? courseStyles?.[normalizedName] : undefined;
	const courseStyle = isSlideStyleDef(courseStyleCandidate) ? courseStyleCandidate : undefined;
	const definition: Required<Omit<SlideStyleDef, "cornerImage">> &
		Pick<SlideStyleDef, "cornerImage"> = {
		...DEFAULT_SLIDE_STYLE,
		...builtIn,
		...courseStyle,
	};

	const cornerImage = cornerImageUrl(definition.cornerImage);
	return {
		...(cornerImage ? { cornerImage } : {}),
		variables: {
			...BACKGROUND_VARIABLES[definition.background],
			...(cornerImage ? { "--slide-corner-image": `url("${cornerImage}")` } : {}),
			"--slide-measure": MEASURE_VARIABLES[definition.measure],
			"--slide-heading-scale": HEADING_SCALE_VARIABLES[definition.scale],
			"--slide-align": definition.align,
			...MEDIA_VARIABLES[definition.mediaPlacement],
			"--slide-accent-rule-width": definition.accentRule === true ? "4px" : "0px",
		},
		chrome: definition.chrome,
	};
}

/** Page metadata wins; only an opening top-level H1 may supply a page style. */
export function resolvePageSlideStyle(
	page: {
		data?: Record<string, unknown>;
		blocks: readonly { type: string; data: Record<string, unknown> }[];
	},
	courseStyles?: Record<string, SlideStyleDef>,
) {
	const opening = page.blocks[0];
	const candidate =
		page.data?.pageStyle ??
		page.data?.style ??
		(opening?.type === "heading" && opening.data.level === 1 ? opening.data.pageStyle : undefined);
	const name = typeof candidate === "string" ? candidate.trim() : undefined;
	const style = resolveSlideStyle(name, courseStyles);
	return {
		...style,
		name,
	};
}
