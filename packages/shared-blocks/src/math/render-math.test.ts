import katex from "katex";
import { describe, expect, it, vi } from "vitest";
import { sanitizeHtml } from "../sanitize";
import { processMathSpans } from "./process-math-spans";
import { renderMath } from "./render-math";

describe("equation output fidelity", () => {
	it.each([
		"\\href{https://example.invalid/}{x}",
		"\\includegraphics{https://example.invalid/image.png}",
	])("refuses inherited trust for %s", (latex) => {
		const previous = Object.getOwnPropertyDescriptor(Object.prototype, "trust");
		Object.defineProperty(Object.prototype, "trust", {
			value: true,
			writable: true,
			configurable: true,
		});
		try {
			const root = document.createElement("div");
			root.innerHTML = renderMath(latex);
			expect(root.querySelector("[href], [src]")).toBeNull();
			expect(root.textContent).toContain(latex);
		} finally {
			if (previous) Object.defineProperty(Object.prototype, "trust", previous);
			else Reflect.deleteProperty(Object.prototype, "trust");
		}
	});
	for (const display of [false, true]) {
		for (const latex of ["E=mc^2", "\\frac{1}{2}", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}"]) {
			it(`renders one MathML tree for ${display ? "display" : "inline"} ${latex}`, () => {
				const root = document.createElement("div");
				root.innerHTML = renderMath(latex, display);
				expect(root.querySelectorAll("math")).toHaveLength(1);
				expect(root.querySelector(".katex-html")).toBeNull();
				// KaTeX's speech helper does not support matrices; their native MathML
				// remains exposed, as in the existing renderer's fallback.
				if (!latex.includes("pmatrix")) {
					expect(root.querySelector('[role="math"]')?.getAttribute("aria-label")).toBeTruthy();
				}
				expect(root.querySelector("math")?.getAttribute("display")).toBe(display ? "block" : null);
				expect(root.querySelector("math")?.getAttribute("aria-hidden")).not.toBe("true");
			});
		}
	}

	it("keeps invalid source readable and escapes markup", () => {
		const latex = '\\invalid{<img src=x onerror="alert(1)">';
		const root = document.createElement("div");
		root.innerHTML = renderMath(latex);
		expect(root.textContent).toBe(latex);
		expect(root.querySelector("img")).toBeNull();
	});

	it("keeps escaped authored source when the external renderer throws", () => {
		const renderer = vi.spyOn(katex, "renderToString").mockImplementation(() => {
			throw new Error("Renderer unavailable");
		});
		try {
			const latex = '<img src=x onerror="alert(1)">';
			const root = document.createElement("div");
			root.innerHTML = renderMath(latex);
			expect(root.querySelector(".praxity-math-error")?.textContent).toBe(latex);
			expect(root.querySelector("img")).toBeNull();
		} finally {
			renderer.mockRestore();
		}
	});

	it("renders nothing for blank source", () => {
		expect(renderMath("")).toBe("");
		expect(renderMath("   ")).toBe("");
	});

	it("wraps inline math in a span and display math in a div", () => {
		expect(renderMath("x^2", false)).toMatch(/^<span role="math"/);
		expect(renderMath("x^2", true)).toMatch(/^<div role="math"/);
	});

	it("leaves HTML without math spans unchanged", () => {
		const html = "<p>Hello world</p>";
		expect(processMathSpans(html)).toBe(html);
	});

	it("decodes attribute entities before rendering", () => {
		const root = document.createElement("div");
		root.innerHTML = processMathSpans(
			'<p><span class="praxity-math-inline" data-math-latex="a &lt; b">a &lt; b</span></p>',
		);
		expect(root.querySelector(".praxity-math-error")).toBeNull();
		expect(root.querySelector("mo")?.textContent).toBe("<");
	});

	it("renders math after sanitizeHtml keeps its source attribute", () => {
		const root = document.createElement("div");
		root.innerHTML = processMathSpans(
			sanitizeHtml(
				'<p>Half <span class="praxity-math-inline" data-math-latex="\\frac{1}{2}">fallback</span>.</p>',
			),
		);
		expect(root.querySelectorAll("mfrac")).toHaveLength(1);
		expect(root.querySelector("[data-math-latex]")?.getAttribute("data-math-latex")).toBe(
			"\\frac{1}{2}",
		);
	});

	it("retains a single fraction in sanitized inline span output", () => {
		const root = document.createElement("div");
		root.innerHTML = processMathSpans(
			'<p>Half <span class="praxity-math-inline" data-math-latex="\\frac{1}{2}">fallback</span>.</p>',
		);
		expect(root.querySelectorAll("math")).toHaveLength(1);
		expect(root.querySelectorAll("mfrac")).toHaveLength(1);
		expect(root.querySelector(".katex-html")).toBeNull();
		expect(root.querySelector('[role="math"]')?.getAttribute("aria-label")).toContain("fraction");
	});
});
