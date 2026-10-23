import { ayuLightTheme } from "./ayu-light";
import { ayuMirageTheme } from "./ayu-mirage";
import { catppuccinLatteTheme } from "./catppuccin-latte";
import { catppuccinMochaTheme } from "./catppuccin-mocha";
import { defaultDarkTheme } from "./default-dark";
import { defaultLightTheme } from "./default-light";
import { draculaTheme } from "./dracula";
import { everforestDarkTheme } from "./everforest-dark";
import { everforestLightTheme } from "./everforest-light";
import { githubDarkColorblindTheme } from "./github-dark-colorblind";
import { githubDarkDimmedTheme } from "./github-dark-dimmed";
import { githubLightTheme } from "./github-light";
import { githubLightColorblindTheme } from "./github-light-colorblind";
import { gothamTheme } from "./gotham";
import { gruvboxDarkTheme } from "./gruvbox-dark";
import { gruvboxLightTheme } from "./gruvbox-light";
import { kanagawaLotusTheme } from "./kanagawa-lotus";
import { kanagawaWaveTheme } from "./kanagawa-wave";
import { monokaiTheme } from "./monokai";
import { nordTheme } from "./nord";
import { nordLightTheme } from "./nord-light";
import { oneDarkTheme } from "./one-dark";
import { oneLightTheme } from "./one-light";
import { rosePineTheme } from "./rose-pine";
import { rosePineDawnTheme } from "./rose-pine-dawn";
import { solarizedDarkTheme } from "./solarized-dark";
import { solarizedLightTheme } from "./solarized-light";
import { tokyoNightTheme } from "./tokyo-night";
import { tokyoNightLightTheme } from "./tokyo-night-light";
import type { EditorTheme, ThemeAppearancePreference } from "./types";

export const allThemes: EditorTheme[] = [
	defaultLightTheme,
	defaultDarkTheme,
	githubLightTheme,
	githubDarkDimmedTheme,
	githubLightColorblindTheme,
	githubDarkColorblindTheme,
	draculaTheme,
	monokaiTheme,
	nordLightTheme,
	nordTheme,
	catppuccinLatteTheme,
	catppuccinMochaTheme,
	solarizedLightTheme,
	solarizedDarkTheme,
	rosePineDawnTheme,
	rosePineTheme,
	kanagawaLotusTheme,
	kanagawaWaveTheme,
	ayuLightTheme,
	ayuMirageTheme,
	tokyoNightLightTheme,
	tokyoNightTheme,
	gruvboxLightTheme,
	gruvboxDarkTheme,
	oneLightTheme,
	oneDarkTheme,
	everforestLightTheme,
	everforestDarkTheme,
	gothamTheme,
];

export interface ThemeFamily {
	id: string;
	name: string;
	variants: EditorTheme[];
	hasLight: boolean;
	hasDark: boolean;
}

const familyOrder = [
	// The app's own theme leads the grid; it used to sort last, below Gotham,
	// which read as "Default is missing" to anyone who did not scroll.
	"default",
	"github",
	"github-colorblind",
	"dracula",
	"monokai",
	"nord",
	"catppuccin",
	"solarized",
	"rose-pine",
	"kanagawa",
	"ayu",
	"tokyo-night",
	"gruvbox",
	"one",
	"everforest",
	"gotham",
] as const;

const familyLabelMap: Record<string, string> = {
	default: "Default",
	github: "GitHub",
	"github-colorblind": "GitHub Colorblind",
	dracula: "Dracula",
	monokai: "Monokai",
	nord: "Nord",
	catppuccin: "Catppuccin",
	solarized: "Solarized",
	"rose-pine": "Rose Pine",
	kanagawa: "Kanagawa",
	ayu: "Ayu",
	"tokyo-night": "Tokyo Night",
	gruvbox: "Gruvbox",
	one: "One",
	everforest: "Everforest",
	gotham: "Gotham",
};

function buildFamilies(): ThemeFamily[] {
	const map = new Map<string, ThemeFamily>();
	for (const theme of allThemes) {
		const family = map.get(theme.family) ?? {
			id: theme.family,
			name: familyLabelMap[theme.family] ?? theme.name,
			variants: [],
			hasLight: false,
			hasDark: false,
		};
		family.variants.push(theme);
		if (theme.appearance === "light") {
			family.hasLight = true;
		} else {
			family.hasDark = true;
		}
		map.set(theme.family, family);
	}

	for (const family of map.values()) {
		family.variants.sort(
			(a, b) => (a.appearance === "light" ? -1 : 1) - (b.appearance === "light" ? -1 : 1),
		);
	}

	return [...map.values()].sort((a, b) => {
		const ai = familyOrder.indexOf(a.id as (typeof familyOrder)[number]);
		const bi = familyOrder.indexOf(b.id as (typeof familyOrder)[number]);
		const aIndex = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
		const bIndex = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
		return aIndex - bIndex;
	});
}

export const themeFamilies = buildFamilies();

const familyById = new Map(themeFamilies.map((family) => [family.id, family]));

export function getThemeFamily(familyId: string): ThemeFamily | undefined {
	return familyById.get(familyId);
}

export function filterThemeFamilies(filter: "all" | "light" | "dark"): ThemeFamily[] {
	if (filter === "all") {
		return themeFamilies;
	}
	return themeFamilies.filter((family) => (filter === "light" ? family.hasLight : family.hasDark));
}

export function resolveTheme(
	familyId: string,
	appearance: ThemeAppearancePreference,
	prefersDark: boolean,
): EditorTheme {
	const fallbackFamily = familyById.get("default") ?? themeFamilies[0];
	const family = familyById.get(familyId) ?? fallbackFamily;
	if (!family) {
		return defaultLightTheme;
	}

	const resolvedAppearance =
		appearance === "system" ? (prefersDark ? "dark" : "light") : appearance;
	const directMatch = family.variants.find((variant) => variant.appearance === resolvedAppearance);
	if (directMatch) {
		return directMatch;
	}

	return family.variants[0] ?? defaultLightTheme;
}

export interface ThemePreviewColors {
	bgPrimary: string;
	textPrimary: string;
	textSecondary: string;
	accent: string;
	syntaxHeading: string;
	syntaxValue: string;
	border: string;
}

function pickPreviewColors(theme: EditorTheme): ThemePreviewColors {
	return {
		bgPrimary: theme.colors.bgPrimary,
		textPrimary: theme.colors.textPrimary,
		textSecondary: theme.colors.textSecondary,
		accent: theme.colors.accent,
		syntaxHeading: theme.colors.syntaxHeading,
		syntaxValue: theme.colors.syntaxValue,
		border: theme.colors.border,
	};
}

export function getFamilyPreviewColors(familyId: string): {
	light: ThemePreviewColors | null;
	dark: ThemePreviewColors | null;
} {
	const family = getThemeFamily(familyId);
	if (!family) {
		return { light: null, dark: null };
	}
	const light = family.variants.find((v) => v.appearance === "light");
	const dark = family.variants.find((v) => v.appearance === "dark");
	return {
		light: light ? pickPreviewColors(light) : null,
		dark: dark ? pickPreviewColors(dark) : null,
	};
}
