import { escapeLength as punctuationEscapeLength } from "@praxity/content-model";
import { parseInlineIconName } from "@praxity/content-model/inline-icons";
import type {
	InlineNode,
	InlineRange,
	InlineSource,
	InlineTree,
	InlineValue,
} from "@praxity/content-model/inline-tree";
import { ownInlineTrivia } from "@praxity/content-model/inline-tree";
import { decodePunctuation } from "./lex/settings.ts";

function span(source: string, start: number, end: number): InlineSource {
	return { start, end, raw: source.slice(start, end) };
}

function value(source: string, start: number, end: number, decode = true): InlineValue {
	const range = span(source, start, end);
	return { ...range, value: decode ? decodePunctuation(range.raw) : range.raw };
}

// Use G1's punctuation rule. Decoding happens only after a token's bounds are known.
function escapeLength(source: string, index: number, end: number): number {
	return index + 1 < end ? punctuationEscapeLength(source, index, "ascii") : 0;
}

function findDelimiter(source: string, delimiter: string, start: number, end: number): number {
	for (let index = start; index < end; index++) {
		if (escapeLength(source, index, end)) {
			index++;
			continue;
		}
		if (index + delimiter.length <= end && source.startsWith(delimiter, index)) return index;
	}
	return -1;
}

function balancedClose(
	source: string,
	open: number,
	end: number,
	opener: string,
	closer: string,
	skipCode = true,
): number {
	let depth = 1;
	for (let index = open + 1; index < end; index++) {
		if (escapeLength(source, index, end)) {
			index++;
			continue;
		}
		if (skipCode && source[index] === "`") {
			const close = source.indexOf("`", index + 1);
			if (close !== -1 && close < end) {
				index = close;
				continue;
			}
		}
		if (source[index] === opener) depth++;
		if (source[index] === closer && --depth === 0) return index;
	}
	return -1;
}

function parse(source: string, start: number, end: number): InlineNode[] {
	const nodes: InlineNode[] = [];
	let index = start;
	let plainStart = start;
	const flush = () => {
		if (plainStart < index) nodes.push({ kind: "text", ...value(source, plainStart, index) });
	};
	const append = (node: InlineNode) => {
		flush();
		nodes.push(node);
		index = node.end;
		plainStart = index;
	};
	const unresolved = (close: number) =>
		append({
			kind: "unresolved",
			...span(source, index, close === -1 ? end : close + 1),
			status: "unresolved",
		});

	while (index < end) {
		if (escapeLength(source, index, end)) {
			index += 2;
			continue;
		}
		if (source[index] === "`") {
			const close = source.indexOf("`", index + 1);
			if (close > index + 1 && close < end) {
				append({
					kind: "code",
					...span(source, index, close + 1),
					content: value(source, index + 1, close, false),
				});
				continue;
			}
		}
		if (source.startsWith("{{", index)) {
			const variable = /^\{\{([A-Za-z_][\w-]*)\}\}/.exec(source.slice(index, end));
			if (variable) {
				append({
					kind: "variable",
					...span(source, index, index + variable[0].length),
					name: value(source, index + 2, index + variable[0].length - 2, false),
				});
				continue;
			}
		}
		if (
			source.startsWith("@sources", index) &&
			index + 8 <= end &&
			!/[\w.-]/.test(source[index + 8] ?? "")
		) {
			append({ kind: "sources", ...span(source, index, index + 8) });
			continue;
		}
		if (source.startsWith("@source{", index) || source.startsWith("@footer{", index)) {
			const close = balancedClose(source, index + 7, end, "{", "}");
			if (
				source.startsWith("@source{", index) &&
				close > index + 8 &&
				findDelimiter(source, "{", index + 8, close) === -1
			) {
				append({
					kind: "source",
					...span(source, index, close + 1),
					content: value(source, index + 8, close, false),
				});
			} else unresolved(close);
			continue;
		}
		if (source.startsWith("@icon{", index)) {
			const close = balancedClose(source, index + 5, end, "{", "}");
			if (close !== -1 && parseInlineIconName(source.slice(index + 6, close))) {
				append({
					kind: "icon",
					...span(source, index, close + 1),
					name: value(source, index + 6, close, false),
				});
			} else unresolved(close);
			continue;
		}
		if (source[index] === "@") {
			const doodle = /^@([a-z]+)((?:\.[a-z]+)*)\{/.exec(source.slice(index, end));
			if (doodle && !["icon", "source", "footer"].includes(doodle[1])) {
				const open = index + doodle[0].length - 1;
				const close = balancedClose(source, open, end, "{", "}");
				if (close > open + 1) {
					append({
						kind: "doodle",
						...span(source, index, close + 1),
						name: doodle[1],
						modifiers: doodle[2] ? doodle[2].slice(1).split(".") : [],
						children: parse(source, open + 1, close),
					});
				} else unresolved(close);
				continue;
			}
		}
		if (source[index] === "[") {
			const labelEnd = balancedClose(source, index, end, "[", "]");
			if (labelEnd !== -1 && labelEnd + 1 < end) {
				if (source[labelEnd + 1] === "(") {
					const close = balancedClose(source, labelEnd + 1, end, "(", ")", false);
					const href = close === -1 ? "" : source.slice(labelEnd + 2, close);
					if (href && !/\s/.test(href)) {
						append({
							kind: "link",
							...span(source, index, close + 1),
							children: parse(source, index + 1, labelEnd),
							destination: value(source, labelEnd + 2, close, false),
						});
					} else unresolved(close);
					continue;
				}
				if (source[labelEnd + 1] === "{") {
					const close = balancedClose(source, labelEnd + 1, end, "{", "}");
					if (close !== -1 && findDelimiter(source, "{", labelEnd + 2, close) === -1) {
						append({
							kind: "term",
							...span(source, index, close + 1),
							children: parse(source, index + 1, labelEnd),
							definition: value(source, labelEnd + 2, close),
						});
					} else unresolved(close);
					continue;
				}
			}
		}
		let formatted = false;
		for (const [delimiter, kind] of [
			["**", "strong"],
			["~~", "strike"],
			["==", "highlight"],
		] as const) {
			if (!source.startsWith(delimiter, index) || index + 2 > end) continue;
			const close = findDelimiter(source, delimiter, index + 2, end);
			if (close > index + 2) {
				append({
					kind,
					...span(source, index, close + 2),
					children: parse(source, index + 2, close),
				});
				formatted = true;
			}
			break;
		}
		if (formatted) continue;
		if (source[index] === "*" && source[index + 1] !== "*") {
			let close = index + 1;
			for (; close < end; close++) {
				if (escapeLength(source, close, end)) {
					close++;
					continue;
				}
				if (
					source[close] === "*" &&
					source[close - 1] !== "*" &&
					(close + 1 === end || source[close + 1] !== "*")
				)
					break;
			}
			if (close > index + 1 && close < end) {
				append({
					kind: "emphasis",
					...span(source, index, close + 1),
					children: parse(source, index + 1, close),
				});
				continue;
			}
		}
		index++;
	}
	flush();
	return nodes;
}

/** Pass the full lesson and an undecoded G1 token/span to retain lesson-relative offsets. */
export function tokenizeInline(
	source: string,
	range: InlineRange = { start: 0, end: source.length },
): InlineTree {
	const { start, end } = range;
	if (
		!Number.isInteger(start) ||
		!Number.isInteger(end) ||
		start < 0 ||
		end < start ||
		end > source.length
	)
		throw new RangeError("Inline range must be inside the source");
	return ownInlineTrivia({ source, start, end, children: parse(source, start, end) });
}
