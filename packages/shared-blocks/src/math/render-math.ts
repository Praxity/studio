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
			// Native MathML paints once without requiring the KaTeX HTML stylesheet.
			output: "mathml",
		});
		const speech = renderMathSpeech(latex);
		if (!speech) return html;
		// Wrap with aria-label so screen readers that don't parse MathML still get a readable string
		const tag = displayMode ? "div" : "span";
		return `<${tag} role="math" aria-label="${escapeHtml(speech)}">${html}</${tag}>`;
	} catch {
		// Keep authored source readable if rendering fails, in every course language.
		return `<span class="praxity-math-error">${escapeHtml(latex)}</span>`;
	}
}

/**
 * Generate a human-readable speech string from LaTeX using KaTeX's a11y contrib.
 * Returns null if generation fails (invalid LaTeX, etc.) — caller falls back to MathML only.
 */
function renderMathSpeech(latex: string): string | null {
	try {
		return renderA11yString(latex);
	} catch {
		return null;
	}
}
