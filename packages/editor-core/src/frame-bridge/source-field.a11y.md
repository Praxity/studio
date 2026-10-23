# Source field accessibility decisions

Owner decision, 2026-10-14. F11 and UI-SPEC U6 normally keep editing controls beside their rendered node. The source field has an approved exception. Its editor-owned host stays at the end of the inspection document, outside replaceable course fragments. Visual anchoring does not change its screen-reader reading order.

The placement research compared editor-owned overlays, retained in-place editors, state-preserving moves, ARIA ownership, dialogs and a host-side panel. The chosen construction preserves the connected native textarea during fragment replacement. It keeps course styling out of the editing controls and avoids moving the active editing transaction.

## Chosen mitigations

- F2, Edit source and outline entry focus the actual textarea directly. Escape and Mod+Enter return to the owning handle, resolved by admitted ID after replacement. M5/M6 pointer and keyboard exits keep their destination focus. This departs from the owner's blanket return-to-handle wording. Returning a Tab exit to the owner would make the next Tab enter its field again, trapping navigation at that block. Returning a pointer exit would override the author's chosen destination. After the field closes, these destinations are already in course order. Shell exits keep shell focus under F8.
- Escape closes on the first non-composing Escape delivered to the page. The visible caption says "Escape to finish". The description carries context, without the Escape hint.
- An inner `group` is named "Source editor", with the interface language. It is neither a dialog nor a landmark.
- The field description uses the naming owner's distinguishing name, the view's position without transient handle states, its parent's name and the Shift+Tab route. Typing does not change this context. It omits a name already in the field label and the root page's self-reference. Source names omit position phrases because the description already gives position once. Handle and outline names keep their existing positions. The visible caption contains only the Escape hint, leaving the field's name to its label. Caption, context and diagnostic IDs stay inside the owned shadow tree.
- The owning handle remains expanded while source is open. Closing clears this state unless its menu is open. Geometry passes preserve the source owner's expanded state.
- Open and close add no live announcement. Removing the edited block announces once, politely, that the draft is kept. The controller retains the orphaned draft and focuses a surviving neighbour. The announcement has no draft action control to reach; Put back and Discard controls remain deferred.
- Suspension announces once, politely, that source editing is paused and the draft is kept. The existing session announcer lives outside the retained canvas subtree so hiding that subtree does not hide this message. Ordinary hidden effects remain suppressed; resume does not replay speech or focus.
- The Page lens routes Tab through admitted controls in this order: handle, field, chips, next handle. Reverse navigation follows the same order. Group exits delegate focus to the controller, avoiding a second native focus racing its reply. Composing and IME-229 keys keep their native behavior. Registration and source identity remain the authority, including after handle replacement.
- Context and caption updates change existing text nodes only when their value changes. Routine geometry and projection do not rebuild the native field's tree.

## Rejected approaches

- Naming the outer group "Source of Note" as well as the field. The inner group instead has the distinct name "Source editor".
- Using the caption as the field description. It carried the Escape hint into focus speech; context now has its own description.
- Positioned source names alongside a position description. They repeated the same position; only the description carries it now.
- Local field-exit focus plus controller focus. Their two focus writes raced reverse Tab in WebKit; the controller owns the exit.
- A caption repeating "Source of Note" before a field with the same label. Browse mode encountered the name twice; the caption now contains only the visible Escape hint.
- Handle state text inside the field context. Clean-to-dirty changes altered the focused field's description; the position projection now excludes those states.
- Moving the native field beside each replacement fragment. Earlier Chromium and Firefox probes lost native editing history across those moves.
- Freezing every ancestor during patches. That would also freeze unrelated course content and require a different reconciliation contract.
- Using `aria-owns`, `aria-flowto`, positive tabindex or a duplicate editable field to claim adjacency. None is part of the admitted focus construction.
- A modal dialog or application role. The field remains part of editing the course, with ordinary native text input and keyboard exit.

## Evidence and limits

`source-field.test.ts`, `source-context.spec.ts` and `source-input.spec.ts` check context, state, native focus, exits and draft retention. The source-field, frame-geometry, lens-reveal and staged host/outline browser regressions retain their native undo, composition, isolation and admission checks.

Automated focus and role checks establish no spoken-output result. NVDA with Chrome and Firefox, and VoiceOver with Safari, still require recorded speech. In particular, whether NVDA consumes the first Escape remains unverified. The AT runbook and captured screenshots are held with the implementation evidence. The owner judges the reading-order exception after those runs.

## Restack onto main

2026-10-15. Main's field lifetime from #1612 supersedes the immediate-close behavior of the former slice 12 stack. A dirty field remains open until its save reply. Escape commits on the first delivered non-composing press; closing and the return focus follow the existing controller reply. Shell and pointer exits retain main's behavior. This slice adds no shell-leave listener or separate leave protocol.

Tab follows the same admitted handle, field, chips and next-handle order while the save is pending. Native focus moves at the key press; leaving the group sends the existing select event with its captured source input. The controller owns commit, selection and reply focus. Shift+Tab returns through the still-open field. Once the field closes, reverse navigation follows the surviving handles. `source-tab.spec.ts` checks both the ordinary route and empty Note, pending Escape, Tab away and back, reply, then Delete with full durable-file assertions.

The former orphan-action UI is superseded by the owner's planned local history after the switch. This slice retains existing draft retention and neighbour focus without adding those controls. The earlier placement and AT evidence remains historical; a new head needs its own spoken acceptance.
