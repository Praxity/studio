"use client";

import { Box } from "@mantine/core";
import {
	collectTypographyFontFaces,
	type DesignVariants,
	resolveCoursePresetId,
} from "@praxity/grammar";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { useEffect, useMemo } from "react";
import type { CustomThemeOverrides } from "../lib/db/schema";
import { loadFont } from "../lib/themes/load-font";
import { THEME_PRESET_DEFAULTS } from "../lib/themes/theme-preset-defaults";

interface ThemePreviewThumbnailProps {
	preset: string;
	overrides: CustomThemeOverrides;
	mode?: "light" | "dark";
}

/** Decorative miniature of the course chrome and page. */
export function ThemePreviewThumbnail({ preset, overrides, mode }: ThemePreviewThumbnailProps) {
	const resolved = useMemo(() => {
		const presetKey = resolveCoursePresetId(preset);
		const defaults = THEME_PRESET_DEFAULTS[presetKey];
		const effectiveMode = mode ?? (defaults.colorMode === "dark" ? "dark" : "light");
		const tokens = resolveDesignTokens(
			{
				...defaults,
				palette: presetKey,
				...(overrides.colorBackground
					? {
							[effectiveMode === "dark" ? "colorBackgroundDark" : "colorBackgroundLight"]:
								overrides.colorBackground,
						}
					: {}),
				...(overrides.colorText ? { colorText: overrides.colorText } : {}),
				...(overrides.colorAccent ? { colorAccent: overrides.colorAccent } : {}),
				...(overrides.colorButtonBackground
					? { colorButtonBackground: overrides.colorButtonBackground }
					: {}),
				...(overrides.borderRadius !== undefined ? { borderRadius: overrides.borderRadius } : {}),
			} as DesignVariants,
			effectiveMode,
		);
		return {
			presetKey,
			effectiveMode,
			typography: defaults.typography,
			background: tokens["--praxity-color-background"],
			surface: tokens["--praxity-color-surface"],
			navigationSurface:
				tokens["--praxity-color-navigation-surface"] ?? tokens["--praxity-color-surface"],
			border: tokens["--praxity-color-border"],
			text: tokens["--praxity-color-text"],
			textLight: tokens["--praxity-color-text-light"],
			accent: tokens["--praxity-color-accent"],
			accentLight: tokens["--praxity-color-accent-light"],
			buttonBackground: tokens["--praxity-color-button-background"],
			buttonText: tokens["--praxity-color-button-text"],
			success: tokens["--praxity-color-success"],
			error: tokens["--praxity-color-error"],
			warning: tokens["--praxity-color-warning"],
			fontBody: overrides.fontFamilyBody ?? tokens["--praxity-font-family"],
			fontHeading: tokens["--praxity-font-heading"],
			fontHeadingWeight: tokens["--praxity-font-weight-heading"],
			borderRadius: tokens["--praxity-radius-action"],
			buttonShadow: tokens["--praxity-shadow-md"],
		};
	}, [mode, overrides, preset]);

	useEffect(() => {
		if (!resolved.typography) return;
		for (const request of collectTypographyFontFaces(resolved.typography)) {
			loadFont(request, resolved.typography.fontDisplay);
		}
	}, [resolved.typography]);

	return (
		<Box
			aria-hidden="true"
			data-theme-mode={resolved.effectiveMode}
			data-theme-preset={resolved.presetKey}
			style={{
				width: "100%",
				height: 150,
				borderRadius: "var(--mantine-radius-sm)",
				border: `1px solid ${resolved.border}`,
				overflow: "hidden",
				backgroundColor: resolved.background,
				fontFamily: resolved.fontBody,
				display: "grid",
				gridTemplateColumns: "46px 1fr",
			}}
		>
			<div
				className="theme-preview-navigation"
				style={{
					backgroundColor: resolved.navigationSurface,
					borderRight: `1px solid ${resolved.border}`,
					padding: "10px 6px",
					display: "flex",
					flexDirection: "column",
					gap: 7,
				}}
			>
				<span
					style={{
						width: 12,
						height: 12,
						borderRadius: "50%",
						backgroundColor: resolved.accent,
					}}
				/>
				<span
					style={{
						height: 8,
						borderRadius: resolved.borderRadius,
						backgroundColor: resolved.accentLight,
						borderLeft: `3px solid ${resolved.accent}`,
					}}
				/>
				{[75, 55, 68].map((width) => (
					<span
						key={width}
						style={{
							height: 3,
							width: `${width}%`,
							borderRadius: 2,
							backgroundColor: resolved.textLight,
						}}
					/>
				))}
			</div>

			<div style={{ padding: 10, backgroundColor: resolved.background }}>
				<div
					className="theme-preview-page"
					style={{
						height: "100%",
						border: `1px solid ${resolved.border}`,
						borderRadius: resolved.borderRadius,
						backgroundColor: resolved.surface,
						boxShadow: resolved.buttonShadow,
						padding: 10,
						display: "flex",
						flexDirection: "column",
						gap: 7,
					}}
				>
					<div
						className="theme-preview-heading-glyph"
						style={{
							fontFamily: resolved.fontHeading,
							fontWeight: resolved.fontHeadingWeight,
							fontSize: 24,
							lineHeight: 1,
							color: resolved.text,
						}}
					>
						Aa
					</div>
					{[88, 65].map((width) => (
						<span
							key={width}
							style={{
								height: 4,
								width: `${width}%`,
								borderRadius: 2,
								backgroundColor: resolved.textLight,
							}}
						/>
					))}
					<div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: "auto" }}>
						<span
							className="theme-preview-button-chip"
							style={{
								width: 42,
								height: 15,
								borderRadius: resolved.borderRadius,
								backgroundColor: resolved.buttonBackground,
								boxShadow: resolved.buttonShadow,
								border: `3px solid ${resolved.buttonBackground}`,
								borderLeftColor: resolved.buttonText,
							}}
						/>
						{[resolved.success, resolved.warning, resolved.error].map((color) => (
							<span
								key={color}
								className="theme-preview-status"
								style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: color }}
							/>
						))}
					</div>
				</div>
			</div>
		</Box>
	);
}
