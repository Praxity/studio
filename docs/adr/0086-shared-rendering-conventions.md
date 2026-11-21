# 0086: Shared rendering conventions

## Status

Accepted. Records existing behavior; no executable change.

## Context

Renderers share identity, spacing, contrast and text conventions across preview and export.

## Decision

### `packages/shared-blocks/src/chart-svg.ts`

- `chartLegend`: Each row is one text run anchored at the centre, so the browser or PDF renderer
  places the real glyphs in any font: entries cannot collide and the row stays centred. A rect
  swatch would need the text measured first, so the swatch is a bullet in the same run. The bullet
  is in every bundled font's Latin set; Typst sets a whole run in a fallback font when one glyph is
  missing, which a square such as U+25A0 triggers.

- `renderCartesianChartSvg`: Label extents are estimated at the 16-unit base size, since SVG text
  cannot be measured here.

### `packages/shared-blocks/src/child-records.ts`

- `ChildRecord`: A reference into renderer data, including fields such as matchId and itemIds. IDs
  stay unknown until boundary validation, because persisted data is untrusted.

- `visit`: An empty, unauthored back has no record. A supplied backId also denotes an authored empty
  face; populated back content always requires it.

### `packages/shared-blocks/src/color-math.ts`

- `ensureContrast`: Return the closest WCAG-safe version of a foreground by moving only OKLCH
  lightness. Both directions are considered because a mid-tone background can make the direction
  implied by the starting luminance impossible. Black/white are a last-resort gamut fallback.

### `packages/shared-blocks/src/content-density.ts`

- `countWordsInHtml`: Replace tags with spaces to avoid merging adjacent text nodes.

### `packages/shared-blocks/src/i18n/strings.ts`

- `en.scormResumePositionPrefix` and `en.deckResumePositionPrefix`: The resume prefix is its own
  line inside the heading. Layout drops a trailing ordinary space there, and NVDA then reads
  "6:Build"; a non-breaking space survives.

- `fr`: French puts a non-breaking space before a colon; the cue's colon must not wrap alone.

### `packages/shared-blocks/src/lib/external-link-utils.tsx`

- `externalLinkIndicatorHtml`: Insert the generated new-tab indicator only after sanitizeHtml has
  admitted the link's authored content. Provide both the visual icon and screen-reader text so
  learners can know that activation opens another tab; the original rule cites W3C technique G201.

### `packages/shared-blocks/src/lib/file-link-utils.ts`

- `annotateFileLinks`: Run file-link annotation only on sanitized HTML. Add the file type when the
  link text does not already name it, so a screen-reader user navigating by links can identify the
  download before activation. The original rule cites WCAG 2.1 SC 1.4.1 and 2.4.4.

### `packages/shared-blocks/src/math/render-math.ts`

- `html`: Native MathML paints once without requiring the KaTeX HTML stylesheet.

- `renderMath`: Wrap with aria-label so screen readers that don't parse MathML still get a readable
  string. Keep authored source readable if rendering fails, in every course language.

- `renderMathSpeech`: Generate a human-readable speech string from LaTeX using KaTeX's a11y contrib.
  Returns null if generation fails (invalid LaTeX, etc.). The caller falls back to MathML only.

### `packages/shared-blocks/src/section-gap.ts`

- `sectionGapScale`: Resolve design.sectionGap through sectionGapScale as a reading-scale
  multiplier. Normalize historical pixel values against the 48px default. Preview and export must
  share this owner: independent calculations previously produced different spacing for the same
  stored value.

- `sectionGapCssValue`: Keep reading-rhythm.css in the shared-blocks.css import chain.
  sectionGapCssValue depends on --praxity-space-section; without it the calc declaration is invalid
  and the browser drops it.

### `packages/shared-blocks/src/table-sizing.ts`

- `measure`: Layout widths ignore entrance/ancestor transforms. Allow for integer rounding.

### `packages/shared-blocks/src/themes/resolve-design-tokens.ts`

- `resolveDesignTokens`: Cap dark-mode syntax-role chroma below 0.12 to leave room for sRGB
  rounding; keep the source hue.

### `packages/shared-blocks/src/viewer/MantineIslandProvider.tsx`

- `MantineIslandProvider`: Semantic colors must always be registered: blocks use color="success"
  etc., and an unregistered name makes Mantine variants degenerate (white-on-light badge text,
  caught by axe). Shade 6+ is dark enough for AA text on shade 0.

### `packages/shared-blocks/src/viewer/completion-effects.ts`

- `createCompletionEffects`: Keep Continue controls focusable with aria-disabled and show one
  blocking reason inside the visible navigation band. A sibling reason became a body grid item;
  hiding the whole navigation removed it in minimal mode. CSS-only proxy reveal left the native
  hidden attribute in place. Navigation must read the engine gate independently of presentation.
  This records the decision dated 2026-10-01; the original comment reported browser checks in three
  engines and no live screen-reader speech check.

### `packages/shared-blocks/src/viewer/glossary-focus-return.ts`

- `rememberGlossaryFocusReturn`: Native new tabs do not consistently restore the originating link in
  Firefox.

- `onReturn`: Firefox can reset focus to BODY after the window's return events.

### `packages/shared-blocks/src/viewer/inline-tooltips.ts`

- `hide`: Removing a focused popover fires focusout synchronously in Chromium. Clear ownership
  before removal so dismissal cannot re-enter and lose the trigger.

- `initInlineTooltips`: Click binds to each trigger, not to body: Chromium exposes an element with a
  click listener as clickable, and every descendant inherits that, so NVDA said "clickable" before
  ordinary course content. Keyboard and hover stay delegated.

### `packages/shared-blocks/src/viewer/navigate-page.ts`

- `pageHref`: Build published page links through pageHref and keep them relative when there is no
  base path. Root-absolute links resolve against the filesystem or site root for file exports and
  subdirectory hosting, where they can miss the exported page.

### `packages/shared-blocks/src/viewer/print-focus-return.ts`

- `capture`: Media entry and beforeprint can both arrive. Keep the first capture: Firefox blurs
  print-hidden controls to BODY between these events.

### `packages/shared-blocks/src/viewer/scroll-into-view.ts`

- `scrollElementIntoView`: Native smooth scrolling has no duration control; learner motion must stay
  under 300 ms.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
