# 0081: Learner shell layout and focus

## Status

Accepted. Records existing behavior; no executable change.

## Context

Published shells must fit their workspace and preserve focus without adding duplicate reading boundaries.

## Decision

### `packages/shared-blocks/src/viewer/viewer-shell.css`

- `[data-praxity-root][data-praxity-small-preview="true"] .praxity-layout-wrapper`: Content-only
  previews keep the canonical document. Main's siblings are shell chrome, regardless of resolved
  course/page navigation options. Hide wrappers too, and release their grid tracks; hiding only the
  sidebar leaves 260px empty. Keep authored navigation inside main. The desktop frame supplies
  `inert`.

- `html[data-praxity-root][data-praxity-preview-expand="true"] :is(body, .praxity-layout-wrapper,
  #main-content, .praxity-slide)`: One-page authoring previews measure natural content, not the
  iframe viewport. Otherwise expanding the iframe can keep expanding a viewport-sized slide.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `.praxity-outline-fallback[data-hydrated]`: Once the nav island owns this mount, CourseMenu
  supplies its own spacing and borders. Keeping the fallback padding made compact top bars narrower
  than the page and made the desktop sidebar overflow its 260px grid track.

- `#main-content:has(> .praxity-viewer-shell.praxity-layout-slides), #main-content:has(>
  .praxity-viewer-shell.praxity-layout-minimal)`: Remove reading-column padding from #main-content
  only when it directly owns a viewport-sized slides or minimal shell. That padding previously
  pushed the document below the viewport, added another scrollbar and hid narration controls.
  Preserve the static fallback's reading column.

- `.praxity-slide-counter`: Use --praxity-color-text-muted for the slide counter so it receives
  theme contrast correction. The old --praxity-text-muted name was undefined and fell back to a
  fixed #888.

- `#main-content[tabindex="-1"], #main-content[tabindex="-1"]:focus,
  #main-content[tabindex="-1"]:focus-visible, .praxity-page-content :is(h1, h2, h3, h4, h5,
  h6)[tabindex="-1"], .praxity-page-content :is(h1, h2, h3, h4, h5, h6)[tabindex="-1"]:focus,
  .praxity-page-content :is(h1, h2, h3, h4, h5, h6)[tabindex="-1"]:focus-visible`: Suppress outlines
  only on the named programmatic main and heading targets with tabindex=-1. A browser outline there
  framed the whole slide on arrival; Safari also applies focus-visible to programmatic focus.
  Interactive descendants must retain their keyboard focus rings.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `.praxity-page-content :is(input, select, textarea):focus-visible, a:focus-visible,
  button:focus-visible, .praxity-viewer-shell summary:focus-visible, .praxity-viewer-shell
  audio:focus-visible, .praxity-viewer-shell video:focus-visible, input:focus-visible,
  select:focus-visible, textarea:focus-visible, [role="button"]:focus-visible,
  [role="tab"]:focus-visible, [role="slider"]:focus-visible,
  [tabindex]:not([tabindex="-1"]):focus-visible`: Use one themed outline on interactive focus
  targets, including forced colors. Keep non-interactive wrappers and programmatic feedback targets
  outside this rule so announcements do not draw another box inside the activity.

- `:is([data-block-type="button"], [data-block-type="document"], [data-block-type="assessment"])
  .mantine-Button-root, .praxity-page-nav .mantine-Button-root`: Override Mantine's inline button
  variables with important declarations so button and document blocks use course theme colors. Keep
  --praxity-color-button-outline tied to course-surface contrast. The renderer's data-block-type
  wrapper is separate from its outer praxity-block.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `:is(html[data-praxity-root], .praxity-viewer-shell)`: Theme tokens are inline on this element;
  important is required for the preference to win.

- `@container course-shell (width < 240px)` and `.praxity-top-bar-fallback`: At phone-zoom widths
  the toolbar must reflow with the document. Keeping it sticky occludes response controls when a
  tall activity scrolls into view.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
