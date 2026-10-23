import {
	choiceFactError,
	choiceStateQuestion,
	resolveAssessmentDontKnow,
} from "@praxity/shared-blocks/assessment-choice";
import { compileBlockStatePolicy } from "@praxity/shared-blocks/block-state-policy";
import {
	type ChoiceStateFacts,
	choiceGroupDefinitionIsValid,
	choiceGroupFactsAreValid,
	choiceMaterialProof,
	choiceProofSignature,
	isChoiceStateQuestion,
} from "@praxity/shared-blocks/choice-state-facts";
import { isInlineProjectionMetadataKey } from "@praxity/shared-blocks/inline-markdown";
import { isStatefulBlock } from "@praxity/shared-blocks/types";
import {
	COURSE_HOME_DECK_SLOT,
	COURSE_HOME_LINK_SLOT,
	DEFAULT_COURSE_HOME_URL,
} from "./course-home";
import { fullyDecodeEntities } from "./html-entities";
import {
	type DeckPage,
	deckPageData,
	type ModuleDeckOptions,
	validateModuleDeck,
} from "./module-deck";
import { deckStrings } from "./module-deck-strings";
import { narrationPlaylistFromConfig } from "./narration-playlist";
/**
 * Direct HTML page generator — replaces the Astro template pipeline.
 *
 * Produces complete semantic HTML pages. The runtime planner adds only the
 * islands needed to enhance that server-rendered baseline.
 */

