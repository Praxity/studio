import type { CanvasMessages } from "../../shared/canvas-messages";
import { canvasStyles } from "../../shared/canvas-styles";
import { startStudioAuthor as startAuthor } from "./canvas";
import { createCanvasTextSession, mountCanvasTextFields } from "./canvas-text";
import { MAX_BUFFERED_EVENT_CHARACTERS, openBrowserEventStream } from "./event-stream";

/** Compose the packaged bootstrap without serializing function bodies. */
export function startStudioAuthor(editorOrigin: string, readUrl: string, messages: CanvasMessages) {
	startAuthor(
		editorOrigin,
		readUrl,
		messages,
		mountCanvasTextFields,
		createCanvasTextSession,
		canvasStyles,
		openBrowserEventStream,
		MAX_BUFFERED_EVENT_CHARACTERS,
	);
}
