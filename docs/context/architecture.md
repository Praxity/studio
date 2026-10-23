# Architecture

Praxity Studio hosts grammar 4 projects through the standalone CLI and thin canvas. A project contains `.prax` source, course metadata, assets and `.praxity/identity/`. Preview and export remain local.

## Authoring flow

```text
.prax source
  -> readLesson() with an I4 identity provider
  -> PraxityBlock[]
  -> editor state and previews
  -> local project files
```

- `apps/desktop/` owns the standalone CLI, thin canvas, authenticated server, filesystem access, preview services and export commands. Its directory name is retained.
- `packages/content-model/` owns dependency-free block data types, constants, and inline grammar formatting.
- `packages/editor-core/` owns the grammar editor, panels, document store, accessibility checker, and adapter-backed editor features.
- `packages/grammar/` owns grammar 4 tokenization, the lossless tree, schema and `readLesson()` renderer projection. Hosts retain source bytes; source edits do not regenerate the document from renderer blocks.
- `packages/shared-blocks/` owns renderers, viewer navigation, logic evaluation, and published-viewer strings. It re-exports content-model types for compatibility.
- `packages/format-renderers/` owns native course PDF rendering and shared Typst escaping and typography.

Course PDF export skips empty or malformed content blocks and returns localized diagnostics to the CLI. It still fails for content integrity guards, missing assets, and compiler errors.

The shared author checker warns when lesson frontmatter has no nonblank `title`.
Check, CLI inspection and export use that rule; exports return the file and a
localized fix hint without blocking publication. The project export-input builder
owns learner lesson labels: authored titles stay intact, and untitled lessons use
`Lesson N` or `Leçon N`, where N follows the manifest's lesson order. Pages headers,
sidebars and Guided module labels consume that same label.

Grammar 4 source hosts resolve through `identity-store.ts`.
I4 write admission requires plain lineage storage before resolving or persisting
identity, including merge preparation. After T1 isolates abandoned publications,
`lstat` must find regular files or real directories on the canonical project root's
device. Files with more than one hard link, symbolic links, junctions and special
files refuse with the English/French `desktop.identity.plainStoreRequired` message
and instructions to replace the named path with a plain copy. The check covers
the `.praxity` directory itself, the identity tree, legacy content identity,
narration and the review tree. Window state and `.praxity/local` are excluded.
Startup takes this admission before temporary-output setup touches the sidecar.
The CLI and canvas carry the refusal key and path. One shared EN/FR message gives
Terminal and PowerShell commands that copy first, retain the linked path outside
lineage, then install the plain copy under the original name. The canvas keeps
typed text and offers no blind Retry for this refusal.
Read admissions retain their existing rules. A live T1 publication may have two
links after I4 has admitted the write; only the next write admission checks again,
after T1 has isolated any leftover archive aliases. Project-root aliases remain
valid because admission supplies the canonical root.
`resolveCourseIdentity()` is the candidate API for explicit write owners. It takes the complete lesson inventory and optional draft
source bytes, validates the course registry and all immutable history, and calls
`@praxity/content-identity`. It returns lesson reads, reusable `ids` providers and
the identity resolution. `readCourseIdentity()` and ordinary `resolveLessonSources()`
expose an independently projected runtime read view. Unstored nodes, lessons and
course namespaces use non-UUID runtime tokens. A `CourseIdentitySession` owns
continuity, with separate saved and in-memory draft scopes. Preview, inspect,
block inventory and draft resolution consume the view. Its synthetic
snapshot hashes describe display bindings and have no persistence issuance.
Persistence, operation bases and export refuse it, including views of saved content.
Preview draft planning and operation eligibility probes translate through I4's
admitted input and return only projected display nodes. Read proofs retain the
stored input and display view, without a candidate graph. Planning builds fresh
unissued evidence for that call. Operation resolution
and CLI dry runs project mapping, focus, inverse guards and refusal members onto
the same display bindings. Their read evidence grants no write authority. CLI
output validation accepts runtime tokens only for dry runs; write requests and
durable outputs retain UUID checks. Refused applies and history writes project
their members through I4's display bindings; unknown members are omitted.
`resolveLessonSourcesForWrite()` discovers the manifest inside its write admission.
Non-strict `resolveCourseIdentity()` also requires a write admission, so both
entries refuse nesting under a reader. The source-owner check limits writer
imports to the named write owners, refuses CommonJS loader references in desktop
production source, and confines test-helper imports to tests and test infrastructure.
Strict publication reads retain their saved identity checks. Candidate issuance
belongs to the active write transaction,
including nested admissions. Closing it, on success or failure, revokes issuance
and removes the private candidate proofs. A retained reference cannot persist,
authorize an operation base or enter read planning after its transaction closes.
Resolve and persist must run inside the same outer write admission. Durable results
retain their stored proofs.
Candidate APIs retain the existing canonical-byte checks. Every read-only result and
provider is marked transient.
Successful explicit writes return `correspondence` pairs from runtime tokens to
the UUIDs that write installed, separately from the durable identity graph.
I4 prepares the match before installing files and releases it only after success;
session invalidation revokes a prepared transition. Saved and parsed draft scopes
both switch to durable bindings. Pairs describe author selection, focus and open
drafts only. They never enter stored snapshots, lineage, executable history,
narration/review targets, preview events or frame commands. Reads suppress them.
The operation and history RPCs return the pairs on the authenticated author
origin. `editorChanged` and `/api/session.editorSeq` fence delayed replies by
sequence; the browser also checks its connection epoch and disposal, without
retrying a write. The controller applies pairs before reading durable seeds and
omits the metadata from history. `openSource.displayId` associates an ID-free
draft with its display node in session memory; persistence keeps its guarded
target. New-editor DOM attachment remains a separate host slice.
The store retains per-snapshot validation proofs within a 16 MiB payload budget
and an eight-course LRU limit. Every load still reads the complete store through
the existing path guards. A proof binds the exact admitted UTF-8 bytes' SHA-256,
native filename and directory identity, opened-handle device/inode/birthtime,
change time and link count, and course namespace. Metadata changes invalidate
proofs; exact bytes, namespace and bound names authorise reuse. Stable metadata
never authorises reuse on its own, and coarse, missing or pre-birth change time
does not deny it. Relinking identical bytes to the same bound name is harmless:
snapshot validation has exactly the same inputs and returns the same result.
Changed bytes are hashed on every read and receive fresh validation even when
metadata stays unchanged. Current heads retain full validated graphs.
Unchanged historical proofs retain lesson IDs, parents and slug/alias reservations;
only current heads retain parsed graphs and canonical bytes. Changed or evicted
snapshots receive fresh validation. Every parsed store rebuilds ancestry,
historical reservations and current-head checks across all cached and fresh facts.
Per-snapshot payload accounting runs when facts or head graphs change, rather than
serializing the complete history on every save. Errors discard the course's proofs.
Returned stores are copies.
`IdentityStoreCache` supports explicit disposal and byte limits; zero bytes runs
independent fresh validation. Disposal prevents in-flight reads from retaining
records again. Git revision validation always runs fresh.
`writeLessonSource()` also retains its first private validated store until that
save completes, including stores larger than the global cache budget. Persistence
still rereads every store file through the path guards. Exact inventory, bytes
and opened-handle identity must match before reusing validation; changed stores
use the existing validation and conflict checks. Success and refusal both release
the save-local evidence and revoke its owner, including in-flight continuations.
The course file proof also includes its native directory entry spelling and
symbolic-link status, so identical bytes from the same inode cannot hide entry changes.
Read admissions retain recovery archives and never run recovery or create lock
files. An interrupted transaction refuses inspection until editor open or
`praxity recovery run <project-dir>` recovers it through write admission.
An inventory omitting a recorded lesson still on
disk refuses with that lesson's path; deleted paths are checked through installation.
`resolveLessonSources()` holds one read admission across lesson discovery and
identity resolution, so a competing save cannot commit between their snapshots.
It reuses an enclosing write admission when called during a save or editor open.

Host sessions pass a `CourseIdentitySession` to retain the validated store,
inventory, lesson reads and cross-lesson descriptor index. Every admission checks
exact store bytes and every lesson's source bytes inside the project read admission.
An unchanged source can reuse its ordered identity proof and immutable head;
only changed lessons rebuild descriptors and node records. Course-wide candidates
and slug reservations remain in the resolver. This also detects a changed move
donor before its watcher event arrives. Any store or inventory change discards the
retained state. Watcher errors and session close invalidate it explicitly. An
unproven baseline or inventory change uses full admission. After persistence, the
session seeds an unchanged admission from verified installed store bytes and its
private lesson reads. Recorded operations can adopt the registry's single-use
plan only against a store-issued base, exact source inventory and revisions,
operation evidence and inverse metadata. Client-supplied resolutions cannot
qualify. Forward plans also supply private reader descriptors from that same
parsed inventory. Admission copies them after checking the plan, so binding
reader IDs does not describe the source again. Inverses retain fresh description.
Slug and alias reservations still cover the complete stored history.

Validated store graphs remain private to I4; public store and resolution results
receive independent copies. Issued resolutions retain their canonical bytes and a
private validated value. Unchanged values compare directly, with canonical
comparison retained for harmless representation differences. Post-installation
seeding rereads every store file and its opened-handle identity. Only exact matches
can reuse the privately validated proposed graph and canonical snapshot records;
outside changes receive fresh validation. Cache byte and entry bounds still apply.

`persistCourseIdentity()` copies the identity and source payload synchronously,
then checks it and the expected disk bytes inside admission. Caller changes
before installation refuse the write. It writes snapshots, source replacements and accompanying
metadata in one T1 plan, preparing snapshots first and installing lesson heads
last. Existing snapshot files are never rewritten. Source entries also guard
unchanged lessons against an outside writer. It returns durable providers and a
`ProjectWriteResult`, including any acknowledged cleanup warning. Hosts may hold
one write admission across resolution and persistence; read admissions cannot
be promoted. New namespace directories belong to the same journal and are removed
after interrupted preparation, even before readiness.

Page slugs are allocated once using the shared slug formatter. Explicit renames
retain aliases; every historical slug and alias stays reserved for its page.

