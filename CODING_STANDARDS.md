# Coding standards

Before changing an area, turn each applicable check into a test that fails with the defect present. Tests for a guard plant the violation. Expected results come from the contract, not another call through the same cache or implementation.

## Host retirement

- [ ] `praxity studio` opens Read preview; `--review` enables comments. Retired author routes and session write APIs refuse requests. Source changes use `praxity edit`, including `--rendered`.
- [ ] CLI packaging excludes the retired canvas renderer and its digest; retained inspection and review assets keep their inventory and provenance. The legacy shell and Electron entry, preload, IPC and updater remain absent. Keep CLI-imported operation, identity, narration, inspection and export owners even under `apps/desktop/src/main/`. Never delete author records as part of retirement.
- [ ] Audit deleted tests by the interface they exercise. Keep tests of surviving owners even under retired UI directories or when a retired fixture only supplies test registration. Split mixed suites and retain their service, CLI and published-output assertions, fixtures, generated histories and planted-bug controls.
- [ ] Optional legacy draft discovery never blocks Studio startup or archive listing. Report skipped filenames and reasons, export readable drafts, and preserve every local byte. Exercise foreign files, sync copies, malformed JSON and unreadable files through the built CLI. Aliased storage still refuses export; the destination must be a new directory, including when an existing directory is empty.
- [ ] One-use Read admissions retain a bounded set with a short expiry. Six concurrent root documents reach Read mode in Chromium, Firefox and WebKit without redirect loops or bearer disclosure. Non-GET requests never use document retry.

## Frame bridge and editor trust

Threat model: the Page lens retains its opaque origin and private frame protocol. Course markup and CSS remain hostile. The retired browser editor's controls and author transport are historical in [ADR 0067](docs/adr/0067-canvas-browser-behaviour.md).

