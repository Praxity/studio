import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const SURROUND_PAIRS: Record<string, string> = {
	"*": "*",
	_: "_",
	"(": ")",
	"[": "]",
	"{": "}",
	'"': '"',
	"'": "'",
	"`": "`",
};

const autoSurroundPluginKey = new PluginKey("auto-surround");

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		autoSurround: {
			surroundSelection: (openChar: string) => ReturnType;
		};
	}
}

export const AutoSurroundExtension = Extension.create({
	name: "autoSurround",

	addCommands() {
		return {
			surroundSelection:
				(openChar: string) =>
				({ state, dispatch }) => {
					const closing = SURROUND_PAIRS[openChar];
					if (!closing) return false;
					if (state.selection.empty) return false;
					if (!dispatch) return true;

					const { from, to } = state.selection;
					const tr = state.tr;
					// Insert closing first (at `to`), then opening (at `from`).
					// This order avoids position shift for the second insert.
					// Uses insertText instead of replaceWith/schema.text to
					// safely handle selections spanning paragraph boundaries.
					tr.insertText(closing, to);
					tr.insertText(openChar, from);
					dispatch(tr);
					return true;
				},
		};
	},

	addProseMirrorPlugins() {
		const extension = this;
		return [
			new Plugin({
				key: autoSurroundPluginKey,
				props: {
					handleTextInput(view, _from, _to, text) {
						const closing = SURROUND_PAIRS[text];
						if (!closing) return false;
						if (view.state.selection.empty) return false;

						// Delegate to the command for testability
						return extension.editor.commands.surroundSelection(text);
					},
				},
			}),
		];
	},
});
