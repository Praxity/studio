# 0026: Review command and draft retention

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- Keep unknown outcomes until acknowledgement: the same payload reuses its receipt ID. Governed code: `packages/export-pipeline/template/review-comments.js`, `request`.

- Runtime answer projections are private even when their native controls are hidden. Governed code: `packages/export-pipeline/template/review-comments.js`, `createAnchors`.

- The whole-course revision guards positional paths across re-exports. Governed code: `packages/export-pipeline/template/review-comments.js`, `verifiedPath`.

- Identity can name controls and graphics; their text stays outside the quote stream. Governed code: `packages/export-pipeline/template/review-comments.js`, `fromBlock`.

- A quote or node ID can occur on several pages, including inactive deck slides. Governed code: `packages/export-pipeline/template/review-comments.js`, `resolveEntry`.

- Only activate the learner's own disclosure/tab buttons, never arbitrary authored links. Governed code: `packages/export-pipeline/template/review-comments.js`, `showOnPage`.

- Browsers withhold cross-origin CSS rules; exported course sheets are same-origin. Governed code: `packages/export-pipeline/template/review-comments.js`, `collect`.

- In-memory retries freeze the full command until a durable acknowledgement or refusal. Governed code: `packages/export-pipeline/template/review-comments.js`, `mutateThread`.

- Deck signals after activating the slide, then finishes its own focus synchronously. Governed code: `packages/export-pipeline/template/review-comments.js`, `finishPendingJump`.

- One owner for browser records. Storage events never change an open session. Governed code: `packages/export-pipeline/template/review-comments.js`, `mountReviewTools`.

- Quota only blocks puts. Always attempt removal, including memory-only keys. Governed code: `packages/export-pipeline/template/review-comments.js`, `remove`.

- A conflict fork must sort after the value just observed, even in the same millisecond. Governed code: `packages/export-pipeline/template/review-comments.js`, `writeDraftLocked`.

- Keep the durable version until its edited successor can safely retire it. Governed code: `packages/export-pipeline/template/review-comments.js`, `writeDraftLocked`.

- Refusal is not permission to trade saved text for volatile text. A failed same-value write also fences persistent storage denial before removing anything. Governed code: `packages/export-pipeline/template/review-comments.js`, `refuseLocked`.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
