import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		searchHighlight: {
			setSearchQuery: (query: string) => ReturnType;
			setSearchIndex: (index: number) => ReturnType;
			clearSearch: () => ReturnType;
		};
	}
}

interface SearchPluginState {
	query: string;
	currentIndex: number;
	matchCount: number;
	decorations: DecorationSet;
}

const searchPluginKey = new PluginKey<SearchPluginState>("search-highlight");

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDecorations(
	doc: EditorState["doc"],
	query: string,
	currentIndex: number,
): { decorations: DecorationSet; matchCount: number } {
	if (!query.trim()) {
		return { decorations: DecorationSet.empty, matchCount: 0 };
	}

	const decorations: Decoration[] = [];
	const pattern = new RegExp(escapeRegExp(query), "gi");
	let matchIndex = 0;

	doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(node.text)) !== null) {
			const from = pos + match.index;
			const to = from + match[0].length;
			const isCurrent = matchIndex === currentIndex;
			decorations.push(
				Decoration.inline(from, to, {
					class: isCurrent ? "search-match search-match--current" : "search-match",
				}),
			);
			matchIndex++;
		}
	});

	return {
		decorations: DecorationSet.create(doc, decorations),
		matchCount: matchIndex,
	};
}

export function getSearchState(state: EditorState): SearchPluginState | undefined {
	return searchPluginKey.getState(state);
}

interface SearchHighlightOptions {
	onMatchCountChange?: (count: number) => void;
}

export function createSearchHighlightExtension(options: SearchHighlightOptions = {}) {
	return Extension.create({
		name: "searchHighlight",

		addCommands() {
			return {
				setSearchQuery:
					(query: string) =>
					({ tr, dispatch }) => {
						if (dispatch) {
							tr.setMeta(searchPluginKey, { type: "setQuery", query });
							dispatch(tr);
						}
						return true;
					},
				setSearchIndex:
					(index: number) =>
					({ tr, dispatch, view }) => {
						if (dispatch) {
							tr.setMeta(searchPluginKey, { type: "setIndex", index });
							dispatch(tr);
						}
						// After decorations render, scroll the current-match element into view.
						// Uses rAF so the decoration DOM is applied before querying.
						if (view) {
							requestAnimationFrame(() => {
								const currentEl = view.dom.querySelector(".search-match--current");
								currentEl?.scrollIntoView({ block: "center", behavior: "smooth" });
							});
						}
						return true;
					},
				clearSearch:
					() =>
					({ tr, dispatch }) => {
						if (dispatch) {
							tr.setMeta(searchPluginKey, { type: "clear" });
							dispatch(tr);
						}
						return true;
					},
			};
		},

		addProseMirrorPlugins() {
			const { onMatchCountChange } = options;

			return [
				new Plugin({
					key: searchPluginKey,
					state: {
						init(): SearchPluginState {
							return {
								query: "",
								currentIndex: 0,
								matchCount: 0,
								decorations: DecorationSet.empty,
							};
						},
						apply(tr, prev, _oldState, newState): SearchPluginState {
							const meta = tr.getMeta(searchPluginKey) as
								| { type: "setQuery"; query: string }
								| { type: "setIndex"; index: number }
								| { type: "clear" }
								| undefined;

							if (meta?.type === "clear") {
								onMatchCountChange?.(0);
								return {
									query: "",
									currentIndex: 0,
									matchCount: 0,
									decorations: DecorationSet.empty,
								};
							}

							if (meta?.type === "setQuery") {
								const { decorations, matchCount } = buildDecorations(newState.doc, meta.query, 0);
								onMatchCountChange?.(matchCount);
								return {
									query: meta.query,
									currentIndex: 0,
									matchCount,
									decorations,
								};
							}

							if (meta?.type === "setIndex") {
								const { decorations, matchCount } = buildDecorations(
									newState.doc,
									prev.query,
									meta.index,
								);
								return {
									...prev,
									currentIndex: meta.index,
									matchCount,
									decorations,
								};
							}

							// Document changed while search active — recompute
							if (tr.docChanged && prev.query) {
								// Two-pass: first get new count, then rebuild with clamped index
								const preliminary = buildDecorations(newState.doc, prev.query, 0);
								const clampedIndex = Math.min(
									prev.currentIndex,
									Math.max(0, preliminary.matchCount - 1),
								);
								const { decorations, matchCount } =
									clampedIndex !== 0
										? buildDecorations(newState.doc, prev.query, clampedIndex)
										: preliminary;
								onMatchCountChange?.(matchCount);
								return {
									...prev,
									currentIndex: clampedIndex,
									matchCount,
									decorations,
								};
							}

							return prev;
						},
					},
					props: {
						decorations(state) {
							return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
						},
					},
				}),
			];
		},
	});
}
