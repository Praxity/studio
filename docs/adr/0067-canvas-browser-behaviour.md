# 0067: Canvas browser behaviour

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Course markup and styles share the canvas document with Studio controls. Native focus, layout and resource loading differ across browsers.

## Decision

### src/renderer/browser/canvas-text.test.ts

- `mountTextField`: jsdom has no layout or native trusted input. Adapt those browser boundaries; the
  actual field listeners and session remain under test.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/renderer/browser/canvas-text.ts

- `canvasTextNeedsFallback`: A normal document position can leave the viewport after the author
  scrolls. Negative document coordinates instead indicate course positioning defeated flow.
- `canvasTextCanReloadInPlace`: Only known saved-field recoveries bypass document admission. Other
  refusals may need a server page.
- `saved`: The operation owns line endings. Retain its acknowledged bytes for the next edit.
- `check`: A failed read is no proof that the write failed. Keep retries fenced.
- `retry`: Reuse the immutable transaction if a lost original request arrives late.
- `mountCanvasTextFields`: References admit controls; rendered IDs only locate a snapshot-admitted
  field. A11y decision, 2026-10-17: one polite announcer and a persistent described error. Checking
  an unknown save changes available actions without repeating its outcome. Discard confirmation is a
  named group; focusing Keep editing exposes its question once. Caption buttons sit outside
  figcaption. An open field replaces its run inside it; the figure keeps its captured authored name
  until its original name attributes return. Browser journeys verify focus and markup;
  NVDA/VoiceOver acceptance is separate.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `nameAll`: Keep controls outside the figure name while showing which run each edits.
- `presentation`: Locate compiler text children so controls and list containers keep their identity.
- `anchor`: Caption controls must not become part of the figure's caption-derived name.
- `reanchor`: Several caption runs share a caption, but keep their buttons in run order.
- `revealControl`: Focus decision, 2026-10: nearest and centre alone both lost a tall field's label.
  Keep native host scrolling; cap the textarea so its own scroll exposes the caret.
- `revealControl`: Behind-content chrome, including negative z-index, must not reserve space. A
  higher header can cover the midpoint while leaving this header's edges exposed.
- `revealControl`: An unstuck header's flow gap scrolls away; only its box and inset can cover the
  port.
- `revealControl`: Let the native textarea scroll its caret while the label stays above course
  chrome.
- `revealControl`: A recovery control needs its own margin; scrolling its whole panel can hide the
  target.
- `revealControl`: Leave a visible pointer target in place until its click completes.
- `revealControl`: Nearest can uncover other sticky chrome; measure it again before the one centre
  pass.
- `usable`: Resize can follow a legitimate departure while a save is pending.
- `protect`: Native caret scrolling after a resize can leave the field under sticky course chrome.
  Try its normal document position before treating the course CSS as a flow failure.
- `protect`: The panel remains outside body; nothing behind this exceptional field is actionable.
- `protect`: Keep the toggle reachable even when the author scrolls back to the header.
- `sizeField`: scrollHeight includes soft-wrapped lines in engines without field-sizing.
- `revealField`: Opening selects the end before layout; a new height cap must expose that caret too.
- `render`: Keep the polite region for outcomes; clear it so an identical refusal can announce
  again.
- `render`: Change the persistent error only on an outcome, never for typing or repeated renders.
- `update`: The band owns polite announcements; this adjacent text has no live role.
- `update`: Pointer focus precedes click in Firefox; moving its target loses that click.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `update`: The field replaces its run inside figcaption, while the figure keeps its authored name.
- `update`: Layout pixels survive course transforms; content may shrink back to the CSS minimum.
- `update`: Chromium commits a native IME with an untrusted compositionend.
  Regression coverage: `apps/desktop/e2e/browser-editor/canvas-text.spec.ts`, "C04 IME composition
  Enter is input, never save", uses Chromium CDP composition followed by native Enter. The engine
  claim is not independently reverified in this documentation change.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `update`: Let native Tab traversal continue from the heading, including shadow roots and radios.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `update`: Keep its shadow controls out of this native traversal, then restore entry.
- `update`: Explicit discard also releases the unload guard for navigation/reload.
- `mountCanvasTextFields`: The author panel saves on activation. Closing on mousedown can shrink the
  document and move its toggle before the matching pointerup/click arrives.
- `mountCanvasTextFields`: A loaded image moves later runs without resizing their own hosts.
- `focusBinding`: An outside rename can retire a runtime ID. Source position restores focus only.

### src/renderer/browser/canvas.ts

- `startStudioAuthor`: Runs from the packaged nonce-bearing entry before any course element is
  parsed.
- `startStudioAuthor`: The learner base must never affect history, and cleanup precedes storage or
  DOM work.
- `startStudioAuthor`: Start in the next task after parsing. Course images must never gate author
  controls.
