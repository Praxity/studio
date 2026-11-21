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
  .praxity-card-item, .praxity-stats-item )[data-entrance]`: Under `@media (prefers-reduced-motion:
  reduce)`, disable entrance transitions and delays with `transition: none !important` and
  `transition-delay: 0ms !important`. Apply the same disabling rule under
  `[data-praxity-root][data-praxity-reduced-motion]`. This also overrides the viewer-wide
  `transition-duration: 0s !important` rule in `packages/shared-blocks/src/viewer/viewer-shell.css`,
  whose selectors are `[data-praxity-root][data-praxity-reduced-motion="true"] *`,
  `[data-praxity-root][data-praxity-reduced-motion="true"] *::before` and
  `[data-praxity-root][data-praxity-reduced-motion="true"] *::after`. Reduced motion does not permit
  an authored entrance duration.

  Evidence: The two entrance selectors in `packages/shared-blocks/src/blocks/shared-blocks.css` set
  both declarations. `packages/shared-blocks/src/motion.test.ts`, "bails out visibly for OS and
  learner reduced-motion preferences", checks initialization;
  `packages/export-pipeline/tests/a11y/design-layout-motion.spec.ts`, `${mode} entrance modes
  respect ${reducedMotion}`, checks browser paint and transition behavior.

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

  Evidence: [WebKit Features in Safari 17.0,
  Hyphenation](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/#hyphenation) dates
  unprefixed hyphens support to Safari 17 and records prefixed support since 2011.

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

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `.praxity-chart-visual .praxity-chart-mark`: Bars and legend swatches keep a same-hue edge: it
  holds 3:1 for pale fills without a text-coloured outline on every bar. The SVG stroke attribute
  remains for print, which drops it where the fill already contrasts with paper.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `.praxity-assessment-choice-option` and `.praxity-ag-radio-row`: Keep option-row borders
  transparent at rest. The question and page already supply boundaries, and the radio supplies the
  selection affordance. Preserve the full-width hit target and border space so hover and selection
  do not shift text.

- `.praxity-assessment-choice-option` and `.praxity-ag-radio-row`: Keep native labels and controls
  stationary during a press. Rejected: scale(0.99), even after a test's paint wait or centered
  target. WebKit moved pointer-up from label to input and clicked their shared div, losing native
  activation. Color and focus feedback keep targets stationary.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `.praxity-page-content .praxity-assessment-choice-option input:focus-visible,
  .praxity-assessment-choice-option input[type="radio"]:focus, .praxity-ag-radio-row
  input[type="radio"]:focus`: The row owns focus. Native radio arrows can clear WebKit's
  focus-visible heuristic, so keep the row ring on :focus and suppress only its inner ring.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

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

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `.praxity-slides-grid[data-transition="none"] .praxity-slides-item`: Authored "none" names no
  property, so the viewer's zero-duration reduced-motion policy cannot turn the visibility swap into
  a transition.

- `[data-praxity-root] .praxity-assessment-choice-option > input[type="radio"]`: Transparent native
  hit targets retain their circular shape in Chromium.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### `packages/shared-blocks/src/reading-rhythm.css`

- `--space-1` to `--space-24`: The spacing scale is in rem at its nominal 16px values, so block,
  section and gutter gaps keep their default size and grow with Larger text, which raises the root
  font size. Radii, focus widths, the 44px target size and shadows stay in px because their sizes
  have their own reasons. Root font policy is unchanged. The deck toolbar's block padding in
  `packages/shared-blocks/src/viewer/deck-shell.css` keeps a 4px floor around its focus-ring
  clearance instead of `--space-1`: the bar holds fixed 44px targets, and padding that grew with
  enlarged text took height from the transcript sheet at 320 by 720px.

  Evidence: `packages/export-pipeline/tests/a11y/spacing-rhythm.spec.ts` measures four gaps in an
  exported page at both text sizes.

- `@media (prefers-reduced-motion: reduce)`: Zero-duration animations keep their end keyframe.
  Removing the animation can expose its initial state when an authored reveal uses
  animation-fill-mode.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

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
