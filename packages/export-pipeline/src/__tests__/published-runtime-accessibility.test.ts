// @vitest-environment jsdom

import { initInlineTooltips } from "@praxity/shared-blocks/viewer/inline-tooltips";
import { afterEach, describe, expect, it } from "vitest";

describe("published runtime accessibility", () => {
	let cleanup = () => {};

	afterEach(() => {
		cleanup();
		cleanup = () => {};
		document.body.replaceChildren();
	});

	it("keeps native tooltip triggers as links and popovers out of the landmark list", () => {
		document.body.innerHTML = `
			<div id="praxity-live-region"></div>
			<span id="generic" data-tooltip-content="Generic definition">Term</span>
			<a id="link" href="#definition" data-tooltip-content="Linked definition">Linked term</a>`;
		window.requestAnimationFrame = (callback) => {
			callback(0);
			return 1;
		};
		cleanup = initInlineTooltips("has definition", "(opens in a new tab)");

		const generic = document.getElementById("generic");
		const link = document.getElementById("link");
		expect(generic?.getAttribute("role")).toBe("button");
		expect(generic?.getAttribute("tabindex")).toBe("0");
		expect(generic?.hasAttribute("data-tooltip-enhanced")).toBe(true);
		expect(generic?.textContent).toContain("has definition");
		expect(link?.hasAttribute("role")).toBe(false);
		expect(link?.hasAttribute("tabindex")).toBe(false);

		link?.focus();
		const popover = document.querySelector(".inline-tooltip-popover");
		expect(popover?.getAttribute("role")).toBe("definition");
		expect(popover?.hasAttribute("aria-label")).toBe(false);
		const description = document.getElementById(link?.getAttribute("aria-describedby") ?? "");
		expect(description?.textContent).toBe("Linked definition");
		expect(popover?.getAttribute("aria-labelledby")).toBe(link?.id);

		const click = new MouseEvent("click", { bubbles: true, cancelable: true });
		expect(link?.dispatchEvent(click)).toBe(true);
		expect(click.defaultPrevented).toBe(false);
	});

	it("sanitizes tooltip HTML before inserting the popover", () => {
		document.body.innerHTML = '<div id="praxity-live-region"></div><span id="term">Term</span>';
		const term = document.getElementById("term");
		term?.setAttribute(
			"data-tooltip-content",
			'<img src="x" onerror="bad()"><a href="javascript:bad()" onclick="bad()">Safe link</a><script>bad()</script>',
		);
		window.requestAnimationFrame = (callback) => {
			callback(0);
			return 1;
		};
		cleanup = initInlineTooltips("has definition", "(opens in a new tab)");

		term?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

		const popover = document.querySelector(".inline-tooltip-popover");
		expect(popover?.querySelector("img, script")).toBeNull();
		expect(popover?.querySelector("a")?.hasAttribute("href")).toBe(false);
		expect(popover?.querySelector("a")?.hasAttribute("onclick")).toBe(false);
	});
});
