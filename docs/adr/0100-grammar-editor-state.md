# Grammar editor state and keyboard behaviour

## Status

Accepted. Existing behaviour recorded during comment removal.

## Context

Editor source, native selection and collaborative state have different lifetimes. Recreating one to refresh another can lose text, caret state or collaboration history.

## Decision

- `packages/editor-core/src/PraxityEditor.tsx`, `PraxityEditorProps.onCursorChange`, and `packages/editor-core/src/components/grammar-document-store.ts`, `GrammarCursorLocation`: The public cursor callback uses one-based lines and columns. The stored cursor location uses a zero-based paragraph index, a column offset, a zero-based occurrence of its enclosing keyword and normalized scroll progress from zero to one. Keep these coordinate conventions when translating between the editor and its host.

- `packages/editor-core/src/PraxityEditor.tsx`, `PraxityEditor`: Seed Y.Doc once per mount. Keep `initialGrammar` out of the memo dependency list because the parent updates it on every keystroke through `onGrammarChange`; recreating the document would wipe collaboration state and reset the editor.
- `packages/editor-core/src/PraxityEditor.tsx`, `PraxityEditor`: The parsed-design selector triggers the effect, but the effect must reread the store because the initial parse can update it before mount effects finish.
- `packages/editor-core/src/PraxityEditor.tsx`, `PraxityEditor`: Recovery is for rendering; unrelated edits retain the author's saved numbers.
- `packages/editor-core/src/components/LiveRegion.tsx`, `next`: Keep a queued result present before clearing for the next one. Each entry keeps its own language, urgency and focus delay.
- `packages/editor-core/src/components/design-variants-sync.ts`, `toStableDesignJson`: Build the stable design-sync key from normalized variants and diagnostic recovery fields. Raw rejected YAML values may contain alias cycles and must not enter recursive serialization.
- `packages/editor-core/src/components/extensions/auto-surround-extension.ts`, `surroundSelection`: Insert closing first (at `to`), then opening (at `from`). This order avoids position shift for the second insert. Uses insertText instead of replaceWith/schema.text to safely handle selections spanning paragraph boundaries.
- `packages/editor-core/src/components/extensions/delimiter-matching-plugin.ts`, `toggle`: The widget key carries the folded state, so this dispatch replaces the button rather than reusing it, which is what keeps `aria-expanded` honest no matter which path did the folding. Replacing it also drops focus, so hand it back to the new node.
- `packages/editor-core/src/components/extensions/delimiter-matching-plugin.ts`, `buildDecorations`: mousedown only cancels the selection change, so clicking a caret still does not pull focus out of the editor; the toggle runs on click.
- `packages/editor-core/src/components/extensions/delimiter-matching-plugin.ts`, `buildDecorations`: The fold caret sits inside contenteditable. Handle Enter and Space on the caret before ProseMirror's keymap can turn Enter into a document edit.
- `packages/editor-core/src/components/extensions/delimiter-matching-plugin.ts`, `buildDecorations`: The key has to carry everything `toDOM` renders. Keyed widgets are compared by key alone, so a key of position only meant the button was reused across a fold and kept its draw-time `aria-expanded`, and could even be handed to a different block that moved onto the position.
- `packages/editor-core/src/components/extensions/grammar-highlight-extension.ts`, `buildHighlightDecorations`: Same wiring as the fold caret in delimiter-matching-plugin: the widget key carries the folded state so the button is redrawn rather than reused (which had frozen `aria-expanded` at its draw-time value), mousedown only cancels the selection change, and Enter/Space are handled here because ProseMirror's keymap would take them first.
- `packages/editor-core/src/components/extensions/grammar-highlight-extension.ts`, `buildHighlightDecorations`: Keyed widgets are compared by key alone, so the folded state has to be in the key or the button is reused and keeps its draw-time ARIA.
- `packages/editor-core/src/components/extensions/mac-cursor-nav-extension.ts`, `MacCursorNavExtension`: On macOS, Cmd+Up/Down should move the cursor to the start/end of the document. Without this extension, the native scroll-to-top/bottom behavior fires instead because no ProseMirror keymap handler claims the shortcut.
- `packages/editor-core/src/components/extensions/search-highlight-extension.ts`, `setSearchIndex`: After decorations render, scroll the current-match element into view. Uses requestAnimationFrame so the decoration DOM is applied before querying.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `extractText`: Keep the empty final paragraph that represents the author's final newline.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `GrammarRawEditor`: One-shot: skip the selection report caused by applying loaded content, so the author isn't jumped to the last slide on open (setContent lands the cursor at the end of the doc).
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `attributes`: Syntax-bearing editor: browser spellcheck red-underlines asset filenames and grammar keys, and a red squiggle already means "syntax error" here. Turn it off.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `handleKeyDown`: A deliberate key press supersedes the short focus-restoration guard installed by page navigation. Never send typing back to that page.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `onFocus`: Keyboard entry needs the document selection as well as DOM focus. A freshly mounted browser editor can otherwise receive keys without a caret.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `onSelectionUpdate`: Skip the one selection-update produced by loading content (cursor lands at doc end) so open doesn't jump to the last slide.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `handleScrollToLine`: Reveal a panel-selected line one third down the viewport and highlight it. ProseMirror's minimum-distance `scrollIntoView` can leave the line at the viewport edge without enough context.
- `packages/editor-core/src/components/grammar-raw-editor.tsx`, `GrammarRawEditor`: `data-raw-theme` used to gate the whole raw syntax palette off Mantine's computed colour scheme, which does not track the theme chosen in Settings, so the light palette rendered on dark editors at 1.5-1.9:1. The palette now cascades from the desktop theme tokens on documentElement; this attribute is retained only as a styling hook and no longer selects colours.
- `packages/editor-core/src/components/toolbar-keyboard-nav.ts`, `announceToScreenReader`: Clear and re-set to trigger announcement even with same text
- `packages/editor-core/src/lib/media/optimize-image.ts`, `optimizeImage`: Resize an image to max 1920px on longest edge and convert to WebP. Falls back to JPEG if WebP encoding is not supported (pre-2020 Safari). Skips resize if image is already smaller than max dimension. Uses createImageBitmap() for decoding, modern browsers apply EXIF rotation automatically, so the output respects the original orientation.
- `packages/editor-core/src/lib/media/optimize-image.ts`, `optimizeImage`: Verify browser actually produced WebP (some return empty blob)
- `packages/editor-core/src/lib/reveal-in-container.ts`, `REVEAL_RATIO` and `revealOffsetInContainer`: Leave a comfortably visible target in place. Otherwise reveal it one third down the viewport to retain the heading or other context above it and working space below. The original comment cites VS Code's `revealRangeInCenterIfOutsideViewport` and GitHub line anchors as design precedents.
- `packages/editor-core/src/lib/reveal-in-container.ts`, `flashReveal`: Highlight the revealed target so the reader can find it. Reduced motion retains the highlight and removes its fade.
- `packages/editor-core/src/stores/grammar-document-store.ts`, `module initialization`: Re-export the single canonical store instance from components/. Previously this file duplicated the store definition, creating a separate Zustand instance that was never populated, causing empty parsedBlocks in the desktop app's PageNavigator.

## Consequences

Preserve these constraints when changing this area. Sources are the named symbols and their explanatory comments at commit bed54f6, before this comment-only change. The [architecture guide](../context/architecture.md) describes ownership. Existing tests remain the behavioural gate; this record adds no new behaviour.
