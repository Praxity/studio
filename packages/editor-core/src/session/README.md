# Session controller

Import `createSession`, `dispatch`, `nodeNames` and `historyView` from
`@praxity/editor-core/session`. This entry point has no UI imports.

`dispatch(state, command, deps)` returns a new state and data effects. Commands
contain logical node IDs, roles and source addresses. Keep state outside the
reloadable preview frame. Send `focusChanged` when the browser reports focus;
send `restoreFocus` only when a patch lost that focus.

The layer stack owns Escape. Popup and dialog commands snapshot their target,
revision and draft ID. Submenus and dialogs inherit their chain's target.
`menuOperation` snapshots that target before closing the chain and emits no
intermediate handle focus. The controller also owns multi-node selection.

The host supplies current grammar/identity snapshots through `readDraft` and
`focusNeighbours`. The latter returns next sibling, previous sibling, parent and
page candidates; the controller chooses in that order for outside removal.
Successful operations already return their survivor or deletion focus through
the operation contract. `nameOfFocus` uses `nodeNames` in the current interface
language. Schema label keys are encoded with underscores inside the
`session.labels` catalog branch so parent and item keys cannot collide.

For selection, supply `selectionNodes` with the current lesson in preorder,
including pages, blocks and container items. Each record has its durable ID,
file, lesson ID, page ID and parent ID. Supply the updated snapshot before
operation/history replies and outside-change events. Unknown or cyclic parent
chains fail loudly. Selection is normalized to document order with ancestors
covering their descendants. Across pages, a block range uses top-level blocks.

Map plain, Shift and Mod pointer gestures to `select` with no mode, `range` or
`toggle`. `selectionKey` accepts previous/next/start/end for Shift navigation,
toggle for Shift+Space, membership for outline Space, all for Mod+A, level for
the Select menu's sibling action, and clear. Mod+A selects the focused node's
siblings, then the page's top-level blocks; another press keeps that page scope.
Selection gestures and changing the focused node reset this cycle. Shift+Space
pins a singleton that follows focus; outline Space removes it. Extended
selections stay while focus moves.
Source fields keep native text selection. A modified pointer gesture while
editing waits for a successful save; a refusal keeps the field and selection.

`selectionView` supplies explicit membership, selected handle descriptions,
count/drag text, unresolved suggestions and action availability. The host maps
membership to outline `aria-selected`, handles, highlights and the clear button.
`selectionAllowed` supplies grammar/service eligibility, including column counts,
allowed children and conversion targets. Use it for menu descriptions and supply
specific operation arguments when checking a particular conversion or wrapper.
The service still validates every member and commits all or none.

Use `selectionOperation` for a whole-selection action. Move to supplies one
`destination` with a guarded insertion target and its revision. The request
contains every selected node and then that destination, with one revision per
file. Direct and menu operations on selected members use the same guards and
target expansion. Directional moves require adjacent siblings on one page.
Menus capture all selected targets when opened and keep their exact bytes and
revisions through submenus and outside changes. Direct request expansion keeps
the caller's transaction ID and supplied guards; it never refreshes stale bytes.
Copy emits a `clipboard` effect with saved source and target references; the
adapter writes the clipboard. A draft is never included in that source.

Supply `reviewSuggestions` with unresolved IDs, owning node IDs and logical
bubble focus, in navigation order. `reviewSelection` focuses the first bubble
without changing selection. Delete/cut acknowledgements emit `reviewReplaced`
for affected suggestions, including descendants of selected containers, using
the operation transaction ID. The review adapter owns persisted replaced state
and its history inverse in R2. Copies have no suggestions because they have new
IDs. Accept/reject preserve selection. Selection snapshots before and after an
operation restore members, anchor, pin state and focused member on undo/redo.

Draft seeds carry the exact owned bytes in `expectedText` and the field's slice
in `editableText`. Container closers stay out of the field. Source lens seeds
address the lesson root, use the entire file and set `scope: "file"`. Only Page
lens has the Page layer stack. Print and Playback refuse source opening.

Typing dispatches `changeDraft` without RPC or parsing. Schedule `tick` for the
150 ms validation, 1 s persistence, 2 s Source-lens save and announcement idle
deadlines. `validateDraft` parses in place using the grammar/operation owner.
`helperTokens` supplies tokens with a stable structural-line identity. Helper
application emits `nativeText/insert`; the field adapter performs one native
input transaction and reports the resulting text through `changeDraft`. It
must check the supplied draft ID and generation immediately before insertion.
Neither a helper nor a render assigns the native field's value to apply a choice.

