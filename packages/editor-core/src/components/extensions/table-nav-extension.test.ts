import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, expect, it } from "vitest";
import { TableNavExtension } from "./table-nav-extension";

let editor: Editor;
afterEach(() => editor?.destroy());

it("moves through table cells and rows with Tab and Shift-Tab without editing grammar", () => {
	const rows = ["| Name | Age |", "| Alice | 34 |"];
	editor = new Editor({
		element: document.createElement("div"),
		extensions: [StarterKit, TableNavExtension],
		content: {
			type: "doc",
			content: rows.map((row) => ({ type: "paragraph", content: [{ type: "text", text: row }] })),
		},
	});
	const original = editor.getText({ blockSeparator: "\n" });
	editor.commands.setTextSelection(3);

	const press = (shiftKey = false) => {
		const event = new KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey,
			bubbles: true,
			cancelable: true,
		});
		editor.view.dom.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		return editor.state.doc.resolve(editor.state.selection.from);
	};

	expect(press().parentOffset).toBe(9);
	expect(press().parent.textContent).toBe(rows[1]);
	expect(press().parentOffset).toBe(10);
	expect(press(true).parentOffset).toBe(2);
	expect(press(true).parent.textContent).toBe(rows[0]);
	expect(editor.getText({ blockSeparator: "\n" })).toBe(original);
});
