/// <reference path="../katex-contrib.d.ts" />
import katex from "katex";
import renderA11yString from "katex/contrib/render-a11y-string";
import { escapeHtml } from "../constants";

export function renderMath(latex: string, displayMode = false): string {
	if (!latex.trim()) return "";
	try {
		const html = katex.renderToString(latex, {
			displayMode,
			throwOnError: false,
			output: "mathml",
		});
		const speech = renderMathSpeech(latex);
		if (!speech) return html;
		const tag = displayMode ? "div" : "span";
		return `<${tag} role="math" aria-label="${escapeHtml(speech)}">${html}</${tag}>`;
	} catch {
		return `<span class="praxity-math-error">${escapeHtml(latex)}</span>`;
	}
}

function renderMathSpeech(latex: string): string | null {
	try {
		return renderA11yString(latex);
	} catch {
		return null;
	}
}
