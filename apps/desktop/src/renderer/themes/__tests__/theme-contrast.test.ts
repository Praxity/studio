import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { describe, expect, it } from "vitest";
import { allThemes } from "../registry";
import type { ThemeColors } from "../types";

function isHex(value: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

function assertContrast(fg: string, bg: string, minRatio: number, label: string): void {
	if (!isHex(fg) || !isHex(bg)) {
		return;
	}

	const ratio = contrastRatio(fg, bg);
	expect(
		ratio,
		`${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (needs ${minRatio}:1)`,
	).toBeGreaterThanOrEqual(minRatio);
}

type Key = keyof ThemeColors;

/** Every surface a composition mark can be drawn over. See the tint block below. */
const COMPOSITION_SURFACES: Key[] = [
	"bgCard",
	"compositionTintEngage",
	"compositionTintExplain",
	"compositionTintPractice",
	"compositionTintAssess",
	"compositionTintStructure",
];

/**
 * Every foreground/background pairing the desktop chrome actually renders,
 * with the ratio WCAG requires of it. Text roles are 4.5:1 (1.4.3); shapes and
 * control boundaries are 3:1 (1.4.11).
 *
 * Two families are deliberately absent, and their absence is the point:
 *
 * - `border` / `borderSubtle` are decorative panel dividers, not control
 *   boundaries. 1.4.11 does not apply to them, and holding all 29 themes to
 *   3:1 would flatten every one of their surface hierarchies. Anything that
 *   outlines a control uses `controlBorder`, which is asserted below.
 * - `accent` is a *fill*. Where CSS uses the accent as a foreground it now
 *   reads `accentOnSurface`, which is asserted below; forcing `accent` itself
 *   to 4.5:1 would darken every theme's brand colour and its button fills.
 */
const TEXT_ON_SURFACE: Array<[Key, Key[], number, string]> = [
	// Panel and editor body text renders on all four surfaces, not just bgPrimary.
	["textPrimary", ["bgPrimary", "bgPanel", "bgCard", "bgTertiary"], 4.5, "primary text"],
	["textSecondary", ["bgPrimary", "bgPanel", "bgCard", "bgTertiary"], 4.5, "secondary text"],
	["textMuted", ["bgPrimary", "bgPanel", "bgCard", "bgTertiary"], 4.5, "muted text"],
	["accentOnSurface", ["bgPrimary", "bgPanel", "bgCard"], 4.5, "accent as foreground"],

	// Grammar syntax. `.grammar-section-divider` and the `H1`/`K`/`C` gutter
	// affordances are text at 10-13px, so they take 4.5:1 like everything else.
	["syntaxKey", ["bgEditor"], 4.5, "syntax key"],
	["syntaxValue", ["bgEditor"], 4.5, "syntax value"],
	["syntaxContent", ["bgEditor"], 4.5, "syntax content"],
	["syntaxHeading", ["bgEditor"], 4.5, "syntax heading"],
	["syntaxMarkerPage", ["bgEditor"], 4.5, "page marker"],
	["syntaxMarkerSection", ["bgEditor"], 4.5, "section marker"],
	["syntaxMarkerCorrect", ["bgEditor"], 4.5, "correct marker"],
	["syntaxInstructor", ["bgEditor"], 4.5, "instructor note"],
	["gutterIcon", ["bgEditor"], 4.5, "gutter affordance"],

	// Chrome.
	["statusBarText", ["statusBarBg"], 4.5, "status bar text"],
	["textPrimary", ["topBarBg"], 4.5, "top bar text"],
	["activityBarIcon", ["activityBarBg"], 4.5, "ribbon icon"],
	["activityBarIconActive", ["activityBarBg"], 4.5, "ribbon icon (active)"],
	["accentText", ["accent", "activityBarActiveBg"], 4.5, "text on accent"],
	["selectedText", ["selectedBg"], 4.5, "text on selected row"],

	// Status indicators carry text in the status bar and the publish panel.
	["statusSaved", ["bgPanel", "bgPrimary", "statusBarBg", "bgCard"], 4.5, "saved status"],
	["statusWarning", ["bgPanel", "bgPrimary", "statusBarBg", "bgCard"], 4.5, "warning status"],
	["statusError", ["bgPanel", "bgPrimary", "statusBarBg", "bgCard"], 4.5, "error status"],
	["statusDense", ["bgPanel", "bgPrimary", "statusBarBg", "bgCard"], 4.5, "dense status"],
	["statusBadgeText", ["statusBadgeBg"], 4.5, "badge numeral"],

	// Severity chips and badges in the Accessibility and Pedagogy panels.
	["severityCriticalText", ["severityCriticalSurface"], 4.5, "critical chip text"],
	["severityWarningText", ["severityWarningSurface"], 4.5, "recommended chip text"],
	["severityInfoText", ["severityInfoSurface"], 4.5, "minor chip text"],
	["severityCriticalBadgeText", ["severityCriticalBadgeBg"], 4.5, "critical badge text"],
	["severityWarningBadgeText", ["severityWarningBadgeBg"], 4.5, "recommended badge text"],
	["severityInfoBadgeText", ["severityInfoBadgeBg"], 4.5, "minor badge text"],

	// Composition previews. A mark is drawn over a gradient running from its
	// category tint to a dilution of that tint in bgCard, so every surface the
	// ink can land on is one of these six.
	["schematicStrong", COMPOSITION_SURFACES, 4.5, "schematic emphasis"],
	["categoryEngage", ["bgPanel", "bgCard", "bgEditor"], 4.5, "engage category"],
	["categoryExplain", ["bgPanel", "bgCard", "bgEditor"], 4.5, "explain category"],
	["categoryPractice", ["bgPanel", "bgCard", "bgEditor"], 4.5, "practice category"],
	["categoryAssess", ["bgPanel", "bgCard", "bgEditor"], 4.5, "assess category"],
	["categoryStructure", ["bgPanel", "bgCard", "bgEditor"], 4.5, "structure category"],
];

/** Non-text: control boundaries, focus indicators, placeholder shapes. */
const NON_TEXT_ON_SURFACE: Array<[Key, Key[], number, string]> = [
	["controlBorder", ["controlBg", "bgPanel", "bgCard"], 3, "control border"],
	["focusRing", ["bgPrimary", "bgPanel", "bgCard"], 3, "focus ring"],
	// The two-tone ring only reads if the inner stroke separates from the outer.
	["focusRingInner", ["focusRing"], 3, "inner focus ring"],
	["welcomeCardBorder", ["welcomeCardBg", "welcomeBg"], 3, "welcome card border"],
	["severityCriticalBorder", ["severityCriticalSurface"], 3, "critical chip border"],
	["severityWarningBorder", ["severityWarningSurface"], 3, "recommended chip border"],
	["severityInfoBorder", ["severityInfoSurface"], 3, "minor chip border"],
	["schematicMuted", COMPOSITION_SURFACES, 3, "schematic placeholder"],
	// Switch states: the off-state boundary and the on-state fill must each read
	// against the surfaces a panel switch sits on, and the thumb against its own track.
	["toggleTrackBorder", ["bgPrimary", "bgPanel"], 3, "toggle track border"],
	["toggleTrackOn", ["bgPrimary", "bgPanel"], 3, "toggle track on"],
	["toggleThumbOn", ["toggleTrackOn"], 3, "toggle thumb on track"],
];

describe("theme contrast compliance (WCAG AA)", () => {
	for (const theme of allThemes) {
		describe(theme.id, () => {
			const colors = theme.colors;

			for (const [fg, backgrounds, min, label] of [...TEXT_ON_SURFACE, ...NON_TEXT_ON_SURFACE]) {
				for (const bg of backgrounds) {
					it(`${label}: ${fg} >= ${min}:1 against ${bg}`, () => {
						assertContrast(colors[fg], colors[bg], min, `${label} (${fg} on ${bg})`);
					});
				}
			}
		});
	}

	it("covers every theme", () => {
		expect(allThemes.length).toBeGreaterThanOrEqual(29);
	});

	it("asserts both light and dark themes", () => {
		expect(allThemes.some((theme) => theme.appearance === "light")).toBe(true);
		expect(allThemes.some((theme) => theme.appearance === "dark")).toBe(true);
	});
});
