# Page frame bridge

This U3 slice exports `@praxity/editor-core/frame-bridge`. The editor keeps the
U1/U2 session outside the frame. `buildFrameView` projects `readLesson` nodes
and the session into names, descriptions, selection, menu state and focus.
Supply the same I4 IDs used to compile the page. Read-only fixtures may use the
reader's transient allocator.

Inject a bundle calling `startInspectionFrame` into the inspection page, with
the editor's exact HTTP origin, a per-frame channel and the page ID. It refuses
pages without `?praxity-inspect=1`. In Studio, `apps/desktop/src/inspection-frame.ts`
starts the Page lens runtime (`startInspectionPreview` in shared-blocks), which
reads the product's `praxity-channel` and `praxity-parent-origin` parameters and
starts this bridge once `CourseArtifactFrame` names the page over its private port. `connectPageFrame` runs in the editor and
expects `frameOrigin: "null"` for sandboxed inspection. The shared course
response sets `sandbox allow-scripts` alongside the bridge-only nonce CSP;
the iframe also omits `allow-same-origin`. Each inspection gets its own opaque
origin, inaccessible to learner frames, popups and other inspections. WebKit
matches `'self'` against nothing in an opaque document, so the browser editor's
inspection CSP names the read-only server's bound origin instead. Course
scripts never run there. Learner preview and exported courses retain their policy.
The host checks the current source window, channel, page ID, complete message
shape and exactly one transferred private port before accepting `ready`.
The string `"null"` alone never authenticates a sender. Host commands travel
only on the private port admitted with `ready`, never as window messages: an
opaque origin has no exact postMessage target, and a window message would reach
whatever document the frame navigated to. The frame ignores window commands.
Attach the host before loading the frame so it receives `ready`.
Render the controller view after `ready` and after every controller update.

Map `focusChanged` and `select` events to the session commands. `intent` asks
the host to open U6 source or U12 actions using its revision-bound target.
`navigate` asks the host to choose a visible handle or extend U2 selection.
The bridge owns no operation, layer, selection, history or announcement.
U4 owns Escape and the sole shell live region. U5 owns entering the canvas.
U5's `enterCanvas` moves focus to the frame element and sends a logical handle
target and awaits the bridge's private focus acknowledgement. Gecko may activate
the frame only once that command reaches the inner document. The helper confirms
host focus belongs to the frame before reporting success. An explicit focus
requested before `ready` is retained and replayed after the view, while focus
remains in the frame or on the opener. Leaving before it loads cancels that
request without claiming focus elsewhere. Swaps and disposal refuse pending
requests; an unanswered focus request refuses after five seconds.
WebKit can refuse an available control across several frame-entry paints. The
inspection retries after rendering within that same deadline. Focus may arrive
late; after the document has gained focus, losing it cancels retries. Moving
to another control also cancels retries. Missing or hidden controls refuse immediately; a
newer focus command, presentation suspend and disposal cancel the deferred attempt.
Call `suspend()` when a retained document loses its presentation. It refuses
pending host focus, cancels inspection retries and suppresses semantic input,
while retaining the admitted port and unloading observation. The mounted lens
stops restoring or remembering native focus, refreshing presentation and consuming
keys. Document patches, drafts and revision state continue on the same lens and
patcher. `render(view)` updates data while suspended. Call `resume(latestView)`
explicitly to bind a fresh presentation, then request new controller focus.
Suspension makes the inspection document root inert; resume clears it. A successor
admitted while suspended receives suspend before its first render and starts inert.
Root inert stops bridge code and markup from taking native focus. The nonce CSP
keeps course scripts from running and clearing or replacing that root.
Each semantic event carries its originating `presentationId`; the host refuses
events queued before suspend or generated before the inspection receives resume.
Document-level ready, unloading, height, paint and render feedback remain admitted.
Render feedback is document data and carries no presentation token. 07d's consumer
must gate speech on the host's current presentation when speaking, including
deferred announcements. Transport suspension alone does not silence the shell's
live region. `preview.feedback` records a failure as announced even if a gated
`announce` drops it; 07d must avoid losing a hidden failure to that deduplication.
Resume replays the latest visual feedback, without requesting speech.
Suspension blurs a focused iframe on the host, then the inspection returns native
focus to its parent if it still holds focus. Port order releases focus taken by
an earlier command already in flight, including in WebKit where iframe blur alone
does not release it. This chooses no replacement controller target under F8.
When a hidden view held focus, the controller must focus its own target. Pair
suspend/resume only with real hide/reveal, never with an effect re-run. Neither
resume nor retained document work replays old native focus under F9. If something
focuses the suspended document again, its lens leaves Escape, region keys and
handle keys unconsumed.
Each focus command carries a monotonically increasing `requestId`, echoed by
`focusResult`. An old result cannot settle a new same-target request after resume.
Suspension does not navigate or unload the document. The host still owns its
per-element load counter and document revocation; suspension never resets either.
The inspection bridge transfers a private keyboard MessagePort with its first
`ready`. The host retains that port
until `prepareSwap` or disposal and refuses later unsolicited `ready` messages.
Window-message `shortcut` and `region` envelopes never carry command authority.
All frame events after `ready`, including Escape, selection, intents, navigation
and focus changes, use that private port. Window messages admit only the first
`ready` handshake, so another document that copies an envelope gains nothing.
The lens checks `isTrusted` inside the frame and captures the key and admitted
focused handle before posting on the private port. The host requires frame focus,
the current handle identity and an exact registry binding before forwarding a
shortcut. Region keys must match the global registry too. `region` events cycle
the shell's regions; `shortcut` events translate through `frameShortcutCommand`
into U2 commands. Closing or swapping the frame closes its keyboard port.

