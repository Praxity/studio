import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface TableAlignState {
	decorations: DecorationSet;
}

export interface TableLineEntry {
	text: string;
	lineStart: number;
}

interface CellLayout {
	contentLength: number;
	insertOffset: number;
}

export interface TablePaddingSpec {
	pos: number;
	widthCh: number;
}

const tableAlignPluginKey = new PluginKey<TableAlignState>("table-align");
const TABLE_LINE_RE = /^\s*\|/;

function parseCells(line: string): string[] {
	return line
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

export function computeColumnWidths(tableLines: string[]): number[] {
	const widths: number[] = [];
	for (const line of tableLines) {
		const cells = parseCells(line);

		for (let index = 0; index < cells.length; index += 1) {
			widths[index] = Math.max(widths[index] ?? 0, cells[index]?.length ?? 0);
		}
	}
	return widths;
}

function parseCellLayouts(line: string): CellLayout[] {
	const firstPipe = line.indexOf("|");
	if (firstPipe === -1) return [];

	const layouts: CellLayout[] = [];
	let pipeIndex = firstPipe;

	while (pipeIndex < line.length) {
		if (line[pipeIndex] !== "|") break;
		const nextPipe = line.indexOf("|", pipeIndex + 1);
		if (nextPipe === -1) break;

		const rawCell = line.slice(pipeIndex + 1, nextPipe);
		const trailingSpaces = rawCell.length - rawCell.trimEnd().length;
		const contentEndOffset = rawCell.length - trailingSpaces;
		const contentLength = rawCell.trim().length;

		layouts.push({
			contentLength,
			insertOffset: pipeIndex + 1 + contentEndOffset,
		});

		pipeIndex = nextPipe;
	}

	return layouts;
}

export function computeTablePaddingSpecs(lines: TableLineEntry[]): TablePaddingSpec[] {
	const specs: TablePaddingSpec[] = [];
	let currentTable: TableLineEntry[] = [];

	const flushCurrentTable = () => {
		if (currentTable.length === 0) return;

		const columnWidths = computeColumnWidths(currentTable.map((entry) => entry.text.trim()));
		for (const row of currentTable) {
			const cells = parseCellLayouts(row.text);
			for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
				const cell = cells[columnIndex];
				if (!cell) continue;

				const maxWidth = columnWidths[columnIndex] ?? cell.contentLength;
				const paddingWidth = maxWidth - cell.contentLength;
				if (paddingWidth <= 0) continue;

				specs.push({
					pos: row.lineStart + cell.insertOffset,
					widthCh: paddingWidth,
				});
			}
		}

		currentTable = [];
	};

	for (const line of lines) {
		if (TABLE_LINE_RE.test(line.text)) {
			currentTable.push(line);
			continue;
		}
		flushCurrentTable();
	}
	flushCurrentTable();

	return specs;
}

function buildTableAlignDecorations(doc: PMNode): DecorationSet {
	const lines: TableLineEntry[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;
		lines.push({
			text: node.textContent ?? "",
			lineStart: pos + 1,
		});
		return true;
	});

	const paddingSpecs = computeTablePaddingSpecs(lines);
	if (paddingSpecs.length === 0) {
		return DecorationSet.empty;
	}

	const decorations = paddingSpecs.map((spec, index) =>
		Decoration.widget(
			spec.pos,
			() => {
				const spacer = document.createElement("span");
				spacer.setAttribute("aria-hidden", "true");
				spacer.style.display = "inline-block";
				spacer.style.width = `${spec.widthCh}ch`;
				spacer.style.height = "0";
				spacer.style.pointerEvents = "none";
				spacer.style.userSelect = "none";
				return spacer;
			},
			{ side: -1, key: `table-align-${spec.pos}-${spec.widthCh}-${index}` },
		),
	);

	return DecorationSet.create(doc, decorations);
}

export const TableAlignExtension = Extension.create({
	name: "tableAlign",

	addProseMirrorPlugins() {
		return [
			new Plugin<TableAlignState>({
				key: tableAlignPluginKey,
				state: {
					init: (_, state) => ({
						decorations: buildTableAlignDecorations(state.doc),
					}),
					apply: (transaction, pluginState, _oldState, newState) => {
						if (!transaction.docChanged) {
							return pluginState;
						}

						return {
							decorations: buildTableAlignDecorations(newState.doc),
						};
					},
				},
				props: {
					decorations: (state) =>
						tableAlignPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
				},
			}),
		];
	},
});
