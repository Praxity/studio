import { describe, expect, it } from "vitest";
import { resolveDesignTokens } from "./resolve-design-tokens";

describe("unboxed callout roles", () => {
	for (const palette of ["ink", "forest", "plum", "clay", "clear"])
		for (const mode of ["light", "dark"] as const) {
			it(`${palette} ${mode} shares the page paper across every callout tone`, () => {
				const tokens = resolveDesignTokens({ palette } as never, mode);
				const paper = mode === "dark" ? "#121417" : palette === "clay" ? "#fbf9f6" : "#ffffff";
				for (const tone of ["note", "info", "tip", "warning", "success"])
					for (const level of ["low", "high"])
						expect(tokens[`--praxity-color-callout-${tone}-${level}`]).toBe(paper);
			});
		}
});
