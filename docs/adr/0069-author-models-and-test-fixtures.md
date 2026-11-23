# 0069: Author models and test fixtures

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Author transports, source editing and test adapters preserve ownership rather than inferring authority from presentation.

## Decision

### src/main/__tests__/cli-french-refusals.test.ts

- `{ request }`: Node's HTTP interface permits TRACE, which fetch deliberately rejects.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/fixtures/capture-reader-writer.ts

- `root`: Admission canonicalizes directory aliases, including macOS /var -> /private/var. Match the
  writer's actual rename path so the capture cannot silently complete.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/fixtures/editor-snapshot.ts

- `nodeMetadataBudget` in `src/main/__tests__/fixtures/editor-snapshot.ts` is 832 bytes per
  serialized node. It leaves room for `write-distractors`, the longest schema type, plus maximum
  offsets and escaped labels. The test "bounds the longest schema type, maximum offsets and escaped
  labels by construction" in `src/main/__tests__/editor-snapshot.test.ts` pins that case at 769
  bytes before further escaped-label checks. A size threshold must not reject a supported feature.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/fixtures/journal-writer.ts

- `link`: A pending Promise alone does not keep Node alive. Hold the IPC channel open until the
  parent kills this writer at the requested fault checkpoint.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `source`: The head checkpoint follows its durable installed marker. A raw link alone is an
  unfinished installation under marker-based recovery.

### src/main/__tests__/grammar4-switch.test.ts

- `root`: Two durable commits: Intel Mac max 7265.8 ms, Linux CI 944 ms; allow twice the slower run.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- The test deadline retains the evidence in `docs/context/testing-strategy.md`, run `38146537167`.

### src/main/__tests__/identity-issued-plan.test.ts

- `withCountingFlushes`: Real journal bytes, admissions and recovery remain; journal-flush tests own
  durability.
- `fixture`: Seeding is setup, not the write under test. Keep real persistence for admission and its
  durable result, but avoid a second journal for the initial fixture.

### src/main/__tests__/identity-read-planning.test.ts

- `withCountingFlushes`: Real journal bytes, admissions and recovery remain; journal-flush tests own
  durability.

### src/main/__tests__/identity-read-view.test.ts

- `withCountingFlushes`: Real journal bytes, admissions and recovery remain; journal-flush tests own
  durability.

### src/main/__tests__/identity-rederive-cli.test.ts

### src/main/__tests__/identity-restore-cli.test.ts

### src/main/__tests__/identity-store.test.ts

- `bytes` in `src/main/__tests__/identity-store.test.ts` excludes access times because observing a
  Windows file can update them. It records `mtime`, `ctime` and `birthtime` to detect replacement or
  directory creation, deletion and rewriting.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/inspect-blocks-cli.test.ts

- The elapsed-time assertion in `inspectBlocks` coverage: In-process inspection measured 83 ms; 5 s
  leaves shared-runner margin. Old inventory took 129 s.

### src/main/__tests__/inspection-csp.test.ts

- `server`: WebKit matches 'self' against nothing once the iframe sandbox makes the origin opaque.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/lesson-source-safety.test.ts

- `OWNER_ONLY_MODE`: Windows maps chmod onto the read-only attribute alone: writable files report
  0o666 and writing a read-only file fails with EPERM rather than EACCES.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/line-ending-files.test.ts

- `root`: Two durable commits: Intel Mac max 7120.7 ms, Linux CI 339 ms; allow twice the slower run.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `root`: timeout: docs/context/testing-strategy.md; run 38146537167

### src/main/__tests__/operation-service.test.ts

- `Handle`: Keep native filesystem checks and real handles/bytes, without a thread-pool round trip
  for each small fixture read or journal step.
- `file`: These contracts exercise real bytes, admissions, journals and cleanup. The journal suites
  own flush ordering, failure and crash durability.

### src/main/__tests__/preview-session.test.ts

- `withCountingFlushes`: Real journal bytes, admissions and recovery remain; journal-flush tests own
  durability.
- `applyNoteTone`: These cases exercise commit results and rendering; journal tests cover real
  flushes.
- `{ session, result }`: Two durable commits: Intel Mac max 6590.8 ms, Linux CI 335 ms; allow twice
  the slower run.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `{ root, session, events }`: timeout: docs/context/testing-strategy.md; run 38146537167

### src/main/__tests__/project-lock-ownership.test.ts

- `project`: Compile once; each contender still runs the real writer in a separate process.
- `root`: Two child writers: Intel Mac max 6426.2 ms, Linux CI 876 ms; allow twice the slower run.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `root`: timeout: docs/context/testing-strategy.md; run 38146537167

### src/main/__tests__/project-os-lock.test.ts

