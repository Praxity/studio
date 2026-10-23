import { normalizeHeadingLevel } from "@praxity/shared-blocks/heading-styles";
import { resolveLocale } from "@praxity/shared-blocks/i18n/locale";
import {
	getDistractorPresentationStrings,
	getPracticeHostStrings,
} from "@praxity/shared-blocks/i18n/practice-host-strings";
import type { WriteDistractorsPrompt } from "@praxity/shared-blocks/types";
import type { WriteDistractorsAssetReference } from "@praxity/shared-blocks/write-distractors-content";
import { strings } from "learning-patterns/patterns/write-distractors/strings.js";
import { escapeHtml } from "../../published-markup";

/** Prompt-only baseline. Neither hidden authored Content nor active controls are serialized. */
export function renderWriteDistractors(
	prompt: WriteDistractorsPrompt,
	{
		prefix,
		blockId,
		lang,
		headingLevel,
		reference,
	}: {
		prefix: string;
		blockId?: string;
		lang: string;
		headingLevel: number;
		reference?: WriteDistractorsAssetReference;
	},
): string {
	const id = escapeHtml(prefix);
	const level = normalizeHeadingLevel(headingLevel, 2);
	const ui = strings[resolveLocale(lang)];
	const host = getPracticeHostStrings(lang);
	const attributes = ` data-distractor-id="${escapeHtml(reference?.blockId ?? blockId ?? prefix)}" data-distractor-count="${prompt.count}" data-distractor-items="${escapeHtml(JSON.stringify(prompt.items.map(({ id }) => id)))}"${reference ? ` data-distractor-src="${escapeHtml(reference.path)}" data-distractor-revision="${escapeHtml(reference.contentRevision)}"` : ""}`;
	return `<div class="praxity-write-distractors praxity-self-check praxity-assessment-baseline" data-write-distractors${attributes} data-distractor-strings="${escapeHtml(JSON.stringify(getDistractorPresentationStrings(lang)))}" lang="${escapeHtml(lang)}"><h${level}>${escapeHtml(prompt.question)}</h${level}><label for="${id}-answer">${escapeHtml(ui.answer)}</label><textarea class="praxity-assessment-text-input" id="${id}-answer" rows="4" aria-describedby="${id}-baseline" data-distractor-answer></textarea><div data-distractor-writing-space></div><p id="${id}-baseline" data-distractor-baseline class="praxity-assessment-choice-hint">${escapeHtml(host.distractorsNeedsScript)}</p><p data-distractor-error class="praxity-text-error" id="${id}-error" hidden></p><div data-distractor-controls hidden></div><p data-distractor-notice class="praxity-assessment-choice-hint" hidden></p><p class="praxity-sr-only" role="status" aria-live="polite" aria-atomic="true" data-distractor-status></p></div>`;
}
