# 0007: Repository tooling evidence

## Status

Accepted. Records existing behaviour.

## Context

Ownership guards and equivalence checks must fail closed without confusing generated output, source authority or unfinished test runs.

## Decision

### `scripts/check-editor-ownership.mjs`

- `checkEditorSource.literal`: Indirect names fail closed. Following local identifiers without a type checker would miss reassignment and shadowing, allowing marker reads back in.
- `checkEditorSource.visit`: Keep the existing editor checks scoped to their declared targets. Transaction ownership checks also cover shortcuts and the course map.

### `scripts/check-learning-patterns.mjs`

- `verifyTrustedBase`: An empty object database forces contact even when the checkout already has the SHA. Include its authentication config without copying credentials. Keep shallow-fetch boundaries entirely outside the candidate checkout.

### `scripts/check-machine-paths.mjs`

- `machinePath`: Literal paths also occur inside escaped strings. Scan text without decoding source syntax.
- `bigEndian`: Git treats NUL-containing files as binary. UTF-16 BOMs identify text explicitly.

### `scripts/check-source-owners.mjs`

- `sourceOwnerAllowlist`: Exceptions name an expression, not a whole file. New detection still fails.
- `selfCheckAuthorOwners`: Raw self-check access is for author owners. Owners receiving explicit Content need no raw-source exemption; generic output utilities stay prompt-only.
- `selfCheckAuthorOwners`: Source checker advice returns only rule codes and source locations.
- `selfCheckAuthorOwners`: Author inspection drafts project full container source with the identity owner. Review retains exact authored revisions locally, alongside identity snapshots. The author-only snapshot owner prepares and validates source and node ranges. This source-aware host gives author advice about explicit narration duplication.
- `patternRoots`: Test-like names inside pattern roots are not an enforcement exemption: these files can also be explicit browser entry points. Literal data is not code.
- `learnerAuthorityDirectories`: No raw scheduler exceptions: mount disposal and domain guards supplement the lifetime helpers.
- `uiOnlyLearnerEvents`: These events have no learner-state effects. New events require dispatch authority by default.
- `learnerSchedulerExceptions`: These callbacks retain their own guards; other raw uses still fail.
- `checkLifetimeOwners.consumers`: Pattern enhancers retain the same lifetime rules when moved out of template/src.
- `checkLifetimeOwners.visit`: Type annotations do not schedule work.
- `checkLifetimeOwners`: Keep the public provider's set method behind its one write owner, including aliases. privacy-bootstrap delegates to its internal storage adapters after its captured lifetime check.
- `checkSelfCheckOwners.compilerLiteral`: Resolve computed compiler-channel names without widening legacy raw-source checks.
- `checkSelfCheckOwners.unrelatedProjection`: Unknown values fail closed. Types exempt only ordinary arrays and indexed projection records, never a lossless tree or the reader's node-record Map.
- `checkSelfCheckOwners.admittedAccessor`: This bridge may call the accessor; raw tree/node traversal stays forbidden.
- `checkSelfCheckOwners.distractorContentOwner`: Grammar, asset admission and revision hashing own full distractor values. Author tree retention does not grant generic collectors permission to read answer-bearing fields.
- `checkSelfCheckOwners.nativePdfSite`: Both lexical branches are required. The same lookup outside answer-sheet admission refuses.
- `checkSelfCheckOwners.visit`: The `distractorHiddenKeys` declaration owns guard vocabulary and is exempt from detection of authored Content.
- `checkSelfCheckOwners.visit`: The `value.kind` discriminator in `packages/shared-blocks/src/self-check-state.ts` validates saved state and does not read a source node.
- `checkSelfCheckOwners.visit`: The admitted `read` and `identity` cache writes in `apps/desktop/src/main/studio/project-session.ts` retain author-session state. The export-input owner subsequently constructs the prompt projection; caching alone does not publish Content.
- `checkSelfCheckOwners.visit`: Published islands load browser URLs; they cannot resolve Node grammar modules.
- `checkSelfCheckOwners.visit`: The dynamic loader in `scripts/install-internal-studio.mjs` imports installer APIs from the reviewed Rubato checkout.
- `checkSelfCheckOwners.visit.computedDataKey`: Unknown keys could select raw Content. Restrict this fail-closed rule to pattern block-data reads; ordinary indexed presentation records stay usable.
- `checkSelfCheckOwners.visit.upstreamModule`: Only the Content owner may call upstream validation, through its trimmed value bridge. Studio's codec alone admits persisted envelopes.
- `checkSelfCheckOwners.visit.distractorRawContent`: The locale lookup in `packages/shared-blocks/src/i18n/practice-host-strings.ts` aliases imported UI strings without reading authored Content.
- `checkSelfCheckOwners.visit.distractorRawContent`: The constructor in `packages/shared-blocks/src/write-distractors-prompt.ts` reads schema bounds without reading Content.
- `checkSelfCheckOwners.visit.member`: Pattern modules cannot hide Content keys in exported constants or strings.
- `displayIdOwners`: Runtime recognition in the durable parser only improves its refusal message. Display acceptance belongs to narration hashing and private read matching.
- `checkProductionImports.visit.name`: Desktop uses ESM imports so runtime loaders cannot bypass writer ownership.
- `checkProductionImports.visit`: The frame barrel evaluates page-lens CSS; Node owners use the pure view entry.
- `checkDormantChoiceImports`: Choice admission is confined to the state owner, host binding and recovery UI.
- `checkOutcomeOwners.visit`: Reject references too: aliases and Reflect.apply must not bypass ownership.
- `checkOutcomeOwners.visit.internalSuccess`: An adapter may translate its own combined status into its own success field.
- `newTabRenderers`: Each emitting function is exercised by new-tab-links.test.ts. Counts make a new target in an existing renderer require the same coverage review. Each pair counts target literals and marker calls; the tooltip sanitizer also reads the target before marking it in one DOM loop.
- `checkNewTabLinkOwners.reader`: These two consumers only read a target; changing the expression to a writer must still fail, even if the literal count stays the same.
- `checkSourceOwners`: Fixtures intentionally contain hostile source. The lint itself is tested by planting it.

