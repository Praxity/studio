import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { describe, expect, it } from "vitest";
import { defaultDarkTheme } from "../default-dark";
import { defaultLightTheme } from "../default-light";
import type { ThemeColors } from "../types";

type Key = keyof ThemeColors;

const PAIRS: Array<[Key, Key[], number, string]> = [
	["textPrimary", ["bgPanel", "controlBg"], 4.5, "control text"],
	["textSecondary", ["bgPanel", "controlBg"], 4.5, "hint and disabled text"],
	["accentOnSurface", ["bgPanel", "controlBg"], 4.5, "Read link"],
	["statusError", ["bgPanel"], 4.5, "field error"],
	["controlBorder", ["bgPanel", "controlBg"], 3, "control border"],
	["focusRing", ["bgPrimary", "bgPanel", "bgCard"], 3, "focus ring"],
];

describe("canvas control contrast (WCAG AA)", () => {
	for (const theme of [defaultLightTheme, defaultDarkTheme]) {
		describe(theme.id, () => {
			for (const [fg, backgrounds, min, label] of PAIRS) {
				for (const bg of backgrounds) {
					it(`${label}: ${fg} >= ${min}:1 against ${bg}`, () => {
						const foreground = theme.colors[fg];
						const background = theme.colors[bg];
						expect(foreground).toMatch(/^#[0-9a-fA-F]{6}$/);
						expect(background).toMatch(/^#[0-9a-fA-F]{6}$/);
						expect(contrastRatio(foreground, background), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
							min,
						);
					});
				}
			}
		});
	}
});
