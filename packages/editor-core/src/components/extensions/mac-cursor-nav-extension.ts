import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * On macOS, Cmd+Up/Down should move the cursor to the start/end of the document.
 * Without this extension, the native scroll-to-top/bottom behavior fires instead
 * because no ProseMirror keymap handler claims the shortcut.
 */
export const MacCursorNavExtension = Extension.create({
	name: "macCursorNav",

	addKeyboardShortcuts() {
		const moveToEnd = () => {
			const { state, view } = this.editor;
			view.dispatch(state.tr.setSelection(TextSelection.atEnd(state.doc)).scrollIntoView());
			return true;
		};
		return {
			"Ctrl-End": moveToEnd,
			"Meta-End": moveToEnd,
			"Mod-ArrowUp": ({ editor }) => {
				return editor.chain().setTextSelection(1).scrollIntoView().run();
			},
			"Mod-ArrowDown": moveToEnd,
		};
	},
});
