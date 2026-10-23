import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const focusModePluginKey = new PluginKey("focus-mode");
const PAGE_BREAK_RE = /^---(?:\s+.+)?$/;

type FocusClass = "focus-active" | "focus-page" | "focus-dim";

export function classifyNode(input: {
	isPageBreak: boolean;
	isCurrentPage: boolean;
	isInCurrentBlock: boolean;
}): FocusClass {
	if (input.isPageBreak || input.isInCurrentBlock) {
		return "focus-active";
	}
	if (input.isCurrentPage) {
		return "focus-page";
	}
	return "focus-dim";
}

export function classifyFocusLines(lines: string[], cursorLine: number): FocusClass[] {
	if (lines.length === 0) return [];
	const boundedCursor = Math.max(0, Math.min(cursorLine, lines.length - 1));
	const pageByLine: number[] = [];
	let page = 0;
	for (let index = 0; index < lines.length; index++) {
		pageByLine.push(page);
		if (PAGE_BREAK_RE.test(lines[index]?.trim() ?? "")) {
			page += 1;
		}
	}

	const currentPage = pageByLine[boundedCursor] ?? 0;
	const currentTrimmed = lines[boundedCursor]?.trim() ?? "";
	let blockStart = boundedCursor;
	let blockEnd = boundedCursor;

	if (currentTrimmed !== "" && !PAGE_BREAK_RE.test(currentTrimmed)) {
		for (let index = boundedCursor - 1; index >= 0; index--) {
			const trimmed = lines[index]?.trim() ?? "";
			if ((pageByLine[index] ?? -1) !== currentPage) break;
			if (trimmed === "" || PAGE_BREAK_RE.test(trimmed)) break;
			blockStart = index;
		}
		for (let index = boundedCursor + 1; index < lines.length; index++) {
			const trimmed = lines[index]?.trim() ?? "";
			if ((pageByLine[index] ?? -1) !== currentPage) break;
			if (trimmed === "" || PAGE_BREAK_RE.test(trimmed)) break;
			blockEnd = index;
		}
	}

	return lines.map((line, index) => {
		const trimmed = line.trim();
		return classifyNode({
			isPageBreak: PAGE_BREAK_RE.test(trimmed),
			isCurrentPage: (pageByLine[index] ?? -1) === currentPage,
			isInCurrentBlock: index >= blockStart && index <= blockEnd,
		});
	});
}

interface ParagraphEntry {
	pos: number;
	nodeEnd: number;
	text: string;
}

function buildFocusDecorations(doc: PMNode, cursorLine: number): DecorationSet {
	const paragraphs: ParagraphEntry[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;
		paragraphs.push({
			pos,
			nodeEnd: pos + node.nodeSize,
			text: node.textContent ?? "",
		});
		return true;
	});

	const classes = classifyFocusLines(
		paragraphs.map((paragraph) => paragraph.text),
		cursorLine,
	);

	const decorations: Decoration[] = [];
	for (let index = 0; index < paragraphs.length; index++) {
		const paragraph = paragraphs[index];
		const className = classes[index];
		if (!paragraph || !className) continue;
		decorations.push(Decoration.node(paragraph.pos, paragraph.nodeEnd, { class: className }));
	}

	return DecorationSet.create(doc, decorations);
}

function resolveCursorLine(doc: PMNode, anchor: number): number {
	let lineIndex = 0;
	let resolved = 0;
	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;
		const start = pos + 1;
		const end = start + node.content.size;
		if (anchor <= end) {
			resolved = lineIndex;
			return false;
		}
		lineIndex += 1;
		resolved = lineIndex;
		return true;
	});
	return resolved;
}

export function createFocusModeExtension(enabled: boolean) {
	return Extension.create({
		name: "focusMode",
		addProseMirrorPlugins() {
			if (!enabled) return [];
			return [
				new Plugin({
					key: focusModePluginKey,
					state: {
						init: (_, state) => {
							const cursorLine = resolveCursorLine(state.doc, state.selection.anchor);
							return buildFocusDecorations(state.doc, cursorLine);
						},
						apply: (_transaction, _pluginState, _oldState, newState) => {
							const cursorLine = resolveCursorLine(newState.doc, newState.selection.anchor);
							return buildFocusDecorations(newState.doc, cursorLine);
						},
					},
					props: {
						decorations: (state) => focusModePluginKey.getState(state) ?? DecorationSet.empty,
					},
				}),
			];
		},
	});
}
