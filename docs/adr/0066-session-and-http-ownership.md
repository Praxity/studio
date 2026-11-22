# 0066: Session and HTTP ownership

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

The author host and learner host have different authority. Session lifecycle must preserve acknowledged saves and retained requests.

## Decision

2026-11-22: `studio/review-bootstrap.ts` now owns the Read review payload and assets, independently of Edit-link composition, ahead of removing the browser editor. This extraction preserves response bytes and headers.

### src/main/cli.ts

- `writeIdentityNotice`: Standalone hosts flush this notice before identity replacement.
- `editorAssetsDir`: Only the standalone artifact supplies a browser UI build.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `runPraxityCli`: Before language validation, use the first --lang value; absent or invalid values
  fall back to en.
- `runPraxityCli`: Argument refusals do not need the server or rendering runtime.
- `runPraxityCli`: Optional retired-editor data cannot prevent the retained host from starting.

### src/main/comments-cli.ts

- `textFile`: A FIFO must reach the regular-file check without waiting for a writer.
- `textFile`: Three UTF-8 bytes per UTF-16 unit bounds the read even if the file grows.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `textFile`: UTF-8 cannot encode surrogates. Give these malformed encodings their own refusal.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `outputJson`: Match complete JSON escapes first so a literal backslash followed by n stays
  literal.
- `executeCommentsCli`: Never render raw filesystem errors, paths, causes or request arguments.

### src/main/course-preview-service.ts

- `compile`: Guided slides share the lesson's first HTML document. Small previews select a slide by
  its ID fragment instead of loading redirect aliases.
- `compile`: Hosting owns the build even if the requester never receives its reply.

### src/main/edit-cli.ts

- `editExitCodes`: Keep process statuses and the help contract together; refusal JSON keeps the
  grammar's code names so callers never have to parse localized messages.
- `editRefusalCatalogue`: Each process status is a refusal class, shared by JSON, text and help
  output.
- `runEditCli`: Select copy before parsing: an earlier refusal must honor a later --lang.
- `runEditCli`: A copied block's range belongs to the deepest containing source node.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/narration-authoring.ts

- `snapshot`: An entry stored under its old lesson may now resolve in a different lesson.
- `validateNarrationAsset`: Existing files only, rooted before any sidecar mutation, including
  Windows and link aliases.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `targetReplacement`: The command owns one target entry. Other entries, comments and line endings
  stay byte-identical.
- `cleanupNarrationRecordings`: Only reserved generated pairs can be retired; the committed sidecar
  always wins over a draft.

### src/main/operations/block-inspection.ts

- `readEditorSnapshot`: One complete I4 read view supplies both outline identity and exact source
  ranges.
- `readBlockInventory`: Source addresses are one-based tree paths, qualified by the lesson path.
- `readBlockInventory`: Publishing allocates visible page filenames across the manifest's lesson
  order.
- `readBlockInventory`: Reader pages omit frontmatter and retain pages with hidden titles. Renderer
  blocks include generated titles/declarations and can project one source child several times. Count
  distinct direct source nodes.
- `readBlockInventory`: Probe the registry rather than duplicating its eligibility rules in the
  host. This first inventory covers node edits; insertion, inline and clipboard need their own
  targets.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `readBlockInventory`: Probes use this admitted snapshot's IDs, even when they are provisional.
- `selectPageBlocks`: Resolve pages before blocks so a missing block cannot hide another matching
  page.
- `selectPageBlocks`: Only the admitted inventory can supply a lesson; never read a selector path.
- `inspectTextFields`: Canvas fields need no structural-operation inventory or eligibility probes.

### src/main/operations/canvas-text-bindings.ts

- `canvasTextBindings`: A rendered ID and its sole authored owner must both belong to this
  admission.

### src/main/operations/local-editor-store.ts

- `checkedLocalPath`: Fixed local paths must not alias another directory, even inside the course.
- `localIgnoreChange`: The author project may have no root ignore rule. Keep all local bytes
  private.
- `buckets`: Older recovery projects may use .PRAXITY without any editor storage. Keep their archive
  inventory available; existing draft bytes still require exact paths.
- `LocalEditorStore`: File buckets work before identity is stored. No session capability enters
  storage.
- `draftPersist`: Diagnostic completion for persistence; legacy APIs retain their throwing contract.
- `draftInventory`: Recovery reads optional legacy files without weakening persistence's strict
  reader.
