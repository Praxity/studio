import { getManifest, readLesson } from "@praxity/grammar";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { announceToScreenReader } from "../toolbar-keyboard-nav";

const UNMATCHED_DEBOUNCE_MS = 500;
export interface DelimiterLine {
	index: number;
	text: string;
	from: number;
	to: number;
	nodePos: number;
	nodeSize: number;
}

export interface DelimiterPair {
	openerLine: number;
	closerLine: number;
	openerFrom: number;
	openerTo: number;
	closerFrom: number;
	closerTo: number;
	keyword: string;
	title?: string;
	level: number;
	explicitClose?: boolean;
}

export interface DelimiterAnalysis {
	lines: DelimiterLine[];
	pairs: DelimiterPair[];
	lineLevels: Map<number, number[]>;
	unmatchedOpeners: number[];
	unmatchedClosers: number[];
	unmatchedPositions: number[];
}

export interface DelimiterMatchingStrings {
	collapseAriaLabel: (keyword: string) => string;
	expandAriaLabel: (keyword: string) => string;
	collapsedAnnouncement: (keyword: string) => string;
	expandedAnnouncement: (keyword: string) => string;
	unmatchedOpenTooltip: string;
	unmatchedCloseTooltip: string;
	unmatchedCount: (count: number) => string;
}

export interface DelimiterMatchingOptions {
	statusElementId: string;
	unmatchedOpenDescriptionId: string;
	unmatchedCloseDescriptionId: string;
	strings: DelimiterMatchingStrings;
}

interface DelimiterPluginState {
	analysis: DelimiterAnalysis;
	decorations: DecorationSet;
	foldedOpeners: Set<number>;
	showUnmatched: boolean;
}

type DelimiterPluginMeta =
	| { type: "toggle-fold"; openerFrom: number; keyword: string }
	| { type: "show-unmatched" };

const delimiterMatchingPluginKey = new PluginKey<DelimiterPluginState>("delimiter-matching");

function resolveCategory(keyword: string): string | null {
	const manifestKeyword =
		keyword === "col"
			? "columns"
			: keyword === "tab"
				? "tabs"
				: keyword === "flashcard"
					? "card"
					: keyword === "cards"
						? "card"
						: keyword === "group"
							? "assessment-group"
							: keyword;
	return getManifest().get(manifestKeyword)?.category ?? null;
}

export function toggleFoldedOpeners(folded: Set<number>, openerFrom: number): Set<number> {
	const next = new Set(folded);
	if (next.has(openerFrom)) {
		next.delete(openerFrom);
	} else {
		next.add(openerFrom);
	}
	return next;
}

function collectDelimiterLines(doc: PMNode): DelimiterLine[] {
	const lines: DelimiterLine[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return;
		lines.push({
			index: lines.length,
			text: node.textContent,
			from: pos + 1,
			to: pos + node.nodeSize - 1,
			nodePos: pos,
			nodeSize: node.nodeSize,
		});
	});
	return lines;
}

export function analyzeDelimiterStructure(lines: DelimiterLine[]): DelimiterAnalysis {
	const source = lines.map((line) => line.text).join("\n");
	const modern = readLesson(source);
	const pairs: DelimiterPair[] = [];
	const unmatchedOpeners: number[] = [];
	const unmatchedClosers: number[] = [];
	const lineAt = (offset: number) =>
		modern.tree.stream.lines.findIndex((line) => line.start <= offset && offset < line.end);
	for (const record of modern.nodes.values()) {
		const node = record.node;
		if (record.role || node.kind !== "block" || !node.header) continue;
		const opener = lines[lineAt(node.header.start)];
		const closer = node.closer ? lines[lineAt(node.closer.start)] : undefined;
		if (!opener) continue;
		if (!closer) {
			unmatchedOpeners.push(opener.index);
			continue;
		}
		pairs.push({
			openerLine: opener.index,
			closerLine: closer.index,
			openerFrom: opener.from,
			openerTo: opener.to,
			closerFrom: closer.from,
			closerTo: closer.to,
			keyword: node.type ?? "",
			title: node.subject?.raw,
			level: 1,
			explicitClose: true,
		});
	}
	for (const diagnostic of modern.diagnostics)
		if (diagnostic.code === "stray-closer") unmatchedClosers.push(diagnostic.line - 1);
	pairs.sort((a, b) => a.openerLine - b.openerLine);
	const lineLevels = new Map<number, number[]>();
	for (const pair of pairs) {
		pair.level =
			1 +
			pairs.filter(
				(other) =>
					other !== pair &&
					other.openerLine < pair.openerLine &&
					other.closerLine > pair.closerLine,
			).length;
		for (let line = pair.openerLine; line <= pair.closerLine; line++)
			lineLevels.set(
				line,
				[...(lineLevels.get(line) ?? []), pair.level].sort((a, b) => a - b).slice(0, 2),
			);
	}
	return {
		lines,
		pairs,
		lineLevels,
		unmatchedOpeners,
		unmatchedClosers,
		unmatchedPositions: [...unmatchedOpeners, ...unmatchedClosers]
			.map((line) => lines[line]?.from)
			.filter((from): from is number => from !== undefined)
			.sort((a, b) => a - b),
	};
}

