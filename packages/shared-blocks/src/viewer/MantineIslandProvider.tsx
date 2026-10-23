"use client";

import {
	type CSSVariablesResolver,
	colorsTuple,
	createTheme,
	MantineProvider,
} from "@mantine/core";
import type { ReactNode } from "react";

const canvasResolver: CSSVariablesResolver = (theme) => ({
	variables: {
		// Core
		"--mantine-color-body": "var(--praxity-color-background)",
		"--mantine-color-text": "var(--praxity-color-text)",
		"--mantine-color-anchor": "var(--praxity-color-accent-text, var(--praxity-color-accent))",
		"--mantine-color-dimmed": "var(--praxity-color-text-light)",
		"--mantine-color-error": "var(--praxity-color-error-text, var(--praxity-color-error))",

		// Primary color (accent)
		"--mantine-primary-color-filled": "var(--praxity-color-accent)",
		"--mantine-primary-color-filled-hover": "var(--praxity-color-accent-hover)",
		"--mantine-primary-color-light": "var(--praxity-color-accent-light)",
		"--mantine-primary-color-light-hover": "var(--praxity-color-accent-light)",
		"--mantine-primary-color-light-color":
			"var(--praxity-color-accent-text, var(--praxity-color-accent))",
		"--mantine-color-accent-light": "var(--praxity-color-accent-light)",
		"--mantine-color-accent-light-hover": "var(--praxity-color-accent-light)",
		"--mantine-color-accent-light-color":
			"var(--praxity-color-accent-text, var(--praxity-color-accent))",

		// Default variant (cards, inputs)
		"--mantine-color-default": "var(--praxity-color-surface)",
		"--mantine-color-default-border":
			"var(--praxity-color-control-border, var(--praxity-color-text-light, #596673))",
		"--mantine-color-default-hover": "var(--praxity-color-background-alt)",

		// Gray scale (mapped to theme-derived values)
		"--mantine-color-gray-0": "var(--praxity-color-background-alt)",
		"--mantine-color-gray-1": "var(--praxity-color-background-alt)",
		"--mantine-color-gray-2": "var(--praxity-color-border)",
		"--mantine-color-gray-3": "var(--praxity-color-border)",

		// Font
		"--mantine-font-family": "var(--praxity-font-family)",
		"--mantine-font-family-headings": "var(--praxity-font-heading, var(--praxity-font-family))",
	},
	light: {},
	dark: {},
});

interface MantineIslandProviderProps {
	children: ReactNode;
	colorShades?: {
		accent?: string[];
		success?: string[];
		error?: string[];
		warning?: string[];
	};
}

export function MantineIslandProvider({ children, colorShades }: MantineIslandProviderProps) {
	// Always provide an accent color tuple so primaryColor: "accent" is valid.
	// Fall back to a blue scale if colorShades.accent is not provided (e.g. CourseMenu
	// island which doesn't receive colorShades).
	const fallbackAccent = [
		"#ebf0ff",
		"#d3defb",
		"#a7bbf3",
		"#7a97ea",
		"#557adf",
		"#3d66da",
		"#2b5add",
		"#1d4ed8",
		"#103cba",
		"#002dad",
	];

	// Semantic colors must ALWAYS be registered: blocks use color="success" etc.,
	// and an unregistered name makes Mantine variants degenerate (white-on-light
	// badge text, caught by axe). Shade 6+ is dark enough for AA text on shade 0.
	const fallbackSuccess = [
		"#e9f6ee",
		"#d3eedd",
		"#a8ddbb",
		"#79ca97",
		"#4fb878",
		"#2f9e5c",
		"#1f7a46",
		"#1a6a3d",
		"#145733",
		"#0e4428",
	];
	const fallbackError = [
		"#fdeeee",
		"#fadadb",
		"#f4b3b5",
		"#ec8a8d",
		"#e26468",
		"#d43f44",
		"#b02a2f",
		"#9a2428",
		"#801e21",
		"#66181b",
	];
	const fallbackWarning = [
		"#fdf4dc",
		"#fae8ba",
		"#f3d17c",
		"#e9b93f",
		"#d9a011",
		"#b98700",
		"#926a00",
		"#7f5c00",
		"#684c00",
		"#523c00",
	];

	const theme = createTheme({
		fontFamily: "var(--praxity-font-family)",
		primaryColor: "accent",
		defaultRadius: "sm",
		autoContrast: true,
		luminanceThreshold: 0.3,
		colors: {
			accent: colorsTuple(colorShades?.accent ?? fallbackAccent),
			success: colorsTuple(colorShades?.success ?? fallbackSuccess),
			error: colorsTuple(colorShades?.error ?? fallbackError),
			warning: colorsTuple(colorShades?.warning ?? fallbackWarning),
		},
	});

	return (
		<MantineProvider theme={theme} cssVariablesResolver={canvasResolver}>
			{children}
		</MantineProvider>
	);
}
