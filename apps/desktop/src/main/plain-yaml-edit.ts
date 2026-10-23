import { isDeepStrictEqual } from "node:util";
import { normalizeYamlLineEndings } from "@praxity/grammar";
import {
	type CST,
	isMap,
	isNode,
	isSeq,
	type Node,
	Parser,
	parseAllDocuments,
	stringify,
	visit,
} from "yaml";
import { PlainYamlRequiredError } from "../shared/project-write-errors";

/** These legacy edits are retired by X1. Refuse syntax we cannot preserve exactly
 * instead of introducing a general YAML editor for the old formats. */
export function plainYamlDocument(source: string) {
	return parsePlainYaml(source).document;
}

function parsePlainYaml(source: string) {
	const input = normalizeYamlLineEndings(source);
	const documents = parseAllDocuments(input, { keepSourceTokens: true });
	if (documents.length !== 1 || documents[0].errors.length || !isMap(documents[0].contents))
		throw new PlainYamlRequiredError();
	const comments: CST.SourceToken[] = [];
	function check(token: CST.Token, flowEnd?: number): void {
		if (token.type === "comment") comments.push(token);
		if (
			token.type === "anchor" ||
			token.type === "alias" ||
			(token.type === "comment" && flowEnd !== undefined && token.offset < flowEnd)
		)
			throw new PlainYamlRequiredError();
		if (token.type === "flow-collection") {
			const end = token.end.find(
				(part) => part.type === "flow-map-end" || part.type === "flow-seq-end",
			);
			if (!end) throw new PlainYamlRequiredError();
			const last = token.items.at(-1);
			if (last && !last.key && !last.value && last.start.some((part) => part.type === "comma"))
				throw new PlainYamlRequiredError();
			check(token.start, end.offset);
			for (const item of token.items) {
				for (const part of [...item.start, ...(item.sep ?? [])]) check(part, end.offset);
				if (item.key) check(item.key, end.offset);
				if (item.value) check(item.value, end.offset);
			}
			// A nested collection's trailing comments are still inside its parent's flow.
			for (const part of token.end) check(part, flowEnd ?? end.offset);
		} else if (token.type === "block-map" || token.type === "block-seq") {
			for (const item of token.items) {
				for (const part of [...item.start, ...(item.sep ?? [])]) check(part, flowEnd);
				if (item.key) check(item.key, flowEnd);
				if (item.value) check(item.value, flowEnd);
			}
		} else if (token.type === "document") {
			for (const part of token.start) check(part, flowEnd);
			if (token.value) check(token.value, flowEnd);
			for (const part of token.end ?? []) check(part, flowEnd);
		} else if ("end" in token) {
			for (const part of token.end ?? []) check(part, flowEnd);
		} else if (token.type === "block-scalar") {
			for (const part of token.props) check(part, flowEnd);
		}
	}
	for (const token of new Parser().parse(input)) check(token);
	return { document: documents[0], comments };
}

export interface YamlEdit {
	start: number;
	end: number;
	text: string;
}

/** Match comments to their nodes, not just equal text elsewhere in the file.
 * Standalone comments between entries belong to the collection: their ownership
 * is ambiguous, so deleting an adjacent entry cannot authorize their removal. */
