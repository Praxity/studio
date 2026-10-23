import type { Editor as TiptapEditor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;

function findCellStarts(line: string): number[] {
	const starts: number[] = [];
	for (let index = 0; index < line.length; index += 1) {
		if (line[index] !== "|") continue;
		let start = index + 1;
		while (start < line.length && line[start] === " ") {
			start += 1;
		}
		if (start >= line.length || line[start] === "|") continue;
		starts.push(start);
	}
	return starts;
}

export function findNextCell(line: string, cursorCol: number): number {
	const starts = findCellStarts(line);
	return starts.find((start) => start > cursorCol) ?? -1;
}

export function findPreviousCell(line: string, cursorCol: number): number {
	const starts = findCellStarts(line);
	let currentIndex = -1;
	for (let index = 0; index < starts.length; index += 1) {
		const start = starts[index];
		if (start <= cursorCol) {
			currentIndex = index;
			continue;
		}
		break;
	}
	if (currentIndex <= 0) return -1;
	return starts[currentIndex - 1] ?? -1;
}

interface ParagraphEntry {
	start: number;
	end: number;
	text: string;
}

function collectParagraphs(doc: PMNode) {
	const paragraphs: ParagraphEntry[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;
		const start = pos + 1;
		const end = start + node.content.size;
		paragraphs.push({ start, end, text: node.textContent ?? "" });
		return true;
	});
	return paragraphs;
}

function resolveCurrentParagraph(
	paragraphs: ParagraphEntry[],
	anchor: number,
): { index: number; cursorCol: number } | null {
	for (let index = 0; index < paragraphs.length; index += 1) {
		const paragraph = paragraphs[index];
		if (!paragraph) continue;
		if (anchor <= paragraph.end) {
			return { index, cursorCol: Math.max(0, anchor - paragraph.start) };
		}
	}
	return null;
}

function moveCursor(editor: TiptapEditor, pos: number): boolean {
	const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos));
	editor.view.dispatch(tr);
	editor.commands.focus(pos);
	return true;
}

export const TableNavExtension = Extension.create({
	name: "tableNav",

	addKeyboardShortcuts() {
		return {
			Tab: ({ editor }) => {
				const paragraphs = collectParagraphs(editor.state.doc);
				const current = resolveCurrentParagraph(paragraphs, editor.state.selection.anchor);
				if (!current) return false;
				const paragraph = paragraphs[current.index];
				if (!paragraph || !TABLE_LINE_RE.test(paragraph.text)) return false;

				const nextCol = findNextCell(paragraph.text, current.cursorCol);
				if (nextCol >= 0) {
					return moveCursor(editor, paragraph.start + nextCol);
				}

				for (let index = current.index + 1; index < paragraphs.length; index += 1) {
					const nextRow = paragraphs[index];
					if (!nextRow || !TABLE_LINE_RE.test(nextRow.text)) break;
					const starts = findCellStarts(nextRow.text);
					if (starts.length === 0) continue;
					return moveCursor(editor, nextRow.start + starts[0]);
				}

				return false;
			},
			"Shift-Tab": ({ editor }) => {
				const paragraphs = collectParagraphs(editor.state.doc);
				const current = resolveCurrentParagraph(paragraphs, editor.state.selection.anchor);
				if (!current) return false;
				const paragraph = paragraphs[current.index];
				if (!paragraph || !TABLE_LINE_RE.test(paragraph.text)) return false;

				const previousCol = findPreviousCell(paragraph.text, current.cursorCol);
				if (previousCol >= 0) {
					return moveCursor(editor, paragraph.start + previousCol);
				}

				for (let index = current.index - 1; index >= 0; index -= 1) {
					const previousRow = paragraphs[index];
					if (!previousRow || !TABLE_LINE_RE.test(previousRow.text)) break;
					const starts = findCellStarts(previousRow.text);
					if (starts.length === 0) continue;
					return moveCursor(editor, previousRow.start + starts[starts.length - 1]);
				}

				return false;
			},
		};
	},
});
