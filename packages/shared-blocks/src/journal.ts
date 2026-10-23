import { journalDateLabels } from "./i18n/journal-download-labels";

/** A journal is a private, ungraded free response with a long input. */
export function isJournal(data: {
	assessmentType?: unknown;
	gradingMode?: unknown;
	graded?: unknown;
	private?: unknown;
	response?: { type?: unknown; inputType?: unknown };
}): boolean {
	return (
		data.assessmentType === "textResponse" &&
		(data.gradingMode ?? (data.graded ? "exact" : "none")) === "none" &&
		data.private === true &&
		data.response?.type === "textResponse" &&
		data.response.inputType === "long"
	);
}

/** Accept only the UTC ISO format written at save; legacy entries keep their answer. */
export function readJournalSavedAt(value: unknown): string | null {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
		return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

export function journalSavedDate(value: unknown, lang: string, timeZone?: string): string {
	const savedAt = readJournalSavedAt(value);
	if (!savedAt) return "";
	const date = new Date(savedAt);
	return journalDateLabels[lang.startsWith("fr") ? "fr" : "en"]
		.replace("{date}", new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone }).format(date))
		.replace(
			"{time}",
			new Intl.DateTimeFormat(lang, { timeStyle: "short", timeZone }).format(date),
		);
}
