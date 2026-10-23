import type {
	FontDisplay,
	FontRoleTypography,
	FontStyle,
	FontWeight,
	HeadingTypography,
	TypographyVariants,
} from "./types.ts";

export interface FontEntry {
	label: string;
	value: string;
	fontsource: string | null;
	group: "Accessibility" | "Sans-serif" | "Serif" | "Monospace";
	/** Exact bundled faces; null selects Fontsource's combined subset stylesheet. */
	faces?: { weights: readonly FontWeight[]; subset: "latin" | null };
}

// Clear uses regular prose, semibold controls, bold prose and ExtraBold headings.
export const CLEAR_FONT_WEIGHTS = [400, 600, 700, 800] as const;

export const FONT_LIST: FontEntry[] = [
	{
		label: "Source Sans 3",
		value: "'Source Sans 3', sans-serif",
		fontsource: "@fontsource/source-sans-3",
		group: "Sans-serif",
	},
	{
		label: "Source Serif 4",
		value: "'Source Serif 4', serif",
		fontsource: "@fontsource/source-serif-4",
		group: "Serif",
	},
	{
		label: "Atkinson Hyperlegible Next",
		value: "'Atkinson Hyperlegible Next', sans-serif",
		fontsource: "@fontsource/atkinson-hyperlegible-next",
		group: "Accessibility",
		// The combined Latin/Latin-ext stylesheet covers French Ÿ.
		faces: { weights: CLEAR_FONT_WEIGHTS, subset: null },
	},
];

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "system-ui"]);
const FONT_DISPLAYS = new Set<FontDisplay>(["auto", "block", "swap", "fallback", "optional"]);
const DEFAULT_FONT = FONT_LIST.find((font) => font.label === "Source Sans 3") as FontEntry;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneRole(role: FontRoleTypography): FontRoleTypography {
	return {
		fontFamily: [...role.fontFamily],
		fontWeight: role.fontWeight,
		fontStyle: role.fontStyle,
	};
}

export function createTypography(bodyFont: string, headingFont: string): TypographyVariants {
	const bodyGeneric = genericFamilyFor(bodyFont);
	const headingGeneric = genericFamilyFor(headingFont);
	return {
		pairing:
			bodyFont === "Atkinson Hyperlegible Next"
				? "clear"
				: headingFont === "Source Serif 4"
					? "book"
					: "sans",
		fontDisplay: "swap",
		code: { fontFamily: ["monospace"] },
		body: { fontFamily: [bodyFont, bodyGeneric], fontWeight: 400, fontStyle: "normal" },
		headings: {
			fontFamily: [headingFont, headingGeneric],
			fontWeight: headingFont === "Atkinson Hyperlegible Next" ? 800 : 600,
			fontStyle: "normal",
		},
	};
}

function genericFamilyFor(label: string): "serif" | "sans-serif" | "monospace" {
	const entry = FONT_LIST.find((font) => font.label === label);
	if (entry?.group === "Serif") return "serif";
	if (entry?.group === "Monospace") return "monospace";
	return "sans-serif";
}

export const DEFAULT_TYPOGRAPHY = createTypography("Source Sans 3", "Source Sans 3");

export function findFontEntry(label: string): FontEntry | undefined {
	return FONT_LIST.find((font) => font.label === label);
}

export function getFontEntry(label: string): FontEntry {
	return findFontEntry(label) ?? DEFAULT_FONT;
}

export function normalizeFontFamilyList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	const families = value
		.filter((family): family is string => typeof family === "string")
		.map((family) => family.trim())
		.map((family) => (family === "Atkinson Hyperlegible" ? "Atkinson Hyperlegible Next" : family))
		.filter((family) => GENERIC_FAMILIES.has(family) || findFontEntry(family))
		.filter((family, index, all) => all.indexOf(family) === index)
		.slice(0, 4);
	return families.length > 0 ? families : [...fallback];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function mergeTypography(
	base: unknown,
	override: unknown,
): Record<string, unknown> | undefined {
	const baseTypography = asRecord(base);
	const overrideTypography = asRecord(override);
	if (Object.keys(baseTypography).length === 0 && Object.keys(overrideTypography).length === 0) {
		return undefined;
	}
	const baseHeadings = asRecord(baseTypography.headings);
	const overrideHeadings = asRecord(overrideTypography.headings);
	const headings: Record<string, unknown> = { ...baseHeadings, ...overrideHeadings };
	for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
		if (baseHeadings[level] || overrideHeadings[level]) {
			headings[level] = { ...asRecord(baseHeadings[level]), ...asRecord(overrideHeadings[level]) };
		}
	}
	return {
		...baseTypography,
		...overrideTypography,
		body: { ...asRecord(baseTypography.body), ...asRecord(overrideTypography.body) },
		headings,
	};
}

