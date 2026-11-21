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
		if ((event.target as Element | null)?.localName === "dialog") dispatch(event);
	};
	return {
		attach(doc: Document) {
			if (documents.has(doc)) return;
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
