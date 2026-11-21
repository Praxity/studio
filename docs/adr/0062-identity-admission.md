# 0062: Identity admission and retained evidence

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Display identities and caller-owned objects cannot authorize persisted identity changes.

## Decision

### src/main/identity-store.ts

- `fileHandles`: File identity evidence from the same opened handles as the admitted bytes.
- `snapshotRecords`: Private canonical facts for validated current heads.
- `withIdentityStoreReuse`: Retain private validation only until this save completes, independently
  of the global budget.
- `record`: Only current heads need the full graph and canonical bytes.
- `IdentityStoreCache`: Owns validated records privately; zero bytes selects independent fresh
  validation.
- `invalidate`: An admission already reading disk may return its result, but cannot retain it after
  disposal.
- `usage`: Retained payload accounting, rather than process heap size.
- `validatedStore`: Lookup, validation and the retained key must use the same captured
  configuration.
- `validatedStore`: Seeding exact private installed bytes produces no new snapshot proofs. Keep the
  existing proofs for the next guarded load, which validates the appended snapshot.
- `identitySession`: Session-owned validated evidence. Exact store bytes and inventory are checked
  every time.
- `strict`: Require saved identity and source revisions, with no filesystem writes.
- `removedPaths`: Explicit source deletions in the same admitted file plan, including rename donors.
- `lessonPaths`: The complete course inventory, including lessons unaffected by this edit.
- `sources`: Draft/result bytes. Omitted lessons use their exact saved bytes.
- `lessonReads`: Build-local reads keyed by exact source bytes; never retained across admissions.
- `operationBase`: Store-issued current resolution, including outside edits, for one atomic
  operation.
- `operationPlan`: Single-use registry evidence, bound to the store-issued operation base.
- `restore`: A guarded inverse restores consumer metadata through the identity owner.
- `established`: Hosts with release evidence outside the course directory must set this.
- `slugRenames`: Explicit URL changes; old slugs remain reserved aliases.
- `approvedConversion`: Explicit grammar-3 conversion starts a lineage using these approved store
  files.
- `activeHistoryIds`: Validated historical and author-artifact facts for the identity owner's
  durability predicate.
- `readView`: Display-only graph. It has no store issuance and cannot authorize a write.
- `correspondence`: Successful write evidence for author host state; never part of durable identity.
- `retirementInput`: Durable prior facts survive intermediate operation resolutions of outside
  edits.
- `recordedTargets`: Target IDs captured by the registry's private operation issuance.
- `validatedIdentity`: The resolver's private value; public resolutions receive an independent copy.
- `snapshotRecords`: Private bytes and hashes bind to serialized; never exposed with mutable
  snapshots.
- `readerProjections`: Captured before exposing mutable reads, so publication can detect altered
  projections.
- `operationSnapshots`: Reconciled outside revisions become immutable parents in the same journal.
- `resolveReadIdentityId`: Resolve captured author locators only through successfully installed I4
  correspondence.
- `readCourseIdentity`: Read admissions expose display bindings only. Candidate evidence stays with
  I4.
- `readCourseIdentity`: Slugs belong to I4's course-wide reservation owner, never to the display
  matcher.
- `readCourseIdentity`: Correspondence is released only by a successful explicit write, not a read.
- `planReadIdentity`: Probe/preview planning cannot export its private candidate or authorize
  persistence.
- `resolveReadOperation`: Dry-run evidence describes display identity; executable plans remain
  private to I4.
- `matchesIssuedIdentity`: Canonical fallback retains acceptance of harmless undefined fields and
  key order.
- `correspondence`: Held browser fields outlive RPC replies and transient artifact rebuild gaps.
- `CourseIdentitySession`: One host session owns retained admission evidence, never caller-owned
  results.
- `invalidate`: Replacing the state also prevents an in-flight admission from repopulating it.
- `lessonReads`: Reader-owned copies let grammar-version guards reuse the same parse.
- `sameFiles`: Fatal UTF-8 decoding retains the BOM, so text equality proves exact admitted byte
  equality.
- `assertPlainIdentityStore`: T1 isolates abandoned publications before write admission; live
  installs may still link twice.
- `visit`: .praxity itself must be plain, but window state and local drafts are not lineage.
- `entries`: Native spelling and directory identity change on rename or replacement; appends do not.
- `assertCompleteInventory`: A Windows case-only rename can still resolve through its old spelling.
  Compare canonical file names, leaving rename/copy matching to the owner.
- `loadStoreWithin`: Rollback can retain empty destination directories and recovery copies. Explicit
  conversion may fill an empty store, never discard identity bytes.
- `loadStoreWithin`: A rolled-back first write never committed a namespace, even if installation
  began.
- `loadStoreWithin`: Immutable snapshots prove their content hash before inventory changes are
  classified.
- `readStoreFiles`: Capture exact bytes even when working heads contain git conflict markers.
- `readStoreFiles`: A case-insensitive lookup or an internal symlink can open the same inode under a
  new entry.
- `readStoreFiles`: Drain every admitted read before returning an error. Publish bytes and their
  opened-handle evidence together, in inventory order rather than completion order.
- `liveIdentityStoreIsIntact`: Every protected file an archive holds must pass its owner in the
  validated live namespace.