- `root`: Owner decision 2026-10-12: macOS flush timings are advisory; recovery assertions still
  run.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/project-recovery-evidence.test.ts

- `withCountingFlushes`: Real journal bytes, admissions and recovery remain; journal-flush tests own
  durability.
- `path`: Recorded from the previous writer, with only course/checksum placeholders. Do not resolve
  the live basename: main could install the literal short name.
- `directory`: The second spelling is a native APFS alias of the legacy registry.

### src/main/__tests__/review-store.test.ts

- `busyStarted`: The real lock deadline is 5 s. Contention setup belongs outside the <2 s assertion
  case.

### src/main/__tests__/studio-editor-snapshot.test.ts

- `withCountingFlushes`: Journal flush tests own durability; these scenarios keep real bytes,
  admission and watchers.
- `flushes`: Journal tests own durability; real HTTP callbacks retain this server's flush scope.
- `flushes`: Journal tests own durability; watcher callbacks retain this session's flush scope.

### src/main/__tests__/studio-review-launch.test.ts

- `{ host }`: Node never sends HEAD bodies, so only the status exercises this handler.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/__tests__/write-distractors-publication.test.ts

- `{ root, session }`: Author snapshots retain source and source-outline labels; generic blocks/data
  have no snapshot channel. Inspection is a separate prompt-only projection.

### src/shared/course-manifest.ts

- `parseCourseHomeUrl`: Report malformed URLs with the same field-specific refusal as unsafe
  schemes.
- `parseCourseManifest`: Retired persisted `badge` values are intentionally omitted from normalized
  state.

### src/shared/edit-cli-schema.ts

- `editCliOutputSchema`: Schema 1 omits session transaction/history IDs and executable inverses.
  Operation vocabulary and eligibility still belong to grammar's contract and the registry.

### src/shared/editor-session.ts

- `EditorSnapshot`: Decoded author outline. The plain JSON wire omits paths and derives page IDs
  from parents.
- `labelBytes`: JSON escaping (notably control characters and lone surrogates) also consumes wire
  bytes.
- `snapshotKinds`: Exhaustive against the grammar's type: adding a tree kind requires its transport
  bound here.
- `sourceLimit`: Snapshot transport shares the existing IPC source ceiling and bounds
  offsets/indexes with it.
- `snapshotNodeSchema`: Preserve the outline revision and source fingerprint even when they differ.
- `snapshotNodeSchema`: Expected start/end, editable start/end; the source owns UTF-16 range
  validation.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `snapshotLessonSchema`: The source-range owner validates containment; no derived text enters the
  payload.
- `editorSnapshotSchema`: Plain author JSON only. Both lesson and node seeds retain durable-only
  write targets.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `prepareEditorSnapshot`: Plain JSON transport: local child indexes plus parent IDs replace
  depth-dependent paths.
- `admittedLessonRead`: The admitted source and display bindings own the parse, never a draft or
  presentation.
- `admittedLessonRead`: Frontmatter reader roles belong to the lesson, never to executable nodes.
- `readEditorLesson`: Raw reader callers own their result; projections keep the admitted parse
  private.
- `editorLessonOutline`: Outline names and page views use the same admitted reader as lesson
  dispatch.
- `editorLessonProjection`: Dispatch projects the admitted lesson even when it has no presented
  document.
- `editorDraftSeed`: Node membership binds its ranges to the admitted lesson that owns its source.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `safeJson`: Zod can discard __proto__ while cloning. Reject it, inherited objects and prototype
  names before a schema or YAML setter can interpret them.
- Retired 2026-11-22, `StudioEditorBridge`: Rooted browser editor APIs; persistence carries the controller's exact
  draft.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- Retired 2026-11-22, `StudioEditorBridge`: Same-revision callers share a read; newer callers share a queued refresh.
  Stale replies retry once.
- `CanvasPageScope`: Captured compiler page identity and position, independent of course DOM
  markers.
- `file`: Detect a deleted or renamed source file; never a replacement for identity admission.
- `editorSeq`: Sequence captured before compiling this retained author artifact.
- `allLessonPages`: A captured module-deck document renders every page of this lesson.

### src/shared/editor-source.ts

- `unchangedLines`: Anchor the unchanged suffix before diffing, so adjacent repeated blank lines
  keep their own endings when one is edited. Only the changed region needs a trace.
- `preserveEditorLineEndings`: Apply LF editor line edits to the raw baseline, retaining each line's
  own terminator. Explicit CR bytes are already a raw replacement. The editor represents the final
  newline as an empty final paragraph, so its presence or removal is authoritative.
- `preserveEditorLineEndings`: Pair edited lines between unchanged anchors; new lines inherit the
  local style.

### src/shared/keyboard-shortcuts.ts