export function normalizeTypography(
	value: unknown,
	fallback: TypographyVariants = DEFAULT_TYPOGRAPHY,
): TypographyVariants {
	const raw = isRecord(value) ? value : {};
	const body = isRecord(raw.body) ? raw.body : {};
	const families = normalizeFontFamilyList(body.fontFamily, []);
	// The owner chose Sans even for saved courses containing the old serif default.
	// Only legacy Atkinson carries a pairing choice when there is no persisted id.
	const id =
		raw.pairing === "book" || raw.pairing === "clear" || raw.pairing === "sans"
			? raw.pairing
			: raw.pairing === undefined && families[0] === "Atkinson Hyperlegible Next"
				? "clear"
				: "sans";
	const pairing =
		id === "clear"
			? createTypography("Atkinson Hyperlegible Next", "Atkinson Hyperlegible Next")
			: createTypography("Source Sans 3", id === "book" ? "Source Serif 4" : "Source Sans 3");
	pairing.fontDisplay = FONT_DISPLAYS.has(raw.fontDisplay as FontDisplay)
		? (raw.fontDisplay as FontDisplay)
		: fallback.fontDisplay;
	return pairing;
}

export interface TypographyWarning {
	code: "ignored-font-setting";
	path: string;
	pairing: NonNullable<TypographyVariants["pairing"]>;
}

export type DesignSettingWarning =
	| TypographyWarning
	| {
			code: "ignored-radius-setting";
			path: "design.borderRadius";
	  };

/** Report authored settings before look v2 normalization supersedes them. */
export function getDesignSettingWarnings(
	design: unknown,
	resolved?: TypographyVariants,
): DesignSettingWarning[] {
	if (!isRecord(design)) return [];
	const warnings: DesignSettingWarning[] = getTypographyWarnings(design.typography, resolved);
	if (Object.hasOwn(design, "borderRadius"))
		warnings.push({ code: "ignored-radius-setting", path: "design.borderRadius" });
	return warnings;
}

/** Inspect authored settings before normalization discards retired font choices. */
export function getTypographyWarnings(
	value: unknown,
	resolved = normalizeTypography(value),
): TypographyWarning[] {
	if (!isRecord(value)) return [];
	const warnings: TypographyWarning[] = [];
	const checkRole = (raw: unknown, role: Partial<FontRoleTypography>, path: string) => {
		if (!isRecord(raw)) return;
		for (const key of ["fontFamily", "fontWeight", "fontStyle"] as const) {
			if (!Object.hasOwn(raw, key)) continue;
			const authored = raw[key];
			const matches =
				key === "fontFamily"
					? Array.isArray(authored) &&
						authored.length > 0 &&
						authored.every(
							(family, index) =>
								typeof family === "string" &&
								normalizeFontFamilyList([family], [family.trim()])[0] === role.fontFamily?.[index],
						)
					: authored === role[key] ||
						// Saved Clear headings used 600 before the Next migration.
						(key === "fontWeight" &&
							resolved.pairing === "clear" &&
							authored === 600 &&
							role.fontWeight === 800);
			if (!matches)
				warnings.push({
					code: "ignored-font-setting",
					path: `${path}.${key}`,
					pairing: resolved.pairing ?? "sans",
				});
		}
	};
	checkRole(value.body, resolved.body, "design.typography.body");
	checkRole(value.headings, resolved.headings, "design.typography.headings");
	if (isRecord(value.headings))
		for (const level of [1, 2, 3, 4, 5, 6] as const)
			checkRole(
				value.headings[`h${level}`],
				resolveHeadingTypography(resolved, level),
				`design.typography.headings.h${level}`,
			);
	checkRole(
		value.code,
		{ ...resolved.code, fontWeight: 400, fontStyle: "normal" },
		"design.typography.code",
	);
	return warnings;
}

