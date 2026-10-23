import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { AutoSurroundExtension } from "../auto-surround-extension";

let activeEditor: Editor | null = null;
afterEach(() => {
	activeEditor?.destroy();
	activeEditor = null;
});

function createEditor(content: string): Editor {
	const editor = new Editor({
		extensions: [
			StarterKit.configure({
				bold: false,
				italic: false,
				strike: false,
				code: false,
				blockquote: false,
				bulletList: false,
				orderedList: false,
				listItem: false,
				heading: false,
				horizontalRule: false,
				codeBlock: false,
				hardBreak: false,
			}),
			AutoSurroundExtension,
		],
		content: `<p>${content}</p>`,
	});
	activeEditor = editor;
	return editor;
}

function getText(editor: Editor): string {
	return editor.getText({ blockSeparator: "\n" });
}

describe("AutoSurroundExtension", () => {
	it.each([
		["*", "*", "*"],
		["_", "_", "_"],
		["(", "(", ")"],
		["[", "[", "]"],
		["{", "{", "}"],
		['"', '"', '"'],
		["'", "'", "'"],
		["`", "`", "`"],
	])("wraps selection when %s is typed", (typed, open, close) => {
		const editor = createEditor("hello world");
		editor.commands.setTextSelection({ from: 7, to: 12 });
		editor.commands.surroundSelection(typed);
		expect(getText(editor)).toBe(`hello ${open}world${close}`);
	});

	it("returns false (no-op) without selection", () => {
		const editor = createEditor("hello");
		editor.commands.setTextSelection(6);
		const result = editor.commands.surroundSelection("*");
		expect(result).toBe(false);
		expect(getText(editor)).toBe("hello");
	});
});