- `startStudioAuthor`: Use the compiler's course appearance, even when Studio's system theme
  differs.
- `startStudioAuthor`: The document root remains an ancestor even of protected top-layer controls.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `startStudioAuthor`: Inline important geometry wins against authored layers, animations and
  selectors.
- `startStudioAuthor`: Reserve the localized loading label before it can move course click targets.
- `startStudioAuthor`: Author panel decision, 2026-10-17: reserve a band and scroll it with the
  course. Floating controls covered the header; a shared status row moved the toggle. ResizeObserver
  alone left a frame of overlap after localized text wrapped.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `reservePanel`: A body positioned out of flow still needs the author's reserved header band.
- `startStudioAuthor`: Text can wrap before ResizeObserver delivers; reserve it in the same
  microtask.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `rpc`: An absent reply is unknown, never a no-write refusal or an automatic replay.
- `startStudioAuthor`: Authentication owns replacement. A forged fragment cannot overwrite a working
  session.
- `listen`: Reconnection invalidates output, including changes missed in the gap.
- `startStudioAuthor` retains the current diagnostic in its `refusal` string, initially from
  `snapshot.sourceRefusal`. Source refusal handling and a caught `practiceRefusal` update that state
  and the polite status. A later successful `refresh` clears the retained refusal when it installs
  an admitted build.
- `reload`: Closing the discarded field already started the fresh build.
- `refresh`: Removing the destination also blocks auxiliary clicks and browser link menus.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `refresh`: One wait spans discarded builds and refreshes deferred by an open field.
- `refresh`: Rebuild from a fresh read admission, never from an event's HTML or the old artifact.
- `refresh`: The response already passed the author projection; its bootstrap never executes twice.
- `refresh`: Missing Fetch Metadata can send the author-entry gate on this read.
- `refresh`: The compiler alias owns the destination and fragment for a later deck slide.
- `refresh`: Firefox may resolve a connected head link before its replacement base takes effect.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `refresh`: Keep the current sheets active until their revision replacements are loaded.
- `refresh` sets `as="style"` on each fresh-head stylesheet source link and clones it into a staged
  `rel="preload"` link. Both the staged link and the fresh-head source keep the `as` attribute when
  the staged link becomes `rel="stylesheet"` and head reconciliation reuses it. This keeps preload
  destination metadata consistent through activation and avoids the recorded warnings and refetches.
- `refresh`: Changing an inactive sheet's media makes WebKit fetch it again on activation.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `refresh`: A background tab can pause painting after its stylesheet load has completed.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `refresh`: Keep old CSS through WebKit's rendering update and head reconciliation.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `sync`: Reuse course nodes and owned buttons. Unrelated edits must not rebuild the AT buffer.
- `sync`: Preserve unchanged content before IDs: a transient ID can be rebound after an insertion.
- `sync`: A loaded stylesheet must stay connected while old sheets are retired.
- `refresh`: A newer source revision supersedes diagnostics as well as successful builds.
- `refresh`: The server localizes this content-free refusal in the course language.
- `refresh`: Read keeps the last good build. The polite status announces a changed refusal once.
- `startStudioAuthor`: A watcher may arrive while the first reply is held. Compare fresh bytes, not
  its sequence alone.

### src/renderer/browser/event-stream.ts

- `openBrowserEventStream`: XHR progress delivers NDJSON promptly where WebKit's fetch reader
  buffers updates.
  Regression coverage: `apps/desktop/src/renderer/browser/event-stream.test.ts`, "delivers bytes on
  progress, including split UTF-8, without waiting for completion" and "fetch events bypass the
  cache without delaying document load", pins the adapter contracts; it does not establish the
  engine-specific buffering cause.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `openBrowserEventStream`: Gecko's pre-load XHR holds document load open. Its fetch reader streams
  promptly.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `openBrowserEventStream`: Gecko can hold an identical pending stream behind the HTTP cache entry.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `progress`: XHR retains consumed text. Reconnect at the existing stream limit to release it.
- `openBrowserEventStream`: Preserve split UTF-8 sequences and let the bridge's fatal decoder
  validate them.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `openBrowserEventStream`: Same-origin cookies are sent; the server authenticates only the bearer
  token.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/shared/canvas-messages.ts

- `editButtonName`: Naming decision, 2026-10-17: kind and ordinal precede the literal authored
  excerpt. Rejected: collision suffixes, which authored text can copy, and replacement after text
  insertion. EN/FR unit and browser tests cover names; NVDA/VoiceOver speech acceptance is separate.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/shared/canvas-page-selection.ts

- `selectCanvasPage`: Keep a replaced page's position, but never substitute a surviving captured
  sibling.

### src/shared/canvas-styles.ts

- `canvasStyles`: Values come from Studio's contrast-corrected themes, never authored custom
  properties.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