Grammar 4 projects a self-check's generic `data.content` as
`{ task, parts: [{ id }] }`, with Studio settings beside it. The admitted read's
lossless source tree owns the model, criterion labels, hints and evidence.
`readSelfCheckContent(read, blockId)` returns validated upstream Content using
that read's allocated IDs, even while the block has only its runtime refusal.
Missing/wrong identities and invalid content throw coded errors without authored
text or a library error cause. One node-to-ID index belongs to each node map,
including reads cloned by identity; no full Content cache is retained.
Identity canonicalization still uses the complete source tree, so hidden edits
change source and canonical revisions while the generic prompt stays the same.
The source-ownership lint declares author owners and rejects accessor/raw-tree
imports or self-check node reads in generic output modules. Its planted-import
test runs through the lint command. Later compiler/state owners must be declared
when their dedicated content inputs land.
Write-distractors uses the same source/identity boundary. Generic `data.content`
is `{ question, count, items: [{ id }] }`, with one canonical count. Its
`readWriteDistractorsContent(read, blockId)` accessor pairs each allocated item
with its misconception and authored option and validates upstream Content.
Publication does not change author Content admission or make structurally valid
authoring nodes unresolved. Deleted items retire through the existing identity
owner. The shared child walker admits prompt item IDs alongside all sibling
block and child IDs. Closed prompt construction
runs before compiler capture, defaults and draft substitution; it rejects extra
own keys, accessors and non-plain objects before cloning can discard them.
Outer metadata shares self-check's explicit whitelist. Narration source and
fingerprints select only the question. Published practice remains optional and device-private.
The compiler captures full distractor Content through typed `writeDistractorsContents`,
separately from pages and generic configuration. Its opaque runtime owns validated
copies and one ASCII-escaped, fingerprinted asset per activity. Page asset references
and source dependencies include the exact ordered Content revision, so equal-length
answer, label and option edits invalidate retained contexts without changing prompts.
Self-check and distractors share only asset encoding and file writing; admission and
revision rules remain pattern-owned. A context can capture valid distractor content,
and published fragments bind only the matching activity asset reference. Explicit native
answer sheets receive a typed Content map; workbooks need no hidden input.
Grammar's `lessonSourceText(read)` gives authoring hosts the exact admitted text
for source hashes and revision checks. It is not a learner output input.
`lessonPageBodyBlocks(read, pageId)` selects projected page blocks without the
generated page title, keeping authored headings and prompt-only self-check data.
Preview draft parsing uses this accessor instead of reading raw node roles.
The formatter reserves `index`, `glossary` and `resources` for publishing utilities.
`assertIdentityExportable()` names pending or invalid pages and blocks and requires
the exact lesson bytes and every reader mapping to belong to a persisted revision.
Transient results, lessons and providers refuse, including reads of saved content;
persistence returns durable providers. Its optional message
formatter uses the English/French `desktop.identity` strings. Missing identity
metadata with narration, review, legacy registry, T1 journal or recovery archive
evidence refuses initialization, including archived legacy identity stages.
Hosts must also pass `established: true` for release evidence held elsewhere.

`packages/export-pipeline/src/preview/course-context.ts` prepares admitted export
inputs for `compileCourse()`. It owns adaptation, desktop asset references, page
splitting, glossary collection, and structural SHA-256 slice digests. Refresh
retains unchanged page block arrays and slices. Lesson slices are keyed by the
host's lesson IDs, with `desktop-source` for a single unlabelled desktop lesson.
Page order belongs to `nav`; `sourceDigest` excludes navigation metadata and the
cast registry and resolved turn metadata. `castKeys` names speakers used on the
page, and `assetPaths` records its asset references. `SLICE_CONSUMERS` declares
consumer scopes. Revalidate `getPageDependencies()` against the refreshed context
to compare page-scoped lesson, cast, asset and narration values; comparing them
with aggregate slice digests would invalidate unrelated pages. Published reading
times come from `html-gen.ts` for both navigation digests and rendered documents.
Variable dependencies scan the normalized HTML strings, including nested `_inline`
display fields, because parsed variable mentions are spans rather than tree records.
The operation service can supply `seq`; callers without a
session start at zero and refresh advances locally. Changed asset paths evict
their captured byte digests. Hosts still own source reads, identity admissions,
cast resolution and narration v2. The preview service retains a project-scoped
admitted asset inventory and its SHA-256 digests. Each build rechecks paths and
size, mtime, ctime, device and inode before reusing bytes. Fresh reads bind the
bytes and before/after stamps to one admitted file handle, then check the resolved
target still names that file. Unknown identity, stamps without observed
sub-millisecond precision, and timestamps within two seconds of admission bypass
reuse per file. Each batch samples the filesystem clock by writing, closing and
statting a unique probe in `.praxity/cache/`, then removes it. Asset stamps are
compared only with a probe on the same device, never with the process wall clock.
Unknown probe times, other devices and read-only probe refusals bypass reuse.
These reads also compare bytes and EOF through positional reads
on the same handle, since even fractional timestamps can repeat across writes.
Only snapshots admitted with already settled stamps may be reused; an earlier
snapshot never becomes reusable merely because its timestamp ages. Watcher events invalidate the
named path and its descendants; watcher errors drop the inventory. Renames arrive
as unlink/add events. New and missing paths are discovered on every build.
`packages/export-pipeline/src/preview/compile-page.ts` compiles one page into
ordered node and region fragments, and renders a substituted draft node with the
same page-local group, visibility, footnote and float facts. `compileDocument()`
assembles cached page content with the document shell and exposes deck outline,
top-bar, glossary-link and reading-script regions. `shellDigest` excludes page
content and these regions. A refresh retains the latest compiled page per ID;
unchanged fragment maps survive while the page result advances `seq`. Older
contexts keep their own results without replacing newer session cache entries.
Course contexts prepare slugs, deck data and runtime plans before rendering,
with one capability plan per module. Hosts supply `htmlOutput` with the published
runtime assets and stylesheet names. Unresolved nodes arrive as a host-supplied
map of node ID to parser message and source line; preview renders escaped error
notes. Publication still refuses invalid source at admission.

`CompileQueue` owns the per-page leading compile and trailing 100 ms quiet
window, with a 400 ms maximum wait during continuous edits. `PreviewScheduler` retains the latest admitted context and page output,
discards results superseded for that page, and yields between jobs. Studio's
`previewSelectPage` RPC selects the visible page and returns navigation IDs;
`previewStats` exposes compile counters and measured stage durations. Session
events are `draftRendered`, `nodesRendered`, `pageCompiled` and `compileFailed`. `pageCompiled`
carries the ordered page patch and changed `documentRegions`, which are outside
the page order. P3b carries `patch`, `patched` and `compileFailed` through the
frame bridge's private protocol. The course preview channel refuses these messages.
Inspection's retained working directory still needs integration with the existing
course host.

T2a uses `previewRenderDraft({ transactionId, pageId, nodeId, seq, source })`.
`source` contains one complete grammar-4 node, including its closer when present.
The host parses it in memory and calls `renderNode` with the saved page's latest
admitted siblings. This path opens no files or T1 admission. Its response and
`draftRendered` event carry `{ seq, pageId, transactionId, state, fragments }`.
The per-page draft `seq` belongs to commit gestures within the renderer subscription
lifetime and must strictly increase;
it is separate from the operation service's admitted revision `seq`. P3b must
fence draft responses in that domain, retain focus, and show Saving until the
matching durable operation settles. A newer draft also holds older page compiles.
Pending drafts are retained by transaction and node, so a newer sibling draft
cannot discard an earlier transaction's settlement. Each accepted draft emits
one `state: saved` or `state: reverted` settlement. Each new event subscription
starts the current renderer epoch, reverts old pending drafts and resets the
per-page sequences. A renderer reload can start again at 1 even before its old
stream closes. Only the current subscription's disconnect can end that epoch;
an old stream's later disconnect cannot reset the new renderer's sequences.
A refusal restores the latest admitted fragment
without deleting S2's draft. If admission removed the node or made it a layout
region, the settlement has no node fragment and the page compile supplies the
current order and regions. A page compile suppressed while a draft was pending
is requested again when that page's last draft settles. Its operation response
supplies the localized refusal key for one announcement. Frame patching, status
copy and the gesture-to-paint T2a gate belong to P3b.

