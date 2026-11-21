# 0023: Preview capture and private content

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- The effective locale, frame navigation and module capability union also affect node HTML. Another page can introduce an island in this document. Governed code: `packages/export-pipeline/src/preview/compile-page.ts`, `compilePage`.

- A draft may introduce an island. Plan the substituted page/module before rendering; all layout, group, visibility and footnote facts use that draft. Governed code: `packages/export-pipeline/src/preview/compile-page.ts`, `renderNode`.

- The inert config JSON changes with every edit. In a patched inspection only the inspection runtime's logic overlay reads it (course scripts don't run under its nonce), so it is left out: a shell is stale only when its markup or head changes. Governed code: `packages/export-pipeline/src/preview/compile-page.ts`, `renderDocumentFrame`.

- Prefix entries apply to every lesson/speaker. Fragment consumers use the page's sourceDigest and referenced cast/asset keys, rather than a whole lesson. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `SLICE_CONSUMERS`.

- Host-captured asset digests. No project filesystem reads happen in this slice. When omitted, bytes already admitted by the host supply the digest. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `AssetCache`.

- JSON object insertion order and Map insertion order carry no authoring meaning. Arrays retain order, except where a slice explicitly owns an unordered set. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `structuralValue`.

- DialogueTurnData marks these fields as resolver output, never authored bytes. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `RESOLVED_SPEAKER_FIELDS`.

- Digests of the values a particular consumer reads. Revalidate against this function on the new context: lesson/asset/narration values are page-scoped, so comparing these records to the aggregate slice digest would over-invalidate. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `getPageDependencies`.

- Studio stores fractions; older direct callers pass percentages. Convert only fractions so 80% cannot become an impossible 8000%. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `normalizeDesktopCourseInput`.

- Authored HTML can embed asset paths outside typed asset fields. Preserve the export pipeline's existing literal-path detection for packaging and dependencies. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `AssetPathTrie`.

- Lookahead visits overlapping occurrences. The trie checks every terminal, including a shorter literal inside a longer one, against serialized JSON. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `embeddedAssetPaths`.

- Packaging observes inventory order, not occurrence order in the document. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `embeddedAssetPaths`.

- Style artwork participates in the same asset graph as page metadata. Only selected artwork needs packaging. Unused named styles remain source-only. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `prepareCourse`.

- Rewrite while pageBreak blocks are still present; splitting moves their metadata to page data. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `prepareCourse`.

- Glossary terms come from the inline tooltips in page content. Aggregate in prepareCourse after page splitting so entries carry the right page title and slug. Governed code: `packages/export-pipeline/src/preview/course-context.ts`, `prepareCourse`.

- In `packages/export-pipeline/src/self-check-prompt.ts`, `captureBlockTypes` reads an enumerable accessor-backed block `type` once and stages that value as a data property on a new record. It leaves the caller's record unchanged. If the captured type is `writeDistractors`, it copies the original property descriptors onto that staged record and calls `admitWriteDistractorsPrompt` before recursively visiting its properties.

- `admitWriteDistractorsPrompt` delegates to `constructWriteDistractorsPromptBlock` in `packages/shared-blocks/src/write-distractors-prompt.ts`. That constructor must inspect the original nested `data` and `content` descriptors, own keys and prototypes. It rejects accessors, symbol keys, nonenumerable properties, unexpected fields such as `rightAnswer`, and non-plain prototypes. An earlier traversal could invoke a data getter; an earlier `structuredClone` could erase symbol keys, nonenumerable fields and prototype information that admission needs to reject. Only the captured block `type` accessor may be read before that admission. Other host objects and clone failures remain subject to the later native clone in `cloneAdmittedSelfCheckData`.

  Evidence: `packages/export-pipeline/src/__tests__/write-distractors-reader.test.ts`, "routes a single captured discriminator before zero-read prompt validation at %s" and "refuses %s before capture, sanitization and draft substitution". These tests check that the block type is read once, data getters are never called, and the listed malformed properties are refused.

- structuredClone drops symbol and nonenumerable properties. Preserve self-check refusals, without evaluating getters a second time or using live values in the compiler. Governed code: `packages/export-pipeline/src/self-check-prompt.ts`, `assertCloneProperties`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Inspect the full own-key set and prototype before copying. structuredClone can erase symbol keys, nonenumerable fields and custom prototype information that admission must inspect. Governed code: `packages/export-pipeline/src/write-distractors.ts`, `record`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
