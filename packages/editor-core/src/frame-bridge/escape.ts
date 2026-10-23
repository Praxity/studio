/** M2: the controller returns consumption; the DOM adapter owns no layer decisions. */
export function createEscapeDispatcher(send: (command: { type: "escape" }) => boolean) {
	const documents = new Set<Document>();
	const removers = new Map<Document, () => void>();
	const dispatch = (event: Event) => {
		if (send({ type: "escape" })) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};
	const key = (event: KeyboardEvent) => {
		if (event.isComposing || event.keyCode === 229) return;
		if (event.key === "Escape" || event.key === "Esc") dispatch(event);
	};
	const cancel = (event: Event) => {
		// Native cancel does not bubble. Capture covers dialogs mounted later too.
		if ((event.target as Element | null)?.localName === "dialog") dispatch(event);
	};
	return {
		attach(doc: Document) {
			if (documents.has(doc)) return;
			// Window capture precedes the shell's document-capture listeners. Child-frame
			// keys never reach the parent, so each document attaches its own dispatcher.
			// Attaching the top document also covers Escape when focus is on the frame
			// element itself.
			const removeKey = listenEditorInput(doc, "keydown", key, true, true);
			const removeCancel = listenEditorInput(doc, "cancel", cancel, true);
			documents.add(doc);
			const remove = () => {
				removeKey();
				removeCancel();
				documents.delete(doc);
				removers.delete(doc);
			};
			removers.set(doc, remove);
			return remove;
		},
		dispose() {
			for (const remove of removers.values()) remove();
		},
	};
}

import { listenEditorInput } from "./listeners";
