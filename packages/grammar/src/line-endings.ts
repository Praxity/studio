/** Normalize parser input while leaving raw filesystem save baselines intact. */
export function normalizeLineEndings(source: string): string {
	return source.replace(/\r\n?/g, "\n");
}

/** YAML accepts LF/CRLF. Normalize lone CR while keeping every raw offset. */
export function normalizeYamlLineEndings(source: string): string {
	return source.replace(/\r(?!\n)/g, "\n");
}

/** First authored terminator, including lone CR. An unterminated source has none. */
export function findLineEnding(source: string | undefined): string | undefined {
	return source?.match(/\r\n|\r|\n/u)?.[0];
}

/** Keep the existing file's newline style when an editor or serializer emits LF. */
export function preserveLineEndings(source: string, previousSource: string | undefined): string {
	const eol = findLineEnding(previousSource);
	if (!eol) return source;
	return normalizeLineEndings(source).replace(/\n/g, eol);
}

// Two spaces are the part/continuation dialect, not learner indentation. The tree retains them.
export function displayText(raw: string, preserveWhitespace = false): string {
	const text = raw.replace(/\r\n|\r/g, "\n").replace(/\n {2}/g, "\n");
	return preserveWhitespace ? text : text.trim();
}