Use `focus` for a controller focus effect. Use `refresh` after a node patch.
Reply effects carry the gesture's expected node owners through pending work.
At delivery, the frame checks native document focus and its admitted active control.
BODY qualifies only when a render disconnected an expected control. Trusted frame
pointer, key and focus input clears that removal witness. A declined reply has no
focus retry or missing-node error. Focus-dependent selection waits for the matching
native acknowledgement, ordered before later frame keys. Host-origin ownership and
entry remain a separate host adapter concern.
While a source field owns native focus, pointerdown on admitted authored content
prevents the browser from blurring it before click's select reaches the controller.
The click still sends one selection with its final input. Closing the source can
then supply the render-removal witness without admitting arbitrary BODY focus.
An open source field retains G10's protected selection and its source layer even
when native reply focus is declined. A declined acknowledgement also leaves the
operation's post-operation history snapshot intact for Redo.
Native Tab reports its destination before the select event commits a dirty field.
The controller preserves that gesture's selection and reply owner immediately.
Commits from Page node source fields capture their original selection and edited
handle for Undo before later native focus reports. Their history snapshots target
persistent handles after a field closes, including snapshots confirmed by a native
acknowledgement, so Redo keeps focus and selection on the same node. A source only
supplies that history target when it owns the single selection; unrelated drafts
do not override another operation's selection.
When an explicit lost-focus restoration has no current logical target, it may use
an undelivered reply's target. This starts a new focus request without applying the
old reply's selection or replaying its old presentation.
Handles are siblings of their content, so content replacement
keeps them. If replacement also removes a handle, refresh resolves the logical
target only while focus belongs to the frame and has fallen back to body.
Background rendering never claims focus. Call `prepareSwap` before replacing
the frame document and pass its returned fresh channel to the next inspection
script's `startInspectionFrame`. The old document's handshake and queued events
cannot enter that channel; its WindowProxy alone cannot prove a new document.
On `ready`, the host replays the current view and restores
focus only if the frame still owns it. `missing` reports absent rendered nodes;
the host decides whether to recompile, remove the target or defer a swap.

