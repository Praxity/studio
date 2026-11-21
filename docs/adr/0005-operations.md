# 0005: Atomic source operations and undo

## Status

Accepted. Records existing behaviour.

## Context

Operation plans and their inverses bind exact source revisions and identity evidence across all participating files.

## Decision

### `packages/operations/src/diagnostics.ts`

- `sourceDiagnostics.invalid`: Reader projections have no source node and never replace syntax diagnostics.

### `packages/operations/src/evidence.ts`

- `bindAllocatedEvidence`: Replay must install the IDs returned to the host, including allocated descendants.

### `packages/operations/src/index.ts`

- `canvasTextFields.option.accepts`: Markers belong to the response, even when pasted into the label's text slice.
- `canvasTextFields.part.range`: Reader result roles already resolve shared and promoted feedback to its source part.
- `canvasTextFields.body.range`: The tree resolves unknown named-part candidates to ordinary paragraph text.
- `canvasTextFields."list-entry".accepts`: Numeric prefixes are inline text after the item's marker; later lines reparse in context.
- `textField`: Exact scalar ranges are shared by ordinary operations and canvas eligibility.
- `canvasTextRefusal`: Reparse the whole lesson so a scalar edit cannot change its structural nodes.
- `canvasTextRefusal`: Only rendered question feedback treats timing words as settings. CLI setText retains timing edits; option feedback always treats these words as prose.
- `canvasTextRefusal.shape`: Headers, markers and settings lie outside the field; its exact field range rejects text that reparses into any of them. Paths retain ownership. Continuation bounds need no separate guard: the exact field bounds and unchanged outside bytes already contain their parsed children.
- `AppliedOperation`: Hosts persist these snapshots atomically with the planned source edits.
- `InverseGroupRequest`: Host-owned records in their original application order, never client-supplied inverses.
- `InverseGroupPlan`: No member may be installed alone. Persist every member snapshot and the final files together.
- `InverseGroupPlan.members`: Inverse records in application order; pass this list back to plan the whole redo.
- `InverseGroupIdentityBinding`: The store binds every intermediate inverse to its server-owned forward record.
- `consumeOperationIdentity`: The host supplies its admitted inventory, never a client-provided resolution.
- `RootPlacement.insert`: An inserted root's offset inside its base-revision insertion edit.
- `RootPlacement.preserveDescendants`: A reparented root keeps its descendants even when the transaction also retires wrappers.
- `boundaryAt`: Pages own separator trivia. Within an explicit parent, a gap can fall before the preceding page's span ends, so classify it by child starts.
- `boundaryAt.before`: Without an explicit parent, an interior offset anchors before its child so the boundary stays adjacent even when the edit starts inside a node.
- `applyOperation`: Pure all-or-none planning. Hosts own writes, rebasing and history application.
- `apply`: Lookup names are vocabulary, unlike free author text. Validate even when a supplied text replacement means this adapter would otherwise ignore type.
- `apply`: Glossary scope is the complete course, with a base guard for every lesson.
- `apply.push.targets.state`: A page break authorizes the following siblings' new owner, without editing their bytes.
- `apply`: An untouched item insertion draft writes nothing, including in an invalid empty container.
- `apply.emptyPart`: Ordinary setText retains insertion into empty parts and caption clearing. Canvas admission separately refuses empty text before applying the operation.
- `apply`: Removing or moving the final child also removes its empty item owner. Plan these edits against the base tree so history still has one exact inverse.
- `apply.deleteOwner.range`: A move can insert at the owner's outer boundary, inside adjacent deletion trivia.
- `apply.incoming`: A same-owner reorder removes bytes at one boundary and inserts them at another.
- `apply.inlineDocument`: Structural cleanup can extend the edits after inline policy validation.
- `apply`: An opaque lesson has no admitted source nodes; the host preserves its stored graph.
- `apply.forEach`: The transformation preserves the declared item sequence; no content matching happens here.
- `apply.evidenceFiles`: Identity resolution owns reconciliation, ID allocation, pending records and inverse mappings.
- `apply.groups`: Unchanged surrounding nodes are modify evidence, separate from copy/insert/delete intent.
- `apply`: A moved slice has neighbours at both ends. Its written guard protects the node itself; both boundaries protect the destination's neighbours.
- `apply`: Source replacement can retire rebuilt parts inside a surviving written root.

### `packages/operations/src/inline.ts`

- `planInlineEdits.glossaryErrors`: Grammar owns glossary validity. Compare its course checks before and after the complete plan.

### `packages/operations/src/inverse.ts`

- `MAX_INVERSE_GROUP_MEMBERS`: Review timings: five saves took 25 ms for one lesson; twenty took 1,671 ms for twenty lessons. A refusal backstop that bounds synchronous work and record cloning. A source session remains one history entry; the history owner coalesces its records per node rather than splitting history at this limit.
- `consumeInverseGroupIdentity`: Single-use registry evidence, checked against the store-admitted base and server-owned records.
- `planInverseGroup`: Plan newest-first against private intermediate states; hosts install the whole plan atomically.
- `applyRecordedInverse`: Recorded source and ID anchors let unrelated edits move the protected inverse slices.
- `applyRecordedInverse`: Clipboard changes are history conflicts just as written source changes are.
- `applyRecordedInverse.currentDocuments`: Identity also maps virtual reader parts, such as page titles. Only parsed children participate in structural insertion boundaries.
- `applyRecordedInverse`: Discarded placements never return; a durable donor can be pending without a placement.
- `applyRecordedInverse.keepCurrent`: Only an outside cross-file move follows the current location. A move by the recorded operation itself must still return to its original file.
- `applyRecordedInverse.root`: A compact edit can retire a descendant without covering its whole span. Its exact written ancestor guards the recorded relative position.
- `applyRecordedInverse`: Preserve current unrelated nodes using exact translated locations, without old fingerprints.
- `applyRecordedInverse`: Redo retains the forward operation's written scope, even for compact edits.
- `applyRecordedInverse`: An empty inline value belongs to its written node, not to a sibling insertion boundary.
- `applyRecordedInverse.removed`: Reinserting a deleted node uses its surviving structural parent. At a page's end, containment alone would guard the last block instead of the neighbouring page.

### `packages/operations/src/ranges.ts`

- `minimalEdit`: Trim shared bytes without splitting surrogate pairs or CRLF terminators.
- `canvasTextReplacement`: Subject edges are parser whitespace; other fields retain their authored spaces.
- `preserveTextWraps`: Match wraps by their text boundary so removing one cannot shift later terminators.
- `preserveTextWraps.anchor`: An unchanged, unique adjacent line also anchors wraps inside separate word edits.
- `translateRange`: An insertion at a node's end remains outside that node.
- `escapes`: Reparse in place and compare the scopes and interpretation of every untouched node.
- `escapes`: Ancestors may change their body, but fixed headers/closers must retain their owner.
- `escapes.appendedEnding`: Appending after an unterminated EOF line gives that existing node one terminator. Its authored bytes and ownership must still match exactly.

### `packages/operations/src/transforms.ts`

- `conversionEdits.number`: Existing response text is the new response list. Only schema-declared state/roles disappear.
- `conversionEdits.template`: Missing target scaffolding comes from its schema template, never interface copy here.
- `replacementText`: Standalone drafts must parse as exactly one block, excluding page or delimiter escapes.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the regression cases in `packages/operations/__tests__/`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
