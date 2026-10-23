import { renderMath } from "./render-math";

/**
 * Render inline math spans after sanitizing authored HTML. Shared components
 * and the compiled preview/export renderer use the same MathML output.
 */
export function processMathSpans(html: string): string {
	if (!html.includes("data-math-latex")) return html; // fast path
	// Match spans with both class="praxity-math-inline" and data-math-latex in any order
	return html.replace(
		/<span\s+[^>]*?data-math-latex="([^"]*)"[^>]*>.*?<\/span>/g,
		(match, latex) => {
			// Verify the span has the correct class (attribute order varies across serializers)
			if (!match.includes("praxity-math-inline")) return match;
			const decoded = decodeHtmlEntities(latex);
			const rendered = renderMath(decoded, false);
			return `<span class="praxity-math-inline" data-math-latex="${latex}">${rendered}</span>`;
		},
	);
}

function decodeHtmlEntities(str: string): string {
	return str
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"');
}
