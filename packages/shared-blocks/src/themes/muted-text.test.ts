import { describe, expect, it } from "vitest";
import { contrastRatio } from "../color-math";
import { READING_PALETTES } from "./reading-palettes";
import { resolveDesignTokens } from "./resolve-design-tokens";

describe("muted text", () => {
	it("reads quieter than body text in every built-in palette and keeps 4.5:1", () => {
		for (const palette of Object.keys(READING_PALETTES)) {
			for (const mode of ["light", "dark"] as const) {
				const tokens = resolveDesignTokens({ palette } as never, mode);
				const label = `${palette} ${mode}`;
				const ratio = (key: string, surface: string) => contrastRatio(tokens[key], tokens[surface]);
				for (const surface of Object.keys(tokens).filter(
					(key) =>
						["background", "surface", "navigation-surface", "background-alt"].some(
							(role) => key === `--praxity-color-${role}`,
						) ||
						(key.startsWith("--praxity-color-callout-") && /-(low|high)$/.test(key)),
				)) {
					const muted = ratio("--praxity-color-text-muted", surface);
					expect.soft(muted, `${label} on ${surface}`).toBeGreaterThanOrEqual(4.5);
					// A 75% cap conflicts with Lc75 in dark presets. 80% keeps the visual step
					// while the editor palette tests retain the absolute Lc75 reading floor.
					expect
						.soft(muted, `${label} on ${surface}`)
						.toBeLessThanOrEqual(ratio("--praxity-color-text", surface) * 0.8);
				}
				expect(tokens["--mantine-color-dimmed"]).toBe(tokens["--praxity-color-text-muted"]);
			}
		}
	});
});
