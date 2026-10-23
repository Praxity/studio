import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { enforceDesignTokenContrast } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { describe, expect, it } from "vitest";
import { extractDesktopDesignFromFrontmatter } from "../desktop-design.ts";
import type { CourseConfig } from "../html-gen.ts";
import { generateCourseCss, generateHtmlPage } from "../html-gen.ts";

const BACKGROUND = "#faf9f7";

function renderAuditedTheme(
	overrides: {
		cssVars?: Record<string, string>;
		theme?: Record<string, string>;
		colorMode?: CourseConfig["colorMode"];
	} = {},
): string {
	const config: CourseConfig = {
		id: "contrast-course",
		title: "Contrast course",
		sourceLocale: "en",
		totalPages: 1,
		pages: [
			{
				id: "page-1",
				title: "Contrast",
				blocks: [{ id: "copy", type: "text", data: { content: "Contrast" } }],
			},
		],
		navigationStyle: "slides",
		cssVars: {
			"--praxity-color-background": BACKGROUND,
			"--praxity-color-surface": BACKGROUND,
			"--praxity-color-background-alt": "#edebe8",
			"--praxity-color-text": "#1e293b",
			"--praxity-color-text-light": "#6f7680",
			"--praxity-color-text-muted": "#818791",
			"--praxity-color-focus": "#4269d0",
			"--praxity-color-accent": "#4269d0",
			"--praxity-color-button-background": "#4269d0",
			"--praxity-color-button-text": "#ffffff",
			"--praxity-color-success": "#2b8a3e",
			"--praxity-color-error": "#c53030",
			"--praxity-color-warning": "#b45309",
			...overrides.cssVars,
		},
		theme: {
			colorBackground: BACKGROUND,
			colorText: "#1e293b",
			colorAccent: "#4269d0",
			colorSuccess: "#2b8a3e",
			colorError: "#c53030",
			colorWarning: "#b45309",
			...overrides.theme,
		},
		colorMode: overrides.colorMode ?? "light",
	};

	const html = generateHtmlPage({
		config,
		page: config.pages[0],
		index: 0,
		currentSlug: "contrast",
		slugList: [{ pageId: "page-1", slug: "contrast", title: "Contrast" }],
		slugMap: new Map([["page-1", "contrast"]]),
		islandAssets: {
			loaderFilename: "island-loader.js",
			islandFilenames: { nav: "island-nav.js" },
		},
	});
	return `${generateCourseCss(config)}\n${html}`;
}

function emittedCssVar(html: string, name: string): string {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = html.match(new RegExp(`${escapedName}:\\s*(#[0-9a-fA-F]{6});`));
	expect(match, `expected ${name} in emitted :root variables`).not.toBeNull();
	return match?.[1] ?? "";
}

function emittedColorShades(html: string): Record<string, string[]> {
	const match = html.match(
		/<script id="praxity-config" type="application\/json">([\s\S]*?)<\/script>/,
	);
	expect(match).not.toBeNull();
	const config = JSON.parse(match?.[1] ?? "{}") as { colorShades?: Record<string, string[]> };
	expect(config.colorShades).toBeDefined();
	return config.colorShades ?? {};
}

