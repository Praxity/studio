import { describe, expect, it } from "vitest";
import { textToParagraphs } from "./text-to-paragraphs";

describe("textToParagraphs", () => {
	it("escapes HTML tags in grammar lines", () => {
		const input = '```html\n<nav aria-label="Main">\n  <ul>\n```\n';
		const result = textToParagraphs(input);
		expect(result).not.toContain("<nav");
		expect(result).toContain("&lt;nav");
		expect(result).toContain("&lt;ul&gt;");
	});

	it("preserves non-HTML lines unchanged", () => {
		const input = "# Heading\nSome text\n```code";
		const result = textToParagraphs(input);
		expect(result).toContain("<p># Heading</p>");
		expect(result).toContain("<p>Some text</p>");
		expect(result).toContain("<p>```code</p>");
	});

	it("handles empty input", () => {
		expect(textToParagraphs("")).toBe("<p></p>");
	});

	it("handles empty lines (preserves paragraph breaks)", () => {
		const input = "line 1\n\nline 3";
		const result = textToParagraphs(input);
		expect(result).toBe("<p>line 1</p><p></p><p>line 3</p>");
	});

	it("escapes ampersands to prevent entity injection", () => {
		const input = "AT&T &amp; more";
		const result = textToParagraphs(input);
		expect(result).toContain("&amp;T");
		expect(result).toContain("&amp;amp;");
	});
});
