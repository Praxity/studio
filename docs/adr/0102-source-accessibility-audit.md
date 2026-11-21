# Source accessibility audit boundaries

## Status

Accepted. Existing behaviour recorded during comment removal.

## Context

Source checks provide author guidance without rendering the course. Their results must preserve source privacy and must not imply browser or assistive-technology conformance.

## Decision

- `packages/editor-core/src/components/audit/resolve-empty-state.ts`, `resolveAuditEmptyState`, and `packages/editor-core/src/components/a11y-audit-panel.tsx`, `A11yAuditPanel`: Return `noFilteredIssues` only when both `hasFilteredIssues` and `hasQuickStartIssue` are false. The category list excludes the issue displayed in the Start here card, so an empty category list does not mean that the results region is empty. With exactly one eligible open issue, that card holds the only result. Since the panel's empty-state branch replaces the entire results region, checking only `!hasFilteredIssues` would hide the card and make the sole issue unreachable. Sources: `resolveAuditEmptyState`'s conjunction, `A11yAuditPanel`'s `filteredIssues` calculation and empty-state render branch, and the original resolver comment at commit bed54f6.

- `packages/editor-core/src/components/audit/types.ts`, `AuditIssue.sourceLine` and `NavigateToIssueRequest.sourceLine`: Source locations use zero-based lines independently of transient block IDs from later lesson reads. Keep source positions bound to the authoring snapshot when presenting audit results.

- `packages/editor-core/src/lib/a11y/check-audit-staleness.ts`, `main`: Validate date format to prevent argument injection via JSON values
- `packages/editor-core/src/lib/a11y/checker.ts`, `checkCourseAccessibility`: Accessibility checker for Praxity courses. Performs fast, browser-free checks on authored pages, blocks, assets, and design tokens. Rendered-output and assistive-technology testing are separate evidence and are never inferred from silence here.
- `packages/editor-core/src/lib/a11y/checker.ts`, `checkBlockAccessibility`: Cast to string, legacy block types (mcq, narrative, etc.) may still exist in persisted course data even though they're removed from BlockType.
- `packages/editor-core/src/lib/a11y/checker.ts`, `checkLinkTextInHtml`: Not every block's content is HTML: a self-check's is its structured prompt.
- `packages/editor-core/src/lib/a11y/checker.ts`, `checkConsecutiveHeadings`: Flag two consecutive headings with no body content between them. Intentionally walks only top-level blocks (not deep), containers like tabs/accordion provide semantic separation, so headings inside them are in a different visual context.
- `packages/editor-core/src/lib/a11y/design-system-config.ts`, `isCheckedAsDark`: The appearance the checker evaluates. `auto` courses are measured in light, which is what `resolvePalette` treats as the non-dark case.
- `packages/editor-core/src/lib/a11y/design-system-config.ts`, `resolveDesignSystemConfig`: The resolved palette includes author overrides, so checker results follow the colours edited in the Design panel.
- `packages/editor-core/src/lib/a11y/gif-flash-detector.ts`, `MAX_GIF_ANALYSIS_BYTES`: Per-GIF live storage: four RGBA canvases, the largest decoded frame and interlace scratch, parser estimate and fixed LZW tables. Frames decode serially.
- `packages/editor-core/src/lib/a11y/gif-flash-detector.ts`, `MAX_FRAME_WORK_PIXELS`: The historical source comment records a review measurement of 5.7 seconds for 26 million frame pixels. The 200-million-pixel work ceiling bounds pathological files and loop replay; its original estimate was roughly 44 seconds at that measured rate. This is historical motivation, not a new benchmark. MAX_FRAMES also bounds tiny-frame metadata/sample work.
- `packages/editor-core/src/lib/a11y/gif-flash-detector.ts`, `analyzeGifFlashes`: Conservative WCAG 2.3.1 warning heuristic, not a conformance measurement. It composites GIF disposal frames and flags four general-luminance flashes in any one-second window when opposing >=0.10 luminance changes overlap at least 25% of sampled asset pixels. It does not implement the red-flash formula or the rendered 10-degree visual-field area, and can miss background-dependent transparency, sub-25%-of-asset flashes, and files above the safety caps. Export blocks detected threshold exceedances as a precaution; this does not establish conformance for animations the heuristic does not flag.
- `packages/editor-core/src/lib/a11y/gif-flash-detector.ts`, `analyzeGifFlashes`: A complete flash must have both transitions inside the window.
- `packages/editor-core/src/lib/a11y/gif-flash-detector.ts`, `findFlashingGifSources`: Serial reads/decode keep one GIF working set live; each GIF has its own budget.
- `packages/editor-core/src/lib/a11y/occurrence-id.ts`, `buildA11yOccurrenceId`: Identity for one authored-source result. Evidence text and scan order are deliberately absent.
- `packages/editor-core/src/lib/a11y/retrieval-sheet-advice.ts`, `checkRetrievalSheetAccessibility`: Author review only; issues contain locations and fixed copy, never authored excerpts.
- `packages/editor-core/src/lib/a11y/retrieval-sheet-advice.ts`, `checkRetrievalSheetAccessibility`: Grammar owns blanks, limits and malformed source. Never add advice to a refusal.
- `packages/editor-core/src/lib/a11y/retrieval-sheet-advice.ts`, `checkRetrievalSheetAccessibility`: The source read can include several pages. Only audit activities on this page.
- `packages/editor-core/src/lib/a11y/self-check-advice.ts`, `SelfCheckAuditSource`: Editor identities may differ from a fresh source read's transient IDs.
- `packages/editor-core/src/lib/a11y/self-check-advice.ts`, `maxModelWords`: Review guidance for this comparison task, not authored limits or WCAG failures.
- `packages/editor-core/src/lib/a11y/self-check-advice.ts`, `checkSelfCheckAccessibility`: Author-only advice. Full Content stays here; results contain codes and locations.
- `packages/editor-core/src/lib/a11y/self-check-advice.ts`, `checkSelfCheckAccessibility`: A single read may supply several pages. Audit only this page's activities.
- `packages/editor-core/src/lib/a11y/write-distractors-advice.ts`, `checkWriteDistractorsAccessibility`: Grammar owns quality checks and bounds. Check carries only their fixed copy and locations.
- `packages/editor-core/src/lib/a11y/write-distractors-advice.ts`, `checkWriteDistractorsAccessibility`: Whitelist numeric bounds, never forward arbitrary diagnostic arguments or source.
- `packages/editor-core/src/lib/a11y/write-distractors-advice.ts`, `checkWriteDistractorsAccessibility`: Limits and duplicate labels remain publication-refusing grammar errors; only author-option equality is review advice.

## Consequences

Preserve these constraints when changing this area. Sources are the named symbols and their explanatory comments at commit bed54f6, before this comment-only change. The [testing strategy](../context/testing-strategy.md) separates structural checker coverage from rendered output and manual accessibility evidence.
