import { readLesson } from "@praxity/grammar";
import alertTriangleIcon from "@tabler/icons/outline/alert-triangle.svg?url";
import checkIcon from "@tabler/icons/outline/check.svg?url";
import clipboardCheckIcon from "@tabler/icons/outline/clipboard-check.svg?url";
import headphonesOffIcon from "@tabler/icons/outline/headphones-off.svg?url";
import minusIcon from "@tabler/icons/outline/minus.svg?url";
import noteIcon from "@tabler/icons/outline/note.svg?url";
import photoIcon from "@tabler/icons/outline/photo.svg?url";
import refreshIcon from "@tabler/icons/outline/refresh.svg?url";
import schoolIcon from "@tabler/icons/outline/school.svg?url";
import separatorHorizontalIcon from "@tabler/icons/outline/separator-horizontal.svg?url";
import waveSineIcon from "@tabler/icons/outline/wave-sine.svg?url";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

const desktopGrammarDecorationPluginKey = new PluginKey("desktop-grammar-decoration");

const HEADING_RE = /^(#{1,6})\s/;
const TABLE_ROW_RE = /^\|.+\|$/;
const GUTTER_ICONS: Record<string, string> = {
	"grammar-gutter-instructor": schoolIcon,
	"grammar-gutter-note": noteIcon,
	"grammar-gutter-image": photoIcon,
	"grammar-gutter-assessment": clipboardCheckIcon,
	"grammar-gutter-page-break": separatorHorizontalIcon,
	"grammar-gutter-divider": minusIcon,
};

interface ParagraphEntry {
	pos: number;
	nodeEnd: number;
	text: string;
	trimmed: string;
}

interface NarrationDecorationOptions {
	instructorLabel: string;
	showNarrationControls: boolean;
	showNarrationLabel: string;
	narrationMarkers: Record<number, NarrationMarker>;
}

export type NarrationMarkerState = "missing" | "ready" | "stale" | "needsReview" | "disabled";
export interface NarrationMarker {
	state: NarrationMarkerState;
	label: string;
	selected?: boolean;
}

const NARRATION_MARKER_ICONS: Record<NarrationMarkerState, string> = {
	missing: waveSineIcon,
	ready: checkIcon,
	stale: refreshIcon,
	needsReview: alertTriangleIcon,
	disabled: headphonesOffIcon,
};

function narrationRovingLine(markers: Record<number, NarrationMarker>, activeLine: number): number {
	const lines = Object.keys(markers)
		.map(Number)
		.filter(Number.isInteger)
		.sort((left, right) => left - right);
	return lines.reduce(
		(closest, line) =>
			Math.abs(line - activeLine) < Math.abs(closest - activeLine) ? line : closest,
		lines[0] ?? -1,
	);
}

function updateNarrationMarkerButton(
	button: HTMLButtonElement,
	marker: NarrationMarker,
	fallbackLabel: string,
): void {
	button.dataset.state = marker.state;
	button.setAttribute("aria-label", marker.label || fallbackLabel);
	if (marker.selected) {
		button.setAttribute("aria-current", "true");
	} else {
		button.removeAttribute("aria-current");
	}
	button.style.setProperty(
		"--praxity-narration-icon",
		`url(${JSON.stringify(NARRATION_MARKER_ICONS[marker.state])})`,
	);
}

function paragraphIndexAtPosition(doc: PMNode, position: number): number {
	let paragraphIndex = -1;
	let match = -1;
	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;
		paragraphIndex += 1;
		if (position >= pos + 1 && position <= pos + node.nodeSize - 1) match = paragraphIndex;
		return true;
	});
	return match;
}

function syncNarrationMarkerButtons(
	view: EditorView,
	markers: Record<number, NarrationMarker>,
	fallbackLabel: string,
): void {
	const activeLine = paragraphIndexAtPosition(view.state.doc, view.state.selection.from);
	const focusedLine = Number(
		(view.dom.ownerDocument.activeElement as HTMLElement | null)?.closest<HTMLButtonElement>(
			".praxity-narration-disclosure",
		)?.dataset.narrationLine,
	);
	const rovingLine =
		Number.isInteger(focusedLine) && markers[focusedLine]
			? focusedLine
			: narrationRovingLine(markers, activeLine);
	for (const button of view.dom.querySelectorAll<HTMLButtonElement>(
		".praxity-narration-disclosure",
	)) {
		const line = Number(button.dataset.narrationLine);
		const marker = markers[line];
		if (!Number.isInteger(line) || !marker) continue;
		updateNarrationMarkerButton(button, marker, fallbackLabel);
		button.tabIndex = line === rovingLine ? 0 : -1;
	}
}