- `draftExport`: A new folder and exclusive files preserve both existing exports and stored drafts.
- `draftPut`: Ownership and generation checks run under the shared write admission, including when
  separate windows submit concurrently.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `draftPut`: Lost replies do not rewrite current buckets. Legacy retries still migrate atomically.

### src/main/operations/operation-service.ts

- `requestSchema`: The registry owns each operation's argument names and value constraints. Zod 4
  omits __proto__ before validating record keys; refuse it before cloning.
- `expectedRevision`: Compare-and-set: unlike ordinary node rebasing, this binds exact file bytes.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `OperationService`: One session owns history. Clients send IDs, never executable inverse records.
- `plan`: A direct inverse must never come from a client.
- `plan`: A token's absolute offsets cannot be safely rebased without its base owner offset.
- `plan`: O1 expects every parsed lesson represented by the course identity. Unrequested lessons get
  current bases only after all client-supplied preconditions resolve.

### src/main/project-config.ts

- `readCompletionSettings`: A pass mark decides pass/fail, so an unusable one must not silently fall
  back to a completion-only package (or drop the other saved completion rules with it).

### src/main/response-stream.ts

- `openBody`: Keep a terminal handler for the stream's lifetime. Bridges can schedule another error
  after close, when transient pipeline listeners are gone.
- `openBody`: The Web body delivers read errors to its consumer. Here both outcomes must wait for
  close, including completion on a non-auto-closing stream.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `ownHttpResponse`: Attach before asynchronous routing, including buffered files and event streams.
- `ownHttpResponse`: Request-body readers may remove their own error listeners on abort. These
  owners remain until the objects are collected to handle later terminal errors.
- `sendResponse`: fromWeb's reader.closed rejection can arrive after pipeline has settled. It still
  belongs to this response and must never become an unhandled event.

### src/main/standalone-cli.ts

- `expectedParent`: This identity belongs to this spawn, not to browser/export subprocesses.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `stop`: Includes stuck startup; a hung filesystem operation can still exceed this allowance.
- `parentPid`: IPC retains EOF even if the launcher dies before this bootstrap runs.
- `parentPid`: An expected PID covers early Unix reparenting; IPC EOF identifies the launcher on
  Windows.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `{ runPraxityCli }`: Keep expensive imports outside the bootstrap, including in the packaged
  artifact.

### src/main/studio/author-document.ts

- `serveStudioAuthorDocument`: Projects only admitted captured HTML. All course resources stay on
  the learner origin.
- `serveStudioAuthorDocument`: Capture browser APIs and erase the bearer before any course element
  is parsed.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `addStudioReadModeLink`: Learner scripts and content are preserved. The mode link contains no
  editor capability.
- `addStudioReadModeLink`: The full-viewport deck must reserve a row for Studio instead of covering
  its header.
- `addStudioReadModeLink`: Reserve a row in plain Read; the review client moves this same link into
  its header.
- `addStudioReadModeLink`: Hash the captured source set; the manifest does not map lesson IDs to
  source paths.

### src/main/studio/export-service.ts

- `close`: The admitted RPC owns and reports any job error. Shutdown drains that same promise after
  cancellation, without reporting it twice.
- `perform`: Compiler cancellation is wrapped by exportProject. Output/cleanup failures must still
  surface, even when cancellation happened too.

### src/main/studio/identity-review.ts

- `URL_REFUSALS`: These grammar messages name what to use instead and never quote the source, so the
  band shows them in place of the general repair sentence.

### src/main/studio/narration-policy.ts

- `studioNarrationStatus`: Browser sessions disclose availability only. Credentials never cross the
  bridge.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/studio/preview-diagnostics.ts

- `previewDiagnostics`: Preserve localization and source metadata without copying authored operands.
- `CanvasPracticeDiagnostic`: Content-free practice refusal from a canvas build: code and source
  position only.
- `file`: Absent when only compiled output identified the violation.
- `canvasPracticeDiagnostics`: Canvas builds report only these two practice codes, as code and
  source position. References, block IDs and upstream messages stay on the server.
- `canvasPracticeDiagnostics`: Compiled-only refusals have no source span; never invent one.
- `canvasSourceLocation`: One pass keeps a file name such as "{line}.prax" literal.

### src/main/studio/preview-scheduler.ts

- `PreviewScheduler`: Session compiler. Admitted inputs enter here; filesystem and revision
  ownership remain in the host and operation service. One job yields one event-loop turn.
