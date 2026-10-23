import { describe, expect, it } from "vitest";
import { getSectionDividerModel } from "./section-grouping";

describe("getSectionDividerModel", () => {
	it("supports blend transitions", () => {
		const model = getSectionDividerModel("blend", "light", "dark");

		expect(model).not.toBeNull();
		expect(model?.shape).toBe("blend");
		expect(model?.gradientId).toContain("blend");
		expect(model?.pathData).toBeUndefined();
		expect(model?.svgInnerMarkup).toContain("linearGradient");
	});

	it("keeps gradient as a backward-compatible alias", () => {
		const model = getSectionDividerModel("gradient", "light", "dark");

		expect(model).not.toBeNull();
		expect(model?.shape).toBe("gradient");
		expect(model?.gradientId).toContain("gradient");
		expect(model?.pathData).toBeUndefined();
		expect(model?.svgInnerMarkup).toContain("linearGradient");
	});

	it("supports thin divider style", () => {
		const model = getSectionDividerModel("thin", "light", "dark");

		expect(model).not.toBeNull();
		expect(model?.shape).toBe("thin");
		expect(model?.pathData).toBeUndefined();
		expect(model?.svgInnerMarkup).toContain("<rect");
	});

	it("supports ornamental divider style", () => {
		const model = getSectionDividerModel("ornamental", "light", "dark");

		expect(model).not.toBeNull();
		expect(model?.shape).toBe("ornamental");
		expect(model?.pathData).toBeDefined();
		expect(model?.svgInnerMarkup).toContain("<path");
	});
});
