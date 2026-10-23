import type { DesignVariants } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN_VARIANTS } from "../../themes/design-variant-defaults";
import { checkContrastPairs } from "../contrast";
import { resolveDesignSystemConfig } from "../design-system-config";

function variants(overrides: Partial<DesignVariants> = {}): DesignVariants {
	return { ...DEFAULT_DESIGN_VARIANTS, ...overrides };
}

describe("resolveDesignSystemConfig", () => {
	it.each(["ink", "forest", "plum", "clay", "clear", "unknown"])(
		"keeps absent numeric geometry undefined for %s in every mode",
		(palette) => {
			for (const colorMode of ["light", "dark", "auto"] as const) {
				const config = resolveDesignSystemConfig(
					variants({ palette, colorMode, lineHeight: undefined, contentMaxWidth: undefined }),
				);
				expect(config.lineHeight).toBeUndefined();
				expect(config.baseFontSize).toBeUndefined();
				expect(config.contentMaxWidth).toBeUndefined();
				expect(Object.hasOwn(config, "baseFontSize")).toBe(true);
			}
		},
	);

	it("keeps author numeric overrides", () => {
		const config = resolveDesignSystemConfig(variants({ lineHeight: 1.6, contentMaxWidth: 900 }));
		expect(config.lineHeight).toBe(1.6);
		expect(config.contentMaxWidth).toBe(900);
		expect(config.baseFontSize).toBeUndefined();
	});

	it("keeps null legacy geometry undefined", () => {
		const config = resolveDesignSystemConfig(
			variants({ lineHeight: null, contentMaxWidth: null } as unknown as Partial<DesignVariants>),
		);
		expect(config.lineHeight).toBeUndefined();
		expect(config.contentMaxWidth).toBeUndefined();
	});

	it("measures auto in light and preserves the unknown palette fallback", () => {
		const config = resolveDesignSystemConfig(
			variants({
				palette: "unknown",
				colorMode: "auto",
				colorBackgroundLight: "#fafafa",
				colorBackgroundDark: "#050505",
			}),
		);
		expect(config.colors?.background).toBe("#fafafa");
		expect(config.colors?.text).toBe("#18212d");
		expect(config.colors?.accent).toBe("#294c78");
	});

	// The Design panel can now edit colorSuccess / colorError. Reading the preset
	// table instead of the resolved palette meant those edits never reached the
	// checker, so the reported contrast stayed frozen at the preset's value and
	// the author had no way to tell whether a fix had worked.
	it("reads author overrides for success and error", () => {
		const config = resolveDesignSystemConfig(
			variants({ colorSuccess: "#004d00", colorError: "#8b0000" }),
		);
		expect(config.colors?.success).toBe("#004d00");
		expect(config.colors?.error).toBe("#8b0000");
	});

	it("measures against the author's own background", () => {
		const config = resolveDesignSystemConfig(variants({ colorBackgroundLight: "#101010" }));
		expect(config.colors?.background).toBe("#101010");
	});

	it("uses the dark background when the course renders dark", () => {
		const config = resolveDesignSystemConfig(
			variants({ colorMode: "dark", colorBackgroundDark: "#050505" }),
		);
		expect(config.colors?.background).toBe("#050505");
	});

	it("corrects legacy status seeds to body-text contrast", () => {
		const resolved = resolveDesignSystemConfig(
			variants({ colorSuccess: "#d8f5d8", colorError: "#f8cccc", colorWarning: "#ffe9aa" }),
		);
		const warnings = checkContrastPairs(resolved.colors as NonNullable<typeof resolved.colors>).map(
			(warning) => warning.pair,
		);
		expect(warnings).not.toContain("success-on-background");
		expect(warnings).not.toContain("error-on-background");
		expect(warnings).not.toContain("warning-on-background");
	});
});
