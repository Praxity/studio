import { normalizeHeadingLevel } from "@praxity/shared-blocks/heading-styles";
import { getRetrievalSheetStrings } from "@praxity/shared-blocks/i18n/retrieval-sheet-strings";
import type { RetrievalSheetContent } from "@praxity/shared-blocks/types";
import type { strings as patternStrings } from "learning-patterns/patterns/retrieval-sheet/strings.js";
import { escapeHtml } from "../../published-markup.ts";

/** Public, literal authored content. Dates and client controls have no server state. */
export function renderRetrievalSheet(
	content: RetrievalSheetContent,
	{
		prefix,
		lang,
		headingLevel: requestedHeadingLevel,
		strings,
		noDate,
	}: {
		prefix: string;
		lang: string;
		headingLevel: number;
		strings: (typeof patternStrings)["en"];
		noDate: string;
	},
): string {
	const id = escapeHtml(prefix);
	const headingLevel = normalizeHeadingLevel(requestedHeadingLevel, 2);
	// Native headings stop at h6; a level-6 title and its side labels share that level.
	const sideLevel = Math.min(6, headingLevel + 1);
	const questions = content.questions
		.map(
			(row) =>
				`<li data-retrieval-question="${escapeHtml(row.id)}"><p>${escapeHtml(row.question)}</p><div class="praxity-retrieval-sheet-space" aria-hidden="true"></div></li>`,
		)
		.join("");
	const answers = content.questions
		.map(
			(row) =>
				`<li data-retrieval-question="${escapeHtml(row.id)}"><p>${escapeHtml(row.answer)}</p></li>`,
		)
		.join("");
	return `<div class="praxity-retrieval-sheet" data-retrieval-sheet lang="${escapeHtml(lang)}"><h${headingLevel} id="${id}-title">${escapeHtml(content.title)}</h${headingLevel}><p>${escapeHtml(strings.instruction)}</p><p>${escapeHtml(strings.dateLabel)} <span class="praxity-retrieval-sheet-date-line" data-retrieval-date-line aria-hidden="true"></span></p><p class="praxity-retrieval-sheet-secondary" data-retrieval-no-date>${escapeHtml(noDate)}</p><div role="status" aria-live="polite" aria-atomic="true" class="praxity-sr-only" data-retrieval-status data-retrieval-unavailable="${escapeHtml(getRetrievalSheetStrings(lang).retrievalUnavailable)}"></div><div data-retrieval-controls hidden></div><div id="${id}-front" data-retrieval-side="front"><h${sideLevel} id="${id}-front-heading">${escapeHtml(strings.questions)}</h${sideLevel}><ol>${questions}</ol></div><div id="${id}-back" data-retrieval-side="back"><h${sideLevel} id="${id}-back-heading">${escapeHtml(strings.answers)}</h${sideLevel}><p>${escapeHtml(strings.backInstruction)}</p><ol>${answers}</ol></div><p class="praxity-retrieval-sheet-secondary" data-retrieval-print-hint>${escapeHtml(strings.printHint)}</p></div>`;
}
