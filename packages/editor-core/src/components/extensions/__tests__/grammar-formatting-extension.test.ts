import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { GrammarFormattingExtension } from "../grammar-formatting-extension";

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
			GrammarFormattingExtension,
		],
		content: `<p>${content}</p>`,
	});
	activeEditor = editor;
	return editor;
}

function getText(editor: Editor): string {
	return editor.getText({ blockSeparator: "\n" });
}

describe("GrammarFormattingExtension", () => {
	describe("wrapWithMarker", () => {
		it("wraps selected text with ** for bold", () => {
			const editor = createEditor("hello world");
			// Select "world" (positions are 1-based in ProseMirror, +1 for paragraph node)
			editor.commands.setTextSelection({ from: 7, to: 12 });
			editor.commands.wrapWithMarker("**");
			expect(getText(editor)).toBe("hello **world**");
		});

		it("wraps selected text with * for italic", () => {
			const editor = createEditor("hello world");
			editor.commands.setTextSelection({ from: 7, to: 12 });
			editor.commands.wrapWithMarker("*");
			expect(getText(editor)).toBe("hello *world*");
		});

		it("wraps selected text with ~~ for strikethrough", () => {
			const editor = createEditor("hello world");
			editor.commands.setTextSelection({ from: 7, to: 12 });
			editor.commands.wrapWithMarker("~~");
			expect(getText(editor)).toBe("hello ~~world~~");
		});

		it("inserts marker pair and places cursor between when no selection", () => {
			const editor = createEditor("hello");
			// Place cursor at end (after "hello", position 6)
			editor.commands.setTextSelection(6);
			editor.commands.wrapWithMarker("**");
			expect(getText(editor)).toBe("hello****");
			// Cursor should be between the markers
			expect(editor.state.selection.from).toBe(8);
		});

		it("unwraps if selection is already wrapped with marker", () => {
			const editor = createEditor("hello **world**");
			// Select "**world**" (from position 7 to 16)
			editor.commands.setTextSelection({ from: 7, to: 16 });
			editor.commands.wrapWithMarker("**");
			expect(getText(editor)).toBe("hello world");
		});
	});
});
