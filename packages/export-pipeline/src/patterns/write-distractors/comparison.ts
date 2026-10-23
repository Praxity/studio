import { escapeHtml } from "@praxity/shared-blocks/constants";
import { labelWithSeparator } from "@praxity/shared-blocks/i18n/label-separator";
import type { getDistractorPresentationStrings } from "@praxity/shared-blocks/i18n/practice-host-strings";
import {
	distractorOptionKey,
	type WriteDistractorsRules,
} from "@praxity/shared-blocks/write-distractors-content";

/** Presentation receives admitted label comparisons, never raw authored Content. */
export function renderDistractorComparison(
	result: ReturnType<WriteDistractorsRules["comparison"]>,
	lang: string,
	ui: ReturnType<typeof getDistractorPresentationStrings>,
) {
	const number = new Intl.NumberFormat(lang);
	let announcement: string = result.counts.authorTotal === 1 ? ui.coverageOne : ui.coverageMany;
	for (const key of ["authorTargeted", "authorTotal", "ownExtra"] as const)
		announcement = announcement.replace(`{${key}}`, number.format(result.counts[key]));
	const preview = (kind: "learner" | "author") => {
		const title = kind === "learner" ? ui.yourQuestion : ui.authorQuestion;
		const options = kind === "learner" ? result.learner : result.author;
		return `<div data-distractor-preview="${kind}"><p class="praxity-distractor-label">${escapeHtml(title)}</p><p>${escapeHtml(result.question)}</p><p>${escapeHtml(labelWithSeparator(ui.correctAnswer, lang))}${escapeHtml(result.answer)}</p><ol role="list">${options.map((option, index) => `<li><p>${escapeHtml(labelWithSeparator(ui.option.replace("{key}", distractorOptionKey(index + 1)), lang))}${escapeHtml(option.text)}</p><p>${escapeHtml(ui.targets.replace("{target}", () => option.label))}</p>${"match" in option && option.match ? `<p class="praxity-text-dimmed" data-distractor-match>${escapeHtml(ui.match)}</p>` : ""}</li>`).join("")}</ol></div>`;
	};
	return {
		html: `${preview("learner")}${preview("author")}<p data-distractor-coverage>${escapeHtml(announcement)}</p><p data-distractor-no-grade>${escapeHtml(ui.distractorsNoGrade)}</p>`,
		announcement,
	};
}
