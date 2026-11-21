# 0061: Desktop release and check tooling

## Status

Accepted. Records existing behaviour; no executable code change.

## Context

Release tooling admits exact source and artifact bytes. Local checks select the owners of changed files.

## Decision

### scripts/admit-rubato-release.mjs

- `admitStudioRevision`: The newest CI run wins. An older success cannot mask a later failure.
- `admitStudioRevision`: REST run responses omit dispatch inputs. ci.yml emits this exact title only
  for gate=candidate.
- `readAdmission`: Filter remotely before selecting the newest run, so fork PR runs cannot displace
  CI.
- `internalCandidateSource`: The run title records source identity before a job starts, including
  dispatches whose head_sha belongs to the private workflow repository.
- `internalCandidateReleaseSource`: Draft tags belong to the tooling repository; their body
  identifies the built source.
- `selectNewestInternalStudioRevision`: Walk the main first-parent chain, not date-sorted commits
  from merged branches.
- `admitPrivateRef`: GitHub serves fork and pull-request commits through this repository too. A
  private candidate builds only a commit on main or the head of a branch pushed here.
- `admitPrivateRef`: Git owns branch syntax, including Unicode and punctuation such as c++.
- `admitRubatoPublisher`: The publisher builds from this SHA, so the guide and its sibling ship in
  one pack.

### scripts/browser-editor-ci.test.mjs

- `[name, job]`: GitHub rejects the whole workflow when jobs.<id>.env uses runner.*; set it per
  step.

### scripts/build-cli-archives.sh

- `build-cli-archives.sh` top-level commands: Run from the source checkout's root. The candidate workflow can supply
  this script from its own revision while building an older CLI-capable source ref.
- `build-cli-archives.sh` top-level commands: macOS tar otherwise adds ._* AppleDouble files and xattr headers
  (com.apple.provenance) that GNU tar warns about.
- `build-cli-archives.sh` top-level commands: Tests can write source fixtures and add files to dist/studio-cli. Seal
  both archives first, leaving the native payload and provenance for the proof.

### scripts/build-standalone-cli.ts

- `packageRoots`: Capture the actual viewer dependency closure; keep source evidence outside the
  artifact.
- `recordInput`: Preserve upstream ownership while identifying its browser contribution.
- `recordInput`: Use the final node_modules segment so pnpm store paths resolve to the real package.
- `copyRuntimePackage`: Keep DOMPurify's Node dependency tree intact: jsdom loads runtime files by
  path.
- `directory`: Keep full upstream notices as well as esbuild's retained license comments.

### scripts/check-bundle-paths.mjs

- `assertEsmBundlePaths`: TS binding avoids the implicit CommonJS module/exports symbols in JS
  files.

### scripts/check-candidate-freshness.mjs

- `checkCandidateFreshness`: Allow two hours from the first uncovered server push/merge, not from
  each new head. This covers 30 minutes capacity + 75 minutes build/setup without resetting during
  busy days.

### scripts/ci-browser.mjs

- `visible`: Prefix every segment in both operands so glob wildcards also match dotfiles. Keeping **
  intact in the glob preserves its directory traversal semantics.

### scripts/ci-minutes.test.mjs

- `actionsWithoutUploads`: Reviewed pins that do not create Actions artifacts. New refs need a fresh
  review.
- `browserInputViolations`: A docs directory can be a separate join argument. Qualify it by its
  parent so ordinary content fields named "context" remain valid.
- `browserInputViolations`: Parse code before removing comments: URL slashes and template literals
  are data, not comment delimiters. Fixture prose only has HTML comments.
- `browserInputFiles`: Extra shared owners contribute executable code and messages, not their
  unrelated unit tests or package documentation. Direct scope stays whole.
- `failed`: Failed runs keep screenshots and traces; passing runs keep only timing and results,
  because full evidence for every run filled the artifact quota.
- `upload`: Failure evidence stays a week; passing timing a day. Neither upload may turn a test
  verdict red when the artifact store is full.
- `name`: Chromium mutes by flag. Linux WebKit refuses to launch with --mute-audio, and Firefox
  mutes through media.default_volume (asserted below).
- `job`: A full gate on every merge was a fifth of the Ubicloud bill. Main gets the complete
  integrated gate nightly instead; PR path selection still applies.