T2b accepted operations and history writes carry a monotonic `seq` and real node
HTML in `render` for small page edits. The response renders only changed nodes
from the durable identity and latest admitted page siblings. It retains T1's
complete durable acknowledgement.
The [scheduler latency gate](testing-strategy.md#scheduler-latency-gate) uses
three eligible quiet-machine runs and reports maxima separately on each volume;
it measures typical saves without weakening T1 or bounding the worst save.

Full admitted-input and context refreshes run afterward in the scheduler queue
under a fresh read admission, including a
fresh identity resolution in that same admission. Commit-time identity never
combines with later manifest, settings or asset reads. Without watcher hints,
the refresh invalidates every admitted asset digest. Not-yet-started
refreshes coalesce to the latest complete input; newer admitted revisions fence
in-flight output and diagnostics. Queue wakeups use the host's captured session
async scope so they cannot inherit a released T1 lock. Watcher source echoes compare
fresh bytes with admitted SHA-256 hashes. Lesson unlink/add events wait for T1
before checking whether the source is still absent. A save's temporary live-name
gap preserves held-field correspondence; a real deletion revokes it. Existing
outside replacement bytes still pass through the revision and text guards.
Outside revisions resolve through the
session identity admission, refresh the context, then compile the visible page.
Parser failures retain that lesson's last valid preview input and output and emit
diagnostics for its pages. Other lessons continue refreshing and compiling.
New invalid lessons have no content to retain; their diagnostics still reach the
host without blocking valid pages. The learner
preview continues to use immutable artifact leases. `SmallPreviewFrame`'s edit
polling cadence is marked for replacement by P3b.

`html-gen.ts` owns rendering rules; `html-pages.ts` writes `compileDocument()`
results and canonical redirects. `createCourseContextFromHtml()` captures the
publisher's already adapted model after asset rewriting, without adapting it
again. Filesystem setup, image optimisation and viewer assets remain in
`build.ts`; selective asset preparation remains a subsequent context slice.

Studio source hosts resolve course, lesson, page, block and child UUIDs through I4. Identity lives in `.praxity/identity/`; source contains authored names for logic, not generated IDs. Studio opening and saves persist identity; save installs the supplied source bytes and identity through one write admission. An unchanged save does not replace `.prax` files. Preview drafts resolve in memory. CLI and Studio browser exports use strict read admission and refuse pending, invalid or transient identities. CLI export names `praxity identity init <course>` to record identity explicitly. Inspection also uses read admission and never persists identity. The lower-level export builder defaults to read-only; persistence requires an explicit `manifestPolicy: "write"`. Current CLI and browser export hosts explicitly set `"read-only"`.

Schema 1 inspection retains its fields and adds `entityId` and `revision` to lessons, pages and blocks. Their revision comes from the resolved identity snapshot. Both inspection schemas and preview hold read admissions and preserve source bytes.

Copy the complete project, including `.praxity/identity/`, to retain identity. The converter establishes grammar 4 identity before installing its approved output. Grammar 3 refusal names the archived conversion command; preparation, notices and archive SHA-256 are recorded in [converter-archive.md](converter-archive.md).

### Retained review evidence

Edits no longer write or consume review records. They update source and I4
identity only; existing `.praxity/review/` files remain byte-identical. There is
no review baseline initialization, refresh, hunk generation or note resolution.

`.praxity/review` stays protected by T1 and remains evidence of an established
course for identity admission. `apps/desktop/src/shared/review/model.ts` keeps
only the schema-1 run and state parsers and their types. I4 recovery uses them to
verify live review files before reclaiming protected archives. A queued run
also requires a valid state in the same course namespace. Missing or invalid
live evidence keeps its recovery archive. This check never writes review files.

### Operation service

The author-only snapshot owner in `shared/editor-session.ts` keeps each lesson's
source once in plain JSON, with expected and editable UTF-16 ranges per node.
`prepareEditorSnapshot()` caps outline labels at 360 UTF-8 bytes, including a
visible ellipsis when clipped, and cuts only at grapheme boundaries. JSON-escaped
label bytes also fit that cap. Unknown directive types travel as their grammar
tree kind. Nesting travels as parent IDs plus local child indexes; decoding
restores full write paths and page IDs. Contract tests assert at most 832 wire
metadata bytes per node; that budget never causes a runtime throw. Encode/decode
timings are recorded without timing gates. CLI inventory is unchanged.

Each lesson deliberately retains the existing IPC source ceiling of 5,000,000
UTF-16 code units. A larger lesson refuses the entire snapshot.
`editorSnapshotSchema.safeParse()` returns a typed failure with a `too_big` issue
at `lessons.<index>.source` and a reason naming the 5,000,000-character limit;
callers handle that result rather than using the throwing `parse()` API.
The schema strictly validates both seed targets, target/ID agreement and range
containment through the range owner. Bad parent links and duplicate IDs return
named parse failures. Runtime IDs are display-only; unstored write targets remain
null.
`block-inspection.ts` assembles the author outline from one complete I4 read
view in a rooted read transaction. Manifest order precedes unlisted lessons.
`editorSnapshot` accepts strictly empty input through the authenticated editor
RPC. Course and learner origins cannot access that RPC or its event stream.
The existing `editorChanged` event invalidates it after session writes and
outside admissions, including preview failures. Its sequence and the snapshot's
sequence come from the operation owner inside their admissions.
The outline contains authored tree nodes. A generated page heading is the
reader's virtual `title` role, not a second editable node. That reader ID remains
in I4's complete source mappings. `buildFrameView()` uses the authored page entry;
Page lens binds the rendered heading and its handle to that page ID. A host must
use the page entry for page-title editing, rather than joining the raw heading
fragment's reader ID to an outline row. This keeps every reader ID in its
admitted mappings without inventing a second source target for the page line.
The legacy browser snapshot transport is removed. The canvas uses the rooted snapshot and text-operation methods below.

`apps/desktop/src/main/operations/operation-service.ts` owns session operations.
Canvas HTTP requests also require `X-Praxity-Canvas`, naming an admitted captured
author-document path. The read-only artifact owner resolves that path to the
compiler's lesson and page identities and page position. Operation admission filters snapshot
bindings to that page and refuses cross-page writes, including within one lesson.
For a captured `deck` runtime, the document contains every slide in its lesson,
so the same admission includes all of that lesson's pages and refuses other lessons.
The scope comes from captured compiler metadata, never course DOM markers.
Retained page identity takes precedence over position when an agent inserts a page;
position is only the fallback for a retired transient identity after a title edit.

The canvas uses `canvasTextSnapshot` with empty arguments and `canvasTextApply`
with `{transactionId, operation: "setText", file, nodeId, baseRevision, expectedText, field, text}`.
The snapshot returns raw inline text, its exact UTF-16 range, the whole-file
SHA-256, and rendered and owning node IDs. The operation package's descriptor
policy admits authored headings and generated page titles, subject only, plain
paragraph body runs, list-entry text, authored choice option labels as `text`,
and authored result feedback parts as `value`. Feedback reader roles resolve to
the actual source part, including shared question feedback and promoted option
feedback. Shared projections have separate rendered IDs and the same source owner.
Video and audio caption parts use the same `value` policy and a `caption` reader
role. Every choice option's authored feedback also has an `option-feedback` reader
record, allocated after learner projection to preserve existing IDs and output.
The grammar owns `AUTHOR_ONLY_READER_ROLES`. Strict export accepts an older
snapshot missing only these records, with every persisted fact unchanged.
Caption IDs occur in learner HTML and still require persistence.
Snapshot part fields carry optional `feedback` presentation with sanitized learner
HTML and an option or question placement, on exactly one binding per source owner.
The learner and bindings use `optionFeedbackHtml` to choose promoted grammar HTML
or inline option feedback before sanitizing. Promoted feedback keeps its paragraph
wrapper. Promoted option feedback is presented under its option; shared question feedback
uses the `any` result. Successful `canvasTextApply` replies return the page-scoped
`fields` after committing, including updated feedback HTML and source revisions.
Figure captions retain a separate body ID and `text` binding per authored
run. Their renderer projections carry those IDs beside the image, never the
figure's ID as a combined text field. Missing, empty and duplicate media caption
parts have no canvas binding. Cross-run inline tokens retain the combined figure
projection without ambiguous field locators. The canvas offers subject, caption,
paragraph, list-item and choice-label buttons, using unique compiler-owned
locators inside block wrappers. Authored feedback presentations require the canvas
browser to place their rows before offering buttons.
Choice labels locate their text span, keeping the input and label container in
place while editing and refreshing. After a save,
the acknowledgement's compiler fragments refresh the field's rendered children,
after the existing inspection-markup owner strips unsafe markup and binds native
fragments to the author page. The acknowledgement's identity correspondence
promotes temporary display IDs before the next edit. Missing render output falls
back to the saved-page refresh without retrying the write.
The acknowledgement's recorded source edits also retain the field's exact saved
bytes and translate the remaining bindings' ranges through the existing source
edit owners. An immediate second edit therefore keeps CRLF and mixed endings
even before the background page refresh finishes.
Generated or translated defaults and the generated "I don't know" option have no
source field. Option markers, answer flags, response settings and sibling feedback
remain outside label fields. Pasted answer markers refuse. Paragraph fields exclude
their final terminator; list fields exclude markers and indentation. Parent list
fields cover only the item's own text, with child content outside the field.
Pasted bullet markers refuse; leading numeric prefixes such as `2026. ` remain inline
text after the item's marker. Later lines reparse in the whole lesson and cannot
introduce list items. Fill-blank sentences and protected code, math or quote bodies
have no canvas field. Ordinary CLI/agent `setText` shares the same list-text policy. A title
resolves through the admitted reader record to its authored page source mapping.
Unstored owners use the existing unique fingerprint fallback, never a runtime ID
as durable authority. Missing or ambiguous mappings refuse.
Canvas admission accepts exactly one field and passes the validated file hash to
the service's strict revision guard inside the write transaction. Every change
to that file refuses, including edits to another block before watcher delivery.
Blank text, structural syntax, extra targets and operations other than `setText`
refuse without source or identity writes. Headings stay on one line. Paragraphs,
list entries and option labels permit prose wraps only when reparsing retains all structural
nodes, their paths, settings and boundaries. Feedback may reflow within its
existing parsed continuation structure. Adding its first continuation or removing
its last continuation refuses with `unsupported-syntax`. Existing wrap terminators survive
LF textarea input at their retained text boundaries, including mixed endings
when a wrap is deleted or inserted. Unmatched replacement wraps retain ordinal
endings when their count is unchanged; new wraps use the field/file ending.
`setText` shares this
validation in the operation owner for CLI, agent and canvas callers. Author
input returns `empty-text`, `line-break`, `unsupported-syntax`, `list-marker` or
`settings`; forged fields return `not-allowed` and malformed envelopes return
`invalid-args`. The captured raw field text is also required and checked inside
admission. Ill-formed UTF-16 and control characters refuse before encoding, so
an acknowledged raw field equals the written bytes.
For page titles and headings, `setText` removes spaces and tabs at the start and
end of the supplied subject. Interior whitespace and paragraph edge spaces stay
unchanged.
Successful scalar edits preserve descendants' IDs and use normal I4 snapshot and
lesson-head persistence. No canvas draft persistence or structural RPC is added.

`renderer/browser/canvas-text.ts` owns the native single-field adapter. Each
snapshot binding locates one rendered text run. Its adjacent
Edit button and labelled textarea live in a reference-owned shadow root with a
manual top-layer popover. A flow spacer reserves their measured height. Studio's
default theme tokens are resolved by the host, independent of course CSS.
Enter and blur coalesce into one immutable submission; composition never commits
on Enter. Paragraph instructions document native Shift+Enter for a wrapped line.
Escape cancels before a save. Pending fields stay read-only, connected
and unchanged. Refusals retain exact input; explicit reload requires inline
confirmation. Unknown transport outcomes check a fresh admitted snapshot before
offering a retry of the same immutable transaction. A failed read keeps retry
disabled. A committed acknowledgement or cancellation refreshes the saved page
through the existing preview build owner and a fresh read admission. The
`editorChanged` stream invalidates output without acknowledging a write.
An open field defers document replacement, including outside changes and late
compilations. Source bindings are checked across the build; a changed generation
or admitted source discards it. Reconnection also invalidates saved output.
Blur preserves moved focus, including course controls replaced by the refresh.
Enter and Escape return to the refreshed button. A retired runtime ID may use
the admitted field's source position to restore focus only, never to admit a write.

Unchanged input closes with no RPC. Refused/unknown text remains kept across
subsequent input and pending saves. Navigation awaits the pending submission;
leaving or Escape then requires the same inline explicit-discard flow as Reload.
Pending saves and kept text register an unload refusal. Top-level `_top` and
`_parent` links use the same pending-save guard as ordinary navigation. A new save retires any older discard
confirmation. A corrected value still saves on author departure; Studio's own
focus moves and moves within the field's recovery controls never save. The inline
confirmation is a group named by its question, exposed when Keep editing receives
focus, without a second live announcement. A departure while that confirmation
is open never saves. Pointer interactions with the panel, including nonfocusable
instructions, are internal interactions in WebKit too. Escape works throughout
the panel, and composition suppresses the panel's Tab handler.
Open native fields move outside course ancestors before focus and remain
connected beside the document root until close. A same-tree `aria-owns` relation
at the heading's flow spacer preserves accessibility reading order while the
shadow root and top layer protect the field. Browser accessibility trees cover
that order; real assistive-technology acceptance remains separate.
Critical root visibility/interactivity properties
remain owned, preventing CSS-triggered blur saves even at the document root.
Root zoom also remains owned. Active geometry clamps into the viewport and
scrolls internally when taller than it. Focus reveals off-screen Edit buttons
without moving an already visible pointer target before its click.
Tab and Shift+Tab resume
native course traversal at the heading's flow spacer, preserving its position
while the open field remains protected.
Compiler block wrappers locate admitted bindings without
letting an unrelated duplicate node marker suppress the real button. A qualified
duplicate or unmapped wrapper reports a localized mapping refusal rather than
silently removing editing access.

The browser session exposes `operationApply` and read-only `operationResolve`
with the grammar operation request, and `historyApply` with
`{transactionId, historyId, direction: "undo" | "redo"}`.
Node targets require exact `expectedText`. UUIDs locate current nodes;
ID-free fingerprints must have exactly one match. Changed slices refuse with
`conflict`, missing IDs with `orphaned`, and duplicate matches with `ambiguous`.
Insertion points can supply ID-free `parentRef`, `afterRef` and `beforeRef`
from snapshot node targets for unstored anchors. The insertion owner reuses
node resolution, requires the current file revision and sibling adjacency,
and normalizes accepted anchors to candidate IDs for operation evidence.
Runtime IDs and contradictory ID/ref pairs refuse. Draft target comparison
includes these anchors so two insertion drafts cannot share a slot accidentally.
All targets resolve before the registry plans edits.

Apply journals source, immutable snapshots and identity heads through I4 and T1.
A store-issued `operationBase` binds recorded evidence to a reconciled outside
revision. Its immutable snapshots enter the same plan as the operation, so every
parent remains readable after restart. Registry evidence contains the allocated
descendant UUIDs, and the host enables reader roles even in an empty lesson.
Successful applies return `historyId` and `writeResult`; cleanup warnings still
acknowledge committed bytes. Executable history records stay inside the service. History
checks current written slices and boundaries before applying all files together.

This first service slice accepts lesson node and insertion targets. Clipboard
operations await integration with the S2 local store. Stale insertion boundaries and absolute inline
token offsets refuse with `stale`; rebasing them needs additional base guards.
Manifest and course targets also await their host adapters. A mutation to an
indirectly selected lesson requires that lesson's client revision binding.

The browser's `browser.editor` bridge exposes the operation RPCs and S2's local
storage and metadata APIs. `LocalEditorStore` journals draft buckets at
`.praxity/local/drafts/file-<sha256-of-filename>.json` and the clipboard at
`.praxity/local/clipboard.json`. These versioned, strict records survive changes
to the browser origin and server port. Schema 2 draft buckets contain the lesson
filename and drafts, with no lesson identity. Unstored lessons use the same file
bucket without allocating or persisting a provisional lesson UUID. Schema 1 UUID
buckets remain readable; the next put or delete migrates that bucket atomically,
including exact retries. Malformed or duplicate buckets refuse without losing
their bytes. Draft IDs include a session UUID and are unique across windows.
First-draft membership uses the manifest's on-disk lesson list inside the write
admission, so corrupt identity metadata and retained write archives cannot block
draft storage. Bucket updates and last-draft deletions guard the captured bytes;
legacy deletion also validates the migration target's local path.
Reuse for another file, scope or target returns a coded `conflict` refusal;
An older generation returns `stale`. An exact retry at the same generation and
`persistenceVersion` succeeds without rewriting a schema 2 bucket. Client acknowledgement
and validation counters do not change that payload. A same-generation metadata
update requires unchanged text, a higher `persistenceVersion`, and an
`expectedVersion` matching the stored version. Missing legacy versions mean zero;
competing metadata updates return `stale`. These checks hold the shared write admission.
The controller tracks `persistedVersion` separately from `persistedGeneration`;
adapters pass the put effect's `expectedVersion` to `draftPut` and reply with its
request ID and submitted generation. Identical in-flight blurs keep that request.
The unmounted U7 project/lesson adapters, persistence queue, staged host and
outline have been retired. The retained session and frame modules still support
the legacy inspection/preview imports. The thin canvas never mounts those
adapters and never calls draft persistence or draft rendering. Existing local
records remain untouched.

The internal `LocalEditorStore.draftPersist` preserves storage diagnostics through
the fenced project service. Generation supersession, metadata competition and target reuse carry their
distinct reasons and stored snapshot. The owner can compare that stored version
with its retained prerequisite; the store does not invent missing predecessors.
Corrupt buckets, unsafe local paths, missing membership and invalid requests retain
their diagnostic cause. Unclassified execution failures stay unknown. Committed
bytes with a cleanup warning still return success. The legacy draft APIs retain
their success and throwing contracts, and storage acceptance predicates are unchanged.

Main's project-service lifetime has a UUID exposed by `draftPersistenceSession`.
`draftPersistenceSubmit` binds an attempt UUID to one immutable operation and
retains its terminal result. Duplicates attach to that execution; another payload
cannot reuse its UUID. `draftPersistenceReconcile` names the complete operation and waits for an accepted
attempt. Terminal receipts echo it; the bridge checks operation, service and attempt
identity. The unfenced `draftPersist` RPC is removed.
The CLI session retains the operation receipts; the legacy browser bridge is removed.
An evicted terminal receipt proves the old
attempt cannot execute again, so its immutable operation can be resubmitted with a
fresh attempt ID. Service-lifetime and operation mismatches remain unavailable.
For an unseen attempt it records a no-write fence before replying, so a late HTTP
arrival cannot execute. Results are copied for callers, and service close drains
accepted attempts. A replacement service refuses the former lifetime rather than
certifying absence from its empty registry. Only the latest 128 terminal payloads remain in memory. Evicted attempt IDs retain
a no-execution tombstone and report unavailable, never absence. Unseen fences last
for the service lifetime.
Deleting one draft preserves its siblings. Listing and deletion retain orphaned
drafts when a lesson disappears. Local paths refuse symlinks and case aliases.
Local writes also journal `.praxity/local/.gitignore`, so author projects ignore
the directory without needing a root ignore rule. Asset/export readers refuse
aliases into it, including a local directory moved into assets by an outside writer.

`draftResolve` shares S1's node-ID or unique-fingerprint lookup and runs under a
read admission. It returns `unchanged`, `changed`, `removed` or a refusal, with
current guarded and editable source in a seed. It never replaces draft text or
persists outside identity. Whole-file drafts compare the exact saved source;
insertion and virtual reader-role drafts still require their target adapters.

`packages/operations/src/ranges.ts` owns `draftText`, which validates UTF-16
bounds and editable containment before slicing exact source strings.
The author-only `editorDraftSeed` adapter in `shared/editor-session.ts` accepts
a lesson's ranges and source, refusing a node outside that lesson's node list.

`manifestEdit` accepts a file, source SHA-256 `baseRevision`, YAML key path and
JSON value. It refuses stale revisions, edits `course.yaml` through `setYamlPath`
or lesson design frontmatter through `setFrontmatterPath`, and installs lesson
metadata with I4 identity in T1. YAML edits retain bytes outside the edited entry,
including the BOM, comments, mixed line endings and flow formatting. Frontmatter
edits retain every body byte. Invalid or unclosed frontmatter returns `invalid-args`;
an edit that would leave the source unchanged returns `not-allowed`.
Grammar's `frontmatter-range.ts` owns BOM-aware fence detection for the lexer,
metadata readers and source edits, retaining raw offsets for every line ending.
`project-assets.ts` owns recursive asset listing and source/internal-file admission,
shared by the cached export inventory and PDF asset reads. Both inventories retain
symlink containment and cycle checks. The clipboard APIs currently store the
cut record's file, text and node IDs; operation integration, retirement and
clipboard history remain a separate slice.

`praxity edit` translates one source-node selector into an S1 request. Dry runs
use `resolve`; writes use `apply`. An explicit expected file revision is checked
inside the service admission and refuses rebasing. I4 installs source and identity
in the same T1 transaction. Neither CLI nor canvas edits write review metadata.
Read-only block inspection reports source-tree addresses, UUIDs, inclusive line
ranges, labels and schema settings. `--eligibility` opts into registry probes for
single-node eligibility; the default omits the operation list.
New provisional nodes use S1's unique-fingerprint fallback. This CLI slice refuses
batches and has no insertion, inline-token or multi-target selector adapter.

### Durable file journal (T1)

Identity and generic text write transactions use `node:sqlite`'s `BEGIN EXCLUSIVE` on
a permanent file under `~/.praxity-studio/project-locks`, keyed by the canonical
project path. Studio processes for the same user and machine share it. The
private cache keeps read-only inspection from changing project files and keeps
authoring file APIs from closing a descriptor for the locked inode. Windows, macOS and Linux release
its advisory lock when the process closes it or dies. The file stores no owner
data and must never be deleted or replaced. Contenders retry asynchronously for
five seconds, then report that the project is busy and keep drafts. There are no
heartbeats, expiry times or PID/host checks. Close older Studio processes before
upgrading; they use a different lock. The `.praxity-write-` directory prefix is
reserved for staging. Only a write admission recovers an active journal and
reclaims verified orphan stages before its callback runs. Strict reads open an
existing lock database read-only and hold a shared SQLite transaction; a first
read with no lock file checks that none appeared during its callback. Reads
refuse active journals with a notice naming editor reopen and `praxity recovery run`.
Cleanup stops at nested `course.yaml`, `praxity.json`, `.praxity`
or `.praxity-transaction.json` project boundaries and directory links. Empty stages
are reclaimed only at the admitted root or at its identified legacy identity stage.
Unowned nested empty stages and unknown or corrupt recovery bytes are retained.

`project-file-transactions.ts` owns durable file plans. `writeProjectFiles()`
admits a course; `applyProjectFilePlan()` applies a plan within an existing write
admission. Each entry carries a relative path, exact text or binary content,
optional expected bytes, and an explicit `head` flag. Null content deletes;
null expected content requires absence. Parent directories must exist. All
paths, permissions and expected bytes are checked before creating the journal,
then bytes are checked again after staging and before each installation.

`assertProjectWritesAllowed()` owns refusal under Node's Permission Model. Durable writing commands, Studio startup and write admissions, review initialization, lesson and identity persistence, and temporary-output setup refuse before file operations with `ProjectPermissionError`, code `EPERMISSIONMODEL`. Since Node 24.22.0, `--permission` blocks file synchronization even with write grants, so durable writers require an unrestricted launch. The conservative presence check also refuses them under `--permission-audit`, although Node allows synchronization in that diagnostic mode. Existing-only review reads, other read-only commands and export remain supported with appropriate grants. Export reads existing identity and replaces its output atomically without fsync; any future export path entering a write transaction still reaches the guard. Unrestricted writes retain every existing file and directory flush.

Existing targets use native basename resolution, including Windows short names.
A protected lexical path resolving to an unprotected canonical target refuses
before staging through the same plain-copy message. A protected file link rejected
by writable-path admission also uses that message. Window-state and local-draft
paths remain ordinary writes through a contained linked sidecar.
Windows plan paths refuse colons, which name file streams. POSIX colons remain
ordinary filename characters, including during recovery of older journals. The import-free
`project-protected-paths.ts` owns the C01 protected paths; asset admission shares
that list. `.praxity` itself is protected; its lineage children are identity,
the legacy registry and review. Window state and local drafts are not lineage.
Narration is protected and is refused as an asset, including aliases to its bytes.
T1 must not import identity modules or the content-identity package, enforced by source-owner lint.

`readProjectRecoveryEvidence()` reports observational facts for recovery entries
at the project root and directly under `.praxity`. Verified archives report a
committed or rolled-back outcome and canonical per-file paths, original-file
presence and installation evidence. A durable commit proves every installation;
otherwise each file needs its own installed marker. A verified preparation with no root journal link, readiness, captures or installation/commit decision reports rolled-back with no installations; contradictory evidence remains unknown. Changed, contradictory,
unsafe, unclassified and active journals report unknown. The shared
`classifyIdentityLineagePath()` canonical-name check reports unknown for historical
short names that could alias narration or the sidecar directory, Unicode root
names that fold to a protected name, and ambiguous segments under `.praxity`.
Ordinary lesson and asset names, including root-level accented names, keep their facts. Reclamation uses this same
classifier and retain both lineage and unknown paths. Active journals still
refuse ordinary read admission; this inspection only enumerates their names as
unknown. Inspection never recovers, isolates, marks conflicts or writes files.
I4 uses these facts when the live course record is missing. Unknown evidence, or
any protected original or committed protected installation, fences fresh identity
with the existing missing-established-course refusal. Verified ordinary archives
and rolled-back writes whose protected files all had no original allow initialization,
even when rollback followed an installation. Such a write never committed identity.
Expected-course, established-course, live-metadata and approved-conversion guards
remain in force.

Before applying a recovery restore, T1 durably publishes a checksum `held` marker
in the source archive under the same write admission. Automatic reclamation,
including I4 pruning, retains held archives. `held` and partial `held.tmp` markers
preserve the archive's recovery facts. Recovery listing reports verified holds as
`held`; explicit `recovery resolve` deletes the archive and releases the hold.
Malformed or unreadable hold metadata stays `unverified` during inspection;
safe unknown storage remains extractable and explicitly resolvable. A restore
failure after hold publication retains the hold and reports resolution instructions.
The marker lives in the archive, outside `.praxity/`.

T1 automatic reclamation never deletes an archive whose plan touches a protected
or unknown canonical name, including preparations without captures. Protected
archives sit outside any archive count bound. T1 has no callback into I4.
After validating and persisting a store within its write admission, I4 calls
`reclaimProtectedArchives(root, keep)`. Its keep decision requires a valid live
store and a live copy of every protected captured or installed file before deletion.
Narration and review state must pass their owning parsers in the live course namespace;
an empty narration read view cannot prove a stored namespace. Review run metadata
also requires valid review state for that course. Other review paths and the retired
legacy registry lack a standalone namespace proof and stay retained. T1 repeats
that decision in quarantine. Unknown or changed archives stay.
Each persist examines at most three archive candidates, including ordinary and
unknown candidates, to bound save-time verification and its two fresh store loads
per protected archive. Held archives are skipped before spending this budget.
Other candidates that must stay can delay pruning later entries;
explicit recovery commands remain available. The bound never overrides a keep decision.
A course that is only read never prunes protected archives. That is clutter,
not loss. Narration and review edits accumulate archives until the next intact I4 persist. Unknown archives remain until explicit resolution. Rolled-back archives need live proofs only for their protected originals; the undone installations need no live replacement. These protected archives have no count bound. Ordinary archives retain T1's existing reclamation rules.

The owner-only `.praxity-transaction.json` at the course root contains a versioned,
checksummed plan bound to the canonical course path. Each file records original
and replacement bytes as base64, their SHA-256 hashes, original permissions and
head status. Its bounded `.praxity-write-<uuid>` directory holds uninstalled sources, staging and
installation markers, readiness, commit/abort markers and independent displaced captures.
New stages are flat. Each replacement has one source named `install-N`, consumed
by installation; deletions have no source or empty per-file directory. Recovery
also accepts the previous directory layout using its recorded stage version.
The journal already archives both sides; installation and rollback consume their source names.
Directory renames record absent destination directories before creating them; rollback
and recovery remove those directories only when empty.
Independent journal copies and staged files write and flush in bounded batches.
Staging checkpoints retain plan order; every batch drains before refusal or
rollback. Readiness, serial installation with heads last, installed markers and
the commit decision retain their existing order. File flushes precede journal
publication and installation; POSIX directories are
synced too. On Windows, each renamed marker, installation identity and retired journal
is flushed again under its final name before proceeding. Node cannot sync Windows
directories. Power loss can still undo acknowledged namespace changes; file flushing
does not establish directory durability. All hosts depend on the filesystem and hardware
honouring flushes. Installation renames the displaced
file into staging, validates that captured inode, then links the replacement without
replacing a concurrent creation. All content entries precede all heads in stable plan order.
Recovery restores an interrupted capture and retains unexpected captured bytes.
New plans publish the flushed device/inode identity through a temporary name and rename
before linking its source. Recovery treats an unparsable legacy identity as absent;
it cannot prove target ownership, so matching outside bytes become a retained conflict.
Recovery compares that identity with the target; equal hashes alone cannot identify
a concurrent creation as our own write. Device/inode numbers use decimal strings
from native bigint stats, preserving Windows file IDs without numeric rounding.
Sharing failures retain bounded retries and expected-byte checks.

The target is absent between capture and installation. Studio's authored-file readers,
including file discovery, tree watcher snapshots, metadata baselines and asset opens,
must hold the course admission through their path checks and reads. Browser save
authorization shares the write admission; reconnect snapshots use one read admission.
The lesson writer also checks the old editor's required save baseline under that lock.
Media opens its descriptor under admission and then streams that inode without holding
the lock for a download. Outside readers can still observe the capture gap. Replacing
the target with a rename after capture would overwrite a concurrent outside creation.

`response-stream.ts` owns response cancellation and terminal errors across Node and
Web streams. HTTP requests attach this owner before routing, including editor files
and events. Preview revisions cancel pending opens and close their bodies before
deployment disposal. Media, downloads and desktop assets transfer captured descriptors
to their body streams; HEAD and rejected requests close them without creating a body.

Studio keeps displaced inodes through the admission that saves or recovers them.
Later write admissions rename each verified archive to a fresh quarantine name,
verify again there, then delete it. Changed or unknown copies remain available to
recovery list/extract/resolve. An intact capture raises no opening notice.
Every retained stage entry has its own inode after admission. Interrupted
publication aliases are replaced with independent archive copies before retirement.
Abandoned-stage cleanup also resumes interrupted isolation and accepts matching
`.independent-` and `.reclaim-` copies by their base file's byte rule.
The quarantine uses a rename; it does not add a hard link to a live file.

The outside-writer contract excludes these exact interleavings:

- Only participating Studio processes for the same user and machine take the lock.
  Other writers and readers can enter the capture gap and observe a mixed multi-file plan.
- A handle opened before capture can write the displaced inode after its final
  verification and unlink, or after explicit archive resolution. Studio cannot
  archive bytes written after the last retained name is gone.
- Between publication and source retirement, an outside writer can rewrite the
  publication inode after quarantine verification, then detach its live name
  before source unlink. A writer can also find and edit a quarantine name after
  verification. Portable Node has no atomic content-and-inode conditional unlink
  or mandatory lock that excludes those writers. Scheduling gives these intervals
  no fixed time bound.
- Outside edits after the final durable installation are subsequent writes.
  Recovery of a committed plan leaves every target alone, whatever its bytes;
  those edits cannot trigger rollback of committed peers.
- Outside edits between an uncommitted crash and the next write admission are
  kept and reported when distinguishable. Recovery restores only the inode/bytes
  the plan owns. Identical bytes on the same inode cannot identify which writer
  produced them.

Native realpath resolves root spelling. Windows and macOS fold the lock key and
durable course binding together. Distinct case-sensitive macOS directories whose
names differ only by case deliberately share the advisory lock.
Binding comparison also folds older mixed-case macOS journals while preserving
their original serialized plan and checksum.

While the admission lock is held, path guards reuse only the admitted root's
canonical spelling. Each use rechecks its native bigint device, inode and birth
time, refusing a replaced root or renamed ancestor. Targets, parents and private
lock-cache boundaries still resolve natively on every use. The root proof is
revoked when the admission callback settles, including for escaped async work.

The course volume must support hard links. A refused journal publication reports
that this project folder cannot create hard links, with English/French guidance
to move it to a filesystem that can. Sharing contention on authored targets after
successful journal publication still gets the existing bounded retries.

All markers are flushed under temporary names before atomic publication. Before
publication in a Git course, Studio appends course-scoped exclusions to Git's
`info/exclude`, preserving existing exclusion bytes and concurrent author appends.
Writers serialize these appends using the resolved common Git directory's lock,
and constrain every exclusion parent to that metadata directory. Linked worktrees use their
common Git directory. The file tree, watchers and asset exports omit reserved
recovery paths. This policy requires no Git executable and changes no authored ignore file.
Durable writers refuse under Node's Permission Model before Git discovery or
exclusion changes. Read-only commands and export do not append Git exclusions.

Recovery validates the entire journal and every completed staged copy before
changing course files. Incomplete preparation with original targets is discarded
when its remaining bytes match the plan or an unpublished prefix. Zero-byte or
planned-prefix Studio temporaries, including marker `.tmp` files, publication copies,
sources, identities, attempts, restoration and isolation copies, are crash debris.
Cleanup reclaims them without an outside-edit notice. A stage containing only
unpublished `journal.tmp` or `journal.publish` preparation is abandoned when no root
journal exists. Unknown or differing bytes remain available and raise a recovery notice.
Before readiness, every changed target belongs to an outside writer, including bytes
equal to the planned replacement. Recovery retains them, reports a conflict and retires the journal.
A committed marker, or readiness plus every durable installed marker without an abort,
finalizes a plan without inspecting or rewriting its targets. Incomplete ready plans
roll back even when live hashes happen to match all replacements. Recovery restores only targets still matching
the bytes this plan installed, rechecking their hashes before each restoration.
Third hashes retain the outside bytes and report a conflict. Original and replacement
copies remain in a marked stage while the active journal is removed, so subsequent
admissions can open the course. Finalization requires no target write permission.
A successful live save reclaims its own completed stage before acknowledgement
only when it holds no displaced recovery captures and touches no protected path, after isolation and byte
verification in quarantine. Replacements and deletions retain their displaced
inodes as recovery archives: an outside editor can still write through a handle
opened before the save. Unknown or changed captures and publication aliases whose
inode checks failed also remain available for recovery. Crash recovery retains
captured originals on non-reclaiming admissions; later reclaiming admissions
repeat isolation, orphan and quarantine checks.
Recovery can itself be interrupted and repeated. Corrupt journals,
wrong-course journals, missing completed stages and unsafe paths fail admission
without changing course bytes. Cleanup warnings continue to acknowledge committed
writes separately from refused writes.

Each rollback attempt publishes its intent before displacement, then separate
displacement and completion markers. Write admission resumes an interrupted restoration
before reading course files; a forward installation marker never substitutes for
rollback completion. Unknown partial staging bytes remain available for inspection.

Manifest lesson inventory edits and narration v2 entry edits require a single YAML mapping document without anchors, aliases, flow comments
or trailing commas. Empty documents and lesson deletions whose block comments cannot
be assigned safely are refused with a localized message before any file changes.
Accepted edits preserve every byte outside their declared ranges and compare the
complete resolved data with the intended result through the manifest or narration reader.

Course creation, manifest edits, lesson create/save/delete/rename,
config, state, asset upload/delete, narration pairs/attachment/cleanup and workspace
creation use complete file plans. Lesson path changes include manifest and identity heads. Narration targets retain
their semantic UUIDs; removed targets require review. Export and both inspection schemas hold one admission across
all source, metadata and asset reads; helpers reuse that admission and cannot promote
a read admission to a write admission.

Studio opening admits a writer before lesson or manifest discovery,
so an interrupted save recovers before loading. Subsequent browser session reads,
all previews, CLI export and inspection use I4 read admissions and refuse active
file journals until a write recovers them. `identity-store.ts` resolves identities
without changing files during preview, inspection, CLI export and Studio browser
export. Studio opening, saves and the lower-level writer export builder persist
the complete grammar 4 identity store. CLI export refuses identity needing persistence and names
`praxity identity init <course>`; that explicit writer command records identity
without replacing source bytes. Exact source bytes remain the save baseline.
Server saves return `ProjectWriteResult`; cleanup warnings acknowledge committed
bytes and advance baselines. `CourseData.manifestSource` owns the exact loaded
manifest snapshot. The CLI and rooted HTTP service report retained recovery archive names; the legacy React read-recovery controls are removed. Project opening
returns retained archive names, keeping a specific recovery notice across retries
and reopening until those copies are explicitly resolved.
`praxity recovery run <project-dir>` recovers an active journal under write admission,
retaining archives. Corrupt journals refuse unchanged; outside edits remain conflict
archives and the command reports the conflict before a retry can open the course.
`praxity recovery list <project-dir>` lists archives and their file hashes without recovery.
Archive reads report changed captures without marking them; write cleanup records conflicts.
`praxity recovery extract <project-dir> <archive> <new-directory>` extracts original,
replacement and captured bytes, refusing existing output directories.
`praxity recovery resolve <project-dir> <archive>` explicitly discards that archive
under the project lock, leaving current course files intact.

Project admission refuses roots containing the private lock cache, its ancestors,
and roots inside it, including canonical aliases. Raw file readers, writers and
path guards also refuse cache paths. On macOS, closing an unrelated descriptor
for the SQLite inode can cancel the process's POSIX locks. Path exclusion prevents
Studio's authoring APIs from doing that. See [SQLite descriptor and inode cautions](https://www.sqlite.org/howtocorrupt.html).

In Node 24, `node:sqlite` has stability 1.2, release candidate, rather than stability
2. It remains experimental. See [the pinned Node API](https://nodejs.org/download/release/v24.22.1/docs/api/sqlite.html).
It was chosen because the shipped Node runtime already provide OS
advisory locks without a native addon, stale-lock inference or heartbeat recovery.
Every Node upgrade must check module availability, `DatabaseSync`
open/close and `BEGIN EXCLUSIVE` on an empty file, cross-process exclusion,
`SQLITE_BUSY` error codes, release on close and process death, and cache isolation.
Run the SQLite runtime contract under the supported Node runtime,
then the project OS lock and path security suites on Windows and native macOS.
The runtime contract fails if the module or exclusive transaction semantics disappear;
there is no fallback that silently omits locking.

### Narration and source edits

Host preview, export and inspection read narration v2 through N1. `narration.yaml` binds entries to the course UUID and targets semantic UUIDs plus roles. `reviewedRevision` and recording provenance determine the review state. Unknown targets remain unresolved and publication refuses them. Narration decorates renderer input without editing `.prax` bytes.

The CLI authors narration v2 through `narration-authoring.ts`. Writes require a saved I4 revision and the exact sidecar baseline. Script changes preserve recordings for review; Accept records `acceptedFor` while retaining synthesis provenance. Grammar 3 and narration v1 require the [archived converter](converter-archive.md).

`self-check-narration-advice.ts` is the declared author owner for self-check narration advice. It reads validated Content through grammar's accessor for enabled explicit scripts, including nested self-checks within the overridden segment. Grammar-invalid drafts skip advice. It returns only `ENARRATIONSELFCHECKSPOILER` and a one-based source line; UI and CLI owners translate using their display language. Matching ignores case, normalizes curly quotes and requires eight characters for whole fields, whole scripts and quoted excerpts. Narration authoring, preview, inspection and export carry that advice; the explicit script remains authored public content. Automatic speech and generic output walkers keep the admitted prompt projection. Pending and merge identity diagnostics never use container match text, which includes hidden descendants; criteria inside self-checks use their IDs instead of labels.

The grammar parser and frozen editor normalize CRLF and lone CR line endings at their input boundaries.
Filesystem reads retain raw source for conflict checks. The shared `preserveLineEndings()` helper
converts newline style without appending terminators to source fragments. Desktop editor saves use `shared/editor-source.ts`
to restore the baseline's final newline. Authoring writers retain uniform LF or CRLF baselines. Mixed-ending
replacements and granular file plans keep supplied bytes literally, including
each line's own terminator. Editor save baselines acknowledge those same bytes.
Course and narration YAML parsers normalize their input too; their writes
retain the original file style.

`packages/grammar/src/supported-blocks.ts` is the supported-block registry. Core blocks appear in authoring UI. Hidden blocks still parse, render, and export, but the picker omits them and validation reports a warning. Structural authoring uses the CLI; the legacy Blocks panel and insertion snippets are retired.

The module-deck compiler applies the content-model `supportsDeckPassGate` response-type restriction. Unsupported authored Pass gates produce a localized compiler error. Group and automatic-answer validation remain separate compiler rules.

The thin canvas calls the rooted authenticated HTTP session. Learner HTML stays on the read-only origin; author documents strip course scripts and run only Studio's nonce-bearing text adapter. `GET /` enters Read mode through `/launch` admission. The old browser shell, Electron main entry, preload, windows and IPC are removed. `pnpm build:cli` packages canvas assets and export support; it refuses startup if the canvas digest does not match. See [browser editor status](browser-editor.md).

`praxity studio <folder> --port <n>` binds exactly that port on `127.0.0.1`.
Without `--port`, the OS assigns a port. An occupied requested port fails without
fallback. A bounded `GET /api/identity` request identifies another Studio by its
canonical course directory; an unrecognized listener is reported as another program.
Identity requests pass the same exact Host and supplied Origin checks as other routes.

`GET /launch` has no side effects and returns `303 See Other` with
`Location: /#session=<token>`, `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`. It accepts no bearer capability and sends no CORS
headers. Static project actions can commit `http://127.0.0.1:<port>/launch` as their
preview URL while each Studio process still generates a fresh session token.
The exact Host and supplied Origin checks apply before the redirect, preserving
DNS rebinding protection. A web page can navigate to `/launch`, but cross-origin
fetches cannot read the response or its Location, including with manual redirects.

The trade-off is that any local process able to make HTTP requests to loopback can
obtain the session token through `/launch`. This is the same local trust boundary
as reading the course files directly; web pages cannot obtain the token. The
read-only preview/media origin keeps its separate random port and capabilities.
RPC, session reads and events still require the editor's bearer capability.

Standalone Studio cancellation reaches the atomic output write. Shutdown closes
owned preview resources while admitted exports drain, with the existing ten-second
forced-exit bound. Each browser session records ownership under
`.praxity/studio-tmp/<pid>-<uuid>/`. Compiler artifacts live in a named workspace
outside the course, under the platform temp root; preview writes leave the course's
disk snapshot unchanged. A matching `owner.pid` and workspace receipt mark ownership.
An output-stage receipt is persisted before writing beside the export destination,
keeping atomic replacement on its filesystem without creating exports on startup.
Startup removes marked directories and their recorded stages only when their
owner is gone; active, unmarked and linked entries, malformed receipts, journal
recovery bytes and completed exports are kept. Workspace receipts outside the
current platform temp root are retained for recovery, never recursively deleted.
A reused live PID conservatively delays recovery. Toolkit launchers should use
Node IPC EOF to identify their parent. Windows numeric-PID polling without IPC is
best effort and cannot distinguish a reused PID.

New Project and sample creation accept an existing empty folder. They build the complete project in a temporary sibling folder, then move it into place. A non-empty destination is rejected without changing its files or the active project. Lesson renames from the file tree update `course.yaml` and the lesson's page identities through the same main-process path.

## Rendering architecture

```text
Grammar 4 source
  -> saved project snapshot
       -> compileCourse() -> immutable learner artifact
            -> top-level learner Read document and isolated author projection
            -> deployCourse() -> HTML, review, or LMS package
  -> live lesson source + compileCourse() -> retained authoring artifact lease
       -> inert page-list card frames and sidebar one-page frame
  -> packages/grammar -> PraxityBlock[]
       -> editor state and theme specimens
```

The live assessment island and shared navigation components live in `packages/shared-blocks/`. Every desktop preview renders a canonical artifact iframe. The export pipeline owns the learner renderer: complete semantic HTML plus planner-selected islands.

Small previews keep assessment surfaces, headings, controls, and group selection
layout aligned with full preview. Assessment groups initialize their shared runtime
in read-only mode to show the initial chooser and selected member without reading
or writing learner state; response controls remain inert.

Small previews sample live source every 1.5 seconds with at most one build in flight
per provider. Each visible preview retains its loaded iframe while one hidden
replacement loads, then swaps after the child reports that fonts and permitted
decorations and read-only assessment-group presentation are ready and two child animation frames have elapsed. Artifact leases
remain held while a frame uses them; failed replacements leave the previous frame
visible. Switching lessons clears the old lesson immediately.

The main rendering contexts are:

| Context | Entry point | Renderer |
|---|---|---|
| Canvas Read | `apps/desktop/src/main/studio/read-only-server.ts` | Captured learner document and runtime |
| Canvas Edit | `apps/desktop/src/main/studio/author-document.ts` | Script-stripped author document and native text adapter |
| HTML and SCORM islands runtime | `packages/export-pipeline/template/src/islands/` | Server-rendered blocks with targeted interactive islands |
| HTML and SCORM static/no-JS runtime | `packages/export-pipeline/src/html-gen.ts` | Server-rendered semantic block HTML |

The canvas compiles the saved project into an immutable artifact. Read mode loads that artifact as the top-level learner document; Edit mode projects it through `author-document.ts` on the authenticated editor origin. The CLI session retains its preview scheduler and captured inspection support. The old React frame host, detached Electron preview window and preview IPC are removed.

The shared `math/render-math.ts` owns inline and display equation output for compiled
artifacts and shared block projections. It emits native MathML once, preserving the
math role and speech label also consumed by the PDF pipeline. Sanitize authored HTML
before processing its inline math spans. The code renderer emits adjacent flex rows
without separator text; the code island reconstructs Copy text from source rows.

The compiler loads on demand. A delayed project-open warmup was tested and removed: it shortened first preview but introduced a 403–619 ms main-process pause while editing. Do not reintroduce background compiler imports without responsiveness evidence. Measure cold import and warm compilation separately before adding artifact caches or incremental compilation.

The headless command in `apps/desktop/src/main/cli.ts` calls the
Electron-free `exportProject()` module. The standalone Node entry bundles this same
CLI and export path with the desktop viewer assets and Node sanitizer dependencies.
It reads `.prax` files, `course.yaml`, project and immediate-parent workspace settings,
and local assets. It enforces accessibility,
builds a `DesktopExportInput`, and compiles the same artifact used by preview. Each
adapter owns its output destination and user-facing result. Export HTML contains the
complete learner baseline plus inert configuration read by the bounded course shell,
deployment host, and selected islands.

Keep preview and export config construction aligned. A change to parsing, navigation, theming, logic, assets, or block rendering must work in both paths.

### Canonical course artifact

Captured local previews and publish targets use one immutable compiled course artifact. The public module interface stays narrow:

```ts
compileCourse(snapshot, options): Promise<CourseArtifact>
deployCourse(artifact, target, options): Promise<CourseDeployment>
```

Compilation owns parsing, page splitting, runtime planning, learner HTML and CSS, runtime assets, asset rewriting, optimization, accessibility enforcement, and artifact verification. Deployment owns captured preview serving or target packaging. A deployment adapter may add review comments or LMS manifests and tracking, but it must not render or rewrite learner content.

Full-course overlay and detached previews load the canonical artifact with its real learner navigation. Studio keeps viewport controls, logic visualization, reset, and author bypass arrows in host chrome. Author bypass navigation inspects physical pages without satisfying learner gates or changing completion, score, or the learner bookmark.

Authoring projections remain specialized:

- Page-list cards render inert page content with no course navigation.
- The sidebar one-page preview defaults to page content without course navigation.
- Theme specimens remain decorative CSS previews.

Stable course, lesson, page, and block identities address learner state across regeneration. Artifact revision identifies bytes, not the learner attempt. The migration is complete. Compilation admits one captured snapshot; deployment serves or packages those exact bytes. Runtime constraints live in [published-output-runtime.md](published-output-runtime.md). Validate assistive-technology behaviour against the supported standalone host.

## Glossary

Glossary entries are derived, never authored separately. `[term]{definition}` in grammar source becomes a `<span class="inline-tooltip-trigger" data-tooltip-content>` in `inlineMarkdown()` (`packages/shared-blocks/src/inline-markdown.ts`). Grammar 4 saves retain source bytes, including definitions; rendered HTML is never serialized back into source.

`collectGlossaryTerms()` (`packages/export-pipeline/src/glossary-page.ts`) walks page block data for those spans and dedupes case-insensitively. `buildScormPackage()` calls it once, after page splitting, so desktop and web inputs are both covered — do not aggregate at a caller. Populated terms then drive three things in `html-gen.ts`: the `glossary.html` page, `glossaryEnabled` in the published config (which shows the course-menu link), and `pageRole: "glossary"`.

Glossary and resources are **utility pages**: synthetic, index `pages.length`, carrying `overrideBodyHtml` and serializing no blocks. They are excluded from completion tracking and the "Page X of Y" counter. Their complete content is server-rendered; do not replace it with an empty client mount.

The glossary opens in a new tab with no course navigation. `initializeCourseHost()`
allows a SCORM glossary to join an existing communication session and commit on
page exit. It cannot start a session, update the bookmark or count toward completion.
A glossary without an active SCORM API creates no runtime. The Electron glossary window is retired.

Grammar's `to-blocks.ts` marks HTML-valued fields with `_htmlFields` on their owning record. Collectors inspect those fields directly. Other labels remain source even when `_inline` holds a noninteractive display copy that flattens glossary links. `content-model/inline-preparation.ts` owns recognition and removal of these inline projection keys. PDF field validation and narration source fingerprints ignore both; runtime JSON and schema 0 inspection omit `_htmlFields` and retain `_inline` display HTML. Other internal fields carry behaviour or identity and remain intact.

## Assets

Local browser media uses the read-only listener's admitted assets route. Export resolves local references into packaged files and rewrites URLs for published output. The Electron asset protocol is retired.

`resolveProjectAsset()` admits public resources for asset listing, preview/export
inventory and PDF reads. Browser editor media and inspection evidence hashing use the same admission
through `openProjectAsset()`. Inspection marks refused assets as blocked with no
digest. Admission refuses `.prax` files, the project's lesson source format, and
Studio's `.praxity` storage, including
identity snapshots, legacy identity metadata, accepted review sources, review
notes and local editor drafts. Transaction journals and `.praxity-write-*` stages,
including captures and installation files, are internal storage too. Canonical
paths under the project's root `.git` and `node_modules` are refused.
Studio has no intentional source-publication exception. Putting a `.prax`
download in `assets/` still refuses admission.
Canonical paths catch symlinks, including internal stores moved into assets and
linked from their original names. Hardlinks compare native bigint device/inode
IDs against source and internal files without reading their content. Each inventory,
inspection and PDF read shares one set of canonical internal paths and computes
protected file IDs once, on the first hardlinked file. Paths and scan exclusions
use the canonical project root. A bulk read that admitted any hardlinked file
scans once more before returning, refusing if an admitted file ID now belongs to
a source or internal file. Ordinary files need neither identity scan.
Hardlinked files with unavailable file IDs refuse.
An unresolvable source link or unreadable directory during that scan refuses with
`asset-identity-unavailable`, naming only the requested asset and carrying no cause.
`openProjectAsset()` also checks the opened inode before reading bytes.
Escaping or dangling root `.git`, `node_modules` and recovery-name links supply
no internal canonical path and do not block contained public assets. An
unresolvable `.praxity` store instead refuses with `asset-store-unavailable`,
naming only that store's path and carrying no cause.
Other refusals carry a code and the requested asset path;
they do not quote source text or name the internal target. A refused file anywhere
under `assets/`, even an unreferenced template, blocks the entire asset inventory,
preview and export. The error identifies the requested asset and refusal code.

This is a path and file-identity boundary, not content detection. An independent
copy renamed from `.prax` to `.txt`, or copied internal JSON under an asset name,
has a different file ID and can be admitted. Extension checks do not catch such
copies. Linux bind mounts can also expose files through a new contained path;
canonical paths and file identities do not establish their original location.
The final identity scan bounds an outside writer's changes during a bulk read;
it cannot prevent changes after the scan. Studio's own writes hold the project
transaction lock. Direct media requests retain admission per opened handle.
Authors own the content they deliberately duplicate into public resources;
asset admission cannot establish confidentiality for arbitrary duplicated text.

When adding an asset-bearing field, update every asset traversal and rewrite path. The key lists live in shared asset-graph utilities, desktop preview URL transforms, and export-pipeline asset resolution.

## Accessibility evidence

The `editor-core` accessibility checker is browser-free and source-aware. It evaluates
authored pages, blocks, asset analysis, and design tokens; rendered HTML, browser
behaviour, and assistive-technology testing remain separate evidence.

Image rules apply to both card faces and to images nested in tabs, accordions,
sequences, columns, and assessment stems or feedback. They use the same alt text and
decorative checks as top-level images. Only boolean `true` in `data.decorative` or
`block.a11y.decorative` marks an image block decorative. Comparison image records and
hotspot or labeled graphic backgrounds also accept an explicit decorative flag.
Informative images still require alt text. Older projects with missing flags remain
informative; string values such as `"true"` do not bypass the export gate.

Comparison image records use the same alt reader in the checker, React renderer and
published renderer. It reads `altText` first, then `alt` when `altText` is absent.
Legacy hotspot assessments also honor decoration on the assessment data or block
accessibility metadata. Decorative labeled graphic backgrounds render with `alt=""`
and `role="presentation"` in both renderers. The labeled graphic group retains its
authored image description or localized group name.

`rule-metadata.ts` is the reviewed catalog for every emitted source rule. Checker
occurrences emit only `failed` or `cantTell`; absence of an occurrence is not a pass.
`buildA11yOccurrenceId()` identifies one occurrence from its rule, page, block, and
authored source location. The identifier is internal and must not depend on evidence
wording or scan order.

Self-check advice takes an explicit author-source map as the third argument to
`checkCourseAccessibility()`. `self-check-advice.ts` is the sole checker owner
allowed to read full self-check Content. It displays grammar diagnostics using
only their code and source coordinates, and uses the pinned library's `annotate()` result to identify
overlapping evidence without repeating the evidence validator. Generic checks
still receive prompt-only pages. The sidebar and course audit supply local source
reads separately, retaining editor identities through source spans; model-only
and hint-only edits refresh advice even when prompt blocks are reused.

The EN/FR catalog covers task spoilers, placeholder hints, long model answers,
long criterion labels and omitted overlap marks. The length guidance is 200 words
and 120 characters respectively. These are review suggestions, not authored
limits or WCAG failures. Advice carries no authored text and cannot block export.
Narration leakage and reporting-mode suspend-size risk stay with their existing
narration and Publish owners. Language mismatch is not inferred from plain text.

Source enforcement blocks export only for failed, high-confidence, critical
conformance rules. Advisory, content-quality, and `cantTell` results remain visible but
cannot block. The accessibility sidebar's Dismiss action is session-only UI state. It
survives panel switches, does not persist a review decision, and does not affect export
enforcement.

## Navigation resolution

The compiler resolves navigation in layers for preview and published output:

```
design.navArchetype -> getNavPreset()          (grammar/src/nav-archetype-presets.ts)
  overridden per-key by design.nav*            -> course nav toggles
  overridden per-page by pageBreak params      (grammar/src/page-nav-overrides.ts)
```

Per-page overrides ride on page-break params (`nav: <archetype>`, individual `nav*` keys, `focus: on|off`). `mergePageNavToggles()` applies them; precedence is course → page archetype preset → page keys. `html-gen.ts` calls these helpers for the `<body>` layout class, fallback-nav suppression, the arrow-key script, and the lesson-heading decision.

**Arrow keys are a floor, not a toggle.** `applyKeyboardNavFloor()` runs on the resolved
set in both paths — `getNavWithDefaults()` in the viewer, `resolvePageNavigation()` in the
exporter. If no visible affordance survives (outline, prev/next, edge arrows, hamburger,
floating ToC), `navKeyboardArrows: false` is overridden. Progress dots and breadcrumbs do
not count: dots are `role="progressbar"` with `aria-hidden` children and breadcrumbs are
text, so neither navigates. Without this a page could leave swipe as the only exit, which
fails 2.1.1 for keyboard users and 2.5.7 for mouse users.

Two rules keep the paths from diverging:

- **The layout class comes from one place.** `navArchetypeToLayoutClass()` maps an archetype to `praxity-layout-*`. For pages with per-key-only overrides, both sides derive the archetype through `inferNavStyleFromToggles()` — never re-infer a layout locally.
- **Override pages use the same native shell.** `resolvePageNavigation()` applies page archetype and per-key overrides before both markup and runtime planning. It selects the navigation island only when behavior needs enhancement; `title:`/`duration:`/`style:` alone do not add a runtime.

The reading guide is a learner aid, not an accessibility remediation or efficacy claim. `useA11yPreferences()` stores only the learner's explicit `focusChoice` and derives the effective value as `focusChoice ?? pageFocusDefault ?? false`. A page's `focus:` param is a default, never persisted. The export boot script in `html-gen.ts` reimplements that derivation for first paint — the two must stay in lockstep, including the localStorage → sessionStorage fallback and validation of older stored shapes.

`render-block-html.ts` stamps every block wrapper with `data-focus-row`; heading and button wrappers additionally receive `data-focus-exempt`. The guide selects top-level rows, so nested blocks inside columns stay atomic, images keep their captions, and an unrecognised future block participates without a block-type allowlist. A heading groups with the following top-level rows up to the next heading. The veil is removed in forced-colors. Published doodle annotations share one debounced, post-layout refresh path for preference attributes, focus-row mutations, content/style mutations, viewport resize, and font loading; RoughNotation and custom wavy/arrow marks are recreated together.

## Theming

Grammar frontmatter and course metadata produce design variants. Editor-core resolves those variants into CSS custom properties. Desktop preview builds a viewer theme from the same variants; export maps them through `packages/export-pipeline/src/desktop-design.ts`.

The shared project export-input builder derives section palettes from resolved theme colours and section overrides for alternate and manual rhythm, and when a block explicitly selects a palette in uniform rhythm. Preview and HTML, SCORM and xAPI exports compile that same input. Automatic colour mode also derives dark-mode palettes and switches their section CSS with the theme. Uniform rhythm keeps its existing background until an explicit palette starts a band. The exporter applies the palette CSS to section attributes and adjusts accent text and activity borders for contrast.

Minimal (`clean`), Waves (`waves`), Grove (`standard`), Dunes (`bauhaus`), Campfire and Plum (`darkroom`) share light/dark palette defaults in `packages/shared-blocks/src/themes/reading-palettes.ts`; the shared token resolver supplies mode-specific content, control and navigation surfaces, plus text, accent, button and status colours. The course picker shows paired light/dark previews for these six themes; retired Blueprint and Marquee remain renderable for existing files. Built-in presets have no background texture. Explicit author overrides remain authoritative. Reapplying a theme supplies its current defaults to an existing course. Texture overlays cover the full content viewport and individual sections. Textured slides paint their page background on that viewport too, so short pages and page padding retain the texture.

The shared token resolver owns note (callout) fills and muted text. Preset high fills blend 7.5% of the source colour before the hue adjustment; Plum light accent notes retain the project's APCA Lc90 target for 17px body copy, measured at Lc90.34. It pushes preset note tints along their source hue so default Info and Success fills remain distinguishable in light and dark mode. If a preset secondary colour sits within 0.02 OKLab of Success, Info uses the accent or neutral text; 0.02 is a design threshold. An explicit author secondary still tints Info. Light section palettes keep the resolved fills and muted text, while other section palettes derive them from their own colours. Contrast enforcement keeps muted text at 4.5:1. Preset muted text blends at 88% and retains the project's APCA Lc75 reading floor on content, navigation and note surfaces, with a measured minimum Lc77.74 across the six light/dark presets. Its contrast stays at most 80% of body text contrast. The earlier 75% quietness cap conflicted with Lc75 in dark presets; 80% is the advisory visual distinction, while the absolute reading floor remains unchanged. Custom colours retain their existing blend and 4.5:1 enforcement. Legacy `color: error` notes still render as Warning.

Blocks consume `--praxity-*` variables. `MantineIslandProvider` bridges those values into Mantine for preview and published viewer components. Theme defaults and overrides must preserve contrast, focus visibility, touch targets, and reflow. Published output has no bespoke high-contrast theme: `prefers-contrast: more` strengthens existing boundaries and state indicators, while targeted `forced-colors` repairs use real borders and system colours without defeating the user agent.

## Logic and learner state

Variables, conditions, actions, and mention resolution live in `packages/shared-blocks/src/logic/`. The logic island uses them in canonical learner output. The SCORM runtime in `packages/export-pipeline/src/scorm/` handles LMS discovery, tracking, completion, score, and suspend data; it does not own content logic.

`shared-blocks/src/self-check-state.ts` owns the version-1 self-check envelope,
draft edits, submitted comparisons and neutral response data. Callers pass full
library Content explicitly. Submitted snapshots carry a SHA-256 comparison revision
over exact decoded authored fields with criterion IDs sorted. Grammar already
normalizes structural line endings and continuation indentation; meaningful whitespace
and Unicode spelling remain exact. The owner uses synchronous SHA-256 from the
already-installed browser-safe hash library, without a Web Crypto requirement.
Material edits return `out-of-date`; unknown saved criterion IDs also reject the envelope.
Both results preserve readable draft text and count no attempt or completion.
Only a valid, current submitted snapshot completes, including zero ticks.
Edits retain the previous comparison; reset clears it. Restore never returns response
data. Storage routing and event dispatch belong to the host and runtime consumers.

An active `disableCompletion` rule gates forward progress from its page. `LogicEngine` exposes the blocked state and distinct authored reasons; `DomLogicRuntime` keeps Continue and forward outline links visible, removes live destinations, associates a visible plain-text reason, and restores their original attributes on release or destroy. `navigatePage()` and authored page actions check the gate before forward jumps, tracking or completion. Keyboard fallback uses the same navigation path; backward and utility navigation remain available. Older gates without a reason use the localized unavailable-page message, and the Studio checker recommends an authored prerequisite.

## Security boundaries

- Sanitize user HTML before `dangerouslySetInnerHTML` with the shared sanitizer.
- Accept embed URLs only through `isSafeEmbedUrl()`; embeds must use HTTPS third-party origins.
- Admit author RPCs with the exact loopback Host, editor Origin and bearer. Learner documents receive no write capability.
- Treat local project paths as untrusted input. Resolve and validate paths before reading or writing.
