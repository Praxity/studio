import { DONT_KNOW } from "@praxity/shared-blocks/assessment-choice";
import { getPracticeHostStrings } from "@praxity/shared-blocks/i18n/practice-host-strings";
import { getSelfCheckHostStrings } from "@praxity/shared-blocks/i18n/self-check-host-strings";
import type { AssessmentBlockData, PraxityBlock } from "@praxity/shared-blocks/types";
import { escapeHtml, renderInlineField } from "../../published-markup.ts";

/** Only added to courses with private choices; ordinary CSS stays byte-identical. */
export const privateChoicePrintCss =
	"@media print { [data-practice-mode], [data-practice-restoring], [data-practice-save], [data-practice-status] { display: none !important; } }";

export function renderChoice(
	block: PraxityBlock,
	{
		header,
		descriptionHtml,
		describedBy,
		headingId,
		required,
		dontKnowLabel,
		fallbackLabels,
		needsScript,
		locale,
	}: {
		header: string;
		descriptionHtml: string;
		describedBy: string;
		headingId: string;
		required: boolean;
		dontKnowLabel: string;
		fallbackLabels: string[];
		needsScript: string;
		locale?: string;
	},
): string {
	const data = block.data as unknown as AssessmentBlockData;
	if (data.response.type !== "choice") return "";
	const inputType = data.response.selectionMode === "multiple" ? "checkbox" : "radio";
	const options = data.response.options ?? [];
	const choices = (
		data._dontKnow === true ? [...options, { id: DONT_KNOW, label: dontKnowLabel }] : options
	)
		.map((option, index) => {
			const unknown = option.id === DONT_KNOW;
			const label =
				(typeof option.label === "string" && renderInlineField(option, "label", false)) ||
				fallbackLabels[index];
			const optionId = `${block.id}-option-${option.id || index}`;
			return `<label data-node-id="${escapeHtml(option.id || `${block.id}-option-${index}`)}"${unknown ? " data-dont-know" : ""} class="praxity-assessment-choice-option" for="${escapeHtml(optionId)}"><input id="${escapeHtml(optionId)}" type="${inputType}" name="${escapeHtml(block.id)}" value="${escapeHtml(option.id || String(index))}" aria-labelledby="${escapeHtml(optionId)}-label" disabled />${inputType === "radio" ? '<span class="praxity-choice-key" aria-hidden="true"></span>' : ""}<span class="praxity-choice-text"><span id="${escapeHtml(optionId)}-label" class="praxity-choice-label">${label}</span></span></label>`;
		})
		.join("");
	/*
	 * Disabled, with a `<noscript>` saying why.
	 *
	 * This markup is the pre-hydration shell; the React viewer replaces it and
	 * owns answering, submitting, feedback and scoring. Shipped enabled, it was a
	 * form a learner could fill in that could never be submitted — no submit
	 * control, no feedback, and the answers gone at the next page. A control that
	 * accepts input it cannot act on is worse than no control, so it stays inert
	 * until the code that can honour it arrives.
	 */
	const ui = getPracticeHostStrings(locale ?? "en");
	const failure = getSelfCheckHostStrings(locale ?? "en").selfCheckNotSavedDevice.replaceAll(
		"'",
		"’",
	);
	const notice =
		data.private === true && data.response.selectionMode === "single"
			? `<p class="praxity-assessment-choice-hint" data-practice-mode>${escapeHtml(ui.practiceDeviceMode)}<span data-practice-shared hidden> ${escapeHtml(ui.practiceSharedDeviceScope)}</span><span data-practice-identified hidden> ${escapeHtml(ui.practiceIdentifiedScope)}</span></p><p class="praxity-assessment-choice-hint" data-practice-restoring hidden>${escapeHtml(ui.practiceRestoring)}</p><p class="praxity-text-error" data-practice-save hidden>${escapeHtml(failure)}</p><span class="praxity-sr-only" role="status" aria-live="polite" aria-atomic="true" data-practice-status></span>`
			: "";
	// Match the active feedback and action slots before hydration.
	return `<form class="praxity-block-assessment praxity-assessment-choice-baseline">${header}${descriptionHtml}<fieldset class="praxity-fieldset-reset praxity-assessment-choice"${inputType === "radio" ? ` role="radiogroup"${required ? ' aria-required="true"' : ""}` : ""} aria-labelledby="${headingId}"${describedBy}><div class="praxity-assessment-choice-options">${choices}</div></fieldset><div data-assessment-feedback></div><div class="praxity-assessment-actions"></div>${notice}<noscript><p class="praxity-assessment-needs-script">${needsScript}</p></noscript></form>`;
}