Native learner controls leave the Tab order and learner clicks are intercepted.
Embed wrappers are inert and their frames leave the Tab order too. Editor controls
are admitted by element reference in a private per-mount registry. Authored chrome
and focus-role claims are stripped during inspection, including on patches.
U6/U12 adapters call `registerControl(element, target)` for source fields or chips;
replacement controls need fresh admission before focus restoration. Cloned markup
does not inherit admission. Handles are created and registered by the lens itself.

The retained frame protocol accepts an optional, exactly validated `FrameView.source`
from an admitted draft. `source-field.ts` mounts a plain native textarea, labelled caption
and decorative container closer inside an editor-owned shadow root. Its stationary
manual-popover host is the last child of the document root, outside the body. A
disposable local slot reserves space beside the latest render. The Page lens admits the group's
element references and keeps the same field through fragment patches. Its source
host uses important shadow rules, with literal token colours and geometry from
the existing geometry owner mirrored into a shadow stylesheet. No slots or parts
expose its children to course selectors. The open root permits public accessible
control queries; it grants no script authority under the inspection CSP. Generic
font families,
left-to-right isolation and guarded caption/closer pseudo-elements prevent direct
course rules from changing the displayed source. Thin scrollbars keep an
overflowing field usable with visible browser scrollbars.
The blanket ancestor guard is removed. The body keeps its authored display and
visibility, including hidden content. A narrow first-layer document-root rule
retains the root's computed display mode from field admission until close, using
block if it was none. Root display changes during that transaction are deferred,
including a responsive switch between flex and grid. That rule also prevents root
content skipping and suppresses root transitions. Course fade-in animations keep
their filled state. Other root
properties stay course-owned; the top-layer host resets its own visibility and pointer behaviour.
Other handle ancestors retain the residuals below.
Node, parent, page-container patches and layout reorder wait until the source field
closes. The field and its slot stay connected throughout editing. Reference-based control lookup and root listeners
also admit explicit source focus inside an editor-owned closed shadow root, with
one semantic focus report. A weak control registry and a pruned weak-reference
index release retired handles, adapter controls and their root listeners. The
native field owns its value until the draft closes; render projections never replace it.
The hidden render returns when the field closes. A collapsed measurement uses its
last box and origin. The field remains visible when its anchor is hidden or removed;
missing node IDs go to the host for controller-owned resolution, never a DOM-derived
successful close. Geometry uses frame viewport pixels, clamps to the visual viewport
with an eight-pixel inset and a width floor of min(320px, viewport width minus 16px).
Source slot, field and surrounding layout sizes share the geometry observer;
Layout-affecting ancestor and sibling animations follow on frames until settlement,
suspension or disposal. Paint-only animations and chrome transitions schedule no
placement frames. A missing render keeps its admitted identity; authored duplicate
markers cannot capture the field. Patcher-admitted replacements refresh descendant
bindings without replacing the native field.
Shadow geometry changes update one text node in place to preserve Chromium typing groups.
Handle descriptions and source captions also retain their text nodes. Source geometry keeps
natural height, and unchanged source attributes and placement produce no DOM writes.
Cleared diagnostics empty their retained text node instead of removing it during typing.
Feedback banners and badges retain their text nodes too. Retired handles, badges and
banners become hidden and inert, leave control lookup, and are removed on close.
Fallback geometry probes remain connected and are measured anew on every pass until
close. This preserves Chromium's native typing group without guessing an idle deadline.
Settlement leaves a focused native field's caret alone, even when the host selection lags.
Selection replays only before the field gains native focus.
Settlement focus requests carry `preserveFocus` through the private port. The lens
checks native control and document focus when the command arrives. A leave cancels
the request without a retry or a missing-node report, even if its focus report has
not reached the host yet. Explicit author focus requests retain their entry behavior.
The owner approved the end-of-frame placement as an exception to F11/U6. Reading
context, logical Tab routing and spoken AT evidence remain separate acceptance work.
Suspend disables and blurs the field, makes the group inert and closes its popover.
Data-only render cannot enable it. Resume preserves native author text without
replaying focus. Admitted input and selection changes report draft text and actual
caret through the private port. The host updates the local draft and wakes the
controller's 150 ms idle validation clock. Diagnostics follow the field, with a
description and a 3 px inset danger rule for invalid text. Mod+Enter commits and
leaves; Mod+S saves and stays. Escape uses the shared capture dispatcher. Dirty
undo and redo remain native; undo at base text announces the controller's boundary
without entering operation history. Composition suppresses editor shortcuts.
Helper UI, source highlighting, persistence cadence and the remaining editing-group
exits attach in later slices. No production route mounts this host yet.
Tabs and accordions reveal the selected/focused item's content. Hidden children
keep hidden handles. A tab's handle sits on its tab but is read directly before
its panel, so Tab passes through each panel's children before the next tab.
Course scripts never run in the lens, so blocks keep their static server form.
Later card slides and conditional blocks (`hide`, `visible`) start hidden there
and have no visible anchor for their handles, so the lens lays them open: slides
stack one after another and conditional blocks show. Every handle stays in the
Tab order (F1). Nodes styled `display: contents`, such as matching pairs, are
measured by their contents. Disposal restores learner attributes and removes chrome.
Chrome follows the page background, with the UI spec's two token sets, handle
sizes, focus ring, reduced motion and always-show preference.