export function resolveHeadingTypography(
	typography: TypographyVariants,
	level: 1 | 2 | 3 | 4 | 5 | 6,
): FontRoleTypography {
	const override = typography.headings[`h${level}`];
	return {
		...cloneRole(typography.headings),
		...override,
		fontFamily: [...(override?.fontFamily ?? typography.headings.fontFamily)],
	};
}

export function fontFamilyListToCss(families: string[]): string {
	const values = families.flatMap((family) => {
		if (GENERIC_FAMILIES.has(family)) return [family];
		const entry = findFontEntry(family);
		return entry ? [entry.value.split(",")[0].trim()] : [];
	});
	if (!values.some((family) => GENERIC_FAMILIES.has(family))) {
		const first = families.map(findFontEntry).find(Boolean);
		values.push(
			first?.group === "Serif"
				? "serif"
				: first?.group === "Monospace"
					? "monospace"
					: "sans-serif",
		);
	}
	return values.join(", ");
}

export function typographyToCssVariables(typography: TypographyVariants): Record<string, string> {
	const variables: Record<string, string> = {
		"--praxity-font-family": fontFamilyListToCss(typography.body.fontFamily),
		"--praxity-font-weight-body": String(typography.body.fontWeight),
		"--praxity-font-style-body": typography.body.fontStyle,
		"--praxity-font-heading": fontFamilyListToCss(typography.headings.fontFamily),
		"--praxity-font-weight-heading": String(typography.headings.fontWeight),
		"--praxity-font-style-heading": typography.headings.fontStyle,
	};
	if (typography.code && typography.code.fontFamily[0] !== "monospace") {
		variables["--praxity-font-code"] = fontFamilyListToCss(typography.code.fontFamily);
	}

	for (const level of [1, 2, 3, 4, 5, 6] as const) {
		const role = resolveHeadingTypography(typography, level);
		variables[`--praxity-font-family-h${level}`] = fontFamilyListToCss(role.fontFamily);
		variables[`--praxity-font-weight-h${level}`] = String(role.fontWeight);
		variables[`--praxity-font-style-h${level}`] = role.fontStyle;
	}
	return variables;
}

export interface FontFaceRequest {
	entry: FontEntry;
	weights: FontWeight[];
	styles: FontStyle[];
}

export function collectTypographyFontFaces(typography: TypographyVariants): FontFaceRequest[] {
	const requests = new Map<
		string,
		{ entry: FontEntry; weights: Set<FontWeight>; styles: Set<FontStyle> }
	>();
	const addRole = (role: FontRoleTypography) => {
		for (const family of role.fontFamily) {
			const entry = findFontEntry(family);
			if (!entry?.fontsource) continue;
			const request = requests.get(entry.label) ?? {
				entry,
				weights: new Set<FontWeight>(),
				styles: new Set<FontStyle>(),
			};
			request.weights.add(role.fontWeight);
			request.styles.add(role.fontStyle);
			requests.set(entry.label, request);
		}
	};
	addRole(typography.body);
	addRole({ ...typography.body, fontWeight: typography.headings.fontWeight });
	if (typography.pairing === "clear") {
		// Authored emphasis can occur in prose, control labels and headings.
		for (const fontWeight of CLEAR_FONT_WEIGHTS)
			addRole({ ...typography.body, fontWeight, fontStyle: "italic" });
	}
	if (typography.code) addRole({ ...typography.code, fontWeight: 400, fontStyle: "normal" });
	for (const level of [1, 2, 3, 4, 5, 6] as const)
		addRole(resolveHeadingTypography(typography, level));
	return [...requests.values()].map(({ entry, weights, styles }) => ({
		entry,
		weights: [...weights].sort(),
		styles: [...styles].sort((a, b) => Number(a === "italic") - Number(b === "italic")),
	}));
}

export function getFontSelectData(): {
	group: string;
	items: { label: string; value: string }[];
}[] {
	const groups = new Map<string, { label: string; value: string }[]>();
	for (const font of FONT_LIST) {
		if (!groups.has(font.group)) groups.set(font.group, []);
		groups.get(font.group)?.push({ label: font.label, value: font.label });
	}
	return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
}
