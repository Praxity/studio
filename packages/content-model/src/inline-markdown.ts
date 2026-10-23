import { decodeEscapes, escapeLength, findUnescaped } from "./escaping";
import { parseInlineIconName } from "./inline-icons";
import {
	type InlineNode,
	type InlineSource,
	type InlineTree,
	type InlineValue,
	ownInlineTrivia,
	renderInlineTree,
} from "./inline-tree";

export interface InlineMarkdownOptions {
	interactive?: boolean;
	/** Restrict narration to visual bold/italic; leave cues and other syntax literal. */
	emphasisOnly?: boolean;
}

function closingBrace(text: string, open: number): number {
	let depth = 1;
	for (let index = open + 1; index < text.length; index++) {
		if (escapeLength(text, index)) {
			index++;
			continue;
		}
		if (text[index] === "`") {
			const end = text.indexOf("`", index + 1);
			if (end !== -1) index = end;
			continue;
		}
		if (text[index] === "{") depth++;
		if (text[index] === "}" && --depth === 0) return index;
	}
	return -1;
}

function closingBracket(text: string, open: number): number {
	let depth = 1;
	for (let index = open + 1; index < text.length; index++) {
		if (escapeLength(text, index)) {
			index++;
			continue;
		}
		if (text[index] === "`") {
			const end = text.indexOf("`", index + 1);
			if (end !== -1) index = end;
			continue;
		}
		if (text[index] === "[") depth++;
		if (text[index] === "]" && --depth === 0) return index;
	}
	return -1;
}

function closingItalic(text: string, start: number): number {
	for (let index = start; index < text.length; index++) {
		if (escapeLength(text, index)) {
			index++;
			continue;
		}
		if (text[index] === "*" && text[index - 1] !== "*" && text[index + 1] !== "*") return index;
	}
	return -1;
}

