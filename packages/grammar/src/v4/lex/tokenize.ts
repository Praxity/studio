import { findFrontmatterRange } from "../../frontmatter-range.ts";
import {
	appendDiagnostic,
	appendToken,
	decodePunctuation,
	lexSettings,
	settingsStart,
} from "./settings.ts";
import type { LexOptions, LineKind, Token, TokenStream } from "./types.ts";

interface CodeFence {
	character: string;
	length: number;
	indent: number;
}
interface ListIndent {
	content: number;
}

function whitespaceEnd(text: string, start: number, end: number): number {
	while (start < end && /[ \t]/.test(text[start])) start++;
	return start;
}

function subject(text: string, start: number, end: number, tokens: Token[]): void {
	const from = whitespaceEnd(text, start, end);
	appendToken(tokens, text, "whitespace", start, from);
	let to = end;
	while (to > from && /[ \t]/.test(text[to - 1])) to--;
	appendToken(tokens, text, "subject", from, to, decodePunctuation(text.slice(from, to)));
	appendToken(tokens, text, "whitespace", to, end);
}

function header(
	text: string,
	start: number,
	end: number,
	tokens: Token[],
	hasSubject: boolean,
): void {
	const group = settingsStart(text, start, end, !hasSubject);
	if (hasSubject) subject(text, start, group, tokens);
	else appendToken(tokens, text, "whitespace", start, group);
	if (group < end) lexSettings(text, group, end, tokens);
}

/** The line recognizer needs image boundaries; inline rendering remains G6's responsibility. */
function balancedEnd(
	text: string,
	start: number,
	end: number,
	open: string,
	close: string,
): number {
	let depth = 1;
	for (let index = start; index < end; index++) {
		if (text[index] === "\\") {
			index++;
			continue;
		}
		if (text[index] === open) depth++;
		if (text[index] === close && --depth === 0) return index;
	}
	return -1;
}

function image(text: string, start: number, end: number, tokens: Token[]): boolean {
	if (!text.startsWith("![", start)) return false;
	const labelEnd = balancedEnd(text, start + 2, end, "[", "]");
	if (labelEnd < 0 || text[labelEnd + 1] !== "(") return false;
	const sourceEnd = balancedEnd(text, labelEnd + 2, end, "(", ")");
	if (sourceEnd < 0) return false;
	const remainder = whitespaceEnd(text, sourceEnd + 1, end);
	if (remainder < end && text[remainder] !== "{") return false;
	appendToken(tokens, text, "marker", start, start + 2, "![");
	appendToken(
		tokens,
		text,
		"image-alt",
		start + 2,
		labelEnd,
		decodePunctuation(text.slice(start + 2, labelEnd)),
	);
	appendToken(tokens, text, "marker", labelEnd, labelEnd + 2, "](");
	appendToken(
		tokens,
		text,
		"image-source",
		labelEnd + 2,
		sourceEnd,
		text.slice(labelEnd + 2, sourceEnd),
	);
	appendToken(tokens, text, "marker", sourceEnd, sourceEnd + 1, ")");
	header(text, sourceEnd + 1, end, tokens, false);
	return true;
}