- [ ] Every inspection HTML response enforces an opaque origin with CSP `sandbox allow-scripts`, grants only the injected bridge's fresh nonce, and strips course scripts, `meta` refreshes and declarative shadow roots. JSON data blocks stay; they never execute. Learner frames, popups and other inspections cannot read its document or nonce. Opaque subresource CORS grants apply only to admitted captured artifacts; project media, downloads and editor APIs retain their admission rules.
- [ ] An opaque inspection's `"null"` message origin never supplies identity. The first handshake requires the current frame window, fresh channel, page ID, exact envelope and one private port; later frame events use that retained port. Host commands target only that window; the frame checks the exact editor origin and parent source.
- [ ] A frame's trust lasts only until it navigates. The Page lens never loads a page in place: the inspection runtime cancels every link activation and asks the host, which remounts the page. Its guard also cancels any click retargeted to an SVG `<use>`, because the instance tree hides a cloned link from `composedPath()`. A navigation guard never re-resolves a reference the browser resolves: chained references, percent-encoded fragments and SMIL-animated values all differ from the attribute. Same-page links move focus to their target without navigating, since WebKit fires the frame's `load` for a fragment navigation. They decode the fragment the way the browser does. Any host mounting the retained inspection protocol admits one port offer per iframe lifetime and drops trust when that document navigates. The legacy React frame host is removed. Test with course content that navigates (a refresh, a link) in Chromium, Firefox and WebKit.
- [ ] A host never posts a port or identity to an inspection window, and never to `"*"`. The inspection document offers its own private port; learner frames receive theirs at the exact course origin.
- [ ] Removing course scripts from a surface lists every protocol duty the runtime performed and names its new owner or its removal. In the Page lens, `startInspectionPreview` owns `connected`, `ready`, `escape`, `focus-boundary`, `author-bypass`, `focus`, `logic` and link requests. Deck `active-page`, utility dialogs and learner state are removed there; the glossary dialog loads the learner runtime.
- [ ] A deferred retry of a frame command is cancelled by any newer command of the same kind. A refused focus retry never overrides a later focus request.
- [ ] While a legacy inspection source field remains open, frame writers retain every connected node, including feedback text, stale handles and measurement probes. Update text and attributes in place, defer structural patches until close, and keep retired chrome inert and hidden from assistive technology. Settlement does not replay unchanged native focus or caret. The retained `frame-bridge/source-input.test.ts` and `patch.test.ts` cover this boundary.
- [ ] Settlement never moves focus the author has moved. Check native ownership when a queued command reaches the frame, before any focus, caret replay or retry. Cases leaving before settlement and after command dispatch guard this.
- [ ] Reply focus carries gesture-time node owners. BODY requires an admitted control removed by render, with no later trusted input. Reply selection waits for native focus confirmation. The generated reply-focus model and durable focus-ownership browser cases plant each violation.
- [ ] A primary pointer gesture on admitted authored content keeps native source focus until its queued click selection arrives. Blank space, chrome, secondary buttons and a source that already lost focus retain native behavior. The staged U7 host's CPU-throttled browser case is retired; the retained frame bridge's `source-input.test.ts` covers the native-field owner.
- [ ] Pending focus reports may change selection only for draft exits that close the field. Stay-save, refused stay-save and opening another node retain their source layer and protected selection on return. Durable browser cases and generated interleavings cover these paths.
- [ ] Declined reply focus leaves the post-operation history snapshot intact. Delete cancellation followed by Undo/Redo targets an existing survivor; generated cases also deliver stale acknowledgements during the next request.
- [ ] Negative focus tables isolate each guard with admitted controls: a different node for owner mismatch, the expected node for document blur, and BODY without a removal witness.
- [ ] A focused native field owns its caret. Host focus commands never move it, and they replay a selection only when the field lacks focus. A continuous-typing case across a landing save guards this.
- [ ] Native keyboard, pointer, focus, dialog-cancel and message listeners register through `frame-bridge/listeners.ts`. Admission checks `isTrusted`, the input document, and the exact message origin and current frame window. Framework keyboard handlers reuse `isTrustedEditorInput`.
- [ ] Only `frame-bridge/page-lens.ts`, the per-mount WeakSet registry owner, reads trust markers (`data-praxity-*`, `data-focus-role`, `data-node-id`). Markup, clones and restored attributes never admit chrome; geometry supplies marker kinds to the owner.
- [ ] All events after the first handshake use the private port. Refuse replacement ports, and close ports and remove listeners on swaps and disposal. Each replacement frame receives the fresh channel returned by `prepareSwap`; a handshake from the old document during the gap is refused.
- [ ] T1 and T2 tests plant violations in each guarded directory, including computed method names, handler properties, method and dataset aliases, indirect selectors and uppercase HTML attribute names. Unknown listener and selector names refuse outside owners.
- [ ] Specs mounting inspection frames plant hostile markup with `installHostileMarkup` from `apps/desktop/e2e/browser-editor/fixtures/hostile-course.ts`: authored markers, implicit live roles, a tabbable embed and, where handles matter, CSS covering them. Playwright's `evaluate` bypasses CSP, so it never stands in for a course script; script refusal is proved by `inspection-csp.spec.ts` loading real course scripts.
- [ ] Course CSS cannot cover or hide a handle or its focus ring. Handles are manual popovers in the top layer, kept beside their node in the DOM; their rules are `!important` in a per-mount layer declared before any course stylesheet, with literal colours, and their geometry and zoom are inline `!important`. Hover is hit-tested against measured node boxes, not event targets; when CSS hides a node beside an open or focused handle, placement measures again with every handle neutral, top-layer handles read their zoom without probes where `currentCSSZoom` exists, a missing origin falls back to the last good one, and placement never throws. The editing lens removes declarative invokers (`INSPECTION_INVOKER_ATTRIBUTES`) and nonces description ids. New lens chrome that must stay visible follows the same pattern. `lens-reveal.spec.ts` plants `HOSTILE_HANDLE_CSS` and declarative invokers in always-show and hover modes, and `HOSTILE_STATE_CSS` in always-show mode, in Chromium, Firefox and WebKit.
- [ ] Hostile markup leaves source, selection, layers, focus, announcements and commands unchanged. Patches silence learner live regions again; embeds leave Tab and genuine keys work. Run frame-bridge, U4 and U5 specs in Chromium, Firefox and WebKit on Windows and Linux.
- [ ] Authored `data-praxity-*`, focus and node attributes cannot impersonate owned chrome or redirect focus.
- [ ] Synthetic keyboard events and frame-posted shortcut envelopes cannot commit drafts, delete content or move host focus.
- [ ] Inspection removes embedded frames from keyboard navigation and silences implicit live roles such as `log`.
- [ ] Each operation announces once, including bursts and replacement translators; disposal removes listeners.
- [ ] Every shortcut has an adapter handler; reordered modifiers still collide with reserved combinations.
- [ ] Selection stays within the focused sibling group, Space toggles membership, moves retain tree focus, and region cycling skips hidden frames.

