import type { DesignVariants } from "@praxity/grammar";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";

export type CoursePalette = {
	colorBackgroundLight: string;
	colorBackgroundDark: string;
	colorBackground: string;
	colorText: string;
	colorTextLight: string;
	colorTextMuted: string;
	colorAccent: string;
	colorButtonBackground: string;
	colorButtonText: string;
	colorSuccess: string;
	colorError: string;
	colorWarning: string;
};

function resolveMode(
	colorMode: DesignVariants["colorMode"],
	prefersDark: boolean,
	previewOverride: "light" | "dark" | null,
): "light" | "dark" {
	if (previewOverride) return previewOverride;
	if (colorMode === "auto") return prefersDark ? "dark" : "light";
	return colorMode;
}

function token(tokens: Record<string, string>, name: string): string {
	return tokens[`--praxity-color-${name}`];
}

export function resolvePalette(variants: DesignVariants, isDark: boolean): CoursePalette {
	const light = resolveDesignTokens(variants, "light");
	const dark = resolveDesignTokens(variants, "dark");
	const active = isDark ? dark : light;

	return {
		colorBackgroundLight: token(light, "background"),
		colorBackgroundDark: token(dark, "background"),
		colorBackground: token(active, "background"),
		colorText: token(active, "text"),
		colorTextLight: token(active, "text-light"),
		colorTextMuted: token(active, "text-muted"),
		colorAccent: token(active, "accent"),
		colorButtonBackground: token(active, "button-background"),
		colorButtonText: token(active, "button-text"),
		colorSuccess: token(active, "success"),
		colorError: token(active, "error"),
		colorWarning: token(active, "warning"),
	};
}

export function designVariantsToCssProperties(
	variants: DesignVariants,
	prefersDark: boolean,
	previewOverride: "light" | "dark" | null = null,
): Record<string, string> {
	return resolveDesignTokens(
		variants,
		resolveMode(variants.colorMode, prefersDark, previewOverride),
	);
}