- `renderDraft`: Null means the latest admission removed this page; undefined uses context facts.
- `renderDraft`: Grammar requires a page boundary. It belongs only to this in-memory parse; a draft
  introducing another boundary is an escaping edit.
- `renderDraft`: Replace the entire source node, retaining sibling pages and real file coordinates.
  A field without a trailing newline must not swallow its sibling.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `renderDraft`: Container drafts need the same child identities as editSource's durable plan. Leaf
  and type-changing drafts keep P3a's small parse: a new container has no previous child identities
  to retain. Neither path touches a file.
- `renderDraft`: Layout regions have no standalone node fragment. The durable path and whole-page
  compile still handle them.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `renderSmallEdit`: A suppressed event's RPC response may belong to an obsolete renderer. Keep its
  fragments eligible for the current subscription's page patch.
- `enqueueRefresh`: Queue full input/context preparation with page compilation. A newer complete
  admitted input replaces any refresh that has not started.
- `selectPage`: `sent` tracks a page, not a frame: a newly selected frame may lack what an earlier
  one received.
- `refresh`: A patched page cannot follow a changed page list; its frame needs a new document.
- `refresh`: Fence running work before sending an optimistic fragment for the new seq.

### src/main/studio/project-session.ts

- `createStudioProjectSession`: Capture the session scope before opening an admission. Deferred jobs
  must acquire fresh locks, never inherit a released T1 AsyncLocalStorage scope.
- `createStudioProjectSession`: Exact admitted source hashes distinguish our own watcher echoes from
  outside writes. Events still read current bytes through the admitted lesson reader.
- `rememberSources`: A contained-invalid commit is still admitted source; suppress its own watcher
  echo.
- `createStudioProjectSession`: Opening the editor admits a writer before any authored-file
  discovery. Subsequent snapshots and previews remain strict readers.
- `identityReview`: Opaque invalid lessons must not prevent entry to valid lessons. Confirmation
  still validates the whole graph it would persist.
- `previewInput`: Preview consumers retain the last valid lesson slice. Identity admission and
  diagnostics still describe the current disk revision.
- `previewInput`: This reader contains no authored source or content. Fence both the compiler
  projection and its source-admission tree.
- `refreshPreview`: Fence the entire retained course: references may cross lessons.
- `refreshPreview`: Without watcher hints, any asset may have changed before this admission.
- `refreshPreview`: An invalid unlisted lesson has no preview page. Report its diagnostics on the
  retained course without blocking valid jobs.
- `createStudioProjectSession`: Writers keep invalid lessons opaque; preview still needs their
  transient read identities.
- `createStudioProjectSession`: Fence the whole course: a cross-lesson refusal may name only the
  reader file while its private target still has D02's runtime refusal.
- `createStudioProjectSession`: Metadata, assets and the complete context belong to the scheduler.
  Its read admission starts after this durable write releases the lock.
- `createStudioProjectSession`: The queued job owns a new admission. Its identity must be issued
  here too, since outside edits can precede their watcher.
- `createStudioProjectSession`: The durable write succeeded. Report preview failure without turning
  its acknowledgement into a failed save that the client might retry.
- `createStudioProjectSession`: Keep late-arrival tombstones for this lifetime; bound receipts
  containing author payloads.
- `save`: Authorization reads the manifest. Admit the save before that read so this authorized write
  can recover an interrupted previous save.
- `createStudioProjectSession`: Only the editor's metadata baselines are admitted. Plaintext editing
  is deferred.
- `createStudioProjectSession`: The shared draft owner passes absolute paths. Keep metadata
  admission here.
- `createStudioProjectSession` registers the `previewRenderDraft` RPC to look up its page in
  `goodLessons` and call `scheduler.renderDraft(request, page ?? null, draftIdentity)`. Those saved
  pages were admitted at open, commit or watcher delivery. This handler opens no new project-file
  admission, file or lock and does not mutate persisted drafts.
- `createStudioProjectSession` registers `draftPersistenceReconcile` to inspect
  `draftAttempts.get(attemptId)`. A missing entry does not prove that an earlier authenticated
  `draftPersistenceSubmit` request cannot still arrive. Reconciliation inserts a `fenced` entry
  before replying, so that late submission cannot begin executing the same attempt.
- `createStudioProjectSession`: Chokidar reports renames as unlink/add, including directory moves.
- `createStudioProjectSession`: Source, identity and context belong to one admitted revision. A
  saved operation's watcher echo has identical input and is ignored.
