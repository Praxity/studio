# 0025: Export presentation and images

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- Prism inserts a newline placeholder for empty rows. The row itself supplies visual height; Copy must read only authored characters. Governed code: `packages/export-pipeline/src/code-highlighting.ts`, `highlightCode`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Nav defaults come from the archetype's preset, never from the export fallbacks. Merging sidebar defaults over the archetype meant every unset nav key reached the exporter already "set" to the sidebar answer, so a course whose only nav setting was `navArchetype: slides` published with navOutline on and navEdgeArrows / navHamburgerMenu / navSlideCounter off: the slides layout class with sidebar navigation, and no slide chrome at all. Explicit author toggles still win; they are spread last. Governed code: `packages/export-pipeline/src/desktop-design.ts`, `resolveDesignObject`.

- Mantine resolves semantic text to shade 6 in light mode and shade 4 in dark mode. Correct those roles only; changing all ten shades would turn decorative fills and tints into a high-contrast, visually flat palette. Governed code: `packages/export-pipeline/src/export-contrast.ts`, `enforceColorShadeTextContrast`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Assessment feedback puts semantic text on a pale tint of the same status color. Shade 0 is the generated palette's conservative approximation of that tint, and is harder than the plain surface. Governed code: `packages/export-pipeline/src/export-contrast.ts`, `enforceColorShadeTextContrast`.

- Some upstream families have no italic or intermediate weight. Governed code: `packages/export-pipeline/src/export-css.ts`, `desktopCssInputs`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Preserve the seed's historical shade index so existing Mantine role lookups move less. Governed code: `packages/export-pipeline/src/generate-color-shades.ts`, `generateColorShades`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- The term is written back out through escapeHtml, so it must arrive as plain text. Governed code: `packages/export-pipeline/src/glossary-page.ts`, `toPlainText`.

- Limit recursive entity decoding to three additional passes to bound work on malformed input. Governed code: `packages/export-pipeline/src/html-entities.ts`, `fullyDecodeEntities`.

- Apply today's limits to a cache left by an older process, even on a hit. Governed code: `packages/export-pipeline/src/image-result-cache.ts`, `optimize`.

- Undefined can mean a transient codec failure. Never persist that as a negative hit. Governed code: `packages/export-pipeline/src/image-result-cache.ts`, `optimize`.

