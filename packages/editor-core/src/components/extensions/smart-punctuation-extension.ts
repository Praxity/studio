import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

const smartPunctuationPluginKey = new PluginKey("smart-punctuation");

const SYSTEM_PARAM_KEYS = new Set([
	"as",
	"color",
	"style",
	"variant",
	"size",
	"treatment",
	"name",
	"mode",
	"source",
	"type",
	"chart",
	"orientation",
	"header",
	"order",
	"layout",
	"entrance",
	"transition",
	"close",
	"reveal",
	"visible",
	"when",
	"then",
	"var",
]);

const PARAM_KEY_RE = /^\s*([a-zA-Z][\w-]*):/;

interface PunctuationChange {
	from: number;
	to: number;
	text: string;
}

function smartPunctuationChanges(text: string): PunctuationChange[] {
	if (/^-{2,}$/.test(text.trim())) return [];
	const changes: PunctuationChange[] = [];
	const apostrophes = new Set(
		[...text.matchAll(/([\p{L}\p{N}])'/gu)].map((match) => match.index + match[0].length - 1),
	);
	let openSingle = true;
	let openDouble = true;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "‘") openSingle = false;
		if (char === "’") openSingle = true;
		if (char === "“") openDouble = false;
		if (char === "”") openDouble = true;
		if (char === "'") {
			const apostrophe = apostrophes.has(index);
			changes.push({ from: index, to: index + 1, text: apostrophe || !openSingle ? "’" : "‘" });
			openSingle = apostrophe || !openSingle;
		} else if (char === '"') {
			changes.push({ from: index, to: index + 1, text: openDouble ? "“" : "”" });
			openDouble = !openDouble;
		}
	}
	for (const match of text.matchAll(/\.\.\./g)) {
		changes.push({ from: match.index, to: match.index + 3, text: "…" });
	}
	for (const match of text.matchAll(/(?<!-)--(?!-)/g)) {
		changes.push({ from: match.index, to: match.index + 2, text: "—" });
	}
	return changes.sort((a, b) => a.from - b.from);
}

export function isSystemParamKey(key: string): boolean {
	return SYSTEM_PARAM_KEYS.has(key.trim().toLowerCase());
}

export function applySmartPunctuation(text: string): string {
	let result = "";
	let offset = 0;
	for (const change of smartPunctuationChanges(text)) {
		result += text.slice(offset, change.from) + change.text;
		offset = change.to;
	}
	return result + text.slice(offset);
}

function isInsideDelimitedBlock(lines: string[], currentLine: number, marker: RegExp): boolean {
	let open = false;
	for (let index = 0; index <= currentLine && index < lines.length; index++) {
		const trimmed = lines[index]?.trim() ?? "";
		if (!marker.test(trimmed)) continue;
		open = !open;
	}
	return open;
}

function shouldApplySmartPunctuation(
	docText: string,
	currentLineText: string,
	currentLine: number,
): boolean {
	const trimmed = currentLineText.trim();
	if (trimmed.startsWith("```") || trimmed.startsWith("$$")) return false;
	const lines = docText.split("\n");
	if (isInsideDelimitedBlock(lines, currentLine, /^```/)) return false;
	if (isInsideDelimitedBlock(lines, currentLine, /^\$\$$/)) return false;

	const paramMatch = PARAM_KEY_RE.exec(currentLineText);
	if (paramMatch && isSystemParamKey(paramMatch[1] ?? "")) {
		return false;
	}

	if (/^\s*https?:\/\//i.test(trimmed) || /^\s*\/\S+/.test(trimmed)) {
		return false;
	}

	return true;
}

export function createSmartPunctuationExtension(enabled: boolean) {
	return Extension.create({
		name: "smartPunctuation",
		addProseMirrorPlugins() {
			if (!enabled) return [];
			return [
				new Plugin({
					key: smartPunctuationPluginKey,
					props: {
						handleTextInput(view, from, to, text) {
							const { state } = view;
							const $from = state.doc.resolve(from);
							const $to = state.doc.resolve(to);
							// A selection across paragraphs belongs to the normal text-input path.
							if (!$from.sameParent($to)) return false;
							const lineStart = $from.start();
							const lineText = $from.parent.textContent;
							const lineIndex = $from.index(0);
							const prefix = lineText.slice(0, $from.parentOffset) + text;
							const nextLineText = prefix + lineText.slice($to.parentOffset);
							const fullText = state.doc.textBetween(0, state.doc.content.size, "\n", "\n");

							if (!shouldApplySmartPunctuation(fullText, nextLineText, lineIndex)) {
								return false;
							}

							// Only a match completed by this input may change. Loaded punctuation
							// supplies quote context, but stays byte-for-byte intact.
							const changes = smartPunctuationChanges(nextLineText).filter(
								(change) =>
									change.from < prefix.length &&
									change.to > $from.parentOffset &&
									change.to <= prefix.length,
							);
							if (!changes.length) return false;
							const tr = state.tr.insertText(text, from, to);
							let caret = lineStart + prefix.length;
							// Apply from the end so each remaining change keeps its original offsets.
							for (const change of changes.reverse()) {
								tr.insertText(change.text, lineStart + change.from, lineStart + change.to);
								caret += change.text.length - (change.to - change.from);
							}
							tr.setSelection(TextSelection.create(tr.doc, caret));
							view.dispatch(tr);
							return true;
						},
					},
				}),
			];
		},
	});
}
