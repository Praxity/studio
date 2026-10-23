import YAML, { CST, isMap, isNode, isScalar, isSeq } from "yaml";
import { findFrontmatterRange, parseFrontmatter } from "./frontmatter.ts";
import { normalizeYamlLineEndings, preserveLineEndings } from "./line-endings.ts";

/** A replacement of `[start, end)` in the full source, offsets not lines. */
export interface SourceEdit {
	start: number;
	end: number;
	text: string;
}

export function applyEdits(source: string, edits: readonly SourceEdit[]): string {
	for (const edit of edits) {
		if (
			!Number.isSafeInteger(edit.start) ||
			!Number.isSafeInteger(edit.end) ||
			edit.start < 0 ||
			edit.end < edit.start ||
			edit.end > source.length
		)
			throw new SourceEditError("Invalid source edit range");
	}
	const ordered = [...edits].sort((a, b) => b.start - a.start);
	for (let index = 1; index < ordered.length; index += 1) {
		if (ordered[index].end > ordered[index - 1].start) {
			throw new SourceEditError("overlapping source edits");
		}
	}
	let result = source;
	for (const edit of ordered) {
		result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
	}
	return result;
}

export class SourceEditError extends Error {
	readonly code = "invalid-args";
}

function yamlEditDocument(source: string) {
	// YAML accepts LF/CRLF only. Normalize lone CR without moving any raw offset,
	// then restore CST trivia so collection edits retain the author's bytes.
	const input = normalizeYamlLineEndings(source);
	const document = YAML.parseDocument(input, { keepSourceTokens: true });
	const token = document.contents?.srcToken;
	if (input !== source && token) {
		const restore = (token: CST.Token) => {
			if ("source" in token)
				token.source = source.slice(token.offset, token.offset + token.source.length);
			if ("end" in token) for (const part of token.end ?? []) restore(part);
			if ("props" in token) for (const part of token.props) restore(part);
		};
		CST.visit({ start: [], value: token }, (item) => {
			for (const part of [...item.start, ...(item.sep ?? [])]) restore(part);
			if (item.key) restore(item.key);
			if (item.value) restore(item.value);
		});
	}
	return document;
}

/** Edit only the selected value or collection entry. CST tokens retain authored
 * trivia; document serialization would rewrite unrelated flow syntax and EOLs. */
