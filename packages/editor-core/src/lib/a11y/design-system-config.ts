import type { DesignVariants } from "@praxity/grammar";
import { resolvePalette } from "../themes/design-variants-to-css";
import type { DesignSystemConfig } from "./checker";

export function isCheckedAsDark(variants: DesignVariants): boolean {
	return variants.colorMode === "dark";
}

export function resolveDesignSystemConfig(variants: DesignVariants): DesignSystemConfig {
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
