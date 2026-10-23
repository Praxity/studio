import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		grammarFormatting: {
			wrapWithMarker: (marker: string) => ReturnType;
		};
	}
}

export const GrammarFormattingExtension = Extension.create({
	name: "grammarFormatting",

	addCommands() {
		return {
			wrapWithMarker:
				(marker: string) =>
				({ state, dispatch }) => {
					if (!dispatch) return true;

					const { from, to, empty } = state.selection;
					const tr = state.tr;

					if (empty) {
						// No selection: insert marker pair and place cursor between
						tr.insertText(`${marker}${marker}`, from);
						tr.setSelection(TextSelection.create(tr.doc, from + marker.length));
						dispatch(tr);
						return true;
					}

					const selectedText = state.doc.textBetween(from, to, "");

					// Check if already wrapped — unwrap
					if (
						selectedText.startsWith(marker) &&
						selectedText.endsWith(marker) &&
						selectedText.length >= marker.length * 2
					) {
						const unwrapped = selectedText.slice(marker.length, -marker.length);
						tr.replaceWith(from, to, state.schema.text(unwrapped));
						dispatch(tr);
						return true;
					}

					// Wrap selection
					tr.insertText(marker, to);
					tr.insertText(marker, from);
					dispatch(tr);
					return true;
				},
		};
	},

	addKeyboardShortcuts() {
		return {
			"Mod-b": () => this.editor.commands.wrapWithMarker("**"),
			"Mod-i": () => this.editor.commands.wrapWithMarker("*"),
			"Mod-Shift-x": () => this.editor.commands.wrapWithMarker("~~"),
		};
	},
});