## Source edits and bytes

- [ ] Frontmatter, BOM and page boundaries come from grammar; frontmatter never consumes a page ordinal.
- [ ] Every edit preserves bytes outside its requested range, including BOM, CRLF, CR, mixed endings and a missing final newline.
- [ ] YAML edits retain unrelated comments, flow syntax and line endings; a BOM stays before existing or inserted frontmatter.
- [ ] Unclosed frontmatter and unapplied edits return a coded refusal with zero writes.
- [ ] Competing draft owners and older generations cannot replace a newer unsaved draft.
- [ ] Undo checks its written slices and preserves unrelated edits, aliases and moves between lessons.

- [ ] Inline parses reused within a plan match the final bytes after structural cleanup.
- [ ] Interleaved plans keep descriptors, snapshot hashes and executable history independent.
- [ ] Shared move candidates cover both lessons through forward and inverse planning.

## Caches and the file system

- [ ] T1 imports no identity modules or the content-identity package. Recovery facts use canonical native basenames and preserve per-file original and installation evidence. Changed, contradictory, active and historically ambiguous short-name or Unicode journals stay unknown; inspection changes no disk bytes. Windows plan paths containing `:` refuse before staging. POSIX colon names still import, delete and recover older journals before later saves.
- [ ] Protected lineage excludes window state and local drafts. Each protected-path entry has a removal control, including moved legacy registry assets.
- [ ] I4 write admission, including merge preparation and persistence, refuses linked, special or cross-device lineage paths before allocating identities. Files with `nlink > 1` refuse; directory link counts and zero file link counts pass. T1 first isolates abandoned publication aliases; read admission and an already admitted live publication may see `nlink == 2`. Refusals name the path and explain plain-copy recovery in EN and FR with unchanged store bytes. Protected lexical paths resolving outside protected folders use that same message before staging; window-state and local-draft saves remain ordinary writes.
- [ ] Historical-name ambiguity is scoped to possible protected paths. Accented, NFD and short-name-like ordinary assets and lessons retain committed overwrite/delete facts. T1 dependency plants include package aliases and relative source imports, including case variants.

- [ ] Cached and fresh results agree after a same-size write in the same second, including coarse timestamps and a missed watcher event.
- [ ] Cached metadata and bytes describe the same admitted file handle when a symlink is retargeted and restored during a read.
- [ ] Reader clock skew and wall-clock jumps cannot enable stale asset reuse. Freshness uses the filesystem clock per batch; unproven freshness verifies bytes, and settled assets require no byte reads.
- [ ] Captured configuration methods, hooks and mutable RegExps cannot leave stale sanitizer results; stateful RegExps give repeatable results.
- [ ] Changing a definition on another page invalidates every cached reader, including variables parsed into HTML strings.
- [ ] Cached results cannot share mutable state with callers; compare identity assignments and status as well as counts.
- [ ] Compare cached output with an independent uncached call made before warming the cache.

- [ ] Batched file work drains every item after a failure, closes every handle, and keeps a fixed concurrency cap and deterministic output order.
- [ ] Byte-bounded caches account bytes through eviction and oversized replacement, and keep bounds and LRU order under concurrent admission.
- [ ] CI scripts that run git several times in a row on one repository turn off automatic maintenance and gc (`-c maintenance.auto=false -c gc.auto=0`) in their single git helper; a detached repack can replace `.git/shallow` mid-sequence.