function parse(text: string, emphasisOnly = false, offset = 0): InlineNode[] {
	const nodes: InlineNode[] = [];
	let plainStart = 0;
	let index = 0;
	const span = (start: number, end: number): InlineSource => ({
		start: offset + start,
		end: offset + end,
		raw: text.slice(start, end),
	});
	const value = (start: number, end: number, decode = false): InlineValue => ({
		...span(start, end),
		value: decode ? decodeEscapes(text.slice(start, end)) : text.slice(start, end),
	});
	const flush = () => {
		if (plainStart < index) nodes.push({ kind: "text", ...value(plainStart, index) });
	};
	const append = (node: InlineNode) => {
		flush();
		nodes.push(node);
		index = node.end - offset;
		plainStart = index;
	};
	const unresolved = (end: number) =>
		append({ kind: "unresolved", ...span(index, end), status: "unresolved" });
	const children = (start: number, end: number) =>
		parse(text.slice(start, end), emphasisOnly, offset + start);

	while (index < text.length) {
		if (escapeLength(text, index)) {
			append({ kind: "text", ...value(index, index + 2, true) });
			continue;
		}
		if (!emphasisOnly && text[index] === "`") {
			const end = text.indexOf("`", index + 1);
			if (end > index + 1) {
				append({ kind: "code", ...span(index, end + 1), content: value(index + 1, end) });
				continue;
			}
		}

		if (!emphasisOnly && text.startsWith("@footer.insert", index)) {
			append({ kind: "sources", ...span(index, index + 14) });
			continue;
		}

		if (!emphasisOnly && text.startsWith("{{", index)) {
			const variable = /^\{\{([A-Za-z_][\w-]*)\}\}/.exec(text.slice(index));
			if (variable) {
				append({
					kind: "variable",
					...span(index, index + variable[0].length),
					name: value(index + 2, index + variable[0].length - 2),
				});
				continue;
			}
		}

		if (!emphasisOnly && text.startsWith("@footer{", index)) {
			const end = closingBrace(text, index + 7);
			const source = end === -1 ? "" : text.slice(index + 8, end);
			if (source && findUnescaped(source, "{") === -1) {
				append({ kind: "source", ...span(index, end + 1), content: value(index + 8, end) });
				continue;
			}
			const literalEnd = end === -1 ? text.length : end + 1;
			unresolved(literalEnd);
			continue;
		}

		if (!emphasisOnly && text.startsWith("@icon{", index)) {
			const end = closingBrace(text, index + 5);
			if (end !== -1) {
				const icon = parseInlineIconName(text.slice(index + 6, end));
				if (icon) {
					append({ kind: "icon", ...span(index, end + 1), name: value(index + 6, end) });
					continue;
				}
			}
			const literalEnd = end === -1 ? text.length : end + 1;
			unresolved(literalEnd);
			continue;
		}

		if (!emphasisOnly && text[index] === "@") {
			const doodle = /^@([a-z]+)((?:\.[a-z]+)*)\{/.exec(text.slice(index));
			if (doodle && doodle[1] !== "icon" && doodle[1] !== "footer") {
				const open = index + doodle[0].length - 1;
				const end = closingBrace(text, open);
				if (end > open + 1) {
					append({
						kind: "doodle",
						...span(index, end + 1),
						name: doodle[1],
						modifiers: doodle[2] ? doodle[2].slice(1).split(".") : [],
						children: children(open + 1, end),
					});
					continue;
				}
				const literalEnd = end === -1 ? text.length : end + 1;
				unresolved(literalEnd);
				continue;
			}
		}

		if (!emphasisOnly && text[index] === "[") {
			const labelEnd = closingBracket(text, index);
			if (labelEnd !== -1) {
				if (text[labelEnd + 1] === "(") {
					const end = text.indexOf(")", labelEnd + 2);
					const href = end === -1 ? "" : text.slice(labelEnd + 2, end);
					if (href && !/\s/.test(href)) {
						append({
							kind: "link",
							...span(index, end + 1),
							children: children(index + 1, labelEnd),
							destination: value(labelEnd + 2, end),
						});
						continue;
					}
					const literalEnd = end === -1 ? text.length : end + 1;
					unresolved(literalEnd);
					continue;
				}
				if (text[labelEnd + 1] === "{") {
					const end = closingBrace(text, labelEnd + 1);
					const definition = end === -1 ? "" : text.slice(labelEnd + 2, end);
					if (definition && findUnescaped(definition, "{") === -1) {
						append({
							kind: "term",
							...span(index, end + 1),
							children: children(index + 1, labelEnd),
							definition: value(labelEnd + 2, end, true),
						});
						continue;
					}
					const literalEnd = end === -1 ? text.length : end + 1;
					unresolved(literalEnd);
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
			if ((emphasisOnly && kind !== "strong") || !text.startsWith(delimiter, index)) continue;
			const end = findUnescaped(text, delimiter, index + delimiter.length);
			if (end > index + delimiter.length) {
				append({
					kind,
					...span(index, end + delimiter.length),
					children: children(index + delimiter.length, end),
				});
				formatted = true;
			}
			break;
		}
		if (formatted) continue;

		if (text[index] === "*" && text[index + 1] !== "*") {
			const end = closingItalic(text, index + 1);
			if (end > index + 1) {
				append({ kind: "emphasis", ...span(index, end + 1), children: children(index + 1, end) });
				continue;
			}
		}
		index++;
	}
	flush();
	return nodes;
}

/** Display-field semantics, including legacy escapes and unresolved forms. */
export function parseInlineMarkdown(text: string, options: InlineMarkdownOptions = {}): InlineTree {
	return ownInlineTrivia({
		source: text,
		start: 0,
		end: text.length,
		children: parse(text, options.emphasisOnly),
	});
}

/** Dependency-free authored inline formatting shared by parsers and renderers. */
export function inlineMarkdown(text: string, options: InlineMarkdownOptions = {}): string {
	return renderInlineTree(parseInlineMarkdown(text, options), options);
}