- `runner`: GitHub sets these fields from the PR's head repository, not from anything the PR edits.
- `allWorkflows`: Self-hosted jobs allow main pushes only for candidate build-ahead. Nothing may
  launch the frozen Electron app's QA suite (it opened Studio windows on the owner's screen).

### scripts/cli-candidate.test.mjs

- `assertMacTmpdirs`: Reserve 20 digits for the numeric run ID; unknown contexts have no safe bound.
- `mkdir`: MSYS cannot chmod this Windows temp volume; assert the requested mode below.

### scripts/cli-publisher-test-support.mjs

- `registerPublisherGuardTests`: The token reaches curl on stdin, never in a process argument.
- `registerPublisherGuardTests`: A previous build could have planted a curl config in the user's
  home.
- `registerPublisherGuardTests`: Replace only platform/network adapters. Policy assertions above
  inspect the original script; Windows executes real Git curl and SHA-256 tools.

### scripts/compile-scheduler-gate.mjs

- `gateRule`: Owner decision 2026-10-07. T2a retains both its first-20 and all-30 checks.
- `gateRule`: Keep attempting after ineligible runs, but stop rather than wait indefinitely on a
  busy machine.
- `processCpuShare`: Affinity limits availableParallelism(), but PDH _Total still covers every
  processor.
- `monitorWindowsCpu`: Processor Utility can exceed 100% with turbo. Processor Time matches the
  bounded gate.
