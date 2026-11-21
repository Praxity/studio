# 0021: Published HTML admission

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- The preparation inventory also defines the complete selectable offline catalog. Governed code: `packages/export-pipeline/src/export-css.ts`, `desktopCssInputs`.

- Defence in depth for callers that supply compiled pages, including drafts. Source-level, course-wide diagnostics remain validateCourse's responsibility. Governed code: `packages/export-pipeline/src/html-gen.ts`, `assertPracticeLogic`.

- Publication deliberately refuses if ANY matching definition is practice: duplicate logic names remain advisory and cannot shadow this boundary. Governed code: `packages/export-pipeline/src/html-gen.ts`, `assertPracticeLogic`.

- The two runtime normalizers disagree on malformed target arrays. Conservatively inspect every string operand from either spelling. Governed code: `packages/export-pipeline/src/html-gen.ts`, `assertPracticeLogic`.

- A oneOf group scores only the member the learner picks, so an unscored option would leave the course result undecided forever. Governed code: `packages/export-pipeline/src/html-gen.ts`, `collectRequiredAssessmentIds`.

- Narration segments hold raw block source and the page runtime never reads those segments; the generated playlist is their only learner-facing output. Governed code: `packages/export-pipeline/src/html-gen.ts`, `generateHtmlPage`.

- Pattern rules precede shared/theme/authored CSS so author overrides stay last. Governed code: `packages/export-pipeline/src/html-gen.ts`, `generateHtmlPage`.

- Runtime configuration remains inert under a strict script-src policy. Governed code: `packages/export-pipeline/src/html-gen.ts`, `generateHtmlPage`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Install the shell's error listener before a deferred host download can fail. Gecko can report a fetch failure before a later parser-blocking shell runs. Governed code: `packages/export-pipeline/src/html-gen.ts`, `generateHtmlPage`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- index.html is the SCORM launch file and the review-share entry point, so it receives ?embed=1, ?minimal=1 and review tokens that the viewer reads. A bare meta-refresh dropped them; the page-N shims already forwarded them. Keep the meta-refresh inside noscript: WebKit can otherwise follow it after the shell has requested its redirect, dropping the query even with scripting enabled. Governed code: `packages/export-pipeline/src/html-gen.ts`, `generateHtmlIndex`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Block all `data:` URIs in anchor `href` values because SVG scripts execute on navigation. Governed code: `packages/export-pipeline/src/published-markup.ts`, `sanitizeHref`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- A logic rule's source ("variable:score", "block:q1") is a reference the runtime resolves, never a URL, so the media URL policy for the "source" key does not apply to it. Governed code: `packages/export-pipeline/src/published-markup.ts`, `sanitizeForJsonValue`.

- Randomizing after paint creates layout shift. A stable export-time shuffle preserves authored intent without moving choices under a learner's pointer. Governed code: `packages/export-pipeline/src/render-block-html.ts`, `renderChecklist`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- These DOM enhancers keep their server-rendered descendants composable. React-owned islands render their own subtree, so do not plan it twice. Governed code: `packages/export-pipeline/src/runtime-plan.ts`, `planPageRuntime`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
