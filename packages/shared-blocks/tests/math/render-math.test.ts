import { describe, expect, it } from "vitest";
import { processMathSpans } from "../../src/math/process-math-spans";
import { renderMath } from "../../src/math/render-math";

describe("renderMath", () => {
	it("renders valid LaTeX without error", () => {
		const result = renderMath("E = mc^2");
		expect(result).toContain("katex");
		expect(result).not.toContain("praxity-math-error");
	});

	it("renders invalid LaTeX as error span, not a throw", () => {
		const result = renderMath("\\invalid{");
		// throwOnError: false means KaTeX returns error markup, not an exception
		expect(result).toBeTruthy();
	});

	it("returns empty string for empty input", () => {
		expect(renderMath("")).toBe("");
		expect(renderMath("   ")).toBe("");
	});

	it("produces display math when displayMode is true", () => {
		const result = renderMath("x^2", true);
		expect(result).toContain('display="block"');
	});

	it("produces inline math when displayMode is false", () => {
		const result = renderMath("x^2", false);
		expect(result).not.toContain('display="block"');
	});

	it("includes MathML output for screen readers", () => {
		const result = renderMath("x^2");
		expect(result).toContain("<math");
	});

	it("wraps output with role='math' and aria-label speech string", () => {
		const result = renderMath("\\frac{1}{2}");
		expect(result).toContain('role="math"');
		expect(result).toContain("aria-label=");
		expect(result).toContain("fraction");
	});

	it("uses <span> wrapper for inline math", () => {
		const result = renderMath("x^2", false);
		expect(result).toMatch(/^<span role="math"/);
	});

	it("uses <div> wrapper for display math", () => {
		const result = renderMath("x^2", true);
		expect(result).toMatch(/^<div role="math"/);
	});
});

describe("processMathSpans", () => {
	it("replaces inline math spans with KaTeX output", () => {
		const html =
			'<p>Hello <span class="praxity-math-inline" data-math-latex="x^2">x^2</span> world</p>';
		const result = processMathSpans(html);
		expect(result).toContain("katex");
		expect(result).toContain('data-math-latex="x^2"');
	});

	it("is a no-op on HTML without math spans (fast path)", () => {
		const html = "<p>Hello world</p>";
		expect(processMathSpans(html)).toBe(html);
	});

	it("handles special characters in data-math-latex attributes", () => {
		const html =
			'<p><span class="praxity-math-inline" data-math-latex="\\frac{a}{b}">\\frac{a}{b}</span></p>';
		const result = processMathSpans(html);
		expect(result).toContain("katex");
	});

	it("handles HTML-encoded entities in data-math-latex", () => {
		const html =
			'<p><span class="praxity-math-inline" data-math-latex="a &amp; b &lt; c">a &amp; b &lt; c</span></p>';
		const result = processMathSpans(html);
		expect(result).toContain("praxity-math-inline");
	});
});