## Scheduling

The draft-rendering, commit-refresh and subscription-epoch requirements below describe the retired browser editor. Read preview retains outside refresh, compile scheduling, diagnostics and stale-result fencing. Historical performance evidence remains in the linked gate contract.

- [ ] Draft-node rendering performs no T1 admission or write. Per-page draft sequences reject older requests, and a refusal restores saved HTML while retaining the persisted draft.
- [ ] Durable node responses use the latest admitted siblings. Full input/context refreshes stay in the scheduler queue, reject obsolete work and diagnostics, and acquire a fresh admission after the write.
- [ ] A page compile suppressed by a pending draft is redone after the last draft on that page settles, saved or reverted. Reverts use the latest admitted revision, including outside edits to the drafted node or another node on the same page.
- [ ] Drafts belong to nodes and transactions. Each accepted draft emits exactly one saved or reverted settlement, including after newer drafts on the same page, page removal and renderer disconnect. A refused transaction restores its own node.
- [ ] Each preview input reads identity, source, manifest, settings and assets within the admission that issued that identity. Queued commit refreshes reacquire identity before reading other inputs, even before outside changes reach the watcher.
- [ ] Per-page draft sequences belong to the current renderer subscription epoch. A new subscription ends old pending drafts and accepts sequence 1 on previously drafted pages, even before the old stream closes. Obsolete disconnects cannot reset the new epoch; stale sequences within it still refuse.
- [ ] A sent-fragment cache represents delivery to the current renderer subscription. An RPC response to an obsolete connection cannot mark fragments as delivered after a reload.
- [ ] T2 measures 20 leadership page-17 commits from the gesture: draft render at 100 ms p95 and durable acknowledgement at 600 ms p95. Host timings never stand in for frame-paint evidence.
- [ ] T2b counts only complete 30-commit runs with whole-run CPU mean <30%, max <50% and an idle disk preflight. Missing probes refuse eligibility. Three eligible first-20 p95s pass by their median; publish every run's maximum and gate each volume separately. [Gate contract](docs/context/testing-strategy.md#scheduler-latency-gate)
- [ ] Continuous edits have a maximum burst wait and a bounded compile count; five commits within 100 ms still produce at most two compiles.
- [ ] Layout-region edits do not poison optimistic node rendering or block a later valid revision from compiling.
- [ ] Invalid lessons retain their last-good output and diagnostics while valid lessons continue compiling.

## CLI, RPC and refusals

- [ ] `init` inserts only missing VS Code hide entries into JSONC, preserving existing bytes and explicit `false` values with EN/FR notices. Reruns do not rewrite settings or duplicate Git exclusions. Only recovery directories and transaction journals go through the course-scoped `info/exclude` owner, including linked worktrees. New `.praxity/identity/` files stay untracked and stage with `git add -A`; `.gitignore`, identity and retained recovery copies remain unchanged. Invalid or ambiguous settings refuse before writes.
- [ ] Init respects every matching workspace `false` glob, accepts empty settings, and keeps comments and indentation in place. EN/FR summaries describe each actual outcome, workspace-folder scope, User-setting precedence and how to unhide. Refusals stay localized, distinguish a missing course, and report completed writes. Check read-only settings and Git exclusions on POSIX and Windows, preserve writable modes, and plant atomic write failures without partial bytes or temporary leftovers.

- [ ] Plain-store refusals keep their message key and offending path through CLI and canvas RPC. EN/FR show platform commands with backups outside lineage and keep typed text without a blind Retry. Startup checks lineage before temporary-output writes; other identity errors keep their own classification.

- [ ] CLI and canvas text edits change only the selected source bytes, identity snapshots and lesson heads. No edit writes review metadata; existing review files stay byte-identical, including malformed retired records. Test every editable text kind through CLI and canvas RPC, plus source UUIDs and addresses. Revision guards never choose selector intent. Rendered admission is explicit when IDs coincide.

