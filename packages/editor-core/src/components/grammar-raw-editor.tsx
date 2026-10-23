"use client";

import { useComputedColorScheme } from "@mantine/core";
import { readLesson } from "@praxity/grammar";
import { GRAMMAR_YTEXT_FIELD } from "@praxity/shared-blocks/constants";
import { TextSelection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useTranslations } from "use-intl";
import { useCollaboration } from "../lib/collaboration/collaboration-context";
import { findScrollContainer, revealOffsetInContainer } from "../lib/reveal-in-container";
import { AutoSurroundExtension } from "./extensions/auto-surround-extension";
import { createDelimiterMatchingExtension } from "./extensions/delimiter-matching-plugin";
import {
	createDesktopGrammarDecorationExtension,
	type NarrationMarker,
	setDesktopNarrationControlsVisible,
	setDesktopNarrationMarkers,
} from "./extensions/desktop-grammar-decoration-extension";
import { createFocusModeExtension } from "./extensions/focus-mode-extension";
import { GrammarFormattingExtension } from "./extensions/grammar-formatting-extension";
import { createGrammarHighlightExtension } from "./extensions/grammar-highlight-extension";
import { MacCursorNavExtension } from "./extensions/mac-cursor-nav-extension";
import { createSearchHighlightExtension } from "./extensions/search-highlight-extension";
import { createSmartPunctuationExtension } from "./extensions/smart-punctuation-extension";
import { TableAlignExtension } from "./extensions/table-align-extension";
import { TableNavExtension } from "./extensions/table-nav-extension";
import {
	CURSOR_LOCATION_CHANGED_EVENT,
	clamp,
	type GrammarCursorLocation,
	getScrollFraction,
	useGrammarDocumentStore,
} from "./grammar-document-store";
import { textToParagraphs } from "./text-to-paragraphs";
import { announceToScreenReader } from "./toolbar-keyboard-nav";

export interface EditorScrollHandle {
	getScrollFraction: () => number;
	setScrollFraction: (fraction: number) => void;
}

const GRAMMAR_PARSE_OPTIONS = { preserveWhitespace: "full" as const };

/** Extracts plain text from TipTap, preserving newlines between paragraphs. */
function extractText(editor: Editor | null): string {
	if (!editor) return "";
	const lines: string[] = [];
	// Keep the empty final paragraph that represents the author's final newline.
	editor.state.doc.forEach((node) => {
		lines.push(node.textContent);
	});
	return lines.join("\n");
}

const DELIMITER_STATUS_ID = "praxity-delimiter-status";
const DELIMITER_UNMATCHED_OPEN_ID = "praxity-delimiter-unmatched-open";
const DELIMITER_UNMATCHED_CLOSE_ID = "praxity-delimiter-unmatched-close";
const VISUALLY_HIDDEN_STYLE = {
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: "0",
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	border: "0",
} as const;

interface GrammarRawEditorProps {
	smartPunctuationEnabled?: boolean;
	focusModeEnabled?: boolean;
	lineLength?: 72 | 80 | 100 | 120 | 0;
	/** Label for the instructor badge decoration. Desktop passes translated string; defaults to "Instructor". */
	instructorBadgeLabel?: string;
	showNarrationControls?: boolean;
	showNarrationLabel?: string;
	narrationMarkers?: Record<number, NarrationMarker>;
}

function resolveRawLineAndColumn(editor: Editor): { grammarLine: number; grammarColumn: number } {
	const anchor = editor.state.selection.anchor;
	let grammarLine = 0;
	let grammarColumn = 0;
	let paragraphIndex = 0;
	let matched = false;

	editor.state.doc.descendants((node, pos) => {
		if (matched) return false;
		if (node.type.name !== "paragraph") return true;
		const start = pos + 1;
		const end = start + node.content.size;
		if (anchor <= end) {
			grammarLine = paragraphIndex;
			grammarColumn = clamp(anchor - start, 0, node.textContent.length);
			matched = true;
			return false;
		}
		paragraphIndex += 1;
		return true;
	});

	if (!matched) {
		grammarLine = Math.max(0, paragraphIndex - 1);
		grammarColumn = 0;
	}

	return { grammarLine, grammarColumn };
}