- `createStudioProjectSession`: T1 replacements can outlast Chokidar's atomic window. Wait for that
  transaction before treating its unlink echo as deletion.
- `createStudioProjectSession`: A queued refresh may already know real outside bytes. Only the
  commit's own bytes suppress grammarChanged.
- `createStudioProjectSession`: Decoder, path and configuration errors may throw before the parser
  returns diagnostics. Fence output and preserve the error.
- `createStudioProjectSession`: An unlink echo may already have replacement bytes to publish.
- `confirmIdentityRetirements`: A preview failure cannot turn an acknowledged identity write into a
  failed save.
- `subscribe`: Reload may open its stream before the old socket closes. The newest subscription owns
  the draft epoch; older closes cannot reset it.
- `close`: Drain scheduled compiles before disposing the preview they render into; collect every
  cleanup failure rather than stopping at the first.

### src/main/studio/read-only-server.ts

- `handle`: Learner preview shares this origin. Never let it install a worker that can replace
  inspection responses.
- `handle`: Relative learner links keep this namespace, including their captured resources.
- `handle`: Bearer credentials, including the editor capability, have no meaning here.
- `handle`: Keep the descriptor, not the mutable path, after admission ends.
- `handle`: Admission can fail during release after the descriptor was opened.
- `handle`: Canvas and binary asset reads get only this exact, read-only origin grant.
- `handle`: A released document's bookmark must not override its retained slide fragment.
- `handle`: Omit a fragment so native navigation carries a deck's current slide.
- `handle`: Canvas HTML is transformed as a complete document, including on HEAD.
- `handle` uses the origin captured when `startStudioReadOnlyServer` binds its listener. The handler
  rejects a request whose Host header or URL names another origin before granting resource access;
  it never derives the allowed origin from request data.
- `handle`: Author CSS/fonts remain captured learner resources, with only this exact CORS grant.
- `startStudioReadOnlyServer`: Reject expectations explicitly so Node cannot send headerless 417 or
  100 responses.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/studio/review-http.ts

- `data`: The refusal closes the connection, without consuming an unbounded remainder.
- `createReviewHttp`: The host mints a fresh random credential for each listener; never persist it.
- `isRequest`: Inspect raw and normalized paths so dot segments cannot escape admission.
- `handle`: Canonical UUIDs and literal separators only; never decode or normalize route identity.

### src/main/studio/review-store.ts

- `checkedPath`: Fixed paths refuse links and native spelling aliases, including on case-sensitive
  disks.
- `readReviewIdentityEvidence`: Called inside an existing project admission; never initializes a
  review.
- `removeOwnTemps`: Only our fixed files' UUID temp siblings can be discarded after a crashed write.
- `writePrivateFile`: Unlike the public course writer, these bytes never enter root recovery
  archives.
- `containsGitMetadata`: Git also discovers git directories directly, without a containing .git
  entry.
- `existingReviewFolders`: Only existing plain folders need probing; path admission rejects links
  and non-directories.
- `requireNoRepository`: Without an index reader, every private folder and ancestor must be readable
  and Git-free.
- `tracksReviewStorage`: Match fixed private folder names conservatively across native spelling
  aliases.
- `tracksReviewStorage`: Hashes and collision tails need not retain either fixed folder's prefix.
- `queryReviewGit`: Git can inspect metadata outside Node's fs grants. Ambient overrides must not
  redirect discovery.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `queryReviewGit`: Git docs checked: core.fsmonitor; core.pager/pager.*;
  remote.*.promisor/uploadpack, core.sshCommand/gitProxy and credential.helper (lazy fetch);
  core.alternateRefsCommand, filter.* and diff.* (not used by these index/path queries). Disable
  index hooks, paging and transports. The empty allowlist also beats protocol.<name>.allow
  overrides.
- `isLinkedReviewWorktree`: Advisory only: missing Git, child-process permission or failed discovery
  never blocks the CLI.
- `refuseTrackedStorage`: Share one deadline across all enclosing indexes, below T1's five-second
  lock wait.
- `refuseTrackedStorage`: Even an empty repository here can track comment paths without either
  folder name.
- `refuseTrackedStorage`: A redirected worktree can give index entries without either private folder
  name.
- `refuseTrackedStorage`: A skipped ceiling can discover an ancestor; its index still covers this
  course.
