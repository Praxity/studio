import type { TokenLine, TokenStream } from "../lex/index.ts";
import { bodyNode, bodyValue, span } from "./source.ts";
import type { BodyValue } from "./types.ts";

/** Pipe separators outside escapes and matched inline code runs delimit cells. */
function cells(stream: TokenStream, line: TokenLine): BodyValue[] | undefined {
	const text = stream.source.slice(line.start, line.contentEnd);
	const boundaries: number[] = [];
	let code = 0;
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\\") {
			index++;
			continue;
		}
		if (text[index] === "`") {
			let length = 1;
			while (text[index + length] === "`") length++;
			if (code === length) code = 0;
			else if (!code && text.indexOf("`".repeat(length), index + length) >= 0) code = length;
			index += length - 1;
		} else if (text[index] === "|" && !code) boundaries.push(index);
	}
	if (!boundaries.length) return;
	if (text.slice(0, boundaries[0]).trim()) boundaries.unshift(-1);
	const last = boundaries.at(-1) ?? 0;
	if (text.slice(last + 1).trim()) boundaries.push(text.length);
	const result: BodyValue[] = [];
	for (let index = 0; index + 1 < boundaries.length; index++) {
		let start = boundaries[index] + 1;
		let end = boundaries[index + 1];
		while (start < end && /[ \t]/.test(text[start])) start++;
		while (end > start && /[ \t]/.test(text[end - 1])) end--;
		result.push(bodyValue(stream, line.start + start, line.start + end));
	}
	return result;
}

export function readTable(
	stream: TokenStream,
	lines: TokenLine[],
	first: number,
	declared = false,
) {
	const firstCells = cells(stream, lines[first]);
	if (!firstCells) return;
	const nextCells = lines[first + 1] && cells(stream, lines[first + 1]);
	if (
		!declared &&
		!stream.source.slice(lines[first].start, lines[first].contentEnd).trimStart().startsWith("|") &&
		!(nextCells?.length === firstCells.length && isSeparator(nextCells))
	)
		return;
	const node = bodyNode(stream, "table", lines[first].tokenStart, lines[first].tokenEnd);
	node.rows = [];
	let last = first;
	for (
		let index = first;
		index < lines.length && ["prose", "part"].includes(lines[index].kind);
		index++
	) {
		const rowCells = cells(stream, lines[index]);
		if (!rowCells) break;
		if (index === first + 1 && rowCells.length === firstCells.length && isSeparator(rowCells)) {
			node.alignments = rowCells.map((cell) =>
				String(cell.value).startsWith(":")
					? String(cell.value).endsWith(":")
						? "center"
						: "left"
					: String(cell.value).endsWith(":")
						? "right"
						: undefined,
			);
			node.rows[0].header = true;
		} else
			node.rows.push({
				span: span(stream, lines[index].tokenStart, lines[index].tokenEnd),
				cells: rowCells,
				header: false,
			});
		last = index;
	}
	node.span = span(stream, lines[first].tokenStart, lines[last].tokenEnd);
	node.raw = stream.source.slice(node.span.start, node.span.end);
	return { node, last };
}

function isSeparator(values: BodyValue[]): boolean {
	return values.every((cell) => /^:?-{3,}:?$/.test(String(cell.value)));
}

export function isTableSeparator(stream: TokenStream, line: TokenLine): boolean {
	const values = cells(stream, line);
	return values !== undefined && values.length > 0 && isSeparator(values);
}
