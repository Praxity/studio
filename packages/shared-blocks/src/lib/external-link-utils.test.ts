import { describe, expect, it } from "vitest";
import { EXTERNAL_LINK_ICON_HTML, externalLinkIndicatorHtml } from "./external-link-utils";

it("preserves generated indicator markup and escapes its text", () => {
	expect(externalLinkIndicatorHtml("(opens in new tab)")).toBe(
		`${EXTERNAL_LINK_ICON_HTML}<span class="praxity-sr-only">, (opens in new tab)</span>`,
	);
	expect(externalLinkIndicatorHtml("<text & more>")).toContain("&lt;text &amp; more&gt;");
	expect(externalLinkIndicatorHtml('"quoted"')).toContain("&quot;quoted&quot;");
});

describe("EXTERNAL_LINK_ICON_HTML", () => {
	it("contains aria-hidden for screen readers", () => {
		expect(EXTERNAL_LINK_ICON_HTML).toContain('aria-hidden="true"');
	});

	it("uses currentColor for theme compatibility", () => {
		expect(EXTERNAL_LINK_ICON_HTML).toContain("currentColor");
	});
});
