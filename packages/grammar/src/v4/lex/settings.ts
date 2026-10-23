import { decodeEscapes } from "@praxity/content-model";
import type { DiagnosticCode, LexDiagnostic, Token, TokenKind } from "./types.ts";

export function appendToken(
	tokens: Token[],
	text: string,
	kind: Exclude<TokenKind, "diagnostic">,
	start: number,
	end: number,
	value?: string | boolean,
): void {
	if (start === end) return;
	tokens.push({
		kind,
		start,
		end,
		raw: text.slice(start, end),
		...(value === undefined ? {} : { value }),
	});
}

export function appendDiagnostic(
	tokens: Token[],
	text: string,
	start: number,
	end: number,
	value: LexDiagnostic,
): void {
	if (start === end) return;
	tokens.push({ kind: "diagnostic", start, end, raw: text.slice(start, end), value });
}

/** Decode after identifying boundaries. Unknown escapes and ordinary backslashes survive. */
export function decodePunctuation(raw: string): string {
	return decodeEscapes(raw, "ascii");
}

/** First reserved suffix, including malformed or non-final groups. Escaped braces are text. */
export function settingsStart(
	text: string,
	start: number,
	end: number,
	imageSuffix = false,
): number {
	for (let index = start; index < end; index++) {
		if (text[index] === "\\") {
			index++;
			continue;
		}
		if (
			text[index] === "{" &&
			(text[index - 1] === " " ||
				text[index - 1] === "\t" ||
				(imageSuffix && text[index - 1] === ")"))
		)
			return index;
	}
	return end;
}

export function lexSettings(text: string, start: number, end: number, tokens: Token[]): void {
	let quote = false;
	let close = start + 1;
	for (; close < end; close++) {
		if (quote && text[close] === "\\") {
			close++;
			continue;
		}
		if (text[close] === '"') quote = !quote;
		if (!quote && text[close] === "}") break;
	}
	const failGroup = (code: DiagnosticCode) => appendDiagnostic(tokens, text, start, end, { code });
	if (quote) {
		failGroup("unclosed-setting-quote");
		return;
	}
	if (close === end) {
		failGroup("missing-settings-close");
		return;
	}
	if (!/^[ \t]*$/.test(text.slice(close + 1, end))) {
		failGroup(
			text
				.slice(close + 1, end)
				.trimStart()
				.startsWith("{")
				? "multiple-settings-groups"
				: "settings-not-final",
		);
		return;
	}
	appendToken(tokens, text, "settings-open", start, start + 1);
	const seen = new Map<string, number>();
	let index = start + 1;
	const failRest = (code: DiagnosticCode, from: number) => {
		appendDiagnostic(tokens, text, from, close, { code });
		index = close;
	};
	while (index < close) {
		if (text[index] === " " || text[index] === "\t") {
			const from = index;
			while (index < close && /[ \t]/.test(text[index])) index++;
			appendToken(tokens, text, "whitespace", from, index);
			continue;
		}
		const keyStart = index;
		while (index < close && /[A-Za-z0-9]/.test(text[index])) index++;
		const keyEnd = index;
		const name = text.slice(keyStart, keyEnd);
		if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
			failRest("invalid-setting-key", keyStart);
			break;
		}
		let afterSpace = index;
		while (afterSpace < close && /[ \t]/.test(text[afterSpace])) afterSpace++;
		if (
			(afterSpace !== index && text[afterSpace] === "=") ||
			(text[index] === "=" && /[ \t]/.test(text[index + 1] ?? ""))
		) {
			failRest("spaces-around-equals", keyStart);
			break;
		}
		const hasValue = text[index] === "=";
		const firstStart = seen.get(name);
		if (firstStart !== undefined) {
			appendDiagnostic(tokens, text, keyStart, keyEnd, {
				code: "duplicate-setting",
				name,
				firstStart,
			});
		} else {
			seen.set(name, keyStart);
			appendToken(
				tokens,
				text,
				hasValue ? "setting-key" : "setting-flag",
				keyStart,
				keyEnd,
				hasValue ? name : true,
			);
		}
		if (hasValue) {
			appendToken(tokens, text, "setting-equals", index, index + 1);
			index++;
			const valueStart = index;
			if (index === close) {
				// The equals sign owns this error because an empty value has no source range.
				tokens.pop();
				appendDiagnostic(tokens, text, index - 1, index, { code: "missing-setting-value" });
				break;
			}
			if (text[index] === '"') {
				index++;
				while (index < close && text[index] !== '"') {
					if (text[index] === "\\") index++;
					index++;
				}
				index++;
				const raw = text.slice(valueStart + 1, index - 1);
				appendToken(
					tokens,
					text,
					"setting-value",
					valueStart,
					index,
					raw.replace(/\\(["\\])/g, "$1"),
				);
			} else {
				while (index < close && !/[ \t]/.test(text[index])) index++;
				const raw = text.slice(valueStart, index);
				if (/[“”‘’]/.test(raw))
					appendDiagnostic(tokens, text, valueStart, index, { code: "invalid-setting-quote" });
				else if (/[{}"]/.test(raw))
					appendDiagnostic(tokens, text, valueStart, index, { code: "invalid-setting-value" });
				else appendToken(tokens, text, "setting-value", valueStart, index, raw);
			}
		}
		if (index < close && !/[ \t]/.test(text[index])) {
			failRest("missing-setting-separator", index);
			break;
		}
	}
	appendToken(tokens, text, "settings-close", close, close + 1);
	appendToken(tokens, text, "whitespace", close + 1, end);
}
