import { describe, expect, it } from "vitest";
import blocks from "../blocks/shared-blocks.css?raw";
import { contrastRatio } from "../color-math";
import { resolveSlideStyle } from "../viewer/slide-styles";
import shell from "../viewer/viewer-shell.css?raw";
import { READING_PALETTES } from "./reading-palettes";
import { resolveDesignTokens } from "./resolve-design-tokens";

describe("muted text", () => {
	it("uses the readable muted token for both lesson heading lines", () => {
		for (const css of [blocks, shell]) {
			const rule = css.match(/\.praxity-kicker,\s*\.praxity-lesson-time\s*\{([^}]+)\}/)?.[1];
			expect(rule).toContain("color: var(--praxity-color-text-light)");
			expect(rule).not.toMatch(/opacity|font-style:\s*italic/);
		}
		expect(shell).toMatch(
			/\.praxity-slide :is\(\.praxity-kicker, \.praxity-lesson-time\)\s*\{\s*color: var\(--slide-muted, var\(--praxity-color-text-light\)\);/,
		);
		expect(blocks).toMatch(
			/\.praxity-lesson-time\s*\{[^}]*font-weight: var\(--weight-body\);[^}]*font-style: normal;/,
		);
		expect(blocks).toMatch(
			/\.praxity-kicker,\s*\.praxity-lesson-time\s*\{[^}]*overflow-wrap: anywhere;/,
		);
		const timeRule = blocks.match(/\}\s*\.praxity-lesson-time\s*\{([^}]+)\}/)?.[1];
		expect(timeRule).toBeDefined();
		expect(timeRule).not.toContain("margin-block-start");
	});
	it("keeps lesson labels at 4.5:1 on every slide background in light and dark palettes", () => {
		for (const palette of Object.keys(READING_PALETTES)) {
			for (const mode of ["light", "dark"] as const) {
				const tokens = resolveDesignTokens({ palette } as never, mode);
				for (const background of ["paper", "surface", "accent", "ink"] as const) {
					const style = resolveSlideStyle("custom", { custom: { background } });
					const value = (reference: string) => tokens[reference.slice(4, -1)];
					expect(
						contrastRatio(value(style.mutedColor), value(style.variables["--slide-bg"])),
						`${palette} ${mode} ${background}`,
					).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
	});
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
					expect
						.soft(
							ratio("--praxity-color-text-light", surface),
							`${label} lesson labels on ${surface}`,
						)
						.toBeGreaterThanOrEqual(4.5);
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