function buildDesktopDecorations(
	doc: PMNode,
	selectionFrom: number,
	options: NarrationDecorationOptions,
): DecorationSet {
	const decorations: Decoration[] = [];
	const paragraphs: ParagraphEntry[] = [];
	let inFrontmatter = false;
	let frontmatterEligible = true;

	doc.descendants((node, pos) => {
		if (node.type.name !== "paragraph") return true;

		const text = node.textContent ?? "";
		const trimmed = text.trim();
		const nodeEnd = pos + node.nodeSize;
		paragraphs.push({ pos, nodeEnd, text, trimmed });
		return true;
	});
	const activeLine = paragraphs.findIndex(
		({ pos, nodeEnd }) => selectionFrom >= pos + 1 && selectionFrom <= nodeEnd - 1,
	);
	const lesson = readLesson(paragraphs.map((paragraph) => paragraph.text).join("\n"));
	const pageNumbers = new Map<number, number>();
	for (const [index, page] of lesson.pages.entries()) {
		const span = lesson.spans.get(page.id);
		if (span) pageNumbers.set(span.startLine, index + 1);
	}
	const rovingLine = narrationRovingLine(options.narrationMarkers, activeLine);

	let inCodeFence = false;

	for (let index = 0; index < paragraphs.length; index++) {
		const paragraph = paragraphs[index];
		if (!paragraph) continue;
		const { pos, nodeEnd, trimmed } = paragraph;

		if (frontmatterEligible) {
			if (!inFrontmatter && trimmed === "---") {
				inFrontmatter = true;
				continue;
			}

			if (inFrontmatter) {
				if (trimmed === "---") {
					inFrontmatter = false;
					frontmatterEligible = false;
				}
				continue;
			}

			if (trimmed.length > 0) {
				frontmatterEligible = false;
			}
		}

		// Reader spans place badges on real page boundaries, excluding fenced examples.
		const isPageBreak = pageNumbers.has(index);
		const pageNumForWidget = pageNumbers.get(index) ?? 0;
		const gutterInfo = isPageBreak
			? { className: "grammar-gutter-page-break" }
			: trimmed === "---"
				? { className: "grammar-gutter-divider" }
				: HEADING_RE.test(trimmed)
					? { className: `grammar-gutter-heading-${HEADING_RE.exec(trimmed)?.[1].length}` }
					: null;
		const lineClasses: string[] = [];
		if (gutterInfo && !(pageNumForWidget > 0 && isPageBreak))
			lineClasses.push(gutterInfo.className);

		if (isPageBreak) {
			lineClasses.push("grammar-page-break");
		}

		if (trimmed === "---") {
			lineClasses.push("grammar-section-divider");
		}

		const headingMatch = HEADING_RE.exec(trimmed);
		if (headingMatch) {
			const level = headingMatch[1]?.length ?? 1;
			lineClasses.push(`grammar-heading-${level}`);
		}
		if (TABLE_ROW_RE.test(trimmed)) {
			lineClasses.push("grammar-table-row");
		}
		if (/^\s*```/.test(trimmed)) {
			lineClasses.push("grammar-code-fence");
			inCodeFence = !inCodeFence;
		} else if (inCodeFence) {
			lineClasses.push("grammar-code-line");
		}

		if (lineClasses.length > 0) {
			const gutterIcon = lineClasses.map((className) => GUTTER_ICONS[className]).find(Boolean);
			decorations.push(
				Decoration.node(pos, nodeEnd, {
					class: lineClasses.join(" "),
					...(gutterIcon
						? { style: `--grammar-gutter-icon: url(${JSON.stringify(gutterIcon)})` }
						: {}),
				}),
			);
		} else if (trimmed !== "" && !inCodeFence) {
			decorations.push(Decoration.node(pos, nodeEnd, { class: "grammar-content" }));
		}

		if (pageNumForWidget > 0) {
			const pageNumBadge = document.createElement("span");
			pageNumBadge.className = "grammar-page-num";
			pageNumBadge.textContent = String(pageNumForWidget);
			pageNumBadge.setAttribute("aria-hidden", "true");
			decorations.push(Decoration.widget(pos + 1, pageNumBadge, { side: -1 }));
		}

		const narrationMarker = options.narrationMarkers[index];
		if (options.showNarrationControls && narrationMarker) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "praxity-narration-disclosure";
			button.dataset.narrationLine = String(index);
			button.setAttribute("contenteditable", "false");
			button.tabIndex = index === rovingLine ? 0 : -1;
			updateNarrationMarkerButton(button, narrationMarker, options.showNarrationLabel);
			decorations.push(
				Decoration.widget(pos + 1, button, {
					side: -1,
					key: `narration-${index}`,
				}),
			);
		}

		const _lineStart = pos + 1;
	}

	return DecorationSet.create(doc, decorations);
}

export function createDesktopGrammarDecorationExtension(options?: {
	instructorLabel?: string;
	showNarrationControls?: boolean;
	showNarrationLabel?: string;
	narrationMarkers?: Record<number, NarrationMarker>;
}) {
	const resolved: NarrationDecorationOptions = {
		instructorLabel: options?.instructorLabel?.trim() || "Instructor",
		showNarrationControls: options?.showNarrationControls === true,
		showNarrationLabel: options?.showNarrationLabel?.trim() || "Show narration for this block",
		narrationMarkers: options?.narrationMarkers ?? {},
	};
	return Extension.create({
		name: "desktopGrammarDecoration",
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: desktopGrammarDecorationPluginKey,
					state: {
						init: (_, state) => ({
							showNarrationControls: resolved.showNarrationControls,
							narrationMarkers: resolved.narrationMarkers,
							decorations: buildDesktopDecorations(state.doc, state.selection.from, resolved),
						}),
						apply: (transaction, pluginState, _oldState, newState) => {
							const toggle = transaction.getMeta(desktopGrammarDecorationPluginKey) as
								| { showNarrationControls: boolean }
								| { narrationMarkers: Record<number, NarrationMarker> }
								| undefined;
							let showNarrationControls = pluginState.showNarrationControls;
							let narrationMarkers = pluginState.narrationMarkers;
							if (toggle && "showNarrationControls" in toggle) {
								showNarrationControls = toggle.showNarrationControls;
							} else if (toggle && "narrationMarkers" in toggle) {
								narrationMarkers = toggle.narrationMarkers;
							}
							if (!transaction.docChanged && !toggle) return pluginState;
							return {
								showNarrationControls,
								narrationMarkers,
								decorations: buildDesktopDecorations(newState.doc, newState.selection.from, {
									...resolved,
									showNarrationControls,
									narrationMarkers,
								}),
							};
						},
					},
					props: {
						decorations: (state) =>
							desktopGrammarDecorationPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
						handleDOMEvents: {
							click(_view, event) {
								const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
									".praxity-narration-disclosure",
								);
								const lineNumber = Number(button?.dataset.narrationLine);
								if (!button || !Number.isInteger(lineNumber)) return false;
								window.dispatchEvent(
									new CustomEvent("praxity:narration-marker", { detail: { lineNumber } }),
								);
								return true;
							},
							keydown(view, event) {
								const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
									".praxity-narration-disclosure",
								);
								if (!button || !["ArrowUp", "ArrowDown"].includes(event.key)) {
									return false;
								}
								const buttons = Array.from(
									view.dom.querySelectorAll<HTMLButtonElement>(".praxity-narration-disclosure"),
								);
								const currentIndex = buttons.indexOf(button);
								if (currentIndex < 0) return false;
								const target =
									buttons[
										Math.max(
											0,
											Math.min(
												buttons.length - 1,
												currentIndex + (event.key === "ArrowDown" ? 1 : -1),
											),
										)
									];
								if (!target) return false;
								event.preventDefault();
								button.tabIndex = -1;
								target.tabIndex = 0;
								target.focus();
								return true;
							},
						},
					},
					view: () => {
						let activeLine = -2;
						let markers: Record<number, NarrationMarker> | undefined;
						return {
							update(nextView) {
								const state = desktopGrammarDecorationPluginKey.getState(nextView.state);
								const nextActiveLine = paragraphIndexAtPosition(
									nextView.state.doc,
									nextView.state.selection.from,
								);
								if (activeLine === nextActiveLine && markers === state?.narrationMarkers) return;
								activeLine = nextActiveLine;
								markers = state?.narrationMarkers;
								syncNarrationMarkerButtons(
									nextView,
									state?.narrationMarkers ?? {},
									resolved.showNarrationLabel,
								);
							},
						};
					},
				}),
			];
		},
	});
}

export function setDesktopNarrationControlsVisible(view: EditorView, visible: boolean): void {
	view.dispatch(
		view.state.tr.setMeta(desktopGrammarDecorationPluginKey, {
			showNarrationControls: visible,
		}),
	);
}

export function setDesktopNarrationMarkers(
	view: EditorView,
	narrationMarkers: Record<number, NarrationMarker>,
): void {
	const focusedLine = Number(
		(view.dom.ownerDocument.activeElement as HTMLElement | null)?.closest<HTMLButtonElement>(
			".praxity-narration-disclosure",
		)?.dataset.narrationLine,
	);
	view.dispatch(
		view.state.tr.setMeta(desktopGrammarDecorationPluginKey, {
			narrationMarkers,
		}),
	);
	if (Number.isInteger(focusedLine)) {
		view.dom
			.querySelector<HTMLButtonElement>(
				`.praxity-narration-disclosure[data-narration-line="${focusedLine}"]`,
			)
			?.focus({ preventScroll: true });
	}
}
