import {
	DEFAULT_TYPOGRAPHY,
	type DesignVariants,
	migrateCoursePresetDesign,
	normalizeTypography,
	resolveCoursePresetId,
	typographyToCssVariables,
} from "@praxity/grammar";
import {
	colorToHex,
	contrastRatio,
	ensureContrast,
	ensureContrastAll,
	hexToOklch,
	oklchToHexGamutMapped,
	pickReadableForeground,
} from "../color-math";
import { READING_PALETTES } from "./reading-palettes";

const NORMAL_TEXT_RATIO = 4.5;
const NON_TEXT_RATIO = 3;
const SYNTAX_CHROMA_MIN = 0.1;
const SYNTAX_CHROMA_MAX = 0.115;
const SYNTAX_SIMILAR_HUE_DEGREES = 45;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const DESIGN_TOKEN_DEFAULTS = {
	colorBackgroundLight: READING_PALETTES.ink.light.colorBackground,
	colorBackgroundDark: READING_PALETTES.ink.dark.colorBackground,
	colorText: READING_PALETTES.ink.light.colorText,
	colorAccent: READING_PALETTES.ink.light.colorAccent,
	colorButtonBackground: READING_PALETTES.ink.light.colorButtonBackground,
	colorButtonText: READING_PALETTES.ink.light.colorButtonText,
	colorSuccess: READING_PALETTES.ink.light.colorSuccess,
	colorError: READING_PALETTES.ink.light.colorError,
	colorWarning: READING_PALETTES.ink.light.colorWarning,
	highlightStyle: "none",
} as const;

const DEFAULTS = DESIGN_TOKEN_DEFAULTS;

function asRecord(value: DesignVariants): Record<string, unknown> {
	return value as unknown as Record<string, unknown>;
}

function asHexColor(value: unknown): string | undefined {
	return typeof value === "string" ? (colorToHex(value) ?? undefined) : undefined;
}

function asHex(value: string | undefined): string | undefined {
	return value && HEX_PATTERN.test(value) ? value : undefined;
}

function parseHexToRgb(hex: string): [number, number, number] | null {
	const cleaned = hex.replace("#", "");
	if (cleaned.length !== 6) return null;

	return [
		Number.parseInt(cleaned.slice(0, 2), 16),
		Number.parseInt(cleaned.slice(2, 4), 16),
		Number.parseInt(cleaned.slice(4, 6), 16),
	];
}

