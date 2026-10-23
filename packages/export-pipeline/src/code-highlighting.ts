import {
	DARK_THEME,
	LIGHT_THEME,
	prismLanguageName,
} from "@praxity/shared-blocks/code-highlighting";
import {
	normalizeTokens,
	Prism,
	type PrismTheme,
	type PrismThemeEntry,
} from "prism-react-renderer";

function themeDictionary(theme: PrismTheme, language: string): Record<string, PrismThemeEntry> {
	return theme.styles.reduce<Record<string, PrismThemeEntry>>((result, entry) => {
		if (entry.languages && !entry.languages.includes(language)) return result;
		for (const type of entry.types) result[type] = { ...result[type], ...entry.style };
		return result;
	}, {});
}

export interface HighlightedCodeToken {
	content: string;
	types: string[];
	light: PrismThemeEntry;
	dark: PrismThemeEntry;
}

export function codeTokenCss(token: HighlightedCodeToken): string {
	const declarations: string[] = [];
	for (const [mode, style] of [
		["light", token.light],
		["dark", token.dark],
	] as const) {
		if (style.color) declarations.push(`--praxity-code-token-${mode}-color:${style.color}`);
		if (style.fontStyle) declarations.push(`--praxity-code-token-${mode}-style:${style.fontStyle}`);
		if (style.fontWeight)
			declarations.push(`--praxity-code-token-${mode}-weight:${style.fontWeight}`);
		if (style.textDecorationLine)
			declarations.push(`--praxity-code-token-${mode}-decoration:${style.textDecorationLine}`);
		if (style.opacity !== undefined)
			declarations.push(`--praxity-code-token-${mode}-opacity:${style.opacity}`);
	}
	return declarations.join(";");
}

export function highlightCode(code: string, language: string): HighlightedCodeToken[][] {
	const prismLanguage = prismLanguageName(language);
	const grammar = Prism.languages[prismLanguage];
	if (!grammar) return [[{ content: code, types: ["plain"], light: {}, dark: {} }]];
	const lightTheme = themeDictionary(LIGHT_THEME, prismLanguage);
	const darkTheme = themeDictionary(DARK_THEME, prismLanguage);
	return normalizeTokens(Prism.tokenize(code, grammar)).map((line) =>
		line.map((token) => ({
			// Prism inserts a newline placeholder for empty rows. The row itself
			// supplies visual height; Copy must read only authored characters.
			content: token.empty ? "" : token.content,
			types: token.types,
			light: Object.assign({}, ...token.types.map((type) => lightTheme[type])),
			dark: Object.assign({}, ...token.types.map((type) => darkTheme[type])),
		})),
	);
}
