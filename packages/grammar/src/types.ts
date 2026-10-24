import type { SlideStyleDef } from "@praxity/content-model/types";
import type { DeckDesign } from "./deck-design.ts";

export interface PronunciationLexeme {
	grapheme: string;
	alias: string;
	lang: string;
}

export interface PronunciationConfig {
	lexemes: PronunciationLexeme[];
}

/** Grammar frontmatter (theme, lang, title, design). */
export interface GrammarFrontmatter {
	theme?: string;
	lang?: string;
	title?: string;
	/** Group label above the lesson's first page heading. */
	kicker?: string;
	/** Authored duration below the lesson's first page heading. */
	time?: string;
	narrationEnabled?: boolean;
	narrationLanguage?: string;
	narrationVoice?: string;
	narrationSpeed?: number;
	pronunciation?: PronunciationConfig;
	design?: DesignVariants;
	pageStyles?: Record<string, SlideStyleDef>;
	/** @deprecated Use pageStyles for named page presentation. */
	styles?: Record<string, SlideStyleDef>;
	[key: string]: unknown;
}

export type NavArchetype =
	| "sidebar"
	| "bottomBar"
	| "slides"
	| "scroll"
	| "minimal"
	| "embedded"
	| "none"
	| "custom";

/** Composable image effects map — presence = enabled, absence = disabled. */
export interface ImageEffectsMap {
	grayscale?: { intensity: number };
	colorWash?: {
		intensity: number;
		color: "primary" | "secondary" | "tertiary" | `#${string}`;
	};
	accentLighting?: { intensity: number };
	progressiveBlur?: { intensity: number };
	accentBlur?: { intensity: number };
	motionBlur?: { intensity: number; direction: 0 | 45 | 90 | 135 };
	grain?: { intensity: number };
	halftone?: { intensity: number };
	dithering?: { intensity: number };
}

/** Cached per-image perceptual analysis for auto-calibration. */
export interface ImagePerceptualMetadata {
	v: 1;
	avgLuminance: number;
	contrastRatio: number;
	avgSaturation: number;
	dominantHue: number;
	detailDensity: number;
	width: number;
	height: number;
}

export type FontWeight = 400 | 500 | 600 | 700 | 800;
export type FontStyle = "normal" | "italic";
export type FontDisplay = "auto" | "block" | "swap" | "fallback" | "optional";

export interface FontRoleTypography {
	fontFamily: string[];
	fontWeight: FontWeight;
	fontStyle: FontStyle;
}

export interface HeadingTypography extends FontRoleTypography {
	h1?: Partial<FontRoleTypography>;
	h2?: Partial<FontRoleTypography>;
	h3?: Partial<FontRoleTypography>;
	h4?: Partial<FontRoleTypography>;
	h5?: Partial<FontRoleTypography>;
	h6?: Partial<FontRoleTypography>;
}

export interface TypographyVariants {
	/** Missing in legacy courses; normalization persists the current pairing. */
	pairing?: "sans" | "book" | "clear";
	fontDisplay: FontDisplay;
	body: FontRoleTypography;
	headings: HeadingTypography;
	code?: Pick<FontRoleTypography, "fontFamily">;
}

