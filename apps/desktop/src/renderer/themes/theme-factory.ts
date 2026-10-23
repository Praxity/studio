import {
	compositeOver,
	contrastRatio,
	ensureContrast,
	ensureContrastAll,
	formatOklch,
	mixColors,
	pickReadableForeground,
} from "@praxity/shared-blocks/color-math";
import type { ThemeColors } from "./types";

export interface ThemeColorSeed {
	appearance: "light" | "dark";
	bgPrimary: string;
	bgSecondary: string;
	bgTertiary: string;
	bgEditor?: string;
	bgPanel?: string;
	bgHover?: string;
	bgActive?: string;
	bgCard?: string;
	textPrimary: string;
	textSecondary: string;
	textMuted: string;
	border: string;
	borderSubtle: string;
	accent: string;
	accentHover?: string;
	accentText: string;
	syntaxKey: string;
	syntaxValue: string;
	syntaxMarkerPage: string;
	syntaxMarkerSection: string;
	syntaxMarkerCorrect: string;
	syntaxContent?: string;
	syntaxHeading?: string;
	syntaxParamBg?: string;
	syntaxInstructor: string;
	syntaxInstructorBg: string;
	gutterIcon?: string;
	statusBarBg?: string;
	statusBarText?: string;
	statusBarBorder?: string;
	topBarBg?: string;
	topBarBorder?: string;
	activityBarBg?: string;
	activityBarIcon?: string;
	activityBarIconActive?: string;
	activityBarActiveBg?: string;
	activityBarHoverBg?: string;
	activityBarDivider?: string;
	welcomeBg?: string;
	welcomeCardBg?: string;
	welcomeCardBorder?: string;
	welcomeCardHover?: string;
	resizeHandle?: string;
	resizeHandleHover?: string;
	resizeHandleActive?: string;
	statusSaved: string;
	statusWarning: string;
	statusError: string;
	statusBadgeBg?: string;
	statusBadgeText?: string;
	statusDense?: string;
	focusRing?: string;
}

function hexToRgb(value: string): [number, number, number] | null {
	const hex = value.trim().replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		return null;
	}
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	return [r, g, b];
}

export function withAlpha(value: string, alpha: number): string {
	if (!hexToRgb(value)) {
		return value;
	}
	return formatOklch(value, alpha);
}

/**
 * Of the surfaces a foreground renders on, return the one it contrasts least
 * against — the surface that has to satisfy the ratio for all of them to pass.
 */
function worstContrastSurface(foreground: string, ...surfaces: string[]): string {
	let worst = surfaces[0];
	for (const surface of surfaces) {
		if (contrastRatio(foreground, surface) < contrastRatio(foreground, worst)) {
			worst = surface;
		}
	}
	return worst;
}

/**
 * Choose a foreground for `background` that clears `minRatio`, preferring the
 * earlier candidates. Falls back to lightness-correcting whichever candidate
 * gets furthest.
 *
 * This exists because `ensureContrast` alone cannot rescue a pinned `#ffffff`:
 * white is already the lightest colour there is, so a too-light red badge kept
 * failing no matter how the value was corrected. Including black in the
 * candidate list makes success unconditional — for any background, the better
 * of white and black is at least 4.58:1.
 */
function readableOn(background: string, minRatio: number, ...candidates: string[]): string {
	for (const candidate of candidates) {
		if (contrastRatio(candidate, background) >= minRatio) {
			return candidate;
		}
	}

	let best = candidates[0];
	let bestRatio = 0;
	for (const candidate of candidates) {
		const corrected = ensureContrast(candidate, background, minRatio);
		const ratio = contrastRatio(corrected, background);
		if (ratio > bestRatio) {
			bestRatio = ratio;
			best = corrected;
		}
	}
	return best;
}

/**
 * Hue anchors for the five composition categories. Only the hue carries
 * meaning (engage/explain/practice/assess/structure must stay distinguishable);
 * lightness and chroma are re-derived per theme so the markers sit on the
 * panel surface at a readable ratio instead of the fixed hexes the
 * compositions panel used to hardcode.
 */