- `refuseTrackedStorage`: Ask at every ancestor: core.worktree must never choose where this walk
  ends.
- `publishDurableSet`: Every acknowledgement follows fresh publication of the whole set in this
  admission. Visible paths, matching bytes and re-flushing are not proof: Linux can mark pages clean
  after EIO. Create/flush root -> .praxity -> reviews, publish the ignore, then create the review
  directory, flush reviews and that directory, and publish manifest then state. Ignore comes first
  because even unacknowledged private bytes can survive a crash. Windows target flushes rely on the
  NTFS metadata log; FAT/exFAT remain best effort.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `transaction`: Only a cold read whose first lock appeared retries; a full lock deadline never
  does.
- `openReviewStore`: One durable default review per course; no state survives between admissions.
- `openReviewStore`: Existing reviews open read-only, without recovering or reclaiming course
  archives.
- `openReviewStore`: A crash can leave the empty directory before the first manifest. Reuse only
  that directory; any private bytes without a manifest must refuse.
- `openReviewStore`: Only explicit false permits first-use repair. Missing flags predate this marker
  and count as initialized. Publish true durably before any comment is admitted; thereafter a
  missing state always refuses, preserving acknowledged receipts.
- `mutate`: Check visibility even for a historical retry; C1 owns new-text admission and receipt
  equality.

### src/main/studio/server.ts

- `__PRAXITY_CANVAS_SHA256__`: Replaced with a build-owned literal in the standalone CLI; never read
  from the environment.
- `DEFAULT_PORT_START`: Avoid Rubato's reserved 41700-41999 ports and their +1000 learner ports.
- `STUDIO_IDENTITY`: Escape untrusted terminal controls before this value can enter any message.
- `identifyStudio`: An occupied port is untrusted. Never follow redirects or let its response stall
  startup.
- `finish`: Close without injecting an error into a socket that Node may have detached.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `identifyStudio`: A total deadline also bounds peers that keep sending bytes without ending.
- `end`: Drain oversized chunked uploads without retaining them. Closing while the client is still
  sending can reset its socket before it receives the 413.
- `uiFiles`: Capture only trusted build output. Project files never participate in editor routing.
- `startStudioServer`: Claim the port before identity persistence, preview compilation and watcher
  startup.
- `startStudioServer`: Refuse linked lineage before temporary-output setup can touch the sidecar.
- `requireLocalLaunch`: Isolated Read uses another loopback port; its Edit link is a same-site
  navigation.
- `retryCanvasNavigation`: Stale document links restart admission after the active build settles.
- `redirectCanvasDocument`: Issue author fragments only after compilation; Read clears them before
  changing origin.
- `handle`: An explicit empty fragment prevents the ready URL's bearer reaching learner HTML.
- `handle`: Six simultaneous tabs fit without replacing each other's one-use admission.
- `send`: XHR progress delivers small records without fetch's WebKit padding workaround.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `send`: write(false) means backpressure, including a healthy large lesson. Bound queued bytes
  rather than dropping that lesson at the first false result.
- `handle`: Share the in-flight capture so queued tabs cannot release each other's output.
- `handle`: Background projections are transient reads; entering an author document still reviews
  identity.
- `handle`: Zod includes unrecognized input keys in its message; they cannot classify project
  errors.
- `startStudioServer`: Keep raw headers available for duplicate checks; the byte limit still bounds
  parsing.
- `startStudioServer`: Reject expectations explicitly so Node cannot send headerless 417 or 100
  responses.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `close`: HTTP's callback must not gate cancellation or owned-file cleanup.
- `close`: Existing preview leases can be released while an unrelated export is still draining.
- `close`: Admitted preview builds may finish during close; release their late leases too.

### src/main/studio/temporary-outputs.ts

- `prepareStudioTemporaryOutputs`: Keep compiler writes outside the course; retain receipts for
  interrupted outputs.
- `reclaim`: A changed temp root or unknown receipt must not authorize arbitrary recursive deletion.
- `reclaim`: Unknown receipts must not authorize deleting authored or journal recovery bytes.
- `prepareStudioTemporaryOutputs`: A reused live PID delays recovery; it must never authorize
  deleting active outputs.
- `prepareStudioTemporaryOutputs`: Receipts contain machine-local paths; keep them out of the
  course's Git history.
- `recordOutputStage`: Persist before opening the stage, so even a hard exit leaves a recovery
  receipt.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
