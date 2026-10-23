import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSearchHighlightExtension, getSearchState } from "../search-highlight-extension";

let activeEditor: Editor | null = null;
afterEach(() => {
	activeEditor?.destroy();
	activeEditor = null;
});

function createEditor(content: string, onMatchCountChange = vi.fn()): Editor {
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
			createSearchHighlightExtension({ onMatchCountChange }),
		],
		content: `<p>${content}</p>`,
	});
	activeEditor = editor;
	return editor;
}

describe("SearchHighlightExtension", () => {
	it("finds all matches and reports count", () => {
		const onMatchCountChange = vi.fn();
		const editor = createEditor("foo bar foo baz foo", onMatchCountChange);
		editor.commands.setSearchQuery("foo");
		expect(onMatchCountChange).toHaveBeenCalledWith(3);
		expect(getSearchState(editor.state)?.matchCount).toBe(3);
	});

	it("reports 0 for no matches", () => {
		const onMatchCountChange = vi.fn();
		const editor = createEditor("hello world", onMatchCountChange);
		editor.commands.setSearchQuery("xyz");
		expect(onMatchCountChange).toHaveBeenCalledWith(0);
	});

	it("clears matches on empty query", () => {
		const onMatchCountChange = vi.fn();
		const editor = createEditor("foo bar foo", onMatchCountChange);
		editor.commands.setSearchQuery("foo");
		editor.commands.setSearchQuery("");
		expect(onMatchCountChange).toHaveBeenLastCalledWith(0);
	});

	it("clears via clearSearch command", () => {
		const onMatchCountChange = vi.fn();
		const editor = createEditor("foo bar foo", onMatchCountChange);
		editor.commands.setSearchQuery("foo");
		editor.commands.clearSearch();
		expect(onMatchCountChange).toHaveBeenLastCalledWith(0);
	});
});
