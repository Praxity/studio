import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import {
	applySmartPunctuation,
	createSmartPunctuationExtension,
} from "./smart-punctuation-extension";

let editor: Editor;
afterEach(() => editor?.destroy());

it.each([
	["l'", "l’"],
	["qu'", "qu’"],
	["d'un", "d’un"],
	["aujourd'hui", "aujourd’hui"],
	["é'", "é’"],
	["字'", "字’"],
	["١'", "١’"],
	["'quoted'", "‘quoted’"],
])("uses a closing apostrophe after a Unicode letter or number in %s", (source, expected) => {
	expect(applySmartPunctuation(source)).toBe(expected);
});

it("keeps incremental punctuation at the caret before a page delimiter", () => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({ horizontalRule: false }),
			createSmartPunctuationExtension(true),
		],
		content: "<p>Before. l</p><p>--- Next page</p><p>After.</p>",
	});
	editor.commands.setTextSelection(1 + "Before. l".length);
	for (const input of "'audit") {
		const { from, to } = editor.state.selection;
		const handled = editor.view.someProp("handleTextInput", (handler) =>
			handler(editor.view, from, to, input),
		);
		if (!handled) editor.commands.insertContentAt({ from, to }, input);
		expect(editor.state.selection.from).toBe(1 + editor.state.doc.child(0).textContent.length);
	}
	expect(editor.getText({ blockSeparator: "\n" })).toBe("Before. l’audit\n--- Next page\nAfter.");
});

it("replaces a selection without moving the suffix or the caret", () => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({ horizontalRule: false }),
			createSmartPunctuationExtension(true),
		],
		content: "<p>lX suffix</p><p>--- Next page</p>",
	});
	editor.commands.setTextSelection({ from: 2, to: 3 });
	editor.view.someProp("handleTextInput", (handler) => handler(editor.view, 2, 3, "'"));
	expect(editor.getText({ blockSeparator: "\n" })).toBe("l’ suffix\n--- Next page");
	expect(editor.state.selection.from).toBe(3);
});

it.each([
	["d'action", " X", "d'action X"],
	["d'action l", "'", "d'action l’"],
	['An existing "quote" l', "'", 'An existing "quote" l’'],
])("preserves loaded punctuation outside the inserted text in %s", (source, input, expected) => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({ horizontalRule: false }),
			createSmartPunctuationExtension(true),
		],
		content: {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: source }] }],
		},
	});
	const pos = 1 + source.length;
	editor.commands.setTextSelection(pos);
	const handled = editor.view.someProp("handleTextInput", (handler) =>
		handler(editor.view, pos, pos, input),
	);
	if (!handled) editor.commands.insertContentAt(pos, input);
	expect(editor.getText({ blockSeparator: "\n" })).toBe(expected);
	expect(editor.state.selection.from).toBe(1 + expected.length);
});

it.each([
	['"hello"', "“hello”"],
	["'quoted'", "‘quoted’"],
])("formats a newly typed pair of quotes in %s", (input, expected) => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({ horizontalRule: false }),
			createSmartPunctuationExtension(true),
		],
		content: "<p></p>",
	});
	for (const text of input) {
		const { from, to } = editor.state.selection;
		const handled = editor.view.someProp("handleTextInput", (handler) =>
			handler(editor.view, from, to, text),
		);
		if (!handled) editor.commands.insertContentAt({ from, to }, text);
	}
	expect(editor.getText({ blockSeparator: "\n" })).toBe(expected);
});

it.each([
	["Wait..", ".", "Wait…"],
	["word-", "-", "word—"],
])("keeps the suffix and caret after shortening punctuation in %s", (prefix, input, expected) => {
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({ horizontalRule: false }),
			createSmartPunctuationExtension(true),
		],
		content: {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: `${prefix} suffix` }] }],
		},
	});
	const pos = 1 + prefix.length;
	editor.commands.setTextSelection(pos);
	editor.view.someProp("handleTextInput", (handler) => handler(editor.view, pos, pos, input));
	expect(editor.getText({ blockSeparator: "\n" })).toBe(`${expected} suffix`);
	expect(editor.state.selection.from).toBe(1 + expected.length);
});

it.each([
	["Prose “hello", 0, '"', "Prose “hello”"],
	["Prose ‘hello", 0, "'", "Prose ‘hello’"],
	["It", 0, "'s", "It’s"],
	["Wait", 0, "...", "Wait…"],
	["word-", 0, "-word", "word—word"],
	["--", 0, "-", "---"],
	['style: "pill', 0, '"', 'style: "pill"'],
	['https://example.test/"path', 0, '"', 'https://example.test/"path"'],
	['```\nconst label = "hi\n```', 1, '"', '```\nconst label = "hi"\n```'],
])("applies smart punctuation only to prose input in %s", (source, lineIndex, input, expected) => {
	const lines = source.split("\n");
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [
			StarterKit.configure({ horizontalRule: false }),
			createSmartPunctuationExtension(true),
		],
		content: {
			type: "doc",
			content: lines.map((line) => ({
				type: "paragraph",
				content: line ? [{ type: "text", text: line }] : [],
			})),
		},
	});
	const pos =
		lines.slice(0, lineIndex).reduce((total, line) => total + line.length + 2, 1) +
		(lines[lineIndex]?.length ?? 0);
	const handled = editor.view.someProp("handleTextInput", (handler) =>
		handler(editor.view, pos, pos, input),
	);
	if (!handled) editor.commands.insertContentAt(pos, input);
	expect(editor.getText({ blockSeparator: "\n" })).toBe(expected);
});
