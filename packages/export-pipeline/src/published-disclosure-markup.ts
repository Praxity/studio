import { escapeHtml, sanitizeInline } from "./published-markup.ts";

export function renderDisclosureChevron(): string {
	return `<svg class="praxity-disclosure-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>`;
}

export function renderDisclosureHeading(
	label: string,
	buttonId: string,
	panelId: string,
	level: number,
	chevron = false,
): string {
	// P27: keep a readable heading until a working button replaces the plain label.
	const icon = chevron
		? renderDisclosureChevron()
		: `<svg class="praxity-disclosure-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path class="praxity-disclosure-icon-vertical" d="M12 5v14"/></svg>`;
	return `<h${level} class="praxity-disclosure-heading"><span id="${escapeHtml(`${buttonId}-label`)}" class="praxity-disclosure-title" data-disclosure-label>${label}</span><button type="button" class="praxity-disclosure-trigger" data-disclosure-trigger id="${escapeHtml(buttonId)}" aria-expanded="true" aria-controls="${escapeHtml(panelId)}" hidden>${icon}</button></h${level}>`;
}

export function renderTranscript(value: unknown, blockId: string, label: string): string {
	const transcript = sanitizeInline(value);
	if (!transcript) {
		return "";
	}
	const buttonId = `${blockId}-transcript-trigger`;
	const panelId = `${blockId}-transcript-panel`;
	return `<div class="praxity-media-transcript">${renderDisclosureHeading(escapeHtml(label), buttonId, panelId, 3)}<div id="${escapeHtml(panelId)}" class="praxity-transcript-content" data-disclosure-panel>${transcript}</div></div>`;
}
