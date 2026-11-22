# 0063: Recoverable project writes

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Project saves coordinate participating processes and retain evidence of interrupted or competing writes.

## Decision

### src/main/project-file-transactions.ts

- `pendingIdentityOperation`: Admission precedes realpath, preserving the order of successive saves
  in this process. Outside-writer limits, also listed in architecture.md: - Only participating
  Studio processes for this user/machine take the lock; other writers/readers can enter capture gaps
  and observe mixed plans. - Old handles can write a displaced inode after its last
  verification/unlink, or after explicit archive resolution. Future writes cannot be archived. - A
  writer can change a publication inode after quarantine verification, then detach its live name
  before source unlink, or edit the quarantine name itself. Node has no atomic content-and-inode
  conditional unlink or mandatory lock. - Edits after the final durable installation are subsequent
  outside writes; committed recovery leaves all targets alone and never rolls back peers. - Edits
  between an uncommitted crash and admission are retained/reported when distinguishable; identical
  bytes on the same inode cannot identify a writer. Unpublished Studio temporaries holding only
  planned prefixes are crash debris, not outside edits. Unknown/differing bytes are retained.
  Admission isolates all retained entries, including interrupted isolation copies, before retiring a
  journal. Windows flushes each marker after rename as well as before it. Node cannot flush
  directories there; power loss can still undo namespace changes after acknowledgement.
  Hardware/filesystem flush support bounds durability on all hosts. Case aliases use native realpath
  plus Darwin/Windows folding. Case-sensitive Darwin directories differing only by case deliberately
  share an advisory lock. Hard-link refusal is specific; sharing contention after publication still
  retries.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `isolatedCommittedArchives`: Only archives isolated and verified by this process qualify.
  Directory identity detects replacement and added entries; byte edits stay retained until reclaim,
  which always repeats isolation and every orphan/quarantine check.
- `bindProjectWriteLifetime`: Issuance belongs to this admission, including its nested transactions.
- `acknowledgeProjectResult`: A cleanup failure cannot turn a committed domain result into a failed
  save.
- `projectLockPath`: BEGIN EXCLUSIVE uses SQLite's OS advisory locks, released on close or process
  death. The lock database stores no owner record. The course's file journal is separate. This
  private cache file must never be unlinked/replaced: Unix locks belong to its inode. Keeping it
  outside the project keeps authoring file APIs from opening/closing its inode, which would drop
  POSIX process locks. node:sqlite ships in the supported Node 24 and 26 runtimes; no native addon is
  needed. See https://www.sqlite.org/lockingv3.html. Close older Studio versions before upgrading.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `acquireProjectLock`: Only SQLite opens cache files. Generic guarded APIs must refuse this path.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `acquireProjectLock`: A first read cannot create a lock. Its final absence check detects the first
  cross-process writer, whose cache file remains for this course's lifetime.
- `acquireProjectLock`: BEGIN alone is deferred. Reading the schema takes a shared OS lock that
  excludes participating writers without updating the database.
- `acquireProjectLock`: Yield while contending; SQLite's synchronous busy timeout would block the
  event loop.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `isNestedProjectDirectory`: Check the journal last: it is published before capture, so a
  temporarily absent course.yaml still identifies the child's separate admission.
- `removeAbandonedStages`: Only this project's participating writer can own a stage. After admission
  its existing stage is abandoned, including a crash before its first byte or owner publication. The
  .praxity-write- directory prefix is reserved for this writer. A nested course or Studio project
  has a separate lock, including manifest-free projects marked by .praxity. Its live stages and
  recovery bytes belong to it. Path lookup uses this directory's filesystem name semantics;
  enumeration preserves casing even when the authoring reader can open COURSE.YAML as course.yaml.