export function resolveKeywordContext(
	source: string,
	grammarLine: number,
): Pick<GrammarCursorLocation, "enclosingKeyword" | "keywordOccurrenceIndex"> {
	const read = readLesson(source);
	const position = read.tree.stream.lines[grammarLine]?.start;
	if (position === undefined) return { enclosingKeyword: null, keywordOccurrenceIndex: 0 };
	const records = [...read.nodes.values()].filter(
		(record) => !record.role && record.node.kind === "block",
	);
	const owner = records
		.filter((record) => record.range.start <= position && record.range.end > position)
		.sort((a, b) => a.range.end - a.range.start - (b.range.end - b.range.start))[0];
	return {
		enclosingKeyword: owner?.node.type ?? null,
		keywordOccurrenceIndex: owner
			? records.filter(
					(record) =>
						record.node.type === owner.node.type && record.range.start < owner.range.start,
				).length
			: 0,
	};
}

function readRawCursorLocation(
	editor: Editor,
	container: HTMLDivElement | null,
	source: string,
): GrammarCursorLocation {
	const { grammarLine, grammarColumn } = resolveRawLineAndColumn(editor);
	const keywordContext = resolveKeywordContext(source, grammarLine);

	return {
		grammarLine,
		grammarColumn,
		enclosingKeyword: keywordContext.enclosingKeyword,
		keywordOccurrenceIndex: keywordContext.keywordOccurrenceIndex,
		scrollFraction: getScrollFraction(container),
	};
}

function resolveRawSelectionPos(editor: Editor, location: GrammarCursorLocation): number {
	const targetLine = Math.max(0, location.grammarLine);
	let paragraphIndex = 0;
	let selectionPos = editor.state.doc.content.size;
	let found = false;

	editor.state.doc.descendants((node, pos) => {
		if (found) return false;
		if (node.type.name !== "paragraph") return true;
		if (paragraphIndex === targetLine) {
			const start = pos + 1;
			const column = clamp(location.grammarColumn, 0, node.textContent.length);
			selectionPos = start + column;
			found = true;
			return false;
		}
		paragraphIndex += 1;
		return true;
	});

	if (!found) {
		const docSize = editor.state.doc.content.size;
		selectionPos = clamp(selectionPos, 1, Math.max(1, docSize));
	}

	return selectionPos;
}

function restoreRawCursorLocation(
	editor: Editor,
	container: HTMLDivElement | null,
	location: GrammarCursorLocation,
) {
	if (editor.isDestroyed) return;
	const selectionPos = resolveRawSelectionPos(editor, location);
	const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, selectionPos));
	editor.view.dispatch(tr);

	if (!container) return;
	const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
	container.scrollTop = clamp(location.scrollFraction, 0, 1) * maxScroll;
}