function findFocusedPair(pairs: DelimiterPair[], position: number): DelimiterPair | null {
	let best: DelimiterPair | null = null;
	for (const pair of pairs) {
		if (position < pair.openerFrom || position > pair.closerTo) continue;
		if (!best) {
			best = pair;
			continue;
		}
		const currentSpan = pair.closerTo - pair.openerFrom;
		const bestSpan = best.closerTo - best.openerFrom;
		if (currentSpan < bestSpan) best = pair;
	}
	return best;
}

function buildDecorations(
	doc: PMNode,
	analysis: DelimiterAnalysis,
	foldedOpeners: Set<number>,
	selectionFrom: number,
	showUnmatched: boolean,
	options: DelimiterMatchingOptions,
): DecorationSet {
	const decorations: Decoration[] = [];

	for (const line of analysis.lines) {
		const levels = analysis.lineLevels.get(line.index) ?? [];
		if (levels.length > 0) {
			const classes: string[] = [];
			if (levels.length >= 1) classes.push("praxity-raw-delimiter-depth-1");
			if (levels.length >= 2) classes.push("praxity-raw-delimiter-depth-2");

			const outermostPair = analysis.pairs.find(
				(p) => p.level === levels[0] && line.index >= p.openerLine && line.index <= p.closerLine,
			);
			const cat1 = outermostPair ? resolveCategory(outermostPair.keyword) : null;

			for (let depth = 1; depth <= Math.min(levels.length, 2); depth++) {
				decorations.push(
					Decoration.widget(
						line.from,
						() => {
							const guide = document.createElement("span");
							guide.className = `praxity-raw-container-guide praxity-raw-container-guide--${depth}`;
							guide.setAttribute("aria-hidden", "true");
							return guide;
						},
						{ side: -1, key: `guide-${line.from}-${depth}` },
					),
				);
			}

			decorations.push(
				Decoration.node(line.nodePos, line.nodePos + line.nodeSize, {
					class: classes.join(" "),
					"data-depth": String(levels.length),
					...(cat1 ? { "data-grammar-category-1": cat1 } : {}),
				}),
			);
		}
	}

	const focusedPair = findFocusedPair(analysis.pairs, selectionFrom);
	if (focusedPair) {
		decorations.push(
			Decoration.inline(focusedPair.openerFrom, focusedPair.closerTo, {
				class: "praxity-raw-delimiter-focus",
			}),
		);
	}

	for (const pair of analysis.pairs) {
		const isFolded = foldedOpeners.has(pair.openerFrom);
		decorations.push(
			Decoration.widget(
				pair.openerFrom,
				(editorView) => {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "praxity-raw-fold-caret";
					button.setAttribute("aria-expanded", String(!isFolded));
					button.setAttribute(
						"aria-label",
						isFolded
							? options.strings.expandAriaLabel(pair.keyword)
							: options.strings.collapseAriaLabel(pair.keyword),
					);
					button.textContent = "\u25b8";
					button.dataset.foldOpener = String(pair.openerFrom);
					const toggle = () => {
						// The widget key carries the folded state, so this dispatch
						// replaces the button rather than reusing it — which is what keeps
						// `aria-expanded` honest no matter which path did the folding.
						// Replacing it also drops focus, so hand it back to the new node.
						const hadFocus = document.activeElement === button;
						editorView.dispatch(
							editorView.state.tr.setMeta(delimiterMatchingPluginKey, {
								type: "toggle-fold",
								openerFrom: pair.openerFrom,
								keyword: pair.keyword,
							} satisfies DelimiterPluginMeta),
						);
						if (!hadFocus) return;
						editorView.dom
							.querySelector<HTMLElement>(
								`.praxity-raw-fold-caret[data-fold-opener="${pair.openerFrom}"]`,
							)
							?.focus();
					};
					// mousedown only cancels the selection change, so clicking a caret
					// still does not pull focus out of the editor; the toggle runs on click.
					button.addEventListener("mousedown", (event) => {
						event.preventDefault();
					});
					button.addEventListener("click", toggle);
					// The caret sits inside the contenteditable, so ProseMirror's keymap
					// saw these keys first: the fold was mouse-only, and Enter split the
					// line under a focused caret. Activate here and keep the keys out of
					// the document.
					button.addEventListener("keydown", (event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						event.stopPropagation();
						toggle();
					});
					return button;
				},
				// The key has to carry everything `toDOM` renders. Keyed widgets are
				// compared by key alone, so a key of position only meant the button was
				// reused across a fold and kept its draw-time `aria-expanded`, and could
				// even be handed to a different block that moved onto the position.
				{ side: -1, key: `fold-${pair.openerFrom}-${pair.keyword}-${isFolded}` },
			),
		);

		if (!isFolded) continue;

		const hiddenStart = pair.openerLine + 1;
		const hiddenEnd = pair.closerLine;
		for (let index = hiddenStart; index <= hiddenEnd; index++) {
			const line = analysis.lines[index];
			if (!line) continue;
			decorations.push(
				Decoration.node(line.nodePos, line.nodePos + line.nodeSize, {
					class: "praxity-raw-delimiter-fold-hidden",
				}),
			);
		}

		const hiddenCount = Math.max(0, pair.closerLine - pair.openerLine);
		const titleSegment = pair.title ? ` "${pair.title}"` : "";
		decorations.push(
			Decoration.widget(
				pair.openerTo,
				() => {
					const summary = document.createElement("span");
					summary.className = "praxity-raw-fold-summary";
					summary.textContent = `${pair.keyword}${titleSegment} (${hiddenCount} lines)`;
					return summary;
				},
				{ side: 1, key: `summary-${pair.openerFrom}` },
			),
		);
	}

	if (showUnmatched) {
		for (const openerLineIndex of analysis.unmatchedOpeners) {
			const line = analysis.lines[openerLineIndex];
			if (!line) continue;
			decorations.push(
				Decoration.inline(line.from, line.to, {
					class: "praxity-raw-delimiter-unmatched",
					title: options.strings.unmatchedOpenTooltip,
					"aria-describedby": options.unmatchedOpenDescriptionId,
				}),
			);
		}

		for (const closerLineIndex of analysis.unmatchedClosers) {
			const line = analysis.lines[closerLineIndex];
			if (!line) continue;
			decorations.push(
				Decoration.inline(line.from, line.to, {
					class: "praxity-raw-delimiter-unmatched",
					title: options.strings.unmatchedCloseTooltip,
					"aria-describedby": options.unmatchedCloseDescriptionId,
				}),
			);
		}
	}

	return DecorationSet.create(doc, decorations);
}

