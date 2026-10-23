import type { TokenStream } from "../lex/index.ts";
import type { BodyValue, SourceSpan, TreeKind, TreeNode } from "./types.ts";

export function span(stream: TokenStream, tokenStart: number, tokenEnd: number): SourceSpan {
	const start = stream.tokens[tokenStart]?.start ?? stream.source.length;
	return {
		start,
		end: tokenEnd === tokenStart ? start : stream.tokens[tokenEnd - 1].end,
		tokenStart,
		tokenEnd,
	};
}

export function bodyValue(stream: TokenStream, start: number, end: number): BodyValue {
	const raw = stream.source.slice(start, end);
	return {
		range: { start, end },
		raw,
		value: raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1"),
	};
}

export function bodyNode(
	stream: TokenStream,
	kind: TreeKind,
	tokenStart: number,
	tokenEnd: number,
): TreeNode {
	const location = span(stream, tokenStart, tokenEnd);
	return {
		kind,
		status: "resolved",
		span: location,
		raw: stream.source.slice(location.start, location.end),
		children: [],
		trivia: [],
		settings: [],
	};
}

export function extendNode(stream: TokenStream, node: TreeNode, tokenEnd: number): void {
	node.span = span(stream, node.span.tokenStart, tokenEnd);
	node.raw = stream.source.slice(node.span.start, node.span.end);
}