## U4 contracts

`geometry.ts` owns viewport placement and containing-block conversion. Scroll,
resize and `ResizeObserver` updates share one animation-frame batch. Handles on
partly scrolled nodes use the remaining visible node box when their first line
has left the viewport. This departs from U3's first-line placement to keep dense
cards reachable rather than stacking their handles at the viewport edge.
Placement uses measurements on all engines, retaining U3's transformed and
zoomed containing-block conversion. CSS anchor positioning remains a later
optimization; the geometry and clipping contract does not depend on it.

`anchorPopup` admits the popup through `lens.registerChrome`, opens it with the
manual Popover API, and clamps or flips its viewport box. Supply a live anchor
measurement and the host width. A narrow submenu returns `replaceParent`; U12
renders its Back row and owns Left-arrow navigation. Dispose the anchor when
the controller closes that popup. Helper anchors may be caret line boxes.
When neither vertical side fits, the popup scrolls on the side with more space,
keeping the 8px gap. While open, an animation-frame comparison follows anchor
movement caused by transforms and reflow without writing unchanged geometry.
Bundle the frame with support for CSS `?raw` imports. Browser-test esbuild
bundles use `e2e/raw-css.ts`.

`createEscapeDispatcher` attaches key capture listeners to each document's window and captures
native dialog cancel events, including dialogs mounted later. Its callback sends
the controller command and returns `dispatch(...).consumed`. Consumed events
prevent the native action and stop further handlers. `connectPageFrame` accepts
`onEscape` for the top document; frame `escape` events use the authenticated
transport and map to the same controller command. `buildFrameView` projects
`canEscape` into `escapeEnabled` for synchronous cancellation in the frame.
The projection reflects the last received view, not a synchronous controller RPC.
Only trusted keys and native cancel events reach the controller. Frame key events
never propagate into the parent, so the frame attaches its own dispatcher. The
top-document attachment also handles keys targeted at the frame element's focus path.

Mount `SessionLiveRegion` once in the new shell, from
`@praxity/editor-core/components/LiveRegion.tsx`. Give it only controller `announce`
effects and the host's interface translator. Course parameters receive course
language spans; speech waits at least 150 ms. Bursts queue each effect once in
order, with its own language and urgency. Retain the original effect object across
shell re-renders; a fresh equivalent translator does not resubmit that effect.
The controller retains background
typing deferral. The legacy shell re-exports the same `LiveRegion` implementation.
Inspection overrides explicit and implicit learner live regions with `aria-live="off"`,
resets atomic/relevant overrides, and restores authored attributes on disposal.

