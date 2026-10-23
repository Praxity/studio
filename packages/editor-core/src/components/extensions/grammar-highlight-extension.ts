import type { KeywordCategory } from "@praxity/grammar";
import { getManifest } from "@praxity/grammar";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface GrammarHighlightStrings {
	collapseFrontmatter: string;
	expandFrontmatter: string;
}

interface GrammarHighlightState {
	decorations: DecorationSet;
	frontmatterFolded: boolean;
	frontmatterRange: { from: number; to: number } | null;
}

const grammarHighlightPluginKey = new PluginKey<GrammarHighlightState>("grammar-highlight");

type GrammarHighlightMeta = { type: "toggle-frontmatter-fold" };

// --- Patterns ---
const FRONTMATTER_FENCE_RE = /^\s*---\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const ASSESS_OPTION_RE = /^(\([x ]\)|\[[x ]\])\s+/i;

/**
 * Resolve a block keyword to its manifest category.
 * Returns null for unknown keywords (typos, future blocks not yet in manifest).
 */
export function resolveKeywordCategory(keyword: string): KeywordCategory | null {
	if (!keyword) return null;
	return getManifest().get(keyword)?.category ?? null;
}

function buildHighlightDecorations(
	doc: PMNode,
	frontmatterFolded: boolean,
	strings: GrammarHighlightStrings,
): Pick<GrammarHighlightState, "decorations" | "frontmatterRange"> {
	const decorations: Decoration[] = [];
	let inFrontmatter = false;
	let frontmatterEligible = true;
	let frontmatterOpenerPos: number | null = null;
	let frontmatterOpenerNodeEnd: number | null = null;
	let frontmatterCloserPos: number | null = null;
	let frontmatterCloserNodeEnd: number | null = null;
	let frontmatterLineCount = 0;

	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;

		const text = node.textContent ?? "";
		const trimmed = text.trim();
		const lineStart = pos + 1;
		const nodeEnd = pos + node.nodeSize;

		// --- Frontmatter ---
		if (frontmatterEligible) {
			if (!inFrontmatter && trimmed === "---") {
				inFrontmatter = true;
				frontmatterOpenerPos = pos;
				frontmatterOpenerNodeEnd = nodeEnd;
				decorations.push(
					Decoration.node(pos, nodeEnd, {
						class: "praxity-raw-frontmatter-line",
						"data-token-type": "frontmatter-fence",
					}),
				);
				return true;
			}

			if (inFrontmatter) {
				if (FRONTMATTER_FENCE_RE.test(trimmed)) {
					inFrontmatter = false;
					frontmatterEligible = false;
					frontmatterCloserPos = pos;
					frontmatterCloserNodeEnd = nodeEnd;
					decorations.push(
						Decoration.node(pos, nodeEnd, {
							class: "praxity-raw-frontmatter-line",
							"data-token-type": "frontmatter-fence",
						}),
					);
				} else {
					frontmatterLineCount++;
					decorations.push(
						Decoration.node(pos, nodeEnd, {
							class: "praxity-raw-frontmatter-line",
							"data-token-type": "frontmatter-line",
						}),
					);
				}
				return true;
			}

			if (trimmed.length > 0) {
				frontmatterEligible = false;
			}
		}

		// --- Section break (standalone --- after frontmatter) ---
		if (FRONTMATTER_FENCE_RE.test(trimmed)) {
			decorations.push(Decoration.node(pos, nodeEnd, { "data-token-type": "section-break" }));
			decorations.push(
				Decoration.inline(lineStart, lineStart + text.length, {
					class: "praxity-raw-structural-marker",
				}),
			);
			return true;
		}

		// --- Heading ---
		const headingMatch = HEADING_RE.exec(text);
		if (headingMatch) {
			const markerLen = headingMatch[1]?.length ?? 0;
			decorations.push(Decoration.node(pos, nodeEnd, { "data-token-type": "heading" }));
			decorations.push(
				Decoration.inline(lineStart, lineStart + markerLen, {
					class: "praxity-raw-heading-marker",
				}),
			);
			return true;
		}

		// --- Assessment option ---
		const optionMatch = ASSESS_OPTION_RE.exec(text);
		if (optionMatch) {
			decorations.push(Decoration.node(pos, nodeEnd, { "data-token-type": "assess-option" }));
			decorations.push(
				Decoration.inline(lineStart, lineStart + (optionMatch[1]?.length ?? 0), {
					class: "praxity-raw-assess-marker praxity-raw-assess-option",
				}),
			);
			return true;
		}

		// All other lines: plain text, no decorations
		return true;
	});

	// --- Frontmatter fold decorations ---
	if (
		frontmatterOpenerPos != null &&
		frontmatterOpenerNodeEnd != null &&
		frontmatterCloserPos != null &&
		frontmatterCloserNodeEnd != null
	) {
		const isFolded = frontmatterFolded;
		const openerLineStart = frontmatterOpenerPos + 1;

		decorations.push(
			Decoration.widget(
				openerLineStart,
				(view) => {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "praxity-raw-fold-caret";
					button.setAttribute("aria-expanded", String(!isFolded));
					button.setAttribute(
						"aria-label",
						isFolded ? strings.expandFrontmatter : strings.collapseFrontmatter,
					);
					button.textContent = "\u25b8";
					button.dataset.frontmatterFold = "true";
					// Same wiring as the fold caret in delimiter-matching-plugin: the
					// widget key carries the folded state so the button is redrawn rather
					// than reused (which had frozen `aria-expanded` at its draw-time
					// value), mousedown only cancels the selection change, and Enter/Space
					// are handled here because ProseMirror's keymap would take them first.
					const toggle = () => {
						const hadFocus = document.activeElement === button;
						view.dispatch(
							view.state.tr.setMeta(grammarHighlightPluginKey, {
								type: "toggle-frontmatter-fold",
							} satisfies GrammarHighlightMeta),
						);
						if (!hadFocus) return;
						view.dom
							.querySelector<HTMLElement>(".praxity-raw-fold-caret[data-frontmatter-fold]")
							?.focus();
					};
					button.addEventListener("mousedown", (event) => {
						event.preventDefault();
					});
					button.addEventListener("click", toggle);
					button.addEventListener("keydown", (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						event.stopPropagation();
						toggle();
					});
					return button;
				},
				// Keyed widgets are compared by key alone, so the folded state has to be
				// in the key or the button is reused and keeps its draw-time ARIA.
				{ side: -1, key: `frontmatter-fold-${isFolded}` },
			),
		);

		if (isFolded) {
			const openerPos = frontmatterOpenerPos;
			const closerPos = frontmatterCloserPos;
			doc.descendants((node, p) => {
				if (node.type.name !== "paragraph") return true;
				if (p === openerPos) return true;
				if (p > openerPos && p <= closerPos) {
					decorations.push(
						Decoration.node(p, p + node.nodeSize, {
							class: "praxity-raw-delimiter-fold-hidden",
						}),
					);
				}
				return true;
			});

			const openerTo = frontmatterOpenerNodeEnd - 1;
			decorations.push(
				Decoration.widget(
					openerTo,
					() => {
						const summary = document.createElement("span");
						summary.className = "praxity-raw-fold-summary";
						summary.textContent = `frontmatter (${frontmatterLineCount} lines)`;
						return summary;
					},
					{ side: 1, key: "frontmatter-fold-summary" },
				),
			);
		}
	}

	return {
		decorations: DecorationSet.create(doc, decorations),
		frontmatterRange:
			frontmatterOpenerPos != null && frontmatterCloserNodeEnd != null
				? { from: frontmatterOpenerPos + 1, to: frontmatterCloserNodeEnd - 1 }
				: null,
	};
}

