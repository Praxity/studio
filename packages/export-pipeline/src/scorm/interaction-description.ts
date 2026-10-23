/** SCORM 2004 localized_string_type SPM, excluding the optional language delimiter. */
export function interactionDescription(text: string, scormLanguage?: string): string {
	let plain = text.replace(/\s+/gu, " ").trim();
	const characters = Array.from(plain);
	if (characters.length > 250) {
		const prefix = characters.slice(0, 249).join("");
		const boundary = prefix.lastIndexOf(" ");
		plain = `${boundary < 0 ? "" : prefix.slice(0, boundary)}…`;
	}
	// Omit the argument for unprefixed text; an empty language requests SCORM's default.
	if (scormLanguage === undefined) return plain;
	const locale =
		typeof scormLanguage === "string" &&
		scormLanguage.length < 251 &&
		/^([a-z]{2,3}|[ix])(-[a-z0-9]{1,8})*$/i.test(scormLanguage)
			? scormLanguage
			: // Explicit default language also shields authored delimiter syntax.
				"en";
	return `{lang=${locale}}${plain}`;
}