function createPluginState(
	doc: PMNode,
	selectionFrom: number,
	foldedOpeners: Set<number>,
	showUnmatched: boolean,
	options: DelimiterMatchingOptions,
	analysis = analyzeDelimiterStructure(collectDelimiterLines(doc)),
): DelimiterPluginState {
	const validFolded = new Set(
		Array.from(foldedOpeners).filter((openerFrom) =>
			analysis.pairs.some((pair) => pair.openerFrom === openerFrom),
		),
	);
	const decorations = buildDecorations(
		doc,
		analysis,
		validFolded,
		selectionFrom,
		showUnmatched,
		options,
	);
	return {
		analysis,
		decorations,
		foldedOpeners: validFolded,
		showUnmatched,
	};
}

export function createDelimiterMatchingPlugin(options: DelimiterMatchingOptions): Plugin {
	return new Plugin({
		key: delimiterMatchingPluginKey,
		state: {
			init(_config, state) {
				return createPluginState(state.doc, state.selection.from, new Set(), true, options);
			},
			apply(transaction, pluginState, _oldState, newState) {
				const meta = transaction.getMeta(delimiterMatchingPluginKey) as
					| DelimiterPluginMeta
					| undefined;
				let foldedOpeners = pluginState.foldedOpeners;
				let showUnmatched = pluginState.showUnmatched;

				if (transaction.docChanged) {
					const mappedOpeners = new Set<number>();
					for (const openerFrom of foldedOpeners) {
						const mapped = transaction.mapping.mapResult(openerFrom, 1);
						if (!mapped.deleted) mappedOpeners.add(mapped.pos);
					}
					foldedOpeners = mappedOpeners;
					showUnmatched = false;
				}

				if (meta?.type === "toggle-fold") {
					foldedOpeners = toggleFoldedOpeners(foldedOpeners, meta.openerFrom);
					if (foldedOpeners.has(meta.openerFrom)) {
						announceToScreenReader(options.strings.collapsedAnnouncement(meta.keyword));
					} else {
						announceToScreenReader(options.strings.expandedAnnouncement(meta.keyword));
					}
				}

				if (meta?.type === "show-unmatched") {
					showUnmatched = true;
				}

				if (!transaction.docChanged && !transaction.selectionSet && !meta) {
					return pluginState;
				}

				return createPluginState(
					newState.doc,
					newState.selection.from,
					foldedOpeners,
					showUnmatched,
					options,
					transaction.docChanged ? undefined : pluginState.analysis,
				);
			},
		},
		props: {
			decorations(state) {
				return delimiterMatchingPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
			},
			handleClick(view, pos, event) {
				// Don't interfere if clicking the fold caret itself.
				if (
					event.target instanceof HTMLElement &&
					event.target.closest(".praxity-raw-fold-caret")
				) {
					return false;
				}

				const pluginState = delimiterMatchingPluginKey.getState(view.state);
				if (!pluginState) return false;

				// Find which line was clicked.
				const clickedLine = pluginState.analysis.lines.find(
					(line) => pos >= line.nodePos && pos < line.nodePos + line.nodeSize,
				);
				if (!clickedLine) return false;

				// Check if this line is a folded opener.
				const foldedPair = pluginState.analysis.pairs.find(
					(pair) =>
						pair.openerLine === clickedLine.index && pluginState.foldedOpeners.has(pair.openerFrom),
				);
				if (!foldedPair) return false;

				// Auto-expand the collapsed block.
				view.dispatch(
					view.state.tr.setMeta(delimiterMatchingPluginKey, {
						type: "toggle-fold",
						openerFrom: foldedPair.openerFrom,
						keyword: foldedPair.keyword,
					} satisfies DelimiterPluginMeta),
				);

				return false; // Let the click also place the cursor.
			},
			handleKeyDown(view, event) {
				if (event.key !== "F8") return false;
				const pluginState = delimiterMatchingPluginKey.getState(view.state);
				if (!pluginState || pluginState.analysis.unmatchedPositions.length === 0) return false;
				event.preventDefault();

				const current = view.state.selection.from;
				const next =
					pluginState.analysis.unmatchedPositions.find((position) => position > current) ??
					pluginState.analysis.unmatchedPositions[0];
				view.dispatch(
					view.state.tr.setSelection(TextSelection.create(view.state.doc, next)).scrollIntoView(),
				);
				view.focus();
				return true;
			},
		},
		view(view) {
			let timer: ReturnType<typeof setTimeout> | null = null;

			const updateStatus = (state: DelimiterPluginState | undefined) => {
				const status = document.getElementById(options.statusElementId);
				if (!status || !state) return;
				status.textContent = options.strings.unmatchedCount(
					state.analysis.unmatchedPositions.length,
				);
			};

			updateStatus(delimiterMatchingPluginKey.getState(view.state));

			return {
				update(updatedView, previousState) {
					const state = delimiterMatchingPluginKey.getState(updatedView.state);
					updateStatus(state);

					if (!previousState.doc.eq(updatedView.state.doc)) {
						if (timer) clearTimeout(timer);
						timer = setTimeout(() => {
							const current = delimiterMatchingPluginKey.getState(updatedView.state);
							if (!current || current.showUnmatched) return;
							updatedView.dispatch(
								updatedView.state.tr.setMeta(delimiterMatchingPluginKey, {
									type: "show-unmatched",
								} satisfies DelimiterPluginMeta),
							);
						}, UNMATCHED_DEBOUNCE_MS);
					}
				},
				destroy() {
					if (timer) clearTimeout(timer);
				},
			};
		},
	});
}

export function createDelimiterMatchingExtension(options: DelimiterMatchingOptions) {
	return Extension.create({
		name: "delimiterMatching",
		addProseMirrorPlugins() {
			return [createDelimiterMatchingPlugin(options)];
		},
	});
}
