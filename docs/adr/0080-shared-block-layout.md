# 0080: Shared block layout and reading motion

## Status

Accepted. Records existing behavior; no executable change.

## Context

Block CSS must preserve reading order, native activation and readable review states.

## Decision

### `packages/shared-blocks/src/blocks/shared-blocks.css`

- `[data-praxity-root] .praxity-columns`: Stacked, the columns become sequential sections, so the
  row gap has to carry the separation a heading's own top margin used to fake. The former 12px gap
  made adjacent sections read as one continuous run of text.

- `[data-praxity-root][data-praxity-motion-entrance] :is( .praxity-block, .praxity-sequence-item,
  .praxity-card-item, .praxity-stats-item )[data-entrance]`: Override the viewer's universal
  reduced-motion duration as well.

- `[data-praxity-root]:not([data-praxity-motion-entrance]) .praxity-block[data-entrance],
  [data-praxity-root][data-praxity-motion-entrance="none"] .praxity-block[data-entrance]`: Stale
  entrance states must not hide content when entrance motion is off. Active modes use the pending
  and visible entrance-state rules and finish at full opacity, unless the learner has explicitly
  enabled the reading guide.

- `[data-praxity-root][data-praxity-text-size="large"] .praxity-block :is(h1, h2)`: Enlarged titles
  need a shorter measure: balancing a full phone line can strand a short first line when the next
  word cannot fit beside it.

- `[data-praxity-root] :is(h1, h2, h3, h4, h5, h6)`: Use language-aware manual hyphenation and
  overflow-wrap for headings rather than inherited word-break: break-word. Large type can exceed a
  320px line; words that fit must remain whole.

- `[data-praxity-root] :is(h1, h2, h3, h4, h5, h6)`: Retain -webkit-hyphens for Safari before 17,
  which reads only the prefixed hyphenation property.

- `[data-praxity-root] :is(h1, h2, h3, h4, h5, h6) :is(code, kbd, samp)`: An inserted hyphen would
  change code that learners read or copy.

- `:is( [data-block-type]:not([data-block-type="heading"]), .praxity-float-region,
  .praxity-assessment-group-submit ) + [data-block-type="heading"][data-heading-level="1"]`: Heading
  rules come last so they override heavy-block rules.

- `[data-praxity-root][data-praxity-highlight-style="marker"] .praxity-block mark`: Use a 25% accent
  mix for marker highlights, with OKLCH mixing to retain hue across accents. The original design
  targeted readable text in both light and dark palettes; preserve that contrast when changing the
  mix.

- `[data-mantine-color-scheme="dark"] [data-praxity-highlight-style="marker"] .praxity-block mark`:
  Dark mode (editor preview): data-mantine-color-scheme is on an ancestor element,
  data-praxity-highlight-style is on [data-praxity-root]. Use a descendant selector rather than a
  compound selector on the same element.

- `fieldset > legend:not(.praxity-sr-only)`: Floated legends keep native group names without cutting
  the activity border.

- `.praxity-card-controls`: Keep the control label at least 13px, one pixel above the 12px minimum:
  transformed faces can land on fractional device pixels in Firefox.

- `.praxity-chart-visual .praxity-chart-mark`: Bars and legend swatches keep a same-hue edge: it
  holds 3:1 for pale fills without a text-coloured outline on every bar. The SVG stroke attribute
  remains for print, which drops it where the fill already contrasts with paper.

- `.praxity-assessment-choice-option` and `.praxity-ag-radio-row`: Keep option-row borders
  transparent at rest. The question and page already supply boundaries, and the radio supplies the
  selection affordance. Preserve the full-width hit target and border space so hover and selection
  do not shift text.

- `.praxity-assessment-choice-option` and `.praxity-ag-radio-row`: Keep native labels and controls
  stationary during a press. Rejected: scale(0.99), even after a test's paint wait or centered
  target. WebKit moved pointer-up from label to input and clicked their shared div, losing native
  activation. Color and focus feedback keep targets stationary.

- `.praxity-page-content .praxity-assessment-choice-option input:focus-visible,
  .praxity-assessment-choice-option input[type="radio"]:focus, .praxity-ag-radio-row
  input[type="radio"]:focus`: The row owns focus. Native radio arrows can clear WebKit's
  focus-visible heuristic, so keep the row ring on :focus and suppress only its inner ring.

- `.praxity-assessment-choice-option:has(input:disabled),
  .praxity-ag-radio-row:has(input:disabled)`: Keep submitted option text at reading contrast even
  when its controls are disabled. Learners still need the answers to understand the feedback;
  applying disabled opacity to the whole row made that text harder to read.

- `.praxity-layout-slides .praxity-hero-cover`: In slides mode the slide is already a
  measure-constrained, centered box with its own overflow clipping. The 100vw full-bleed breakout
  gets clipped by the slide and mis-aligns the (white) content overlay to the viewport edge, cutting
  off the start of the title. Fit the hero to the slide box instead.

- `.praxity-matching-grid`: Pair matching prompts and selects through adjacent grid columns. Do not
  restore the short dashed leader: it spanned no meaningful distance and became punctuation-like
  under prefers-contrast: more.

- `[data-praxity-root] *`: Automatic hyphenation splits words that fit a fresh line at zoom widths.

- `.praxity-tabs-measure-label`: Reserve the selected weight on every label so activation cannot
  trigger reflow.

- `.praxity-rating-options:has(> .praxity-rating-numeric:nth-of-type(10):last-child),
  .praxity-rating-options:has(> .praxity-rating-numeric:nth-of-type(11):last-child)`: Round down so
  Gecko's subpixel gap rounding cannot force an early wrap.

- `.praxity-slides-grid[data-transition="none"] .praxity-slides-item`: Authored "none" names no
  property, so the reduced-motion 0.01ms duration policy cannot turn the visibility swap into a
  transition.

- `[data-praxity-root] .praxity-assessment-choice-option > input[type="radio"]`: Transparent native
  hit targets retain their circular shape in Chromium.

### `packages/shared-blocks/src/reading-rhythm.css`

- `@media (prefers-reduced-motion: reduce)`: Zero-duration animations keep their end keyframe.
  Removing the animation can expose its initial state when an authored reveal uses
  animation-fill-mode.

- `@container praxity-stage (max-width: 767px)`: A laptop viewport can contain a phone-sized
  authoring preview.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
