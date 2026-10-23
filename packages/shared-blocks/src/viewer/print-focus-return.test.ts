// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { preservePrintFocus } from "./print-focus-return";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});
it("leaves no focus return after a platform listener registration fails", () => {
	const root = document.createElement("div");
	const button = document.createElement("button");
	root.append(button);
	document.body.append(root);
	vi.spyOn(document, "addEventListener").mockImplementationOnce(() => {
		throw new Error("print registration");
	});
	expect(() => preservePrintFocus(root)).toThrow("print registration");
	button.focus();
	window.dispatchEvent(new Event("beforeprint"));
	button.blur();
	window.dispatchEvent(new Event("afterprint"));
	expect(document.activeElement).toBe(document.body);
});
it("cleanup cancels a captured print return while the activity remains connected", () => {
	const root = document.createElement("div");
	const button = document.createElement("button");
	root.append(button);
	document.body.append(root);
	const cleanup = preservePrintFocus(root);
	button.focus();
	window.dispatchEvent(new Event("beforeprint"));
	cleanup();
	button.blur();
	window.dispatchEvent(new Event("afterprint"));
	expect(document.activeElement).toBe(document.body);
});