- [ ] Retained review and inspection assets keep their inventory and provenance checks. Missing, empty or substituted assets refuse startup; real packaged bytes still start. The removed canvas bundle requires no digest or embedded-entry check.

- [ ] Every registry operation refuses inherited argument and setting names such as `__proto__`, `constructor` and `toString` through service and CLI, without throwing or writing.
- [ ] Every refusal code has English and French copy and an exit-code class; missing and ambiguous targets have distinct codes and statuses.
- [ ] Early parser and batch refusals honor `--lang fr` wherever it appears in the command.
- [ ] Stale revisions and escaping lesson symlinks refuse with zero source, identity and run-metadata writes; dry runs leave those bytes unchanged.
- [ ] Content pages named Glossary or Resources coexist with utility documents and export successfully.

## Geometry and layout

- [ ] Handles align with content inside translated ancestors, CSS zoom and scaled frames.
- [ ] RTL reserves the physical handle gutter on the correct side.
- [ ] At 320 px with enlarged French text, menu rows grow without overlapping adjacent actions.
- [ ] Tall popups scroll within the available space without covering their anchor.
- [ ] Popups follow transformed anchors even when body dimensions stay unchanged.
- [ ] Authored theme attributes cannot change owned chrome colors.

## Identity and ordering

- [ ] Recovery restore durably holds its source archive before applying a plan. Admission reclamation and I4 pruning retain it until explicit resolution. CLI tests restore every file across intervening reclaiming saves, report verified holds, preserve recovery facts and fresh-course admission, and retry after a process dies following hold publication.
- [ ] Held archives do not spend I4's prune-candidate budget. Three restored sources followed by narration edits and real I4 persists keep other protected archives bounded. Malformed holds remain unverified without blocking inventory, safe extraction or explicit resolution. EN/FR assert unheld status before restore and explain resolution after success or a failure that published a hold.

- [ ] Automatic T1 reclamation retains protected and historically ambiguous names, including capture-free preparations. Only I4 persistence can prune verified protected archives, after valid live-store checks and owner-parsed live copies of every protected captured or installed file in the same course namespace. Files without a namespace proof stay retained. At most three archive candidates are examined per persist. Rolled-back evidence requires live proofs for protected originals, not undone installations. Repeat the keep proof after quarantine rename; test missing and invalid live bytes there. Only identity-store.ts imports the pruning API, enforced by source-owner lint. Missing course, missing heads, missing snapshots and corrupt stores keep archive names and bytes. Rolled-back first writes with no protected original can initialize; ordinary accented root lessons and unrelated extensionless or .yam short-name-like assets retain ordinary facts. Verified unpublished preparations without readiness, captures, installation/commit decisions or a root journal report rollback; contradictory markers remain unknown. Generated real-store histories track retained evidence and fail planted retention and pruning bugs.

- [ ] With no live course record, I4 admits verified ordinary recovery archives and protected first-write rollbacks with no protected original, including writes rolled back after an installation. Unknown, conflicting, protected originals and committed protected installation evidence refuse with zero writes, including a committed first write missing installed markers. Host and conversion guards remain unchanged.

- [ ] Repeated blocks retain their IDs and active status after an unrelated edit in another lesson.
- [ ] A canvas field opened before another tab's first durable write resolves only through installed I4 correspondence, including captured lesson/page scope. Cover absent and established identity, both save orders, duplicate wording, stale bytes, deleted nodes and revoked evidence. Whole-file revision and expected-text guards still refuse with zero writes.
- [ ] Retained canvas aliases reserve runtime tokens until session invalidation or close, including deleted fields. Test held and fresh fields after attempted token reuse, real cross-file node forgeries, translated captured sibling IDs after page deletion and collection, and a changed course namespace that preserves durable node IDs followed by another promotion. Plant each surviving guard independently.
- [ ] A canvas request during another tab's launch rebuild may temporarily lose document admission but never revokes held runtime locators. After identical rehosting, another page's first durable write and collection, the held field still saves exact bytes. Fresh source-revision metadata remains available after rehosting.
- [ ] Identity rebasing preserves current aliases, slugs and unrelated placements during undo.
- [ ] Scoped identity admission equals full admission under delayed or multi-file watcher batches, case-only renames and `course.yaml` changes, proven by a randomized differential over IDs, readers and slugs.
- [ ] Retained identity state is invalidated by its owner on every store, inventory or watcher error, and a fixed-size session shows no retained heap growth under forced GC.

