"use client";

import { MantineProvider } from "@mantine/core";
import {
	findFrontmatterEndOffset,
	parseFrontmatter,
	readLesson,
	serializeFrontmatter,
} from "@praxity/grammar";
import { GRAMMAR_YTEXT_FIELD } from "@praxity/shared-blocks/constants";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { useEffect, useMemo, useRef } from "react";
import { IntlProvider } from "use-intl";
import * as Y from "yjs";
import {
	getNormalizedDesignVariantsFromSource,
	toStableDesignJson,
} from "./components/design-variants-sync";
import type { NarrationMarker } from "./components/extensions/desktop-grammar-decoration-extension";
import { useGrammarDocumentStore } from "./components/grammar-document-store";
import { type EditorScrollHandle, GrammarRawEditor } from "./components/grammar-raw-editor";
import { CollaborationContext } from "./lib/collaboration/collaboration-context";
import { getDesignNumberDiagnostics } from "./lib/themes/normalize-design-variants";

import "./styles/editor.css";

import enMessages from "./messages/en.json";
import frMessages from "./messages/fr.json";

const MESSAGE_MAP: Record<string, Record<string, unknown>> = {
	en: enMessages as Record<string, unknown>,
	fr: frMessages as Record<string, unknown>,
};

export interface PraxityEditorProps {
	/** Initial grammar source text (frontmatter + content). */
	initialGrammar: string;

	/** Feature flags. Defaults to all-off for desktop v1. */

	/** UI locale. Defaults to "en". */
	locale?: string;

	/** Override i18n messages (e.g., for testing). */
	messages?: Record<string, unknown>;

	/** Called when grammar source changes. */
	onGrammarChange?: (grammar: string) => void;

	/** Optional controlled source for edits made outside the raw editor. */
	externalGrammar?: string;

	/** Called when cursor location changes (1-based line/column). */
	onCursorChange?: (line: number, column: number) => void;

	/** Called when parsed blocks update. */
	onBlocksChange?: (blocks: PraxityBlock[]) => void;

	/** Enable smart punctuation substitutions in the raw grammar editor. */
	smartPunctuation?: boolean;

	/** Enable focus mode dimming in the raw grammar editor. */
	focusMode?: boolean;

	/** Editor line length target in characters. Use 0 for unlimited width. */
	lineLength?: 72 | 80 | 100 | 120 | 0;

	/** Label for the instructor badge decoration. Defaults to "Instructor". */
	instructorBadgeLabel?: string;

	/** Show narration status markers beside narratable blocks. */
	showNarrationControls?: boolean;
	showNarrationLabel?: string;
	narrationMarkers?: Record<number, NarrationMarker>;
}

