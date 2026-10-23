// Adapted from learning-patterns/patterns/highlight/render.js at
// b3f82d2415982da20dda28b61770d7e85084901b. Copyright (c) 2026 Ariel Harlap.
// MIT licensed; see LICENSE in this folder. Studio owns this presentation.
import { normalizeHeadingLevel } from "@praxity/shared-blocks/heading-styles";
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import { labelWithSeparator } from "@praxity/shared-blocks/i18n/label-separator";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import type { HighlightContent } from "@praxity/shared-blocks/types";
import { markLimit, validateContent } from "learning-patterns/patterns/highlight/logic.js";
import { strings } from "learning-patterns/patterns/highlight/strings.js";
import { escapeJsonForHtml } from "../../escape-json-for-html.ts";
import { escapeHtml } from "../../published-markup.ts";
import { formatCount } from "./format-count.ts";

/** Literal public content. The baseline has only the native Answer control. */
export function renderHighlight(
	content: HighlightContent,
	{ prefix, lang, headingLevel }: { prefix: string; lang: string; headingLevel: number },
): string {
	validateContent(content);
	const id = escapeHtml(prefix);
	const level = normalizeHeadingLevel(headingLevel, 2);
	const copy = strings[resolveLocale(lang)];
	const host = getHighlightStrings(lang);
	const instruction =
		content.mode === "evidence"
			? `<p class="praxity-assessment-choice-hint">${escapeHtml(copy.evidenceInstruction).replaceAll("{question}", () => `<span class="praxity-highlight-question">${escapeHtml(content.question ?? "")}</span>`)}</p>`
			: `${content.question ? `<p>${escapeHtml(content.question)}</p>` : ""}<p class="praxity-assessment-choice-hint">${escapeHtml(copy.keyInstruction)}</p>`;
	const passage = content.paragraphs
		.map(
			(paragraph) =>
				`<p>${paragraph.map((chunk) => `<span class="praxity-highlight-chunk" data-highlight-chunk="${escapeHtml(chunk.id)}">${escapeHtml(chunk.text)}</span><span class="praxity-highlight-feedback" id="${id}-feedback-${escapeHtml(chunk.id)}" data-highlight-feedback hidden></span>`).join(" ")}</p>`,
		)
		.join("");
	// Both projections share labels, order and notes. Print never depends on details.open.
	const answer = `<ul class="praxity-highlight-answer">${content.paragraphs
		.flat()
		.filter((chunk) => chunk.key === true || chunk.note)
		.map((chunk) => {
			const label =
				chunk.key === true
					? content.mode === "key"
						? copy.correctKey
						: copy.correctEvidence
					: content.mode === "key"
						? copy.wrongKey
						: copy.wrongEvidence;
			return `<li><p><strong>${escapeHtml(labelWithSeparator(label, lang))}</strong>${escapeHtml(chunk.text)}</p>${chunk.note ? `<p class="praxity-assessment-choice-hint">${escapeHtml(chunk.note)}</p>` : ""}</li>`;
		})
		.join("")}</ul>`;
	return `<div class="praxity-highlight" data-highlight data-highlight-content='${escapeJsonForHtml(JSON.stringify(content))}' lang="${escapeHtml(lang)}"><h${level} id="${id}-title">${escapeHtml(content.title)}</h${level}>${instruction}<p class="praxity-assessment-choice-hint" id="${id}-instructions" data-highlight-instructions hidden>${escapeHtml(host.highlightControls)}</p><div class="praxity-highlight-passage" data-highlight-passage role="group" aria-labelledby="${id}-title">${passage}</div><div data-highlight-flow hidden><p class="praxity-assessment-choice-hint" data-highlight-count>${escapeHtml(formatCount(copy, 0, markLimit(content)))}</p><p class="praxity-assessment-choice-hint" data-highlight-limit hidden></p><p id="${id}-summary" data-highlight-summary tabindex="-1" hidden></p><div class="praxity-highlight-actions" data-highlight-controls><button class="praxity-button" type="button" data-highlight-check data-praxity-js-control>${escapeHtml(copy.check)}</button><button class="praxity-button" data-variant="outline" type="button" data-highlight-restart data-praxity-js-control hidden>${escapeHtml(copy.restart)}</button></div></div><details data-highlight-fallback><summary>${escapeHtml(copy.answer)}</summary>${answer}</details><div data-highlight-print-answer hidden><h${Math.min(6, level + 1)}>${escapeHtml(copy.answer)}</h${Math.min(6, level + 1)}>${answer}</div><p class="praxity-sr-only" role="status" aria-live="polite" aria-atomic="true" data-highlight-status data-highlight-unavailable="${escapeHtml(host.highlightUnavailable)}"></p></div>`;
}
