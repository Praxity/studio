import { describe, expect, it } from "vitest";
import { parseEffectsExpression, serializeEffectsExpression } from "../src/utils.ts";

describe("image effects expressions", () => {
	it("parses none and an empty expression", () => {
		expect(parseEffectsExpression("none")).toBe("none");
		expect(parseEffectsExpression("")).toEqual({});
	});

	it("parses bare, parameterized, and multiple effects", () => {
		expect(parseEffectsExpression("grain")).toEqual({ grain: { intensity: -1 } });
		expect(parseEffectsExpression("motionBlur(15 45)")).toEqual({
			motionBlur: { intensity: 15, direction: 45 },
		});
		expect(parseEffectsExpression("grain(30) colorWash(60 secondary)")).toEqual({
			grain: { intensity: 30 },
			colorWash: { intensity: 60, color: "secondary" },
		});
	});

	it("ignores unknown effects and handles malformed magnitudes", () => {
		expect(parseEffectsExpression("fakeEffect(50) grain(abc)")).toEqual({
			grain: { intensity: 0 },
		});
		expect(parseEffectsExpression("grain(30 colorWash(60)")).toBeDefined();
	});

	it("serializes magnitudes, secondary params, and automatic effects", () => {
		expect(serializeEffectsExpression("none")).toBe("none");
		expect(serializeEffectsExpression({ grain: { intensity: -1 } })).toBe("grain");
		expect(
			serializeEffectsExpression({
				grain: { intensity: 30 },
				colorWash: { intensity: 60, color: "secondary" },
			}),
		).toBe("grain(30) colorWash(60 secondary)");
	});
});
