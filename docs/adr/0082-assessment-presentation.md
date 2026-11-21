# 0082: Assessment presentation and material

## Status

Accepted. Records existing behavior; no executable change.

## Context

Assessment controls must preserve native semantics, question descriptions and deliberate feedback.

## Decision

### `packages/shared-blocks/src/assessment-choice.ts`

- `choiceAnswerResult`: Studio grades sets and surveys, rather than the library's authored
  quiz/points shape.

- `choiceInteractionReport`: SCORM 1.2 only: hex digits encode four positions each, low bit first.

- `choiceStateQuestion`: Provenance is recorded by inline producers, never inferred from authored
  classes.

### `packages/shared-blocks/src/assessment-content.ts`

- `prepareAssessmentContent`: Page footnotes must already be prepared at the page boundary.

- `fieldTrees`: Legacy tree arrays have no binding: accept only an exact rendering match.

- `htmlMaterial`: Raw HTML has no compiler exclusions. Its visible text and image sources still
  count.

### `packages/shared-blocks/src/blocks/AssessmentBlock.tsx`

- `useDescribedByRef`: Set aria-describedby on Mantine-rendered control nodes through
  useDescribedByRef. Mantine Input builds ARIA attributes after spreading caller props, so an
  undefined internal value can replace the supplied description. Native fieldsets accept the prop
  directly; a stable callback ref also works for mapped controls.

  Evidence: [Mantine 9.0.0 Input
  source](https://unpkg.com/@mantine/core@9.0.0/esm/components/Input/Input.mjs), `Input`, builds
  ariaAttributes from ctx?.describedBy and spreads them after rest on the input.
  `packages/shared-blocks/tests/assessment-description.test.tsx`, "uses the author placeholder and
  wires the description to the input", pins the resulting association.

- `MatchingPreview`: Options ids must be props: Mantine overrides attributes.options.id.

  Evidence: [Mantine 9.0.0 ComboboxOptions
  source](https://unpkg.com/@mantine/core@9.0.0/esm/components/Combobox/ComboboxOptions/ComboboxOptions.mjs),
  `ComboboxOptions`, obtains _id from its id prop and assigns it after ctx.getStyles and others.
  `packages/shared-blocks/tests/assessment-a11y.test.tsx`, "resolves matching labels and open
  dropdown controls with older arbitrary pair ids", checks the controlled listbox identity.

- `MatchingPreview`: The input keeps its keyboard/ARIA behavior; the aria-hidden display span can
  wrap without changing the native input.

- `SequencePreview`: Announcing the move, not the score. This region used to read "N of M in correct
  order" on every keystroke, which handed the learner the answer while they were still working it
  out and fired on every single move.

  Evidence: `packages/shared-blocks/tests/assessment-a11y.test.tsx`, "announces the move, never how
  many are already correct", pins the announcement text. It does not establish actual screen-reader
  speech.

- `SequencePreview`: Drag is the enhancement; the arrow buttons stay the single-pointer path WCAG
  2.5.7 requires.

- `SequencePreview`: Place ordering controls side by side after the label. Stacking two 34px
  controls made a one-line row about 86px tall and separated the ordinal, label and arrows onto
  different baselines.

- `TextResponsePreview`: A placeholder is never a label. The accessible name still comes from the
  stem, and an unset override falls back to the localized default.

- `PreviewAssessmentBlock`: Resolve shuffled defaults and any durable answer before the first render
  so learner controls never flash empty while state is being restored. The description explains the
  question, so it must be announced with the response controls rather than only sitting next to
  them. Retry returns to an answer control, not its keyboard-scrollable region. Wait until the
  response is enabled again, and stay inside this question. Responses without an enabled control
  (file upload) fall back to the question. WebKit can focus a hotspot outside its nested scroller
  after retry reflows. Keep Try again mounted until focus has left it, avoiding a stop on body.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `PreviewAssessmentBlock`: Grammar's compatibility projection also promotes option feedback into
  the overall field. Once shown beside that option, do not repeat it below.

- `PreviewAssessmentBlock`: NVDA reads the button and its feedback description once in browse and
  focus modes. The summary and row reveals share one timing; keep the scroll anchor off until it
  finishes.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
