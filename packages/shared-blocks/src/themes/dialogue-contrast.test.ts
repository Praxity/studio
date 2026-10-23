import { describe, expect, it } from "vitest";
import { contrastRatio } from "../color-math";
import { READING_PALETTES } from "./reading-palettes";
import { resolveDesignTokens } from "./resolve-design-tokens";

describe("dialogue bubble boundary", () => {
	it("meets 3:1 against the bubble surface in every built-in palette", () => {
		for (const palette of Object.keys(READING_PALETTES)) {
			for (const mode of ["light", "dark"] as const) {
				const tokens = resolveDesignTokens({ palette } as never, mode);
				expect(
					contrastRatio(
						tokens["--praxity-color-activity-border"],
						tokens["--praxity-color-surface"],
					),
					`${palette} ${mode}`,
				).toBeGreaterThanOrEqual(3);
			}
		}
	});
});