function structural(
	text: string,
	start: number,
	end: number,
	tokens: Token[],
	options: LexOptions,
): LineKind {
	const raw = text.slice(start, end);
	const heading = /^(#{1,6})(?=[ \t]|$)/.exec(raw);
	if (heading) {
		appendToken(tokens, text, "marker", start, start + heading[1].length, heading[1]);
		header(text, start + heading[1].length, end, tokens, true);
		return heading[1].length === 1 ? "page" : "heading";
	}
	if (/^:::(?=[ \t]|$)/.test(raw)) {
		appendToken(tokens, text, "marker", start, start + 3, ":::");
		const typeStart = whitespaceEnd(text, start + 3, end);
		appendToken(tokens, text, "whitespace", start + 3, typeStart);
		if (typeStart === end) return "closer";
		let typeEnd = typeStart;
		while (typeEnd < end && !/[ \t{]/.test(text[typeEnd])) typeEnd++;
		appendToken(tokens, text, "block-type", typeStart, typeEnd, text.slice(typeStart, typeEnd));
		header(text, typeEnd, end, tokens, true);
		return "opener";
	}
	if (/^::(?=[ \t]|$)/.test(raw)) {
		appendToken(tokens, text, "marker", start, start + 2, "::");
		header(text, start + 2, end, tokens, true);
		return "item";
	}
	if (/^---(?:[ \t]*|[ \t]+\{.*)$/.test(raw)) {
		appendToken(tokens, text, "marker", start, start + 3, "---");
		header(text, start + 3, end, tokens, false);
		return "divider";
	}
	if (image(text, start, end, tokens)) return "image";
	const bodyGroup = /^\{(.*)\}[ \t]*$/.exec(raw);
	const misplacedGroup =
		raw.startsWith("{") &&
		!raw.startsWith("{{") &&
		(bodyGroup
			? bodyGroup[1].includes("=") ||
				bodyGroup[1]
					.trim()
					.split(/[ \t]+/)
					.some((name) => options.isSettingName?.(name, start))
			: !raw.includes("}") && raw.includes("="));
	if (misplacedGroup) {
		appendDiagnostic(tokens, text, start, end, { code: "setting-on-body-line" });
		return "diagnostic";
	}
	const colonName = /^([A-Za-z][A-Za-z0-9_-]*)([ \t\u00a0\u202f]*):/.exec(raw);
	if (colonName && options.isSettingName?.(colonName[1], start)) {
		appendDiagnostic(tokens, text, start, end, {
			code: "setting-on-body-line",
			name: colonName[1],
		});
		return "diagnostic";
	}
	const part = /^([a-z][A-Za-z0-9]*):([ \t\u00a0\u202f]+|$)/.exec(raw);
	if (part) {
		const nameEnd = start + part[1].length;
		const valueStart = start + part[0].length;
		appendToken(tokens, text, "part-name", start, nameEnd, part[1]);
		appendToken(tokens, text, "marker", nameEnd, nameEnd + 1, ":");
		appendToken(tokens, text, "whitespace", nameEnd + 1, valueStart);
		appendToken(
			tokens,
			text,
			"part-value",
			valueStart,
			end,
			decodePunctuation(text.slice(valueStart, end)),
		);
		return "part";
	}
	appendToken(tokens, text, "prose", start, end, decodePunctuation(raw));
	return "prose";
}

/** Lossless UTF-16 token partition. The tree resolves schema-dependent part candidates. */
export function tokenizeLesson(text: string, options: LexOptions = {}): TokenStream {
	const stream: TokenStream = { source: text, tokens: [], lines: [] };
	const { tokens } = stream;
	let code: CodeFence | undefined;
	let math = false;
	const frontmatter = findFrontmatterRange(text);
	const lists: ListIndent[] = [];
	for (let start = 0; start < text.length; ) {
		let contentEnd = start;
		while (contentEnd < text.length && text[contentEnd] !== "\r" && text[contentEnd] !== "\n")
			contentEnd++;
		const end =
			contentEnd +
			(text[contentEnd] === "\r" && text[contentEnd + 1] === "\n"
				? 2
				: contentEnd < text.length
					? 1
					: 0);
		const tokenStart = tokens.length;
		let bodyStart = start;
		if (start === 0 && text[0] === "\uFEFF") {
			appendToken(tokens, text, "bom", 0, 1);
			bodyStart++;
		}
		const raw = text.slice(bodyStart, contentEnd);
		let kind: LineKind;
		if (
			frontmatter &&
			(start === 0 || (frontmatter.endIndex !== -1 && start === frontmatter.yamlEnd))
		) {
			const markerStart = bodyStart + raw.indexOf("---");
			appendToken(tokens, text, "whitespace", bodyStart, markerStart);
			appendToken(tokens, text, "marker", markerStart, markerStart + 3, "---");
			appendToken(tokens, text, "whitespace", markerStart + 3, contentEnd);
			kind = "frontmatter-fence";
		} else if (frontmatter && start < frontmatter.yamlEnd) {
			appendToken(tokens, text, "frontmatter", bodyStart, contentEnd, raw);
			kind = "frontmatter";
		} else if (code) {
			const closing = /^( *)(`+|~+)[ \t]*$/.exec(raw);
			if (
				closing &&
				closing[1].length === code.indent &&
				closing[2][0] === code.character &&
				closing[2].length >= code.length
			) {
				appendToken(tokens, text, "whitespace", bodyStart, bodyStart + code.indent);
				appendToken(
					tokens,
					text,
					"marker",
					bodyStart + code.indent,
					bodyStart + code.indent + closing[2].length,
					closing[2],
				);
				appendToken(
					tokens,
					text,
					"whitespace",
					bodyStart + code.indent + closing[2].length,
					contentEnd,
				);
				code = undefined;
				kind = "code-fence";
			} else {
				appendToken(tokens, text, "code", bodyStart, contentEnd, raw);
				kind = "code";
			}
		} else if (math) {
			if (/^\$\$[ \t]*$/.test(raw)) {
				appendToken(tokens, text, "marker", bodyStart, bodyStart + 2, "$$");
				appendToken(tokens, text, "whitespace", bodyStart + 2, contentEnd);
				math = false;
				kind = "math-fence";
			} else {
				appendToken(tokens, text, "math", bodyStart, contentEnd, raw);
				kind = "math";
			}
		} else if (/^[ \t]*$/.test(raw)) {
			appendToken(tokens, text, "blank", bodyStart, contentEnd);
			kind = "blank";
		} else {
			const indent = /^ */.exec(raw)?.[0].length ?? 0;
			const list = /^( *)(- |[0-9]+\. )/.exec(raw);
			if (list) {
				while (lists.length && indent < lists[lists.length - 1].content) lists.pop();
				if (indent === 0 || indent === lists.at(-1)?.content) {
					lists.push({ content: list[0].length });
				}
			} else {
				while (lists.length && indent < lists[lists.length - 1].content) lists.pop();
			}
			const fence = /^( *)(`{3,}|~{3,})(.*)$/.exec(raw);
			if (fence && (indent === 0 || indent === lists.at(-1)?.content)) {
				code = { character: fence[2][0], length: fence[2].length, indent };
				appendToken(tokens, text, "whitespace", bodyStart, bodyStart + indent);
				appendToken(
					tokens,
					text,
					"marker",
					bodyStart + indent,
					bodyStart + indent + code.length,
					fence[2],
				);
				appendToken(tokens, text, "code", bodyStart + indent + code.length, contentEnd, fence[3]);
				kind = "code-fence";
			} else if (/^\$\$[ \t]*$/.test(raw)) {
				math = true;
				appendToken(tokens, text, "marker", bodyStart, bodyStart + 2, "$$");
				appendToken(tokens, text, "whitespace", bodyStart + 2, contentEnd);
				kind = "math-fence";
			} else if (raw.startsWith(">")) {
				appendToken(tokens, text, "quote", bodyStart, contentEnd, raw);
				kind = "quote";
			} else if (list) {
				appendToken(tokens, text, "whitespace", bodyStart, bodyStart + indent);
				appendToken(
					tokens,
					text,
					"marker",
					bodyStart + indent,
					bodyStart + list[0].length,
					list[2],
				);
				const listFence = /^(`{3,}|~{3,})(.*)$/.exec(raw.slice(list[0].length));
				if (listFence && lists.at(-1)?.content === list[0].length) {
					code = {
						character: listFence[1][0],
						length: listFence[1].length,
						indent: list[0].length,
					};
					const fenceStart = bodyStart + list[0].length;
					appendToken(tokens, text, "marker", fenceStart, fenceStart + code.length, listFence[1]);
					appendToken(tokens, text, "code", fenceStart + code.length, contentEnd, listFence[2]);
				} else {
					appendToken(
						tokens,
						text,
						"prose",
						bodyStart + list[0].length,
						contentEnd,
						decodePunctuation(raw.slice(list[0].length)),
					);
				}
				kind = "list-item";
			} else if (indent === 0 && !raw.startsWith("\t") && !raw.startsWith("\\")) {
				kind = structural(text, bodyStart, contentEnd, tokens, options);
			} else {
				appendToken(tokens, text, "prose", bodyStart, contentEnd, decodePunctuation(raw));
				kind = "prose";
			}
		}
		appendToken(tokens, text, "line-ending", contentEnd, end, text.slice(contentEnd, end));
		stream.lines.push({ kind, start, contentEnd, end, tokenStart, tokenEnd: tokens.length });
		start = end;
	}
	return stream;
}