Map effects to the host's service methods:

- `operationApply` receives the shared revision-bound operation request. Reply
  with `operationReply` only after an all-or-none commit or refusal. Successful
  acknowledgements include the service's opaque `historyId`.
- `draftResolve` is read only. Reply with the draft ID, generation, supplied
  epoch and resolved target. The epoch belongs to that draft's file, so an
  unrelated file change cannot invalidate its response.
- `persistDraft` maps to server draft put/remove, outside browser storage.
- `historyApply` contains only `transactionId`, `historyId` and `direction`.
  Strip effect routing fields before forwarding it. The service owns the inverse,
  its guards and the next direction. Return the acknowledgement through
  `historyReply`, retaining the same history ID. A refusal leaves the cursor in place.
  Transaction and history IDs must both match before a successful reply is applied.

Pass the project service's existing `seq` through operation and history replies.
`revisionSeqs` retains the highest admitted service sequence for each file, so
an older acknowledgement cannot replace a newer source revision. This metadata
stays outside executable history. Adapters without a project sequence retain
the revision-only contract.

The project owner sends `sourceSnapshot` with the admitted file revision and
snapshot `seq`. While a write is pending, it retains the latest snapshot and
sends it after the reply in the runtime's command queue. The controller ignores
snapshots below the admitted sequence. A differing revision, including bytes
read at the same sequence before the outside-write notification, runs
the outside-change transition; a rebased acknowledgement also runs it when its
`fromRevision` differs from the request base and the already classified revision.
Acknowledgements raise the project's snapshot floor across lesson close/reopen.
A commit reply settles pending state and records history immediately, without
reading its target. Session-only acknowledgement metadata binds the draft's next
source seed to the receipt's revision and exact written-node guard. A matching
snapshot refreshes its guard while retaining the submitted native text as
`baseText`. Canonical LF and closer bytes belong to the saved range guard;
they never replace the active field's text or native undo boundary.
A different revision uses D11 resolution. Unchanged saved-node bytes prove the
save even when another node changed; different bytes retain author text with the
outside version for Keep, Use the new version and Compare. Contiguous own writes,
including undo, advance an outstanding proof to their resulting revision and
revoke the old saved-byte proof. Original receipt bytes remain a comparison for
the native baseline, never a write proof. A superseding own edit to that source
retains the existing source replacement behavior when there was no later typing.
An own write that removes the saved node keeps
the text as an orphaned draft and clears its acknowledgement. Resolution uses the
receipt's written-node address, including for a saved insertion and a generation
retry. A missing snapshot focus goes through resolution before any node read.
Another commit announces when source admission is still
pending. Recording a receipt revokes resolutions requested before that save.
Closing or resetting revokes replies with their originating runtime;
an acknowledgement after lesson close still raises the floor in its stream epoch.
A failed admission read reports its error without blocking the receipt or undo.
A change event folded into a failing read retries source admission once, without
retrying the write. Each failed read is reported once. Later refreshes retry the
read rather than reusing a cached failure; epoch and sequence admission still apply.
Opening another field and restoring drafts seed only an unknown file revision.

Each acknowledged save with source edits creates its own history entry with one
service ID. The owner's 2026-10-14 decision defers D16 session grouping until
after the editor switch, U7 slice 04a. Read-only service availability remains
deferred with that work; no
`historyCheck` endpoint exists yet. The explicit `historyAvailability` command
remains for that integration. Draft discard is a local history entry. Restoring
persisted drafts starts with empty history and held/conflict/orphan states.
`historyView(state, deps)` supplies both toolbar buttons and the newest-first
dialog, translating summaries when displayed so language changes take effect.

Render `announce` through the existing interface translator and one shell live
region. Honour `delayMs` after focus; wrap the listed `courseParams` with the
course's language. The ICU catalog uses `undefined` as an absent optional-clause
selector. Background events are queued until 2 s after typing or the field
closes; send a tick after closing to drain them. Operations/refusals emit exactly
one announcement. Unknown operation templates throw so new registry operations
cannot silently lose speech.

`rule-coverage.json` pins the 109 interaction-rule IDs and reasoned deferrals.
The coverage test reads the current private spec when present, or the path in
`PRAXITY_INTERACTION_RULES`. CI uses the pinned inventory. DOM, live-region lint,
transport durability and screen-reader evidence remain with the tasks recorded
in `pendingEvidence`; these controller tests make no AT acceptance claim.
