import { describe, expect, it } from "vitest";
import { processMathSpans } from "../../src/math/process-math-spans";
import { sanitizeHtml } from "../../src/sanitize";

describe("data-math-latex sanitization round-trip", () => {
	it("preserves data-math-latex attributes through sanitizeHtml", () => {
		const html =
			'<p>Hello <span class="praxity-math-inline" data-math-latex="x^2">x^2</span> world</p>';
		const sanitized = sanitizeHtml(html);
		expect(sanitized).toContain("data-math-latex");
		expect(sanitized).toContain("praxity-math-inline");
	});

	it("renders math from sanitized HTML correctly", () => {
		const html =
			'<p>Inline <span class="praxity-math-inline" data-math-latex="\\frac{a}{b}">\\frac{a}{b}</span> here</p>';
		const sanitized = sanitizeHtml(html);
		const withMath = processMathSpans(sanitized);
		expect(withMath).toContain("katex");
	});

	it("handles special characters in LaTeX through sanitize + processMathSpans", () => {
		const html =
			'<p><span class="praxity-math-inline" data-math-latex="a &amp; b &lt; c">fallback</span></p>';
		const sanitized = sanitizeHtml(html);
		const withMath = processMathSpans(sanitized);
		expect(withMath).toContain("praxity-math-inline");
	});
});
