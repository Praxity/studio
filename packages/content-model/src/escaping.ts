/** ASCII punctuation is the grammar policy. Unknown escapes remain literal. */
// Preserve formatting and answer values until those callers adopt the published ASCII rule.
const LEGACY_RESERVED = new Set(Array.from("\\*~=`[]{}@|:;_#->!()+/$.?"));

const ASCII_PUNCTUATION = new Set(Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"));

type EscapePolicy = "legacy" | "ascii";

export function escapeLength(text: string, index: number, policy: EscapePolicy = "legacy"): number {
	const punctuation = policy === "ascii" ? ASCII_PUNCTUATION : LEGACY_RESERVED;
	return text[index] === "\\" && punctuation.has(text[index + 1]) ? 2 : 0;
}

export function decodeEscapes(text: string, policy: EscapePolicy = "legacy"): string {
	let result = "";
	for (let index = 0; index < text.length; index++) {
		if (escapeLength(text, index, policy)) index++;
		result += text[index];
	}
	return result;
}

export function escapeGrammarText(text: string, punctuation?: string): string {
	return Array.from(text, (char) =>
		(punctuation ? punctuation.includes(char) : LEGACY_RESERVED.has(char)) ? `\\${char}` : char,
	).join("");
}

/** Find syntax before decoding so literal delimiters never become syntax. */
export function findUnescaped(text: string, delimiter: string, start = 0): number {
	for (let index = start; index < text.length; index++) {
		if (escapeLength(text, index)) {
			index++;
			continue;
		}
		if (text.startsWith(delimiter, index)) return index;
	}
	return -1;
}

export function splitUnescaped(text: string, delimiter: string): string[] {
	const parts: string[] = [];
	let start = 0;
	for (
		let index = findUnescaped(text, delimiter);
		index !== -1;
		index = findUnescaped(text, delimiter, start)
	) {
		parts.push(text.slice(start, index));
		start = index + delimiter.length;
	}
	parts.push(text.slice(start));
	return parts;
}