- `darwinDiskQueue`: IOBlockStorageDriver's "Total Time" counters accumulate nanoseconds spent on
  completed reads and writes. Their summed delta over elapsed time is the mean queue length
  (Little's law), the same measure as Linux's weighted milliseconds. macOS exposes no in-flight
  count.

### scripts/inventory-native-writer.mjs

- `error`: Windows denies replacement of an open destination. Move its name first, preserving the
  inventory's old open inode, then install the replacement.

### scripts/prebuild-viewer.ts

- `bundleInspectionFrame`: Studio-only bridge. Deployment manifests never include it in learner
  exports.
- `bundleInspectionFrame`: The CSS plugin namespace names real files; include those bytes as inputs
  too.

### scripts/prepare-typst.mjs

- `TYPST_RELEASES`: GitHub release asset digests,
  https://api.github.com/repos/typst/typst/releases/tags/v0.15.1
- `verifyArchive`: Keep the existing two-argument verification API scoped to Darwin.
- `woffToSfnt`: WOFF 1.0 is zlib-wrapped SFNT; Typst reads only the unwrapped TrueType/OpenType
  form.
- `prepareTypst`: Build-time only. Runtime exports never import this downloader.
- `prepareTypst`: ZIP extraction needs a seekable file. Use the verified bytes, not a reopened input
  archive.
- `prepareTypst`: Extract selected bytes only. No archive paths or links are created on disk.
- `prepareTypst`: GNU tar cannot detect compression on stdin, so name xz explicitly; bsdtar accepts
  -J too.
- `prepareTypst`: Rename the complete generation only after all checks pass; restore on failure.

### scripts/project-lock-runtime.test.mjs

- `directory`: No skip or fallback: a runtime upgrade that drops SQLite or EXCLUSIVE locking must
  fail the gate. Run this contract on every supported Node upgrade.

### scripts/standalone-cli-lifecycle.test.mjs

- `domRuntime`: macOS temp folders can contain /var aliases; match the CLI's canonical root.
- `domRuntime`: CI runs Node tests before desktop prebuild. Keep real preview/export assets in this
  fixture by running their owning builder, including on clean checkouts.
- `waitFor`: Process exit can precede the final output chunk; close waits for the streams.

### scripts/standalone-cli-packaging.mjs

- `canvasBundlePlugin`: Inline as the first nonce-bearing script: a module script would run after
  course parsing.
- `generateBundle`: Source servers use this build receipt. Packaged servers use the embedded digest.
- `assertStandaloneTarget`: Linux Typst preparation supports CI; standalone distribution remains
  macOS/Windows.
- `packagePraxFormat`: Rubato installs prax-format/ as the skill folder, so SKILL.md sits at its
  root and every relative link stays inside it. Omit the block-index generator tooling.
- `inventoryPayload`: Read sequentially: the runtime tree can exceed Windows' open-file limit.
- `inventoryPayload`: This digest covers ordered path/size/hash records. The inventory cannot hash
  itself.

### scripts/standalone-cli-paths.mjs

- `upstreamTypstSha256`: Typst 0.15.1's unmodified macOS release binaries embed upstream Cargo paths
  under the hosted macOS runner home. Pin exact bytes and artifact path.
  https://github.com/typst/typst/releases/tag/v0.15.1
- `upstreamTypstSha256`: aarch64-apple-darwin x86_64-apple-darwin

### scripts/standalone-cli.proof.mjs

- `artifact`: The source-build digest is never an authority for the packaged CLI.
- `child`: The packaged CLI must not depend on the source server's receipt.
- `tempBase`: fs-extra checks copy destination ancestors up to the drive root. A Windows fixture
  directly under that root keeps every checked directory inside the allowed tree, without granting
  access to Users (and therefore the checkout).
- `author`: Course fixtures are authored through the real writer before the confined CLI reads them.
  Export refuses transient identities and must never allocate them.
- `tempTree`: POSIX realpath walks ancestors. Windows can use the exact disposable root; granting
  its Users ancestor would also expose the checkout.
- `runNode`: Windows homedir uses USERPROFILE; keep SQLite's cache in the same confined temporary
  tree as the POSIX HOME setting.

### scripts/test-affected-output-map.mjs

- `publishedRuntimeRoots`: Prefix coverage includes new files and non-JS inputs, including pattern
  folders.
- `outputCoverage`: Broad renderers and shared styles own all published layouts. Keep their full
  coverage; add narrower entries only when the file's consumers are known.

### scripts/test-affected-reporter.mjs

- `AffectedReporter`: Vitest's JSON success flag omits unhandled errors. Recovery must retain them,
  along with suite/hook errors that are not attached to a failed test.
- `onTestRunEnd`: Vitest's built-in JSON reporter prefers stack over message. Timeout stacks can say
  STACK_TRACE_ERROR, hiding the actual timeout reason.

### scripts/test-affected.mjs

- `changedFiles`: --no-renames retains both the removed and added path for moves across owners.
- `buildPlan`: A new published file must never disappear through either selection layer.
- `buildPlan`: Existing narrow mappings continue to follow the workflow's output filter. Future
  files admitted by the exhaustive fallback must be admitted by CI too.
- `buildPlan`: Script tests also spawn scripts and inspect their text. Static imports cannot capture
  those consumers; the small sibling suite is the safe gate.
- `buildPlan`: Full export coverage supplements related tests across every workspace project,
  including desktop consumers of export-pipeline source.
- `runPlan`: Tests mkdtemp inside tmpdir() and PRAXITY_TEST_ARTIFACTS. Workers often point both at
  folders that don't exist yet, and wrappers call runPlan without main(), so create them here.
- `execute`: Invoke pnpm's JS entry point instead of a .cmd file or shell. Arguments remain literal
  on Windows, including filenames containing shell syntax.
- `executeVitest`: Rebuild the command, so related/source selectors cannot broaden this retry.
  Vitest matches filename prefixes, including foo.test.tsx for foo.test.ts.
- `main`: Deleted files still select their owners and related tests, but cannot be linted or passed
  directly to a test runner. Their surviving consumers stay selected.

### browser.vite.config.ts

- `defineConfig` disables environment-file discovery and environment prefixes.
  Browser builds must not load launch-time secrets from the desktop environment.
- `generateBundle` removes JavaScript chunks from the ordinary Vite output.
  The author document inlines the nonce-bearing IIFE emitted by `canvasBundlePlugin`;
  it does not ship a browser shell or module entry.

Sources: the named symbols and their comments at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, with the corresponding
interface tests in `apps/desktop/src/` and browser and tooling tests in
`apps/desktop/e2e/` and `apps/desktop/scripts/`. Paths above are relative
to `apps/desktop/`. These records preserve the existing rationale; they do
not establish new platform guarantees.

## Consequences

Changes to these owners must preserve the recorded admission, lifecycle and
platform constraints. Keep checks at their owning interfaces when refactoring.
