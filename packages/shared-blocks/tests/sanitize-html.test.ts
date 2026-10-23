import { describe, expect, it } from "vitest";
import { htmlToPlainText, sanitizeHtml } from "../src/sanitize";

describe("htmlToPlainText", () => {
	it("decodes entities once and preserves French non-breaking spaces", () => {
		expect(htmlToPlainText("<p>Classez <em>chaque énoncé</em>&nbsp;: fait\u202f?</p>")).toBe(
			"Classez chaque énoncé \u00a0: fait\u202f?",
		);
		expect(htmlToPlainText("A\u00a0: B\u202f? &#160; &#x202f; &amp; &eacute;")).toBe(
			"A\u00a0: B\u202f? \u00a0 \u202f & é",
		);
		expect(htmlToPlainText("Literal &amp;nbsp; &lt;img src=x&gt;")).toBe(
			"Literal &nbsp; <img src=x>",
		);
	});
	it("keeps tag boundaries and removes unsafe content without executing it", () => {
		expect(
			htmlToPlainText("<p>First</p><p>Second</p><script>secret()</script><style>p{}</style>"),
		).toBe("First Second");
	});
	it("retains generated MathML text used in accessible labels", () => {
		expect(htmlToPlainText("<math><mi>x</mi><mo>&lt;</mo><mn>2</mn></math>")).toBe("x < 2");
	});
});

describe("sanitizeHtml", () => {
	it("strips SVG elements from authored HTML", () => {
		const input =
			'<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 10 10"/><circle cx="5" cy="5" r="4"/></svg>';
		const output = sanitizeHtml(input);

		expect(output).not.toContain("<svg");
		expect(output).not.toContain("<path");
		expect(output).not.toContain("<circle");
	});

	it("keeps a text tooltip fallback without sanitized markup", () => {
		const output = sanitizeHtml(
			'<span data-tooltip-content="&lt;strong&gt;Safe&lt;/strong&gt;&lt;img src=x onerror=alert(1)&gt;">Term</span>',
		);
		const container = document.createElement("div");
		container.innerHTML = output;
		const fallback = container.querySelector(".inline-tooltip-fallback");

		expect(fallback?.textContent).toBe(" (Safe)");
		expect(fallback?.children).toHaveLength(0);
	});
});