Import `@praxity/editor-core/styles/editor-tokens.css` in the new shell. The frame
injects that sheet itself. Only the lens-owned document root selects the frame's
theme through `data-praxity-chrome-theme`. The public `data-chrome` marker remains
for the spec; authored changes to it cannot select chrome tokens.
Frame tokens are scoped to admitted chrome descendants
to preserve the course's own custom properties. The two ownership lint checks
run in `pnpm lint` and `test:affected`, using the repository's TypeScript parser
rather than introducing ESLint alongside Biome. Their scope includes retained
session, frame bridge and editing directories. The unmounted U7 host, outline,
project/lesson adapters and their staged browser specs are retired. Tests and
the legacy editor remain outside the ownership lint scope.

## Trust checks

No course script runs in the Page lens: the nonce CSP blocks it and the opaque
origin keeps learner documents from reading the nonce. The bridge and the
inspection runtime are the realm's only scripts, so the bridge reads keys,
events and globals directly, without guarding against redefined prototypes or
getters. Source text admission rests on this no-course-script rule: only the
bridge can write the field's value. Admitted native input updates the retained
text; selection reports it only while the field's value still matches. A
synthetic input or a value change without admitted input cannot update the draft.
Final text and caret travel with existing frame gestures. Host commands dispatch
synchronously. Delayed trusted text remains admissible while that source lifetime
is open, even after native focus leaves. If a commit is already pending, the
existing generation rule keeps newer text in the field and draft after its reply.
An obsolete gesture snapshot is discarded without discarding its action;
draft-bound actions still require their current source lifetime.
Course markup and CSS remain hostile. The lens strips authored chrome
markers, silences explicit and implicit live roles and inerts embeds;
`sanitizeHtml` keeps DOMPurify's `id`/`name` clobbering protection. Other
course documents are isolated by origin. The host
admits only the current frame window, channel and private port, and
`CourseArtifactFrame` remounts a frame that loads a second document.

Course CSS cannot cover or hide a handle (F11). Each handle is a manual popover,
shown while the lens is mounted, so it paints in the top layer above course
overlays and outside ancestor opacity, filter, transform, overflow and clip-path.
It stays immediately before its node in the DOM, so reading order, Tab order and
names are unchanged. Course stylesheets share the document and can name the
handle markup, so the lens prepends a stylesheet whose rules are all `!important`
inside a per-mount `@layer`: important declarations in the earliest layer
outrank every later author rule, layered or not, including on `::before`,
`::after`, `::backdrop`, `:focus-visible`, the glyph and the description with its
own pseudo-elements, which inline styles cannot reach. Its colours are literals
copied from the token sheet, because a course can override or re-register a
custom property. The layer also resets `interactivity` everywhere, since an inert
ancestor makes top-layer handles inert in Chromium; the `inert` attribute keeps
working, which the hostile spec checks. `positionFixed` writes
geometry inline with `!important`, which outranks the layer, and cancels
inherited CSS zoom on top-layer chrome with an inline `zoom`, so rings, glyphs
and hit extensions keep their size.
Top-layer chrome starts at the viewport corner and uses an inline translation
to reach its measured box. macOS WebKit can ignore a newly opened popover's
insets under transformed ancestors, including flip-card backs.

Top-layer elements paint in the order they were shown, so z-index no longer
stacks handles. At first mount the lens shows block handles before item handles;
later re-shows append, and the lens re-shows the focused handle above its
neighbours and then any open L3 popup above every handle. Moving or replacing a
handle's node closes its popover; the next placement shows it again. Hover mode
finds the innermost node under the pointer from the measured node boxes, not the
event target, so a course overlay or `pointer-events: none` cannot stop handles
appearing, and re-created handles pick the hover up. While mounted, the editing
lens removes declarative invokers (`command`, `commandfor`, `popovertarget`,
`popovertargetaction`, `interestfor`) from course markup, because they open
dialogs and popovers above the handles without script; disposal restores them.
Description ids carry the per-mount nonce, so a course element cannot claim a
handle's `aria-describedby` by guessing its id. The renderer's own `praxity-` ids
are left alone. The guard layer also clears a root `filter`, which Firefox applies
to the top layer.

