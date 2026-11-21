# 0060: Browser test adapters

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Browser tests need native engine behaviour while controlling races at external boundaries.

## Decision

### e2e/browser-editor/accessibility.spec.ts

- `test`: Prepare before listening: browser projects must not rewrite each other's active lesson.

### e2e/browser-editor/canvas-accessibility-review.spec.ts

- `geometry`: One browser task measures both boxes; a save reply cannot split the observation.
- `finishRefresh`: Focus blur closes the field; keep Read Updating across the pointer gesture.
  Author-panel pointer blur waits for activation so flow shrink cannot move its target.

### e2e/browser-editor/canvas-flow.spec.ts

- `openField`: The product's body ResizeObserver was registered first. Read its chosen flow layout,
  before later caret reveal or the author's own scrolling changes these inputs.
- `moved`: One layout snapshot avoids mixing Firefox viewport reads from different frames.
- `builds`: Chromium's closed native figure name is empty. Screen-reader acceptance is checked
  separately.

### e2e/browser-editor/canvas-prose.spec.ts

- `[kindIndex, text, code, message]`: Captured artifact URLs are immutable. Wait for the saved-page
  revision before reload.
- `initial`: Outside readers can see T1's capture gap until settlement, see "Durable file journal
  (T1)" in docs/context/architecture.md.

### e2e/browser-editor/canvas-read-pending.spec.ts

- The pointer-navigation test: Native context menus and Windows Firefox autoscroll consume the next
  pointer click.

### e2e/browser-editor/canvas-recovery.spec.ts

- `edit`: Fulfilled document fixtures have no remote IP; Chromium otherwise blocks loopback assets.
- `project`: Playwright routing doesn't expose browser-added Fetch Metadata.

### e2e/browser-editor/canvas-refresh-review.spec.ts

- `projectWith`: Playwright routing doesn't expose browser-added Fetch Metadata.
- `failed`: Read focus through the native getter; Playwright's own check may see the clobbered name.

### e2e/browser-editor/canvas-refresh.spec.ts

- `buttons`: WebKit's locator engine itself uses the clobbered method. Read through the native API.

### e2e/browser-editor/canvas-reveal.spec.ts

- `bottom`: Use whole pixels so native window-scroll rounding cannot consume the 8px gap.

### e2e/browser-editor/canvas-text.spec.ts

- `response`: Fulfilled document fixtures lack an IP address for Chromium's loopback check.
- `projected`: Fulfilled document fixtures lack an IP address for Chromium's loopback check.
- `paragraphId`: Redirect-chain routing is engine-specific; navigate directly after admission for
  the fixture.

### e2e/browser-editor/canvas.spec.ts

- `referrers`: Route interception applies to the first URL of a redirect chain. Admit first, then
  navigate to the captured document so the hostile response is exercised.
- `old`: A fresh navigation retains tab-scoped storage without Firefox's same-document reload race.

### e2e/browser-editor/fixtures/hostile-course.ts

- `installHostileMarkup`: Course scripts never run in the Page lens, so only markup and CSS stay
  hostile there. `evaluate` bypasses CSP: use it to plant DOM, never to simulate course code.
- `installHostileMarkup`: Declarative invokers open a modal dialog or a popover in the top layer
  without script, above the cover and the handles. They sit above the cover to take clicks.
- `installHostileMarkup`: Course elements earlier in the document that guess the handles'
  description ids would win aria-describedby and rewrite what assistive technology reads.
- `installHostileMarkup`: A course stylesheet loads before the lens mounts; any later position
  stands in for it.
- `HOSTILE_HANDLE_CSS`: Course CSS that knows the lens markup and tries to hide, shrink, move, clip
  or cover every handle and its focus ring, directly, through pseudo-elements, custom properties and
  cascade layers, through clipping, zooming, inert and hidden ancestors whose nodes set visibility
  back to visible, and by hiding each node while its handle has state. Ancestor display:none and
  scale(0) are absent: they collapse the node itself, and a node without a box keeps a hidden
  handle.
- `HOSTILE_STATE_CSS`: Course CSS that removes a node from layout while its handle, the node's
  preceding sibling, has state: focus, top-layer display, hover, selection or an open menu. Showing
  a handle would hide its node, and hiding the handle show it again. HOSTILE_HANDLE_CSS uses
  visibility for the same selectors, which keeps the layout, except `:focus`: focus cannot be undone
  for measurement, so a focused block hidden this way hides its items and their handles too .
- `drainMessages`: A parent round trip drains earlier window envelopes without an arbitrary wait.
- `forgeLearnerDocumentMessages`: A learner page loaded into the lens frame runs before the host
  tears it down. It posts through the same WindowProxy with origin "null". `evaluate` in the lens
  document stands in for that page's script; the bridge itself is not attacked.

### e2e/browser-editor/frame-bridge.spec.ts

- `reactivated`: WebKit can refuse control focus while a redundant window focus transitions.

### e2e/browser-editor/global-setup.ts

- `drainRoutes`: Route handlers can still need Studio after the test's final assertion.
- `startJourney`: Retain the build and authored test files as evidence; never copy the ready URL to
  disk.

### e2e/browser-editor/inspection-csp.spec.ts

- `courseResources`: CourseArtifactFrame's sandbox makes the inspection origin opaque from creation,
  unlike the CSP sandbox alone. WebKit then matches 'self' against nothing, so read the course
  resources it gates.
- `frame`: CourseArtifactFrame keys its iframe by mode, so learner preview is a new element with the
  browser learner sandbox. Re-pointing the inspection element instead could leave macOS Chromium's
  frame handle closed just after the learner page committed.

### e2e/browser-editor/lens-reveal.spec.ts

- `source`: The real compiled course runs in the Page lens with course scripts blocked, so
  interactive blocks keep their static server form. Every handle stays reachable by Tab : later card
  slides and conditional blocks are laid open, and focusing a tab's handle shows its panel .
- `renderedHandle`: Reads the painted handle: computed box-shadow and zoom report unzoomed values,
  so this checks pixels. `ring` is the nearest distance to the focus colour 2-4px outside the left
  edge; `glyph` the largest distance from the paper colour inside the glyph.
- `pair`: Top-layer handles paint in the order they were shown, whatever their z-index. Find two
  handles whose hit extensions meet outside both buttons: whichever has focus paints on top there,
  so one of the two directions needs the focused handle re-shown.
- `slack`: Targets must not overlap. A 24 px circle centred on a target must not intersect another
  target; circles of two undersized targets must not intersect each other. Firefox rounds fixed
  positions by under 0.001px.
- `misplaced`: The course's back face rises in with a transform, which makes it the handles'
  containing block until the animation ends. Replay it slowly and place the handles mid-animation,
  as a render during the reveal does.

### e2e/browser-editor/playwright.config.ts

- `defineConfig`: CI's default dot reporter prints failures only at the end, so a step
  timeout hid them.

### e2e/browser-editor/review-composer.spec.ts

- `duplicate`: Without Web Locks each tab persists its own copy; Duplicate tab copies that store.
- `[key, raw]`: A browser's Duplicate tab copies sessionStorage, not the shared localStorage.
  Restore the real tab-only snapshot after the first tab acknowledges.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
