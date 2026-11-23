export type ResolvedAppearance = "light" | "dark";
export type ThemeAppearancePreference = "system" | ResolvedAppearance;

export interface ThemeColors {
	bgPrimary: string;
	bgSecondary: string;
	bgTertiary: string;
	bgEditor: string;
	bgPanel: string;
	bgHover: string;
	bgActive: string;
	bgCard: string;
	textPrimary: string;
	textSecondary: string;
	textMuted: string;
	border: string;
	borderSubtle: string;
	accent: string;
	accentHover: string;
	accentText: string;
	syntaxKey: string;
	syntaxValue: string;
	syntaxMarkerPage: string;
	syntaxMarkerSection: string;
	syntaxMarkerCorrect: string;
	syntaxContent: string;
	syntaxHeading: string;
	syntaxParamBg: string;
	syntaxInstructor: string;
	syntaxInstructorBg: string;
	gutterIcon: string;
	statusBarBg: string;
	statusBarText: string;
	statusBarBorder: string;
	topBarBg: string;
	topBarBorder: string;
	activityBarBg: string;
	activityBarIcon: string;
	activityBarIconActive: string;
	activityBarActiveBg: string;
	activityBarHoverBg: string;
	activityBarDivider: string;
	welcomeBg: string;
	welcomeCardBg: string;
	welcomeCardBorder: string;
	welcomeCardHover: string;
	resizeHandle: string;
	resizeHandleHover: string;
	resizeHandleActive: string;
	statusSaved: string;
	statusWarning: string;
	statusError: string;
	statusBadgeBg: string;
	statusBadgeText: string;
	statusDense: string;
	focusRing: string;

	focusRingInner: string;
	accentOnSurface: string;
	controlBg: string;
	controlBorder: string;
	selectedBg: string;
	selectedText: string;

	severityCriticalSurface: string;
	severityCriticalBorder: string;
	severityCriticalText: string;
	severityCriticalBadgeBg: string;
	severityCriticalBadgeText: string;
	severityWarningSurface: string;
	severityWarningBorder: string;
	severityWarningText: string;
	severityWarningBadgeBg: string;
	severityWarningBadgeText: string;
	severityInfoSurface: string;
	severityInfoBorder: string;
	severityInfoText: string;
	severityInfoBadgeBg: string;
	severityInfoBadgeText: string;

	schematicMuted: string;
	schematicStrong: string;

	compositionTintEngage: string;
	compositionTintExplain: string;
	compositionTintPractice: string;
	compositionTintAssess: string;
	compositionTintStructure: string;

	categoryEngage: string;
	categoryExplain: string;
	categoryPractice: string;
	categoryAssess: string;
	categoryStructure: string;
	toggleTrackBorder: string;
	toggleTrackOn: string;
	toggleThumbOn: string;
}

export interface EditorTheme {
	id: string;
	name: string;
	appearance: ResolvedAppearance;
	family: string;
	colors: ThemeColors;
}

export const THEME_TOKEN_KEYS = [
	"bgPrimary",
	"bgSecondary",
	"bgTertiary",
	"bgEditor",
	"bgPanel",
	"bgHover",
	"bgActive",
	"bgCard",
	"textPrimary",
	"textSecondary",
	"textMuted",
	"border",
	"borderSubtle",
	"accent",
	"accentHover",
	"accentText",
	"syntaxKey",
	"syntaxValue",
	"syntaxMarkerPage",
	"syntaxMarkerSection",
	"syntaxMarkerCorrect",
	"syntaxContent",
	"syntaxHeading",
	"syntaxParamBg",
	"syntaxInstructor",
	"syntaxInstructorBg",
	"gutterIcon",
	"statusBarBg",
	"statusBarText",
	"statusBarBorder",
	"topBarBg",
	"topBarBorder",
	"activityBarBg",
	"activityBarIcon",
	"activityBarIconActive",
	"activityBarActiveBg",
	"activityBarHoverBg",
	"activityBarDivider",
	"welcomeBg",
	"welcomeCardBg",
	"welcomeCardBorder",
	"welcomeCardHover",
	"resizeHandle",
	"resizeHandleHover",
	"resizeHandleActive",
	"statusSaved",
	"statusWarning",
	"statusError",
	"statusBadgeBg",
	"statusBadgeText",
	"statusDense",
	"focusRing",
	"focusRingInner",
	"accentOnSurface",
	"controlBg",
	"controlBorder",
	"selectedBg",
	"selectedText",
	"severityCriticalSurface",
	"severityCriticalBorder",
	"severityCriticalText",
	"severityCriticalBadgeBg",
	"severityCriticalBadgeText",
	"severityWarningSurface",
	"severityWarningBorder",
	"severityWarningText",
	"severityWarningBadgeBg",
	"severityWarningBadgeText",
	"severityInfoSurface",
	"severityInfoBorder",
	"severityInfoText",
	"severityInfoBadgeBg",
	"severityInfoBadgeText",
	"schematicMuted",
	"schematicStrong",
	"compositionTintEngage",
	"compositionTintExplain",
	"compositionTintPractice",
	"compositionTintAssess",
	"compositionTintStructure",
	"categoryEngage",
	"categoryExplain",
	"categoryPractice",
	"categoryAssess",
	"categoryStructure",
	"toggleTrackBorder",
	"toggleTrackOn",
	"toggleThumbOn",
] as const satisfies readonly (keyof ThemeColors)[];
