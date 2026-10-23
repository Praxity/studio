"use client";

export type { GrammarCursorLocation } from "../components/grammar-document-store";
// Re-export the single canonical store instance from components/.
// Previously this file duplicated the store definition, creating a separate
// Zustand instance that was never populated — causing empty parsedBlocks
// in the desktop app's PageNavigator.
export {
	CURSOR_LOCATION_CHANGED_EVENT,
	clamp,
	getScrollFraction,
	SCROLL_TO_PREVIEW_BLOCK_EVENT,
	useGrammarDocumentStore,
} from "../components/grammar-document-store";
