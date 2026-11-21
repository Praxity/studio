# Inspection frame admission and native editing

## Status

Accepted. Existing behaviour recorded during comment removal.

## Context

Inspection markup and CSS are untrusted. Editor controls require private admission and must remain usable without breaking the browser native editing history.

## Decision

- `packages/editor-core/src/frame-bridge/escape.ts`, `cancel`: Native cancel does not bubble. Capture covers dialogs mounted later too.
- `packages/editor-core/src/frame-bridge/escape.ts`, `attach`: Window capture precedes the shell's document-capture listeners. Child-frame keys never reach the parent, so each document attaches its own dispatcher. Attaching the top document also covers Escape when focus is on the frame element itself.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `measureOrigins`: Top-layer chrome uses the viewport origin and inherited zoom when available. Otherwise measure each distinct parent's containing block with a fixed probe beside the first element there. Siblings share a containing block. Insert and show every probe before reading any, so a placement pass lays out once however many parents it has.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `measureOrigins`: Course stylesheets match the probe too; inline !important keeps them from skewing it.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `measureOrigins`: Retain during native editing: removing any frame node ends Chromium's group.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `positionFixed`: Preserve the inspection handle containing-block conversion under ancestor transforms and CSS zoom. A placement pass passes `measureOrigins` for all its elements at once.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `positionFixed`: Inline !important outranks every author stylesheet, so course CSS cannot move or resize chrome. anchorPopup's plain assignments reset these values and the flag.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `positionFixed`: In the top layer no ancestor transform applies, so the only scale left is inherited CSS zoom. Undo it on the element itself: a zoomed handle would shrink its ring, glyph and hit extension even with a compensated box.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `positionFixed`: WebKit can ignore a new popover's insets under transformed ancestors. Start top-layer chrome at the viewport corner and translate to its measured box.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `observe`: Re-observing unchanged nodes delivers their initial sizes again on each focus render, scheduling a second full placement with no geometry change.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `anchorPopup`: Caret anchors have no element to observe. Transforms and sibling reflow can move an element without resizing it, so compare its viewport box while open and write geometry only when it moves.
- `packages/editor-core/src/frame-bridge/geometry.ts`, `isEditorElementAvailable`: Visibility through ancestors, shared by canvas entry and in-frame handles. `visibility` inherits and a descendant may set it back to visible, so only the element's own computed value counts; display, hidden, inert and aria-hidden on any ancestor still remove it.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `LEARNER_ONLY`: Carousel and flip controls do nothing without course scripts, and laid-open slides would otherwise expose them; they still occupy the page (the inspection content-visibility requirement).
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `crowds`: Handles never overlap, and keep WCAG 2.5.8 spacing: a 24px circle centred on either handle misses the other's box, and two undersized (item) handles' circles miss each other. Touching 24px handles pass; the 390px gutter has no room for a gap.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: A read-only page view (preview inspection) receives patches and feedback only. It keeps the learner's Tab stops, clicks and served hidden state; it has no handles.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Unpredictable per mount: a course element with a guessed id placed earlier in the document would win the handle's aria-describedby and rewrite what assistive technology reads. The renderer's own ids (praxity-ag-question-…, praxity-config) stay untouched.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Any frame node removal ends Chromium's typing group; close is the safe boundary.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Inspection handles live in the top layer, above any course stacking context, overlay or clipping ancestor, while staying beside their node in the DOM for reading and Tab order. An engine without the Popover API keeps fixed-position handles.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Declare the guard layer first in document order so its important rules precede every course layer.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `describeHandle`: Removing even an unrelated text node splits Chromium's native typing group.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `syncChromeTheme`: Retain the public theme marker, but select editor chrome tokens only through the private admission marker.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: The private handshake can finish before an exported stylesheet loads in Gecko.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `admitFragment`: Only a patcher-admitted subtree can replace a retained descendant's identity.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `fragmentElement`: Once admitted, authored mutation cannot redirect a patch to a duplicate marker.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `readFragment`: Patches pass the same strip as the served inspection document.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `orderRegionFragments`: Deck order includes its slide boundary. Reconcile that boundary with the existing slide rather than creating a nested, duplicate page ID.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: A display:contents node (a matching pair's row) has no box; its contents do.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `liveControls`: Detached controls still supply their final native caret during replacement.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `focus`: A settlement command can arrive after native focus moved, before its report reaches the host.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `focus`: A focused native field owns its caret; the host selection can lag typing.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `focus`: Gecko keeps focus on the frame body unless its browsing context owns focus before an explicit cross-document control focus command.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `reveal`: Without course scripts, later card slides and conditional blocks keep their hidden server form. Neither has a visible anchor for its handle, as a tab does, so the lens lays them open to keep every handle in the Tab order (the inspection keyboard-order requirement).
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `reveal`: Slides share one grid cell; stack them instead. Record the original inline style, then add to it so its custom properties survive.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Course CSS can key a node's visibility to its handle's state, because the handle is its preceding sibling: `:popover-open + *`, `[data-selected] + *`, `:focus + *` or the same through `:has()`. Showing a handle would then hide its node, and hiding the handle show it again. When a node with an open or focused handle has no box, every handle is measured again in a neutral state: closed, without its state attributes. Focus and pointer hover cannot be neutralized, so such a handle keeps its node's last box. Course selectors can always see a sibling's pseudo-classes and aria-expanded, so the lens neutralizes state for measurement rather than hiding it from selectors.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `measureNodes`: Only CSS can key a node to handle state. A node the lens or course hides with markup (a tab panel's hidden attribute on every Tab to a tab) is simply hidden, so legitimate flows never run the neutral pass.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `measureNodes`: The focused handle keeps its aria-expanded: removing and restoring it in one task can still reach assistive technology. Its other state is neutralized like any handle's, or CSS keyed to it would hide its node's descendants too.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `measureNodes`: Remember each node's last box, also while it has none, so neutral-state measurement can fall back to that box while the node's handle has focus or hover. Nodes that are rendered always use their current box: the fallback applies only to a node with no box.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: One write pass before any measurement, so engines lay out once (WebKit pays for each show interleaved with reads). At first mount this order paints item handles above block handles (z-index 11 over 10); later re-shows append, and raise() reorders only the focused handle and nested popups.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Inserting or moving a handle (a patch replacing its node) closes it.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Course CSS can hide a probe or its parent (`:has(> probe)`, `probe ~ *`), which also collapses the page and resets its scroll while the probe is there. A handle cannot be restyled, so top-layer handles avoid probes where they can. Their containing block is the viewport, so in Chromium and Firefox the only scale is the inherited CSS zoom that currentCSSZoom reports. WebKit lacks it and offsets top-layer handles by a transformed ancestor, so a placed handle is its own probe: its rendered box against its inline translation yields the origin and scale. Only a handle never placed needs a probe there.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Rendered boxes snap to layout units, so a self-measured origin wobbles by a fraction of a pixel; keep the last exact origin while it agrees.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: A probe that measured nothing leaves the parent's last good origin, else the viewport's, so every handle is still placed.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Read every anchor before writing handle geometry. A style write invalidates the following getComputedStyle/offsetHeight even when no content moved.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: A horizontal tab's local left edge is between labels. All its item handles use the tab list's gutter, in source order, within the tab row. Fixed-position coordinates are quantized separately from DOM rectangles in WebKit/Firefox. Keep centres just inside the measured boundaries.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: A local column gutter can be inside its neighbour's content box. Protect peers as well as controls, including after their text reflows.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Containers stay on their own first line. Adjacent gutter lanes keep short child boxes reachable without moving handles below their nodes.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Nested nodes clamped to a viewport edge, or a one-line container and its child, can fill every lane beside the node. The nearest free slot beyond it still points at the node; a shared slot would hide one handle.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: A gutter full for the whole viewport height is the only way to reach the last fallback; it still keeps content clear (the inspection content-visibility requirement).
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Never throw from placement: a failed pass would leave every handle stale. A focused handle keeps its last place; any other handle waits for the next pass.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `position`: Expanded targets may share the gutter, but must never steal another handle's visible button. Keep the 44px extent and cut out those boxes.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Top-layer chrome paints in the order it was shown, so z-index no longer orders it. Re-showing the focused handle keeps it above its neighbours; re-showing open nested popups then keeps every handle beneath them.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `retainFocus`: Moving a retained control with insertBefore drops native focus in all engines.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: A retained source must not rebind to an authored duplicate after a miss.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: The course's learner announcements are inactive while authors inspect it.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: Explicit off overrides implicit live roles, including native output.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: A detached source control still holds the caret at the instant of the patch. The controller view may still be in transit; never save a DOM node in session state.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: Compiler node IDs remain intact. Authored chrome claims confer no trust and must not activate the chrome CSS or masquerade as compiler nodes.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: Invokers could open course dialogs or popovers over the handles.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: A tab's handle is placed on its tab but read before its panel, so Tab passes through each panel's children before the next tab (the inspection keyboard-order requirement).
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: Learner card semantics must not contain editor buttons during inspection.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `refreshContent`: Inert only the embed wrapper, never the owning block or its handle.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `pointer`: Gecko can keep native focus on body after a retained iframe resumes.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `pointer`: Keep the source's native owner until the click's queued select is delivered.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `sourceInput`: Trusted input can arrive after the author has already moved native focus.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `key`: Native Tab moves now; the controller keeps main's field lifetime until save replies.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `key`: Native undo/redo owns dirty text. Only its base boundary is an editor action.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Course CSS can cover the page or switch off its pointer events, so the event target says nothing about the node under the pointer. Hit-test the node boxes measured by the last placement pass instead; the hit that contains no other hit is the innermost node, as the event target's closest node was. A handle under the pointer names its own node. Each placement pass hit-tests the last pointer position again, since scrolling moves the boxes.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `hover`: Only leaving the document ends hover; moving between elements changes nothing.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `hoverAt`: Compare per button, not against a cached id: a patch re-creates handles, and the new handle of the hovered node needs the attribute too. Unchanged values write nothing.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: A handle sits in its content, so a transformed ancestor is its containing block. A course animation or transition (a flip card's back face rising in) can end that transform without resizing anything; measure again then. Handles' own transitions move nothing.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `renderFeedback`: A function replacer keeps `$&` and similar patterns in diagnostics literal.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `renderFeedback`: Page diagnostics do not identify an offending node. The banner and descriptions carry that failure without obscuring every node's text.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `registerChrome`: Caller-owned chrome keeps its markers. In particular, the learner restoration map must not retain detached measurement probes.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `mountPageLens`: Field and popup adapters admit controls by reference. Markup is never admission.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `PAGE_LENS_CSS`: Frame chrome takes the course's scheme, independently of the editor shell.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `chromeToken`: Literal values: a course can override or re-register a custom property, never a literal.
- `packages/editor-core/src/frame-bridge/page-lens.ts`, `handleGuardCss`: Course CSS shares the frame document and knows this markup. Every handle declaration is !important inside a layer that the lens declares before any course stylesheet: important declarations in the earliest layer outrank all later author CSS, layered or not, including pseudo-elements and states that inline styles cannot reach. The per-mount name stops a course joining the layer or registering the hit-clip property. positionFixed's inline !important geometry still outranks the layer.
- `packages/editor-core/src/frame-bridge/patch.ts`, `RenderFeedback`: Paint feedback only. Save state is the controller's durable result (see preview.ts).
- `packages/editor-core/src/frame-bridge/patch.ts`, `createFramePatcher`: Draft sequences belong to a subscription epoch, durable sequences to individual fragments.
- `packages/editor-core/src/frame-bridge/patch.ts`, `resetDraftEpoch`: The resynced page replaces painted drafts, even at a revision already applied.
- `packages/editor-core/src/frame-bridge/preview.ts`, `connectRenderPreview`: Only the authenticated host stream enters here. Frame events return on its private bridge. Save state is the controller's durable result, reported through `settle`; the frame only paints.
- `packages/editor-core/src/frame-bridge/preview.ts`, `status`: Announce settled outcomes through the live region. Keep Saving… visual to avoid repeated progress speech.
- `packages/editor-core/src/frame-bridge/preview.ts`, `connectRenderPreview`: Grammar diagnostics name their op.diagnostic catalogue entry. The frame shows that text in the author's language; a code without an entry keeps the compiler's message.
- `packages/editor-core/src/frame-bridge/preview.ts`, `connectRenderPreview`: A new stream lost the old one's events: drop drafts and resync the page. Saves in flight stay Saving… until the controller settles them.
- `packages/editor-core/src/frame-bridge/preview.ts`, `connectRenderPreview`: Submit complete node source, including its authored closer, before the durable request. A preview refusal paints nothing and leaves the save to `settle`.
- `packages/editor-core/src/frame-bridge/protocol.ts`, `checkedOrigin`: The browser editor uses explicit HTTP origins. Opaque/file origins cannot authenticate this bridge.
- `packages/editor-core/src/frame-bridge/source-field.ts`, `mountSourceField`: The root's display mode stays admitted for this editing transaction. The body remains course-owned, including flex/grid layout and deliberate hiding.
- `packages/editor-core/src/frame-bridge/source-field.ts`, `syncGeometry`: Important shadow rules outrank even inline host geometry in the outer tree.
- `packages/editor-core/src/frame-bridge/source-field.ts`, `mountSourceField`: The native field owns text and editing history until this draft closes.
- `packages/editor-core/src/frame-bridge/source-field.ts`, `mountSourceField`: Preserve native typing groups across repeated diagnostic projections.
- `packages/editor-core/src/frame-bridge/source-field.ts`, `mountSourceField`: Course patches may replace or move the slot, never the native editing group.
- `packages/editor-core/src/frame-bridge/transport.ts`, `startInspectionFrame`: Every event after `ready` travels on this private port, never as a window message.
- `packages/editor-core/src/frame-bridge/transport.ts`, `receive`: Port order releases native focus even if an earlier focus command just landed.
- `packages/editor-core/src/frame-bridge/transport.ts`, `receive`: WebKit needs the child root inert as well as the host iframe. The nonce CSP keeps course scripts from clearing or replacing this root.
- `packages/editor-core/src/frame-bridge/transport.ts`, `attempt`: WebKit may refuse an available control across several frame-entry paints.
- `packages/editor-core/src/frame-bridge/transport.ts`, `startInspectionFrame`: A document still waiting for subresources may leave without pagehide.
- `packages/editor-core/src/frame-bridge/transport.ts`, `connectPageFrame`: "null" describes the sandboxed realm; it is never an identity. Admission still requires the current WindowProxy, fresh channel and one private port.
- `packages/editor-core/src/frame-bridge/transport.ts`, `connectPageFrame`: Only the admitted document holds the other end. A window message would reach whatever document the frame navigated to.
- `packages/editor-core/src/frame-bridge/transport.ts`, `receive`: Only the private bridge port carries editor authority. A correctly shaped postMessage from the authentic course window is insufficient.
- `packages/editor-core/src/frame-bridge/transport.ts`, `prepareSwap`: A WindowProxy survives navigation. The old document can still queue ready envelopes during a swap, so it must not know the next channel.
- `packages/editor-core/test-support/message-window.ts`, `nativeMessageWindow`: DOM seam for protocol tests: jsdom cannot deliver cross-origin native messages. Browser specs exercise native isTrusted, origin, source and port transfers.
- `packages/editor-core/test-support/native-input.ts`, `nativeInput`: jsdom seam only; browser specs prove genuine input admission.
- `packages/editor-core/vitest.config.ts`, `test`: Collect co-located test files too. The previous `__tests__`-only pattern silently skipped more test files than it ran, including the a11y checker's, which is how an image-alt regression reached the publish gate.
- `packages/editor-core/vitest.config.ts`, `test`: The Page lens reads its handle colours from the raw token sheet, which Vitest would otherwise replace with an empty string.

## Consequences

Preserve these constraints when changing this area. Sources are the named symbols and their explanatory comments at commit bed54f6, before this comment-only change. The [frame bridge guide](../../packages/editor-core/src/frame-bridge/README.md) and [coding standards](../../CODING_STANDARDS.md#frame-bridge-and-editor-trust) describe admission, browser evidence and remaining limitations. Unit-test DOM seams do not establish native browser behaviour.
