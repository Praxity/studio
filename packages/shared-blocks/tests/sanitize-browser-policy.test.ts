import DOMPurify, { clearConfig, setConfig } from "isomorphic-dompurify";
import { afterEach, expect, it, vi } from "vitest";
import { sanitizeHtml } from "../src/sanitize";

vi.mock("isomorphic-dompurify", async (importOriginal) => {
	const original = await importOriginal<typeof import("isomorphic-dompurify")>();
	const purifier = original.default(window);
	// Match the browser adapter: named exports bind methods at module load.
	return {
		default: purifier,
		setConfig: purifier.setConfig.bind(purifier),
		clearConfig: purifier.clearConfig.bind(purifier),
	};
});

afterEach(() => {
	DOMPurify.removeAllHooks();
	clearConfig();
});

it("preserves browser policies changed through previously bound named exports", () => {
	const input = "<strong>Browser policy</strong>";
	expect(sanitizeHtml(input)).toBe(input);
	setConfig({ ALLOWED_TAGS: [] });
	expect(sanitizeHtml(input)).toBe("Browser policy");
	clearConfig();
	expect(sanitizeHtml(input)).toBe(input);
});
