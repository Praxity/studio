export function normalizeLineEndings(source: string): string {
	return source.replace(/\r\n?/g, "\n");
}

export function normalizeYamlLineEndings(source: string): string {
	return source.replace(/\r(?!\n)/g, "\n");
}

export function findLineEnding(source: string | undefined): string | undefined {
	return source?.match(/\r\n|\r|\n/u)?.[0];
}

export function preserveLineEndings(source: string, previousSource: string | undefined): string {
	const eol = findLineEnding(previousSource);
	if (!eol) return source;
	return normalizeLineEndings(source).replace(/\n/g, eol);
}

export function displayText(raw: string, preserveWhitespace = false): string {
	const text = raw.replace(/\r\n|\r/g, "\n").replace(/\n {2}/g, "\n");
	return preserveWhitespace ? text : text.trim();
}