- `removeAbandonedStages`: The legacy identity filename identifies this root's former staging owner.
- `assertProjectWritesAllowed`: Node's Permission Model denies fsync even with full filesystem
  grants.
  Evidence: [Node.js 24.22.1, File System
  Permissions](https://nodejs.org/download/release/v24.22.1/docs/api/permissions.html#file-system-permissions)
  lists fsync among descriptor APIs disabled under the permission model.
- `archiveEvidence`: Older lexical basenames can be short names or Unicode filesystem aliases. The
  live spelling cannot prove their historical canonical ownership.
- `archiveEvidence`: No publication or installation decision means this preparation changed no live
  file.
- `archiveEvidence`: Unreadable, replaced or unsafe archive bytes cannot establish recovery facts.
- `readProjectRecoveryEvidence`: Observational T1 facts: no recovery, isolation, conflict marking or
  archive-cache trust.
- `readProjectRecoveryEvidence`: Active journals refuse read admission. Only enumerate names;
  certify no files.
- `reclaimProtectedArchives`: I4 owns the decision to keep protected recovery evidence, within its
  write admission.
- `reclaimProtectedArchives`: A committed save can acknowledge failed journal retirement. Recovery
  still needs its stage.
- `reclaimProtectedArchives`: Two fresh live-store proofs per candidate must not scale with the
  archive backlog.
- `reclaimProtectedArchives`: I4 has already committed. Preserve T1's acknowledged cleanup-warning
  result.
- `projectRecoveryArchives`: Opening needs notices for unknown or conflicting bytes; inspection
  includes intact captures.
- `readRecoveryArchive`: Unknown copies can still be extracted and explicitly resolved.
- `readRecoveryArchive`: Unreadable or nonregular hold metadata cannot certify a hold; keep
  inspection available.
- `withRecovery`: Conflict recovery retires the journal. The command can now inspect the archive.
- `extractProjectRecovery`: Exclusive creation refuses every existing destination; never replace an
  author's file.
- `restoreProjectRecovery`: Restore an explicitly chosen journal copy through T1; retain both the
  archive and displaced bytes.
- `excludeProjectFilesFromGit`: Course-scoped Git exclusions, shared by init and recovery
  publication.
- `excludeProjectFilesFromGit`: An enclosing checkout is optional and may be outside a CLI host's
  grants. Stop discovery at that boundary; metadata found inside it must still pass every read/write
  guard before recovery bytes are published.
- `excludeProjectFilesFromGit`: Linked worktrees keep info/exclude in the common Git directory.
- `excludeProjectFilesFromGit`: Courses in a repository have different locks but share this policy
  file.
- `excludeProjectFilesFromGit`: O_APPEND preserves edits by authors who do not take our metadata
  lock.
- `excludeProjectFilesFromGit`: The author may have appended a non-terminated line after our EOF
  observation.
- `verifiedOrphan`: No publication or source can exist yet in a journal-only preparation. Reserved
  names alone are insufficient: unknown bytes remain inspectable.
- `verifiedOrphan`: Unverified recovery bytes must be kept for manual inspection.
- `verify` inside `verifiedOrphan` strips repeated `.independent-<uuid>` and `.reclaim-<uuid>`
  suffixes before looking up a recovery artifact in the expected-byte map. A suffixed artifact must
  obey the same planned bytes as its unsuffixed name. `matchesPlannedBytes` requires exact bytes for
  complete artifacts and permits only a prefix of the planned bytes for partial artifacts;
  `.independent-` copies are partial because isolation can stop mid-copy. Unknown or differing bytes
  remain retained.
- `verify`: Archive inspection is observational. Only admitted cleanup marks changed captures, so a
  read cannot modify retained recovery bytes.
- `unpublishedJournalPrefix`: Both flat and legacy writers serialize this header before any planned
  bytes.
- `path`: Relative path; its parent directory must already exist.
- `content`: Exact UTF-8 or binary bytes. Null deletes a file.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `expectedContent`: Null requires absence; undefined captures the current bytes under the lock.
- `createDirectories`: Absent destination directories, published only after their recovery plan.
- `onStep`: An awaited storage checkpoint, also used by process-death tests.
- `withProjectFileFlushes`: Scope storage flushes across admissions, including queued and nested CLI
  work.
- `projectFileFlushes`: Durable private writes share the same flush boundary as journaled project
  writes.
- `defaultSyncFile`: A file's bytes reach durable storage before its name or readiness is published.
- `defaultSyncDirectory`: Windows does not expose directory fsync through Node. File flushes still
  precede rename.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `completeFileWork`: Preserve the initiating error when peers fail as a consequence. Drain every
  writer before rollback can touch their files or retire the journal.
- `validateJournal`: Older Darwin journals retain native casing; compare without rewriting their
  checksum input.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `stageFingerprint`: Rename first, then verify in quarantine. A path writer can no longer reach the
  candidate by its old name. Preopened descriptors remain outside this contract.
- `isolateStage`: A death between link and source retirement can leave an alias. Replace only the
  archive name with a flushed independent copy, never the committed target.
- `readInstallationIdentity`: A torn legacy identity cannot prove ownership. Recovery keeps the
  target as a conflict instead of blocking admission and archive commands forever.
- `cleanupJournal`: Displaced inodes can still receive outside writes after this save returns. They
  are recovery archives, even when their bytes currently match the plan.
- `installFile`: A previous rollback copy may still be linked to a target or open in an outside
  editor. Each recovery attempt writes a fresh inode, retaining all displaced inodes.
- `installFile`: Read the displaced inode, not a path another author can replace.
- `installFile`: A failed or uncertain capture/link keeps its inode for recovery.
- `restoreCapture`: Preserve the displaced inode for stale handles; publish a different inode.
- `reconcileCaptures`: Capture filenames describe attempted installation/restoration, even if it
  died before publication.
- `reconcileCaptures`: A crash in the absent-name interval must restore bytes before admission.
- `reconcileCaptures`: Equal hashes do not prove ownership. Our successful hard link does.
- `resumeRollbackCaptures`: An intent names the displacement before rename; completion belongs to
  that attempt, not the forward installed marker. Restore the original before any reader can enter.
- `recoverProjectFileJournal`: Validate every path, permission and recovery artifact before touching
  any target.
- `recoverProjectFileJournal`: Even a damaged identity records a possibly consumed source. Target
  ownership still requires a parsed identity in reconcileCaptures; refusing here would strand both
  admission and archive commands.
- `recoverProjectFileJournal`: The final installed marker is already a durable commit decision,
  including a death before publishing committed. Live bytes cannot undo that decision.
- `recoverProjectFileJournal`: Restore only bytes installed by this plan. Unknown hashes belong to
  another writer.
- `recoverProjectFileJournal`: A retained capture-free preparation needs a durable rollback outcome
  too.
- `recoverProjectFileJournal` can find a preparation with no `ready` marker, no capture conflicts,
  and every live target hash still equal to its recorded `fromHash`. No authored target needs
  restoration in that state. The function records an abort marker if absent and removes only the
  planned empty directories through `removePlannedDirectories` before journal cleanup, because
  preparation can create those directories before publishing `ready`.
- `applyProjectFilePlan`: Apply one complete plan inside an admitted write transaction. Never
  normalizes bytes.
- `plannedTarget`: Resolve existing native basenames too, including Windows 8.3 aliases.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `applyProjectFilePlan`: Writable-path admission refuses file links before canonicalization; retain
  the author message.
- `applyProjectFilePlan`: Both independent copies reach durable storage, with private modes, before
  linking.
- `applyProjectFilePlan`: Checkpoints stay ordered, and caller guards run with no active staged
  writer.
- `applyProjectFilePlan`: A stale later file refuses the entire plan, including writes to its
  earlier peers.
- `applyProjectFilePlan`: A filesystem operation may replace the target and then report an I/O
  error. Record the attempt first; rollback decides from the observed bytes.
- `applyProjectFilePlan`: All installed markers already made the commit durable. A redundant
  committed marker's I/O failure is cleanup, never a rollback trigger.
- `applyProjectFilePlan`: Record refusal before undo: recovery must finish rollback even if all
  targets still match 'to' when another process death interrupts this error path.
- `applyProjectFilePlan`: Atomic replacement installs only the checked staged bytes. A third hash
  belongs to an outside editor; preserve it while refusing this plan.
- `writeProjectFiles`: Compare every file before staging; install one recoverable course change
  under the OS lock.
- `projectTextReplacement`: Frozen editor callers emit LF. Only uniform baselines need style
  adaptation; mixed bytes are literal.
- `writeProjectTextFile`: Compare and replace under the same lock as identity and course
  transactions.

### src/main/project-protected-paths.ts

- `IDENTITY_LINEAGE_PATHS`: C01 sidecar paths whose recovery archives must not be discarded
  automatically.
- `classifyIdentityLineagePath`: Unknown historical names must retain the same protection during
  facts and reclamation.
- `classifyIdentityLineagePath`: Only root names that could spell a protected name need historical
  alias protection.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
