import { MantineProvider } from "@mantine/core";
import type { DesignVariants } from "@praxity/grammar";
import { resolveDesignTokens } from "@praxity/shared-blocks/themes/resolve-design-tokens";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { THEME_PRESET_DEFAULTS } from "../lib/themes/theme-preset-defaults";
import { ThemePreviewThumbnail } from "./theme-preview-thumbnail";

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
});

function cssColor(value: string): string {
	const element = document.createElement("span");
	element.style.backgroundColor = value;
	return element.style.backgroundColor;
}

describe("ThemePreviewThumbnail", () => {
	it("shows the preset heading face and loads it in the editor", () => {
		const { container } = render(
			<MantineProvider>
				<ThemePreviewThumbnail preset="campfire" overrides={{}} />
			</MantineProvider>,
		);
		const glyph = container.querySelector<HTMLElement>(".theme-preview-heading-glyph");
		const chip = container.querySelector<HTMLElement>(".theme-preview-button-chip");

		expect(glyph?.style.fontFamily).toBe('"Source Sans 3", sans-serif');
		expect(glyph?.style.fontWeight).toBe("600");
		expect(document.querySelector('link[id^="praxity-font-source-sans-3-"]')).not.toBeNull();
		expect(chip?.style.boxShadow).toBe("");
	});

	it("uses the selected preset's resolved light and dark color roles", () => {
		const variants = { ...THEME_PRESET_DEFAULTS.clean, palette: "clean" } as DesignVariants;
		const expected = {
			light: resolveDesignTokens(variants, "light"),
			dark: resolveDesignTokens(variants, "dark"),
		};
		const { container } = render(
			<MantineProvider>
				<ThemePreviewThumbnail preset="clean" overrides={{}} mode="light" />
				<ThemePreviewThumbnail preset="clean" overrides={{}} mode="dark" />
			</MantineProvider>,
		);

		for (const mode of ["light", "dark"] as const) {
			const root = container.querySelector<HTMLElement>(`[data-theme-mode="${mode}"]`);
			const navigation = root?.querySelector<HTMLElement>(".theme-preview-navigation");
			const page = root?.querySelector<HTMLElement>(".theme-preview-page");
			const statuses = Array.from(
				root?.querySelectorAll<HTMLElement>(".theme-preview-status") ?? [],
			);

			expect(root?.dataset.themePreset).toBe("ink");
			expect(root?.style.backgroundColor).toBe(
				cssColor(expected[mode]["--praxity-color-background"]),
			);
			expect(navigation?.style.backgroundColor).toBe(
				cssColor(
					expected[mode]["--praxity-color-navigation-surface"] ??
						expected[mode]["--praxity-color-surface"],
				),
			);
			expect(page?.style.backgroundColor).toBe(cssColor(expected[mode]["--praxity-color-surface"]));
			expect(statuses.map((status) => status.style.backgroundColor)).toEqual(
				["success", "warning", "error"].map((role) =>
					cssColor(expected[mode][`--praxity-color-${role}`]),
				),
			);
		}
	});

	it.each(["marquee", "darkroom"] as const)(
		"maps saved %s to Plum on plain light paper",
		(preset) => {
			const { container } = render(
				<MantineProvider>
					<ThemePreviewThumbnail preset={preset} overrides={{}} />
				</MantineProvider>,
			);

			expect(container.querySelector("[data-theme-mode='light']")).not.toBeNull();
			expect(container.querySelector<HTMLElement>("[data-theme-mode]")?.dataset.themePreset).toBe(
				"plum",
			);
		},
	);
});