export function PraxityEditor({
	initialGrammar,
	locale = "en",
	messages,
	onGrammarChange,
	externalGrammar,
	onCursorChange,
	onBlocksChange,
	smartPunctuation = true,
	focusMode = false,
	lineLength = 100,
	instructorBadgeLabel,
	showNarrationControls = false,
	showNarrationLabel,
	narrationMarkers,
}: PraxityEditorProps) {
	const editorRef = useRef<EditorScrollHandle>(null);
	// Y.Doc is seeded once per mount.  `initialGrammar` is an *initial* value —
	// we must NOT list it as a dependency, because the parent updates the prop on
	// every keystroke (via onGrammarChange) and recreating the Y.Doc mid-session
	// would wipe collaboration state and reset the editor.
	// biome-ignore lint/correctness/useExhaustiveDependencies: seed value only — used once on mount
	const ydoc = useMemo(() => {
		const doc = new Y.Doc();
		const ytext = doc.getText(GRAMMAR_YTEXT_FIELD);
		if (initialGrammar.length > 0) {
			ytext.insert(0, initialGrammar);
		}
		return doc;
	}, []);
	const resolvedMessages = messages ?? MESSAGE_MAP[locale] ?? MESSAGE_MAP.en;

	const collabValue = useMemo(
		() => ({
			ydoc,
			isConnected: false,
			isSynced: true,
			status: "connected" as const,
			isOffline: false,
		}),
		[ydoc],
	);
	const setCourseId = useGrammarDocumentStore((state) => state.setCourseId);
	const setGrammarSource = useGrammarDocumentStore((state) => state.setGrammarSource);
	const setParsedResult = useGrammarDocumentStore((state) => state.setParsedResult);
	const setParseError = useGrammarDocumentStore((state) => state.setParseError);
	const cursorLocation = useGrammarDocumentStore((state) => state.cursorLocation);
	const designVariants = useGrammarDocumentStore((state) => state.designVariants);
	const lastSyncedDesignRef = useRef<string>("");

	useEffect(() => {
		setCourseId("local");
	}, [setCourseId]);

	useEffect(() => {
		const ytext = ydoc.getText(GRAMMAR_YTEXT_FIELD);
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		const doParse = (source: string) => {
			try {
				const parsed = readLesson(source);
				setParsedResult(parsed.blocks, parsed.frontmatter, parsed.spans);
				setParseError(
					parsed.errors.some(
						(error) => error.messageRef.key === "grammar.v4.invalid-course-metadata",
					)
						? "invalid-frontmatter"
						: null,
				);
				onBlocksChange?.(parsed.blocks);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setParseError(message);
			}
		};

		const handleGrammarTextChange = () => {
			const source = ytext.toString();
			setGrammarSource(source);
			onGrammarChange?.(source);

			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				doParse(source);
			}, 150);
		};

		const initialSource = ytext.toString();
		setGrammarSource(initialSource);
		onGrammarChange?.(initialSource);
		doParse(initialSource);
		ytext.observe(handleGrammarTextChange);

		return () => {
			ytext.unobserve(handleGrammarTextChange);
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	}, [ydoc, onBlocksChange, onGrammarChange, setGrammarSource, setParseError, setParsedResult]);

	useEffect(() => {
		if (externalGrammar === undefined) return;
		const ytext = ydoc.getText(GRAMMAR_YTEXT_FIELD);
		if (ytext.toString() === externalGrammar) return;
		ydoc.transact(() => {
			ytext.delete(0, ytext.length);
			ytext.insert(0, externalGrammar);
		}, "external-grammar-edit");
	}, [externalGrammar, ydoc]);

	useEffect(() => {
		if (!cursorLocation) return;
		onCursorChange?.(cursorLocation.grammarLine + 1, cursorLocation.grammarColumn + 1);
	}, [cursorLocation, onCursorChange]);

	useEffect(() => {
		// The selector above is the effect trigger; read again here because the
		// initial parse can update the store before mount effects finish.
		void designVariants;
		const store = useGrammarDocumentStore.getState();
		const variants = store.designVariants;
		const diagnostics = store.designNumberDiagnostics;
		const freshJson = toStableDesignJson(variants, diagnostics);
		if (freshJson === lastSyncedDesignRef.current) return;

		const ytext = ydoc.getText(GRAMMAR_YTEXT_FIELD);
		const currentText = ytext.toString();
		if (!currentText) return;

		const currentYTextDesign = getNormalizedDesignVariantsFromSource(currentText);
		const { frontmatter: existing, body, errorLine } = parseFrontmatter(currentText);
		if (errorLine !== undefined) return;
		if (
			toStableDesignJson(currentYTextDesign, getDesignNumberDiagnostics(existing.design)) ===
			freshJson
		) {
			lastSyncedDesignRef.current = freshJson;
			store.clearDesignDirty();
			return;
		}

		// Recovery is for rendering; unrelated edits retain the author's saved numbers.
		const design = {
			...variants,
			...Object.fromEntries(diagnostics.map(({ key, storedValue }) => [key, storedValue])),
		};
		const merged = { ...existing, design };
		const newText = serializeFrontmatter(merged, body);

		if (newText !== currentText) {
			const oldFmEnd = findFrontmatterEndOffset(currentText);
			const newFmEnd = findFrontmatterEndOffset(newText);
			const newFmSection = newText.slice(0, newFmEnd);

			ydoc.transact(() => {
				ytext.delete(0, oldFmEnd);
				if (newFmSection.length > 0) ytext.insert(0, newFmSection);
			}, "design-panel-sync");
		}

		lastSyncedDesignRef.current = freshJson;
		store.clearDesignDirty();
	}, [designVariants, ydoc]);

	useEffect(() => {
		return () => {
			ydoc.destroy();
		};
	}, [ydoc]);

	return (
		<IntlProvider locale={locale} messages={resolvedMessages}>
			<MantineProvider>
				<CollaborationContext.Provider value={collabValue}>
					<div
						data-testid="praxity-editor-root"
						style={{
							flex: 1,
							display: "flex",
							minHeight: 0,
							height: "100%",
							overflow: "hidden",
						}}
					>
						<GrammarRawEditor
							ref={editorRef}
							smartPunctuationEnabled={smartPunctuation}
							focusModeEnabled={focusMode}
							lineLength={lineLength}
							instructorBadgeLabel={instructorBadgeLabel}
							showNarrationControls={showNarrationControls}
							showNarrationLabel={showNarrationLabel}
							narrationMarkers={narrationMarkers}
						/>
					</div>
				</CollaborationContext.Provider>
			</MantineProvider>
		</IntlProvider>
	);
}