export function createGrammarHighlightExtension(strings: GrammarHighlightStrings) {
	return Extension.create({
		name: "grammarHighlightExtension",
		priority: 110,
		addKeyboardShortcuts() {
			return {
				"Mod-a": ({ editor }) => {
					const { state, view } = editor;
					const highlighted = grammarHighlightPluginKey.getState(state);
					const range = highlighted?.frontmatterRange;
					if (!range) return false;

					// Use the selection origin, including when a drag crosses the boundary.
					const inside = state.selection.anchor >= range.from && state.selection.anchor <= range.to;
					const from = inside ? range.from : range.to + 2;
					const to = inside ? range.to : state.doc.content.size - 1;
					if (from > to) return false;
					const tr = state.tr.setSelection(TextSelection.create(state.doc, from, to));
					if (inside && highlighted?.frontmatterFolded) {
						tr.setMeta(grammarHighlightPluginKey, {
							type: "toggle-frontmatter-fold",
						} satisfies GrammarHighlightMeta);
					}
					view.dispatch(tr);
					return true;
				},
			};
		},
		addProseMirrorPlugins() {
			return [
				new Plugin<GrammarHighlightState>({
					key: grammarHighlightPluginKey,
					state: {
						init: (_, state) => ({
							...buildHighlightDecorations(state.doc, true, strings),
							frontmatterFolded: true,
						}),
						apply: (transaction, pluginState, _oldState, newState) => {
							const meta = transaction.getMeta(grammarHighlightPluginKey) as
								| GrammarHighlightMeta
								| undefined;

							let frontmatterFolded = pluginState.frontmatterFolded;
							if (meta?.type === "toggle-frontmatter-fold") {
								frontmatterFolded = !frontmatterFolded;
							}

							if (!transaction.docChanged && !meta) {
								return pluginState;
							}

							return {
								...buildHighlightDecorations(newState.doc, frontmatterFolded, strings),
								frontmatterFolded,
							};
						},
					},
					props: {
						decorations: (state) =>
							grammarHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
						handleClick(view, _pos, event) {
							if (event.target instanceof HTMLElement) {
								if (event.target.closest(".praxity-raw-fold-caret")) return false;

								const clickedParagraph = event.target.closest(
									'p[data-token-type="frontmatter-fence"]',
								);
								if (!clickedParagraph) return false;

								const pluginState = grammarHighlightPluginKey.getState(view.state);
								if (!pluginState?.frontmatterFolded) return false;

								view.dispatch(
									view.state.tr.setMeta(grammarHighlightPluginKey, {
										type: "toggle-frontmatter-fold",
									} satisfies GrammarHighlightMeta),
								);
							}

							return false;
						},
					},
				}),
			];
		},
	});
}
