import { describe, expect, it } from "vitest";
import { resolveDoodleColor, resolveHighlightColor } from "./doodle-utils";

describe("resolveHighlightColor", () => {
	it("uses an authored highlight background for custom modifiers", () => {
		const highlight = document.createElement("span");
		highlight.style.backgroundColor = "rgb(255, 214, 77)";
		document.body.append(highlight);

		expect(resolveHighlightColor(getComputedStyle(highlight), new Set(["reworded"]))).toBe(
			"rgb(255, 214, 77)",
		);
		highlight.remove();
	});

	it("maps yellow and warning modifiers to warning theme tokens", () => {
		const highlight = document.createElement("span");
		highlight.style.setProperty("--praxity-color-warning", "#765000");
		highlight.style.setProperty("--praxity-color-warning-light", "#fff3bf");
		document.body.append(highlight);
		const style = getComputedStyle(highlight);

		expect(resolveDoodleColor(style, new Set(["yellow"]))).toBe("#765000");
		expect(resolveDoodleColor(style, new Set(["warning"]))).toBe("#765000");
		expect(resolveHighlightColor(style, new Set(["yellow"]))).toBe("#fff3bf");
		expect(resolveHighlightColor(style, new Set(["warning"]))).toBe("#fff3bf");
		highlight.remove();
	});
});