- `liveIdentityStoreIsIntact`: Omit the optional identity so the read owner's empty-file view cannot
  prove stored identity.
- `liveIdentityStoreIsIntact`: Legacy registries and other review files have no standalone namespace
  proof here.
- `liveIdentityStoreIsIntact`: Unreadable or invalid evidence cannot authorize deletion of recovery
  bytes.
- `parseStoreFiles`: Discover current heads now, but retain the historical-before-head refusal
  order.
- `parseStoreFiles`: Canonical bytes bound both the parsed graph payload and the retained canonical
  string.
- `parseStoreFiles`: Reuse the identity owner's course-wide graph and active-ID validation.
- `protectedHistoryIds`: Pending author artifacts can exist even though those IDs have never been
  exported.
- `readIdentityRevision`: Validate an immutable git revision using the same rules as the disk store.
- `mergeCourseIdentity`: Merge only validated revision bytes; conflicted working heads are never
  parsed as a baseline.
- `mergeCourseIdentity`: Preserve complete immutable history, including ancestors not referenced by
  current heads.
- `mergeCourseIdentity`: Preserve and validate any additional local history. Heads come only from
  the merge result.
- `mergeCourseIdentity`: Include unchanged sources as guards. T1 verifies every expected byte before
  installing anything.
- `IdentitySourceError`: The first error's grammar code, such as "svg-data-url".
- `identitySourceError`: Source validity precedes any identity-loss classification.
- `identityInitialization`: Classify the resolver's matches, never infer identity from positions or
  labels.
- `identityInitialization`: Page candidates are lesson-scoped; a move can look like an extra page
  only at its destination.
- `identityRetirements`: Saved identities the resolver cannot retain, with their saved diagnostic
  locations. Requires an admitted result. Counts ambiguous durable pending IDs as retired, although
  ordinary Studio persistence keeps those IDs pending.
- `identityRetirements`: Old offsets cannot locate lines in edited or absent source.
- `identityWriteRetirements`: Retirements that have neither recorded operation intent nor an
  explicit source deletion.
- `identityWriteRetirements`: Recorded deletion covers descendants still live at its base, never
  earlier outside losses.
- `identityWriteRetirements`: A recorded owner edit covers its implicit reader parts, only while
  they are still live.
- `previewCourseIdentityInitialization`: Inspect initialization without recovering a journal or
  admitting an identity write.
- `initializeCourseIdentity`: Explicitly record the current source without replacing any authored
  bytes.
- `initializeCourseIdentity`: Making text unique cannot identify which durable copy was removed.
- `projectWriteRefusal`: A refused write has no durable allocation to share with the author host.
- `resolveAdmittedCourseIdentity`: Read and validate the approved store before acquiring the
  destination admission. Conversion may replace legacy metadata, but never an existing modern
  lineage.
- `resolveAdmittedCourseIdentity`: The admission above binds these facts before the next await.
  Caller-owned operation bases cannot change the graph paired with private canonical bytes.
- `resolveAdmittedCourseIdentity`: Identical source can share parsing work, but each mutable lesson
  owns its tree.
- `resolveAdmittedCourseIdentity`: Invalid lessons are opaque to a writer; only a read admission
  describes their current trees.
- `resolveAdmittedCourseIdentity`: Artifact edits are outside the identity file inventory retained
  by this resolver.
- `resolveAdmittedCourseIdentity`: Refresh the saved display proof before a writer plans against
  current sources.
- `resolveAdmittedCourseIdentity`: A reused snapshot already passed store validation, including its
  namespace and graph.
- `resolveAdmittedCourseIdentity`: Reader planning evidence has no persistence issuance, even during
  its admission.
- `resolveAdmittedCourseIdentity`: Bind only successful admissions, including when reads were
  invalidated in flight.
- `persistCourseIdentity`: Persists only a resolver result, together with its exact source
  revisions.
- `persistCourseIdentity`: Capture caller-owned drafts before the first await. Admission and the
  returned value must use the same payload, even while another save holds the queue.
- `persistCourseIdentity`: Preserved lessons are absent from the write candidate, but must remain in
  the read proof.
- `persistCourseIdentity`: Draft display descriptors describe the result, not the saved operation
  base.
- `assertUnchanged`: Most checkpoints compare the untouched captured JSON directly. Canonical
  fallback preserves acceptance of reordered keys and ignored undefined fields.
- `persistCourseIdentity`: Immutable identity content is prepared before any authored source
  replacement.
- `persistCourseIdentity`: Review concerns disk changes; a refused draft must not point to an empty
  gate.
- `persistCourseIdentity`: Deleted paths permit rename matching. Recheck through staging and
  installation without creating their missing parent folders.
- `persistCourseIdentity`: These exact private bytes passed schema/graph validation before
  publication. Parsing only current heads preserves JSON values such as 0 versus -0, including
  noncanonical immutable stored snapshots.
- `persistCourseIdentity`: A replacement or watcher invalidation prevents installed state from being
  reused.
- `persistCourseIdentity`: Retained store facts stay private to this module.
- `identityDiagnosticLabel`: Diagnostic labels never quote hidden self-check descendants.
- `assertIdentityExportable`: Hosts call this immediately before publication; inspect and preview
  keep drafts readable.
- `assertIdentityExportable`: An older store may lack author locators, but every persisted fact must
  still match.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
