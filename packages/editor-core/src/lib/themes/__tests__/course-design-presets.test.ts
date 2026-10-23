import { readLesson } from "@praxity/grammar";
import { READING_PALETTES } from "@praxity/shared-blocks/themes/reading-palettes";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { describe, expect, it } from "vitest";
import { normalizeDesignVariants } from "../normalize-design-variants";
import { THEME_PRESET_DEFAULTS } from "../theme-preset-defaults";

function ratio(first: string, second: string): number {
	const luminance = (hex: string) => {
		const channels = [1, 3, 5]
			.map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
			.map((channel) =>
				channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
			);
		return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	};
	const a = luminance(first);
	const b = luminance(second);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const ids = ["ink", "forest", "plum", "clay", "clear"];

describe("course palette and pairing", () => {
	it("each preset owns its canonical ID", () => {
		for (const id of ids)
			expect(THEME_PRESET_DEFAULTS[id as keyof typeof THEME_PRESET_DEFAULTS].palette).toBe(id);
	});
	it("preserves a legacy custom paper seed at the export interface", () => {
		expect(
			resolveDesignTokens({ palette: "custom", colorBackground: "#fefbf7" } as never, "light")[
				"--paper"
			],
		).toBe("#fefbf7");
	});
	it("offers exactly Ink, Forest, Plum, Clay and Clear", () => {
		expect(Object.keys(THEME_PRESET_DEFAULTS)).toEqual(ids);
		expect(Object.keys(READING_PALETTES)).toEqual(ids);
	});
	for (const id of ids)
		for (const mode of ["light", "dark"] as const) {
			it(`${id} ${mode} has reading contrast and a single accent`, () => {
				const palettes = READING_PALETTES as unknown as Record<
					string,
					Record<string, Record<string, string>>
				>;
				const palette = palettes[id]?.[mode];
				expect(palette, `missing ${id} ${mode}`).toBeDefined();
				if (!palette) throw new Error(`Missing ${id} ${mode}`);
				expect(ratio(palette.colorText, palette.colorBackground)).toBeGreaterThanOrEqual(12);
				expect(ratio(palette.colorTextMuted, palette.colorBackground)).toBeGreaterThanOrEqual(7);
				expect(ratio(palette.colorBorder, palette.colorBackground)).toBeGreaterThanOrEqual(3);
				expect(ratio(palette.colorAccent, palette.colorBackground)).toBeGreaterThanOrEqual(
					id === "clay" ? 6 : 4.5,
				);
				expect(ratio(palette.colorButtonText, palette.colorAccent)).toBeGreaterThanOrEqual(4.5);
				for (const role of ["colorSuccess", "colorError", "colorWarning"])
					expect(ratio(palette[role], palette.colorBackground), role).toBeGreaterThanOrEqual(4.5);
				const design = normalizeDesignVariants({ palette: id });
				const tokens = resolveDesignTokens(design, mode);
				for (const [role, floor] of [
					["--ink", 12],
					["--ink-2", 7],
					["--line", 3],
					["--accent", id === "clay" ? 6 : 4.5],
				] as const)
					expect(ratio(tokens[role], tokens["--paper"]), role).toBeGreaterThanOrEqual(floor);
				expect(tokens["--praxity-color-button-background"]).toBe(tokens["--accent"]);
				expect(design.typography.body.fontFamily[0]).toBe("Source Sans 3");
				expect(design.typography.headings.fontFamily[0]).toBe("Source Sans 3");
			});
		}
	it.each([
		["standard", "ink"],
		["waves", "ink"],
		["clean", "ink"],
		["minimal", "ink"],
		["grove", "forest"],
		["bauhaus", "forest"],
		["blueprint", "forest"],
		["marquee", "plum"],
		["darkroom", "plum"],
		["campfire", "clay"],
		["dunes", "clay"],
	])("maps saved %s to %s in grammar and editor", (old, id) => {
		expect(
			readLesson(`---\ndesign:\n  palette: ${old}\n---\n# Course`).frontmatter.design?.palette,
		).toBe(id);
		expect(normalizeDesignVariants({ palette: old }).palette).toBe(id);
	});
	it("migrates stored preset defaults before replacing the saved ID", () => {
		const legacy = {
			palette: "darkroom",
			colorMode: "light",
			colorBackgroundLight: "#faf5fc",
			colorBackgroundDark: "#211a2c",
			colorBackground: "#faf5fc",
			colorAccent: "#523069",
		};
		for (const design of [
			normalizeDesignVariants(legacy),
			readLesson(`---\ndesign: ${JSON.stringify(legacy)}\n---\n# Course`).frontmatter.design,
		]) {
			expect(design?.palette).toBe("plum");
			expect(design?.colorBackgroundLight).toBe("#ffffff");
			expect(design?.colorBackgroundDark).toBe("#121417");
			expect(design?.colorAccent).toBe("#633655");
		}
		const published = resolveDesignTokens(legacy as never, "light");
		expect(published["--paper"]).toBe("#ffffff");
		expect(published["--accent"]).toBe("#633655");
	});
	it("preserves authored colours on legacy and current presets", () => {
		for (const palette of ["darkroom", "plum", "custom", "__proto__", "constructor"]) {
			const design = normalizeDesignVariants({
				palette,
				colorAccent: "#2b5577",
				colorBackgroundLight: "#fefbf7",
				colorBackgroundDark: "#121212",
			});
			expect(design.colorAccent).toBe("#2b5577");
			expect(design.colorBackgroundLight).toBe("#fefbf7");
			expect(design.colorBackgroundDark).toBe("#121212");
		}
	});
	it("keeps custom accent and paper while adopting the course pairing", () => {
		const design = normalizeDesignVariants({
			palette: "custom",
			colorAccent: "#2b5577",
			colorBackgroundLight: "#fefbf7",
			colorBackgroundDark: "#121212",
			typography: {
				body: { fontFamily: ["Inter", "sans-serif"] },
				headings: { fontFamily: ["Merriweather", "serif"] },
			},
		});
		expect(design.colorAccent).toBe("#2b5577");
		expect(design.colorBackgroundLight).toBe("#fefbf7");
		expect(design.typography.body.fontFamily[0]).toBe("Source Sans 3");
	});
});
