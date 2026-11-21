# 0001: Content identity evidence

## Status

Accepted. Records existing behaviour.

## Context

Identity resolution must preserve history when identical source, moved content and provisional read views overlap.

## Decision

### `packages/content-identity/__tests__/canonical-semantics.test.ts`

- `describeDocument characterization fixtures`: Literal outputs from canonical.ts at 49089c1b4, before semantic memoisation.

### `packages/content-identity/__tests__/inline-projection.test.ts`

- `describeDocument characterization fixtures`: Whole-descriptor bytes captured on main, including canonical, matchText, revisionContent and ranges used by persisted identity and retirement.

### `packages/content-identity/__tests__/self-check-canonical.test.ts`

- `describeDocument characterization fixtures`: Adding reader-only records must ensure that every pre-existing descriptor keeps this baseline.
- `describeDocument characterization fixtures`: Captured from the reader branch after merging main, before prompt projection.

### `packages/content-identity/scripts/history-replay.ts`

- `HistoryConversionProof`: The conversion archive retains this binding with its conversion evidence; it is not manifest authority.
- `replayHistory.before`: Evaluate.py scores each pair independently. Preserve that denominator and oracle.

### `packages/content-identity/scripts/replay-history.ts`

- `module initialization`: Canonical hash of the study's four {old,new,pairs} records, in chronological order. Changing an oracle requires a separately reviewed study, never a local gate override.
- `module initialization`: Archive wrong/lost cases before checking the gate, including a failing result.

### `packages/content-identity/src/canonical.ts`

- `whitespace`: Unicode White_Space plus BOM, shared by descriptors, lexical scores and fragments.
- `serializeIdentity`: Field names recur across every node. Their escaped JSON tokens belong to this serialization only, so callers and later admissions cannot stale them.
- `semantic.body`: Code and math remain literal. The lexer owns their shielding.
- `describeDocument.visit.canonical`: Lessons/pages own metadata/title. Children have separate identities and revisions.
- `describeDocument.visit`: The inline compiler shields code, variables, glossary and other inline syntax from blanks.
- `describeDocument.type`: Offsets and fragment ordinals locate projections; their content matches identity.
- `lexicalScore`: L uses multiset token counts and Unicode scalar trigrams.

### `packages/content-identity/src/files.ts`

- `assertIdentitySnapshotNamespace`: Namespace checks also apply when a store binds an already validated snapshot to a head.
- `assertLegacyIdentitySnapshot`: Parsing the extension does not authorize the legacy matcher to consume it.
- `parseIdentityReadSnapshot`: Package-private parser for the read session's own graphs, never durable ingress.
- `hashIdentitySnapshot`: Plans and retained store records use the same canonical bytes and content address.
- `parseIdentitySnapshotRecord`: Fresh validated data. The retaining store owns this record and its canonical bytes.

### `packages/content-identity/src/mappings.ts`

- `invertIdentityMapping.pendingIds`: Restore prior pending status; a newly invalid draft still undoes to active.

### `packages/content-identity/src/merge.ts`

- `mergeIdentity`: Merge decisions are pure. The caller reads git and installs only a conflict-free result.
- `mergeIdentity.push`: A head must retain retirement history; absence cannot prove deletion.
- `mergeIdentity.lineage`: Numeric offsets shift after disjoint insertions. The merged parse owns order and spans; neither is evidence of a competing entity or content edit.
- `mergeIdentity.documentHashes`: This pool combines records from different source revisions. It cannot claim unchanged-file evidence from either branch, especially for duplicate siblings.
- `mergeIdentity`: Merge commits point at both real branch heads, never at the synthetic reconciliation input.

### `packages/content-identity/src/metadata.ts`

- `canRestoreIdentityMetadata`: Guard precisely the metadata fields the inverse will restore, before parsing inverse edits.
- `restoreIdentityMetadata`: Inverses restore only metadata fields changed by their forward operation.

### `packages/content-identity/src/reconcile.ts`

- `fragments`: Reject multi-fragment coverage, including small tails the study's guard misses.
- `fragments.paths`: Repeated words may give a tail several possible positions. Memoize coverage instead of enumerating every path; monotonic sibling order forbids reusing a part.
- `matchSimilar.targets`: The target set limits accepted matches to the current depth; all unmatched descriptors still compete in the frozen matrix.
- `matchSimilar.oldSiblings.sort`: An absent pending record can share an ordinal and start with a shifted sibling.
- `matchSimilar.score`: Integer weights keep the inclusive .90 boundary exact when L=1 and A=0.
- `matchSimilar.otherOld`: Keep sub-threshold competitors. Filtering them first defeats the mutual margin.
- `matchSimilar`: One machine epsilon compensates for subtraction at an exact .15 margin.

### `packages/content-identity/src/resolve.ts`

