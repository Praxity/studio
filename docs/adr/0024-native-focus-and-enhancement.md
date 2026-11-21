# 0024: Native focus and enhancement

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- Keep the pre-hydration choice shell disabled, with a `<noscript>` explanation; the React viewer replaces it and owns answering, submitting, feedback and scoring. Shipped enabled, it was a form a learner could fill in that could never be submitted; no submit control, no feedback, and the answers gone at the next page. A control that accepts input it cannot act on is worse than no control, so it stays inert until the code that can honour it arrives. Governed code: `packages/export-pipeline/src/patterns/choice/render.ts`, `renderChoice`.

- Guided decks resolve same-origin course links and transcript seek buttons in place. Chromium exposes any element with a click listener as clickable, and every passive descendant inherits that action, so NVDA said "clickable" before the main landmark while the deck delegated clicks from its root. Listeners therefore belong on the controls themselves, never on the deck, main, body or document. The deck installs the resolver; islands that render controls after it starts bind them at their own render point. Governed code: `packages/export-pipeline/template/src/components/deck-control-activation.ts`, `DECK_CONTROL_SELECTOR`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- One function identity lets addEventListener ignore repeated binding of a control. Governed code: `packages/export-pipeline/template/src/components/deck-control-activation.ts`, `activateBoundControl`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- React replaces its rendered links on every update and gives no per-node render callback. React already listens for clicks on its root container, so resolving deck controls there adds no clickable exposure. Use this only on React roots. Governed code: `packages/export-pipeline/template/src/components/deck-control-activation.ts`, `delegateDeckControls`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Remove the document's cue on departure so browser history cannot restore a stale "Resumed" prefix from its back/forward cache. Governed code: `packages/export-pipeline/template/src/components/scorm-resume-focus.ts`, `focusScormResumePage`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Loaded by the shell only after the host confirms a Pages return. Keep this a classic bundle so it has the shell's same LMS and local-file loading rules. Governed code: `packages/export-pipeline/template/src/course-resume.ts`, `module initialization`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- [hidden] means authored concealment to the required-activity gate. A collapsed disclosure still contains eligible activities, as native details did. Governed code: `packages/export-pipeline/template/src/disclosure.ts`, `enhanceDisclosure`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Delayed enhancement must not interrupt a learner already using fallback content. Governed code: `packages/export-pipeline/template/src/disclosure.ts`, `enhanceDisclosure`.

- Firefox may not expose the navigation entry before load. Its legacy timing object already distinguishes reload and history traversal before tracking. Governed code: `packages/export-pipeline/template/src/hosts/course-host.ts`, `isFreshResumeEntry`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Entry stays "resume" throughout a SCO session. Internal navigation and explicit deck fragments keep their own arrival policy. Governed code: `packages/export-pipeline/template/src/hosts/course-host.ts`, `handleCourseResume`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Existing islands restore their state once, at runtime-ready. Hold that event until the loaded provider has flushed; otherwise mixed courses would initialize ordinary blocks from an empty buffer. Governed code: `packages/export-pipeline/template/src/hosts/privacy-bootstrap.ts`, `__praxityPrivacyReady`.

- Observe the existing store's identity admission, without a second identity lookup that could mint an attempt early or consume its new-attempt cleanup. Governed code: `packages/export-pipeline/template/src/hosts/private-choice-bootstrap.ts`, `createPrivateChoiceProvider`.

- Native hrefs carry explicit arrival through middle activation and browser menus too. Arrival consumes the marker before the course becomes ready. Governed code: `packages/export-pipeline/template/src/hosts/standalone.ts`, `initializeStandaloneHost`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- The baseline already owns one empty live region and localized failure copy. A rejected chunk cannot import its enhancer to report the failure. Governed code: `packages/export-pipeline/template/src/island-bootstrap.ts`, `load`.

- Chromium attributes document click listeners to the document element and exposes the whole course as clickable; pointerdown is not a mouse-button event there. Keyboard users leave More by moving focus, so focusout replaces the keyboard clicks the old listener also caught. Escape remains. Governed code: `packages/export-pipeline/template/src/islands/island-deck.ts`, `initDeck`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- WebKit does not focus a pressed button; it focuses the nearest focusable ancestor, here the controls landmark. pointerdown owns pointer dismissal. Governed code: `packages/export-pipeline/template/src/islands/island-deck.ts`, `initDeck`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- WebKit can finish native focus restoration after close() returns. More also hides the trigger while the sheet is open. Wait for close and layout. Governed code: `packages/export-pipeline/template/src/islands/island-deck.ts`, `initDeck`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- A click can reach both a control's own listener and its React root's delegation; nested controls also bubble through each other. Act once. Governed code: `packages/export-pipeline/template/src/islands/island-deck.ts`, `initDeck`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- A content page writes nothing on arrival. Its focused heading names the page, and the counter and outline expose position. A separate position-plus-title message repeated the heading and competed with focus (NVDA dropped it on one of three arrivals); see "Pages arrival orientation" in docs/context/published-output-runtime.md. Utility pages keep their title. Governed code: `packages/export-pipeline/template/src/islands/island-nav.tsx`, `initializePageFocus`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Measure the actual labels, including rich inline text and larger-text/spacing preferences. A fixed phone breakpoint would miss long labels on a laptop. Governed code: `packages/export-pipeline/template/src/islands/island-tabs.tsx`, `attachIsland`.

- Some browsers omit both afterprint and the print-media exit. Bound the lifetime of the scope in that case. A blocking native dialog suspends this timer. Governed code: `packages/export-pipeline/template/src/retrieval-sheet-print.ts`, `PRINT_FALLBACK_MS`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Browsers can coalesce a short print session into only its exit event. Each request owns this query/listener, so any exit ends this scope. Governed code: `packages/export-pipeline/template/src/retrieval-sheet-print.ts`, `printRetrievalSheet`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- An explicit retry after failure adds a new `retry` query value to the ESM support URL, avoiding reuse of the previous module-map entry. Governed code: `packages/export-pipeline/template/src/self-check-runtime.ts`, `createRuntime`.

  Evidence: [HTML Standard, module maps](https://html.spec.whatwg.org/multipage/webappapis.html#module-map) defines request URL and module type as the map key and explicitly states that changing the query creates a distinct entry.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
