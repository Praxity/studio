/** Generated French labels keep double punctuation attached to the preceding word. */
export function labelWithSeparator(
	label: string,
	locale: string,
	separator: ":" | "?" | "!" | ";" = ":",
): string {
	const stem = label.endsWith(".") ? label.slice(0, -1) : label;
	return `${stem}${locale.startsWith("fr") ? "\u202f" : ""}${separator} `;
}