/** Design system variant axes — controls visual rendering of blocks. */
export interface DesignVariants {
	palette: string;
	colorMode: "light" | "dark" | "auto";
	accentHue: number;
	accentHueCustomized?: boolean;
	// Explicit color tokens (filled by preset, read directly by CSS generation)
	colorBackgroundLight?: string;
	colorBackgroundDark?: string;
	/** @deprecated Derived from colorBackgroundLight/colorBackgroundDark and active mode. */
	colorBackground?: string;
	colorText?: string;
	colorAccent?: string;
	colorButtonBackground?: string;
	colorButtonText?: string;
	/** @deprecated Use the mode-specific status colours. Kept as a legacy seed. */
	colorSuccess?: string;
	/** @deprecated Use the mode-specific status colours. Kept as a legacy seed. */
	colorError?: string;
	/** @deprecated Use the mode-specific status colours. Kept as a legacy seed. */
	colorWarning?: string;
	colorSuccessOnLight?: string;
	colorSuccessOnDark?: string;
	colorErrorOnLight?: string;
	colorErrorOnDark?: string;
	colorWarningOnLight?: string;
	colorWarningOnDark?: string;
	typography: TypographyVariants;
	headingSize: number;
	lineHeight: number;
	density: "compact" | "comfortable" | "spacious";
	blockSpacing?: "compact" | "default" | "spacious";
	sectionGap: number;
	sectionRhythmMode?: "uniform" | "alternate" | "manual";
	/** @deprecated Use dividerStyle instead. */
	sectionTransition?: "none" | "wave" | "angle" | "curve" | "squiggle" | "blend";
	sectionDarkBackground?: string;
	sectionAccentBackground?: string;
	accentOnDark?: string;
	customCss?: string;
	contentMaxWidth: number;
	borderRadius: number;
	shadowIntensity: "flat" | "subtle" | "elevated";
	dividerStyle:
		| "none"
		| "thin"
		| "gradient"
		| "ornamental"
		| "wave"
		| "angle"
		| "curve"
		| "squiggle"
		| "blend";
	backgroundTexture: "none" | "grain" | "paper" | "noise";
	highlightStyle: "none" | "marker" | "gradient" | "scribble";
	/** Studio module-deck presentation and initial learner preferences. */
	deck?: DeckDesign;
	navLayout?: "sidebar" | "bottomBar" | "none";
	// Navigation archetype system (supersedes navLayout)
	navArchetype?: NavArchetype;
	navArchetypeBase?: NavArchetype;
	navOutline?: boolean;
	navOutlinePosition?: "left" | "right";
	navPrevNext?: boolean;
	navPrevNextPosition?: "bottom" | "top";
	navProgressStyle?: "bar" | "dots" | "segments" | "none";
	navBottomArrows?: boolean;
	navTopBar?: boolean;
	navReadingSupportPlacement?: "topBar" | "bottomBar" | "sidebar" | "none";
	navFloatingToc?: boolean;
	navScrollProgress?: boolean;
	navEdgeArrows?: boolean;
	navHamburgerMenu?: boolean;
	navSlideCounter?: boolean;
	navBreadcrumbs?: boolean;
	navCourseTitle?: boolean;
	navLessonTitles?: boolean;
	navLessonTitleAsHeading?: boolean;
	navReadingTime?: boolean;
	navSwipeGestures?: boolean;
	navKeyboardArrows?: boolean;
	showA11yPill?: boolean;
	/** Aggregate `[term]{definition}` tooltips into a published glossary page. Default true. */
	glossaryPage?: boolean;

	// Accent colors
	colorSecondary?: string | null;
	colorTertiary?: string | null;
	motionEntrance?: "none" | "fade" | "slide" | "scale";
	motionStagger?: "none" | "sequential";
	/** Default transition for single-layout Card blocks without a transition parameter. */
	slideTransition?: "none" | "fade" | "slide" | "zoom";
	/** @deprecated Use imageEffects instead. Migrated on read. */
	imageStyle?: "none" | "two-color" | "grayscale" | "grain" | "textured" | "blur";
	imageHoverEffect?: "none" | "lift" | "tilt" | "glow";
	/** Composable image effects — replaces imageStyle. */
	imageEffects?: ImageEffectsMap;
	/** When true, auto-calibrate magnitudes per image using perceptual metadata. */
	imageEffectsAuto?: boolean;
	componentDefaults: Record<string, unknown>;
	brand?: {
		logoUrl?: string;
		logoDarkUrl?: string;
		/** `left` and `center` are accepted only when loading older projects. */
		logoPlacement?: "sidebar" | "header" | "hidden" | "left" | "center";
		/** @deprecated Retained for older projects; logoPlacement now controls visibility. */
		logoScope?: "all-pages" | "title-only";
	};
}