export function setYamlPath(
	source: string,
	path: readonly (string | number)[],
	value: unknown,
): string {
	const document = yamlEditDocument(source);
	if (document.errors.length > 0 || !path.length) throw new SourceEditError("Invalid YAML edit");
	const deleting = value === undefined || value === null;
	const target = document.getIn(path, true);
	let next: string;
	if (!deleting && isNode(target) && target.range) {
		// Flow replacements fit anywhere a value can occur, including inline maps.
		// Multiline strings use quoted escapes so no neighbouring indentation changes.
		const text = YAML.stringify(value, {
			collectionStyle: "flow",
			lineWidth: 0,
			defaultStringType:
				typeof value === "string" && /[\r\n]/u.test(value)
					? "QUOTE_DOUBLE"
					: isScalar(target) && (target.type === "QUOTE_SINGLE" || target.type === "QUOTE_DOUBLE")
						? target.type
						: "PLAIN",
		}).trimEnd();
		const suffix =
			target.srcToken && ["block-scalar", "block-map", "block-seq"].includes(target.srcToken.type)
				? (source.slice(target.range[0], target.range[1]).match(/(?:\r\n|\r|\n)$/u)?.[0] ?? "")
				: "";
		next = applyEdits(source, [
			{ start: target.range[0], end: target.range[1], text: text + suffix },
		]);
	} else {
		let depth = path.length - 1;
		while (depth > 0 && !document.hasIn(path.slice(0, depth))) depth--;
		const parent = depth ? document.getIn(path.slice(0, depth), true) : document.contents;
		if (parent === null && !deleting) {
			const fragment = new YAML.Document();
			fragment.setIn(path, value);
			next =
				source +
				preserveLineEndings(
					`${source && !source.endsWith("\n") ? "\n" : ""}${fragment.toString()}`,
					source,
				);
		} else {
			if (
				(!isMap(parent) && !isSeq(parent)) ||
				!parent.range ||
				!parent.srcToken ||
				!CST.isCollection(parent.srcToken)
			)
				throw new SourceEditError("YAML path does not select an editable collection");
			const token = parent.srcToken;
			const key = path[depth];
			if (deleting) {
				if (depth !== path.length - 1 || !parent.has(key)) return source;
				const index = isMap(parent)
					? parent.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === key)
					: typeof key === "number"
						? key
						: -1;
				const item = token.items[index];
				if (!item) throw new SourceEditError("YAML entry has no source token");
				if (token.type === "flow-collection") {
					token.items.splice(index, 1);
					const following = token.items[index];
					const trivia = item.start.filter((part) => part.type !== "comma");
					if (following) following.start.unshift(...trivia);
					else token.end.unshift(...trivia);
					if (index === 0 && token.items[0])
						token.items[0].start = token.items[0].start.filter((part) => part.type !== "comma");
					next = applyEdits(source, [
						{ start: parent.range[0], end: parent.range[2], text: CST.stringify(token) },
					]);
				} else {
					// Delete the entry's own line, leaving preceding standalone comments
					// and the following entry's indentation at their exact offsets.
					const first = item.key ?? item.start.find((part) => part.type === "seq-item-ind");
					const last = item.value ?? item.sep?.at(-1) ?? first;
					if (!first || !last) throw new SourceEditError("Missing YAML entry range");
					const end = last.offset + CST.stringify(last).length;
					if (parent.items.length === 1) {
						const ending = source.slice(first.offset, end).match(/\r?\n$/u)?.[0] ?? "";
						next = applyEdits(source, [
							{ start: first.offset, end, text: (isMap(parent) ? "{}" : "[]") + ending },
						]);
					} else {
						const lineStart = source.lastIndexOf("\n", first.offset - 1) + 1;
						const start = /^[ \t]*$/u.test(source.slice(lineStart, first.offset))
							? lineStart
							: first.offset;
						next = applyEdits(source, [{ start, end, text: "" }]);
					}
				}
			} else {
				const fragment = new YAML.Document();
				fragment.setIn(path.slice(depth), value);
				if (isSeq(parent)) {
					if (
						typeof key !== "number" ||
						!Number.isSafeInteger(key) ||
						key < parent.items.length ||
						!isSeq(fragment.contents)
					)
						throw new SourceEditError("Invalid YAML sequence index");
					fragment.contents.items = fragment.contents.items.slice(parent.items.length);
				}
				if (token.type === "flow-collection") {
					const closer = token.end.find(
						(part) => part.type === (isMap(parent) ? "flow-map-end" : "flow-seq-end"),
					);
					if (!closer) throw new SourceEditError("Missing YAML collection closer");
					const text = fragment.toString({ collectionStyle: "flow", lineWidth: 0 }).trim();
					next = applyEdits(source, [
						{
							start: closer.offset,
							end: closer.offset,
							text: `${parent.items.length ? ", " : ""}${text.slice(1, -1).trim()}`,
						},
					]);
				} else {
					const indent = " ".repeat(token.indent);
					const text = fragment
						.toString()
						.split("\n")
						.map((line) => (line ? indent + line : line))
						.join("\n");
					const end = parent.range[2];
					next = applyEdits(source, [
						{
							start: end,
							end,
							text: preserveLineEndings(
								`${source[end - 1] === "\n" ? "" : "\n"}${text}`,
								source.slice(parent.range[0], end),
							),
						},
					]);
				}
			}
		}
	}
	// Reject an edit whose syntax changes the wrong data, before returning any bytes.
	if (deleting) document.deleteIn(path);
	else document.setIn(path, value);
	const candidate = yamlEditDocument(next);
	if (
		candidate.errors.length ||
		JSON.stringify(candidate.toJS()) !== JSON.stringify(document.toJS())
	)
		throw new SourceEditError("YAML edit could not preserve the requested data");
	return next;
}

/** Edit YAML frontmatter without reserializing the `.prax` body. */
export function setFrontmatterPath(
	source: string,
	path: readonly (string | number)[],
	value: unknown,
): string {
	if (parseFrontmatter(source).errorLine !== undefined)
		throw new SourceEditError("Invalid or unclosed frontmatter");
	const range = findFrontmatterRange(source);
	if (!range) {
		const yaml = setYamlPath("", path, value).trimEnd();
		const bomEnd = source.startsWith("\uFEFF") ? 1 : 0;
		return yaml
			? source.slice(0, bomEnd) +
					preserveLineEndings(`---\n${yaml}\n---\n\n`, source) +
					source.slice(bomEnd)
			: source;
	}
	const yaml = setYamlPath(source.slice(range.yamlStart, range.yamlEnd), path, value);
	return applyEdits(source, [{ start: range.yamlStart, end: range.yamlEnd, text: yaml }]);
}
