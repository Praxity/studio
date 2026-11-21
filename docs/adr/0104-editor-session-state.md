# Editor session acknowledgements and focus

## Status

Accepted. Existing behaviour recorded during comment removal.

## Context

Durable writes, draft text and native focus settle independently. A late reply must not replace newer author input or move selection after the author has moved focus.

## Decision

- `packages/editor-core/src/session/announcements.ts`, `announcement`: Message files own every sentence, including optional clauses and plurals.
- `packages/editor-core/src/session/announcements.ts`, `operationEvents`: Explicit registry-name coverage makes new operations require a speech decision.
- `packages/editor-core/src/session/controller.ts`, `draftPersistencePayload`: Acknowledgements are client bookkeeping, not a change to the stored draft payload.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: History targets Page handles that survive source-field closure.
- `packages/editor-core/src/session/controller.ts`, `finish`: A refused departure or newer typing can retain the field after focus selected elsewhere.
- `packages/editor-core/src/session/controller.ts`, `commit`: Native Tab has already selected its destination before the commit request.
- `packages/editor-core/src/session/controller.ts`, `admitSavedDraft`: A superseding own edit may replace saved source; normalization alone never moves native undo.
- `packages/editor-core/src/session/controller.ts`, `advanceDraftAcknowledgements`: Only a contiguous own write can authorize changed target bytes without the outside-change reconciliation defined by session rule D11.
- `packages/editor-core/src/session/controller.ts`, `operationFocus`: A pinned selection can move while focus is on another node. The operation's survivor then owns focus, within the original UI context.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: A matching predecessor success supplies the next metadata CAS guard, even after validation.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: A write acknowledged after more typing must not close or reset that field.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: A proven seed supersedes any resolution requested from the pre-save guard.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: Discard deleted the acknowledged record; undo must persist it again.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: Durable state settles now; focus-dependent selection waits for the native owner.
- `packages/editor-core/src/session/controller.ts`, `dispatch`: Keep an open field protected when the native adapter declines its reply focus, as required by session rule G10.
- `packages/editor-core/src/session/names.ts`, `nameOf`: Schema labels include parent and child keys, such as categorize and categorize.item. Encode dots inside a leaf key so ICU catalog branches never collide with a label.
- `packages/editor-core/src/session/types.ts`, `AuthorOperationResult`: Author acknowledgement metadata, excluded from executable operation/history evidence.
- `packages/editor-core/src/session/types.ts`, `DraftSeed.expectedText`: Exact whole owned slice, including closer and original line endings.
- `packages/editor-core/src/session/types.ts`, `DraftSeed.editableText`: Editable slice, excluding a container's closer; whole file in Source lens.
- `packages/editor-core/src/session/types.ts`, `Draft.persistenceVersion`: Full payload version, independent of the text generation. Legacy records start at zero.
- `packages/editor-core/src/session/types.ts`, `Draft.persistedVersion`: Last matching successful acknowledgement of that full payload.
- `packages/editor-core/src/session/types.ts`, `Draft.outside`: D11 records the outside version without replacing the author's field.
- `packages/editor-core/src/session/types.ts`, `TargetSnapshot`: Menus retain every selected member's guards from the moment they opened.
- `packages/editor-core/src/session/types.ts`, `HistoryEntry`: Acknowledged operations retained for summaries and source-session grouping.
- `packages/editor-core/src/session/types.ts`, `HistoryEntry`: Opaque service acknowledgements; executable inverses stay server-owned.
- `packages/editor-core/src/session/types.ts`, `Session.draftDisplayIds`: Display bindings for ID-free drafts, held only in the author session.
- `packages/editor-core/src/session/types.ts`, `Session.draftAbsences`: Confirmed absence is a source baseline, not permission to reuse the retired node.
- `packages/editor-core/src/session/types.ts`, `Session.restoredDraftVersions`: Restoration-only metadata changes are not author work to flush at close.
- `packages/editor-core/src/session/types.ts`, `Session.draftAcknowledgements`: Successful saves awaiting a proven source seed; never persisted with drafts or history.
- `packages/editor-core/src/session/types.ts`, `Session.draftAcknowledgements.receiptRevision`: Original receipt bytes distinguish normalization from a superseding own edit.
- `packages/editor-core/src/session/types.ts`, `Session.pendingDraftPersistence.requestId`: A null request ID queues an idle put; a string identifies its in-flight acknowledgement.
- `packages/editor-core/src/session/types.ts`, `Session.replyFocus`: Selection is committed only by the matching native focus acknowledgement.
- `packages/editor-core/src/session/types.ts`, `Session.revisionSeqs`: Service order for admitted source revisions; independent of controller transaction IDs.
- `packages/editor-core/src/session/types.ts`, `Dependencies.validateDraft`: Parses in place, using the owning grammar/operation modules; called only on idle.
- `packages/editor-core/src/session/types.ts`, `Dependencies.helperTokens`: Grammar tokens, never a UI regex; line is a stable structural-line identity.
- `packages/editor-core/src/session/types.ts`, `Dependencies.focusNeighbours`: Resolves by identity/address and supplies F8 sibling/parent/page fallback.
- `packages/editor-core/src/session/types.ts`, `Dependencies.readDraft`: Resolves a successful write's actual owned bytes, path and fingerprint.
- `packages/editor-core/src/shortcuts/registry.ts`, `EDITOR_CONTEXT_ACTIONS`: These contracts are implemented by the adapters' exhaustive handler records. An action existing elsewhere does not make it executable in this context.

## Consequences

Preserve these constraints when changing this area. Sources are the named symbols and their explanatory comments at commit bed54f6, before this comment-only change. The [session guide](../../packages/editor-core/src/session/README.md) defines the controller rules and adapter boundaries. Session rule identifiers in this record refer to that guide and its rule inventory.