describe("export text-role contrast floor", () => {
	it("gives prefers-contrast token swaps measurable headroom", () => {
		const { cssVars } = extractDesktopDesignFromFrontmatter({});
		if (!cssVars) throw new Error("Expected default CSS variables");
		const corrected = enforceDesignTokenContrast(cssVars);
		const surface = corrected["--praxity-color-activity-surface"];
		const stronger = corrected["--praxity-color-text"];

		for (const role of [
			"--praxity-color-border",
			"--praxity-color-activity-border",
			"--praxity-color-text-light",
			"--praxity-color-accent",
			"--praxity-color-focus",
		]) {
			const before = contrastRatio(corrected[role], surface);
			const after = contrastRatio(stronger, surface);
			expect(after, role).toBeGreaterThan(before);
			expect(after, role).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("keeps neutral activity borders at 3:1 and activity text at 4.5:1", () => {
		const corrected = enforceDesignTokenContrast({
			"--praxity-color-background": "#faf9f7",
			"--praxity-color-surface": "#faf9f7",
			"--praxity-color-activity-surface": "#faf9f7",
			"--praxity-color-text": "#1e293b",
			"--praxity-color-border": "#d9d8d5",
			"--praxity-color-activity-border": "#d9d8d5",
		});
		const surface = corrected["--praxity-color-activity-surface"];

		expect(
			contrastRatio(corrected["--praxity-color-activity-border"], surface),
		).toBeGreaterThanOrEqual(3);
		expect(contrastRatio(corrected["--praxity-color-text"], surface)).toBeGreaterThanOrEqual(4.5);
	});

	it("derives status colours for both light and dark surfaces", () => {
		const corrected = enforceDesignTokenContrast({
			"--praxity-color-background-light": "#ffffff",
			"--praxity-color-background-dark": "#111827",
			"--praxity-color-success": "#2b8a3e",
			"--praxity-color-error": "#c53030",
			"--praxity-color-warning": "#b45309",
		});

		for (const role of ["success", "error", "warning"]) {
			expect(
				contrastRatio(corrected[`--praxity-color-${role}-on-light`], "#ffffff"),
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrastRatio(corrected[`--praxity-color-${role}-on-dark`], "#111827"),
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("keeps accent text readable on light-button and shared hover surfaces", () => {
		const { cssVars } = extractDesktopDesignFromFrontmatter({
			design: { colorAccent: "#4269d0" } as never,
		});
		if (!cssVars) throw new Error("Expected CSS variables");
		const corrected = enforceDesignTokenContrast(cssVars);
		const accent = corrected["--praxity-color-accent"];
		const accentText = corrected["--praxity-color-accent-text"];

		for (const surface of [
			corrected["--praxity-color-background-alt"],
			corrected["--praxity-color-accent-light"],
		]) {
			expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(accentText, surface)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("checks body and semantic tone text against every exported callout tint", () => {
		const corrected = enforceDesignTokenContrast({
			"--praxity-color-background": "#faf9f7",
			"--praxity-color-surface": "#faf9f7",
			"--praxity-color-text": "#6f7680",
			"--praxity-color-accent": "#e63946",
			"--praxity-color-secondary": "#f4dfe2",
			"--praxity-color-success": "#2b8a3e",
			"--praxity-color-warning": "#b45309",
			"--praxity-color-tertiary": "#6c5ce7",
			"--praxity-color-callout-note-low": "#f5e9e9",
			"--praxity-color-callout-note-high": "#efd8da",
			"--praxity-color-callout-info-low": "#f9f6f5",
			"--praxity-color-callout-info-high": "#f8f3f3",
			"--praxity-color-callout-warning-low": "#f7eee5",
			"--praxity-color-callout-warning-high": "#f1e2d4",
			"--praxity-color-callout-success-low": "#edf3e9",
			"--praxity-color-callout-success-high": "#e1ebdb",
			"--praxity-color-callout-tip-low": "#f3f0f8",
			"--praxity-color-callout-tip-high": "#eae5f4",
		});
		const surfaces = [
			...Object.entries(corrected)
				.filter(([key]) => key.startsWith("--praxity-color-callout-"))
				.map(([, value]) => value),
		];

		for (const foreground of [
			corrected["--praxity-color-text"],
			corrected["--praxity-color-accent-text"],
			corrected["--praxity-color-secondary-text"],
			corrected["--praxity-color-warning-text"],
			corrected["--praxity-color-success-text"],
			corrected["--praxity-color-tertiary-text"],
		]) {
			for (const surface of surfaces) {
				expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("emits an sRGB fallback for every callout tint", () => {
		const { cssVars } = extractDesktopDesignFromFrontmatter({});
		const html = renderAuditedTheme({ cssVars });
		for (const tone of ["note", "info", "warning", "success", "tip"]) {
			for (const emphasis of ["low", "high"]) {
				expect(emittedCssVar(html, `--praxity-color-callout-${tone}-${emphasis}`)).toMatch(
					/^#[0-9a-f]{6}$/i,
				);
			}
		}
	});

	it('keeps the Assessment "Correct" label at 4.5:1 after OKLCH ramp generation', () => {
		const html = renderAuditedTheme();
		const background = emittedCssVar(html, "--praxity-color-background");
		const successShades = emittedColorShades(html).success;
		const successText = successShades?.[6];
		expect(successText).toBeDefined();
		expect(contrastRatio(successText ?? "", background)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(successText ?? "", successShades?.[0] ?? "")).toBeGreaterThanOrEqual(4.5);
	});

	it("emits a skip-link foreground that clears the focus background", () => {
		const html = renderAuditedTheme();
		const foreground = emittedCssVar(html, "--praxity-color-focus-text");
		const background = emittedCssVar(html, "--praxity-color-focus");
		expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
	});

	it("makes the Diagram fallback text-muted role readable", () => {
		const html = renderAuditedTheme({
			cssVars: { "--praxity-color-text-muted": "#7f858e" },
		});
		const foreground = emittedCssVar(html, "--praxity-color-text-muted");
		const background = emittedCssVar(html, "--praxity-color-background");
		expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
	});

	it("corrects the raw alpha-blended text-muted token", () => {
		const html = renderAuditedTheme();
		const foreground = emittedCssVar(html, "--praxity-color-text-muted");
		const background = emittedCssVar(html, "--praxity-color-background");
		expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
	});

	it("aliases Mantine's dimmed token to the corrected muted role", () => {
		// `c="dimmed"` is used 32 times across learner-facing blocks and never passed
		// through this floor: Mantine's #868e96 is 3.16:1 on the default surface.
		const corrected = enforceDesignTokenContrast({
			"--praxity-color-background": "#faf9f7",
			"--praxity-color-surface": "#faf9f7",
			"--praxity-color-text": "#1e293b",
			"--praxity-color-text-muted": "#9aa0a6",
		});
		const dimmed = corrected["--mantine-color-dimmed"];
		expect(dimmed).toBe(corrected["--praxity-color-text-muted"]);
		expect(contrastRatio(dimmed, "#faf9f7")).toBeGreaterThanOrEqual(4.5);
	});

	it("preserves the author's accent fill while its derived text role clears 4.5:1", () => {
		const brand = "#e63946";
		const html = renderAuditedTheme({
			cssVars: { "--praxity-color-accent": brand },
		});
		const background = emittedCssVar(html, "--praxity-color-background");
		const accent = emittedCssVar(html, "--praxity-color-accent");
		const accentText = emittedCssVar(html, "--praxity-color-accent-text");

		expect(accent).not.toBe(brand);
		expect(contrastRatio(accent, background)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(accentText, background)).toBeGreaterThanOrEqual(4.5);
	});

	it("splits all dual-role brand and status tokens from their corrected text roles", () => {
		const brand = "#f4dfe2";
		const html = renderAuditedTheme({
			cssVars: {
				"--praxity-color-accent": brand,
				"--praxity-color-success": brand,
				"--praxity-color-error": brand,
				"--praxity-color-warning": brand,
			},
			theme: {
				colorAccent: brand,
				colorSuccess: brand,
				colorError: brand,
				colorWarning: brand,
			},
		});
		const background = emittedCssVar(html, "--praxity-color-background");
		const successText = emittedColorShades(html).success?.[6];

		for (const role of ["accent", "success", "error", "warning"]) {
			expect(
				contrastRatio(emittedCssVar(html, `--praxity-color-${role}`), background),
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrastRatio(emittedCssVar(html, `--praxity-color-${role}-text`), background),
			).toBeGreaterThanOrEqual(4.5);
		}
		expect(successText).toBeDefined();
		expect(contrastRatio(successText ?? "", background)).toBeGreaterThanOrEqual(4.5);
	});
});
