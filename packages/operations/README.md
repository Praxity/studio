# Source operations

`@praxity/operations` plans grammar 4 edits without reading or writing files.
Hosts supply the current identity resolution, a UUID allocator and SHA-256 over
UTF-8 text. Source edits, identity mappings, evidence and guarded exact inverses
return together. The operation service owns durable writes and history.

The [operation reference](../../docs/prax-format/reference/operations.md)
defines requests, arguments, owned ranges, identity fates and refusals.
Contract types belong to `packages/grammar/src/operations/contract.ts`.

Run `pnpm --filter @praxity/operations test`. Public-interface tests cover item
and column operations, schema-declared conversions, wrapping, merge, replacement,
escaping drafts, stale guards, mixed line endings, descendant identity and exact
undo. Four 1,000-seed structural gates cover the core registry, item/column operations and
conversion/wrap/merge/replace operations and multi-file cut/paste/page operations. The converted leadership and toolkit corpus supplies
an additional byte and undo gate.

Edited descendants use content-identity's exact matching and reconciliation
kernel. The O2 gate adds 1,000 seeded edits covering similar descendants,
below-threshold rewrites, recorded copies and external unresolved duplicates.
Every case checks complete mappings, unchanged bytes and exact undo.

`editInline` accepts guarded token ranges on one or more node targets. Link text
and destinations change separately through the existing URL policy. Glossary
definitions resolve to their definer, and rename-one or rename-all keeps authored
formatting across the course. Glossary requests bind every lesson revision.
The inline 1,000-seed gate checks owned ranges, UTF-8 bytes, complete identity
fates and exact undo/redo. Converted-course fixtures cover LF, CRLF and mixed endings.

Cut, paste and page edits return one result with every participating file's base
revision. `clipboard` is the next cut record; `clipboardText` supplies source for
editor Copy and Cut. Persist the cut record with source and identity through T1.
A matching cut paste keeps all IDs; later pastes allocate. A mismatched paste
leaves the cut waiting. Editor Copy, another Cut and Discard retire the old cut.

`applyInverse` accepts `{operation: recordedAppliedOperation}` and current file
bases, with no targets. It checks written slices, deleted IDs, sibling boundaries
and clipboard state before returning any edits. Metadata restoration guards only
fields changed by the forward operation. ID anchors allow unrelated edits
to shift the inverse; unrelated kept nodes retain their current files and IDs.
Its result has a guarded inverse for redo. The host owns
history storage and durable application; this package performs no file I/O.

`planInverseGroup(files, {transactionId, operations}, context)` takes server-owned
records in application order. It plans their inverses newest first against private
in-memory source, identity and clipboard states. Any member refusal returns only
the refusal, including when earlier members have already planned successfully.
The original inputs remain unchanged. The successful plan contains `before`,
final `after`, final `identity` and `clipboard`, and inverse `members` in their
application order. Pass those members back as `operations` to plan the whole redo.
Each member retains its ordinary guarded inverse, evidence and identity snapshots.
Groups above `MAX_INVERSE_GROUP_MEMBERS`, five, refuse with `invalid-args` before
any inputs are cloned. The cap is a refusal backstop, not a grouping rule. D16 keeps
one source session as one history entry, so the service never splits a session at
the cap. It coalesces a session's commits into one record per node at commit time.
Parsed intermediate documents stay private to this planning call and are reused.

This is a host planning API, not a transport request or a single `AppliedOperation`.
The service must admit the current inventory, plan the complete group, then persist
all member snapshots and final files in one transaction. Installing members
sequentially would violate the all-or-none contract. Hand the issued plan to the
identity store; never pass `plan.identity` through as data. Within the admitted
transaction, the store invokes the service's consumption callback, which calls
`consumeInverseGroupIdentity(plan, binding)`.
The binding contains the admitted `identity`, `before`, final `after`, `readerRoles`
and `members` in inverse application order. Each member binds its `operations`
evidence and the server-owned forward record's `restore` triple of
`{identity: record.history.identity, written: record.identity, mapping: record.inverse.mapping}`.
Consumption returns a private copy of the final identity. An unissued or mutated
plan, a different binding or a second consume throws `identity-plan-unissued`.
The source-owner check permits named imports of both functions only in the
operation service, which supplies the plan and binding to the identity store.
Service persistence and controller grouping remain separate integration work.