### `scripts/check-test-timeouts.mjs`

- `timeoutRaises.forEach.split`: Match per line: a bare token scanner loses its place after regex or template literals (it can't tell `/` division from a regex without the parser) and skipped real comments.

### `scripts/confirm-slow-tests.mjs`

- `observeConfirmationHost.snapshot`: Telemetry must report its own failure without changing the timing gate.
- `observeConfirmationHost.cpuTicks`: Guest/guest_nice are already included in user/nice, so sum only the first eight fields.
- `observeConfirmationHost.iowaitTicks`: Linux documents that iowait may decrease; retain the signed delta for diagnosis.
- `runConfirmation.child`: Own a process group so a timed-out attempt cannot affect later measurements.
- `runConfirmation.setEncoding.stdout`: EMFILE/ENFILE can return a child without creating its stdio streams.
- `runConfirmation.checkOutput`: Preserve spawnSync's default output cap when switching to streams.
- `confirmationPath`: Vitest reports missing files as failures; keep their path for that diagnostic.
- `confirmSlowTests`: Confirm serially after the shard, with the same project setup and test timeouts.
- `confirmSlowTests.file`: Vitest discovers real paths, including /private/var behind macOS's /var.
- `confirmSlowTests`: Override configured reporters so confirmation cannot recursively rerun itself.
- `confirmSlowTests`: Vitest writes JSON after afterAll: missing JSON cannot prove nothing ran. Only a failed start can retry; any finished report is final as well.
- `confirmSlowTests`: A completed report can still contain failures before child teardown times out.
- `confirmSlowTests`: Owner decision 2026-10-12: macOS nightly timings are advisory; correctness still fails.

### `scripts/equivalence-nonvisual.test.mjs`

- `position`: Poppler 24.02 -struct-text omits the native /Alt value.

### `scripts/equivalence/build.mjs`

- `module initialization`: Executed by the selected checkout's tsx, with every production import rooted there.

### `scripts/equivalence/capture.mjs`

- `narrationReady`: The shared narration player probes durations sequentially after document load. Deck readiness and network-idle can precede verification between those probes.
- `scrollRegions`: Browser-side audit: fullPage alone cannot see nested scrollports.
- `networks`: Observe every request for the lifetime of the page, including resize-triggered fetches after Playwright's one-shot load-state networkidle has already fired.
- `trackNetworkRequests.tracker.waitForQuiet`: Always require a fresh quiet interval after the caller's layout change.
- `initialScrollPositions`: Zero offsets are covered by the initial screenshot. Identify only nonzero scrollers, in their own document order, so unrelated DOM insertions are inert.
- `clippedFocusables`: Content outside a scrollable ancestor is covered by expansion. Audit hidden/clip ancestors inside it, without blaming outer deck clipping.
- `settleCapture.positions`: Lazy hydration may need temporary scrolling. Retain node references so DOM insertions cannot corrupt restoration of the runtime's natural scroll state.
- `capturePair`: One loopback origin is reused across both sides; no warmed browser state.
- `capturePair`: A cancellation is accepted only with a completed load of the same URL.
- `capturePair.verifiedMedia`: Chromium often aborts metadata preloads once the header is read. Fully load each unfinished media URL in this view to corroborate availability.

### `scripts/equivalence/inventory.mjs`

- `deriveInventory`: Each physical document is a view, even a redirect or an unfamiliar utility.
- `deriveInventory`: Configs repeat the course-wide deck list. Capture each slide under its owner.

### `scripts/equivalence/nonvisual-build.mjs`

- `module initialization`: Trusted adapter; all production imports resolve inside the selected checkout.

### `scripts/equivalence/nonvisual-compare.mjs`

- `literal`: Preserve array and Map order; no string, whitespace, path or markup normalization.
- `literal`: Escape marker-shaped author data, keeping it distinct from undefined/Map/etc.
- `zipPayloads`: Parse central/local records, not a byte-signature scan (payload may contain signatures). The only rewritten bytes are local +10..13 and central +12..15: DOS time/date.
- `comparePackages`: Deliberately stricter than manifest-backed aliasing: filenames must match exactly. No fingerprint stripping or inferred aliases; a manifest change is itself a payload change.
- `PDF_VOLATILE_METADATA`: XMP equivalents of /CreationDate, /ModDate and trailer /ID; observed in repeated Typst 0.15.1 builds. No broad date/ID/whitespace replacement.
- `normalizePdfBytes`: Typst 0.15.1 emits classic xref tables and an uncompressed XMP stream. Follow their references: never search/replace arbitrary content streams.

### `scripts/equivalence/nonvisual-gate.mjs`

- `playlists.config`: Redirect documents have no playback config.
- `main`: Independently verify every copied pinned byte before any build can write scratch.

### `scripts/equivalence/nonvisual-isolation.mjs`

- `assertSource`: Ignore third-party package internals; workspace sources must stay on this side.

### `scripts/equivalence/pixel-gate.mjs`

- `main.started`: Refuse reuse: stale PNGs must never satisfy a failed capture.

### `scripts/equivalence/provenance.mjs`

- `entryModules`: Only these trusted entry points may select a dependency closure. CLI callers bind their own literal entry; the pixel gate retains its original default.
- `validateCheckouts`: Node resolves these relative imports beside the admitted entry point. Refuse module symlinks escaping that directory, including a candidate nested in base.
- `freshBuildEnvironment`: Every process starts with empty, private persistent and compiler caches.

### `scripts/equivalence/verify-inputs.mjs`

- `verifyInput.pinned`: Ls-tree (not the index or a directory walk) defines the frozen inventory.
- `verifyInput.present`: Deliberately omit --exclude-standard: ignored additions are drift too.
- `verifyInput.current`: Never follow a replaced identity/assets directory outside this checkout.

### `scripts/fetch-timeout-base.mjs`

- `git`: Detached maintenance can rewrite .git/shallow during the next fetch.
- `module initialization`: A successful deepen can leave the pinned PR merge tip shallow indefinitely. Bound incremental fetches to 63 commits before requesting both full histories once.

### `scripts/install-internal-studio.mjs`

- `installInternalStudio`: A missing origin still gets explicit setup instructions, without leaking Git stderr.
- `installInternalStudio.version`: Older installed packs expose only the original version subcommand.
- `installInternalStudio.settled`: Synchronous children finish their own recovery before scratch is removed.
- `installInternalStudio`: The refusal still reports that version inspection failed.

### `scripts/learning-patterns-admission.mjs`

- `admittedPath`: Pnpm's package-directory link is expected. Every component *inside* its real package must be an ordinary file/directory, including esbuild's helper inputs.
- `inventoryLearningPatterns`: Parse source and bundle installed imports without evaluating upstream code.
- `inventoryLearningPatterns`: Other workspace/type/bundler imports belong to their own gates.
- `inventoryLearningPatterns.result.plugins.setup`: Upstream imports are explicit relative files. Refuse unknown package/builtin imports rather than externalizing unscanned code.
- `inventoryLearningPatterns.legal`: These are the same root notice families copied by standalone packaging.
- `verifyLearningPatterns`: Entries seen only by a real bundle remain valid; verify their bytes too.
- `reviewedDynamicImports`: Existing bounded workspace/module-loader imports. New spellings require review.
- `discoverImports`: JSON is data. Package dependency declarations are checked against the lock; bundler/tsconfig alias targets into the package are refused explicitly.

### `scripts/prax-format-skill.test.mjs`

- `formatRoot`: Rubato installs docs/prax-format/ as the skill folder: SKILL.md plus its topic guides.
- `doesNotMatch`: A relative link would leave the installed skill folder.
- `prose`: Fenced and inline code hold placeholder destinations, not documentation links.
- `deepEqual`: Building and candidate packaging use only Studio source, before Rubato pins can merge.
- `assertExportCommands.commands`: Scan every language and prose with the same detector, including prefixed executables.
- `assertExportCommands.equal`: Even an unparsed Markdown construct must not hide an export from the guard.

### `scripts/preflight-gates.mts`

- `collectGatePreflight.credentialsPath`: Worktrees have no .env; PRAXITY_ENV_FILE points at the clone that holds it.
- `collectGatePreflight.pnpmVersion`: Pnpm is a .cmd shim on Windows. Run its JS entry point with Node, without a shell.
- `collectGatePreflight.credentials`: Only lengths enter the summary. Never persist the env source, response body or exception.

### `scripts/run-vitest-isolated.sh`

- `module initialization`: The recorded session leader stays the process-group ID after Vitest exits.

### `scripts/slow-tests-confirmation-reporter.mjs`

- `ConfirmationJsonReporter`: Vitest's JSON reporter omits unhandled errors, which can coexist with test failures.

### `scripts/slow-tests-reporter.mjs`

- `validateAllowlist`: Expired base entries must still permit removal or a deliberate re-add.
- `SlowTestsReporter.onInit.error`: Vitest logs pool teardown timeouts after onTestRunEnd without setting exitCode.
- `SlowTestsReporter.onTestRunEnd`: Confirmation also verifies the isolated job's workers have exited.

### `scripts/sync-prax-format.mjs`

- `module initialization`: Mirrors docs/prax-format to the public github.com/Praxity/prax-format repository. Studio's docs/prax-format is the only place the spec is edited; the public repo receives it at release time through a PR opened by this script.  Usage: pnpm sync:prax-format --version 0.2.1 [--ref origin/main] [--target ../prax-format] [--dry-run] [--no-push]  Files are copied from committed blobs at --ref, so local edits in the Studio checkout never leak into the mirror. docs/prax-format/scripts/ stays private, and dotfiles in the public repo (for example .github/) are left alone.

### `scripts/vitest-processes.mjs`

- `clearVitestProcessGroups`: Only the dedicated setsid groups recorded by this job may be signalled.
- `clearVitestProcessGroups.leftovers`: Zombies have already exited and cannot consume CPU or receive signals.

### `scripts/vitest-sequencer.ts`

- `FileTimingReporter`: JSON lines in the ordinary CI log let timing refreshes survive artifact quotas.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with planted-defect tests in `scripts/*.test.mjs` and `scripts/preflight-gates.test.mts`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