const CATEGORY_SEEDS = {
	categoryEngage: "#8b5cf6",
	categoryExplain: "#4269d0",
	categoryPractice: "#0f8b8d",
	categoryAssess: "#c05621",
	categoryStructure: "#59636e",
} as const;

/**
 * Wash hues for the compositions panel, one per category. These are the five
 * colours of the Praxity logomark, in logomark order, so the panel reads as a
 * spread of the brand rather than an unrelated palette.
 *
 * They are deliberately *not* CATEGORY_SEEDS. Those are ink — corrected to
 * 4.5:1 so they can carry the raw editor's category keywords — and yellow ink
 * at 4.5:1 is a brown. These are large tinted grounds behind a card, mixed down
 * to a wash, so they keep the hue the brand is actually recognised by.
 */
const COMPOSITION_TINT_SEEDS = {
	compositionTintEngage: "#efb118",
	compositionTintExplain: "#4269d0",
	compositionTintPractice: "#6cc5b0",
	compositionTintAssess: "#ff725c",
	compositionTintStructure: "#a463f2",
} as const;

export function buildThemeColors(seed: ThemeColorSeed): ThemeColors {
	const dark = seed.appearance === "dark";
	const bgPrimary = seed.bgPrimary;
	const bgSecondary = seed.bgSecondary;
	const bgCard = seed.bgCard ?? seed.bgTertiary;
	const bgEditor = seed.bgEditor ?? bgPrimary;
	const statusBarBg = seed.statusBarBg ?? bgSecondary;
	const welcomeCardBg = seed.welcomeCardBg ?? bgCard ?? seed.bgTertiary;
	// Secondary and muted text appear on the panel surface as often as on the main
	// background, and the panel is the lower-contrast of the two in every shipped
	// theme. Guaranteeing against bgPrimary alone left them passing on white and
	// failing on panels — #999999 corrected to #777676, which is 4.5:1 on #ffffff
	// but only 4.19:1 on the #f5f6f8 panel. Correct against the harder surface so
	// the guarantee holds wherever the token is used.
	const bgPanel = seed.bgPanel ?? bgSecondary;
	// The selected/active row is a tint of the accent over the panel; panel text
	// lands on it too (the Accessibility panel's quick-start callout sits on it),
	// so it belongs in the guarantee alongside the plain surfaces.
	const selectedBg = mixColors(seed.accent, bgPanel, dark ? 0.24 : 0.16);
	// Every surface panel text can land on. bgTertiary, bgCard and selectedBg
	// were missing from this list, and they are the darker/lighter extremes in
	// most themes — which is why secondary labels passed on the panel and failed
	// on a card.
	const textSurfaces = [bgPrimary, bgPanel, bgCard, seed.bgTertiary, selectedBg];
	const textPrimary = ensureContrastAll(seed.textPrimary, 4.5, ...textSurfaces);
	const textSecondary = ensureContrastAll(seed.textSecondary, 4.5, ...textSurfaces);
	const textMuted = ensureContrastAll(seed.textMuted, 4.5, ...textSurfaces);

	const syntaxParamBg = seed.syntaxParamBg;
	// `.grammar-param-value` renders the value on a tint of itself over the
	// editor, so the real background is the composite — not bgEditor.
	const paramSurface = syntaxParamBg
		? bgEditor
		: compositeOver(seed.syntaxValue, dark ? 0.15 : 0.1, bgEditor);
	const syntaxSurfaces = [bgEditor, paramSurface];
	const syntaxKey = ensureContrastAll(seed.syntaxKey, 4.5, ...syntaxSurfaces);
	const syntaxValue = ensureContrastAll(seed.syntaxValue, 4.5, ...syntaxSurfaces);
	const syntaxContent = ensureContrast(seed.syntaxContent ?? textPrimary, bgEditor, 4.5);
	const syntaxHeading = ensureContrast(seed.syntaxHeading ?? textPrimary, bgEditor, 4.5);
	const syntaxMarkerPage = ensureContrast(seed.syntaxMarkerPage, bgEditor, 4.5);
	// The `---` divider and the `H1`/`K`/`C` gutter affordances are real text at
	// ~10-13px; every theme's comment grey sat between 1.7:1 and 4.1:1.
	const syntaxMarkerSection = ensureContrast(seed.syntaxMarkerSection, bgEditor, 4.5);
	const syntaxMarkerCorrect = ensureContrast(seed.syntaxMarkerCorrect, bgEditor, 4.5);
	const syntaxInstructor = ensureContrast(seed.syntaxInstructor, bgEditor, 4.5);
	const gutterIcon = ensureContrast(seed.gutterIcon ?? textMuted, bgEditor, 4.5);

	const statusBarText = ensureContrast(seed.statusBarText ?? textSecondary, statusBarBg, 4.5);
	const welcomeCardBorder = ensureContrastAll(
		seed.welcomeCardBorder ?? seed.border,
		3,
		welcomeCardBg,
		seed.welcomeBg ?? bgPrimary,
	);

	const accent = seed.accent;
	const accentHover = seed.accentHover ?? accent;
	// `accent` stays the brand fill; `accentOnSurface` is the corrected value for
	// the places CSS uses it as a *foreground* (active page number, active
	// sidebar item, block-picker icons).
	const accentOnSurface = ensureContrastAll(accent, 4.5, ...textSurfaces);
	// `accentText` labels both accent-filled buttons and the active ribbon
	// button, and a few themes seed a ribbon fill that is not the accent — so it
	// has to clear whichever of the two is harder.
	const activityBarActiveBg = seed.activityBarActiveBg ?? accent;
	const accentText = readableOn(
		worstContrastSurface(seed.accentText, accent, activityBarActiveBg),
		4.5,
		seed.accentText,
		"#ffffff",
		"#000000",
	);

	const statusSurfaces = [bgPanel, bgPrimary, statusBarBg, bgCard];
	const statusSaved = ensureContrastAll(seed.statusSaved, 4.5, ...statusSurfaces);
	const statusWarning = ensureContrastAll(seed.statusWarning, 4.5, ...statusSurfaces);
	const statusError = ensureContrastAll(seed.statusError, 4.5, ...statusSurfaces);
	const statusDense = ensureContrastAll(
		seed.statusDense ?? seed.statusWarning,
		4.5,
		...statusSurfaces,
	);

	// The badge carries a numeral (the page-density dot), so it is text. Every
	// theme seeds white, and 19 of 29 reds were too light to carry it at 4.5:1.
	const statusBadgeBg = seed.statusBadgeBg ?? statusError;
	const statusBadgeText = readableOn(
		statusBadgeBg,
		4.5,
		seed.statusBadgeText ?? "#ffffff",
		"#ffffff",
		"#000000",
	);

	// Controls sit on the panel but read as their own surface, so they take the
	// main background rather than the panel tint.
	const controlBg = bgPrimary;
	const controlBorder = ensureContrastAll(seed.border, 3, controlBg, bgPanel, bgCard);
	const focusRing = ensureContrastAll(
		seed.focusRing ?? ensureContrast(accent, bgPrimary, 3),
		3,
		bgPrimary,
		bgPanel,
		bgCard,
	);
	// The two-tone ring only reads if the inner stroke contrasts with the outer
	// one. White satisfied that on dark themes and vanished on light ones.
	const focusRingInner = readableOn(focusRing, 3, "#ffffff", textPrimary, "#000000");

	const selectedText = ensureContrast(textPrimary, selectedBg, 4.5);

	/** Build a severity triplet that lives on the panel surface, not a fixed grey. */
	const severity = (hue: string) => {
		const surface = mixColors(hue, bgPanel, dark ? 0.2 : 0.12);
		const badgeBg = ensureContrastAll(hue, 3, bgPanel, bgCard);
		return {
			surface,
			border: ensureContrast(hue, surface, 3),
			text: readableOn(surface, 4.5, hue, textPrimary, "#000000", "#ffffff"),
			badgeBg,
			badgeText: readableOn(badgeBg, 4.5, "#ffffff", textPrimary, "#000000"),
		};
	};

	const critical = severity(statusError);
	const warning = severity(statusWarning);
	const info = severity(textSecondary);

	// Each composition card is a wash of its category hue over the card surface.
	// The gradient runs from this colour to a 35% dilution of it, so every pixel
	// behind a mark lies between the tint and bgCard — which is why those two are
	// the surfaces the schematic tones below are corrected against.
	// Dark themes take roughly half the light alpha. Mixing a brand hue into a
	// near-black card raises luminance fast — at the light alpha, engage's yellow
	// turned the card into a mustard slab and pushed the mark ink to near-white.
	const tint = (hex: string) => mixColors(hex, bgCard, dark ? 0.12 : 0.32);
	const compositionTintEngage = tint(COMPOSITION_TINT_SEEDS.compositionTintEngage);
	const compositionTintExplain = tint(COMPOSITION_TINT_SEEDS.compositionTintExplain);
	const compositionTintPractice = tint(COMPOSITION_TINT_SEEDS.compositionTintPractice);
	const compositionTintAssess = tint(COMPOSITION_TINT_SEEDS.compositionTintAssess);
	const compositionTintStructure = tint(COMPOSITION_TINT_SEEDS.compositionTintStructure);
	const compositionSurfaces = [
		bgCard,
		compositionTintEngage,
		compositionTintExplain,
		compositionTintPractice,
		compositionTintAssess,
		compositionTintStructure,
	];

	// Schematic placeholders are non-text shapes standing in for content, so
	// 3:1 against their canvas is the bar (WCAG 1.4.11), not 4.5. Yellow and
	// coral wash much lighter than the rest, so a tone corrected against one
	// tint is not safe on the others — correct against all five.
	const schematicMuted = ensureContrastAll(textMuted, 3, ...compositionSurfaces);
	const schematicStrong = ensureContrastAll(textSecondary, 4.5, ...compositionSurfaces);

	// bgEditor is in the list because the raw editor's category-coloured keywords
	// (`as: image`, `alt`, `scored`) now draw from these same five hues instead of
	// the separate `--praxity-raw-cat-*` palette they used to have.
	const category = (hex: string) => ensureContrastAll(hex, 4.5, bgPanel, bgCard, bgEditor);
	const categoryEngage = category(CATEGORY_SEEDS.categoryEngage);
	const categoryExplain = category(CATEGORY_SEEDS.categoryExplain);
	const categoryPractice = category(CATEGORY_SEEDS.categoryPractice);
	const categoryAssess = category(CATEGORY_SEEDS.categoryAssess);
	const categoryStructure = category(CATEGORY_SEEDS.categoryStructure);

	// Toggle switches. Mantine's own track colours are gray-3 (light) and dark-5
	// (dark) with no border at all, which measures ~1.1:1 against our panel
	// surface — an unchecked switch reads as a smudge rather than a control, and
	// the checked track was Mantine blue rather than the brand accent. Both
	// tokens are corrected against whichever of bgPrimary / bgPanel they contrast
	// least against, because switches render on both surfaces (Design panel on
	// the panel, config menus on the primary background).
	const toggleTrackBorder = ensureContrastAll(seed.border, 3, bgPrimary, bgPanel);
	const toggleTrackOn = ensureContrastAll(seed.accent, 3, bgPrimary, bgPanel);
	// The thumb has to stay visible on the checked track whatever hue and
	// lightness the accent lands on. Picking the better of white / near-black is
	// always at least 4.58:1 — the worst case is the luminance where the two are
	// equal — where correcting `accentText` towards the track could not be.
	const toggleThumbOn =
		contrastRatio("#ffffff", toggleTrackOn) >= contrastRatio("#111111", toggleTrackOn)
			? "#ffffff"
			: "#111111";

	return {
		bgPrimary,
		bgSecondary,
		bgTertiary: seed.bgTertiary,
		bgEditor,
		bgPanel: seed.bgPanel ?? bgSecondary,
		bgHover: seed.bgHover ?? withAlpha(seed.textPrimary, dark ? 0.08 : 0.05),
		bgActive: seed.bgActive ?? withAlpha(seed.accent, dark ? 0.2 : 0.14),
		bgCard,
		textPrimary,
		textSecondary,
		textMuted,
		border: seed.border,
		borderSubtle: seed.borderSubtle,
		accent,
		accentHover,
		accentText,
		syntaxKey,
		syntaxValue,
		syntaxMarkerPage,
		syntaxMarkerSection,
		syntaxMarkerCorrect,
		syntaxContent,
		syntaxHeading,
		syntaxParamBg: seed.syntaxParamBg ?? withAlpha(seed.syntaxValue, dark ? 0.15 : 0.1),
		syntaxInstructor,
		syntaxInstructorBg: seed.syntaxInstructorBg,
		gutterIcon,
		statusBarBg,
		statusBarText,
		statusBarBorder: seed.statusBarBorder ?? seed.border,
		topBarBg: seed.topBarBg ?? bgPrimary,
		topBarBorder: seed.topBarBorder ?? seed.border,
		activityBarBg: seed.activityBarBg ?? bgSecondary,
		activityBarIcon: ensureContrast(
			seed.activityBarIcon ?? textMuted,
			seed.activityBarBg ?? bgSecondary,
			4.5,
		),
		activityBarIconActive: ensureContrast(
			seed.activityBarIconActive ?? textPrimary,
			seed.activityBarBg ?? bgSecondary,
			4.5,
		),
		activityBarActiveBg,
		activityBarHoverBg:
			seed.activityBarHoverBg ??
			withAlpha(seed.activityBarIconActive ?? seed.textPrimary, dark ? 0.11 : 0.1),
		activityBarDivider:
			seed.activityBarDivider ??
			withAlpha(seed.activityBarIconActive ?? seed.textPrimary, dark ? 0.2 : 0.22),
		welcomeBg: seed.welcomeBg ?? bgPrimary,
		welcomeCardBg,
		welcomeCardBorder,
		welcomeCardHover: seed.welcomeCardHover ?? bgCard ?? seed.bgTertiary,
		resizeHandle: seed.resizeHandle ?? "transparent",
		resizeHandleHover: seed.resizeHandleHover ?? accent,
		resizeHandleActive: seed.resizeHandleActive ?? accentHover,
		statusSaved,
		statusWarning,
		statusError,
		statusBadgeBg,
		statusBadgeText,
		statusDense,
		focusRing,

		focusRingInner,
		accentOnSurface,
		controlBg,
		controlBorder,
		selectedBg,
		selectedText,

		severityCriticalSurface: critical.surface,
		severityCriticalBorder: critical.border,
		severityCriticalText: critical.text,
		severityCriticalBadgeBg: critical.badgeBg,
		severityCriticalBadgeText: critical.badgeText,
		severityWarningSurface: warning.surface,
		severityWarningBorder: warning.border,
		severityWarningText: warning.text,
		severityWarningBadgeBg: warning.badgeBg,
		severityWarningBadgeText: warning.badgeText,
		severityInfoSurface: info.surface,
		severityInfoBorder: info.border,
		severityInfoText: info.text,
		severityInfoBadgeBg: info.badgeBg,
		severityInfoBadgeText: info.badgeText,

		schematicMuted,
		schematicStrong,

		compositionTintEngage,
		compositionTintExplain,
		compositionTintPractice,
		compositionTintAssess,
		compositionTintStructure,

		categoryEngage,
		categoryExplain,
		categoryPractice,
		categoryAssess,
		categoryStructure,

		// Switch/toggle roles — see the design-panel work; derived like the rest.
		toggleTrackBorder,
		toggleTrackOn,
		toggleThumbOn,
	};
}
