// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("code island", () => {
	beforeEach(() => {
		vi.resetModules();
		document.body.innerHTML = `
			<div class="praxity-code-container">
				<button type="button" data-code-copy>Copy</button>
				<div data-code-copy-status></div>
				<code data-code-content><span data-code-line>const answer = 42;</span><span data-code-line>answer;</span></code>
			</div>`;
		window.__PRAXITY_STRINGS__ = {
			copied: "Copied!",
			copyLabel: "Copy",
			copiedToClipboard: "Copied to clipboard",
		};
	});

	it("copies source text and announces success", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		await import("../../template/src/islands/island-code");

		document.querySelector<HTMLButtonElement>("[data-code-copy]")?.click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("const answer = 42;\nanswer;"));
		expect(document.querySelector("[data-code-copy-status]")?.textContent).toBe(
			"Copied to clipboard",
		);
	});
});
