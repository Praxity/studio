import { describe, expect, it } from "vitest";
import { sanitizeCss } from "../sanitize-css";

describe("sanitizeCss", () => {
	it("passes valid CSS through unchanged", () => {
		const css = ".praxity-block { color: red; }";
		expect(sanitizeCss(css)).toBe(css);
	});

	it("strips <script> tags", () => {
		expect(sanitizeCss('<script>alert("xss")</script>')).not.toContain("<script>");
	});

	it("strips expression()", () => {
		expect(sanitizeCss("div { width: expression(alert(1)); }")).not.toContain("expression(");
	});

	it("strips url(javascript:)", () => {
		expect(sanitizeCss("div { background: url(javascript:alert(1)); }")).not.toContain(
			"javascript:",
		);
	});

	it("strips @import", () => {
		expect(sanitizeCss('@import url("evil.css");')).not.toContain("@import");
	});

	it("allows @media queries", () => {
		const css = "@media (max-width: 600px) { .praxity-block { font-size: 14px; } }";
		expect(sanitizeCss(css)).toContain("@media");
	});

	it("returns empty string for empty input", () => {
		expect(sanitizeCss("")).toBe("");
	});

	it("strips -moz-binding", () => {
		expect(sanitizeCss("div { -moz-binding: url('xbl'); }")).not.toContain("-moz-binding");
	});

	it("strips behavior:", () => {
		expect(sanitizeCss("div { behavior: url('evil.htc'); }")).not.toContain("behavior:");
	});
});