import {
	compileVisibleExpression,
	type DeckDesign,
	type ImageEffectsMap,
	type ImagePerceptualMetadata,
	type NavArchetype,
	resolveDeckDesign,
	type TypographyVariants,
} from "@praxity/grammar";
import {
	navArchetypeSuppressesNav,
	navArchetypeToLayoutClass,
} from "@praxity/grammar/src/nav-archetype-layout.ts";
import { getPageFocusDefault } from "@praxity/grammar/src/page-nav-overrides.ts";
import { ensureContrast, formatOklch } from "@praxity/shared-blocks/color-math";
import { estimateBlockTime } from "@praxity/shared-blocks/content-density";
import { externalLinkIndicatorHtml } from "@praxity/shared-blocks/external-link-utils";
import { constructWriteDistractorsPromptBlock } from "@praxity/shared-blocks/grammar-adapter";
import { normalizeHeadingLevel } from "@praxity/shared-blocks/heading-styles";
import { getPreviewStrings, getStrings, interpolate } from "@praxity/shared-blocks/i18n/strings";
import { imageFloatRegions } from "@praxity/shared-blocks/image-float";
import {
	getInlineField,
	prepareInlineBlocks,
	renderInlineIcons,
} from "@praxity/shared-blocks/inline-markdown";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import { initiallyHiddenBlockIds, resolveBlockRef } from "@praxity/shared-blocks/logic/visibility";
import {
	narrationDisplayText,
	narrationScriptText,
	plainNarrationText,
	renderNarrationScript,
} from "@praxity/shared-blocks/narration";
import { preparePageFootnotes } from "@praxity/shared-blocks/page-footnotes";
import { sanitizeHtml, splitHeadingContent } from "@praxity/shared-blocks/sanitize";
import {
	groupBlocksIntoSections,
	type SectionDividerStyle,
	type SectionGroup,
	type SectionPaletteName,
	type SectionRhythm,
	type SectionTexture,
	type SectionTransition,
} from "@praxity/shared-blocks/section-grouping";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import type { AssessmentBlockData, PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { privateChoicePrintCss } from "./patterns/choice/render";
import { WRITE_DISTRACTORS_STYLESHEET } from "./patterns/write-distractors/assets";
import {
	assertHighlightData,
	assertRetrievalSheetData,
	PracticeAdmissionError,
} from "./practice-admission";

export { PracticeAdmissionError } from "./practice-admission";

import {
	assessmentGroupRequirements,
	assessmentGroupSubmitLabel,
	buildAssessmentGroups,
} from "@praxity/shared-blocks/viewer/assessment-group-runtime";
import { buildSlugMap } from "@praxity/shared-blocks/viewer/page-slug";
import {
	resolvePageSlideStyle,
	type SlideStyleDef,
} from "@praxity/shared-blocks/viewer/slide-styles";
import { escapeJsonForHtml } from "./escape-json-for-html.ts";
import { enforceColorShadeTextContrast, enforceTextColorContrast } from "./export-contrast.ts";
import { generateColorShades } from "./generate-color-shades.ts";
import { generateGlossaryPageHtml } from "./glossary-page.ts";
import { sanitizeBlockForJson } from "./published-markup.ts";
import {
	type RenderBlockHtmlStrings,
	renderBlockHtml as renderSemanticBlockHtml,
} from "./render-block-html.ts";

const COURSE_COMPLETION_OUTCOME =
	'<p data-course-outcome hidden><svg class="icon icon-tabler" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path/></svg><span data-course-outcome-label></span></p>';

/** Transcript typography changes only the reading panel, never the spoken script or cue IDs. */
function renderDeckReadingScript(
	segment: DeckPage["segments"][number],
	block?: PraxityBlock,
): string {
	let script = narrationDisplayText(segment.script);
	const firstStem =
		block?.type === "assessment" && Array.isArray(block.data.stem)
			? block.data.stem.find((child) => child.type === "text" || child.type === "heading")
			: undefined;
	const title = plainNarrationText(
		block?.type === "note"
			? block.data.title
			: block?.type === "assessmentGroup"
				? block.data.groupName
				: firstStem && typeof firstStem.data.content === "string"
					? splitHeadingContent(firstStem.data.content).heading
					: "",
	);
	// Split only a title already in the script; custom narration can differ from slide text.
	const readingTitle =
		title &&
		script.startsWith(title) &&
		(script.length === title.length || /^\s/u.test(script.slice(title.length)))
			? title
			: "";
	if (readingTitle) script = script.slice(readingTitle.length).trimStart();
	const attribution = segment.quoteAttribution;
	if (attribution && script.endsWith(attribution))
		script = script.slice(0, -attribution.length).trimEnd();
	let html = renderNarrationScript(script);
	if (segment.itemTitle) {
		const first = html.match(/^<p>([\s\S]*?)<\/p>\s*/);
		if (first && plainTextFromHtml(first[1]) === segment.itemTitle)
			html = html.slice(first[0].length);
	}
	const displayTitle = segment.itemTitle || readingTitle;
	if (displayTitle)
		html = `<p class="deck-script-speaker deck-script-item-title"><strong>${escapeHtml(displayTitle)}</strong></p>${html}`;
	return `${html}${attribution ? `<p class="deck-script-quote-attribution">${escapeHtml(attribution)}</p>` : ""}`;
}

import { generateResourcesPageHtml } from "./resources-page.ts";
import {
	getBlockIsland,
	type IslandName,
	type PageRuntimePlan,
	planModuleRuntime,
	planPageRuntime,
	resolvePageNavigation,
} from "./runtime-plan.ts";
import { sanitizeCss, sanitizeCssValue } from "./sanitize-css.ts";
import { passMarkPercent } from "./scorm/tracking.ts";
import { SLIDE_ARTWORK_CSS } from "./slide-artwork-css.ts";

type ImageTreatment = "none" | "grayscale" | "tint" | "duotone" | "grain" | "dither" | "blur";
type ColorMode = "light" | "dark" | "auto";

export { groupBlocksIntoSections, type SectionGroup };

export const DEPLOYMENT_HEAD_MARKER = "<!--praxity-deployment-head-->";
export const HOST_CONFIG_ID = "praxity-host-config";
export const SHELL_CONFIG_ID = "praxity-shell-config";

interface SectionPalette {
	background: string;
	surface: string;
	text: string;
	textLight: string;
	accent: string;
	border: string;
}

type SectionPaletteMap = Record<SectionPaletteName, SectionPalette>;
type MotionEntrance = "none" | "fade" | "slide" | "scale";
type MotionStagger = "none" | "sequential";
type ImageHoverEffect = "none" | "lift" | "tilt" | "glow";
type NavToggleConfig = {
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
	colorSecondary?: string | null;
	colorTertiary?: string | null;
};

export interface CourseConfig {
	/** Optional HTML return target, resolved at deployment so LMS output stays unchanged. */
	courseHomeUrl?: string;
	deckDesign?: DeckDesign;
	moduleDeck?: ModuleDeckOptions;
	id: string;
	title: string;
	description?: string;
	sourceLocale: string;
	pages: PraxityPage[];
	totalPages: number;
	/** Named declarative slide styles from grammar frontmatter. */
	slideStyles?: Record<string, SlideStyleDef>;
	/** Pre-computed CSS custom properties (--praxity-* keys). */
	cssVars?: Record<string, string>;
	/** Dark-mode CSS custom properties for automatic system color mode. */
	darkCssVars?: Record<string, string>;
	theme?: Record<string, string>;
	typography?: TypographyVariants;
	defaultImageTreatment?: ImageTreatment;
	/** Composable image effects — replaces defaultImageTreatment. */
	imageEffects?: ImageEffectsMap;
	/** When true, auto-calibrate magnitudes per image. */
	imageEffectsAuto?: boolean;
	/** Perceptual metadata keyed by asset storage key, for auto-calibration during publish. */
	imageMetadataMap?: Map<string, ImagePerceptualMetadata>;
	customCss?: string;
	brandLogo?: {
		localPath: string;
		darkLocalPath?: string;
		placement: "sidebar" | "header" | "hidden" | "left" | "center";
		/** @deprecated Branding follows course navigation on every page. */
		scope?: "all-pages" | "title-only";
	};
	navigationStyle?: NavArchetype;
	navToggles?: NavToggleConfig;
	showCourseNameInNav?: boolean;
	showLessonNameInNav?: boolean;
	showLessonNameAsTitle?: boolean;
	completionMethod?: "allPages" | "percentage" | "quiz";
	completionThreshold?: number;
	requireKnowledgeChecks?: boolean;
	/** Course pass mark (0-100) over required, automatically scored questions. */
	passingScore?: number;
	completionQuizId?: string;
	colorShades?: {
		accent?: string[];
		success?: string[];
		error?: string[];
		warning?: string[];
	};
	estimatedDuration?: string;
	/** woff2 filenames (weight 400) to preload for faster LCP text rendering. */
	fontPreloads?: string[];
	/** Compiler-derived glossary terms for the prepared rendering model. */
	glossaryTerms?: Array<{
		term: string;
		definition: string;
		lessonTitle: string;
		lessonSlug: string;
	}>;
	/** Whether the glossary tab/page is enabled. */
	glossaryTabEnabled?: boolean;
	/** Resource entries for the published resources page. */
	resourceEntries?: Array<{
		title: string;
		description: string;
		url: string;
		resourceType: "file" | "link" | "lessonPdf" | "document";
		lessonTitle?: string;
		lessonSlug?: string;
	}>;
	/** Whether the resources tab/page is enabled. */
	resourcesTabEnabled?: boolean;
	/** Section rhythm mode for publish-time visual grouping. */
	sectionRhythm?: SectionRhythm;
	/** Canonical divider style between sections. */
	dividerStyle?: SectionDividerStyle;
	/** @deprecated Use dividerStyle. Decorative SVG divider shape between sections. */
	sectionTransition?: SectionTransition;
	/** Optional decorative texture overlay for section backgrounds. */
	texture?: SectionTexture;
	/** Default transition for Slides blocks when per-block transition is unset. */
	slideTransition?: "none" | "fade" | "slide" | "zoom";
	/** Entrance animation applied to blocks in the published output. */
	motionEntrance?: MotionEntrance;
	/** Whether list-like items reveal sequentially. */
	motionStagger?: MotionStagger;
	/** Hover interaction style applied to published image blocks. */
	imageHoverEffect?: ImageHoverEffect;
	/** Default appearance mode in published output. */
	colorMode?: ColorMode;
	/** Pre-derived section palettes for alternate/manual rhythm modes. */
	sectionPalettes?: SectionPaletteMap;
	darkSectionPalettes?: SectionPaletteMap;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const RTL_LANGS = ["ar", "he", "ur", "fa", "ps"];

/** Escape characters that are unsafe in HTML text/attribute contexts. */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function plainTextFromHtml(value: unknown): string {
	if (typeof value !== "string") return "";
	return fullyDecodeEntities(sanitizeHtml(value).replace(/<[^>]*>/gu, " "))
		.replace(/\s+/gu, " ")
		.trim();
}

function narrationSeekLabel(script: string): string {
	const heading = renderNarrationScript(script).match(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/i)?.[1];
	if (heading) return plainTextFromHtml(heading);
	const words = narrationScriptText(narrationDisplayText(script)).split(/\s+/u);
	return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
}

/**
 * Escape a JSON string for safe embedding inside a `<script>` tag.
 * Only `</script>` sequences need escaping — HTML entities must NOT be used
 * because script content is parsed as raw text, not HTML.
 */
function escapeJsonForScript(json: string): string {
	return json.replace(/<\/script/gi, "<\\/script");
}

function camelToKebab(str: string): string {
	return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Validate language code format (ISO 639-1 with optional region). */
function sanitizeLanguage(lang: string): string {
	return /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : "en";
}

/** Blend a hex color against the theme background using CSS color-mix(). */
function accentTint(hex: string, pct: number): string {
	return `color-mix(in oklab, ${hex} ${pct}%, var(--praxity-color-background, #ffffff))`;
}

function themeVarsToCss(theme?: Record<string, string>): string {
	if (!theme || Object.keys(theme).length === 0) return "";
	const vars = Object.entries(theme)
		.filter(([key]) => key !== "customCss")
		.map(([key, value]) => colorVariableDeclarations(`--praxity-${camelToKebab(key)}`, value))
		.join(" ");

	const semanticColorKeys = [
		["colorAccent", "accent"],
		["colorSuccess", "success"],
		["colorWarning", "warning"],
		["colorError", "error"],
	] as const;
	let lightVars = "";
	for (const [themeKey, cssName] of semanticColorKeys) {
		const hex = theme[themeKey];
		if (hex) {
			lightVars += ` --praxity-color-${cssName}-light-10: ${accentTint(hex, 10)}; --praxity-color-${cssName}-light-15: ${accentTint(hex, 15)};`;
		}
	}
	return lightVars ? `${vars}${lightVars}` : vars;
}

function colorVariableDeclarations(key: string, value: string): string {
	const fallback = sanitizeCssValue(String(value));
	const modern = formatOklch(fallback);
	return modern === fallback
		? `${key}: ${fallback};`
		: `${key}: ${fallback}; ${key}: ${sanitizeCssValue(modern)};`;
}

function cssVariableRecordToCss(cssVars?: Record<string, string>): string {
	return Object.entries(cssVars ?? {})
		.filter(([key]) => /^--[a-z][a-z0-9-]*$/.test(key))
		.map(([key, value]) => colorVariableDeclarations(key, value))
		.join(" ");
}

type CourseCssConfig = Pick<
	CourseConfig,
	| "colorMode"
	| "cssVars"
	| "customCss"
	| "darkCssVars"
	| "navToggles"
	| "sectionPalettes"
	| "darkSectionPalettes"
	| "theme"
	| "typography"
> & { content?: readonly PraxityPage[] };

/** Course-specific CSS appended after the shared viewer CSS in both bundles. */
export function generateCourseCss(config: CourseCssConfig, includeSlideArtwork = false): string {
	const resolve = (mode: "light" | "dark", vars?: Record<string, string>) => {
		const design: Record<string, unknown> = { ...config.theme };
		for (const [key, value] of Object.entries(vars ?? {})) {
			if (key.startsWith("--praxity-color-"))
				design[
					key.replace("--praxity-", "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
				] = value;
		}
		design[mode === "dark" ? "colorBackgroundDark" : "colorBackgroundLight"] ??=
			design.colorBackground;
		const accessible = String(vars?.["--praxity-font-family"] ?? design.fontFamily ?? "").includes(
			"Atkinson Hyperlegible",
		);
		design.typography = config.typography ?? {
			body: { fontFamily: [accessible ? "Atkinson Hyperlegible" : "Source Sans 3"] },
		};
		return resolveDesignTokens(
			design as unknown as import("@praxity/grammar").DesignVariants,
			mode,
		);
	};
	const emittedCssVars = resolve(config.colorMode === "dark" ? "dark" : "light", config.cssVars);
	const emittedDarkCssVars =
		config.colorMode === "auto" ? resolve("dark", config.darkCssVars) : undefined;
	const themeVarsCss = cssVariableRecordToCss(emittedCssVars);
	const parts = themeVarsCss ? [`:root, :root[data-mantine-color-scheme] { ${themeVarsCss} }`] : [];
	const darkThemeVarsCss = cssVariableRecordToCss(emittedDarkCssVars);
	if (darkThemeVarsCss) {
		parts.push(
			`:root.praxity-theme-dark, :root.praxity-theme-dark[data-mantine-color-scheme] { ${darkThemeVarsCss} }`,
		);
	}
	if (includeSlideArtwork) parts.push(SLIDE_ARTWORK_CSS);
	const blocks = config.content?.flatMap((page) => flattenLogicBlocks(page.blocks)) ?? [];
	const policy = compileBlockStatePolicy(blocks);
	if (
		blocks.some(
			(block) =>
				block.type === "assessment" &&
				block.data.assessmentType === "choice" &&
				policy[block.id] === "device",
		)
	)
		parts.push(privateChoicePrintCss);
	const customCss = sanitizeCss(config.customCss ?? "");
	if (customCss) parts.push(customCss);
	return parts.join("\n");
}

function resolveColorShades(config: CourseConfig): CourseConfig["colorShades"] {
	const explicitBackground =
		config.cssVars?.["--praxity-color-background"] ?? config.theme?.colorBackground;
	if (config.colorShades) {
		return explicitBackground
			? enforceColorShadeTextContrast(
					config.colorShades,
					explicitBackground,
					config.colorMode ?? "light",
				)
			: config.colorShades;
	}
	const theme = config.theme;
	if (!theme) return undefined;
	const result: CourseConfig["colorShades"] = {};
	if (theme.colorAccent) result.accent = generateColorShades(theme.colorAccent);
	if (theme.colorSuccess) result.success = generateColorShades(theme.colorSuccess);
	if (theme.colorError) result.error = generateColorShades(theme.colorError);
	if (theme.colorWarning) result.warning = generateColorShades(theme.colorWarning);
	return Object.keys(result).length > 0
		? enforceColorShadeTextContrast(
				result,
				explicitBackground ?? "#faf9f7",
				config.colorMode ?? "light",
			)
		: undefined;
}

function resolveHighlightStyle(value: unknown): "none" | "marker" | "gradient" | "scribble" {
	if (value === "none" || value === "marker" || value === "gradient" || value === "scribble") {
		return value;
	}
	return "none";
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

const FEATURE_WIDTH_BLOCK_TYPES = new Set<PraxityBlock["type"]>([
	"image",
	"video",
	"chart",
	"table",
]);

function isLayoutMode(value: unknown): value is "narrow" | "wide" | "full" | "breakout" {
	return value === "narrow" || value === "wide" || value === "full" || value === "breakout";
}

function getBlockLayoutMode(block: PraxityBlock): "narrow" | "wide" | "full" | "breakout" | null {
	const data = block.data as Record<string, unknown>;
	if (isLayoutMode(data.layoutMode)) return data.layoutMode;
	if (isLayoutMode(data.layout)) return data.layout;
	return null;
}

function shouldUseFeatureWidth(block: PraxityBlock): boolean {
	if (!FEATURE_WIDTH_BLOCK_TYPES.has(block.type)) return false;
	if (getBlockLayoutMode(block)) return false;
	if (block.type !== "image") return true;
	const width = (block.data as Record<string, unknown>).width;
	return width === undefined || width === null || width === "";
}

function renderBlockHtml(
	block: PraxityBlock,
	sourceLocale?: string,
	strings?: RenderBlockHtmlStrings,
	options?: {
		selfCheckContextPending?: boolean;
		siblingBlocks?: readonly PraxityBlock[];
		extraAttributes?: string[];
		assessmentGroupMembers?: PraxityBlock[];
		suppressLayoutMode?: boolean;
		inheritedLayoutMode?: ReturnType<typeof getBlockLayoutMode>;
		blockIndex?: number;
		defaultImageTreatment?: ImageTreatment;
		imageEffects?: ImageEffectsMap;
		imageEffectsAuto?: boolean;
		imageMetadataMap?: Map<string, ImagePerceptualMetadata>;
		defaultSlideTransition?: "none" | "fade" | "slide" | "zoom";
		enabledIslands?: ReadonlySet<IslandName>;
		hiddenBlockIds?: ReadonlySet<string>;
	},
): string {
	const layoutMode = options?.suppressLayoutMode
		? null
		: (options?.inheritedLayoutMode ?? getBlockLayoutMode(block));
	// Sanitize HTML content fields before serializing
	const data = { ...block.data };
	if (typeof data.content === "string") {
		data.content = sanitizeHtml(data.content, { renderInlineIcons: false });
	}
	if (typeof data.text === "string") {
		data.text = sanitizeHtml(data.text, { renderInlineIcons: false });
	}

	if (block.type === "card") {
		const transition = (data as { transition?: unknown }).transition;
		if (
			(transition === undefined || transition === null || transition === "") &&
			options?.defaultSlideTransition
		) {
			(data as Record<string, unknown>).transition = options.defaultSlideTransition;
		}
	}

	const sanitizedBlock = { ...block, data };
	const kebabType = camelToKebab(block.type);
	const classes = ["praxity-block", `praxity-block-${kebabType}`, `praxity-block-${block.id}`];
	if (layoutMode) {
		classes.push(`praxity-layout-${layoutMode}`);
	}
	if (shouldUseFeatureWidth(block)) {
		classes.push("praxity-block-feature-width");
	}
	const extraAttrs: string[] = [];
	if (block.locale && block.locale !== sourceLocale) {
		extraAttrs.push(`lang="${escapeHtml(block.locale)}"`);
		const blockDir = RTL_LANGS.includes(block.locale.split("-")[0]) ? "rtl" : "ltr";
		extraAttrs.push(`dir="${blockDir}"`);
	}
	extraAttrs.push(...(options?.extraAttributes ?? []));
	return renderSemanticBlockHtml(sanitizedBlock, {
		sourceLocale,
		classNames: classes,
		extraAttributes: extraAttrs,
		assessmentGroupMembers: options?.assessmentGroupMembers,
		enabledIslands: options?.enabledIslands,
		hiddenBlockIds: options?.hiddenBlockIds,
		siblingBlocks: options?.siblingBlocks,
		blockIndex: options?.blockIndex,
		selfCheckContextPending: options?.selfCheckContextPending,
		strings,
	});
}

/**
 * Add data-fallback attributes to mention spans for runtime resolution.
 */
function processMentionPlaceholders(
	html: string,
	variables: Array<{ name: string; defaultValue?: unknown }>,
): string {
	return html.replace(
		/<span\s+data-mention="([^"]+)"([^>]*)>([^<]*)<\/span>/g,
		(match, ref: string, rest: string) => {
			if (rest.includes("data-fallback")) return match;
			let fallback = "";
			if (ref.startsWith("variable:")) {
				const varName = ref.replace("variable:", "");
				const variable = variables.find((v) => v.name === varName);
				fallback = variable?.defaultValue != null ? String(variable.defaultValue) : "";
			}
			return `<span data-mention="${ref}" data-fallback="${escapeHtml(fallback)}"${rest}>${escapeHtml(fallback)}</span>`;
		},
	);
}

function nativeA11yControls(
	strings: ReturnType<typeof getStrings>,
	includeFocus = true,
	utilityLabels = false,
): string {
	const focusControl = includeFocus
		? `<button type="button" data-a11y-action="focus" aria-pressed="false" aria-label="${escapeHtml(strings.a11yFocusReading)}" title="${escapeHtml(strings.a11yFocusReading)}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5h16"/><rect x="3" y="9" width="18" height="6" rx="1"/><path d="M7 12h10"/><path d="M4 19h16"/></svg></button>`
		: "";
	return `<div class="praxity-a11y-pill" role="toolbar" aria-label="${escapeHtml(strings.a11yPreferences)}" aria-orientation="horizontal" data-a11y-toolbar data-praxity-js-control><button type="button" data-a11y-action="text" aria-pressed="false"${utilityLabels ? "" : ` aria-label="${escapeHtml(strings.a11yLargerText)}" title="${escapeHtml(strings.a11yLargerText)}"`}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 15L8 4h1L13 15"/><path d="M5.5 11.5h6"/><path d="M14.5 10l2-4h.5L19 10"/></svg>${utilityLabels ? `<span class="deck-utility-label">${escapeHtml(strings.a11yLargerText)}</span>` : ""}</button>${focusControl}</div>`;
}

// Tabler outline check, embedded so native navigation needs no icon runtime.
const NATIVE_NAV_CHECK =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l5 5l10 -10"/></svg>';

// Tabler outline icons, embedded so deck navigation needs no icon runtime.
const DECK_FOLLOW =
	'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h-6a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h8"/><path d="M18 4v17"/><path d="M15 18l3 3l3 -3"/></svg>';
const DECK_LOCK =
	'<span data-deck-lock hidden aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/></svg></span>';
const DECK_CHECK =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"/><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"/><path d="M9 14l2 2l4 -4"/></svg>';

// Both outlines reserve one trailing status cell, independently of the current row.
function outlineStatus(includeLock = false): string {
	return `<span class="praxity-nav-marker-spacer" aria-hidden="true">${NATIVE_NAV_CHECK}<span class="praxity-nav-current-marker"></span>${includeLock ? DECK_LOCK : ""}</span>`;
}

// Tabler outline arrow-left/right, embedded like the other native navigation icons.
function nativeSlideArrow(direction: "left" | "right"): string {
	const head =
		direction === "left"
			? '<path d="M5 12l6 6"/><path d="M5 12l6 -6"/>'
			: '<path d="M13 18l6 -6"/><path d="M13 6l6 6"/>';
	return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l14 0"/>${head}</svg>`;
}

function nativeSidebarChevron(direction: "left" | "right"): string {
	const paths =
		direction === "left"
			? '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>'
			: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>';
	return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function nativeProgressMarkup(
	style: NavToggleConfig["navProgressStyle"],
	current: number,
	total: number,
	label: string,
	pageIds?: readonly string[],
	showCounter = false,
	inline = true,
): string {
	if (style === "none") return "";
	const value = Math.min(100, Math.round((current / Math.max(total, 1)) * 100));
	if (!style || style === "bar") {
		return `<span class="praxity-native-progress" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${current}"><span style="width:${value}%"></span></span>`;
	}
	if (style === "dots" && pageIds) {
		const dots = pageIds
			.map((pageId, index) => {
				const page = index + 1;
				const state = page === current ? " is-current" : page < current ? " is-visited" : "";
				return `<span class="praxity-progress-dot${state}" data-page-id="${escapeHtml(pageId)}"></span>`;
			})
			.join("");
		return `<div class="praxity-progress-dots${inline ? " praxity-progress-dots--inline" : ""}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${current}"><div class="praxity-progress-dots-row" aria-hidden="true">${dots}</div>${showCounter ? `<div class="praxity-progress-dots-counter">${current} / ${total}</div>` : ""}</div>`;
	}
	const grouped = style === "segments" && total > 20;
	const step = grouped ? Math.ceil(total / 5) : 1;
	const count = Math.ceil(total / step);
	const items = Array.from({ length: count }, (_, index) => {
		const start = index * step + 1;
		const end = Math.min((index + 1) * step, total);
		const active = style === "dots" ? start === current : start <= current;
		return `<span aria-hidden="true"${active ? ' data-active="true"' : ""}${grouped ? ` data-page-range="${start}-${end}"` : ""}>${grouped ? `<span>${start}–${end}</span>` : ""}</span>`;
	}).join("");
	return `<span class="praxity-native-progress praxity-native-progress--${style}${grouped ? " praxity-native-progress--grouped" : ""}" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${current}">${items}</span>`;
}

// ---------------------------------------------------------------------------
// Page generators
// ---------------------------------------------------------------------------

export interface SlugEntry {
	pageId: string;
	slug: string;
	title: string;
}

export interface PageGenOptions {
	choiceFacts?: ChoiceStateFacts;
	deckPages?: DeckPage[];
	config: CourseConfig;
	page: PraxityPage;
	index: number;
	currentSlug: string;
	slugList: SlugEntry[];
	slugMap: Map<string, string>;
	/** Fingerprinted first-paint and document-shell runtime. */
	shellFilename?: string;
	/** Classic resume orientation loaded only after a confirmed LMS return. */
	resumeFilename?: string;
	islandAssets?: {
		privacy?: { bootstrap: string; support: string };
		privateChoice?: string;
		selfCheckLifetime?: string;
		writeDistractorsCss?: string;
		loaderFilename: string;
		islandFilenames: Partial<Record<IslandName, string>>;
	};
	basePath?: string;
	/** Full stylesheet emitted by build.ts for Mantine-backed islands. */
	stylesheetFilename?: string;
	/** Mantine-free stylesheet emitted by build.ts for native/static pages. */
	liteStylesheetFilename?: string;
	/** Stylesheets containing native deck controls, selected only for module-deck pages. */
	deckStylesheets?: { full: string; lite: string };
	/** Synchronous pattern CSS, selected by the retrieval-sheet island plan. */
	retrievalSheetStylesheetFilename?: string;
	highlightStylesheetFilename?: string;
	usedStylesheets?: Set<string>;
	/** Page-scoped capability plan. */
	runtimePlan?: PageRuntimePlan;
	/** When provided, replaces the rendered block HTML in the main content area. */
	overrideBodyHtml?: string;
	/** Already compiled content, preserving the ordinary content shell. */
	pageContentHtml?: string;
}

export function availableIslandNames(
	islandAssets: PageGenOptions["islandAssets"],
): ReadonlySet<IslandName> {
	return new Set(
		Object.entries(islandAssets?.islandFilenames ?? {})
			.filter(([, filename]) => Boolean(filename))
			.map(([name]) => name as IslandName),
	);
}

/** Defence in depth for callers that supply compiled pages, including drafts.
 * Source-level, course-wide diagnostics remain validateCourse's responsibility. */
export function assertPracticeLogic(pages: readonly PraxityPage[], locale = "en"): void {
	const all = pages.flatMap((page) => flattenLogicBlocks(page.blocks));
	const policy = compileBlockStatePolicy(all);
	const practice = (block: (typeof all)[number]) =>
		["retrievalSheet", "writeDistractors", "highlight"].includes(block.type) ||
		(block.type === "assessment" &&
			block.data.assessmentType === "choice" &&
			(block.data.private === true || policy[block.id] === "device"));
	const practiceIds = new Set(all.filter(practice).map((block) => block.id));
	if (!practiceIds.size) return;
	const containsPractice = (block: (typeof all)[number]) =>
		flattenLogicBlocks([block]).some((child) => practiceIds.has(child.id));
	const requiredTargets = new Set(all.filter(containsPractice).map((block) => block.id));
	const sheetTargets = new Set(
		all
			.filter((block) =>
				flattenLogicBlocks([block]).some((child) =>
					["retrievalSheet", "writeDistractors", "highlight"].includes(child.type),
				),
			)
			.map((block) => block.id),
	);
	// Publication deliberately refuses if ANY matching definition is practice:
	// duplicate logic names remain advisory and cannot shadow this boundary.
	const matches = (ref: string, ids: ReadonlySet<string>) =>
		all.some((block) => ids.has(block.id) && resolveBlockRef([block], ref) === block.id);
	for (const [pageIndex, page] of pages.entries()) {
		const read = (ref: unknown, owner: string, path: string) => {
			if (typeof ref === "string" && ref.startsWith("block:") && matches(ref.slice(6), practiceIds))
				throw new PracticeAdmissionError("practice-no-tracking", owner, path, locale);
		};
		const visit = (value: unknown, owner: string, path: string): void => {
			if (typeof value === "string" && /data-mention/i.test(value)) {
				// Use the same HTML parser/sanitizer as published rich text. Its
				// serialization normalizes attribute case, quotes and entities.
				for (const mention of sanitizeHtml(value).matchAll(/\bdata-mention="([^"]*)"/g)) {
					const ref = fullyDecodeEntities(mention[1]).split(":");
					if (ref[0] === "blockOutput" && ref[1] && matches(ref[1], practiceIds))
						throw new PracticeAdmissionError("practice-no-tracking", owner, path, locale);
				}
			}
			if (Array.isArray(value)) {
				value.forEach((entry, index) => visit(entry, owner, `${path}[${index}]`));
				return;
			}
			if (!value || typeof value !== "object") return;
			const record = value as Record<string, unknown>;
			if (typeof record.id === "string" && typeof record.type === "string" && record.data) {
				owner = record.id;
				const data = record.data as Record<string, unknown>;
				// Compiled groups use sibling ID membership, not nested child blocks.
				if (record.type === "assessmentGroup" && Array.isArray(data.memberBlockIds)) {
					for (const [index, member] of data.memberBlockIds.entries()) {
						if (typeof member === "string" && matches(member, sheetTargets))
							throw new PracticeAdmissionError(
								"practice-no-tracking",
								owner,
								`${path}.data.memberBlockIds[${index}]`,
								locale,
							);
					}
				}

				if (
					(data.required === true && requiredTargets.has(owner)) ||
					((data.deckGate !== undefined || data._deckGate !== undefined) && sheetTargets.has(owner))
				)
					throw new PracticeAdmissionError(
						"practice-no-tracking",
						owner,
						`${path}.data.${data.required === true ? "required" : data.deckGate !== undefined ? "deckGate" : "_deckGate"}`,
						locale,
					);
			}
			read(record.source, owner, `${path}.source`);
			read(record.ref, owner, `${path}.ref`);
			if (typeof record.visible === "string")
				read(compileVisibleExpression(record.visible).rules[0].source, owner, `${path}.visible`);
			if (record.type === "require" || record.type === "requireCompletion") {
				// The two runtime normalizers disagree on malformed target arrays.
				// Conservatively inspect every string operand from either spelling.
				const targets = [
					{ value: record.target, path: `${path}.target` },
					...(Array.isArray(record.targets)
						? record.targets.map((value, index) => ({ value, path: `${path}.targets[${index}]` }))
						: []),
				];
				for (const target of targets)
					if (typeof target.value === "string" && matches(target.value, requiredTargets))
						throw new PracticeAdmissionError("practice-no-tracking", owner, target.path, locale);
			}
			for (const [key, child] of Object.entries(record)) {
				if (isInlineProjectionMetadataKey(key, { keepDisplay: true })) continue;
				if (
					["retrievalSheet", "writeDistractors", "highlight"].includes(String(record.type)) &&
					key === "data" &&
					child &&
					typeof child === "object"
				) {
					const { content: _content, ...settings } = child as Record<string, unknown>;
					visit(settings, owner, `${path}.data`);
				} else visit(child, owner, `${path}.${key}`);
			}
		};
		visit(page, page.id, `pages[${pageIndex}]`);
	}
}

/** Compiled callers must satisfy the exact device-policy predicate too. */
function assertPracticePublication(pages: readonly PraxityPage[], locale = "en"): void {
	const all = pages.flatMap((page) => flattenLogicBlocks(page.blocks));
	const members = new Set(
		all
			.filter((block) => block.type === "assessmentGroup")
			.flatMap((block) =>
				Array.isArray(block.data.memberBlockIds) ? block.data.memberBlockIds : [],
			),
	);
	const visit = (value: unknown, path: string, ancestorRequiredOrGated = false): void => {
		if (Array.isArray(value)) {
			value.forEach((child, index) => visit(child, `${path}[${index}]`, ancestorRequiredOrGated));
			return;
		}
		if (!value || typeof value !== "object") return;
		const block = value as Record<string, unknown>;
		const data = block.data as Record<string, unknown> | undefined;
		if (block.type === "writeDistractors") constructWriteDistractorsPromptBlock(block);
		if (block.type === "highlight")
			assertHighlightData(
				data,
				typeof block.id === "string" ? block.id : "unknown",
				`${path}.data`,
				locale,
			);
		if (block.type === "retrievalSheet")
			assertRetrievalSheetData(
				data,
				typeof block.id === "string" ? block.id : "unknown",
				`${path}.data`,
				locale,
			);
		// Private descendants must never contribute to a container's required/gated completion.
		const requiredOrGated =
			ancestorRequiredOrGated ||
			(typeof block.id === "string" &&
				typeof block.type === "string" &&
				(data?.required === true || data?._deckGate !== undefined || data?.deckGate !== undefined));

		if (
			typeof block.id === "string" &&
			block.type === "assessment" &&
			data?.assessmentType === "choice" &&
			data.private === true &&
			compileBlockStatePolicy([block as unknown as PraxityBlock])[block.id] !== "device"
		)
			throw new PracticeAdmissionError(
				"unsupported-runtime",
				block.id,
				`${path}.data.private`,
				locale,
			);
		if (
			typeof block.id === "string" &&
			block.type === "assessment" &&
			data?.assessmentType === "choice" &&
			compileBlockStatePolicy([block as unknown as PraxityBlock])[block.id] === "device"
		) {
			const grading = data.gradingMode ?? (data.graded ? "exact" : "none");
			if (members.has(block.id) || grading !== "none" || requiredOrGated)
				throw new PracticeAdmissionError(
					"private-choice-practice-only",
					block.id,
					`${path}.data`,
					locale,
				);
		}
		for (const [key, child] of Object.entries(block))
			if (!isInlineProjectionMetadataKey(key, { keepDisplay: true }))
				visit(child, `${path}.${key}`, requiredOrGated);
	};
	pages.forEach((page, index) => visit(page.blocks, `pages[${index}].blocks`));
	assertPracticeLogic(pages, locale);
}

/**
 * Required, automatically scored questions, with each assessment group counted once.
 * They gate completion under the knowledge-check rule and make up the course score
 * for a pass mark; either way each must be able to report a result.
 */
export function collectRequiredAssessmentIds(
	pages: readonly PraxityPage[],
	purpose: "knowledgeChecks" | "passingScore" = "knowledgeChecks",
): string[] {
	const repair =
		purpose === "passingScore"
			? "Make it optional or remove the course passing score."
			: "Make it optional or turn off required knowledge checks for this course.";
	const requiredIds = new Set<string>();
	for (const page of pages) {
		const blocks = flattenLogicBlocks(page.blocks);
		const hiddenIds = initiallyHiddenBlockIds(page.blocks);
		for (const block of blocks) {
			if (!hiddenIds.has(block.id)) continue;
			for (const child of flattenLogicBlocks([block])) hiddenIds.add(child.id);
		}
		const autoScored = (block: (typeof blocks)[number]) => {
			if (block.type !== "assessment") return false;
			const data = block.data;
			if ((data.gradingMode ?? (data.graded ? "exact" : "none")) === "none") return false;
			const assessmentType = data.assessmentType ?? "choice";
			if (assessmentType === "choice") {
				const response = data.response as { options?: { isCorrect?: boolean }[] } | undefined;
				return (
					Array.isArray(response?.options) &&
					response.options.some((option) => option?.isCorrect === true)
				);
			}
			if (assessmentType !== "fillBlank") {
				return ["hotspot", "matching", "sequence", "categorize"].includes(String(assessmentType));
			}
			const response = data.response as
				| { blanks?: { answer?: string; alternatives?: string[] }[] }
				| undefined;
			return (
				Array.isArray(response?.blanks) &&
				response.blanks.some(
					(blank) =>
						blank &&
						[blank.answer, ...(Array.isArray(blank.alternatives) ? blank.alternatives : [])].some(
							(answer) => typeof answer === "string" && answer.trim().length > 0,
						),
				) === true
			);
		};
		const requiredChecks = new Set(
			blocks
				.filter((block) => block.data.required !== false && autoScored(block))
				.map((block) => block.id),
		);
		for (const block of blocks) {
			if (!requiredChecks.has(block.id)) continue;
			const reason =
				block.data.private === true
					? "private and cannot report a passing result"
					: hiddenIds.has(block.id)
						? "hidden or conditional"
						: null;
			if (reason) {
				throw new Error(`Required knowledge check "${block.id}" is ${reason}. ${repair}`);
			}
		}
		for (const group of blocks) {
			if (group.type !== "assessmentGroup" || !Array.isArray(group.data.memberBlockIds)) continue;
			const members = group.data.memberBlockIds as string[];
			const required = members.some((id) => requiredChecks.has(id));
			// A oneOf group scores only the member the learner picks, so an unscored option
			// would leave the course result undecided forever.
			if (
				required &&
				purpose === "passingScore" &&
				group.data.mode === "oneOf" &&
				members.some((id) => !blocks.some((block) => block.id === id && autoScored(block)))
			) {
				throw new Error(
					`Assessment group "${group.id}" lets learners choose a question that is not automatically scored, so the course result could never be decided. Score every question in the group or remove the course passing score.`,
				);
			}
			for (const id of members) requiredChecks.delete(id);
			if (required) requiredChecks.add(group.id);
		}
		for (const id of requiredChecks) {
			if (hiddenIds.has(id)) {
				throw new Error(`Required knowledge check "${id}" is hidden or conditional. ${repair}`);
			}
			requiredIds.add(id);
		}
	}
	if (purpose === "passingScore" && !requiredIds.size)
		throw new Error(
			"A course passing score needs at least one required, automatically scored question. Add one or remove the passing score.",
		);
	return [...requiredIds];
}

/** Published duration rules shared by navigation digests and document rendering. */
export function publishedReadingTimes(pages: readonly Pick<PraxityPage, "blocks">[]) {
	const estimates = pages.map((page) =>
		page.blocks.reduce(
			(total, block) => total + estimateBlockTime(block, { readingSpeed: 180 }),
			0,
		),
	);
	return {
		pageMinutes: estimates.map((minutes) => (minutes > 0 ? Math.max(1, Math.round(minutes)) : 0)),
		courseMinutes: Math.max(
			1,
			Math.round(estimates.reduce((total, minutes) => total + minutes, 0)),
		),
	};
}

export function courseVariables(config: CourseConfig) {
	const variableNames = new Set<string>();
	return config.pages
		.flatMap((candidate) => flattenLogicBlocks(candidate.blocks))
		.filter((b) => b.type === "variable")
		.map((b) => {
			const d = b.data as {
				variableName: string;
				dataType: string;
				source?: string;
				defaultValue?: unknown;
				locked?: boolean;
				urlParamName?: string;
				urlParamFallback?: unknown;
				lmsField?: string;
				lmsFallback?: unknown;
			};
			return {
				name: d.variableName,
				dataType: d.dataType,
				source: d.source,
				defaultValue: d.defaultValue,
				locked: d.locked,
				urlParamName: d.urlParamName,
				urlParamFallback: d.urlParamFallback,
				lmsField: d.lmsField,
				lmsFallback: d.lmsFallback,
			};
		})
		.filter((variable) => {
			if (!variable.name || variableNames.has(variable.name)) return false;
			variableNames.add(variable.name);
			return true;
		});
}

/** Keep native and override slide bodies on the same optional artwork frame. */
function slideFrame(config: CourseConfig, page: PraxityPage): { open: string; close: string } {
	const style = resolvePageSlideStyle(page, config.slideStyles);
	const name = style.name;
	const variables = Object.entries(style.variables)
		.map(([key, value]) => `${key}:${sanitizeCssValue(value)}`)
		.join(";");
	const attributes = `${name ? ` data-slide-style="${escapeHtml(name)}"` : ""}${style.chrome === "minimal" ? ' data-slide-chrome="minimal"' : ""} style="${escapeHtml(variables)}"`;
	const slide = `<div class="praxity-slide"${attributes}>`;
	if (!style.cornerImage) return { open: slide, close: "</div>" };
	const escaping = flattenLogicBlocks(page.blocks).some((block) => {
		const mode = getBlockLayoutMode(block);
		return mode === "full" || mode === "breakout";
	});
	return {
		open: `<div class="praxity-slide-canvas" data-corner-placement="${escaping ? "flow" : "corners"}" style="${escapeHtml(variables)}"><div class="praxity-slide-artwork">${slide}`,
		close: "</div></div></div>",
	};
}

export interface UnresolvedNode {
	code: "invalid-source";
	line: number;
}

export interface HtmlFragment {
	id: string;
	kind: "node" | "region";
	html: string;
	island?: IslandName;
}

export function renderPageContent(
	config: CourseConfig,
	page: PraxityPage,
	islands: ReadonlySet<IslandName>,
): string {
	return renderPageFragments(config, page, islands)
		.map((fragment) => fragment.html)
		.join("\n");
}

export function renderPageFragments(
	config: CourseConfig,
	sourcePage: PraxityPage,
	islandsNeeded: ReadonlySet<IslandName>,
	nodeId?: string,
	unresolvedNodes?: ReadonlyMap<string, UnresolvedNode>,
	selfCheckContextPending = false,
): HtmlFragment[] {
	assertPracticePublication([sourcePage], sourcePage.locale ?? config.sourceLocale);
	config = { ...config, sourceLocale: sourcePage.locale ?? config.sourceLocale };
	const localeStrings = getStrings(config.sourceLocale ?? "en");
	const page = {
		...sourcePage,
		blocks: preparePageFootnotes(
			resolveAssessmentDontKnow(sourcePage.blocks, config.moduleDeck),
			sourcePage.id,
			localeStrings,
		),
	};
	const sectionBlocks = page.blocks;
	const sectionRhythm = "uniform";
	const sections: SectionGroup[] = groupBlocksIntoSections(sectionBlocks, sectionRhythm);
	const hiddenBlockIds = initiallyHiddenBlockIds(sectionBlocks);
	const variables = courseVariables(config);
	const nativeSlides =
		!!config.moduleDeck ||
		resolvePageNavigation(config, page).effectiveLayoutArchetype === "slides";
	const fragments: HtmlFragment[] = [];
	const region = (id: string, html: string) => {
		if (nodeId === undefined) fragments.push({ id: `region:${id}`, kind: "region", html });
	};
	const frame = nativeSlides ? slideFrame(config, page) : undefined;
	if (frame) region(`slide-open:${sourcePage.id}`, frame.open);
	const groupMemberLayouts = new Map<string, NonNullable<ReturnType<typeof getBlockLayoutMode>>>();
	const groupMembers = new Map<
		string,
		{
			groupId: string;
			reportTitle: string;
			first: boolean;
			last: boolean;
			oneOfUnselected: boolean;
			downloadSubmit: boolean;
		}
	>();
	const groupBlockMembers = new Map<string, PraxityBlock[]>();
	const groupReportTitles = new Map<string, string>();
	const groupContexts = new Map<string, string>();
	const groupFooters = new Map<string, { id: string; html: string }>();
	for (const group of buildAssessmentGroups(sectionBlocks)) {
		groupBlockMembers.set(
			group.id,
			group.memberBlockIds.flatMap((id) => {
				const member = sectionBlocks.find((block) => block.id === id);
				return member ? [member] : [];
			}),
		);
		const first = sectionBlocks.findIndex((block) => block.id === group.id);
		const memberIds = new Set(group.memberBlockIds);
		const last = sectionBlocks.reduce(
			(index, block, position) => (memberIds.has(block.id) ? position : index),
			-1,
		);
		if (first < 0 || last <= first) continue;
		const reportTitle =
			plainTextFromHtml(getInlineField(sectionBlocks[first].data, "groupName", false)) ||
			plainTextFromHtml(page.title);
		groupReportTitles.set(group.id, reportTitle);
		if (group.layout) groupMemberLayouts.set(group.id, group.layout);
		let memberIndex = 0;
		for (const block of sectionBlocks.slice(first + 1, last + 1)) {
			if (group.layout) groupMemberLayouts.set(block.id, group.layout);
			if (memberIds.has(block.id)) {
				groupMembers.set(block.id, {
					groupId: group.id,
					reportTitle,
					downloadSubmit:
						!group.isGraded ||
						(block.data?.assessmentType === "textResponse" &&
							["txt", "docx", "both"].includes(
								String((block.data?.response as { downloadAs?: unknown } | undefined)?.downloadAs),
							)),
					first: memberIndex++ === 0,
					last: sectionBlocks[last].id === block.id,
					oneOfUnselected: group.mode === "oneOf" && block.id !== group.memberBlockIds[0],
				});
			} else {
				groupContexts.set(block.id, group.id);
			}
		}
		const layoutClass = group.layout ? ` praxity-layout-${group.layout}` : "";
		const label = assessmentGroupSubmitLabel(group, localeStrings);
		groupFooters.set(sectionBlocks[last].id, {
			id: group.id,
			html: `<div class="praxity-assessment-group-submit${layoutClass}" data-assessment-group-submit="${escapeHtml(group.id)}"><button type="button" class="praxity-btn praxity-btn-filled praxity-ag-submit-btn" disabled>${escapeHtml(label)}</button><div data-assessment-group-results></div></div>`,
		});
	}
	const blockContexts = new Map<
		PraxityBlock,
		{ siblingBlocks: readonly PraxityBlock[]; blockIndex: number }
	>();
	for (const section of sections) {
		section.blocks.forEach((block, blockIndex) => {
			blockContexts.set(block, { siblingBlocks: section.blocks, blockIndex });
		});
	}
	const renderBlock = (block: PraxityBlock, inFloat = false, framedContext = false) => {
		if (nodeId !== undefined && block.id !== nodeId) return;
		const blockContext = blockContexts.get(block);
		const member = groupMembers.get(block.id);
		const groupId = groupContexts.get(block.id);
		const error = unresolvedNodes?.get(block.id);
		const extraAttributes = [
			...(error ? ["data-preview-error", `data-source-line="${error.line}"`] : []),
			...(groupId && !framedContext
				? [`data-assessment-group-context="${escapeHtml(groupId)}"`]
				: []),
			...(member ? [`data-assessment-group="${escapeHtml(member.groupId)}"`] : []),
			...(member?.first ? ["data-group-first"] : []),
			...(member?.last ? ["data-group-last", "data-group-has-footer"] : []),
			...(member?.oneOfUnselected ? ["data-group-oneof-unselected"] : []),
			...(member?.downloadSubmit ? ["data-assessment-group-download-submit"] : []),
			...(block.type === "assessment" || block.type === "assessmentGroup"
				? [
						`data-assessment-report-title="${escapeHtml(groupReportTitles.get(block.id) ?? member?.reportTitle ?? plainTextFromHtml(page.title))}"`,
					]
				: []),
		];
		const renderedNode: PraxityBlock = error
			? {
					id: block.id,
					type: "note",
					data: {
						noteType: "error",
						title: interpolate(getPreviewStrings(config.sourceLocale).errorLine, {
							line: error.line,
						}),
						content: `<p>${escapeHtml(getPreviewStrings(config.sourceLocale).invalidSource)}</p>`,
					},
				}
			: block;
		const renderedBlock = renderBlockHtml(renderedNode, config.sourceLocale, localeStrings, {
			...blockContext,
			selfCheckContextPending,
			extraAttributes,
			assessmentGroupMembers: groupBlockMembers.get(block.id),
			suppressLayoutMode: framedContext,
			inheritedLayoutMode: groupMemberLayouts.get(block.id),
			defaultImageTreatment: config.defaultImageTreatment,
			imageEffects: config.imageEffects,
			imageEffectsAuto: config.imageEffectsAuto,
			imageMetadataMap: config.imageMetadataMap,
			defaultSlideTransition: config.slideTransition,
			enabledIslands: islandsNeeded,
			hiddenBlockIds,
		});
		fragments.push({
			id: block.id,
			kind: "node",
			html: processMentionPlaceholders(renderedBlock, variables),
			island: error ? undefined : getBlockIsland(block),
		});
		const footer = groupFooters.get(block.id);
		if (footer) region(`group-footer:${footer.id}`, footer.html);
	};
	const renderFlow = (blocks: PraxityBlock[]) => {
		for (const [regionIndex, flow] of imageFloatRegions(blocks).entries()) {
			const contextGroup =
				flow.float && flow.blocks.length > 0 ? groupContexts.get(flow.blocks[0].id) : undefined;
			const framedContext = Boolean(
				contextGroup && flow.blocks.every((block) => groupContexts.get(block.id) === contextGroup),
			);
			if (flow.float) {
				const layout = framedContext ? groupMemberLayouts.get(flow.blocks[0].id) : undefined;
				region(
					`float-open:${flow.nodeId ?? regionIndex}`,
					`<div class="praxity-float-region${layout ? ` praxity-layout-${layout}` : ""}" data-image-float-region="${flow.float}"${framedContext ? ` data-assessment-group-context="${escapeHtml(contextGroup ?? "")}"` : ""}${flow.nodeId ? ` data-node-id="${escapeHtml(flow.nodeId)}"` : ""}>`,
				);
			} else if (flow.nodeId)
				region(`float-open:${flow.nodeId}`, `<div data-node-id="${escapeHtml(flow.nodeId)}">`);
			flow.blocks.forEach((block) => renderBlock(block, !!flow.float, framedContext));
			if (flow.float || flow.nodeId) region(`float-close:${flow.nodeId ?? regionIndex}`, "</div>");
		}
	};
	// Sections use headings and space; authored blocks retain their order.
	renderFlow(sectionBlocks);
	if (frame) region(`slide-close:${sourcePage.id}`, frame.close);
	return fragments;
}

/** Compile effective facts before a document or replacement output can be published. */
function compileChoiceStateFacts(config: CourseConfig): ChoiceStateFacts {
	const facts: ChoiceStateFacts = { choiceStateQuestions: {}, choiceStateSignatures: {} };
	for (const page of config.pages) {
		const blocks = preparePageFootnotes(
			resolveAssessmentDontKnow(prepareInlineBlocks(page.blocks), config.moduleDeck),
			page.id,
			getStrings(page.locale ?? config.sourceLocale),
		);
		const flat = flattenLogicBlocks(blocks);
		for (const block of flat) {
			if (block.type === "assessmentGroup" && !choiceGroupDefinitionIsValid(block.data))
				throw choiceFactError(block.id, "group definition");
		}
		for (const group of buildAssessmentGroups(flat)) {
			const members = flat.filter((block) => group.memberBlockIds.includes(block.id));
			const value = {
				mode: group.mode,
				memberIds: group.memberBlockIds,
				requiredIds: [...assessmentGroupRequirements(members).requiredIds],
			};
			if (group.memberBlockIds.some((id) => !members.some((member) => member.id === id)))
				throw choiceFactError(group.id, "missing group member");
			const groups = (facts.choiceStateGroups ??= Object.create(null));
			if (
				Object.hasOwn(groups, group.id) &&
				JSON.stringify(groups[group.id]) !== JSON.stringify(value)
			)
				throw choiceFactError(group.id, "duplicate group ID");
			groups[group.id] = value;
		}
		for (const block of flat) {
			if (block.type !== "assessment" || (block.data.assessmentType ?? "choice") !== "choice")
				continue;
			const data = block.data as unknown as AssessmentBlockData;
			const refuse = (field: string): never => {
				throw choiceFactError(block.id, field);
			};
			const mode = (data.response as { selectionMode?: unknown } | undefined)?.selectionMode;
			if (mode !== "single" && mode !== "multiple") refuse("selectionMode");
			if (
				data.attempts !== undefined &&
				data.attempts !== null &&
				(!Number.isSafeInteger(data.attempts) || data.attempts < 0)
			)
				refuse("attempts");
			const question = choiceStateQuestion(data, data._dontKnow === true);
			if (!isChoiceStateQuestion(question)) refuse("effective question");
			if (Object.hasOwn(facts.choiceStateQuestions, block.id)) {
				if (JSON.stringify(facts.choiceStateQuestions[block.id]) !== JSON.stringify(question))
					refuse("duplicate ID");
				continue;
			}
			Object.defineProperty(facts.choiceStateQuestions, block.id, {
				value: question,
				enumerable: true,
			});
			Object.defineProperty(facts.choiceStateSignatures, block.id, {
				value: choiceProofSignature(choiceMaterialProof(question)),
				enumerable: true,
			});
		}
	}
	for (const [id, group] of Object.entries(facts.choiceStateGroups ?? {})) {
		if (
			!id ||
			!choiceGroupFactsAreValid(group, facts.choiceStateGroups ?? {}) ||
			Object.hasOwn(facts.choiceStateQuestions, id)
		)
			throw choiceFactError(id, "group dependencies");
	}
	return facts;
}

/** Generate a complete HTML page around the shared semantic page content. */
export function generateHtmlPage(opts: PageGenOptions): string {
	assertPracticePublication([opts.page], opts.page.locale ?? opts.config.sourceLocale);
	const choiceFacts = opts.choiceFacts ?? compileChoiceStateFacts(opts.config);
	const publishedChoiceFacts =
		Object.keys(choiceFacts.choiceStateQuestions).length ||
		Object.keys(choiceFacts.choiceStateGroups ?? {}).length
			? choiceFacts
			: {};
	const {
		config: courseConfig,
		page: sourcePage,
		index,
		currentSlug,
		slugList,
		slugMap,
		shellFilename = "course-shell.js",
		resumeFilename = "course-resume.js",
		basePath,
		overrideBodyHtml,
	} = opts;
	const config = { ...courseConfig, sourceLocale: sourcePage.locale ?? courseConfig.sourceLocale };
	const page = {
		...sourcePage,
		blocks: preparePageFootnotes(
			sourcePage.blocks,
			sourcePage.id,
			getStrings(config.sourceLocale ?? "en"),
		),
	};

	const lang = sanitizeLanguage(config.sourceLocale);
	const baseLang = lang.split("-")[0].toLowerCase();
	const dir = RTL_LANGS.includes(baseLang) ? "rtl" : "ltr";
	const totalPages = config.totalPages;
	const currentPage = index + 1;
	const completionMethod = config.completionMethod ?? "allPages";
	const courseId = config.id;
	const colorShades = resolveColorShades(config);
	const sectionRhythm = "uniform";
	const pageRole =
		overrideBodyHtml !== undefined && currentSlug === "glossary"
			? "glossary"
			: overrideBodyHtml !== undefined && currentSlug === "resources"
				? "resources"
				: "content";

	// Per-page nav overrides (page-break params). Same helpers the viewer runs,
	// so the exporter's static decisions cannot disagree with the React shell.
	const { pageNavToggles, effectiveLayoutArchetype } = resolvePageNavigation(config, page);
	const plannedRuntime =
		opts.runtimePlan ?? planPageRuntime(config, page, availableIslandNames(opts.islandAssets));
	const deckPresentation = plannedRuntime.presentation === "module-deck";
	const suppressNav = deckPresentation || navArchetypeSuppressesNav(effectiveLayoutArchetype);
	const slidesLayout = effectiveLayoutArchetype === "slides";
	const pageFocusDefault = getPageFocusDefault(page.data) === true;

	// Build branching metadata
	const runtimeBlocks = flattenLogicBlocks(page.blocks);
	const logicBlocks = runtimeBlocks
		.filter((b) => b.type === "logic")
		.map((b) => ({
			...(b.data as { conditions: unknown; actions: unknown }),
			blockId: b.id,
		}));
	const variables = courseVariables(config);
	const visibility = runtimeBlocks.flatMap((block) => {
		const visible = (block.data as Record<string, unknown>).visible;
		return typeof visible === "string" && visible.trim()
			? [{ blockId: block.id, conditions: compileVisibleExpression(visible) }]
			: [];
	});
	const hiddenBlockIds = initiallyHiddenBlockIds(page.blocks);
	const floatingTocEntries = runtimeBlocks.flatMap((block) => {
		if (block.type !== "heading") return [];
		const data = block.data as Record<string, unknown>;
		const baseLevel = normalizeHeadingLevel(data.level);
		const rawOffset = Number(data.headingOffset ?? 0);
		const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;
		const level = normalizeHeadingLevel(baseLevel + offset, baseLevel);
		const text = plainTextFromHtml(data.content);
		return (level === 2 || level === 3) && text
			? [{ blockId: block.id, level, text, hidden: hiddenBlockIds.has(block.id) }]
			: [];
	});
	const pageIdMap: Record<string, string> = {};
	for (const [pageId, slug] of slugMap.entries()) {
		pageIdMap[pageId] = slug;
	}
	const decodedPageTitle = fullyDecodeEntities(page.title);
	const decodedLessonTitle = page.lessonTitle ? fullyDecodeEntities(page.lessonTitle) : undefined;
	const decodedLessonKicker =
		typeof page.lessonKicker === "string"
			? fullyDecodeEntities(page.lessonKicker)
			: page.lessonKicker;

	// Build page navigation JSON for CourseMenu/PageNav
	const pagesList = slugList.map((entry, i) => {
		const p = config.pages[i];
		// Narration segments hold raw block source and the runtime never reads them here;
		// this page's playlist below is their only learner-facing output.
		const { _narrationSegments, ...data } = p?.data ?? {};
		return {
			id: entry.pageId,
			title: fullyDecodeEntities(entry.title),
			slug: entry.slug,
			index: i + 1,
			lessonId: p?.lessonId,
			lessonTitle: p?.lessonTitle ? fullyDecodeEntities(p.lessonTitle) : p?.lessonTitle,
			lessonKicker:
				typeof p?.lessonKicker === "string" ? fullyDecodeEntities(p.lessonKicker) : p?.lessonKicker,
			isFirstPageOfLesson: p?.isFirstPageOfLesson,
			narrationEnabled: p?.narrationEnabled,
			narrationDefaults: p?.narrationDefaults,
			data: p?.data && data,
		};
	});

	const localeStrings = getStrings(config.sourceLocale ?? "en");
	const lessons = pagesList.filter((entry) => entry.lessonId && entry.isFirstPageOfLesson);
	const moduleNavigation = lessons.length > 1;
	const localPages = moduleNavigation
		? pagesList.filter((entry) => entry.lessonId === page.lessonId)
		: pagesList;
	const localPosition =
		pageRole === "content"
			? interpolate(localeStrings.pageOf, {
					current: moduleNavigation
						? localPages.findIndex((entry) => entry.id === page.id) + 1
						: currentPage,
					total: moduleNavigation ? localPages.length : totalPages,
				})
			: "";
	const pagePosition =
		pageRole === "content" && moduleNavigation
			? `${interpolate(localeStrings.moduleOf, { current: lessons.findIndex((entry) => entry.lessonId === page.lessonId) + 1, total: lessons.length })} · ${localPosition}`
			: localPosition;
	const progressCurrent = moduleNavigation
		? localPages.findIndex((entry) => entry.id === page.id) + 1
		: currentPage;
	const progressTotal = moduleNavigation ? localPages.length : totalPages;
	const progressPageIds = moduleNavigation
		? localPages.map((entry) => entry.id)
		: slugList.map((entry) => entry.pageId);
	const nextLesson = moduleNavigation && slugList[index + 1] ? pagesList[index + 1] : undefined;
	const nextLabel =
		nextLesson && nextLesson.lessonId !== page.lessonId
			? localeStrings.nextModule
			: localeStrings.next;

	const previousLesson = moduleNavigation && slugList[index - 1] ? pagesList[index - 1] : undefined;
	const previousLabel =
		previousLesson && previousLesson.lessonId !== page.lessonId
			? localeStrings.previousModule
			: localeStrings.previous;
	const nextLabelMarkup =
		nextLabel === localeStrings.next
			? escapeHtml(nextLabel)
			: `<span class="praxity-nav-label-full">${escapeHtml(nextLabel)}</span><span class="praxity-nav-label-compact">${escapeHtml(localeStrings.next)}</span>`;
	const previousLabelMarkup =
		previousLabel === localeStrings.previous
			? escapeHtml(previousLabel)
			: `<span class="praxity-nav-label-full">${escapeHtml(previousLabel)}</span><span class="praxity-nav-label-compact">${escapeHtml(localeStrings.previous)}</span>`;
	// Shows "3 / 6" and reads as "Page 3 of 6". Static text, not a status message:
	// each page is a full document, so the counter never changes after load.
	const compactPositionMarkup = `<span aria-hidden="true">${progressCurrent} / ${progressTotal}</span><span class="praxity-a11y-sr-only">${escapeHtml(localPosition)}</span>`;
	const pageCountMarkup = `<span class="praxity-nav-progress"><span class="praxity-nav-label-full">${escapeHtml(localPosition)}</span><span class="praxity-nav-label-compact">${compactPositionMarkup}</span></span>`;

	// overrideBodyHtml bypasses block rendering for special pages (e.g. glossary)
	const sectionBlocks = page.blocks;
	const runtimeMode = plannedRuntime.mode;
	const islandsNeeded = new Set<IslandName>(plannedRuntime.islands);
	const needsMantine = islandsNeeded.has("assessment");
	const nativeNav = islandsNeeded.has("nav");
	const pagesPresentation = !slidesLayout && !deckPresentation;
	const nativeSlides = slidesLayout && !deckPresentation;
	const nativeMinimal = effectiveLayoutArchetype === "minimal";
	const hasNarration = islandsNeeded.has("narration");
	const prevPage = slugList[index - 1];
	const nextPage = slugList[index + 1];
	const previousAccessibleLabel = prevPage
		? previousLabel === localeStrings.previous
			? `${localeStrings.previousPage}: ${fullyDecodeEntities(prevPage.title)}`
			: `${previousLabel}: ${fullyDecodeEntities(previousLesson?.lessonTitle ?? previousLesson?.title ?? prevPage.title)}`
		: localeStrings.previousPage;
	const nextAccessibleLabel = nextPage
		? nextLabel === localeStrings.next
			? `${localeStrings.nextPage}: ${fullyDecodeEntities(nextPage.title)}`
			: `${nextLabel}: ${fullyDecodeEntities(nextLesson?.lessonTitle ?? nextLesson?.title ?? nextPage.title)}`
		: localeStrings.nextPage;
	const hasAdjacentPage = Boolean(prevPage || nextPage);
	const bottomArrowNav =
		nativeNav && pageNavToggles.navBottomArrows === true && hasAdjacentPage && !suppressNav;
	const edgeArrowNav =
		nativeNav && pageNavToggles.navEdgeArrows === true && hasAdjacentPage && !suppressNav;
	const topBarEnabled = nativeNav && pageNavToggles.navTopBar !== false;
	const hamburgerOnlyDrawer =
		nativeNav && pageNavToggles.navHamburgerMenu === true && pageNavToggles.navOutline !== true;
	const sections: SectionGroup[] =
		overrideBodyHtml !== undefined
			? [{ palette: "light", blocks: sectionBlocks }]
			: groupBlocksIntoSections(sectionBlocks, sectionRhythm);
	const sectionCount =
		overrideBodyHtml !== undefined ||
		(sectionRhythm === "uniform" &&
			sections.length <= 1 &&
			!sections.some((section) => section.palette !== "light"))
			? 0
			: sections.length;
	const readingTimeMinutes = publishedReadingTimes([{ blocks: sectionBlocks }]).pageMinutes[0];
	const courseEstimatedMinutes = publishedReadingTimes(config.pages).courseMinutes;
	const estimatedDuration =
		config.estimatedDuration?.trim() ||
		interpolate(localeStrings.narrativeReadTime, { minutes: courseEstimatedMinutes });

	const pageDurationOverride =
		typeof page.data?.duration === "string" ? page.data.duration : undefined;
	const showPageDuration =
		pageDurationOverride === "show" ||
		(pageDurationOverride !== "hide" && pageNavToggles.navReadingTime === true);
	const displayedReadingTimeMinutes = showPageDuration ? readingTimeMinutes : 0;
	const durationInCourseOutline =
		(pageNavToggles.navOutline === true || pageNavToggles.navHamburgerMenu === true) &&
		totalPages > 1 &&
		pageRole === "content";
	const standaloneProgressDots =
		nativeNav &&
		pageRole === "content" &&
		totalPages > 1 &&
		pageNavToggles.navProgressStyle === "dots" &&
		!bottomArrowNav;
	const showNarrativeBar =
		pageRole === "content" &&
		(sectionCount > 1 || (!durationInCourseOutline && displayedReadingTimeMinutes > 0));

	// Whether the glossary link should show in the course menu
	const glossaryEnabled =
		config.glossaryTabEnabled !== false &&
		Array.isArray(config.glossaryTerms) &&
		config.glossaryTerms.length > 0;

	// Whether the resources link should show in the course menu
	const resourcesEnabled =
		config.resourcesTabEnabled !== false &&
		Array.isArray(config.resourceEntries) &&
		config.resourceEntries.length > 0;

	const configBlocks = page.blocks.map((block) => {
		const data = { ...block.data } as Record<string, unknown>;
		if (block.type === "card") {
			const transition = (data as { transition?: unknown }).transition;
			if (
				(transition === undefined || transition === null || transition === "") &&
				config.slideTransition
			) {
				(data as Record<string, unknown>).transition = config.slideTransition;
			}
		}
		return sanitizeBlockForJson({ ...block, data });
	});
	// Inert configuration for the selected islands and host adapters.
	const configJson = JSON.stringify({
		...publishedChoiceFacts,
		deckPages: opts.deckPages,
		deckDesign: opts.deckPages ? resolveDeckDesign(config.deckDesign) : undefined,
		courseId: config.id,
		courseTitle: fullyDecodeEntities(config.title),
		pageTitle: decodedPageTitle,
		pageId: page.id,
		lessonId: page.lessonId ?? page.id,
		currentPage,
		totalPages,
		currentSlug,
		pages: pagesList,
		pageIdMap,
		navigationStyle: config.navigationStyle ?? "sidebar",
		strings: {
			...localeStrings,
			// The assessment island reads its own catalogue; keep page-runtime bytes stable.
			assessmentStorageNotice: undefined,
			// Preserve the existing serialized catalogue for courses without a pass mark.
			courseScoreWithPassMark:
				config.passingScore === undefined ? undefined : localeStrings.courseScoreWithPassMark,
		},
		colorShades: colorShades ?? null,
		defaultImageTreatment: config.defaultImageTreatment ?? "none",
		imageEffects: config.imageEffects ?? null,
		imageEffectsAuto: config.imageEffectsAuto ?? false,
		slideTransition: config.slideTransition ?? "none",
		imageHoverEffect: config.imageHoverEffect ?? "none",
		basePath: basePath ?? "",
		lessonTitle: decodedLessonTitle ?? "",
		lessonKicker: decodedLessonKicker,
		isFirstPageOfLesson: page.isFirstPageOfLesson ?? false,
		showCourseNameInNav: config.showCourseNameInNav ?? true,
		showLessonNameInNav: config.showLessonNameInNav ?? true,
		showLessonNameAsTitle: config.showLessonNameAsTitle ?? true,
		...pageNavToggles,
		estimatedDuration,
		sourceLocale: config.sourceLocale,
		glossaryEnabled,
		resourcesEnabled,
		narrationEnabled: page.narrationEnabled,
		narrationDefaults: page.narrationDefaults,
		narrationPlaylist: islandsNeeded.has("narration")
			? narrationPlaylistFromConfig({
					...(Array.isArray(page.data?._narrationSegments)
						? {
								grammarVersion: 4 as const,
								narrationSegments: page.data
									._narrationSegments as import("@praxity/shared-blocks/narration").NarrationSegment[],
							}
						: {}),
					pageTitle: decodedPageTitle,
					sourceLocale: config.sourceLocale,
					narrationEnabled: page.narrationEnabled,
					narrationDefaults: page.narrationDefaults,
					pages: [{ data: page.data, narrationEnabled: page.narrationEnabled }],
					blocks: configBlocks,
				})
			: undefined,
		slideStyles: config.slideStyles,
		blocks: configBlocks,
		logic: {
			rules: logicBlocks,
			variables,
			visibility,
		},
		pageRole,
		sectionCount,
		readingTimeMinutes,
		pageFocusDefault,
		sectionRhythm,
		dividerStyle: "none",
		texture: "none",
		sectionPalettes: config.sectionPalettes,
	});
	const blockStatePolicy = compileBlockStatePolicy(
		config.pages.flatMap((coursePage) => coursePage.blocks),
	);
	const hasPrivatePolicy = Object.keys(blockStatePolicy).length > 0;
	const hostConfigJson = JSON.stringify({
		version: 1,
		...publishedChoiceFacts,
		...(opts.deckPages ? { deck: true } : {}),
		courseId,
		pageId: page.id,
		pageTitle: decodedPageTitle,
		lessonId: page.lessonId ?? null,
		pageRole,
		currentPage,
		totalPages,
		currentSlug,
		availableSlugs: slugList.map((entry) => entry.slug),
		pageIdMap,
		statefulBlockIds: runtimeBlocks.filter(isStatefulBlock).map((block) => block.id),
		...(hasPrivatePolicy ? { blockStatePolicy } : {}),
		completionMethod,
		completionThreshold: config.completionThreshold,
		requiredAssessmentIds: config.requireKnowledgeChecks
			? collectRequiredAssessmentIds(config.pages)
			: undefined,
		...(config.passingScore === undefined
			? {}
			: {
					passMark: passMarkPercent(config.passingScore),
					scoredAssessmentIds: collectRequiredAssessmentIds(config.pages, "passingScore"),
				}),
		completionQuizId: config.completionQuizId,
		strings: {
			// Pages knows its resume position at export; Guided resolves gated slides at runtime.
			scormResumePositionPrefix: interpolate(localeStrings.scormResumePositionPrefix, {
				current: currentPage,
				total: totalPages,
			}),
			scormResumeAnnouncement: interpolate(localeStrings.scormResumeAnnouncement, {
				current: currentPage,
				total: totalPages,
				title: decodedPageTitle,
			}),
		},
	});
	const shouldEmitHtmlOnlyNoJs = runtimeMode === "static";
	const sidebarPreferenceKey =
		nativeNav && topBarEnabled && effectiveLayoutArchetype === "sidebar" && !hamburgerOnlyDrawer
			? `praxity-sidebar-${fullyDecodeEntities(config.title)}`
			: undefined;
	const shellConfigJson = JSON.stringify({
		version: 1,
		kind: "page",
		colorMode: config.colorMode ?? "light",
		pageFocusDefault,
		enableJsNav: !suppressNav && nativeNav,
		entrance: shouldEmitHtmlOnlyNoJs ? "none" : (config.motionEntrance ?? "none"),
		stagger: shouldEmitHtmlOnlyNoJs ? "none" : (config.motionStagger ?? "none"),
		keyboardArrows: pageRole === "content" && pageNavToggles.navKeyboardArrows !== false,
		previousHref:
			shouldEmitHtmlOnlyNoJs && index > 0 ? `${slugList[index - 1]?.slug}.html` : undefined,
		nextHref:
			shouldEmitHtmlOnlyNoJs && index < slugList.length - 1
				? `${slugList[index + 1]?.slug}.html`
				: undefined,
		currentPage,
		slugs: slugList.map((entry) => entry.slug),
		sidebarPreferenceKey,
		resumeFilename,
	});

	// --- Assemble the HTML ---
	const lines: string[] = [];

	// DOCTYPE + html
	const imageHoverEffect = config.imageHoverEffect ?? "none";
	const highlightStyle = resolveHighlightStyle(config.theme?.highlightStyle);
	const initialMode = config.colorMode === "dark" ? "dark" : "light";
	const htmlIslandAttrs: string[] = [];
	if (opts.islandAssets) {
		for (const island of islandsNeeded) {
			const file = opts.islandAssets.islandFilenames[island];
			if (file) {
				htmlIslandAttrs.push(`data-island-${camelToKebab(island)}="${escapeHtml(file)}"`);
			}
		}
	}
	lines.push("<!doctype html>");
	const staticHtmlClassAttr = shouldEmitHtmlOnlyNoJs ? ' class="praxity-js-loaded"' : "";
	lines.push(
		`<html lang="${lang}" dir="${dir}"${staticHtmlClassAttr} data-praxity-root data-praxity-mode="${initialMode}" data-praxity-image-hover="${escapeHtml(imageHoverEffect)}" data-praxity-highlight-style="${escapeHtml(highlightStyle)}"${islandsNeeded.size ? ` data-praxity-islands="${escapeHtml([...islandsNeeded].join(","))}"` : ""}${htmlIslandAttrs.length ? ` ${htmlIslandAttrs.join(" ")}` : ""}>`,
	);
	lines.push("<head>");
	lines.push(`<meta charset="utf-8" />`);
	lines.push(`<meta name="viewport" content="width=device-width, initial-scale=1" />`);
	lines.push(`<title>${escapeHtml(decodedPageTitle)}</title>`);
	lines.push(
		`<meta name="description" content="${escapeHtml(config.description?.trim() || `${decodedPageTitle} — ${config.title}`)}" />`,
	);
	lines.push(
		`<script id="${HOST_CONFIG_ID}" type="application/json">${escapeJsonForScript(hostConfigJson)}</script>`,
	);

	// Resource preload hints — keep the critical fonts out of the stylesheet dependency chain.
	for (const fontFile of config.fontPreloads ?? []) {
		lines.push(
			`<link rel="preload" href="fonts/${escapeHtml(fontFile)}" as="font" type="font/woff2" crossorigin />`,
		);
	}
	if (!shouldEmitHtmlOnlyNoJs) {
		if (opts.islandAssets && islandsNeeded.size > 0) {
			lines.push(
				`<link rel="preload" href="${escapeHtml(opts.islandAssets.loaderFilename)}" as="script" />`,
			);
		}
	}
	lines.push(`<link rel="preload" href="${escapeHtml(shellFilename)}" as="script" />`);

	// Pattern rules precede shared/theme/authored CSS so author overrides stay last.
	if (islandsNeeded.has("retrievalSheet")) {
		if (!opts.retrievalSheetStylesheetFilename)
			throw Object.assign(new Error("Required retrieval-sheet stylesheet unavailable."), {
				code: "EISLANDASSET",
			});
		opts.usedStylesheets?.add(opts.retrievalSheetStylesheetFilename);
		lines.push(
			`<link rel="stylesheet" href="${escapeHtml(opts.retrievalSheetStylesheetFilename)}" />`,
		);
	}

	if (islandsNeeded.has("highlight")) {
		if (!opts.highlightStylesheetFilename)
			throw Object.assign(new Error("Required highlight stylesheet unavailable."), {
				code: "EISLANDASSET",
			});
		opts.usedStylesheets?.add(opts.highlightStylesheetFilename);
		lines.push(`<link rel="stylesheet" href="${escapeHtml(opts.highlightStylesheetFilename)}" />`);
	}
	if (islandsNeeded.has("writeDistractors")) {
		// Incremental prompt frames have no asset manifest; full publications must supply one.
		const css =
			opts.islandAssets === undefined
				? WRITE_DISTRACTORS_STYLESHEET
				: opts.islandAssets.writeDistractorsCss;
		if (!css)
			throw Object.assign(new Error("Required write-distractors stylesheet unavailable."), {
				code: "EISLANDASSET",
			});
		opts.usedStylesheets?.add(css);
		lines.push(`<link rel="stylesheet" href="${escapeHtml(css)}" />`);
	}
	// Generator and viewer styles are packaged as one request.
	const stylesheetFilename =
		deckPresentation && opts.deckStylesheets
			? needsMantine
				? opts.deckStylesheets.full
				: opts.deckStylesheets.lite
			: !needsMantine && opts.liteStylesheetFilename
				? opts.liteStylesheetFilename
				: (opts.stylesheetFilename ?? "styles.css");
	opts.usedStylesheets?.add(stylesheetFilename);
	lines.push(`<link rel="stylesheet" href="${escapeHtml(stylesheetFilename)}" />`);

	// Runtime configuration remains inert under a strict script-src policy.
	if (!shouldEmitHtmlOnlyNoJs) {
		lines.push(
			`<script id="praxity-config" type="application/json">${escapeJsonForScript(configJson)}</script>`,
		);
	}
	lines.push(
		`<script id="${SHELL_CONFIG_ID}" type="application/json">${escapeJsonForScript(shellConfigJson)}</script>`,
	);
	if (
		(islandsNeeded.has("selfCheck") ||
			islandsNeeded.has("rating") ||
			islandsNeeded.has("writeDistractors")) &&
		opts.islandAssets?.selfCheckLifetime
	)
		lines.push(
			`<script${islandsNeeded.has("rating") || islandsNeeded.has("writeDistractors") ? "" : " defer"} src="${escapeHtml(opts.islandAssets.selfCheckLifetime)}"></script>`,
		);
	if (hasPrivatePolicy && opts.islandAssets?.privacy) {
		const asset = opts.islandAssets.privacy;
		lines.push(
			`<script defer src="${escapeHtml(asset.bootstrap)}" data-privacy-support="${escapeHtml(asset.support)}"></script>`,
		);
	}
	if (
		opts.islandAssets?.privateChoice &&
		runtimeBlocks.some(
			(block) =>
				block.type === "assessment" &&
				block.data.assessmentType === "choice" &&
				compileBlockStatePolicy([block])[block.id] === "device",
		)
	)
		lines.push(`<script defer src="${escapeHtml(opts.islandAssets.privateChoice)}"></script>`);
	lines.push(`<script src="${escapeHtml(shellFilename)}"></script>`);
	// Install the shell's error listener before a deferred host download can fail.
	// Gecko can report a fetch failure before a later parser-blocking shell runs.
	lines.push(DEPLOYMENT_HEAD_MARKER);

	lines.push("</head>");
	// The author's archetype decides the layout — the same mapping the viewer uses.
	// This used to reverse-infer a layout from individual toggles, which could not
	// express `minimal` or `embedded` and silently downgraded a course to `sidebar`
	// whenever a toggle was adjusted.
	lines.push(
		`<body class="${navArchetypeToLayoutClass(deckPresentation ? "slides" : effectiveLayoutArchetype)}">`,
	);

	// Course meta div
	lines.push(
		`<div id="praxity-course-meta" hidden data-total-pages="${totalPages}" data-current-page="${currentPage}" data-course-id="${escapeHtml(courseId)}"></div>`,
	);

	// Semantic landmarks + static navigation fallback for no-JS mode.
	lines.push(
		`<a href="#main-content" class="praxity-skip-link">${escapeHtml(localeStrings.skipToContent)}</a>`,
	);
	lines.push(
		`<div id="praxity-live-region" lang="${lang}" aria-live="polite" aria-atomic="true" class="praxity-sr-only"></div>`,
	);
	const outlineEnabled = nativeNav
		? pageNavToggles.navOutline !== false || pageNavToggles.navHamburgerMenu === true
		: !nativeSlides;
	const prevNextEnabled = nativeNav ? pageNavToggles.navPrevNext !== false : !nativeSlides;
	const requestedReadingToolsPlacement = opts.deckPages
		? "none"
		: pageNavToggles.navReadingSupportPlacement === "none"
			? hasNarration
				? "bottomBar"
				: "none"
			: pageNavToggles.showA11yPill !== false || hasNarration
				? (pageNavToggles.navReadingSupportPlacement ?? "topBar")
				: "none";
	const readingToolsPlacement =
		(requestedReadingToolsPlacement === "topBar" && !topBarEnabled) ||
		(requestedReadingToolsPlacement === "sidebar" && !outlineEnabled)
			? "bottomBar"
			: requestedReadingToolsPlacement;
	const readingTools =
		requestedReadingToolsPlacement === "none"
			? ""
			: `<div id="praxity-a11y-preferences">${pageNavToggles.showA11yPill !== false ? nativeA11yControls(localeStrings, nativeNav) : ""}${hasNarration ? '<div data-island="narration"></div>' : ""}</div>`;
	const showCourseTitle = pageNavToggles.navCourseTitle ?? config.showCourseNameInNav !== false;
	const showLessonTitle = pageNavToggles.navLessonTitles ?? config.showLessonNameInNav !== false;
	const lessonCount = pagesList.filter((entry) => entry.isFirstPageOfLesson).length || 1;
	const logo = config.brandLogo;
	const logoPlacement = logo?.placement === "sidebar" ? "sidebar" : "header";
	const logoHtml =
		logo && logo.placement !== "hidden" && showCourseTitle
			? `<img class="praxity-brand-logo${logo.darkLocalPath ? " praxity-brand-logo--light" : ""}" src="${escapeHtml(logo.localPath)}" alt="" width="40" height="40">` +
				(logo.darkLocalPath
					? `<img class="praxity-brand-logo praxity-brand-logo--dark" src="${escapeHtml(logo.darkLocalPath)}" alt="" width="40" height="40">`
					: "")
			: "";
	const sidebarTitle =
		logoHtml && logoPlacement === "sidebar"
			? fullyDecodeEntities(config.title)
			: moduleNavigation
				? showCourseTitle
					? fullyDecodeEntities(config.title)
					: ""
				: nativeSlides
					? fullyDecodeEntities(config.title)
					: showLessonTitle && decodedLessonTitle?.trim()
						? decodedLessonTitle.trim()
						: showCourseTitle
							? fullyDecodeEntities(config.title)
							: "";
	const sidebarMeta = [
		totalPages > 1 ? interpolate(localeStrings.pageCount, { count: totalPages }) : "",
		estimatedDuration,
	]
		.filter(Boolean)
		.join(" · ");
	const toolbarContext = pagesPresentation
		? showCourseTitle
			? fullyDecodeEntities(config.title)
			: ""
		: pageNavToggles.navBreadcrumbs &&
				showCourseTitle &&
				showLessonTitle &&
				decodedLessonTitle &&
				lessonCount > 1
			? `${fullyDecodeEntities(config.title)} › ${decodedLessonTitle}`
			: showCourseTitle
				? fullyDecodeEntities(config.title)
				: showLessonTitle
					? (decodedLessonTitle ?? "")
					: "";
	const hasSeparateTopBar = topBarEnabled;
	const slideCounterMarkup =
		nativeSlides && pageNavToggles.navSlideCounter && pageRole === "content"
			? `<div class="praxity-slide-counter">${moduleNavigation ? escapeHtml(localPosition) : compactPositionMarkup}</div>`
			: "";
	lines.push(
		`<div class="praxity-layout-wrapper${nativeSlides || deckPresentation ? " praxity-layout-slides" : ""}"${hasSeparateTopBar ? ' data-has-top-bar="true"' : ""}>`,
	);
	// The `none` archetype means no navigation chrome. The no-JS fallback IS the
	// navigation on static pages, so suppress it here too — otherwise a "no
	// navigation" course still shipped a full page list on every text-only page
	// while its islands showed nothing.
	if (!suppressNav && outlineEnabled) {
		lines.push(
			`<nav${nativeNav ? ' id="course-nav-sidebar"' : ""} class="praxity-outline-fallback${nativeNav ? " praxity-course-menu praxity-native-outline" : ""}"${nativeNav ? ` data-island="nav" data-native-outline${hamburgerOnlyDrawer ? " data-nav-drawer" : ""}` : ""} aria-label="${escapeHtml(nativeNav ? localeStrings.courseNavigation : localeStrings.courseOutline)}">`,
		);
		if (nativeNav) {
			lines.push('<div class="praxity-native-sidebar-header">');
			if (topBarEnabled && effectiveLayoutArchetype === "sidebar" && !hamburgerOnlyDrawer) {
				lines.push(
					`<button type="button" class="praxity-sidebar-collapse" data-sidebar-collapse data-praxity-js-control aria-expanded="true" aria-controls="course-nav-sidebar" aria-label="${escapeHtml(localeStrings.collapseSidebar)}" title="${escapeHtml(localeStrings.collapseSidebar)} ( [ )">${nativeSidebarChevron("left")}</button>`,
				);
			}
			lines.push(
				`<button type="button" class="praxity-native-menu-close" data-nav-menu-close data-praxity-js-control aria-label="${escapeHtml(localeStrings.closeCourseOutline)}">×</button>`,
			);
			if (decodedLessonKicker && !moduleNavigation) {
				lines.push(
					`<p class="praxity-native-sidebar-kicker">${escapeHtml(decodedLessonKicker)}</p>`,
				);
			}
			if (sidebarTitle) {
				if (logoHtml && logoPlacement === "sidebar") {
					lines.push(`<div class="praxity-brand-title">${logoHtml}`);
				}
				lines.push(
					`<h2 class="praxity-sidebar-title" title="${escapeHtml(sidebarTitle)}">${escapeHtml(sidebarTitle)}</h2>`,
				);
				if (logoHtml && logoPlacement === "sidebar") lines.push("</div>");
			}
			if (sidebarMeta) {
				lines.push(`<p class="praxity-native-sidebar-meta">${escapeHtml(sidebarMeta)}</p>`);
			}
			lines.push("</div>");
			lines.push(`<div role="group" aria-label="${escapeHtml(localeStrings.coursePages)}">`);
		}
		lines.push('<ol role="list">');
		if (moduleNavigation) {
			for (const lesson of lessons) {
				const current = lesson.lessonId === page.lessonId;
				const lessonPages = pagesList.filter((entry) => entry.lessonId === lesson.lessonId);
				lines.push(
					`<li class="praxity-native-module"><a href="${escapeHtml(lesson.slug)}.html" data-page-slug="${escapeHtml(lesson.slug)}" data-page-number="${lesson.index}" data-module-pages="${escapeHtml(JSON.stringify(lessonPages.map((entry) => entry.id)))}"${current ? ' aria-current="true"' : ""}><span class="praxity-outline-label">${escapeHtml(lesson.lessonTitle ?? lesson.title)}</span>${outlineStatus()}<span class="praxity-sr-only praxity-nav-visited-label" hidden>, ${escapeHtml(localeStrings.visitedModule)}</span></a>`,
				);
				if (current) {
					lines.push('<ol role="list">');
					for (const entry of lessonPages) {
						lines.push(
							`<li><a href="${escapeHtml(entry.slug)}.html" data-page-id="${escapeHtml(entry.id)}" data-page-slug="${escapeHtml(entry.slug)}" data-page-number="${entry.index}" data-page-index="${entry.index - 1}"${entry.slug === currentSlug ? ' aria-current="page"' : ""}><span class="praxity-outline-label">${escapeHtml(entry.title)}</span>${outlineStatus()}<span class="praxity-sr-only praxity-nav-visited-label" hidden>, ${escapeHtml(localeStrings.visitedPage)}</span></a></li>`,
						);
					}
					lines.push("</ol>");
				}
				lines.push("</li>");
			}
		}
		for (const [entryIndex, entry] of slugList.entries()) {
			if (moduleNavigation) break;
			if (nativeNav && (entry.slug === "glossary" || entry.slug === "resources")) continue;
			const href = `${escapeHtml(entry.slug)}.html`;
			const isCurrent = entry.slug === currentSlug;
			const pageInfo = pagesList[entryIndex];
			if (
				nativeNav &&
				pageInfo?.isFirstPageOfLesson &&
				showLessonTitle &&
				pageInfo.lessonTitle &&
				!(
					showCourseTitle &&
					pageInfo.lessonTitle.trim().toLowerCase() === config.title.trim().toLowerCase()
				)
			) {
				lines.push(
					`<li class="praxity-native-lesson-title">${escapeHtml(pageInfo.lessonTitle)}</li>`,
				);
			}
			lines.push(
				`<li><a href="${href}"${nativeNav ? ` data-page-id="${escapeHtml(entry.pageId)}" data-page-slug="${escapeHtml(entry.slug)}" data-page-number="${entryIndex + 1}" data-page-index="${entryIndex}"` : ""}${isCurrent ? ' aria-current="page"' : ""}><span class="praxity-outline-label">${escapeHtml(fullyDecodeEntities(entry.title))}</span>${nativeNav ? outlineStatus() : ""}${nativeNav ? `<span class="praxity-sr-only praxity-nav-visited-label" hidden>, ${escapeHtml(localeStrings.visitedPage)}</span>` : ""}</a></li>`,
			);
		}
		lines.push("</ol>");
		if (nativeNav) {
			lines.push("</div>");
			if (glossaryEnabled || resourcesEnabled) {
				lines.push('<hr class="praxity-native-reference-divider" />');
				lines.push(
					`<div class="praxity-native-reference" role="group" aria-label="${escapeHtml(localeStrings.courseReference)}">`,
				);
				if (glossaryEnabled) {
					lines.push(
						`<a href="glossary.html" target="_blank" rel="noopener" data-nav-utility>${escapeHtml(localeStrings.glossaryHeading)} ${externalLinkIndicatorHtml(localeStrings.opensInNewTab)}</a>`,
					);
				}
				if (resourcesEnabled) {
					lines.push(
						`<a href="resources.html" data-page-slug="resources" data-nav-utility${currentSlug === "resources" ? ' aria-current="page"' : ""}>${escapeHtml(localeStrings.resourcesHeading)}</a>`,
					);
				}
				lines.push("</div>");
			}
			if (readingToolsPlacement === "sidebar") {
				lines.push(`<div class="praxity-sidebar-tools">${readingTools}</div>`);
			}
		}
		if (!nativeNav && glossaryEnabled) {
			lines.push(
				`<a href="glossary.html" target="_blank" rel="noopener" data-nav-utility>${escapeHtml(localeStrings.glossaryHeading)} ${externalLinkIndicatorHtml(localeStrings.opensInNewTab)}</a>`,
			);
		}
		lines.push("</nav>");
		if (nativeNav) {
			lines.push(
				`<button type="button" class="praxity-native-nav-backdrop" data-nav-backdrop data-praxity-js-control aria-label="${escapeHtml(localeStrings.closeCourseOutline)}" tabindex="-1"></button>`,
			);
		}
	}
	if (hasSeparateTopBar) {
		lines.push('<div class="praxity-top-bar-fallback" data-island="nav">');
		lines.push('<header class="praxity-top-bar">');
		if (outlineEnabled) {
			lines.push(
				`<button type="button" class="praxity-menu-toggle praxity-native-menu-toggle" data-nav-menu-toggle data-praxity-js-control aria-expanded="false" aria-controls="course-nav-sidebar" aria-label="${escapeHtml(localeStrings.openCourseMenu)}"><span aria-hidden="true">☰</span></button>`,
			);
			if (effectiveLayoutArchetype === "sidebar" && !hamburgerOnlyDrawer) {
				lines.push(
					`<button type="button" class="praxity-sidebar-expand" data-sidebar-expand data-praxity-js-control aria-expanded="true" aria-controls="course-nav-sidebar" aria-label="${escapeHtml(localeStrings.expandSidebar)}" title="${escapeHtml(localeStrings.expandSidebar)} ( [ )">${nativeSidebarChevron("right")}</button>`,
				);
			}
		}
		if (toolbarContext) {
			lines.push(
				logoHtml && logoPlacement === "header"
					? `<span class="praxity-toolbar-context praxity-brand-title" title="${escapeHtml(toolbarContext)}">${logoHtml}<span class="praxity-brand-title-text">${escapeHtml(toolbarContext)}</span></span>`
					: `<span class="praxity-toolbar-context" title="${escapeHtml(toolbarContext)}">${escapeHtml(toolbarContext)}</span>`,
			);
		}
		if (
			!opts.deckPages &&
			(totalPages > 1 || page.lessonTitleIsFallback) &&
			pageRole === "content"
		) {
			const readingTime =
				pageNavToggles.navReadingTime && readingTimeMinutes > 0
					? interpolate(localeStrings.narrativeReadTime, { minutes: readingTimeMinutes })
					: "";
			const headerContext = pagesPresentation ? (decodedLessonTitle ?? "") : pagePosition;
			const headerLabel = [headerContext, readingTime].filter(Boolean).join(" · ");
			if (headerLabel) {
				lines.push(
					`<span class="praxity-page-count-text praxity-toolbar-position" title="${escapeHtml(headerContext)}"${page.lessonTitleIsFallback ? " data-lesson-title-fallback" : ""}>${escapeHtml(headerLabel)}</span>`,
				);
			}
		}
		if (readingToolsPlacement === "topBar") {
			lines.push(`<div class="praxity-toolbar-tools">${readingTools}</div>`);
		}
		if (slideCounterMarkup) lines.push(slideCounterMarkup);
		lines.push("</header>");
		lines.push("</div>");
	}
	if (nativeNav && outlineEnabled && !hasSeparateTopBar) {
		if (nativeSlides) {
			lines.push(
				`<button type="button" class="praxity-hamburger praxity-native-menu-toggle" data-island="nav" data-nav-menu-toggle data-praxity-js-control aria-expanded="false" aria-controls="course-nav-sidebar" aria-label="${escapeHtml(localeStrings.courseOutline)}"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>`,
			);
		} else {
			lines.push('<div class="praxity-top-bar-fallback praxity-mobile-top-bar" data-island="nav">');
			lines.push('<header class="praxity-top-bar">');
			lines.push(
				`<button type="button" class="praxity-menu-toggle praxity-native-menu-toggle" data-nav-menu-toggle data-praxity-js-control aria-expanded="false" aria-controls="course-nav-sidebar" aria-label="${escapeHtml(localeStrings.openCourseMenu)}"><span aria-hidden="true">☰</span></button>`,
			);
			lines.push("</header>");
			lines.push("</div>");
		}
	}

	// Root content is complete server-rendered semantic HTML.
	const pageTexture = "";
	const slideStyle = nativeSlides ? resolvePageSlideStyle(page, config.slideStyles) : undefined;
	const slideStyleName = slideStyle?.name;
	const slideStyleAttr = slideStyleName ? ` data-slide-style="${escapeHtml(slideStyleName)}"` : "";
	const slideVariables = slideStyle
		? Object.entries(slideStyle.variables)
				.map(([key, value]) => `${key}:${sanitizeCssValue(value)}`)
				.join(";")
		: "";
	const slideVariablesAttr = nativeSlides ? ` style="${escapeHtml(slideVariables)}"` : "";
	const texturedMainSlideAttrs = slideStyleName ? slideStyleAttr + slideVariablesAttr : "";
	if (!deckPresentation)
		lines.push(
			`<main id="main-content" class="praxity-page-content"${pageTexture}${texturedMainSlideAttrs} tabindex="-1">`,
		);
	if (deckPresentation && overrideBodyHtml !== undefined) {
		lines.push(overrideBodyHtml);
	} else if (overrideBodyHtml !== undefined) {
		const frame = nativeSlides ? slideFrame(config, page) : undefined;
		if (frame) lines.push(frame.open);
		lines.push(
			`<h1 class="praxity-page-title">${escapeHtml(fullyDecodeEntities(opts.deckPages ? (page.lessonTitle ?? config.title) : page.title))}</h1>`,
		);
		if (pageRole === "glossary") {
			lines.push(
				`<a class="praxity-glossary-link" ${config.courseHomeUrl ? COURSE_HOME_LINK_SLOT : `href="${DEFAULT_COURSE_HOME_URL}"`}>${escapeHtml(localeStrings.backToTheCourse)}</a>`,
			);
		}
		lines.push(overrideBodyHtml);
		if (frame) lines.push(frame.close);
	} else {
		lines.push(opts.pageContentHtml ?? renderPageContent(config, sourcePage, islandsNeeded));
	}
	if (pagesPresentation && pageRole === "content" && currentPage === totalPages) {
		const firstPage = slugList[0];
		lines.push(
			`<section class="praxity-pages-completion" aria-labelledby="praxity-completion-heading"><h2 id="praxity-completion-heading">${escapeHtml(localeStrings.courseComplete)}</h2><p data-course-time>${escapeHtml(localeStrings.courseTimeUnavailable)}</p><p data-course-score hidden></p>${config.passingScore === undefined ? "" : COURSE_COMPLETION_OUTCOME}<div class="praxity-pages-completion-actions">${firstPage ? `<a href="${escapeHtml(firstPage.slug)}.html">${escapeHtml(localeStrings.reviewCourse)}</a>` : ""}<a ${config.courseHomeUrl ? COURSE_HOME_LINK_SLOT : `href="${DEFAULT_COURSE_HOME_URL}"`}>${escapeHtml(localeStrings.backToCourse)}</a></div></section>`,
		);
	}

	const regularPageNav = hasAdjacentPage && !suppressNav && prevNextEnabled;
	const pageNavRendered = regularPageNav || bottomArrowNav;
	const needsNavigationProxy =
		nativeNav &&
		hasAdjacentPage &&
		!pageNavRendered &&
		!edgeArrowNav &&
		(pageNavToggles.navKeyboardArrows === true || pageNavToggles.navSwipeGestures === true);
	if (!suppressNav && (pageNavRendered || edgeArrowNav || needsNavigationProxy)) {
		const pageNavTarget =
			regularPageNav && !nativeNav ? "praxity-page-nav-fallback" : "praxity-page-nav";
		lines.push(
			`<a href="#${pageNavTarget}" class="praxity-skip-link praxity-page-nav-skip">${escapeHtml(localeStrings.skipToPageNavigation)}</a>`,
		);
	}
	if (!opts.deckPages && totalPages > 1 && pageRole === "content") {
		lines.push(
			`<a href="#praxity-embed-nav" class="praxity-skip-link praxity-embed-nav-skip">${escapeHtml(localeStrings.skipToPageNavigation)}</a>`,
		);
	}
	if (!deckPresentation) lines.push("</main>");
	if (slideCounterMarkup && !hasSeparateTopBar) {
		lines.push(`<div role="banner">${slideCounterMarkup}</div>`);
	}

	let bottomReadingToolsRendered = false;
	if (bottomArrowNav) {
		if (nativeSlides) {
			lines.push(
				`<div class="praxity-nav-band" role="region" aria-label="${escapeHtml(localeStrings.courseControls)}">`,
			);
		}
		lines.push(
			`<nav${regularPageNav ? "" : ' id="praxity-page-nav"'} class="praxity-slide-nav" data-island="nav" aria-label="${escapeHtml(localeStrings.pageNavigation)}" tabindex="-1">`,
		);
		lines.push(
			prevPage
				? `<a class="praxity-slide-nav__arrow praxity-slide-nav__arrow--prev" href="${escapeHtml(prevPage.slug)}.html" aria-label="${escapeHtml(previousAccessibleLabel)}" data-page-direction="previous" data-page-id="${escapeHtml(prevPage.pageId)}" data-page-slug="${escapeHtml(prevPage.slug)}" data-page-number="${currentPage - 1}" data-page-index="${currentPage - 2}"><span aria-hidden="true">&#8249;</span></a>`
				: moduleNavigation
					? ""
					: `<button type="button" class="praxity-slide-nav__arrow praxity-slide-nav__arrow--prev" data-page-direction="previous" aria-label="${escapeHtml(localeStrings.previousPage)}" disabled><span aria-hidden="true">&#8249;</span></button>`,
		);
		if (pageRole === "content" && pageNavToggles.navProgressStyle === "dots") {
			lines.push(
				nativeProgressMarkup(
					"dots",
					progressCurrent,
					progressTotal,
					localeStrings.courseProgress,
					progressPageIds,
				),
			);
		}
		lines.push(
			nextPage
				? `<a class="praxity-slide-nav__arrow praxity-slide-nav__arrow--next" href="${escapeHtml(nextPage.slug)}.html" aria-label="${escapeHtml(nextAccessibleLabel)}" data-page-direction="next" data-continue-button data-page-id="${escapeHtml(nextPage.pageId)}" data-page-slug="${escapeHtml(nextPage.slug)}" data-page-number="${currentPage + 1}" data-page-index="${currentPage}"><span aria-hidden="true">&#8250;</span></a>`
				: moduleNavigation
					? ""
					: `<button type="button" class="praxity-slide-nav__arrow praxity-slide-nav__arrow--next" data-page-direction="next" aria-label="${escapeHtml(localeStrings.nextPage)}" disabled><span aria-hidden="true">&#8250;</span></button>`,
		);
		if (readingToolsPlacement === "bottomBar") {
			lines.push(`<div class="praxity-slide-nav__tools">${readingTools}</div>`);
			bottomReadingToolsRendered = true;
		}
		lines.push("</nav>");
		if (nativeSlides) lines.push("</div>");
	}
	if (regularPageNav) {
		const nativePageNav = nativeNav;
		lines.push(
			`<nav id="${nativePageNav ? "praxity-page-nav" : "praxity-page-nav-fallback"}" class="praxity-page-nav-fallback${nativePageNav ? " praxity-page-nav praxity-native-page-nav" : ""}${pagesPresentation ? " praxity-pages-pagination" : ""}"${nativePageNav ? ' data-island="nav"' : ""} aria-label="${escapeHtml(localeStrings.pageNavigation)}" tabindex="-1">`,
		);
		if (nativePageNav) lines.push('<div class="praxity-native-page-nav-inner">');
		if (pagesPresentation) {
			lines.push(`<p class="praxity-pages-position">${escapeHtml(localPosition)}</p>`);
		}
		lines.push(
			prevPage
				? `<a class="praxity-nav-prev" href="${escapeHtml(prevPage.slug)}.html" aria-label="${escapeHtml(previousAccessibleLabel)}" data-page-direction="previous"${nativePageNav ? ` data-page-id="${escapeHtml(prevPage.pageId)}" data-page-slug="${escapeHtml(prevPage.slug)}" data-page-number="${currentPage - 1}" data-page-index="${currentPage - 2}"` : ""}>${previousLabelMarkup}${pagesPresentation ? `<span class="praxity-pagination-title">${escapeHtml(fullyDecodeEntities(prevPage.title))}</span>` : ""}</a>`
				: pagesPresentation
					? ""
					: nativePageNav
						? moduleNavigation
							? ""
							: `<button type="button" class="praxity-nav-prev" aria-label="${escapeHtml(localeStrings.previousPage)}" disabled>${escapeHtml(localeStrings.previous)}</button>`
						: '<span class="praxity-nav-prev" aria-hidden="true"></span>',
		);
		if (!pagesPresentation && nativePageNav) {
			const showProgress = pageRole === "content" && currentPage <= totalPages;
			lines.push('<span class="praxity-native-page-position">');
			if (showProgress && pageNavToggles.navSlideCounter) {
				lines.push(pageCountMarkup);
			}
			if (showProgress) {
				lines.push(
					nativeProgressMarkup(
						pageNavToggles.navProgressStyle,
						progressCurrent,
						progressTotal,
						localPosition,
					),
				);
			}
			lines.push("</span>");
		} else if (!pagesPresentation) {
			lines.push(
				pageNavToggles.navSlideCounter && pageRole !== "glossary" && currentPage <= totalPages
					? pageCountMarkup
					: '<span class="praxity-nav-progress" aria-hidden="true"></span>',
			);
		}
		lines.push(
			nextPage
				? `<a class="praxity-nav-next" href="${escapeHtml(nextPage.slug)}.html" aria-label="${escapeHtml(nextAccessibleLabel)}" data-page-direction="next"${nativePageNav ? ` data-continue-button data-page-id="${escapeHtml(nextPage.pageId)}" data-page-slug="${escapeHtml(nextPage.slug)}" data-page-number="${currentPage + 1}" data-page-index="${currentPage}"` : ""}>${nextLabelMarkup}${pagesPresentation ? `<span class="praxity-pagination-title">${escapeHtml(fullyDecodeEntities(nextPage.title))}</span>` : ""}</a>`
				: nativePageNav
					? moduleNavigation || pagesPresentation
						? ""
						: `<button type="button" class="praxity-nav-next" aria-label="${escapeHtml(localeStrings.nextPage)}" disabled>${escapeHtml(localeStrings.next)}</button>`
					: '<span class="praxity-nav-next" aria-hidden="true"></span>',
		);
		if (nativePageNav && readingToolsPlacement === "bottomBar") {
			lines.push(`<div class="praxity-page-nav-tools">${readingTools}</div>`);
			bottomReadingToolsRendered = true;
		}
		if (nativePageNav) lines.push("</div>");
		lines.push("</nav>");
	}
	if (edgeArrowNav) {
		const decorative = pageNavRendered;
		lines.push(
			`<nav${decorative ? "" : ' id="praxity-page-nav"'} class="praxity-edge-arrow-nav"${decorative ? ' aria-hidden="true"' : ` aria-label="${escapeHtml(localeStrings.pageNavigation)}"`} tabindex="-1">`,
		);
		if (prevPage) {
			lines.push(
				`<a class="praxity-edge-arrow praxity-edge-arrow--prev" href="${escapeHtml(prevPage.slug)}.html"${decorative ? ' tabindex="-1"' : ` aria-label="${escapeHtml(previousAccessibleLabel)}"`} data-page-direction="previous" data-page-id="${escapeHtml(prevPage.pageId)}" data-page-slug="${escapeHtml(prevPage.slug)}" data-page-number="${currentPage - 1}" data-page-index="${currentPage - 2}"><span aria-hidden="true">&#8249;</span></a>`,
			);
		}
		if (nextPage) {
			lines.push(
				`<a class="praxity-edge-arrow praxity-edge-arrow--next" href="${escapeHtml(nextPage.slug)}.html"${decorative ? ' tabindex="-1"' : ` aria-label="${escapeHtml(nextAccessibleLabel)}"`} data-page-direction="next" data-continue-button data-page-id="${escapeHtml(nextPage.pageId)}" data-page-slug="${escapeHtml(nextPage.slug)}" data-page-number="${currentPage + 1}" data-page-index="${currentPage}"><span aria-hidden="true">&#8250;</span></a>`,
			);
		}
		lines.push("</nav>");
	}
	if (standaloneProgressDots) {
		const progress = nativeProgressMarkup(
			"dots",
			progressCurrent,
			progressTotal,
			localeStrings.courseProgress,
			progressPageIds,
			pageNavToggles.navSlideCounter === true && !nativeSlides,
			false,
		);
		if (nativeSlides || nativeMinimal) {
			lines.push(
				`<div class="praxity-nav-band" role="region" aria-label="${escapeHtml(localeStrings.courseControls)}">${progress}${readingToolsPlacement === "bottomBar" ? `<div class="praxity-a11y-dock">${readingTools}</div>` : ""}</div>`,
			);
			bottomReadingToolsRendered = readingToolsPlacement === "bottomBar";
		} else lines.push(progress);
	}
	if (needsNavigationProxy) {
		lines.push(
			`<nav id="praxity-page-nav" class="praxity-page-nav-fallback praxity-navigation-proxy" data-island="nav" aria-label="${escapeHtml(localeStrings.pageNavigation)}" tabindex="-1"${suppressNav ? " hidden" : ""}>`,
		);
		lines.push(
			prevPage
				? `<a class="praxity-nav-prev" href="${escapeHtml(prevPage.slug)}.html" aria-label="${escapeHtml(previousAccessibleLabel)}" data-page-direction="previous" data-page-id="${escapeHtml(prevPage.pageId)}" data-page-slug="${escapeHtml(prevPage.slug)}" data-page-number="${currentPage - 1}" data-page-index="${currentPage - 2}">${previousLabelMarkup}</a>`
				: '<span class="praxity-nav-prev" aria-hidden="true"></span>',
		);
		lines.push(pageCountMarkup);
		lines.push(
			nextPage
				? `<a class="praxity-nav-next" href="${escapeHtml(nextPage.slug)}.html" aria-label="${escapeHtml(nextAccessibleLabel)}" data-page-direction="next" data-continue-button data-page-id="${escapeHtml(nextPage.pageId)}" data-page-slug="${escapeHtml(nextPage.slug)}" data-page-number="${currentPage + 1}" data-page-index="${currentPage}">${nextLabelMarkup}</a>`
				: '<span class="praxity-nav-next" aria-hidden="true"></span>',
		);
		lines.push("</nav>");
	}
	if (
		nativeNav &&
		readingToolsPlacement === "bottomBar" &&
		!bottomReadingToolsRendered &&
		readingTools
	) {
		if (nativeSlides || nativeMinimal) {
			lines.push(
				`<div class="praxity-nav-band" role="region" aria-label="${escapeHtml(localeStrings.courseControls)}"><div class="praxity-a11y-dock">${readingTools}</div></div>`,
			);
		} else lines.push(`<div class="praxity-a11y-dock">${readingTools}</div>`);
	}
	if (readingTools && !nativeNav) {
		lines.push(`<div class="praxity-a11y-dock">${readingTools}</div>`);
	}
	if (!opts.deckPages && totalPages > 1 && pageRole === "content") {
		const embedProgressLabel = interpolate(localeStrings.courseProgressPageOf, {
			current: progressCurrent,
			total: progressTotal,
		});
		lines.push(
			`<nav id="praxity-embed-nav" class="praxity-embed-nav"${nativeNav ? ' data-island="nav"' : ""} aria-label="${escapeHtml(localeStrings.pageNavigation)}" tabindex="-1"><div class="praxity-native-embed-nav-inner">`,
		);
		lines.push(
			prevPage
				? `<a class="praxity-native-embed-nav-button" href="${escapeHtml(prevPage.slug)}.html" aria-label="${escapeHtml(previousAccessibleLabel)}" data-page-direction="previous" data-page-id="${escapeHtml(prevPage.pageId)}" data-page-slug="${escapeHtml(prevPage.slug)}" data-page-number="${currentPage - 1}" data-page-index="${currentPage - 2}"><span aria-hidden="true">&#8249;</span></a>`
				: moduleNavigation
					? ""
					: `<button type="button" class="praxity-native-embed-nav-button" aria-label="${escapeHtml(localeStrings.previousPage)}" disabled><span aria-hidden="true">&#8249;</span></button>`,
		);
		lines.push(nativeProgressMarkup("bar", progressCurrent, progressTotal, embedProgressLabel));
		lines.push(
			`<span class="praxity-page-count-text">${moduleNavigation ? escapeHtml(localPosition) : `${currentPage} / ${totalPages}`}</span>`,
		);
		lines.push(
			nextPage
				? `<a class="praxity-native-embed-nav-button" href="${escapeHtml(nextPage.slug)}.html" aria-label="${escapeHtml(nextAccessibleLabel)}" data-page-direction="next" data-continue-button data-page-id="${escapeHtml(nextPage.pageId)}" data-page-slug="${escapeHtml(nextPage.slug)}" data-page-number="${currentPage + 1}" data-page-index="${currentPage}"><span aria-hidden="true">&#8250;</span></a>`
				: moduleNavigation
					? ""
					: `<button type="button" class="praxity-native-embed-nav-button" aria-label="${escapeHtml(localeStrings.nextPage)}" disabled><span aria-hidden="true">&#8250;</span></button>`,
		);
		lines.push("</div></nav>");
	}
	lines.push("</div>");
	if (pagesPresentation && pageRole === "content" && pageNavToggles.navProgressStyle !== "none") {
		lines.push(
			`<section aria-label="${escapeHtml(localeStrings.courseProgress)}"><div class="praxity-pages-progress" role="progressbar" aria-label="${escapeHtml(localeStrings.courseProgress)}" aria-valuemin="0" aria-valuemax="${progressTotal}" aria-valuenow="${progressCurrent}"><div style="width:${Math.min(100, (progressCurrent / Math.max(1, progressTotal)) * 100)}%"></div></div></section>`,
		);
	}
	if (nativeNav && pageNavToggles.navScrollProgress === true) {
		lines.push(
			`<div class="praxity-scroll-progress" data-native-scroll-progress role="progressbar" aria-label="${escapeHtml(localeStrings.pageScrollProgress)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="praxity-scroll-progress-fill" data-native-scroll-progress-fill></div></div>`,
		);
	}
	if (
		(nativeNav || deckPresentation) &&
		pageNavToggles.navFloatingToc === true &&
		floatingTocEntries.length >= 2
	) {
		const firstVisibleTocIndex = floatingTocEntries.findIndex((entry) => !entry.hidden);
		const visibleTocCount = floatingTocEntries.filter((entry) => !entry.hidden).length;
		lines.push(
			`<nav class="praxity-floating-toc" data-native-floating-toc aria-label="${escapeHtml(localeStrings.sectionNavigation)}"${visibleTocCount < 2 ? " hidden" : ""}><div class="praxity-floating-toc-bars">`,
		);
		for (const [entryIndex, entry] of floatingTocEntries.entries()) {
			const active = entryIndex === firstVisibleTocIndex;
			lines.push(
				`<div class="praxity-toc-tick-wrap"${entry.hidden ? " hidden" : ""}><a href="#block-${escapeHtml(entry.blockId)}" class="praxity-toc-bar${entry.level === 3 ? " praxity-toc-bar-sub" : ""}${active ? " active" : ""}" data-toc-target="block-${escapeHtml(entry.blockId)}"${active ? ' aria-current="true"' : ""} aria-label="${escapeHtml(entry.text)}"><span class="praxity-a11y-sr-only">${escapeHtml(entry.text)}</span></a><div class="praxity-toc-preview" data-toc-preview aria-hidden="true" hidden><p class="praxity-toc-preview-title">${escapeHtml(entry.text)}</p></div></div>`,
			);
		}
		lines.push("</div></nav>");
	}
	if (showNarrativeBar) {
		const narrativeParts = [
			sectionCount > 1
				? interpolate(localeStrings.narrativeSectionPosition, { current: 1, total: sectionCount })
				: "",
			displayedReadingTimeMinutes > 0 && !durationInCourseOutline
				? interpolate(localeStrings.narrativeReadTime, { minutes: displayedReadingTimeMinutes })
				: "",
		].filter(Boolean);
		lines.push(
			`<div id="praxity-narrative-bar" data-native-narrative-bar data-section-count="${sectionCount}" role="status" aria-live="polite" aria-atomic="true"><div class="praxity-narrative-bar"><p class="praxity-narrative-bar-text" data-native-narrative-text data-read-time="${displayedReadingTimeMinutes}">${escapeHtml(narrativeParts.join(" · "))}</p></div></div>`,
		);
	}

	if (!shouldEmitHtmlOnlyNoJs) {
		if (opts.islandAssets && islandsNeeded.size > 0) {
			lines.push(`<script defer src="${escapeHtml(opts.islandAssets.loaderFilename)}"></script>`);
		}
	}
	lines.push("</body>");
	lines.push("</html>");

	return renderInlineIcons(lines.join("\n"));
}

/**
 * Generate the index.html page that redirects to the first course page.
 */
export function generateHtmlIndex(
	firstSlug: string,
	basePath?: string,
	pageIdMap: Readonly<Record<string, string>> = {},
	shellFilename = "course-shell.js",
): string {
	const prefix = basePath ? `${basePath.replace(/\/$/, "")}/` : "";
	const target = `${prefix}${firstSlug}.html`;
	const shellConfig = escapeJsonForScript(
		JSON.stringify({ version: 1, kind: "redirect", target, prefix, pageIdMap }),
	);
	// index.html is the SCORM launch file and the review-share entry point, so it
	// receives ?embed=1, ?minimal=1 and review tokens that the viewer reads. A bare
	// meta-refresh dropped them; the page-N shims already forwarded them. Keep the
	// meta-refresh inside noscript: WebKit can otherwise follow it after the shell
	// has requested its redirect, dropping the query even with scripting enabled.
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Loading course...</title>
<script id="${SHELL_CONFIG_ID}" type="application/json">${shellConfig}</script>
<script src="${escapeHtml(shellFilename)}"></script>
<noscript><meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" /></noscript>
</head>
<body>
<p>Loading course...</p>
</body>
</html>`;
}

export function generateNumberedPageRedirect(
	targetSlug: string,
	basePath?: string,
	shellFilename = "course-shell.js",
): string {
	const prefix = basePath ? `${basePath.replace(/\/$/, "")}/` : "";
	const target = `${prefix}${targetSlug}.html`;
	const shellConfig = escapeJsonForScript(JSON.stringify({ version: 1, kind: "redirect", target }));
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Loading page...</title>
<script id="${SHELL_CONFIG_ID}" type="application/json">${shellConfig}</script>
<script src="${escapeHtml(shellFilename)}"></script>
<noscript><meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" /></noscript>
</head>
<body>
<p>Loading page...</p>
</body>
</html>`;
}

export type HtmlOutputOptions = Pick<
	PageGenOptions,
	| "islandAssets"
	| "basePath"
	| "liteStylesheetFilename"
	| "shellFilename"
	| "stylesheetFilename"
	| "deckStylesheets"
	| "retrievalSheetStylesheetFilename"
	| "highlightStylesheetFilename"
	| "resumeFilename"
>;

/** Course-wide render facts; module capabilities are planned once per module. */
export function prepareHtmlCourse(
	config: CourseConfig,
	islandAssets?: PageGenOptions["islandAssets"],
) {
	assertPracticePublication(config.pages, config.sourceLocale);
	config = {
		...config,
		pages: config.pages.map((page) => ({ ...page, blocks: prepareInlineBlocks(page.blocks) })),
	};
	const choiceFacts = compileChoiceStateFacts(config);

	if (config.moduleDeck) validateModuleDeck(config.moduleDeck, config.pages, config.sourceLocale);

	// Build slug map
	const slugMap = buildSlugMap(config.pages);
	const slugList: SlugEntry[] = config.pages.map((p, i) => ({
		pageId: p.id,
		slug: slugMap.get(p.id) ?? `page-${i + 1}`,
		title: fullyDecodeEntities(p.title),
	}));
	const firstSlug = slugList[0]?.slug ?? "page-1";
	const availableIslands = islandAssets === undefined ? true : availableIslandNames(islandAssets);
	const pageRuntimePlans = new Map<string, PageRuntimePlan>();
	const deckOptions = config.moduleDeck;
	const deckPages = deckOptions
		? config.pages.map((page, index) => {
				const first =
					config.pages.find(
						(candidate) => (candidate.lessonId ?? candidate.id) === (page.lessonId ?? page.id),
					) ?? page;
				return deckPageData(
					page,
					deckOptions,
					slugList[index].slug,
					slugMap.get(first.id) ?? slugList[index].slug,
					page.locale ?? config.sourceLocale,
					resolveDeckDesign({
						...config.deckDesign,
						...(first.data?.deckDesign as DeckDesign),
					}).sequentialLessons,
				);
			})
		: undefined;
	if (deckPages) {
		const modules = new Map<string, PraxityPage[]>();
		for (const page of config.pages) {
			const key = page.lessonId ?? page.id;
			const members = modules.get(key) ?? [];
			members.push(page);
			modules.set(key, members);
		}
		for (const members of modules.values()) {
			const plan = planModuleRuntime(config, members, availableIslands, deckOptions);
			for (const page of members) pageRuntimePlans.set(page.id, plan);
		}
	} else {
		for (const page of config.pages)
			pageRuntimePlans.set(page.id, planPageRuntime(config, page, availableIslands));
	}
	return { config, slugMap, slugList, firstSlug, pageRuntimePlans, deckPages, choiceFacts };
}

export type PreparedHtmlCourse = ReturnType<typeof prepareHtmlCourse>;

/** Assemble a document using page content supplied by the page compiler. */
export function renderHtmlDocument(
	prepared: PreparedHtmlCourse,
	slug: string,
	options: HtmlOutputOptions,
	render: (page: PraxityPage) => string,
	usedStylesheets = new Set<string>(),
	renderRegion?: (fragment: HtmlFragment) => string,
): string {
	const { config, slugMap, slugList, pageRuntimePlans, deckPages, choiceFacts } = prepared;
	const {
		islandAssets,
		basePath,
		liteStylesheetFilename,
		shellFilename = "course-shell.js",
		stylesheetFilename = "styles.css",
		deckStylesheets,
		retrievalSheetStylesheetFilename = "retrieval-sheet.css",
		highlightStylesheetFilename = "highlight.css",
		resumeFilename = "course-resume.js",
	} = options;
	const localeStrings = getStrings(config.sourceLocale);
	const availableIslands = islandAssets === undefined ? true : availableIslandNames(islandAssets);
	const i = config.pages.findIndex((page) => slugMap.get(page.id) === slug);
	if (i >= 0) {
		const page = config.pages[i];
		if (deckPages && deckPages[i].moduleSlug !== slug)
			throw new Error(`Not a canonical module document: ${slug}`);
		const members = deckPages
			? config.pages.filter(
					(candidate) => (candidate.lessonId ?? candidate.id) === (page.lessonId ?? page.id),
				)
			: [];
		const moduleConfig = deckPages
			? {
					...config,
					sourceLocale: page.locale ?? config.sourceLocale,
					deckDesign: resolveDeckDesign(members[0]?.data?.deckDesign ?? config.deckDesign),
					glossaryTabEnabled:
						typeof members[0]?.data?.deckGlossaryPage === "boolean"
							? members[0].data.deckGlossaryPage
							: config.glossaryTabEnabled,
					navToggles: {
						...config.navToggles,
						...(members[0]?.data?.deckNavigation as Partial<NavToggleConfig>),
					},
				}
			: config;
		const deckBody = deckPages
			? renderDeckBody(moduleConfig, members, deckPages, render, renderRegion)
			: undefined;
		return generateHtmlPage({
			choiceFacts,
			config: moduleConfig,
			deckPages,
			overrideBodyHtml: deckBody,
			pageContentHtml: deckPages ? undefined : render(page),
			page: deckPages ? { ...page, blocks: members.flatMap((member) => member.blocks) } : page,
			index: i,
			currentSlug: slug,
			slugList,
			slugMap,
			shellFilename,
			resumeFilename,
			islandAssets,
			basePath,
			stylesheetFilename,
			liteStylesheetFilename,
			deckStylesheets,
			retrievalSheetStylesheetFilename,
			highlightStylesheetFilename,
			usedStylesheets,
			runtimePlan: pageRuntimePlans.get(page.id),
		});
	}
	// Write the shared glossary when at least one module enables it.
	if (
		slug === "glossary" &&
		(config.moduleDeck
			? config.pages.some(
					(page) => (page.data?.deckGlossaryPage ?? config.glossaryTabEnabled) !== false,
				)
			: config.glossaryTabEnabled !== false) &&
		config.glossaryTerms &&
		config.glossaryTerms.length > 0
	) {
		const glossaryBody = generateGlossaryPageHtml({
			terms: config.glossaryTerms,
		});
		if (glossaryBody) {
			const glossarySlugList: SlugEntry[] = [
				...slugList,
				{ pageId: "glossary", slug: "glossary", title: localeStrings.glossaryHeading },
			];
			const glossarySlugMap = new Map([...slugMap, ["glossary", "glossary"]]);
			// Create a minimal synthetic page for the glossary shell
			const glossaryPage: PraxityPage = {
				id: "glossary",
				title: localeStrings.glossaryHeading,
				data: { nav: "none", navKeyboardArrows: false },
				blocks: [
					{
						id: "glossary-heading",
						type: "heading",
						data: { content: localeStrings.glossaryHeading, level: 1 },
					},
					{
						id: "glossary-content",
						type: "text",
						data: { content: glossaryBody },
					},
				],
			};
			const glossaryHtml = generateHtmlPage({
				choiceFacts,
				config: { ...config, totalPages: config.totalPages },
				page: glossaryPage,
				index: config.pages.length,
				currentSlug: "glossary",
				slugList: glossarySlugList,
				slugMap: glossarySlugMap,
				shellFilename,
				resumeFilename,
				islandAssets,
				basePath,
				stylesheetFilename,
				liteStylesheetFilename,
				usedStylesheets,
				runtimePlan: planPageRuntime(config, glossaryPage, availableIslands),
				overrideBodyHtml: glossaryBody,
			});
			return glossaryHtml;
		}
	}

	// Write resources page when enabled and entries are present
	if (
		slug === "resources" &&
		config.resourcesTabEnabled !== false &&
		config.resourceEntries &&
		config.resourceEntries.length > 0
	) {
		const resourcesBody = generateResourcesPageHtml({
			entries: config.resourceEntries,
			courseTitle: config.title,
			locale: config.sourceLocale,
		});
		if (resourcesBody) {
			const resourcesSlugList: SlugEntry[] = [
				...slugList,
				{ pageId: "resources", slug: "resources", title: localeStrings.resourcesHeading },
			];
			const resourcesSlugMap = new Map([...slugMap, ["resources", "resources"]]);
			// Create a minimal synthetic page for the resources shell
			const resourcesPage: PraxityPage = {
				id: "resources",
				title: localeStrings.resourcesHeading,
				blocks: [
					{
						id: "resources-heading",
						type: "heading",
						data: { content: localeStrings.resourcesHeading, level: 1 },
					},
					{
						id: "resources-content",
						type: "text",
						data: { content: resourcesBody },
					},
				],
			};
			const resourcesHtml = generateHtmlPage({
				choiceFacts,
				config: { ...config, totalPages: config.totalPages },
				page: resourcesPage,
				index: config.pages.length,
				currentSlug: "resources",
				slugList: resourcesSlugList,
				slugMap: resourcesSlugMap,
				shellFilename,
				resumeFilename,
				islandAssets,
				basePath,
				stylesheetFilename,
				liteStylesheetFilename,
				usedStylesheets,
				runtimePlan: planPageRuntime(config, resourcesPage, availableIslands),
				overrideBodyHtml: resourcesBody,
			});
			return resourcesHtml;
		}
	}

	throw new Error(`Unknown HTML document: ${slug}`);
}

// Export utilities for testing
export { escapeJsonForHtml, escapeJsonForScript, resolveColorShades, themeVarsToCss };

export function renderDeckBody(
	config: CourseConfig,
	members: PraxityPage[],
	pages: DeckPage[],
	render: (page: PraxityPage) => string,
	renderRegion?: (fragment: HtmlFragment) => string,
): string {
	const region = (key: string, html: string) =>
		renderRegion?.({ id: `region:${key}`, kind: "region", html }) ?? html;
	const readingBlocks = new Map<string, PraxityBlock>(
		members.flatMap((page) =>
			flattenLogicBlocks(page.blocks).map((block) => [`${page.id}:${block.id}`, block] as const),
		),
	);
	const numberAttribute = config.pages.some((page) =>
		flattenLogicBlocks(page.blocks).some((block) => block.type === "selfCheck"),
	)
		? (index: number) => ` data-page-number="${index + 1}"`
		: () => "";
	const t = deckStrings(config.sourceLocale);
	const strings = getStrings(config.sourceLocale);
	const design = resolveDeckDesign(config.deckDesign);
	const glossaryLink =
		config.glossaryTabEnabled !== false && config.glossaryTerms?.length
			? `<a class="deck-glossary-link" href="glossary.html" target="_blank" rel="noopener">${escapeHtml(strings.glossaryHeading)} ${externalLinkIndicatorHtml(strings.opensInNewTab)}</a>`
			: "";
	const assessmentPages = new Set(
		config.pages
			.filter((page) =>
				flattenLogicBlocks(page.blocks).some((block) => block.type === "assessment"),
			)
			.map((page) => page.id),
	);
	const first = config.pages.indexOf(members[0]);
	const last = first + members.length - 1;
	const courseTitle = fullyDecodeEntities(config.title).trim();
	const moduleTitle = fullyDecodeEntities(members[0]?.lessonTitle ?? config.title).trim();
	const outline = pages
		.flatMap((page, index) => {
			const local = index >= first && index <= last;
			if (
				!local &&
				(design.outlineDetail === "currentModule" ||
					pages[index - 1]?.moduleSlug === page.moduleSlug)
			)
				return [];
			const title = local
				? page.title
				: config.pages[index].lessonTitle || page.title || config.title;
			const assessment = local && assessmentPages.has(page.id);
			return [
				`${index === first ? `<li><span class="deck-module-title">${escapeHtml(moduleTitle)}</span><ol role="list">` : ""}<li><a ${local ? "" : 'class="deck-module-link" '}data-deck-page="${escapeHtml(page.id)}"${numberAttribute(index)} href="${escapeHtml(page.moduleSlug)}.html#${encodeURIComponent(page.id)}"${index === first ? ' aria-current="page"' : ""}${assessment ? ` aria-label="${escapeHtml(`${title}, ${t.assessment}`)}"` : ""}>${assessment ? `<span class="deck-outline-kind" aria-hidden="true" title="${escapeHtml(t.assessment)}">${DECK_CHECK}</span>` : local ? '<svg width="16" height="16" aria-hidden="true" focusable="false"></svg>' : ""}<span class="praxity-outline-label">${escapeHtml(title)}</span>${outlineStatus(true)}</a></li>${index === last ? "</ol></li>" : ""}`,
			];
		})
		.join("");
	const showModule = config.navToggles?.navLessonTitles !== false && moduleTitle;
	const showCourse =
		config.navToggles?.navCourseTitle !== false &&
		courseTitle &&
		(!showModule || courseTitle.toLocaleLowerCase() !== moduleTitle.toLocaleLowerCase());
	const header =
		config.navToggles?.navTopBar === true && (showCourse || showModule)
			? `<header class="praxity-top-bar deck-identity">${showCourse ? `<p class="deck-course-title">${escapeHtml(courseTitle)}</p>` : ""}${showCourse && showModule ? `<span class="deck-identity-separator" aria-hidden="true">/</span>` : ""}${showModule ? `<p class="deck-module-title">${escapeHtml(moduleTitle)}</p>` : ""}</header>`
			: "";
	return `<div class="praxity-deck" data-island="deck"${config.courseHomeUrl ? COURSE_HOME_DECK_SLOT : ""}>${region("deck-top-bar", header)}
<a class="praxity-skip-link" href="#deck-controls" data-deck-enhanced hidden>${escapeHtml(t.skip)}</a>
<div class="deck-workspace"><main id="main-content" class="praxity-page-content" tabindex="0"><div id="deck-slides">${members.map((page, index) => `<section class="deck-slide" id="${escapeHtml(page.id)}" data-deck-slide="${escapeHtml(page.id)}"${numberAttribute(first + index)} aria-label="${escapeHtml(interpolate(strings.slideAnnouncement, { current: index + 1, total: members.length }))}">${render(page)}</section>`).join("\n")}</div><section id="deck-completion" class="deck-slide" hidden><div class="praxity-slide"><h1 class="deck-stage-title" tabindex="-1">${escapeHtml(t.moduleComplete)}</h1><p id="deck-completion-time">${escapeHtml(strings.courseTimeUnavailable)}</p><p id="deck-completion-score" hidden></p>${config.passingScore === undefined ? "" : COURSE_COMPLETION_OUTCOME}<div class="praxity-pages-completion-actions"><button type="button" id="deck-review" class="praxity-btn praxity-btn-outline">${escapeHtml(t.reviewModule)}</button></div></div></section></main><button type="button" id="deck-more-below" aria-controls="main-content" hidden>${escapeHtml(t.moreBelow)}</button>
<div id="deck-outline-sidebar" class="deck-panels"><nav id="deck-outline" aria-labelledby="deck-outline-title"><div class="deck-panel-heading"><h2 id="deck-outline-title" class="deck-panel-title" tabindex="-1">${escapeHtml(t.outline)}</h2><button type="button" id="deck-outline-close" class="praxity-native-menu-close" aria-label="${escapeHtml(t.closeSidebar)}" data-deck-enhanced hidden>${nativeSidebarChevron("left")}</button></div><div class="deck-panel-scroll praxity-outline-fallback">${region("deck-outline", `<ol role="list">${outline}</ol>`)}${region("deck-glossary-link", glossaryLink)}</div></nav></div>
<div role="complementary" id="deck-sidebar" class="deck-panels" aria-label="${escapeHtml(t.script)}"><section id="deck-script"><div class="deck-panel-heading"><h2 id="deck-script-title" class="deck-panel-title" tabindex="-1">${escapeHtml(t.script)}</h2><div class="deck-follow" data-deck-enhanced hidden><button type="button" id="deck-follow" aria-pressed="${design.followNarration}" aria-label="${escapeHtml(t.follow)}" title="${escapeHtml(t.follow)}">${DECK_FOLLOW}</button></div><button type="button" id="deck-sidebar-close" class="praxity-native-menu-close" aria-label="${escapeHtml(t.closeSidebar)}" data-deck-enhanced hidden>${nativeSidebarChevron("right")}</button></div>
<div id="deck-resume-follow-row" aria-hidden="true" inert><button type="button" id="deck-resume-follow" aria-describedby="deck-resume-follow-description">${DECK_FOLLOW}${escapeHtml(t.resumeFollow)}</button></div>

<span id="deck-resume-follow-description" class="praxity-a11y-sr-only">${escapeHtml(t.resumeFollowDescription)}</span><span id="deck-follow-status" class="praxity-a11y-sr-only" role="status" aria-live="polite"></span>
<div id="deck-script-scroll" class="deck-panel-scroll" tabindex="0" role="region" aria-label="${escapeHtml(t.readingText)}">${members
		.map((page) =>
			region(
				`deck-reading:${page.id}`,
				`<div data-deck-reading="${escapeHtml(page.id)}">${
					pages
						.find((item) => item.id === page.id)
						?.segments.map((segment, index) =>
							segment.kind === "pageTitle" && segment.script === plainTextFromHtml(page.title)
								? ""
								: `<div data-deck-segment="${escapeHtml(segment.id)}">${segment.speaker ? `<p class="deck-script-speaker"><bdi>${escapeHtml(segment.speaker)}</bdi>${escapeHtml(t.speakerSuffix)}</p>` : ""}<div class="deck-script-content praxity-transcript-content" data-block-id="${escapeHtml(segment.id)}">${sanitizeHtml(renderDeckReadingScript(segment, readingBlocks.get(`${page.id}:${segment.blockId}`)))}</div>${segment.src ? `<button type="button" class="deck-script-seek praxity-transcript-seek praxity-focus-reveal" data-deck-enhanced hidden data-deck-seek="${escapeHtml(page.id)}" data-segment-index="${index}" aria-label="${escapeHtml(`${t.seekHere}: ${segment.speaker ? `${segment.speaker}${t.speakerSuffix} ` : ""}${narrationSeekLabel(segment.script)}`)}">${escapeHtml(t.seekHere)}</button>` : ""}</div>`,
						)
						.join("\n") ?? ""
				}</div>`,
			),
		)
		.join("\n")}</div></section></div></div>
<p id="deck-status" role="status"></p>
<nav id="deck-controls" class="deck-controls praxity-native-page-nav" aria-label="${escapeHtml(t.controls)}" tabindex="-1" data-deck-enhanced hidden>
<div class="deck-position-controls"><button type="button" id="deck-previous" class="praxity-nav-prev" aria-label="${escapeHtml(t.previous)}" title="${escapeHtml(t.previous)}">${nativeSlideArrow("left")}<span class="deck-navigation-copy"><span class="deck-navigation-label">${escapeHtml(t.previousLabel)}</span><span class="deck-adjacent-title"></span></span></button><div id="deck-narration"></div><span class="praxity-native-page-position"><span id="deck-position"${design.slideCounter ? "" : " hidden"} aria-hidden="true"></span><span id="deck-position-label" class="praxity-a11y-sr-only"></span><span id="deck-advance-status"${design.autoAdvance ? "" : " hidden"}>${escapeHtml(t.advanceOn)}</span></span><div class="deck-utilities"><div id="deck-more"><button type="button" id="deck-more-toggle" aria-expanded="false" aria-controls="deck-more-panel" aria-label="${escapeHtml(t.more)}" title="${escapeHtml(t.more)}">${escapeHtml(t.more)}</button><div id="deck-more-panel" class="deck-utility-items praxity-floating-layer"><button type="button" id="deck-outline-toggle"${design.outline || glossaryLink ? "" : " hidden"} aria-controls="deck-outline-sidebar" aria-expanded="false"><svg class="deck-utility-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg><span class="deck-utility-label">${escapeHtml(t.outline)}</span></button><button type="button" id="deck-script-toggle" aria-controls="deck-sidebar" aria-expanded="false"><svg class="deck-utility-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 5a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3l12 0"/><path d="M7 15h5"/><path d="M15 15h2"/><path d="M17 12h-3"/><path d="M11 12h-1"/></svg><span class="deck-utility-label">${escapeHtml(t.script)}</span></button>${nativeA11yControls(strings, false, true)}<button type="button" id="deck-advance" role="switch" aria-checked="${design.autoAdvance}" aria-label="${escapeHtml(t.advance)}"><span class="deck-utility-label">${escapeHtml(t.advance)}</span><svg class="deck-utility-icon" width="36" height="22" viewBox="0 0 36 22" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="35" height="21" rx="10.5" fill="none" stroke="currentColor"/><circle cx="11" cy="11" r="7" fill="currentColor"/></svg></button><span id="deck-more-position" class="deck-more-position"></span><div id="deck-more-playback" class="deck-more-playback"></div></div></div></div><button type="button" id="deck-next" class="praxity-nav-next" aria-label="${escapeHtml(t.next)}" title="${escapeHtml(t.next)}"><span class="deck-navigation-copy"><span class="deck-navigation-label">${escapeHtml(t.nextLabel)}</span><span class="deck-adjacent-title"></span></span>${nativeSlideArrow("right")}</button></div>
<span id="deck-announcement" class="praxity-a11y-sr-only" role="status"></span></nav>
<div class="deck-module-links">${first > 0 ? `<a data-deck-module${numberAttribute(first - 1)} href="${escapeHtml(pages[first - 1].slug)}.html">${escapeHtml(t.previousModule)}${DECK_LOCK}</a>` : ""}${last < pages.length - 1 ? `<a data-deck-module${numberAttribute(last + 1)} href="${escapeHtml(pages[last + 1].slug)}.html">${escapeHtml(t.nextModule)}${DECK_LOCK}</a>` : ""}</div></div>`;
}