function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
	return `#${[clamp(r), clamp(g), clamp(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function blendWithAlpha(fgHex: string, bgHex: string, alpha: number): string {
	const fg = parseHexToRgb(fgHex);
	const bg = parseHexToRgb(bgHex);
	if (!fg || !bg) return fgHex;

	return rgbToHex(
		fg[0] * alpha + bg[0] * (1 - alpha),
		fg[1] * alpha + bg[1] * (1 - alpha),
		fg[2] * alpha + bg[2] * (1 - alpha),
	);
}

function correctRole(values: Record<string, string>, key: string, surfaces: string[]): void {
	const color = asHex(values[key]);
	if (color) values[key] = ensureContrastAll(color, NORMAL_TEXT_RATIO, ...surfaces);
}

function deriveTextRole(values: Record<string, string>, key: string, surfaces: string[]): void {
	const color = asHex(values[key]);
	if (color) values[`${key}-text`] = ensureContrastAll(color, NORMAL_TEXT_RATIO, ...surfaces);
}

/** Apply the learner-facing contrast floor used by published output. */
export function enforceDesignTokenContrast(
	cssVars: Record<string, string>,
): Record<string, string> {
	const corrected = { ...cssVars };
	const background =
		asHex(corrected["--praxity-color-background"]) ?? DEFAULTS.colorBackgroundLight;
	const surfaces = [
		background,
		asHex(corrected["--praxity-color-surface"]),
		asHex(corrected["--praxity-color-navigation-surface"]),
		asHex(corrected["--praxity-color-background-alt"]),
		...Object.entries(corrected)
			.filter(([key]) => key.startsWith("--praxity-color-callout-") && /-(?:low|high)$/.test(key))
			.map(([, value]) => asHex(value)),
	].filter((surface): surface is string => Boolean(surface));
	const accentLight = asHex(corrected["--praxity-color-accent-light"]);
	const accent = asHex(corrected["--praxity-color-accent"]);
	if (accent) {
		corrected["--praxity-color-accent-foreground"] = pickReadableForeground(
			accent,
			"#ffffff",
			"#000000",
		);
	}

	for (const key of [
		"--praxity-color-text",
		"--praxity-color-text-light",
		"--praxity-color-text-muted",
	]) {
		correctRole(corrected, key, surfaces);
	}
	for (const key of [
		"--praxity-color-accent",
		"--praxity-color-success",
		"--praxity-color-error",
		"--praxity-color-warning",
		"--praxity-color-secondary",
		"--praxity-color-tertiary",
	]) {
		deriveTextRole(
			corrected,
			key,
			key === "--praxity-color-accent" && accentLight ? [...surfaces, accentLight] : surfaces,
		);
	}
	for (const role of ["success", "error", "warning"]) {
		const legacy = asHex(corrected[`--praxity-color-${role}`]);
		for (const [mode, modeBackground] of [
			["light", asHex(corrected["--praxity-color-background-light"]) ?? background],
			["dark", asHex(corrected["--praxity-color-background-dark"]) ?? background],
		] as const) {
			const key = `--praxity-color-${role}-on-${mode}`;
			const seed = asHex(corrected[key]) ?? legacy;
			if (seed) corrected[key] = ensureContrast(seed, modeBackground, NORMAL_TEXT_RATIO);
		}
	}

	const text = asHex(corrected["--praxity-color-text"]) ?? "#1f2900";
	const activitySurface =
		asHex(corrected["--praxity-color-activity-surface"]) ??
		asHex(corrected["--praxity-color-surface"]) ??
		background;
	const activityBorder =
		asHex(corrected["--praxity-color-activity-border"]) ??
		asHex(corrected["--praxity-color-border"]) ??
		text;
	corrected["--praxity-color-activity-surface"] = activitySurface;
	corrected["--praxity-color-activity-border"] = ensureContrastAll(
		activityBorder,
		NON_TEXT_RATIO,
		background,
		activitySurface,
	);
	const controlBorder = asHex(corrected["--praxity-color-control-border"]);
	if (controlBorder) {
		corrected["--praxity-color-control-border"] = ensureContrastAll(
			controlBorder,
			NON_TEXT_RATIO,
			...surfaces,
			activitySurface,
		);
	}

	const focus = asHex(corrected["--praxity-color-focus"]);
	if (focus) {
		// Rings also appear inside activities and on selected/hovered controls.
		const correctedFocus = ensureContrastAll(
			focus,
			NON_TEXT_RATIO,
			...surfaces,
			activitySurface,
			...["accent", "secondary", "tertiary", "success", "error", "warning"]
				.map((role) => asHex(corrected[`--praxity-color-${role}-light`]))
				.filter((surface): surface is string => Boolean(surface)),
		);
		corrected["--praxity-color-focus"] = correctedFocus;
		corrected["--praxity-color-focus-text"] = pickReadableForeground(
			correctedFocus,
			"#ffffff",
			"#000000",
		);
	}

	const mutedText = asHex(corrected["--praxity-color-text-muted"]);
	if (mutedText) corrected["--mantine-color-dimmed"] = mutedText;

	const buttonBackground = asHex(corrected["--praxity-color-button-background"]);
	const buttonText = asHex(corrected["--praxity-color-button-text"]);
	if (buttonBackground && buttonText) {
		corrected["--praxity-color-button-text"] =
			contrastRatio(buttonText, buttonBackground) >= NORMAL_TEXT_RATIO
				? buttonText
				: pickReadableForeground(buttonBackground, "#ffffff", "#000000");
		corrected["--praxity-color-button-outline"] = ensureContrastAll(
			asHex(corrected["--praxity-color-button-outline"]) ?? buttonBackground,
			NON_TEXT_RATIO,
			...surfaces,
		);
	}

	return corrected;
}

/** Resolve normalized design variants to the complete published CSS token record. */
export function resolveDesignTokens(
	variants: DesignVariants,
	effectiveMode: "light" | "dark",
): Record<string, string> {
	const design = migrateCoursePresetDesign(asRecord(variants));
	const id = resolveCoursePresetId(design.palette);
	const preset = READING_PALETTES[id];
	const active = preset[effectiveMode];
	const paper =
		asHexColor(
			effectiveMode === "dark" ? design.colorBackgroundDark : design.colorBackgroundLight,
		) ??
		(effectiveMode === (design.colorMode === "dark" ? "dark" : "light")
			? asHexColor(design.colorBackground)
			: undefined) ??
		active.colorBackground;
	const surface =
		paper.toLowerCase() === active.colorBackground.toLowerCase() ? active.colorSurface : paper;
	const seed = (
		key: "colorText" | "colorAccent" | "colorSuccess" | "colorError" | "colorWarning",
	) => {
		const authored = asHexColor(design[key]);
		return !authored || authored.toLowerCase() === preset.light[key].toLowerCase()
			? active[key]
			: authored;
	};
	const ink = ensureContrastAll(seed("colorText"), 12, paper, surface);
	const ink2 = ensureContrastAll(active.colorTextMuted, 7, paper, surface);
	const line = ensureContrast(active.colorBorder, paper, 3);
	const accent = ensureContrastAll(seed("colorAccent"), id === "clay" ? 6 : 4.5, paper, surface);
	const onAccent = pickReadableForeground(accent, "#ffffff", "#121417");
	const accentSoft = blendWithAlpha(accent, paper, 0.08);
	const statuses = Object.fromEntries(
		(["Success", "Error", "Warning"] as const).map((role) => {
			const override = asHexColor(
				design[`color${role}On${effectiveMode === "dark" ? "Dark" : "Light"}`],
			);
			return [
				role.toLowerCase(),
				ensureContrastAll(override ?? seed(`color${role}`), 4.5, paper, surface),
			];
		}),
	);
	const accentHue = hexToOklch(accent)[2];
	const successHue = hexToOklch(statuses.success)[2];
	const hueGap = Math.abs(accentHue - successHue);
	const stringInk =
		Math.min(hueGap, 360 - hueGap) <= SYNTAX_SIMILAR_HUE_DEGREES
			? statuses.warning
			: statuses.success;
	const syntaxInk = (source: string) => {
		const [, chroma, hue] = hexToOklch(source);
		// Pale dark-mode status inks need more chroma to separate syntax roles.
		// Cap below 0.12 to leave room for sRGB rounding; keep the source hue.
		const muted = oklchToHexGamutMapped(
			effectiveMode === "dark" ? 0.75 : 0.5,
			Math.min(SYNTAX_CHROMA_MAX, Math.max(SYNTAX_CHROMA_MIN, chroma)),
			hue,
		);
		return ensureContrast(muted, surface, NORMAL_TEXT_RATIO);
	};
	const typography = normalizeTypography(design.typography, DEFAULT_TYPOGRAPHY);
	const values: Record<string, string> = {
		"--paper": paper,
		"--paper-2": surface,
		"--ink": ink,
		"--ink-2": ink2,
		"--line": line,
		"--line-mid": blendWithAlpha(line, paper, 0.35),
		"--rule": blendWithAlpha(line, paper, 0.18),
		"--accent": accent,
		"--accent-soft": accentSoft,
		"--accent-ink": ensureContrast(accent, accentSoft, NORMAL_TEXT_RATIO),
		"--shadow-card":
			effectiveMode === "dark"
				? "none"
				: "0 1px 2px rgb(22 24 29 / .05), 0 16px 40px -20px rgb(22 34 70 / .28)",
		"--on-accent": onAccent,
		"--syntax-keyword": syntaxInk(accent),
		"--syntax-string": syntaxInk(stringInk),
		"--syntax-comment": ink2,
		"--syntax-function": ink,
		"--praxity-color-background": paper,
		"--praxity-color-background-alt": surface,
		"--praxity-color-surface": surface,
		"--praxity-color-navigation-surface": paper,
		"--praxity-color-activity-surface": paper,
		"--praxity-color-activity-border": line,
		"--praxity-color-background-light":
			asHexColor(design.colorBackgroundLight) ?? preset.light.colorBackground,
		"--praxity-color-background-dark":
			asHexColor(design.colorBackgroundDark) ?? preset.dark.colorBackground,
		"--praxity-color-text": ink,
		"--praxity-color-text-light": ink2,
		"--praxity-color-text-muted": ink2,
		"--praxity-color-border": line,
		"--praxity-color-control-border": ensureContrastAll(line, NON_TEXT_RATIO, paper, surface),
		"--praxity-color-accent": accent,
		"--praxity-color-accent-text": accent,
		"--praxity-color-accent-foreground": onAccent,
		"--praxity-color-accent-light": paper,
		"--praxity-color-focus": accent,
		"--praxity-color-focus-text": onAccent,
		"--praxity-color-button-background": accent,
		"--praxity-color-button-text": onAccent,
		"--praxity-color-button-outline": accent,
		"--praxity-color-link": accent,
		"--praxity-color-heading": ink,
		"--praxity-color-list-marker": ink,
		"--praxity-link-underline-color": "currentColor",
		"--praxity-container-border-width": "1px",
		"--praxity-background-texture": "none",
		"--praxity-divider-style": "none",
		"--praxity-highlight-style":
			typeof design.highlightStyle === "string" ? design.highlightStyle : "none",
		"--praxity-color-secondary": accent,
		"--praxity-color-secondary-text": accent,
		"--praxity-color-secondary-light": paper,
		"--praxity-color-tertiary": accent,
		"--praxity-color-tertiary-text": accent,
		"--praxity-color-tertiary-light": paper,
		"--mantine-color-dimmed": ink2,
		...typographyToCssVariables(typography),
	};
	for (const role of ["success", "error", "warning"] as const) {
		const status = statuses[role];
		const tint = blendWithAlpha(status, paper, 0.1);
		values[`--${role}-ink`] = status;
		values[`--${role}-tint`] = tint;
		values[`--praxity-color-${role}`] = status;
		values[`--praxity-color-${role}-text`] = status;
		values[`--praxity-color-${role}-light`] = tint;
		for (const mode of ["light", "dark"] as const) {
			const key =
				`color${role === "success" ? "Success" : role === "error" ? "Error" : "Warning"}` as const;
			const override = asHexColor(design[`${key}On${mode === "dark" ? "Dark" : "Light"}`]);
			const background = values[`--praxity-color-background-${mode}`];
			values[`--praxity-color-${role}-on-${mode}`] =
				mode === effectiveMode
					? status
					: ensureContrast(override ?? preset[mode][key], background, 4.5);
		}
	}
	for (const tone of ["note", "info", "tip", "warning", "success"])
		for (const level of ["low", "high"]) values[`--praxity-color-callout-${tone}-${level}`] = paper;
	return values;
}