- `createIdentityPlan`: One plan owns its inputs. Nothing is retained between operations or file admissions.
- `createIdentityPlan.prepare.descriptors`: Callers own their copies; only this closure can supply prepared evidence to identity resolution.
- `resolveIdentity`: All decisions stay in memory. Hosts own reads, writes, locks and transaction durability.
- `isDurableIdentity`: Never-active records carry no learner history. Consumer metadata still protects an ID.
- `committedIdentityView`: The identity store may retain this view only after proving the complete committed store and sources. Recorded operation fates describe the previous edit, not a later unchanged admission.
- `createIdentityResolver`: Retain validated evidence privately. Callers still supply the complete document inventory.
- `createIdentityResolver.stable`: Pending or changed baseline records do not prove that an untouched head stays fixed.
- `createIdentityReadSession`: Hosts admit bytes before each call and revoke this session on admission errors.
- `createIdentityReadSession.resolveRead.provisionalNamespace`: An absent store has one provisional course namespace until the host installs it.
- `createIdentityReadSession.resolveRead.shown`: The admitted pre-write source proves these locations describe the same nodes.
- `createIdentityReadSession.resolveRead.matched`: These graphs exist only for matching the last read. They never feed the candidate.
- `createIdentityReadSession.resolveRead.allocateRuntime`: A held author snapshot still uses this retired locator.
- `createIdentityReadSession.resolveRead.corresponded`: Retired nodes received UUIDs in this write too; operation fates handle their removal.
- `createIdentityReadSession.prepareWrite`: Prepare under the write admission; publish only after installing these exact bytes.
- `resolve.parseSnapshot`: Only the private continuation call admits the session's own display graph.
- `resolve`: Surrounding placement evidence cannot promote a never-active copy over its donor.
- `resolve`: Copy evidence authorizes the donor's ordered subtree. No external ordinal matching.
- `resolve.resumesCut`: A mapped fresh subtree never steals an exact identity from its original.
- `resolve`: Lesson head path is namespace evidence, not a positional content identity.
- `resolve.add`: Keeping the old path proves a whole-file copy, even when the original was edited concurrently. Its descendants cannot compete for the original IDs.
- `resolve.renameDonors`: Whole-source evidence distinguishes simultaneous renames with identical metadata. A donor path still in the complete inventory is a copy, never a rename.
- `resolve`: An unchanged, uniquely identified file proves its entire ordered tree, including repeated siblings. Pending records still require explicit resolution.
- `resolve.matchExact`: Unique course-wide exact content and exact matches under already matched owners.
- `resolve.matchExact.sort`: Equal durable multiplicity preserves saved source order despite edits elsewhere.
- `resolve.matchExact`: Ordinals are allowed only for an entire unchanged sibling sequence with stable multiplicities.
- `resolve.matchExact.previous.sort`: Projections follow authored children; their shifted ordinals can overlap an absent child.
- `resolve.depths`: Owners precede descendants. Each sibling stage gets one frozen score/anchor matrix; consuming its winners never gives rejected siblings a second, weaker margin test.
- `resolve.conservedRenames`: Metadata-identical lesson roots can remain ambiguous even after every child has a conservative course-wide match. A complete conserved subtree proves the rename without relaxing any child score or choosing a positional winner.
- `resolve.candidateGroups`: An inverse's unplaced pending donor still makes restored copies ambiguous.
- `resolve`: Resolve durable owners before assigning their identical descendants.
- `resolve`: Keep as many IDs at their saved owner as possible before pairing moved copies.
- `resolve.priorGroups`: Placement evidence preserves source locations, but cannot settle an earlier external duplicate. Its provisional IDs and displaced donor remain pending.
- `resolve.pendingDescriptors`: Pending descendants invalidate their export owner, even if that owner's parse was valid.
- `resolve.savedOrders`: Keep one complete saved order through a copy-count change, rather than mixing absent donors' old ordinals with their unchanged siblings' shifted positions.
- `resolve`: Retain records absent from current source. Invalid parses cannot prove deletion.
- `resolve`: Without operation evidence, an absent lesson remains reviewable rather than disappearing.
- `resolve`: Retained descendants of a moved parent belong to its new lesson.

### `packages/content-identity/src/types.ts`

- `IdentityNode.canonicalVersion`: Absent for legacy descriptors. Writers still emit the legacy format by default.
- `IdentitySnapshot.courseId`: Required namespace guard, including snapshots read without their heads.
- `CanonicalDescriptor.path`: Tree child indexes; virtual blanks and reader parts append after real children.
- `CanonicalDescriptor.revisionContent`: Full subtree semantics, independent of its matching descriptor.
- `CanonicalDescriptor.readerRole`: Reader projections with no separate source-tree node.
- `IdentityOperation.placements`: Binds result identities to the resulting parse, guarded by file revisions.
- `IdentityOperation.inverse`: History restores recorded IDs, including retired IDs, without reallocating.
- `IdentityDependencies.allocateRuntimeId`: Optional read-view allocator; returns rt- followed by 32 lowercase hex characters.
- `IdentityDependencies.digest`: Synchronous SHA-256 of UTF-8 text. Hosts supply the implementation.
- `ResolveIdentityInput.activeHistoryIds`: IDs active in validated history, plus IDs protected by author artifacts. Omit to keep all IDs durable.
- `ResolveIdentityInput.course`: Omit only for a new namespace or recovery from validated snapshots.
- `ResolveIdentityInput.priorHeads`: Snapshot lessonId is the lesson-head filename stem.
- `ResolveIdentityInput.mergeBase`: Validated history for operation. Identity resolution never chooses between branch heads.
- `ResolveIdentityInput.readerRoles`: Include the grammar reader's virtual parts. Inferred from prior role records.
- `IdentityReadView`: Display identity only. No heads, snapshots or operation mappings can be persisted.
- `IdentityReadView.correspondence`: Author host state only, never durable lineage or operation authority.
- `IdentityMergeResult.resolution`: No writable result exists until every conflict is resolved.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the regression cases in `packages/content-identity/__tests__/`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
