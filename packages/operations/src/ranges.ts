import { findLineEnding, normalizeLineEndings } from "@praxity/grammar/src/line-endings.ts";
import type { OperationRefusalCode } from "@praxity/grammar/src/operations/contract.ts";
import type { SourceEdit } from "@praxity/grammar/src/source-edit.ts";
import type { AnalyzedLessonTree, TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";

export interface LocatedNode {
	node: TreeNode;
	path: number[];
	parent: LocatedNode | null;
}
export function locateTree(tree: AnalyzedLessonTree): LocatedNode[] {
	const nodes: LocatedNode[] = [];
	const visit = (node: TreeNode, path: number[], parent: LocatedNode | null) => {
		const entry = { node, path, parent };
		nodes.push(entry);
		node.children.forEach((child, index) => visit(child, [...path, index], entry));
	};
	visit(tree.root, [], null);
	return nodes;
}

/** Whole-node deletion owns one adjacent blank, while source fields exclude closers. */
export function deletionRange(entry: LocatedNode): { start: number; end: number } {
	const { start, end } = entry.node.span;
	const following = entry.parent?.node.trivia.find((span) => span.start === end);
	if (following) return { start, end: following.end };
	const preceding = [...(entry.parent?.node.trivia ?? [])]
		.reverse()
		.find((span) => span.end === start);
	return { start: preceding?.start ?? start, end };
}
export function draftRange(node: TreeNode) {
	return { start: node.span.start, end: node.closer?.start ?? node.span.end };
}

/** Expand admitted UTF-16 draft ranges without changing authored bytes. */
export function draftText(
	source: string,
	expected: { start: number; end: number },
	editable: { start: number; end: number },
) {
	for (const range of [expected, editable]) {
		if (
			!range ||
			!Number.isSafeInteger(range.start) ||
			!Number.isSafeInteger(range.end) ||
			range.start < 0 ||
			range.end < range.start ||
			range.end > source.length
		)
			throw new RangeError("invalid-args" satisfies OperationRefusalCode);
	}
	if (editable.start < expected.start || editable.end > expected.end)
		throw new RangeError("invalid-args" satisfies OperationRefusalCode);
	return {
		expectedText: source.slice(expected.start, expected.end),
		editableText: source.slice(editable.start, editable.end),
	};
}

/** Trim shared bytes without splitting surrogate pairs or CRLF terminators. */
export function minimalEdit(source: string, edit: SourceEdit): SourceEdit | null {
	const old = source.slice(edit.start, edit.end);
	let prefix = 0;
	while (prefix < old.length && prefix < edit.text.length && old[prefix] === edit.text[prefix])
		prefix++;
	if (prefix && (old[prefix - 1] === "\r" || /[\uD800-\uDBFF]/u.test(old[prefix - 1]))) prefix--;
	let suffix = 0;
	while (
		suffix < old.length - prefix &&
		suffix < edit.text.length - prefix &&
		old.at(-1 - suffix) === edit.text.at(-1 - suffix)
	)
		suffix++;
	if (
		suffix &&
		(old[old.length - suffix] === "\n" || /[\uDC00-\uDFFF]/u.test(old[old.length - suffix]))
	)
		suffix--;
	if (prefix === old.length && prefix === edit.text.length) return null;
	return {
		start: edit.start + prefix,
		end: edit.end - suffix,
		text: edit.text.slice(prefix, edit.text.length - suffix),
	};
}
/** Subject edges are parser whitespace; other fields retain their authored spaces. */
export function canvasTextReplacement(field: string | undefined, text: string) {
	return field === "subject" ? text.replace(/^[ \t]+|[ \t]+$/gu, "") : text;
}

/** Match wraps by their text boundary so removing one cannot shift later terminators. */
export function preserveTextWraps(text: string, previous: string, file: string): string {
	const endings = [...previous.matchAll(/\r\n|\r|\n/gu)];
	const old = previous.replace(/\r\n|\r|\n/gu, "");
	const normalized = normalizeLineEndings(text);
	const next = normalized.replace(/\n/gu, "");
	const lines = normalizeLineEndings(previous).split("\n");
	const positions = new Set<number>();
	let position = 0;
	for (const char of normalized) {
		if (char === "\n") positions.add(position);
		else position += char.length;
	}
	// An unchanged, unique adjacent line also anchors wraps inside separate word edits.
	const anchor = (line: string, end: boolean) => {
		const index = next.indexOf(line);
		if (
			index < 0 ||
			index !== next.lastIndexOf(line) ||
			old.indexOf(line) !== old.lastIndexOf(line)
		)
			return undefined;
		const position = index + (end ? line.length : 0);
		return positions.has(position) ? position : undefined;
	};
	const change = minimalEdit(old, { start: 0, end: old.length, text: next });
	const delta = next.length - old.length;
	const retained = new Map<number, string>();
	const unmatched: string[] = [];
	let removed = 0;
	for (const [ordinal, ending] of endings.entries()) {
		const position = ending.index - removed;
		removed += ending[0].length;
		const known = !change
			? position
			: position >= change.end
				? position + delta
				: position <= change.start
					? position
					: undefined;
		const boundary =
			known !== undefined && positions.has(known)
				? known
				: (anchor(lines[ordinal], true) ?? anchor(lines[ordinal + 1], false));
		if (boundary !== undefined) retained.set(boundary, ending[0]);
		else if (known === undefined) unmatched.push(ending[0]);
	}
	const count = normalized.match(/\n/gu)?.length ?? 0;
	let ordinal = 0;
	let remaining = 0;
	const fallback = findLineEnding(previous) ?? findLineEnding(file) ?? "\n";
	return normalized.replace(/\n/gu, (_newline, offset: number) => {
		const position = offset - ordinal++;
		return (
			retained.get(position) ??
			(count === endings.length ? unmatched[remaining++] : undefined) ??
			fallback
		);
	});
}

export function inverseEdits(source: string, edits: readonly SourceEdit[]): SourceEdit[] {
	let delta = 0;
	return [...edits]
		.sort((a, b) => a.start - b.start)
		.map((edit) => {
			const start = edit.start + delta;
			delta += edit.text.length - (edit.end - edit.start);
			return { start, end: start + edit.text.length, text: source.slice(edit.start, edit.end) };
		});
}

/** An insertion at a node's end remains outside that node. */
export function translateRange(start: number, end: number, edits: readonly SourceEdit[]) {
	let delta = 0;
	for (const edit of edits) {
		if (edit.end <= start) delta += edit.text.length - (edit.end - edit.start);
		else if (edit.start < end) return null;
	}
	return { start: start + delta, end: end + delta };
}
const structuralErrors = new Set([
	"unclosed-block",
	"stray-closer",
	"stray-item",
	"item-before-close",
]);
/** Reparse in place and compare the scopes and interpretation of every untouched node. */
export function escapes(
	before: AnalyzedLessonTree,
	after: AnalyzedLessonTree,
	edits: readonly SourceEdit[],
	targets: readonly LocatedNode[],
): boolean {
	const oldNodes = locateTree(before);
	const newNodes = locateTree(after);
	if (after.refused && !before.refused) return true;
	for (const diagnostic of after.diagnostics.filter((d) => structuralErrors.has(d.code))) {
		if (
			!before.diagnostics.some(
				(d) =>
					d.code === diagnostic.code &&
					translateRange(d.span.start, d.span.end, edits)?.start === diagnostic.span.start,
			)
		)
			return true;
	}
	const literalBalance = (tree: AnalyzedLessonTree) => {
		let code = false;
		let math = false;
		for (const line of tree.stream.lines) {
			if (line.kind === "code-fence") code = !code;
			if (line.kind === "math-fence") math = !math;
		}
		return code || math;
	};
	if (literalBalance(after) && !literalBalance(before)) return true;
	for (const old of oldNodes) {
		if (old.node.kind === "lesson") continue;
		if (
			targets.some(
				(t) => t.path.every((p, i) => old.path[i] === p) && old.path.length >= t.path.length,
			)
		)
			continue;
		const range = translateRange(old.node.span.start, old.node.span.end, edits);
		if (
			!range ||
			((old.node.kind === "page" || old.node.kind === "item") &&
				edits.some((e) => e.start === e.end && e.start === old.node.span.end))
		) {
			// Ancestors may change their body, but fixed headers/closers must retain their owner.
			for (const span of [old.node.header, old.node.closer]) {
				if (!span) continue;
				const next = translateRange(span.start, span.end, edits);
				if (!next) return true;
				const owner = newNodes.find(
					(n) =>
						(span === old.node.header ? n.node.header?.start : n.node.closer?.start) ===
							next.start && n.node.kind === old.node.kind,
				);
				if (!owner) return true;
			}
			continue;
		}
		// Appending after an unterminated EOF line gives that existing node one
		// terminator. Its authored bytes and ownership must still match exactly.
		const appendedEnding =
			old.node.span.end === before.stream.source.length && !/[\r\n]$/u.test(old.node.raw)
				? (edits
						.find((edit) => edit.start === old.node.span.end && edit.end === edit.start)
						?.text.match(/^(?:\r\n|\r|\n)/u)?.[0] ?? "")
				: "";
		const next = newNodes.find(
			(n) =>
				n.node.span.start === range.start &&
				n.node.span.end === range.end + appendedEnding.length &&
				n.node.kind === old.node.kind &&
				n.node.type === old.node.type &&
				(!appendedEnding || n.node.raw === old.node.raw + appendedEnding),
		);
		if (!next || next.node.headingLevel !== old.node.headingLevel) return true;
		let parent = old.parent;
		let newParent = next.parent;
		while (parent && newParent) {
			if (parent.node.kind !== newParent.node.kind || parent.node.type !== newParent.node.type)
				return true;
			if (parent.node.header) {
				const anchor = translateRange(parent.node.header.start, parent.node.header.end, edits);
				if (!anchor || anchor.start !== newParent.node.header?.start) return true;
			}
			parent = parent.parent;
			newParent = newParent.parent;
		}
		if (parent || newParent) return true;
	}
	return false;
}
