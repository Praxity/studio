"use client";

import type { BlockSpan, DesignVariants, GrammarFrontmatter } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { create } from "zustand";
import { DEFAULT_DESIGN_VARIANTS } from "../lib/themes/design-variant-defaults";
import {
	type DesignNumberDiagnostic,
	getDesignNumberDiagnostics,
	normalizeDesignVariants,
} from "../lib/themes/normalize-design-variants";

export interface GrammarCursorLocation {
	/** Line number in raw grammar source (0-based paragraph index). */
	grammarLine: number;
	/** Column offset within the line. */
	grammarColumn: number;
	/** Enclosing block keyword when known from an `as:` declaration. */
	enclosingKeyword: string | null;
	/** Nth occurrence of enclosingKeyword in the source (0-based). */
	keywordOccurrenceIndex: number;
	/** Scroll progress as a normalized fraction [0..1]. */
	scrollFraction: number;
}

interface GrammarDocumentState {
	courseId: string;
	grammarSource: string;
	parsedBlocks: PraxityBlock[];
	parsedSpans: ReadonlyMap<string, BlockSpan>;
	frontmatter: GrammarFrontmatter;
	designVariants: DesignVariants;
	designNumberDiagnostics: DesignNumberDiagnostic[];
	parseError: string | null;
	cursorLocation: GrammarCursorLocation | null;
	/** When true, a local design change is pending sync to Y.Text.
	 *  setParsedResult will preserve the local designVariants until cleared. */
	_designDirty: boolean;

	setGrammarSource: (source: string) => void;
	setParsedResult: (
		blocks: PraxityBlock[],
		frontmatter: GrammarFrontmatter,
		spans?: ReadonlyMap<string, BlockSpan>,
	) => void;
	setDesignVariants: (variants: DesignVariants) => void;
	updateDesignVariants: (partial: Partial<DesignVariants>) => void;
	clearDesignDirty: () => void;
	setParseError: (error: string | null) => void;
	setCourseId: (id: string) => void;
	setCursorLocation: (location: GrammarCursorLocation | null) => void;
}

// ── Custom event names shared across editor components ──
export const CURSOR_LOCATION_CHANGED_EVENT = "praxity:editor-cursor-location-changed";
export const SCROLL_TO_PREVIEW_BLOCK_EVENT = "praxity:scroll-to-preview-block";

// ── Shared editor helpers ──
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function getScrollFraction(container: HTMLElement | null): number {
	if (!container) return 0;
	const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
	if (maxScroll === 0) return 0;
	return clamp(container.scrollTop / maxScroll, 0, 1);
}

function blocksEqual(prev: PraxityBlock, next: PraxityBlock): boolean {
	if (prev.type !== next.type) return false;
	return JSON.stringify(prev.data) === JSON.stringify(next.data);
}

function reconcileBlocks(prev: PraxityBlock[], next: PraxityBlock[]): PraxityBlock[] {
	if (prev.length === 0) {
		return next;
	}

	let allSame = prev.length === next.length;
	const reconciled = next.map((block, index) => {
		const prevBlock = prev[index];
		if (prevBlock && blocksEqual(prevBlock, block)) {
			return prevBlock;
		}
		allSame = false;
		return block;
	});

	if (allSame) {
		return prev;
	}
	return reconciled;
}

function reconcileDesignVariants(prev: DesignVariants, next: DesignVariants): DesignVariants {
	return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

export const useGrammarDocumentStore = create<GrammarDocumentState>((set) => ({
	courseId: "",
	grammarSource: "",
	parsedBlocks: [],
	parsedSpans: new Map(),
	frontmatter: {},
	designVariants: DEFAULT_DESIGN_VARIANTS,
	designNumberDiagnostics: [],
	parseError: null,
	cursorLocation: null,
	_designDirty: false,

	setGrammarSource: (source) => set({ grammarSource: source }),
	setParsedResult: (blocks, frontmatter, spans = new Map()) =>
		set((state) => {
			const nextDesignVariants = normalizeDesignVariants(frontmatter.design);
			return {
				parsedBlocks: reconcileBlocks(state.parsedBlocks, blocks),
				parsedSpans: spans,
				frontmatter,
				designNumberDiagnostics: state._designDirty
					? state.designNumberDiagnostics
					: getDesignNumberDiagnostics(frontmatter.design),
				designVariants: state._designDirty
					? state.designVariants
					: reconcileDesignVariants(state.designVariants, nextDesignVariants),
				parseError: null,
			};
		}),
	setDesignVariants: (variants) =>
		set({
			designVariants: variants,
			designNumberDiagnostics: getDesignNumberDiagnostics(variants),
			_designDirty: true,
		}),
	updateDesignVariants: (partial) =>
		set((state) => ({
			designVariants: { ...state.designVariants, ...partial },
			designNumberDiagnostics: state.designNumberDiagnostics.filter(
				({ key }) => !Object.hasOwn(partial, key),
			),
			_designDirty: true,
		})),
	clearDesignDirty: () => set({ _designDirty: false }),
	setParseError: (error) => set({ parseError: error }),
	setCourseId: (id) => set({ courseId: id }),
	setCursorLocation: (location) => set({ cursorLocation: location }),
}));
