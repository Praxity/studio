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

function worstContrastSurface(foreground: string, ...surfaces: string[]): string {
	let worst = surfaces[0];
	for (const surface of surfaces) {
		if (contrastRatio(foreground, surface) < contrastRatio(foreground, worst)) {
			worst = surface;
		}
	}
	return worst;
}

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

const CATEGORY_SEEDS = {
	categoryEngage: "#8b5cf6",
	categoryExplain: "#4269d0",
	categoryPractice: "#0f8b8d",
	categoryAssess: "#c05621",
	categoryStructure: "#59636e",
} as const;

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
	const bgPanel = seed.bgPanel ?? bgSecondary;
	const selectedBg = mixColors(seed.accent, bgPanel, dark ? 0.24 : 0.16);
	const textSurfaces = [bgPrimary, bgPanel, bgCard, seed.bgTertiary, selectedBg];
	const textPrimary = ensureContrastAll(seed.textPrimary, 4.5, ...textSurfaces);
	const textSecondary = ensureContrastAll(seed.textSecondary, 4.5, ...textSurfaces);
	const textMuted = ensureContrastAll(seed.textMuted, 4.5, ...textSurfaces);

	const syntaxParamBg = seed.syntaxParamBg;
	const paramSurface = syntaxParamBg
		? bgEditor
		: compositeOver(seed.syntaxValue, dark ? 0.15 : 0.1, bgEditor);
	const syntaxSurfaces = [bgEditor, paramSurface];
	const syntaxKey = ensureContrastAll(seed.syntaxKey, 4.5, ...syntaxSurfaces);
	const syntaxValue = ensureContrastAll(seed.syntaxValue, 4.5, ...syntaxSurfaces);
	const syntaxContent = ensureContrast(seed.syntaxContent ?? textPrimary, bgEditor, 4.5);
	const syntaxHeading = ensureContrast(seed.syntaxHeading ?? textPrimary, bgEditor, 4.5);
	const syntaxMarkerPage = ensureContrast(seed.syntaxMarkerPage, bgEditor, 4.5);
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
	const accentOnSurface = ensureContrastAll(accent, 4.5, ...textSurfaces);
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

	const statusBadgeBg = seed.statusBadgeBg ?? statusError;
	const statusBadgeText = readableOn(
		statusBadgeBg,
		4.5,
		seed.statusBadgeText ?? "#ffffff",
		"#ffffff",
		"#000000",
	);

	const controlBg = bgPrimary;
	const controlBorder = ensureContrastAll(seed.border, 3, controlBg, bgPanel, bgCard);
	const focusRing = ensureContrastAll(
		seed.focusRing ?? ensureContrast(accent, bgPrimary, 3),
		3,
		bgPrimary,
		bgPanel,
		bgCard,
	);
	const focusRingInner = readableOn(focusRing, 3, "#ffffff", textPrimary, "#000000");

	const selectedText = ensureContrast(textPrimary, selectedBg, 4.5);

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

	const schematicMuted = ensureContrastAll(textMuted, 3, ...compositionSurfaces);
	const schematicStrong = ensureContrastAll(textSecondary, 4.5, ...compositionSurfaces);

	const category = (hex: string) => ensureContrastAll(hex, 4.5, bgPanel, bgCard, bgEditor);
	const categoryEngage = category(CATEGORY_SEEDS.categoryEngage);
	const categoryExplain = category(CATEGORY_SEEDS.categoryExplain);
	const categoryPractice = category(CATEGORY_SEEDS.categoryPractice);
	const categoryAssess = category(CATEGORY_SEEDS.categoryAssess);
	const categoryStructure = category(CATEGORY_SEEDS.categoryStructure);

	const toggleTrackBorder = ensureContrastAll(seed.border, 3, bgPrimary, bgPanel);
	const toggleTrackOn = ensureContrastAll(seed.accent, 3, bgPrimary, bgPanel);
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

		toggleTrackBorder,
		toggleTrackOn,
		toggleThumbOn,
	};
}