Each handle is its node's preceding sibling, so course CSS can key the node's
visibility to the handle's state (`:popover-open + *`, `[data-selected] + *`,
`:focus + *`, the same through `:has()`). Showing a handle would then hide its
node and hiding the handle show it again. Selectors can always see a sibling's
pseudo-classes and `aria-expanded`, so the lens does not try to hide state.
Instead, when a node beside an open or focused handle loses its box through CSS,
placement measures every node again with every handle neutral: closed and
without its `data-hovered`, `data-selected` and `aria-expanded` attributes. The
focused handle keeps its `aria-expanded`, since removing and restoring it can
reach assistive technology. A node hidden by markup (`hidden`, `inert`,
`aria-hidden`), as a tab panel is on every Tab to a tab, never starts this pass.
Focus and pointer hover cannot be neutralized, so a focused or hovered handle
whose node has no box keeps that node's last box; a node that is rendered always
uses its current box. Placement never throws: a handle with no clear gutter waits
for the next pass. Course CSS can hide a geometry probe or its parent
(`:has(> probe)`, `probe ~ *`), which also collapses the page and resets its
scroll, so top-layer chrome avoids probes where it can. `measureOrigins` reads
the inherited zoom from `currentCSSZoom` when available. In engines without it,
a placed handle is its own probe:
its rendered box against the inline translation it was given yields the origin and
scale. A probe that measures nothing leaves the parent's last good origin, else
the viewport's.

Course CSS can still:

- hide unprotected lens cosmetics: render badges, the failure banner and
  L3 popups;
- hide a node's handle by giving the node no box (an ancestor with
  `display: none` or `scale(0)`), as before. An ancestor's `visibility: hidden`
  hides only the nodes that inherit it;
- hide an ancestor of a handle with state (`:has(> :focus)`,
  `:has(> :popover-open)`, `:has(> [data-selected])`): top-layer elements inside
  a `display: none` subtree are not rendered, so the handles go with the content
  and focus drops to the body;