export const GrammarRawEditor = forwardRef<EditorScrollHandle, GrammarRawEditorProps>(
	function GrammarRawEditor(
		{
			smartPunctuationEnabled = true,
			focusModeEnabled = false,
			lineLength = 100,
			instructorBadgeLabel: instructorBadgeLabelProp = "Instructor",
			showNarrationControls = false,
			showNarrationLabel,
			narrationMarkers = {},
		},
		ref,
	) {
		const tDelimiter = useTranslations("editor.delimiterMatching");
		const tHighlight = useTranslations("editor.grammarHighlight");
		const tReveal = useTranslations("editor.reveal");
		const tRevealRef = useRef(tReveal);
		tRevealRef.current = tReveal;
		const instructorBadgeLabel = instructorBadgeLabelProp;
		const collaboration = useCollaboration();
		const ydoc = collaboration?.ydoc ?? null;

		const grammarSource = useGrammarDocumentStore((s) => s.grammarSource);
		const parseError = useGrammarDocumentStore((s) => s.parseError);
		const tEditor = useTranslations("editor");
		const setGrammarSource = useGrammarDocumentStore((s) => s.setGrammarSource);
		const cursorLocation = useGrammarDocumentStore((s) => s.cursorLocation);
		const setCursorLocation = useGrammarDocumentStore((s) => s.setCursorLocation);

		const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
		const editorRef = useRef<Editor | null>(null);
		const containerRef = useRef<HTMLDivElement | null>(null);
		const scrollFractionRef = useRef(0);
		const isApplyingRemoteYUpdateRef = useRef(false);
		const hasRestoredCursorRef = useRef(false);
		const pendingNavigationSelectionRef = useRef<number | null>(null);
		const pendingNavigationTimerRef = useRef<number | null>(null);
		// One-shot: skip the selection report caused by applying loaded content, so
		// the author isn't jumped to the last slide on open (setContent lands the
		// cursor at the end of the doc).
		const suppressSelectionReportRef = useRef(false);
		// Capture ydoc so the mount effect can read Y.Text content after mount
		const ydocRef = useRef(ydoc);
		ydocRef.current = ydoc;
		const setGrammarSourceRef = useRef(setGrammarSource);
		setGrammarSourceRef.current = setGrammarSource;
		const setCursorLocationRef = useRef(setCursorLocation);
		setCursorLocationRef.current = setCursorLocation;

		const triggerParse = useCallback(() => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(() => {
				const text = extractText(editorRef.current);
				setGrammarSourceRef.current(text);
			}, 300);
		}, []);

		const delimiterMatchingExtension = useMemo(
			() =>
				createDelimiterMatchingExtension({
					statusElementId: DELIMITER_STATUS_ID,
					unmatchedOpenDescriptionId: DELIMITER_UNMATCHED_OPEN_ID,
					unmatchedCloseDescriptionId: DELIMITER_UNMATCHED_CLOSE_ID,
					strings: {
						collapseAriaLabel: (keyword) => tDelimiter("collapseAriaLabel", { keyword }),
						expandAriaLabel: (keyword) => tDelimiter("expandAriaLabel", { keyword }),
						collapsedAnnouncement: (keyword) => tDelimiter("collapsedAnnouncement", { keyword }),
						expandedAnnouncement: (keyword) => tDelimiter("expandedAnnouncement", { keyword }),
						unmatchedOpenTooltip: tDelimiter("unmatchedOpenTooltip"),
						unmatchedCloseTooltip: tDelimiter("unmatchedCloseTooltip"),
						unmatchedCount: (count) =>
							count === 1
								? tDelimiter("unmatchedCountSingle")
								: tDelimiter("unmatchedCount", { count }),
					},
				}),
			[tDelimiter],
		);
		const grammarHighlightExtension = useMemo(
			() =>
				createGrammarHighlightExtension({
					collapseFrontmatter: tHighlight("collapseFrontmatter"),
					expandFrontmatter: tHighlight("expandFrontmatter"),
				}),
			[tHighlight],
		);
		const desktopGrammarDecorationExtension = useMemo(
			() =>
				createDesktopGrammarDecorationExtension({
					instructorLabel: instructorBadgeLabel,
					showNarrationControls,
					showNarrationLabel,
					narrationMarkers,
				}),
			[instructorBadgeLabel, showNarrationControls, showNarrationLabel, narrationMarkers],
		);
		const smartPunctuationExtension = useMemo(
			() => createSmartPunctuationExtension(smartPunctuationEnabled),
			[smartPunctuationEnabled],
		);
		const focusModeExtension = useMemo(
			() => createFocusModeExtension(focusModeEnabled),
			[focusModeEnabled],
		);
		const searchHighlightExtension = useMemo(
			() =>
				createSearchHighlightExtension({
					onMatchCountChange: (count) => {
						window.dispatchEvent(
							new CustomEvent("praxity:search-match-count", { detail: { count } }),
						);
					},
				}),
			[],
		);
		const computedColorScheme = useComputedColorScheme("light", {
			getInitialValueInEffect: true,
		});

		const editor = useEditor({
			immediatelyRender: false,
			extensions: [
				StarterKit.configure({
					// Plain-text mode: disable all rich-text features
					bold: false,
					italic: false,
					strike: false,
					code: false,
					blockquote: false,
					bulletList: false,
					orderedList: false,
					listItem: false,
					heading: false,
					horizontalRule: false,
					codeBlock: false,
					hardBreak: false,
					undoRedo: {},
					// Keep document, paragraph, text
				}),
				delimiterMatchingExtension,
				grammarHighlightExtension,
				desktopGrammarDecorationExtension,
				smartPunctuationExtension,
				focusModeExtension,
				TableAlignExtension,
				TableNavExtension,
				MacCursorNavExtension,
				GrammarFormattingExtension,
				AutoSurroundExtension,
				searchHighlightExtension,
			],
			content: textToParagraphs(grammarSource),
			parseOptions: GRAMMAR_PARSE_OPTIONS,
			editorProps: {
				attributes: {
					class: "praxity-raw-editor",
					"data-show-narration-controls": String(showNarrationControls),
					"data-f6-focus": "true",
					role: "textbox",
					"aria-label": "Grammar editor",
					"aria-multiline": "true",
					// Syntax-bearing editor: browser spellcheck red-underlines asset
					// filenames and grammar keys, and a red squiggle already means
					// "syntax error" here. Turn it off.
					spellcheck: "false",
					style: [
						"outline: none",
						"font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace",
						"font-size: 13px",
						"line-height: 1.65",
						"white-space: pre-wrap",
						"overflow-wrap: break-word",
						"min-height: 100%",
						"padding: 16px var(--praxity-raw-editor-padding-right, 20px) 16px 16px",
					].join("; "),
				},
				handleKeyDown() {
					// A deliberate key press supersedes the short focus-restoration guard
					// installed by page navigation. Never send typing back to that page.
					pendingNavigationSelectionRef.current = null;
					return false;
				},
				handleClick(view, _pos, event) {
					pendingNavigationSelectionRef.current = null;
					const target = event.target as HTMLElement | null;
					if (target?.closest("a")) {
						event.preventDefault();
						view.focus();
						return true;
					}
					return false;
				},
			},
			onFocus: ({ editor: e }) => {
				// Keyboard entry needs the document selection as well as DOM focus.
				// A freshly mounted browser editor can otherwise receive keys without a caret.
				e.view.focus();
			},
			onUpdate: ({ editor: e }) => {
				editorRef.current = e;
				if (isApplyingRemoteYUpdateRef.current) {
					isApplyingRemoteYUpdateRef.current = false;
					return;
				}

				// Mirror editor text into Y.Text for both guest-mode and authenticated collaboration.
				const doc = ydocRef.current;
				if (doc !== null) {
					const text = extractText(e);
					const ytext = doc.getText(GRAMMAR_YTEXT_FIELD);
					if (ytext.toString() !== text) {
						doc.transact(() => {
							ytext.delete(0, ytext.length);
							if (text.length > 0) {
								ytext.insert(0, text);
							}
						}, "grammar-raw-editor");
					}
				}
				triggerParse();
			},
			onSelectionUpdate: ({ editor: e }) => {
				editorRef.current = e;
				const pendingSelection = pendingNavigationSelectionRef.current;
				if (pendingSelection != null && e.state.selection.anchor !== pendingSelection) {
					e.view.dispatch(
						e.state.tr.setSelection(TextSelection.create(e.state.doc, pendingSelection)),
					);
					return;
				}
				// Skip the one selection-update produced by loading content (cursor
				// lands at doc end) so open doesn't jump to the last slide.
				if (suppressSelectionReportRef.current) {
					suppressSelectionReportRef.current = false;
					return;
				}
				const source = extractText(e);
				const location = readRawCursorLocation(e, containerRef.current, source);
				setCursorLocationRef.current(location);
				window.dispatchEvent(
					new CustomEvent(CURSOR_LOCATION_CHANGED_EVENT, {
						detail: { location },
					}),
				);
			},
		});

		useEffect(() => {
			editorRef.current = editor;
		}, [editor]);

		useEffect(() => {
			if (!editor) return;
			editor.view.dom.setAttribute("data-show-narration-controls", String(showNarrationControls));
			setDesktopNarrationControlsVisible(editor.view, showNarrationControls);
		}, [editor, showNarrationControls]);

		useEffect(() => {
			if (!editor) return;
			setDesktopNarrationMarkers(editor.view, narrationMarkers);
		}, [editor, narrationMarkers]);

		useEffect(() => {
			const element = containerRef.current;
			if (!element) return;
			const handler = () => {
				scrollFractionRef.current = getScrollFraction(element);
			};
			handler();
			element.addEventListener("scroll", handler, { passive: true });
			return () => element.removeEventListener("scroll", handler);
		}, []);

		useImperativeHandle(
			ref,
			() => ({
				getScrollFraction: () => scrollFractionRef.current,
				setScrollFraction: (fraction: number) => {
					const element = containerRef.current;
					if (!element) return;
					const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
					element.scrollTop = clamp(fraction, 0, 1) * maxScroll;
				},
			}),
			[],
		);

		useEffect(() => {
			if (!editor || hasRestoredCursorRef.current) return;
			hasRestoredCursorRef.current = true;
			if (!cursorLocation) return;
			requestAnimationFrame(() => {
				restoreRawCursorLocation(editor, containerRef.current, cursorLocation);
			});
		}, [cursorLocation, editor]);

		useEffect(() => {
			const handleScrollToLine = (
				event: Event & {
					detail?: {
						lineNumber?: number;
						blockId?: string;
						location?: GrammarCursorLocation | null;
						revealOnly?: boolean;
					};
				},
			) => {
				const restoredLocation = event.detail?.location;
				if (restoredLocation) {
					const e = editorRef.current;
					if (!e) return;
					restoreRawCursorLocation(e, containerRef.current, restoredLocation);
					return;
				}

				const e = editorRef.current;
				if (!e) return;
				let lineNumber = event.detail?.lineNumber;
				if (lineNumber == null && event.detail?.blockId) {
					const source = extractText(e);
					const span = readLesson(source).spans.get(event.detail.blockId);
					if (span) {
						lineNumber = span.startLine;
					}
				}
				if (lineNumber == null) return;

				const doc = e.state.doc;
				const targetLine = Math.max(0, Math.min(lineNumber, doc.childCount - 1));

				// Compute ProseMirror position at start of target paragraph
				let pos = 0;
				for (let i = 0; i < targetLine; i++) {
					pos += doc.child(i).nodeSize;
				}
				pos += 1; // Enter the paragraph node
				const revealLine = () => {
					const container = findScrollContainer(e.view.dom) ?? containerRef.current;
					const coords = e.view.coordsAtPos(pos);
					if (!container) return;
					const offsetTop =
						coords.top - container.getBoundingClientRect().top + container.scrollTop;
					revealOffsetInContainer(container, offsetTop);
				};
				if (event.detail?.revealOnly) {
					revealLine();
					return;
				}

				// Not ProseMirror's scrollIntoView: that scrolls the minimum amount, so a
				// target arrived at from the panel lands hard against whichever edge it
				// entered from. Place it a third down instead, and flash it so the reader
				// can see where they were taken.
				pendingNavigationSelectionRef.current = pos;
				if (pendingNavigationTimerRef.current != null) {
					window.clearTimeout(pendingNavigationTimerRef.current);
				}
				pendingNavigationTimerRef.current = window.setTimeout(() => {
					pendingNavigationSelectionRef.current = null;
					pendingNavigationTimerRef.current = null;
				}, 250);
				e.view.dom.focus({ preventScroll: true });
				const transaction = e.state.tr.setSelection(TextSelection.create(doc, pos));
				e.view.dispatch(transaction);
				revealLine();
				const lineText = doc.child(targetLine).textContent.trim();
				announceToScreenReader(
					tRevealRef.current("jumpedToLine", {
						line: targetLine + 1,
						text: lineText.length > 60 ? `${lineText.slice(0, 60)}…` : lineText,
					}),
				);
			};

			window.addEventListener(
				"praxity:scroll-to-grammar-line",
				handleScrollToLine as EventListener,
			);
			return () => {
				window.removeEventListener(
					"praxity:scroll-to-grammar-line",
					handleScrollToLine as EventListener,
				);
			};
		}, []);

		useEffect(() => {
			const handleSearchQuery = (event: Event) => {
				const query = (event as CustomEvent<{ query: string }>).detail?.query ?? "";
				editorRef.current?.commands.setSearchQuery(query);
			};
			const handleSearchIndex = (event: Event) => {
				const index = (event as CustomEvent<{ index: number }>).detail?.index ?? 0;
				editorRef.current?.commands.setSearchIndex(index);
			};
			const handleClearSearch = () => {
				editorRef.current?.commands.clearSearch();
			};

			window.addEventListener("praxity:search-query", handleSearchQuery);
			window.addEventListener("praxity:search-index", handleSearchIndex);
			window.addEventListener("praxity:search-clear", handleClearSearch);
			return () => {
				window.removeEventListener("praxity:search-query", handleSearchQuery);
				window.removeEventListener("praxity:search-index", handleSearchIndex);
				window.removeEventListener("praxity:search-clear", handleClearSearch);
			};
		}, []);

		// Listen for grammar insertion requests from the copilot.
		useEffect(() => {
			const handleInsertGrammar = (event: Event) => {
				const { grammar, inlinePlaceholder, wrapSelection } =
					(
						event as CustomEvent<{
							grammar: string;
							inlinePlaceholder?: string;
							wrapSelection?: boolean;
						}>
					).detail ?? {};
				if (!grammar) return;
				const e = editorRef.current;
				if (!e) return;
				if (inlinePlaceholder !== undefined) {
					const { from, to } = e.state.selection;
					const offset = Math.max(0, grammar.indexOf(inlinePlaceholder));
					const tr = e.state.tr;
					if (wrapSelection && from !== to) {
						tr.insertText(grammar.slice(offset + inlinePlaceholder.length), to);
						tr.insertText(grammar.slice(0, offset), from);
						tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
					} else {
						tr.insertText(grammar, from, to);
						tr.setSelection(
							TextSelection.create(tr.doc, from + offset, from + offset + inlinePlaceholder.length),
						);
					}
					e.view.dispatch(tr);
					e.commands.focus();
					return;
				}
				e.chain()
					.focus()
					.insertContent(textToParagraphs(grammar), { parseOptions: GRAMMAR_PARSE_OPTIONS })
					.run();
			};

			window.addEventListener("praxity:insert-grammar", handleInsertGrammar);
			return () => window.removeEventListener("praxity:insert-grammar", handleInsertGrammar);
		}, []);

		// Keep TipTap in sync with Y.Text updates (remote peers + IndexedDB restore).
		useEffect(() => {
			if (!editor || !ydoc) return;

			const ytext = ydoc.getText(GRAMMAR_YTEXT_FIELD);
			const applyYTextToEditor = () => {
				const next = ytext.toString();
				const current = extractText(editor);
				if (next === current) return;

				isApplyingRemoteYUpdateRef.current = true;
				suppressSelectionReportRef.current = true;
				editor.commands.setContent(textToParagraphs(next), {
					parseOptions: GRAMMAR_PARSE_OPTIONS,
				});
				setGrammarSourceRef.current(next);
			};

			applyYTextToEditor();
			const observer = () => {
				applyYTextToEditor();
			};
			ytext.observe(observer);

			return () => {
				ytext.unobserve(observer);
			};
		}, [editor, ydoc]);

		useEffect(() => {
			return () => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				if (pendingNavigationTimerRef.current != null) {
					window.clearTimeout(pendingNavigationTimerRef.current);
				}
			};
		}, []);

		useEffect(() => {
			return () => {
				const currentEditor = editorRef.current;
				if (!currentEditor) return;
				const source = extractText(currentEditor);
				const location = readRawCursorLocation(currentEditor, containerRef.current, source);
				setCursorLocationRef.current(location);
			};
		}, []);

		if (!editor) return null;

		return (
			<div
				ref={containerRef}
				// `data-raw-theme` used to gate the whole raw syntax palette off
				// Mantine's computed colour scheme, which does not track the theme
				// chosen in Settings — so the light palette rendered on dark editors
				// at 1.5-1.9:1. The palette now cascades from the desktop theme
				// tokens on documentElement; this attribute is retained only as a
				// styling hook and no longer selects colours.
				data-raw-theme={computedColorScheme}
				data-line-length={lineLength === 0 ? "unlimited" : "limited"}
				className="praxity-raw-editor-shell"
				style={{
					height: "100%",
					overflow: "auto",
					background: "var(--praxity-raw-bg)",
					color: "var(--praxity-raw-fg)",
					borderRadius: "var(--mantine-radius-sm)",
					position: "relative",
					["--praxity-editor-line-length" as string]: String(lineLength === 0 ? 100 : lineLength),
				}}
			>
				{parseError === "invalid-frontmatter" && (
					<div
						role="alert"
						style={{
							padding: "8px 16px",
							color: "var(--severity-warning-text)",
							background: "var(--severity-warning-surface)",
						}}
					>
						{tEditor("invalidFrontmatter")}
					</div>
				)}
				<EditorContent editor={editor} className="ph-no-capture" />
				<div
					id={DELIMITER_STATUS_ID}
					role="status"
					aria-live="polite"
					aria-atomic="true"
					style={VISUALLY_HIDDEN_STYLE}
				/>
				<div id={DELIMITER_UNMATCHED_OPEN_ID} style={VISUALLY_HIDDEN_STYLE}>
					{tDelimiter("unmatchedOpenTooltip")}
				</div>
				<div id={DELIMITER_UNMATCHED_CLOSE_ID} style={VISUALLY_HIDDEN_STYLE}>
					{tDelimiter("unmatchedCloseTooltip")}
				</div>
			</div>
		);
	},
);