function requirePreservedComments(
	source: string,
	original: ReturnType<typeof parsePlainYaml>,
	content: string,
	candidate: ReturnType<typeof parsePlainYaml>,
	edits: YamlEdit[],
): void {
	const counterparts = new Map<Node, Node | undefined>();
	const removed = new Set<Node>();
	const equal = (left: unknown, right: unknown) =>
		isDeepStrictEqual(isNode(left) ? left.toJSON() : left, isNode(right) ? right.toJSON() : right);
	function match(before: unknown, after: unknown, deleted = false): void {
		if (!isNode(before)) return;
		counterparts.set(before, isNode(after) ? after : undefined);
		const range = before.range;
		if (deleted && range && edits.some((edit) => edit.start <= range[0] && edit.end >= range[1]))
			removed.add(before);
		if (isMap(before)) {
			const next = isMap(after) ? after.items : [];
			const onlyDeletes =
				isMap(after) &&
				next.length < before.items.length &&
				next.every((pair) => before.items.some((old) => equal(old.key, pair.key)));
			for (const pair of before.items) {
				const following = next.find((item) => equal(pair.key, item.key));
				const deleting = deleted || (onlyDeletes && !following);
				match(pair.key, following?.key, deleting);
				match(pair.value, following?.value, deleting);
			}
		} else if (isSeq(before)) {
			const next = isSeq(after) ? after.items : [];
			const available = new Set(before.items.map((_, index) => index));
			const matches = new Map<number, unknown>();
			for (const item of next) {
				const index = [...available].find((index) => equal(before.items[index], item));
				if (index !== undefined) {
					available.delete(index);
					matches.set(index, item);
				}
			}
			const onlyDeletes =
				isSeq(after) && next.length < before.items.length && matches.size === next.length;
			for (const [index, item] of before.items.entries()) {
				// Duplicate values do not identify which authored entry was removed.
				const unique = before.items.filter((other) => equal(item, other)).length === 1;
				match(item, matches.get(index), deleted || (onlyDeletes && unique && !matches.has(index)));
			}
		}
	}
	match(original.document.contents, candidate.document.contents);
	function inventory(parsed: ReturnType<typeof parsePlainYaml>, text: string) {
		const nodes: Node[] = [];
		visit(parsed.document, {
			Node: (_key, node) => {
				nodes.push(node);
			},
		});
		return parsed.comments.map((token) => {
			let owner = [...nodes].reverse().find((node) => {
				if (!node.range || token.offset < node.range[0]) return false;
				return (
					token.offset < node.range[1] ||
					(token.offset < node.range[2] && !/[\r\n]/.test(text.slice(node.range[1], token.offset)))
				);
			});
			const lineStart =
				Math.max(
					text.lastIndexOf("\n", token.offset - 1),
					text.lastIndexOf("\r", token.offset - 1),
				) + 1;
			if (/^[ \t]*$/.test(text.slice(lineStart, token.offset))) {
				// Removing the first entry can leave a gap comment before the
				// collection's AST range. It still belongs to that collection.
				const leading = nodes.find(
					(node) =>
						(isMap(node) || isSeq(node)) &&
						node.range &&
						node.range[0] > token.offset &&
						node.srcToken &&
						"indent" in node.srcToken &&
						node.srcToken.indent === token.indent &&
						/^\s*$/.test(text.slice(token.offset + token.source.length, node.range[0])),
				);
				if (leading) owner = leading;
			}
			const trailing = owner?.range && token.offset >= owner.range[1];
			return {
				owner,
				raw: token.source,
				trailing: Boolean(trailing),
			};
		});
	}
	const next = inventory(candidate, content);
	let cursor = 0;
	for (const comment of inventory(original, source)) {
		if (comment.owner && removed.has(comment.owner)) continue;
		const owner = comment.owner ? counterparts.get(comment.owner) : undefined;
		if (comment.owner && !owner) throw new PlainYamlRequiredError();
		const index = next.findIndex(
			(item, index) =>
				index >= cursor &&
				item.owner === owner &&
				item.raw === comment.raw &&
				item.trailing === comment.trailing,
		);
		if (index < 0) throw new PlainYamlRequiredError();
		cursor = index + 1;
	}
}

/** A candidate must preserve the byte partition outside the declared edits and
 * both its complete resolved data and the owning reader's interpretation. */
export function applyPlainYamlEdits<T>(
	source: string,
	edits: YamlEdit[],
	expected: unknown,
	read: (source: string) => T,
): string {
	const ordered = [...edits].sort((a, b) => a.start - b.start);
	let cursor = 0,
		content = "";
	const untouched: Array<{ bytes: Buffer; start: number; end: number }> = [];
	for (const edit of ordered) {
		if (edit.start < cursor || edit.end < edit.start || edit.end > source.length)
			throw new PlainYamlRequiredError();
		const bytes = source.slice(cursor, edit.start),
			start = content.length;
		content += bytes;
		untouched.push({ bytes: Buffer.from(bytes), start, end: content.length });
		content += edit.text;
		cursor = edit.end;
	}
	const start = content.length;
	content += source.slice(cursor);
	untouched.push({ bytes: Buffer.from(source.slice(cursor)), start, end: content.length });
	if (
		untouched.some((part) => !part.bytes.equals(Buffer.from(content.slice(part.start, part.end))))
	)
		throw new PlainYamlRequiredError();
	try {
		const original = parsePlainYaml(source);
		const candidate = parsePlainYaml(content);
		if (
			!isDeepStrictEqual(candidate.document.toJS(), expected) ||
			!isDeepStrictEqual(read(content), read(stringify(expected)))
		)
			throw new PlainYamlRequiredError();
		requirePreservedComments(source, original, content, candidate, ordered);
	} catch (error) {
		if (error instanceof PlainYamlRequiredError) throw error;
		throw new PlainYamlRequiredError(error);
	}
	return content;
}
