# 0064: Rooted filesystem and asset admission

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Pathnames and timestamps alone cannot establish which bytes a host is authorized to read or replace.

## Decision

### src/main/course-manifest-io.ts

- `readManifestSnapshot`: Reading must surface malformed authored YAML even when no field migration
  is needed. Otherwise the tolerant model parser hides it behind defaults.
- `readManifestSnapshot`: Symlink lessons remain unsupported, but an escape must fail at preparation
  rather than be hidden as an absent lesson by manifest discovery.

### src/main/export/project-asset-inventory.ts

- `ASSET_TIMESTAMP_SETTLE_NS`: Fractional timestamps can still repeat within a filesystem clock
  tick. Two seconds covers FAT's write tick as well as shorter NTFS clock ticks.
  Evidence: [Microsoft, File
  Times](https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times) specifies a two-second
  FAT write-time resolution.
- `stamp`: ctime and inode also catch same-size replacements with a restored mtime.
- `canReuse`: Zero/missing inode IDs and unknown timestamp precision cannot establish freshness.
  Require observed sub-millisecond precision per file. This also bypasses FAT/exFAT stamps that have
  fractional seconds but still cannot distinguish rapid writes.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `sampleFilesystemTime`: Read-only projects still admit assets, but cannot prove timestamp
  freshness.
- `sampleFilesystemTime`: Windows may defer timestamp updates until the writer handle closes.
  Evidence: [Microsoft, File
  Times](https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times) says last-write time is
  not fully updated until all writing handles close.
- `ProjectAssetInventory`: One project host owns this inventory; all reads retain the path
  admission.
- `admit`: Capture this before reading. An unsafe snapshot must never become reusable just because
  its timestamp ages after a missed write.
- `admit`: A completed overwrite can leave even fractional stamps unchanged. Verify from offset zero
  on the same admitted inode in that window.
- `admit`: Bind bytes to the opened inode, then check the link still names it.
- `walk`: A fresh write samples this filesystem's clock before any batch admission. Never compare
  asset timestamps with the reader's wall clock.
- `walk`: Drain failures before invalidating. No worker may outlive this admission.
- `walk`: Descend after the batch settles to keep the cap global across directories. Publish in
  traversal order, regardless of filesystem completion order.
- `read`: An event during a read must not repopulate an invalidated inventory.

### src/main/init-course.ts

- `matchesHiddenName`: Folder spellings also express an author's choice for the folder's contents.
- `matchesHiddenName`: A recovery wildcard denotes every suffix. Preserve uncertain intersections
  too.

### src/main/lesson-source.ts

- `resolveLessonSources`: Discovery and identity must see the same admitted course revision. A
  writer between separate admissions can add a head absent from the captured inventory.
- `resolveLessonSourcesForWrite`: Explicit write owners request candidates inside their existing
  write admission.
- `capture`: Descendant parents are created by the journaled plan. Its expected-null writes check
  collisions after those parents exist, including outside races.

### src/main/path-security.ts

- `realpath`: Native resolution uses the filesystem's spelling, including case aliases.
- `withProjectPathAdmission`: The admission lock owns this proof. No pathname result survives the
  transaction.
- `assertAdmittedRoot`: Targets and parents still resolve natively on every use. A replaced root or
  renamed ancestor must refuse instead of admitting a different directory.
- `canonicalPath`: Resolve existing ancestors without creating cache entries during path admission.
- `assertOutsideProjectLockCache`: On macOS, closing ANY descriptor for a SQLite inode cancels this
  process's POSIX locks, even when SQLite's connection is still open. Guard reads as well as
  deletion/replacement, before any descriptor opens. Windows uses file locks.
  https://www.sqlite.org/howtocorrupt.html#_closing_a_file_descriptor
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `assertAllowedProjectRoot`: Refuse the home ancestor even when .praxity-studio links to another
  volume.
- `resolveExistingPathWithin`: Optional-file callers may ignore absence, but an existing dangling
  link must not hide an asset or sidecar boundary failure as an empty success.
- `assertFileWritableWithin`: Replacement permissions come from the file as well as its parent
  directory.
- `assertFileWritableWithin`: access alone permits root to replace an author's POSIX read-only file.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `waitForFileSharingRetry`: One sharing-violation budget for journaled and atomic publications.
- `writeFileAtomicallyWithin`: Stage in the authorized directory so replacement is atomic on the
  same filesystem.

### src/main/plain-yaml-edit.ts

- `plainYamlDocument`: These legacy edits are retired by X1. Refuse syntax we cannot preserve
  exactly instead of introducing a general YAML editor for the old formats.
- `check`: A nested collection's trailing comments are still inside its parent's flow.
- `requirePreservedComments`: Match comments to their nodes, not just equal text elsewhere in the
  file. Standalone comments between entries belong to the collection: their ownership is ambiguous,
  so deleting an adjacent entry cannot authorize their removal.
- `match`: Duplicate values do not identify which authored entry was removed.
- `inventory`: Removing the first entry can leave a gap comment before the collection's AST range.
  It still belongs to that collection.
- `applyPlainYamlEdits`: A candidate must preserve the byte partition outside the declared edits and
  both its complete resolved data and the owning reader's interpretation.

### src/main/private-project-folder.ts

- `checkPrivateProjectPath`: Fixed private paths retain their spelling and never traverse links.
- `checkPrivateProjectPath`: Strict stores also refuse an absent spelling with a case-folded
  sibling.
- `checkPrivateProjectPath`: Windows directory READONLY is decorative; it does not deny writes.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `privateFolderIgnoreContent`: The last wildcard must override earlier negations; preserve the
  owner's bytes.

### src/main/project-assets.ts

- `internalPaths`: Check canonical children too: an outside writer can move a store into assets and
  replace its original name with a contained directory link.
- `internalPaths`: A store alias wins over an optional dependency/git directory at the same path.
- `inspect`: Authored directory links are not lesson inventories. Internal links still name owned
  bytes and must be checked through containment.
- `createProjectAssetAdmission`: One read owns the canonical stores and lazily shared protected
  identities.
- `assertIdentity`: Bigint dev/ino preserve the Windows file ID without number rounding.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `finish`: Bulk readers call this after their last byte read, before publishing any result.
- `openAsset`: The caller owns the handle; admission checks the opened inode before any byte read.
- `resolveProjectAsset`: Admit public resources by canonical path and file identity, never by their
  text.
- `openProjectAsset`: The caller owns the handle; admission checks the opened inode before any byte
  read.

### src/main/project-tree.ts

- `readAdmittedTree`: Each nested project owns its journal and lock. Release this admission before
  entering a child's, then fill the existing tree node to retain its visibility.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/workspace.ts

- `scanWorkspace`: mtime alone cannot establish freshness after same-size or restored-time writes.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/cli/src/` and browser and tooling tests in
`apps/cli/e2e/` and `apps/cli/scripts/`. Paths above are relative
to `apps/cli/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
