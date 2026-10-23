import { hexToOklch } from "@praxity/shared-blocks/color-math";
import { describe, expect, it } from "vitest";
import { generateColorShades } from "../generate-color-shades";

describe("generateColorShades", () => {
	it("returns exactly 10 shades", () => {
		const shades = generateColorShades("#228be6");
		expect(shades).toHaveLength(10);
	});

	it("all shades are valid hex colors", () => {
		const shades = generateColorShades("#228be6");
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("preserves the input color at the closest lightness index", () => {
		const input = "#228be6";
		const shades = generateColorShades(input);
		expect(shades).toContain(input);
	});

	it("produces light-to-dark gradient (shade 0 is lightest, shade 9 is darkest)", () => {
		const shades = generateColorShades("#228be6");
		// Parse luminance from hex for first and last
		const luminance = (hex: string) => {
			const r = Number.parseInt(hex.slice(1, 3), 16);
			const g = Number.parseInt(hex.slice(3, 5), 16);
			const b = Number.parseInt(hex.slice(5, 7), 16);
			return 0.299 * r + 0.587 * g + 0.114 * b;
		};
		expect(luminance(shades[0])).toBeGreaterThan(luminance(shades[9]));
	});

	it("keeps adjacent perceptual steps even across representative hues", () => {
		for (const seed of ["#4269d0", "#dc2626", "#e67700"]) {
			const colors = generateColorShades(seed).map(hexToOklch);
			const distances = colors.slice(1).map(([L, C, H], index) => {
				const [previousL, previousC, previousH] = colors[index];
				const radians = (H * Math.PI) / 180;
				const previousRadians = (previousH * Math.PI) / 180;
				return Math.hypot(
					L - previousL,
					C * Math.cos(radians) - previousC * Math.cos(previousRadians),
					C * Math.sin(radians) - previousC * Math.sin(previousRadians),
				);
			});
			expect(Math.max(...distances) / Math.min(...distances), seed).toBeLessThan(1.65);
		}
	});

	it("handles pure black", () => {
		const shades = generateColorShades("#000000");
		expect(shades).toHaveLength(10);
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("handles pure white", () => {
		const shades = generateColorShades("#ffffff");
		expect(shades).toHaveLength(10);
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("handles gray (zero saturation)", () => {
		const shades = generateColorShades("#808080");
		expect(shades).toHaveLength(10);
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("handles short hex notation", () => {
		const shades = generateColorShades("#f0f");
		expect(shades).toHaveLength(10);
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});
