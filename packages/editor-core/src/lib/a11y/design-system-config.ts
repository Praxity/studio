import type { DesignVariants } from "@praxity/grammar";
import { resolvePalette } from "../themes/design-variants-to-css";
import type { DesignSystemConfig } from "./checker";

/**
 * The appearance the checker evaluates. `auto` courses are measured in light,
 * which is what `resolvePalette` treats as the non-dark case.
 */
export function isCheckedAsDark(variants: DesignVariants): boolean {
	return variants.colorMode === "dark";
}

export function resolveDesignSystemConfig(variants: DesignVariants): DesignSystemConfig {
	// The resolved palette includes author overrides, so checker results follow
	// the colours edited in the Design panel.
	const palette = resolvePalette(variants, isCheckedAsDark(variants));

	return {
		colors: {
			background: palette.colorBackground,
			text: palette.colorText,
			accent: palette.colorAccent,
			buttonBackground: palette.colorButtonBackground,
			buttonText: palette.colorButtonText,
			success: palette.colorSuccess,
			error: palette.colorError,
			warning: palette.colorWarning,
		},
		lineHeight: variants.lineHeight ?? undefined,
		baseFontSize: undefined,
		contentMaxWidth: variants.contentMaxWidth ?? undefined,
	};
}
