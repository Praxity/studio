import { describe, expect, it, vi } from "vitest";
import {
	BUILT_IN_SLIDE_STYLES,
	resolvePageSlideStyle,
	resolveSlideStyle,
	type SlideStyleDef,
} from "./slide-styles";

const COMPLETE_VARIABLE_KEYS = [
	"--slide-bg",
	"--slide-fg",
	"--slide-measure",
	"--slide-heading-scale",
	"--slide-align",
	"--slide-grid-columns",
	"--slide-text-column",
	"--slide-media-column",
	"--slide-accent-rule-width",
] as const;

describe("resolveSlideStyle", () => {
	it("ships the five base style definitions", () => {
		expect(BUILT_IN_SLIDE_STYLES).toEqual({
			title: {
				align: "center",
				background: "ink",
				scale: "display",
			},
			section: {
				accentRule: true,
				scale: "display",
			},
			content: {},
			scenario: {
				mediaPlacement: "right",
			},
			quiz: {},
		});
	});

	it("maps background and text pairs exclusively to Praxity theme tokens", () => {
		const tokenPairs = {
			paper: ["var(--praxity-color-background)", "var(--praxity-color-text)"],
			surface: ["var(--praxity-color-background-alt)", "var(--praxity-color-text)"],
			accent: ["var(--praxity-color-accent)", "var(--praxity-color-background)"],
			ink: ["var(--praxity-color-text)", "var(--praxity-color-background)"],
		} as const;

		for (const [background, [expectedBackground, expectedForeground]] of Object.entries(
			tokenPairs,
		)) {
			const resolved = resolveSlideStyle("custom", {
				custom: { background: background as SlideStyleDef["background"] },
			});
			expect(resolved.variables["--slide-bg"]).toBe(expectedBackground);
			expect(resolved.variables["--slide-fg"]).toBe(expectedForeground);
			expect(Object.values(resolved.variables).join(" ")).not.toMatch(/#[\da-f]{3,8}\b/i);
		}
	});

	it("merges a course override over a built-in definition", () => {
		const resolved = resolveSlideStyle("scenario", {
			scenario: {
				background: "ink",
				chrome: "minimal",
				measure: "full",
			},
		});

		expect(resolved.chrome).toBe("minimal");
		expect(resolved.variables).toMatchObject({
			"--slide-bg": "var(--praxity-color-text)",
			"--slide-fg": "var(--praxity-color-background)",
			"--slide-measure": "100%",
			"--slide-grid-columns": "minmax(0, 1fr) minmax(0, 1fr)",
			"--slide-text-column": "1",
			"--slide-media-column": "2",
		});
	});

	it("resolves an unknown style as a console-free default", () => {
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(resolveSlideStyle("does-not-exist")).toEqual(resolveSlideStyle(undefined));
		expect(consoleWarn).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();

		consoleWarn.mockRestore();
		consoleError.mockRestore();
	});

	it("adds the accent rule to the section built-in", () => {
		expect(resolveSlideStyle("section").variables["--slide-accent-rule-width"]).toBe("4px");
		expect(resolveSlideStyle("content").variables["--slide-accent-rule-width"]).toBe("0px");
	});

	it("resolves public style properties as complete variable sets", () => {
		// Values come from docs/prax-format/reference/document-structure.md.
		const styleCases = {
			"paper-stacked": { background: "paper", mediaPlacement: "stacked" },
			"surface-left": { background: "surface", mediaPlacement: "left" },
			"accent-right": { background: "accent", mediaPlacement: "right" },
			"ink-display": { background: "ink", scale: "display" },
			"narrow-start": { measure: "narrow", align: "start" },
			"default-center": { measure: "default", align: "center" },
			"wide-ruled": { measure: "wide", accentRule: true },
			"full-minimal": { measure: "full", chrome: "minimal" },
		} satisfies Record<string, SlideStyleDef>;

		for (const [name, definition] of Object.entries(styleCases)) {
			const resolved = resolveSlideStyle(name, { [name]: definition });
			expect(Object.keys(resolved.variables).sort()).toEqual([...COMPLETE_VARIABLE_KEYS].sort());
			for (const value of Object.values(resolved.variables)) {
				expect(value).not.toBe("");
			}
		}
	});
});

describe("corner artwork", () => {
	it("uses a named definition with no automatic decoration", () => {
		expect(
			resolveSlideStyle("wash", { wash: { cornerImage: "assets/wash.png" } }).cornerImage,
		).toBe("assets/wash.png");
		expect(
			resolveSlideStyle("plain", { plain: { cornerImage: "none" } }).cornerImage,
		).toBeUndefined();
		expect(resolveSlideStyle().cornerImage).toBeUndefined();
	});
	it.each([
		null,
		3,
		{},
		[],
		"javascript:alert(1)",
		"data:text/html,test",
		"file:///secret.png",
		"https://site/a\nb.png",
		"assets\\bad.png",
	])("rejects unsafe or malformed artwork %j", (value) => {
		expect(
			resolveSlideStyle("wash", { wash: { cornerImage: value as string } }).cornerImage,
		).toBeUndefined();
	});
	it("quotes CSS URLs safely without double-encoding packaged paths", () => {
		const resolved = resolveSlideStyle("wash", {
			wash: { cornerImage: 'assets/a%20b("x");color:red.png' },
		});
		expect(resolved.variables["--slide-corner-image"]).toBe(
			'url("assets/a%20b%28%22x%22%29%3Bcolor:red.png")',
		);
		expect(
			resolveSlideStyle("wash", { wash: { cornerImage: "https://example.org/a b.png" } })
				.cornerImage,
		).toBe("https://example.org/a%20b.png");
	});
});

describe("page style selection", () => {
	const styles = {
		illustrated: { cornerImage: "assets/wash.png" },
		other: { cornerImage: "assets/other.png" },
	};
	const heading = { type: "heading", data: { level: 1, pageStyle: "illustrated" } };
	it("uses an opening H1 and explicit page metadata takes precedence", () => {
		expect(resolvePageSlideStyle({ blocks: [heading] }, styles)).toMatchObject({
			name: "illustrated",
			cornerImage: "assets/wash.png",
		});
		expect(
			resolvePageSlideStyle(
				{ data: { pageStyle: "other", style: "illustrated" }, blocks: [heading] },
				styles,
			).cornerImage,
		).toBe("assets/other.png");
		expect(
			resolvePageSlideStyle({ data: { style: "other" }, blocks: [heading] }, styles).cornerImage,
		).toBe("assets/other.png");
		expect(
			resolvePageSlideStyle({ data: { pageStyle: "plain" }, blocks: [heading] }, styles)
				.cornerImage,
		).toBeUndefined();
	});
	it("ignores later, nested, lower-level headings and ordinary heading style", () => {
		for (const blocks of [
			[{ type: "paragraph", data: {} }, heading],
			[{ type: "card", data: { children: [heading] } }],
			[{ type: "heading", data: { level: 2, pageStyle: "illustrated" } }],
			[{ type: "heading", data: { level: 1, style: "illustrated" } }],
			[{ type: "heading", data: { level: 1, cornerImage: "assets/wash.png" } }],
		])
			expect(resolvePageSlideStyle({ blocks }, styles).cornerImage).toBeUndefined();
	});
});

it("resolves accent rules from definitions, including explicit built-in overrides", () => {
	expect(
		resolveSlideStyle("custom", { custom: { accentRule: true } }).variables[
			"--slide-accent-rule-width"
		],
	).toBe("4px");
	expect(
		resolveSlideStyle("section", { section: { accentRule: false } }).variables[
			"--slide-accent-rule-width"
		],
	).toBe("0px");
	expect(
		resolveSlideStyle("custom", { custom: { accentRule: "true" as unknown as boolean } }).variables[
			"--slide-accent-rule-width"
		],
	).toBe("0px");
});