- Windows can refuse replacement when an existing handle denies delete sharing; being open alone does not always prevent renaming. If the destination already contains a complete matching entry, retain that winner. Governed code: `packages/export-pipeline/src/image-result-cache.ts`, `optimize`.

  Evidence: [Microsoft CreateFileW, dwShareMode and FILE_SHARE_DELETE](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew#parameters) documents delete sharing and explains that delete access includes rename operations. `packages/export-pipeline/src/__tests__/image-result-cache.test.ts`, "concurrent cache instances install complete identical entries", pins the winning-entry policy; it does not force a Windows sharing violation.

- Cache failures are reported, but never discard a successful derivative. Governed code: `packages/export-pipeline/src/image-result-cache.ts`, `optimize`.

- Count abandoned atomic-write stages too. Evicting a competing stage only loses cache work; its caller still receives the encoded result. Governed code: `packages/export-pipeline/src/image-result-cache.ts`, `evict`.

- Bump the `pipeline-1` component of `IMAGE_ENCODER_VERSION` when decoding, eligibility or resizing changes. This invalidates derivatives produced by the previous pipeline. `IMAGE_ENCODER_OPTIONS` contains the separate dimension and quality settings. Governed code: `packages/export-pipeline/src/optimize-image.ts`, `IMAGE_ENCODER_VERSION`; `packages/export-pipeline/src/image-result-cache.ts`, `ImageResultCache.constructor` and `ImageResultCache.optimize`, which include the version and options separately in the cache key.

  Evidence: `packages/export-pipeline/src/__tests__/image-result-cache.test.ts`, "source bytes, encoder options and version each change the key" and "the version binds the pinned codecs and resize dependency".

- Keep animation and color/orientation metadata the WebP encoder drops. Governed code: `packages/export-pipeline/src/optimize-image.ts`, `pngSource`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Decks keep navigation's no-JS class off. Successful highlight attachment owns the visibility of its controls independently of that navigation class. Governed code: `packages/export-pipeline/src/patterns/highlight/style.css`, `.praxity-highlight[data-highlight-enhanced] [data-praxity-js-control]`.

- Native hidden state wins over button and feedback display rules. Governed code: `packages/export-pipeline/src/patterns/highlight/style.css`, `.praxity-highlight [hidden]`.

- Closed native details use an internal content-visibility boundary in Chromium. Governed code: `packages/export-pipeline/src/patterns/retrieval-sheet/style.css`, `html[data-praxity-retrieval-print] details[data-praxity-print-path]::details-content`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Published series already use contrasting palette inks; a second dark edge would turn those marks into text-coloured outlines. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `[data-praxity-root] .praxity-chart-visual .praxity-chart-mark`.

- Remove the opening and closing block margins inside containers. They have no neighbouring block to separate and otherwise add empty space inside columns, cards, tab panels and callouts. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-block-slot:first-child > .praxity-block[data-block-type], :not(.praxity-block-slot) > .praxity-block[data-block-type]:first-child`.

- Marker: underline-fill style; 25% accent creates visible highlight while maintaining Lc 60+ text contrast on both light and dark backgrounds. OKLCH mixing preserves hue fidelity across accent colors. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `[data-praxity-root][data-praxity-highlight-style="marker"] .praxity-block mark`.

- Non-tabbable main content receives programmatic focus on page load for screen readers. Preserve the focus indicator on keyboard-scrollable main content. Some browsers (Safari) match :focus-visible on programmatic .focus() calls, so suppress both pseudo-classes here. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `#main-content[tabindex="-1"], #main-content[tabindex="-1"]:focus, #main-content[tabindex="-1"]:focus-visible`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Suppress Mantine's focus-on-click outline; it uses :focus (fires on mouse click) instead of :focus-visible (keyboard only). The stylesheet's :focus-visible rule handles keyboard focus. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.mantine-focus-always:focus:not(:focus-visible)`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Submission focuses these targets to announce feedback. They are outside the tab order and must not acquire the browser's default focus box. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `[data-assessment-feedback]:focus, [data-row-summary]:focus`.

- One themed outline survives forced-colors. Programmatic feedback targets announce their content without drawing another box inside the activity. Keep this contract with viewer-shell.css. Scoped to interactive elements to prevent non-interactive wrappers (nav, div, main) from showing focus rings when they receive programmatic or click-through focus. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-page-content :is(input, select, textarea):focus-visible, a:focus-visible, button:focus-visible, summary:focus-visible, audio:focus-visible, video:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [role="button"]:focus-visible, [role="tab"]:focus-visible, [role="slider"]:focus-visible, [tabindex]:not([tabindex="-1"]):focus-visible`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- LMS resume cue: a quiet visible first line, either inside the focused heading or as a focusable summary before it. It uses the course's meta text size (as in the sidebar's page count), so it reads as orientation rather than as a second title. Muted text keeps the resolver's 4.5:1 floor; rem sizing follows the Larger text preference. The prefix inherits from the heading, so reset the heading's display tracking, which is too tight at body sizes. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `:is(h1, h2) > .praxity-resume-prefix:first-child, .praxity-resume-summary`.

- viewer-shell.css hides the ring on programmatically focused headings. The resume cue is the reason for that focus, so show it. The :has() argument lifts specificity above the suppression rule and above the deck's inset high-contrast offset, which would draw the ring through the heading's glyphs. The wider offset keeps the square ring, like the course's other focus rings, clear of the text, so it reads as focus rather than as a text field. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `:is(h1, h2)[tabindex]:has(> .praxity-resume-prefix:first-child):focus, p.praxity-resume-summary[tabindex]:focus`.

- A slide layout centres .praxity-slide and pads it, so a summary inserted before it would float above the slide, offset from its text. Match the slide's content box and keep the two centred as one group. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-resume-summary:has(+ .praxity-slide)`.

- Guided pads the outer stage and leaves its inner slide unpadded. Match that inner width rather than subtracting the former slide gutters a second time. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-deck[data-ready="true"] .deck-slide > .praxity-resume-summary:has(+ .praxity-slide)`.

- Pages slides keep their top padding (Guided removes it and pads the slide frame). Draw the summary down inside that padding, so a tall slide that scrolls does not push it against the top controls. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `main > .praxity-resume-summary:has(+ .praxity-slide)`.

- Button & document blocks; use theme colors instead of Mantine default blue. Mantine sets --button-bg/--button-color/etc. as inline styles on `<button>`, so !important is required to override them from a stylesheet. --praxity-color-button-outline is auto-computed: equals button-text when button-bg is light (e.g. Praxity lime), equals button-bg when it's dark (e.g. Slate blue). BlockRenderer wraps in div[data-block-type], separate from outer .praxity-block. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-button`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Divider; round endpoints. border-radius on the border itself rounds the line caps; overflow:hidden is intentionally omitted because it causes diagonal rendering artifacts on dotted/dashed borders. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-block[data-block-type="divider"] .mantine-Divider-root`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Tabs; theme-colored active indicator and text (all variants). Mantine sets --tabs-color as an inline style, so !important is required. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.mantine-Tabs-root`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Accordion; remove Mantine's gray hover/active background on controls. Mantine sets a persistent gray background via --_control-hover that remains visible after collapse/expand, creating a distracting flash. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.mantine-Accordion-control`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Stack columns. Row gap carries the separation between what are now sequential sections; the 12px inline gap would read as one run of text. Governed code: `packages/export-pipeline/template/src/styles/global.css`, `.praxity-columns`.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
