import { renderMath } from "./render-math";

export function processMathSpans(html: string): string {
	if (!html.includes("data-math-latex")) return html;
	return html.replace(
		/<span\s+[^>]*?data-math-latex="([^"]*)"[^>]*>.*?<\/span>/g,
		(match, latex) => {
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
