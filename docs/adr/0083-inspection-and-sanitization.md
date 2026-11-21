# 0083: Inspection and sanitization boundaries

## Status

Accepted. Records existing behavior; no executable change.

## Context

The author inspection document and sanitized learner HTML have different admission rules.

## Decision

### `packages/shared-blocks/src/course-preview-frame.ts`

- `frameEdgeFocus`: The host asks for an edge whenever Tab enters the frame. A stop the browser
  chose for this entry stays. WebKit chooses none when Tab skips links: it focuses the document
  instead.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified. `packages/shared-blocks/src/__tests__/course-preview-frame.test.ts`,
  "focuses a frame edge only when the entry left no element focused", models the recovery rule
  rather than reproducing WebKit keyboard entry.

- `startInspectionPreview`: The Page lens runtime: the only script an inspection response runs,
  under its nonce. It owns every course-preview duty there. The lens never navigates itself: the
  host remounts any page a link asks for, so no learner document can load in the lens.

- `startInspectionPreview`: Only the host holds the other end of this port, so the page it names is
  authoritative.

- `follow`: An SVG `<use>` instance is a closed shadow tree, so a cloned link retargets its click to
  `<use>`. Never resolve the reference (chained, percent-encoded and SMIL-animated ones all differ
  from the attribute): cancel, and send only a light-DOM link to the host. Skip links and contents
  links move focus here, without navigating: WebKit fires the frame's load event for a fragment
  navigation, and the host remounts on a second load. Like the browser, try the fragment as written,
  then percent-decoded (`#café` is `#caf%C3%A9` here). Malformed encoding matches nothing.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified. `packages/shared-blocks/src/__tests__/course-preview-frame.test.ts`,
  "connects only through its offered port and owns the Page lens keys and links", pins in-place
  fragment focus and host navigation, not the historical WebKit load event.

### `packages/shared-blocks/src/course-preview-protocol.ts`

- `CoursePreviewInspectionOffer`: An inspection frame's origin is opaque, so no postMessage target
  can name it. The frame offers its own private port instead, and the host never posts to its
  window.

### `packages/shared-blocks/src/course-preview-diagnostics.ts`

- `PreviewCompileDiagnostic`: Keep author source metadata in this type-only extension of the frame
  transport. Putting it in course-preview-protocol.ts changes the learner runtime's parsed
  declarations and bundled bytes. The protocol's corresponding type-only import must preserve that
  separation.

### `packages/shared-blocks/src/inspection-markup.ts`

- `INSPECTION_INVOKER_ATTRIBUTES`: Declarative invokers open a modal dialog or a popover in the top
  layer without any script, above the Page lens handles; an interest invoker does so on hover alone.
  The editing lens removes them while mounted and restores them on disposal. The read-only page view
  keeps them: it has no handles and keeps learner behaviour.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `stripInspectionMarkup`: noscript changes parsing mode in a browser; never serialize its hidden
  markup. Only the host navigates the Page lens. A refresh would load a learner page there. A
  declared shadow root would hide its links from the bridge's click guard.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### `packages/shared-blocks/src/sanitize.ts`

- `freezePolicy`: These policies contain only data. Reject mutable RegExps and callbacks rather than
  freezing them: Object.freeze does not prevent RegExp.compile mutations.

  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

- `MAX_MEMO_ENTRIES and MAX_MEMO_BYTES`: One LRU across all three helpers: at most 256 entries and 4
  MiB of UTF-16 input/output strings. Cache strings only, never DOM nodes or caller-owned objects.

- `usesOwnedPolicies`: The DOMPurify patch exposes persistent policies, including captured setters
  and retained Trusted Types callbacks. Without it, bypass caching. Probing by sanitizing would
  execute caller callbacks extra times.

- `memoized`: External sanitization or clearWindow replaces DOMPurify.removed. Discard old results
  before considering a cache hit.

- `sanitizeHtml`: Sanitize authored HTML before dangerouslySetInnerHTML. Reconstruct generated
  inline icons only after DOMPurify has stripped unsafe markup; disable icon rendering for inert
  JSON. data-tooltip-content remains authored HTML even after the outer attribute survives
  sanitization. The tooltip enhancer must apply its narrower element and attribute allowlist before
  DOM insertion.

- `sanitizeHtml`: Bypass memoization when options are supplied: caller objects may have getters or
  mutate while sanitization runs.

- `sanitizedHtml`: Labels inside controls cannot contain another focus target. Keep tooltip
  definitions as ordinary text, including legacy HTML and prepared caches.

### `packages/shared-blocks/src/write-distractors-prompt.ts`

- `assertPlain`: Check descriptors before reading: cloning would erase unknown keys and invoke
  getters.

- `admitWriteDistractorsPrompt`: Recognize a prompt before generic visitors can invoke or erase its
  discriminator.

- `admitWriteDistractorsPrompt`: Inspect the inherited discriminator without invoking a getter. An
  unknown accessor is a generic capture refusal, not a distractor-specific diagnosis.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