- `LEGACY_SHORTCUTS`: Digits follow each ribbon top-to-bottom, so the number matches what the eye
  counts. They used to be arbitrary, Design was 1, Accessibility 2, Compositions 3, and Blocks (the
  most-used panel) had no binding at all.
- `LEGACY_BROWSER_UNAVAILABLE_SHORTCUT_IDS`: These combinations address browser tabs, windows,
  navigation, print, bookmarks or zoom.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/shared/module-deck.ts

- `moduleDeckOptions`: Resolve authored choices only after the main process overlays durable
  identities.
- `moduleDeckOptions`: Grammar owns authored gate settings; the compiler validates resolved gates.
- `deckPresentationData`: Keep each lesson's presentation when compiling a multi-lesson course
  document.

### src/shared/narration-sidecar.ts

- `emptyNarrationReadView`: Missing sidecars have a display-only empty view, including before the
  first identity save.
- `parseNarrationSidecarV2`: V2 refuses lossy reads: unknown fields, duplicate targets and malformed
  entries are errors.
- `resolveNarrationPanel`: Revisions come from the admitted host snapshot. UI edits only change
  sidecar fields.

### src/shared/narration.ts

- `timedPositions`: Map each synthesis-text position to its index in the provider's timed
  characters. Soniox returns each whitespace run, such as a paragraph break or a French NBSP, as one
  plain space, so any whitespace run matches any run, including none.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/shared/project-write-errors.ts

- `projectPlainStoreMessage`: One recovery message for CLI and canvas. Commands dereference links,
  including hidden children.
- `ProjectPlainStoreError`: Shared by I4 admission and T1 planning without importing identity
  formats into T1.
- `projectIdentityRecoveryMessage`: The recovery steps also apply when the only remaining identity
  is in a T1 archive.
- `ProjectReadAdmissionChangedError`: An unlocked read must restart after the first writer creates
  its lock database.
- `ProjectWriteResult`: Refused writes reject. A returned result acknowledges the committed bytes.

### src/shared/review/model.ts

- `ReviewRunMetadata`: Retained review formats are read only to verify protected recovery evidence.

### src/shared/self-check-narration-advice.ts

- `minimumExcerptLength`: Eight characters avoid advice for common short words such as "answer" or
  "is".
- `selfCheckNarrationAdvice`: Only this author owner reads full Content; callers receive code and
  location.
- `selfCheckNarrationAdvice`: Grammar already reports this draft error. Identity/accessor failures
  must still refuse.

### src/shared/types.ts

- `manifestSource`: Exact raw bytes belonging to this loaded snapshot, after any loader migration.

### src/test-utils/admission-filesystem.ts

- `synchronousAdmission`: Linux admission fixtures avoid thread-pool overhead; other hosts keep
  their native IO.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `admissionNativeFilesystem`: Path admission uses the native callback API as well as fs/promises.
- `admissionFilesystem`: Native synchronous calls avoid per-step thread-pool scheduling in admission
  tests. Real bytes and handles remain; journal suites own flush/crash durability.
- `admissionFilesystem`: Keep the complete native handle API for positioned reads, streams and
  closure.

### src/test-utils/fixture-temp.ts

- `diskFixtures`: Keep the complete recovery-save latency gate on disk and flush-order fixtures in
  parity.

### src/test-utils/identity-edit-fixture.ts

- `identityEditFixture`: These fixtures change text without changing tree paths. Bind the explicit
  modify intent to the saved snapshot; no positional matching reaches hosts.

### src/test-utils/identity-fixture.ts

- `writeIdentityFixture`: Test-only byte installation. Source ownership rejects production imports
  of test helpers.
- `persistLegacyPendingFixture`: Reproduce former saved-pending opens before exercising today's
  transient Studio entry.
- `replaceIdentityFixture`: An authored fixture replacement supplies explicit identity intent. Setup
  installs exact bytes; learner-facing saves still preserve existing endings.
- `persistFixtureIdentity`: Establish fixture bytes before adding sidecars or recovery evidence.
  Setup does not test durability; scenarios still use the real journal for their writes.

### src/test-utils/interrupted-project-write.ts

- `interruptProjectWrite`: close follows exit and drains the diagnostic streams before reporting
  them.
- `projectDiskSnapshot`: Access times are excluded because this observation itself updates them.

### src/test-utils/narration-fixture.ts

- `narrationFixture`: Fixture setup pins identity before sidecars exist. Target roles come from the
  same public resolver used by host preview, export and inspection.

### src/test-utils/setup-tests.ts

- The filesystem mocks in `setup-tests.ts`: macOS aliases /var to /private/var. Fault injection must
  match admitted paths.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/cli/src/` and browser and tooling tests in
`apps/cli/e2e/` and `apps/cli/scripts/`. Paths above are relative
to `apps/cli/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
