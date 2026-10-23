import { describe, expect, it } from "vitest";
import { classifyFocusLines } from "./focus-mode-extension";

describe("focus-mode-extension", () => {
	it("returns focus-active for the block containing the cursor", () => {
		const classes = classifyFocusLines(["## Title", "Line one", "", "Line two"], 1);
		expect(classes[0]).toBe("focus-active");
		expect(classes[1]).toBe("focus-active");
	});

	it("returns focus-page for same-page blocks", () => {
		const classes = classifyFocusLines(["First block", "", "Second block"], 0);
		expect(classes[2]).toBe("focus-page");
	});

	it("returns focus-dim for off-page blocks", () => {
		const classes = classifyFocusLines(["First block", "---", "Second page"], 0);
		expect(classes[2]).toBe("focus-dim");
	});

	it("page breaks always get focus-active", () => {
		const classes = classifyFocusLines(["First block", "---", "Second page"], 2);
		expect(classes[1]).toBe("focus-active");
	});
});