## Draft persistence

Local recovery storage and retained editor-core rules remain applicable. References below to browser persistence RPCs, session receipts and renderer acquisition describe the transport retired on 2026-11-22.

- [ ] Directory-kind refusals are classified at the owning read; put and remove preserve obstructing bytes.
- [ ] Recovery or rollback ambiguity takes priority over an error's copied errno; test a real rollback conflict.
- [ ] Reconciliation names the complete immutable operation. Clients check echoed service, attempt and operation identity.
- [ ] Terminal payload retention is bounded. Eviction keeps late execution fenced and returns unavailable.
- [ ] Persistence adapters use the fenced submit path; an unfenced persistence RPC is not exposed beside it.

- [ ] Queue tests observe each submitted version, metadata predecessor, removal barrier and live request before recovery; a final-record assertion alone is insufficient.
- [ ] Permanent refusals stop blind replay. Genuine later generations remain eligible only for the same target; superseded does not mean saved.
- [ ] A fresh request binds only an identical complete snapshot, including its persistence version. Retired request IDs never receive a later saved acknowledgement.
- [ ] Unknown execution retains its write fence until terminal proof; lost replies are distinct from definite no-write failures.
- [ ] Retry clocks are injected, capped and checked before submission. Repeated closed failures progress without reopening and never loop in one wake.
- [ ] Logical close captures inactive and idle-delayed drafts through the controller, detaches callbacks and hands owner shutdown a retained storage continuation.
- [ ] Generated coverage reaches each queue phase and checks current acknowledgements. Each rule's planted bug must fail the generated selection itself.
- [ ] Inconclusive reconciliation clears only its running token, keeps the write fence and schedules a bounded next opportunity. New requests remain answerable in Unknown.
- [ ] Close preparation skips unchanged durable restoration, including restoration-only metadata changes. Another window's deletion stays deleted.
- [ ] Owner-close settlement waits for reconciliation and any fenced resend, or transfers retained recovery with no subsequent send.
- [ ] Generated immutable-input and binding controls vary caller-owned bytes, persistence version and expected predecessor independently.
- [ ] Open, refresh and reset share one acquiring lease. Lookup remains null through draft listing, resolution and restoration; every await rechecks cancellation, epoch, file and snapshot admission.
- [ ] Retained recovery restores without advancing saved markers. A stored competing record survives, and explicit environment repair revalidates admission before retrying.
- [ ] Replacement project owners wait on the previous owner's continuation. Unknown recovery cannot certify terminal storage.
- [ ] Recovery exposes immutable local and stored alternatives, including ID collisions across files. An accepted new intent retires only its inherited snapshot.
- [ ] A throwing fresh-interest callback cannot strand a reconciled attempt in Sending; retention and a later closed-origin wake remain available.
- [ ] Owner-close continuations compose through owners with no acquisition, cancelled acquisition and completed acquisition. Inherited Unknown attempts keep fencing their file.
- [ ] A restoration baseline ends at the first successful acknowledgement. Restore, save, let another window delete or advance the draft, then exercise each close event.
- [ ] Discard of retained text guards the complete author-seen stored version under the deletion's write admission. A different stored winner stays on disk and in recovery.
- [ ] A removal guard names its submitted predecessor or retained refused snapshot, never an unsent successor. Discard while Sending or Unknown leaves no discarded draft after terminal completion.
- [ ] A refused remove deletes nothing. Undo and later author edits leave Needs author and reach the store without replaying that removal.
- [ ] Generated admission changes occur during inherited drain, own drain, listing and resolution. Isolated lease identity, Unknown settlement and repair-file/reason plants each fail the generated selection.
