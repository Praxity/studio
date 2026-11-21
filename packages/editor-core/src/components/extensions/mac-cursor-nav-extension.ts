import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

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
