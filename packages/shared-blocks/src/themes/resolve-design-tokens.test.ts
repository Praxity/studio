import type { DesignVariants } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToOklab, hexToOklch } from "../color-math";
import { READING_PALETTES } from "./reading-palettes";
import { enforceDesignTokenContrast, resolveDesignTokens } from "./resolve-design-tokens";

describe("look v2 colour roles", () => {
	it.each(["ink", "forest", "plum", "clay", "clear"])(
		"%s dark result inks retain distinct hues and readable marks",
		(palette) => {
			const tokens = resolveDesignTokens({ palette } as DesignVariants, "dark");
			const a = hexToOklab(tokens["--success-ink"]);
			const b = hexToOklab(tokens["--error-ink"]);
			expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThanOrEqual(0.15);
			for (const role of ["success", "error"]) {
				expect(hexToOklch(tokens[`--${role}-ink`])[1]).toBeGreaterThanOrEqual(0.08);
				expect(
					contrastRatio(tokens[`--${role}-ink`], tokens[`--${role}-tint`]),
				).toBeGreaterThanOrEqual(4.5);
			}
		},
	);
	it.each(["light", "dark"] as const)(
		"corrects %s control boundaries against page and card surfaces",
		(mode) => {
			const surfaces = mode === "light" ? ["#ffffff", "#eeeeee"] : ["#111111", "#252525"];
			const tokens = enforceDesignTokenContrast({
				"--praxity-color-background": surfaces[0],
				"--praxity-color-surface": surfaces[1],
				"--praxity-color-control-border": surfaces[1],
			});
			for (const surface of surfaces) {
				expect(
					contrastRatio(tokens["--praxity-color-control-border"], surface),
				).toBeGreaterThanOrEqual(3);
			}
		},
	);
	it("drops the activity shadow in dark mode and restores it in light mode", () => {
		const design = { palette: "ink" } as DesignVariants;
		expect(resolveDesignTokens(design, "dark")["--shadow-card"]).toBe("none");
		expect(resolveDesignTokens(design, "light")["--shadow-card"]).toBe(
			"0 1px 2px rgb(22 24 29 / .05), 0 16px 40px -20px rgb(22 34 70 / .28)",
		);
	});
	for (const palette of ["ink", "forest", "plum", "clay", "clear"]) {
		it.each(["light", "dark"] as const)(
			`${palette} %s selection keeps both text roles at 4.5:1`,
			(mode) => {
				const tokens = resolveDesignTokens({ palette } as DesignVariants, mode);
				for (const role of ["--line-mid", "--rule", "--accent-soft", "--accent-ink"])
					expect(tokens[role], role).toMatch(/^#[0-9a-f]{6}$/i);
				for (const role of ["--ink", "--accent-ink"])
					expect(contrastRatio(tokens[role], tokens["--accent-soft"]), role).toBeGreaterThanOrEqual(
						4.5,
					);
				expect(tokens["--line-mid"]).not.toBe(tokens["--line"]);
				expect(tokens["--rule"]).not.toBe(tokens["--line-mid"]);
			},
		);
	}
});

describe("muted code syntax palette", () => {
	for (const palette of Object.keys(READING_PALETTES)) {
		it.each(["light", "dark"] as const)(
			`${palette} %s keeps four readable syntax roles`,
			(mode) => {
				const tokens = resolveDesignTokens({ palette } as DesignVariants, mode);
				const colors = ["keyword", "string", "comment", "function"].map((role) => {
					const color = tokens[`--syntax-${role}`];
					expect(color, role).toMatch(/^#[0-9a-f]{6}$/i);
					expect(contrastRatio(color, tokens["--paper-2"]), role).toBeGreaterThanOrEqual(4.5);
					return color;
				});
				expect(new Set(colors).size).toBe(4);
				for (const [first, second] of [
					["--syntax-keyword", "--ink"],
					["--syntax-string", "--ink"],
					["--syntax-keyword", "--syntax-string"],
				]) {
					const a = hexToOklab(tokens[first]);
					const b = hexToOklab(tokens[second]);
					expect
						.soft(
							Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
							`${first} vs ${second} Delta E OK`,
						)
						.toBeGreaterThanOrEqual(0.1);
				}
				for (const role of ["keyword", "string"]) {
					const source =
						role === "keyword"
							? "--accent"
							: palette === "forest"
								? "--warning-ink"
								: "--success-ink";
					const gap = Math.abs(
						hexToOklch(tokens[`--syntax-${role}`])[2] - hexToOklch(tokens[source])[2],
					);
					expect(Math.min(gap, 360 - gap), `${role} source hue`).toBeLessThan(2);
					expect(hexToOklch(tokens[`--syntax-${role}`])[1], `${role} chroma`).toBeLessThanOrEqual(
						0.12,
					);
				}
				expect(tokens["--syntax-comment"]).toBe(tokens["--ink-2"]);
				expect(tokens["--syntax-function"]).toBe(tokens["--ink"]);
			},
		);
	}

	it.each([
		[10, 90],
		[100, 350],
	])("selects the string hue for a custom accent at %s degrees", (accentHue, stringHue) => {
		const tokens = resolveDesignTokens(
			{
				palette: "ink",
				colorAccent: `oklch(50% 0.1 ${accentHue})`,
				colorSuccess: "oklch(50% 0.1 350)",
				colorWarning: "oklch(50% 0.1 90)",
			} as DesignVariants,
			"light",
		);
		expect(hexToOklch(tokens["--syntax-string"])[2]).toBeCloseTo(stringHue, 0);
	});
});

describe("assessment review accent foreground", () => {
	it.each([
		["#eeeeee", "#000000"],
		["#222222", "#ffffff"],
	] as const)("uses a readable mark over %s", (accent, expected) => {
		const tokens = enforceDesignTokenContrast({ "--praxity-color-accent": accent });
		expect(tokens["--praxity-color-accent-foreground"]).toBe(expected);
		expect(tokens["--praxity-color-accent"]).toBe(accent);
	});
});

describe("focus contrast floor", () => {
	it("corrects custom focus against activity and hover surfaces before deriving skip-link text", () => {
		const input = {
			"--praxity-color-background": "#0c1222",
			"--praxity-color-surface": "#101827",
			"--praxity-color-navigation-surface": "#172033",
			"--praxity-color-background-alt": "#151d2e",
			"--praxity-color-activity-surface": "#283449",
			"--praxity-color-accent-light": "#25334c",
			"--praxity-color-secondary-light": "#344853",
			"--praxity-color-tertiary-light": "#293444",
			"--praxity-color-success-light": "#263b30",
			"--praxity-color-error-light": "#422a32",
			"--praxity-color-warning-light": "#44372a",
			"--praxity-color-callout-note-high": "#1b2640",
			"--praxity-color-accent": "#1e40af",
			"--praxity-color-focus": "#1e40af",
		};
		const tokens = enforceDesignTokenContrast(input);
		for (const [key, surface] of Object.entries(input)) {
			if (key === "--praxity-color-accent" || key === "--praxity-color-focus") continue;
			expect(contrastRatio(tokens["--praxity-color-focus"], surface), key).toBeGreaterThanOrEqual(
				3,
			);
		}
		expect(
			contrastRatio(tokens["--praxity-color-focus-text"], tokens["--praxity-color-focus"]),
		).toBeGreaterThanOrEqual(4.5);
		expect(tokens["--praxity-color-accent"]).toBe("#1e40af");
		expect(input["--praxity-color-focus"]).toBe("#1e40af");
	});

	it("preserves a focus colour that already clears every surface", () => {
		const tokens = enforceDesignTokenContrast({
			"--praxity-color-background": "#ffffff",
			"--praxity-color-surface": "#f0f0f0",
			"--praxity-color-focus": "#1e40af",
		});
		expect(tokens["--praxity-color-focus"]).toBe("#1e40af");
	});
});
