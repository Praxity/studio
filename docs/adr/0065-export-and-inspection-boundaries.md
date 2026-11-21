# 0065: Export and inspection boundaries

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Author inspection, preview and publication have different identity and content requirements.

## Decision

### src/inspection-frame.ts

- `startInspectionPreview` callback: The editor bridge needs an exact HTTP parent. A packaged file
  renderer has none.

### src/main/course-file-response.ts

- `courseCsp`: `self` replaces every `'self'` source. CourseArtifactFrame's iframe sandbox makes the
  inspection origin opaque from creation, and WebKit then matches `'self'` against nothing, refusing
  course CSS, fonts, images and media. The server's own origin grants exactly what `'self'` grants
  an unsandboxed document.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
  Related coverage: `apps/desktop/src/main/__tests__/inspection-csp.test.ts`, "enforces an opaque
  inspection origin even without an iframe sandbox" and "allows opaque inspection font reads only
  within the admitted artifact", pins the response policy; the WebKit cause remains unverified.
- `courseCsp`: Nonces are readable by same-origin documents. Every inspection response must isolate
  its document, including direct navigation and popups.
  Related coverage: `apps/desktop/src/main/__tests__/inspection-csp.test.ts`, "enforces an opaque
  inspection origin even without an iframe sandbox" and "allows opaque inspection font reads only
  within the admitted artifact", pins the response policy; the WebKit cause remains unverified.
- `serveCourseFile`: Inspection transforms captured bytes only. Learner serving retains its
  validators and ranges.
- `serveCourseFile`: The server's bound origin, never one read from the request. Inspection names it
  for `'self'`.
- `serveCourseFile`: Only captured artifact bytes reach this owner. Opaque inspection fonts and
  other CORS-mode resources need this exact, credential-free grant.
- `serveCourseFile`: Learner requests do not load the HTML parser.
- `serveCourseFile`: Use the HTML parser, including SVG and template contents. Parsing never
  executes course code.
- `serveOpenedFile`: Transfer an admitted descriptor to the body, or close it if no body is opened.
- `serveOpenedFile`: destroy() closes even an autoClose:false FileHandle stream. Giving the stream
  sole ownership avoids a second close, and closes only after pending IO.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.

### src/main/export/accessibility-enforcement.ts

- `assertExportAccessibility`: Enforce source and animated-media accessibility against the exact
  block set handed to the packaging pipeline. This is deliberately main-process enforcement:
  renderer pre-flight state is useful feedback, but is not an authorization boundary. The
  enforcement decision must come from main-process-owned settings; export input is intentionally
  never consulted for an override.

### src/main/export/build-export-input-from-project.ts

- `ProjectLessonPreparation`: A host-owned, disposable preparation cache. Assets have their own
  admission.
- `lessonSource`: In-memory authoring source. It is never written back by export input building.
- `inheritWorkspaceSettings`: Trusted host policy. Server sessions disable all ancestor workspace
  reads.
- `manifestPolicy`: Read-only by default. Trusted writers must explicitly opt into persistence and
  recovery.
- `lessonFiles`: Host-only lesson selection; never serialized into learner output.
- `sourceRevisions`: Host-only captured source hashes, excluded from compiler manifests.
- `readProjectAssets`: PDF still uses publication's asset-reference guards, but only its selected
  images need bytes (resolved separately by resolvePdfAssets). Admit real paths through the shared
  filesystem policy; never invent missing assets.
- `prepareIdentity`: The caller holds the same admission that issued this identity. Recorded commits
  reuse their durable reader projections instead of reconciling twice.
- `prepareIdentity`: Legacy source must report the converter before I4 publication or persistence
  checks.
- `prepareIdentity`: Practice source refusals precede identity publication. A required container can
  be structurally unresolved and must still report its source-located practice error.
- `buildLessonInputFromProject`: Only explicit native PDF inputs carry grammar-captured distractor
  Content.
- `prepareCourseLesson`: Only explicit native PDF inputs carry grammar-captured distractor Content.
- `prepareCourseLesson`: Registries are lesson-local. Scope only selected custom definitions in the
  assembled input, retaining built-in defaults when a lesson overrides one.
- `retainedCourseLesson`: Admission still runs on every build. Bind preparation to exact source
  bytes, ID-bearing projections and all settings/narration inputs, including other lessons'
  narration targets. V8 bytes preserve undefined, Maps and RegExps without JSON collisions.
- `retainedCourseLesson`: Replacing the owner state prevents an in-flight preparation repopulating
  it.
- `buildAdmittedCoursePreviewInput` is a trusted host adapter called inside the project admission
  that issued its identity. This preview path uses the admitted identity without weakening the
  persistence and publication guards in `buildExportInputFromProject`.

### src/main/export/export-project.ts

- `typstExecutablePath`: Trusted host option; never accepted from renderer IPC.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `temporaryRoot`: Trusted host workspace, never renderer input.
- `inheritWorkspaceSettings`: Trusted host policy; disable for project-rooted server sessions.
- `manifestPolicy`: Read-only by default; persistence requires explicit writer admission.
- `scorm12Storage`: Present for SCORM 1.2 exports, whose progress storage is capped.
- `exportProject`: Validate the captured course before lesson projection or PDF/HTML branching. The
  selective admission owner decides which diagnostics refuse output.
- `exportProject`: Flush progress before synchronous PDF source rendering, and admit pending
  cancellation before starting the native compiler.

### src/main/export/inspect-project-v1.ts

- `startLine`: Original file lines, 1-based and inclusive. Never character or byte offsets.
- `id`: Display identity; runtime tokens cannot anchor durable notes. Use ref within this snapshot.
- `InspectionNarration.unresolvedAnchor` retains the schema-1 legacy field. Grammar 4 narration
  instead uses `InspectionNarration.unresolvedTarget`, whose `id` and `role` identify the unresolved
  target.
- `blocks`: Flat preorder, including nested blocks; parentRef reconstructs the tree.
- `walkBlocks`: Structural paths survive identity overlays and removal of legacy ID rows.
- `walkBlocks`: Assessment prose is classified by its owning assessment projection. Rewalking
  renderer fragments would turn prompts and feedback into body text.
- `narrationLocations`: YAML node ranges refer to actual authored sidecar entries, including
  multiline scripts.
  Evidence: the code comment this replaced (commit bed54f6109aa4ae868c981f53233a5ee9c5afdd7); not
  independently verified.
- `projectDialogue`: Inspect a resolved dialogue model, including legacy adapter turns without a
  speaker. Source coordinates come from the authored G4 fence, not model ranks.
- `inspectProjectSnapshot`: A read-only identity overlay allocates runtime tokens. Only persisted
  identity contributes to the fingerprint of an unchanged authored project.

### src/main/export/inspect-project.ts

- `INSPECT_SCHEMA`: Experimental: block `data` mirrors the parsed grammar and may change between
  Studio versions. Consumers pin `schema` and treat unknown fields as opaque.
- `inspectProject`: Reads a project without writing to it. Export may add IDs and migrate identity
  sidecars; inspect uses preview identities instead, so a project that Studio has never saved gets
  fresh block IDs on each run while its line numbers stay stable.

### src/main/export/inspection-evidence.ts

- `refuseUnsupportedDescriptions`: Both inspect schemas must refuse descriptions their projection
  cannot preserve.
- `assetInspector`: Only explicitly referenced project files are read. External URLs are never
  fetched.
- `inspect`: Leading slash is Studio's project-root asset syntax, not a host absolute path.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