- hide other nodes while a handle has focus (`:has(:focus) > [data-node-id]`, or
  a focused block's inherited `visibility: hidden` on its items). Their handles
  hide while that focus lasts, so Tab skips them and can leave the lens;
- under `display: none` state CSS, leave a focused or hovered handle at a stale
  viewport box after scrolling, because its node has no box to follow;
- shift handles away from their nodes: placement uses the neutral layout, so in
  Firefox and WebKit a handle can sit about 300px from its node when an earlier
  block was hidden by state;
- in an engine without `currentCSSZoom`, hide the probe for a handle's first
  placement: the handle then uses its parent's last good origin, and the page
  may lose its scroll position.

Not handled: a course modal dialog or popover already open at mount stays open.
No way to open one is known, since the lens runs no course script and removes
invokers. Hover picks the innermost node by containment, so among overlapping
siblings the first in source order wins, not the one painted on top.

The checklist lives in [Coding standards: frame bridge and editor trust](../../../../CODING_STANDARDS.md#frame-bridge-and-editor-trust).

`pnpm lint` and `pnpm test:affected` enforce T1 and T2 in frame-bridge, shortcuts,
session and desktop course-map sources. Test files and the legacy editor stay
outside those rules.

U4 browser evidence includes the M3 popup rows, upward/left/narrow placement,
independent editor/course schemes, reduced motion and U3 security regressions.
Optional `PRAXITY_U4_PAGES` supplies a JSON object with private page 5 and 17 source
strings. `PRAXITY_U4_SCREENSHOTS` names an external capture folder. No private
course source or screenshot belongs in Git. These fixtures do not establish
production shell attachment, complete compiled-course fidelity or manual AT.

Measured positions stay within the node's box when a lane there is free. Handles
keep WCAG 2.5.8 target spacing from each other. When every lane beside a node is
taken (nested nodes clamped to a viewport edge, or a one-line container and its
child), its handle moves to the nearest free slot above or below rather than
share one. Containers with handled children keep their handle on their own first
line. Horizontal tab handles share the tab list's gutter, stacked in source order. Hidden and zero-size boxes have no
rendered or focusable handle; class and visibility changes refresh this check.

Inspection reserves at least 60px on the inline-start side on first layout,
restoring the original body padding on disposal. This departs from the spec's
40px gutter: a container, item and short paragraph cannot all fit there while
staying within their boxes and leaving their controls reachable. The reservation
is independent of the always-show preference; changing states never moves content.
The 44px hit extensions exclude neighbouring visible buttons.
RTL handles use the right gutter. Viewport rectangles are converted through a
fixed-position measurement sibling into each handle's containing-block coordinates,
including CSS zoom, and ancestor translations and scales where an engine has no
Popover API. Handles remain immediately
before their content in the DOM for reading and Tab order.
Local column positions also avoid sibling content boxes and learner controls,
using the inner gap or page gutter when the neighbouring column fills its width.

Placement decision, October 2026: unrestricted vertical slots produced orphan
handles. Restricting slots alone let overlapping hit extensions obscure buttons.
Two gutter lanes, bounded centres and exclusions for neighbouring buttons retain
the node anchors and pass the geometry and axe checks. U4 still owns denser
arrangements, viewport clipping and batched scroll/resize geometry.

Remaining U3 slices: production inspection-script injection and editor-shell
attachment, hidden-title and deck page anchors, anchors for rule blocks (no box)
and renderer nodes without `data-node-id` (comparison sides, hotspot images,
fill-blank paragraphs),
the pointer insertion gutter, and full-artifact/theme/AT evidence. Menus, fields,
loading/error shell UI remain with U6/U12/U7.
The browser spec uses grammar-4 compiled fragments in an isolated course frame;
its light/dark, 1280/390px captures cover idle, hover, selected and always-show
states. They are module evidence, not an acceptance claim for U20.

## Render patches

`connectRenderPreview` adapts the authenticated Studio scheduler stream to the
private Page bridge. `PreviewRenderEvent` owns that shared event schema. Call
`select` only for the displayed frame (the scheduler shows one page). Call
`renderDraft` at the commit gesture, before the durable operation, and
`settle(transactionId, ok)` with the durable result. Save state belongs to this
controller, not the frame: Saving… lasts until every started save settles, and a
durable refusal shows Changes not saved. A preview refusal (nested child, layout
region, split draft, stale) paints nothing and waits for that settle. The
scheduler's saved/reverted acknowledgement repaints accepted drafts; a refusal
restores the saved node HTML and the controller keeps the author's draft. Reset
the draft epoch when the stream reconnects: it drops painted drafts, reselects
the page so the resync repaints them, and keeps saves in flight at Saving….
Only settled outcomes and page failures reach the shell's LiveRegion; Saving…
and Updating are silent.

`createFramePatcher` owns per-fragment durable revisions and per-epoch draft
sequences. Pending drafts hold compile replacements until settlement. Page order
handles inserts, moves, deletes and structural regions while retaining untouched
elements. The lens re-admits changed markup, refreshes static reveals and handles,
and retains admitted controls and field selections through replacement or moves.
Feedback uses EN/FR copy and lens-owned chrome. Neither patches nor feedback gain
authority from window envelopes or authored markers.
Page-level diagnostics use the banner and handle descriptions, rather than
repeating a failure badge over every node (which obscures text at 390px).

Browser CourseArtifactFrame Page inspections consume patches through this adapter.
That inspection is the preview overlay's author-bypass page view, not the
authoring lens, so its view sets `readOnly`: no handles, no reveal, no click or
key capture, and learner Tab stops and live regions stay as served. The lens
fixes the mode at mount.
SmallPreviewFrame uses explicit source/appearance snapshots instead of polling.
Native frames, small previews, CourseArtifactFrame learner previews and exports do not receive node patches;
their island mount behavior remains unchanged. An adapter that later patches a
script-running learner frame must reload the page when an island is touched.
No island remount or course-channel patch protocol is implemented here.
