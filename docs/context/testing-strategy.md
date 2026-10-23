# Testing strategy

Praxity uses Vitest for package and desktop integration tests, Playwright for desktop and published-output behavior, and ADL-derived checks as the normative SCORM gate.

`pnpm test:affected` selects local checks from CI's workflow filters and the diff against `origin/main`, including staged, unstaged and untracked files.
Use `--base <ref>` to change the comparison, `--dry-run` to print the plan, or `--dry-run --files <path>` repeatedly to inspect sample diffs.
The browser-editor shards discover the remaining `*.spec.ts` files, including
the direct `canvas*.spec.ts` journeys and legacy shell/preview trust checks.
The stopped U7 staged host, outline and source-host browser specs are retired;
shared frame/inspection, transport and published-output tests remain.

Browser suites use Chromium; `--engines all` adds Firefox and WebKit. Unmapped published-output changes outside the guarded runtime roots run both complete suites.
The learner-authority roots (including `export-pipeline/src/patterns/`) and
ownership/routing scripts have exhaustive prefix coverage: unknown paths select
both complete published browser suites. A missing fallback map or CI output-filter
admission fails selection with the changed path; existing narrower browser mappings
continue to follow the CI filter. Those changes run the export-pipeline tests,
including bundle closure and byte budgets, in addition to cross-project related
tests and the mapped a11y/deck journeys. Every code change runs the real source-owner
command, including desktop export-input and format-renderers changes.
CSS changes always run both CSS budget files and theme contrast; affected packages and their dependents get typechecks. Candidate and nightly CI run the full gates.

The artifact retention policy in `apps/desktop/scripts/ci-minutes.test.mjs` guards accidental omissions; YAML aliases/anchors and local directories named like `upload-artifact@v4` can bypass detection. Retention above seven days cites a release or audit evidence document and an exact phrase, so adding lines above it does not break CI.

When you raise a test timeout, cite the failed run on the changed line:

```ts
test.setTimeout(90_000); // timeout: reports/editor-timeout.md
```

Use `// timeout: <evidence>` with a filename ending in `.log`, `.md`, `.json`, `.txt`
or `.html`, optionally under a directory, or an HTTP(S) run URL with a host and path.
Reviewers verify what the evidence says. Keep the comment
on the timeout value's line, or the changed constant's line when it supplies that value.
`pnpm test:affected` and CI lint run `scripts/check-test-timeouts.mjs` against the
merge base. The local check includes staged, unstaged and new files.
The guard checks Vitest registration options, numeric registration deadlines,
`vi.setConfig` and `testTimeout`; it also checks Playwright `test.setTimeout`,
conditional `.slow()`, page/context default action and navigation setters,
`test.use` action/navigation defaults, and expectation and action options.
Local shared options objects are followed to their initializer. Literal-false
`.slow()` is a no-op; a changed unresolved condition needs evidence.
Node tests using ESM imports or CommonJS `require("node:test")` are excluded.
New explicit timeouts above the
existing config default need evidence too. Lowering and unchanged timeouts pass.
Zero disables a deadline, so changing a finite timeout to zero needs evidence.
New Playwright action deadlines are compared with its unlimited default unless
the config supplies a limit. The script resolves numeric expressions and local
constants; changed expressions it cannot resolve need evidence. For conditional
config defaults, it uses the smallest numeric branch so the check covers both modes.
This is a review nudge. It does not execute code or follow imports, reassignment,
object spreads or cross-file values. Reviewers check those cases. CI starts shallow,
fetches the event's pinned base SHA, and deepens only head/base ancestry until their
merge base exists. Fetch errors fail the check.

Historical timeout evidence keeps the original run or review identifier without private repository URLs. GitHub Actions run `38146537167` is the recorded evidence for `grammar4-switch.test.ts` (14,532 ms), `line-ending-files.test.ts` (14,242 ms), `preview-session.test.ts` (13,182 ms) and `project-lock-ownership.test.ts` (12,853 ms). Internal PR #1702 is the recorded evidence for the 60,000 ms setup deadline in `retrieval-sheet-pdf.test.ts`. These references preserve provenance; the deadlines and assertions are unchanged.

Outside CI, a Vitest file whose only failures are test timeouts runs once more,
alone with one worker. The runner reports `load timeout, passed alone` or
`failed alone`. Assertion, hook, suite and unhandled errors retain a failing exit
code. `CI=true` disables this recovery.

Linux GitHub Actions records tests over 2 seconds that are not on the allowlist
in `.slow-tests-pending.json`. The reporter also rejects duplicate full test
names within each file, regardless of duration, in both gate and report-only
mode. Include every parameter that distinguishes a case in its title.
The guard also counts skipped tests, todos and `runIf`/`skipIf` twins.
After Vitest exits, a separate workflow step
runs `node scripts/confirm-slow-tests.mjs "$SLOW_TESTS_PENDING_FILE"`, even
when Vitest failed, if the pending file exists. Confirmation runs alone with one
worker and its existing project config, root, setup and timeouts. Multiple
affected Vitest invocations append their violations to the same pending file.
Each Linux Vitest step runs under a dedicated `setsid` process group. Before
confirmation starts, it lists surviving members of those groups, warns with
PIDs and command lines, sends SIGTERM, waits up to one second, then sends SIGKILL
and waits up to one second. The existing confirmation/job deadline also bounds
these waits. Surviving processes or a failed cleanup check fail as infrastructure
errors before any timing can pass. Exited zombies cannot consume CPU and are
ignored. This cleanup runs only in Linux GitHub Actions.
Cleanup covers the Vitest step's process group; a process that detaches itself with its own setsid or a double fork escapes it, which can only cause a false red, never a false pass.
Outside CI the workspace does not install the slow-test reporter, as before.
An explicitly installed local reporter, including `CI=true` outside GitHub
Actions, and macOS report-only mode keep their in-reporter confirmation.
The macOS nightly runs packages with three workers, then one desktop job
that inherits the single-worker Darwin rule. The first split nightly measured
17.3 and 19.7 minutes of desktop Vitest, both below the agreed 25-minute
threshold for folding the shards back together. Desktop allows 66 minutes,
rounded up from 1.5 times 37 minutes plus 10 minutes of setup; it has no capacity
wait. Separate jobs release the shared runner between invocations and report
each invocation's wall time. Node checks run in the packages job; both workflows
read `scripts/serial-node-tests.txt` to isolate lifecycle checks from the
remaining Node files.
Only the slow tests run in a fresh Vitest process, using an anchored, escaped
`--testNamePattern`. Slow tests in the same project file share one rerun with
the original mocks, project setup and applicable `beforeAll`/`beforeEach` hooks.
Sibling test bodies do not warm fixtures. Pending records retain each suite and
test name separately, preserving literal ` > ` text and parameterised titles.
The confirmation reporter verifies that exactly the requested tests ran and
passed. Missing matches, duplicate full names, space-joined name collisions,
skipped targets and unrequested executions fail as infrastructure errors.
The JSON report supplies each target's own duration and retry/repeat counts.
Confirmation requires exactly one attempt, including when test options override
the CLI's zero-retry default. A passing target still
over 2 seconds fails the budget. Assertion, hook and test-timeout failures still
fail confirmation.
Confirmation retries once only when the spawn adapter records a failure before
the child's `spawn` event. A started child is final, including on timeout:
Vitest writes JSON after file hooks finish, so a missing report does not prove
that nothing was measured. Each attempt retains the 120-second process cap;
all files and retries together retain the 180-second cap. A retry
uses a fresh report path. A completed report is final: its measured budget
failure or pass is retained even if teardown then times out, which still reports
the timeout. On POSIX platforms the child owns a process group, killed together
on timeout. A process timeout leaves later files unconfirmed. Gate mode fails
every unconfirmed test and names its cause; the report-only timeout warning
policy below remains.
The owner decision of 2026-10-12 sets `SLOW_TESTS_REPORT_ONLY=true` only in
`macos-nightly.yml`: every test over 2 seconds is reported, including allowlisted
tests, and confirmed timing overruns are advisory. Original failures and
confirmation correctness or infrastructure failures still fail, except that a
confirmation process timeout or exhausted confirmation deadline warns and names
every unconfirmed file in one warning annotation. In-reporter confirmation
awaits an asynchronous child process so worker teardown timers stay responsive.
The entire in-process confirmation, including retries, has a 120-second wall
cap and also respects the CI job deadline. Post-exit CLI confirmation retains its
180-second shared cap. Any process timeout marks the reporter's run.
A later forks-worker termination timeout in the same run also warns. A lone
worker termination timeout still fails. The reporter handles this diagnostic
where Vitest logs it, without clearing any exit code. Other logger errors retain
their existing behavior. The process-group wrapper keeps its exit-code handling
unchanged. Linux PR CI and the Linux nightly retain the budget. The SIGKILL
recovery test likewise keeps its complete-save 2,000 ms bound on Linux and
Windows; macOS still checks
recovery and exact recovered bytes.
Infrastructure errors fail the job with a separate diagnostic. A confirmation
with both test failures and unhandled errors reports both diagnostics. Original
test failures keep failing. Test jobs allow 15 minutes, including setup and confirmation;
individual test and hook timeouts stay unchanged.
The full Linux Test shards put `TMPDIR` on a per-job executable tmpfs under
`/dev/shm`, capped at 1 GiB. Setup logs filesystem usage and available memory.
Only the Test shards and their confirmations use this directory; dependency and
asset preparation precede it. Teardown restores temp paths for action cleanup
unless cancelled. Ephemeral runner VMs discard the mount; a leaked process
cannot fail a passing shard through a busy unmount.
`apps/desktop/src/test-utils/fixture-temp.ts` owns fixture placement for the
complete recovery-save latency gate and journal-flush parity on runner disk.
Disk placement preserves the gate's storage costs, not proof of power-loss
durability. Other journal recovery tests still check process death and recovered
bytes; neither process death nor tmpfs establishes power-loss persistence.
The Linux confirmation CLI emits one host sample with start/end `/proc/loadavg`
and aggregate CPU steal and iowait ticks and percentages across the confirmation
interval, plus the `/proc/pressure/io` `some` line at both endpoints if available.
The pressure line includes the trailing ten-second stall percentage, `avg10`.
The probe adds no wait and never changes a verdict; unavailable counters are
reported in the sample. Linux can decrease the iowait counter, so signed deltas
are retained. Load averages include prior activity. These diagnostic samples
cover confirmation rather than the original parallel shard.
Confirmation stops after three minutes or at the job deadline, whichever comes
first. The first job step exports that deadline with 45 seconds reserved for
teardown. In gate mode, every unconfirmed file fails with an infrastructure diagnostic.
Tests whose exact repo-relative file and full name appear in
`scripts/slow-tests.json` are exempt. The initial list
comes from measured Linux timings. Every entry needs a reason describing the
remaining work. Plain entries may only shrink relative to the PR base or previous
main commit, including after an entry is removed.

Only the merge queue root may add an exception, and only when an unrelated
over-budget test blocks a merge candidate. Alongside `file`, `name` and `reason`,
an addition requires `added` as an ISO date `YYYY-MM-DD`, `run` as a GitHub Actions
run URL or numeric run ID, and a non-empty `backlog` pointer. The dated backlog
entry names the test, its measured time and the candidate run. Converting a plain
entry to a dated entry requires the same fields.

`validateAllowlist` enforces expiry in the reporter and the CI policy test on PRs
and merge candidates. Dated entries expire after 14 UTC calendar days, whatever
their backlog state. Fix the test and remove its entry, or deliberately re-add it
with a new `added` date and a different run. The date cannot be in the future;
changing a run URL to the same numeric ID does not count as a different run.
Dated metadata cannot be stripped to avoid expiry. Removing an entry always passes,
including when its base entry has expired.

The admission check runs in PR CI. A candidate dispatch compares the head with
itself, so it can't catch an added entry. Require green PR CI on the same head
before dispatching a candidate. The "different run" rule compares only
with the base entry, so a remove-then-re-add across two PRs can reuse a run. The
dated tracking entry is the record maintainers must review. Expiry runs
when the reporter starts. From day 15, every Vitest run that loads the reporter
fails before any test runs, until the entry is fixed or re-added. That includes
local runs, unrelated PRs and the macOS nightly, so the nightly records no timings
until then.

Every PR push runs the fast gate, whether the PR is draft or ready. `changes`
scans committed machine paths; `fast-checks` runs ownership, timeout evidence,
actionlint, Biome and typechecking; `node-checks` runs the root Node checks once.
The `changes` job installs selector dependencies, then invokes
`pnpm test:affected --vitest-only --select-only --base <PR base SHA>` before
Poppler or any prebuild. Its output chooses `full`, `affected` or `empty`.
Full selections use the existing four balanced `test` shards, including on PRs.
Only non-empty affected plans allocate `affected-test`, which invokes the same
selector with `--affected-only` and refuses an unexpected full fallback.
Empty plans allocate neither test job, so they install no Poppler or test assets.
Affected files run once, with two workers, rather than paying for shard setup.

The Vitest-only selector keeps the existing related/direct Vitest selection for
modules the graph can follow. Non-module inputs, runtime fixtures, configuration
and selector changes, and selection or diff errors require full Vitest. This
conservative rule includes documentation and data files. It reads setupFiles,
globalSetup and configuration imports through the installed Vite config loader;
setup modules and their local import dependencies also require full Vitest.
Missing setup/configuration inputs fail safe. Both changed and deleted inputs
follow the same rule. No setup path is maintained as a separate skip-list.
`fast-checks` preserves each step's original outcome. A failed check does not
suppress the others. Test jobs depend only on `changes`, so lint failure does
not hide their results. PR `merge-gate` passes when the fast gate passes.
No PR event runs browser suites, including `ready_for_review`.

The merge candidate's CI is the full gate. Before dispatching it, update the
branch with main and verify PR CI on that head:

```bash
gh workflow run ci.yml --ref <branch> -f gate=candidate -f head_sha=<40-hex head SHA>
```

The first job refuses a candidate unless the dispatched SHA equals `github.sha`.
The run name is exactly `CI candidate <head SHA>`. It runs fast checks, Node
checks, four balanced full Vitest shards and the Chromium browser suites.
Candidates alone use the browser skip-list in `.github/workflows/ci.yml`.
The changes job checks out full ancestry, fetches `origin/main`, and compares
`HEAD` with `git merge-base origin/main HEAD`. No PR-files API result participates
in that browser decision. Unknown paths, fixtures and CI itself run all suites.
An empty or failed diff, unavailable merge base, failed fetch or invalid skip-list
also runs every suite. Node policy tests guard source and fixture references
into skipped paths; safe exceptions name a file, literal and maximum count.

Before merging, require the newest matching `workflow_dispatch` run of
`ci.yml`, with both the exact candidate display title and head SHA. Accept
only success, including `merge-gate` and every selected browser job and shard.
A browser skip is acceptable only when the browser decision is `false`.
Failures, cancellations, selected skips and stale revisions refuse acceptance.
A plain dispatch cannot substitute for the candidate run. After a head or base
change, update the candidate and run the gate again before merging. Drafts are
not eligible to merge. PR fast-gate success alone does not authorize merge.

Workflow concurrency cancels an older run of the same event, branch, gate and
requested head SHA when its replacement starts. Ordinary dispatches and
candidates have separate groups, so an all-engine dispatch cannot cancel a
candidate. Every job shares that group. Diagnostic steps use
`!cancelled()` so superseded revisions stop while failed tests retain evidence.

CI runs every gate in every engine nightly on main at 06:00 UTC. Merges do not
start another run. An ordinary `gh workflow run ci.yml --ref <branch>` dispatch
uses `gate=all` by default and retains the same complete nightly behaviour.
Other events retain GitHub's default run names. Where protection is available,
require `merge-gate` and `fast-checks` from GitHub Actions. The merge verdict
requires actual success for each selected check and rejects every failure or
cancellation, including an unselected check. Maintainers must verify candidate
acceptance when repository protection APIs are unavailable.

`cli-proof.yml` builds the standalone CLI and runs `pnpm test:cli` nightly on
main, and on demand, on the self-hosted Intel MacBook Pro. The CLI builds only on macOS
and Windows, hosted Windows runners are unavailable to this account, and PR code
must not run on the MacBook Pro. A change that breaks the proof shows up within a
day instead of at the next `cli-candidate.yml` build.

## Vitest workspace

`pnpm test` runs the projects declared in `vitest.workspace.ts`:

| Project | Main coverage |
|---|---|
| `grammar` | Grammar 4 tokenization, tree, reader projection, schema and validation |
| `content-identity` | Durable identity resolution, snapshots and sidecars |
| `operations` | Exact source edits, identity mappings and undo, including the 1,000-seed byte gate |
| `shared-blocks` | Block renderers, navigation, grammar adaptation, and logic |
| `export-pipeline` | HTML generation, package structure, SCORM runtime contracts, and published output |
| `editor-core` | Editor state, components, adapters, themes, and accessibility checker |
| `format-renderers` | Native course PDF and shared Typst helpers |
| `desktop` | Main process, preload bridge, renderer hooks, security, and export integration |

The export-pipeline Vitest setup builds its source-mode viewer assets and caches the comprehensive published-output fixture when needed. Studio RPC integration tests use the separate shipped desktop assets. Run `pnpm --filter @praxity/desktop prebuild` and `pnpm --filter @praxity/desktop prepare:typst` before those tests on a fresh checkout. CI prepares both in every test shard. No web or SCORM-importer project remains.

Finish desktop prebuild before running tests that read `apps/desktop/resources/export-assets`. Export-pipeline setup builds `packages/export-pipeline/prebuilt` separately. Independent read-only suites may run in parallel.

The durable file journal's affected gate includes `studio-server`, alongside
transaction, OS lock, identity, course IO, preview, export and inspection suites.
Filesystem fault injection targets authored destinations or journal operations;
stage names and plan entry positions are private implementation details.
`cli-permission.test.ts` bundles the actual CLI and lesson writer, then exports,
saves and inspects under the portable proof's Node permission flags. It runs in
the existing Linux Vitest shards without building the browser editor or CLI archive.

Candidate, nightly and ordinary manual CI run this workspace in four Vitest shards. `scripts/vitest-sequencer.ts`
assigns measured files, longest first, to the shard with the least estimated
elapsed time from `scripts/vitest-timings.json` and its committed worker estimate.
The refresh command preserves that estimate; runtime CPU counts never change the split.
It adds each file to that shard's least-loaded worker. This can leave a dominant
file alone when adding work to other shards will still finish sooner.
New files use Vitest's default split.
A separate `node-checks` job runs the root Node checks once, and the merge
verdict requires its success. Each shard invokes Vitest directly. Run
`pnpm test --shard=1/4` locally when reproducing one shard; use `pnpm test` for the
full local gate, including Node checks.

CI prints `Vitest file timing:` JSON lines through `FileTimingReporter`. Refresh
the committed map from every Test job's UTF-8 log from the same completed run:

```sh
node scripts/refresh-vitest-timings.mjs --source <completed-run-url> shard-1.log shard-2.log shard-3.log shard-4.log
```

The command also accepts Vitest JSON reports. It refuses missing measurements,
invalid paths and invalid durations, and keeps the largest measurement when a
file occurs more than once. The initial map was bootstrapped from the ordinary
file summaries of run 39077509604, before JSON timing lines were available.
Refreshes change scheduling only; unmeasured tests still run. Keep all shard
logs together so a refresh cannot silently discard the other shards' timings.

Published accessibility setup warms the compiler with its initial serial builds,
then builds independent fixture variants with at most the runner's available CPU
count in flight. All queued writers settle before cleanup, including failures.
Every course and fixture assertion remains part of each shard's setup. Setup
and batch elapsed times are printed separately in CI.

## Scheduler latency gate

The owner decision of 2026-10-07 changes T2b to three eligible fresh-copy runs.
Each run makes 30 leadership page-17 commits. The gate uses each run's first-20
nearest-rank p95, then passes when the median of those three p95s is at most
600 ms. It publishes every run's first-20 p95 and maximum across all 30 commits,
including ineligible runs, plus the median p95. No slow commit is discarded or
adjusted. `apps/desktop/scripts/compile-scheduler-gate.mjs` owns the budgets and
eligibility rules. T2a retains its 100 ms p95 checks on both the first 20 and all
30 samples in each eligible run. These main-process timings do not establish
gesture-to-frame-paint latency; P3b supplies that evidence.

A run counts only if whole-machine CPU mean stays below 30% and maximum below
50%. Windows samples PDH's `Processor(_Total)\\% Processor Time` through
`typeperf` every second. The hybrid Intel probe returned 159-172% for
`Processor Information(_Total)\\% Processor Utility`, outside this gate's
0-100% validity range, so the gate uses Processor Time. Linux and macOS retain
Node's `os.cpus()` time deltas. Sampling covers the fresh course copy through
session shutdown, including T6 and the final partial interval. Windows waits
for the next counter sample to cover that last interval and clips its duration.
The mean is weighted by interval duration. Missing/invalid CPU counters,
counter resets, or gaps above 2.5 seconds make the run ineligible.
The run also refuses with `CPU probe implausible` if the whole-machine mean is
below the benchmark's own CPU share. That share divides `process.cpuUsage()` by
wall time and the whole-machine logical processor count. Process affinity can
reduce `availableParallelism()`, so it cannot supply PDH `_Total`'s denominator.

Before each run, five one-second disk intervals must each have queue length at
most 0.1. Windows reads `PhysicalDisk(_Total)\\Avg. Disk Queue Length` through
[typeperf](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/typeperf).
Linux reads `/proc/diskstats` for all `/sys/block` devices except loop and RAM
devices, sums weighted I/O milliseconds divided by elapsed milliseconds, and
also requires zero in-flight I/O at interval endpoints. The fields come from
the [kernel I/O statistics contract](https://docs.kernel.org/admin-guide/iostats.html).
Device-mapper devices can overlap underlying disks; summing them is conservative.
macOS sums the `Total Time (Read)` and `Total Time (Write)` nanosecond counters of
every `IOBlockStorageDriver` from `ioreg` and divides by elapsed time, which gives
the same mean queue length. macOS exposes no in-flight count, so that endpoint
check has no macOS equivalent. The macOS filesystem comes from the `df -P` device's
`mount` entry.
Unavailable probes, unsupported platforms, and an unknown scratch filesystem
refuse eligibility. A busy preflight is retried for up to 12 windows (about one
minute) before the attempt is recorded as ineligible. The gate keeps attempting
until three runs are eligible, up to six attempts, and reports every attempt's
load. It never waits indefinitely on a busy machine. Windows records `Get-Volume -FilePath`'s filesystem; Linux
uses `findmnt --target`. Missing tools or localized Windows counter names that
cannot be resolved refuse the run rather than silently qualifying it.

The 0.1 queue cutoff is a conservative preflight policy, not a calibrated
latency guarantee. The T2b spike investigation found a baseline tail at queue
3.7 and 116.7 ms write latency despite only 20.3% CPU. Under disk load, filesystem
wait correlated with queue length at r=0.68. Baseline filesystem wait correlated
with write latency at r=0.92. Individual NTFS marker flushes reached 2,480.9 ms,
and a marker rename reached 500.2 ms, with no GC overlap. The owner estimated
about one in 20 batches of 20 commits can fail from disk tails alone. These
observations motivate declaring the machine conditions and using repeated
batches. Correlations describe the measured workloads; they do not isolate
storage drivers or filters. Preflight cannot rule out disk activity later.

This gate measures typical saves in the declared environment. It promises no
worst-save bound, and passing NTFS does not qualify ReFS. T1's journal, flushes,
markers, recovery and complete durable acknowledgement are unchanged. Authors
can see a draft before durability; Saving lasts until the durable response.

Run from the repo root under the same machine/affinity conditions on each
volume. Set `PRAXITY_GATE_SOURCE` to the read-only leadership course and
`PRAXITY_GATE_NTFS` / `PRAXITY_GATE_REFS` to fresh scratch directories on the NTFS
system volume and the ReFS course volume, respectively. Their parent directories
must exist. Real courses live on the ReFS volume. In PowerShell:

```powershell
node --import tsx apps/desktop/scripts/benchmark-compile-scheduler.mts "$env:PRAXITY_GATE_SOURCE" "$env:PRAXITY_GATE_NTFS"
node --import tsx apps/desktop/scripts/benchmark-compile-scheduler.mts "$env:PRAXITY_GATE_SOURCE" "$env:PRAXITY_GATE_REFS"
```

The script copies the source to `run-N/course` inside scratch and records the
detected filesystem in `summary.json`. Keep each volume's result separately;
never pool their p95s. It stops on an ineligible run and prints INELIGIBLE and
NO VERDICT with exit 2. Fewer than three eligible runs never produce a pass or
fail. Start a fresh batch when the machine is quiet. Exit 0 is a pass; exit 1
is a latency failure or a measurement error on an otherwise eligible run.
Probe details, CPU samples, refusal reasons and any measurement error remain
in the summary. Append `1 1` for a one-commit, one-run smoke check; it always
exits 2 with no gate verdict.

## Native inventory timestamps

From the repo root, run
`node --import tsx apps/desktop/scripts/inventory-native-differential.mts <scratch-dir> <skew-ms> 500`
with skew values `0` and `60000` on each tested volume. Each run performs 2,000
mutations across same-size writes, truncate-extension, replacement and symlink
retargeting. A writer thread completes each mutation before retained bytes and
digests are compared with literal expected bytes, disk and a cold inventory.
Only the reader's `Date.now` changes; file operations and timestamps remain native.
JSON output includes actual stamps, repeated-stamp counts and stale-read counts.
Stale bytes or digests cause a nonzero exit. Scratch projects remain for inspection.
This is an explicit machine check, outside the automatic affected gate.

## Native PDF

Tests that compile real PDFs in `packages/format-renderers` use the Typst, fonts and MiTeX that ship in the app. `pnpm --filter @praxity/desktop prepare:typst` installs them; `dev` and `build` also run it. Once they're installed, `pnpm test` and the format-renderers suite use them automatically, with a 60 s per-test timeout. Without them, the native checks are skipped. Set `PRAXITY_TEST_TYPST` only to use a different binary. A system Typst of another version gives false failures, because MiTeX is resolved next to the binary.

Run these locally before a PDF release. The existing Linux Vitest shards prepare the pinned x64 musl compiler, fonts, MiTeX and distro Poppler utilities, and run the format-renderers native checks too. The shared test helper parses Poppler 24.02 and 26.09 structure output; exact image alt text is checked in the PDF bytes because 24.02 omits it from the structure listing. Typography baseline checks use the bundled compiler and its SVG glyph groups.

The write-distractors acceptance file builds its viewer and CLI once, then exports six CLI ZIPs, two xAPI packages and two native PDFs in `beforeAll`. Its shared build hook has a 120-second limit for cold builds and attaches its measured duration as `shared-build`. Individual cases retain the normal case limit and the two-second slow-test budget. PDF checks combine extracted text with decoded metadata, outline strings and Flate streams; the byte scan alone cannot decode font glyph IDs.

`tests/deck/highlight-acceptance.spec.ts` builds one production CLI and viewer, then captures ten artifacts across paged/deck layouts and preview, HTML, SCORM 1.2/2004 and xAPI. Its shared setup and optional evidence-capture hooks each allow 120 seconds. Individual cases have a two-second acceptance budget, measured from Playwright JSON; CI's published `timing-summary.md` reports durations but does not enforce that budget. The filesystem-only notice checks run in Chromium once. A fast Vitest test validates the documented course manifest and whole-course references, and parses/renders both EN/FR lessons. HTTP exercises ESM and local files exercise the classic adapters. File tests deny every HTTP(S) request; Chromium and Firefox also enable offline emulation. WebKit offline emulation rejects plain local files. Its file tests establish operation with HTTP(S) requests denied, without claiming offline-emulation acceptance. Real screen-reader speech remains a separate, digest-bound acceptance step.

The `published-output-deck` CI job prepares the pinned app Typst with `pnpm --filter @praxity/desktop prepare:typst` and installs Poppler before running that file in every engine. Its scratch CLI uses the prepared compiler in `apps/desktop/resources/typst/` (or the explicit `PRAXITY_TEST_TYPST` override), matching the native format-renderers setup. Local runs need the same preparation and `pdftotext` on PATH. Both CLI PDF byte scans are mandatory; missing tools fail the fixture.

## SCORM gates

Run `pnpm preflight:gates` before a gate round. It writes
`test-results/gates/preflight.json` and exits nonzero with every missing prerequisite.
Set `PRAXITY_PREFLIGHT_JSON` to write the summary elsewhere. It records Node, pnpm,
lockfile versions, headless launch/version evidence for Chromium, Firefox and WebKit,
Typst, xmllint, Java, the ADL Manifest Tester JAR, Rustici drivers, NVDA installation, and authenticated SCORM Cloud API
reachability. NVDA installation does not establish that Guidepup can drive it.
VoiceOver readiness is outside this preflight.

Credentials are read in memory from `.env` at the repository root, or from the file `PRAXITY_ENV_FILE` names (worktrees have no `.env`).
Only their lengths enter the report. No credential is copied into a worktree or
child-process command line. The API probe lists at most one course, discards its
response body, and reports only HTTP status.

Set `PRAXITY_GATE=1` for gate runs. Missing Cloud credentials, xmllint, ADL tools, or Rustici
driver files throw instead of returning early or authorizing a skip. Without that
variable, the existing developer/CI behavior remains. A failed prerequisite is a
blocked gate, never conformance evidence.

`PRAXITY_XMLLINT` overrides the executable path for both preflight and ADL tests.
Without it, `xmllint` on PATH is used. On Windows, the MSYS2
libxml2 2.15.4-1 build works. Provisioning
does not change the system PATH. Its archive SHA-256 is
`ea6b8e7ee24d8674e719f1f0a1b3747a72158ab786dfc5392ccb9f8edd09582a`, published on
[MSYS2's package page](https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-libxml2).
The companion libiconv and zlib DLLs must sit beside the executable.

Preflight uses the bundled Typst in `apps/desktop/resources/typst/` by default;
`PRAXITY_TEST_TYPST` overrides it. `PRAXITY_NVDA` overrides the NVDA executable;
otherwise preflight checks the two Windows Program Files locations.

Rustici's `scormdriver/` contents belong in
`packages/export-pipeline/tests/scorm-local/drivers/scorm12/` and `scorm2004/`.
These directories are gitignored. Preflight and gate mode require `indexAPI.html`,
`scormdriver.js`, and `blank.html` as files. The current CI workflows do not provision
these proprietary drivers. Supply an approved Rustici distribution before claiming
the local compatibility gate passed. `pnpm test:gates` tests these setup contracts
without credentials or a driver distribution.

Run `pnpm test:scorm-adl` for changes to package structure, manifests, SCORM runtime behavior, completion, score, suspend data, or LMS navigation. These ADL-derived checks are the normative automated gate for SCORM 1.2 and SCORM 2004.

Run `pnpm test:adl-manifest` for SCORM manifest changes. It exports a small course
with LOM metadata as both SCORM 2004 editions and invokes ADL's official 4th-edition
Manifest Tester headlessly. Set `PRAXITY_JAVA` to a Java executable and
`PRAXITY_ADL_VALIDATOR` to the extracted suite's `lib/adlvalidator.jar`. Keep the
complete distribution around the JAR so its companion libraries and schemas are
available. Java 8 runs this static validator. No tools are downloaded by the gate.
Without both variables, tests skip with a message; `PRAXITY_GATE=1` throws instead.
Configured but broken tools fail in either mode. Preflight checks Java's version
and the JAR's presence; the gate checks execution and validation.

ADL exits zero even for invalid packages. The gate requires exactly one tested,
one passed, zero failed, the success checkpoint marker, and no failed checkpoints
or process errors. A passing 3rd-edition export is compatibility evidence against
the 4th-edition validator, not official 3rd-edition conformance. This gate covers
static manifests, not the legacy applet-based SCO/runtime suites. ADL materials and
exported packages stay outside the repository. The Windows workflow is unchanged.

The larger official ADL assets and manual evidence workflows are documented in:

- `docs/context/adl-scorm-official-resource-index.md`
- `docs/context/adl-scorm-ui-suite-runbook.md`
- `docs/context/scorm-adl-conformance-exceptions.md`

Rustici-backed suites test compatibility, not conformance claims:

| Suite | Command | Purpose |
|---|---|---|
| Local Rustici driver | `pnpm --filter @praxity/export-pipeline test:scorm-local` | Offline learner-flow and LMS behavior |
| SCORM Cloud | `pnpm test:scorm-cloud` | Hosted import, launch, tracking, and resume compatibility |

## Browser authoring journeys

`pnpm --filter @praxity/desktop e2e:browser-editor --workers=2` runs headless authoring journeys in Chromium, Firefox and WebKit. They cover canvas Read/Edit, saves and recovery, plus retained inspection security. CLI tests cover narration, identity and export. The legacy shell, prerequisite UI and Electron-only cases are removed. Mixed filesystem, identity and inspection suites retain their browser/service assertions.

CI's `browser-editor` job runs Chromium and WebKit on Ubuntu four-CPU runners,
with three shards per engine and two workers per shard; PRs run Chromium only. The Electron binary-install step and Xvfb wrapper are removed.
PRs run it for desktop source, E2E fixtures, scripts, resources, browser Vite
configuration, package or TypeScript configuration; any package or course test
fixture; workspace dependencies, patches, root TypeScript configuration; or
`ci.yml`. Docs and legal changes alone skip it. Each shard prepares export assets
and Typst before testing. The candidate's three-engine run took 27.9 minutes with one worker;
the six CI jobs target under 10 minutes of tests each, plus setup. Failure traces
remain for three days. The candidate's release check remains unchanged.

## Accessibility suites

`pnpm --filter @praxity/export-pipeline test:a11y` builds published fixtures and runs browser tests in `packages/export-pipeline/tests/a11y/` across Chromium, WebKit, and Firefox (Gecko). Coverage includes:

- axe scans against WCAG 2.2 AA expectations;
- keyboard navigation and focus order;
- landmarks and headings;
- navigation variants;
- authored Continue gates, recovery, and legacy localized reasons;
- interactive block states;
- theme contrast, typography, and overflow.

Page-navigation tests wait for the exact next URL and the destination's DOM content.
Navigation-variant journeys derive that destination from the compiled fixture's
ordered pages, independently of the control's href.
An already loaded source document can satisfy `waitForLoadState()` before WebKit
starts navigation. A delayed-response keyboard regression covers this case.
Scroll-progress tests compare the rendered transform and reported value with the
current scroll geometry in one poll, so later layout and scroll updates cannot
leave the test comparing against an earlier value.

The Next link keeps keyboard Enter activation and destination checks in WebKit.
Its native link Tab traversal requires the Safari/macOS keyboard settings described
in the a11y skill. Headless WebKit's link-skipping focus model cannot establish that
manual outcome; composite and native form-control keyboard checks still run.

Published-output CI uses four-CPU runners, two workers per engine, and file-level
scheduling by default. Submitted assessment review themes opt into parallel test
scheduling, each with its own browser context. They submit all six assessment
islands once, then batch every island's review checks per width, text size and
forced-colour state. JSON attachments retain the rendered colour pairs and control
states for every configuration; failed theme tests retain a full-page screenshot.
Chromium has three shards; Firefox and WebKit each have two. Candidates run only
Chromium; PRs run no browsers. Whole
learner journeys stay inside individual tests. Each job uploads Playwright JSON,
start/end timestamps, first-retry traces and a slowest-tests summary even on
failure. The summary separates first-attempt work from time across all attempts.
Flaky tests retain the existing retry policy and appear in the report.

Fixture setup compiles once per invocation and serves private immutable outputs.
`PRAXITY_A11Y_ENV_PATH` gives workers the invocation's manifest inside its temporary
directory. Course pages and SSR selector inventory address the owning fixture
directly; browser checks still establish visibility and island hydration. A live
selector miss is never cached as absence. Setup restores fetch and removes partial
outputs on failure. Authored fixture downloads use known local bytes; the harness
CSP blocks third-party frame and SDK requests while preserving the iframe source,
title and sandbox assertions. Third-party player operation needs separate evidence.

For local iteration, workers may select affected files before running the required
complete gate:

```bash
pnpm --filter @praxity/export-pipeline exec playwright test --config=tests/a11y/playwright.config.ts --only-changed=origin/main
```

Fetch `origin/main` before selection. An empty selection establishes no coverage.
Use named specs when shared fixture or harness changes affect more than the changed
test files. On Windows use `pnpm.cmd`, and run desktop prebuild before export specs.
Run browsers headless with `--mute-audio`; Firefox also needs element-default mute.
Keep benchmark logs outside the worktree and compare identical cases and engines.
Override workers with `--workers=3` or `--workers=4` for a measured pilot. Windows
timings cannot establish Linux scaling. Persistent fixture caching remains deferred
until source, lockfile, assets and compiler-generation ownership have a tested cache
contract; stale exports are unacceptable.

The a11y Firefox project sets `media.default_volume` to `0.0`. Gecko then decodes
muted media and advances playback using its system clock without opening an audio
device. Scaling output with `media.volume_scale` alone still opens that device and
can fail with `OnMediaSinkAudioError` on a headless CI host. The media-playback
regression forces an unavailable Firefox audio context and checks real clock
progress, pause/resume, and natural completion through the published controls.
It does not establish audible playback or screen-reader listening comfort.
See Gecko's [AudioSinkWrapper](https://github.com/mozilla/gecko-dev/blob/master/dom/media/mediasink/AudioSinkWrapper.cpp).

The branching-dialogue retry journey uses a locally generated 60-second silent
PCM clip for the tense branch. It outlasts the journey's 30-second test timeout.
The test waits for real clock progress before retry, then checks that retry and
focus preserve playback without pause, restart or seeking. Selecting a new answer
must hide the old branch and pause its audio. Intro, question and calm clips still
use the short MP3 fixture; the authored-order and seek checks remain in place.

The module-deck suite runs in the same three engines and is not included in
`test:a11y`. CI gates it in separate `published-output-deck` jobs, with two
shards each for Chromium, Firefox and WebKit. Candidates run only Chromium;
PRs run no browsers. Each job runs
`prebuild:client` to warm `packages/export-pipeline/prebuilt` before source-mode
browser fixtures read that shared compiler cache. Desktop prebuild serves the
separate a11y fixture path; it does not warm this source-mode cache.
Deck jobs use the same four-CPU runners and two workers as a11y, with separate
JSON results, timestamps, first-retry traces and timing summaries retained for
14 days even on failure.
Run it for deck navigation, narration, transcript or card-follow changes:

```bash
pnpm --filter @praxity/export-pipeline prebuild:client
pnpm --filter @praxity/export-pipeline test:deck
```

Stable-playing deck journeys use a silent 60-second clip that outlasts their
45-second timeout. The formatted transcript uses a 90-second clip to leave
enough playback after its final 22-second cue. Separate short-clip checks retain natural completion and
auto-advance evidence. Firefox uses the same muted-media preference as a11y.
Metadata-loading and unavailable-audio journeys gate real responses at the local
fixture server. Unavailable MP3 and WAV assets return HTTP 503. WebKit's media loader can bypass `page.route`, so browser request
interception cannot reliably establish those states. Each metadata gate has its
own route prefix and is released and removed in `finally`.
A host whose audio
clock does not advance cannot establish natural playback; retain the failed result and
repeat on a functioning playback host rather than replacing that check with synthetic events.

Every palette in both modes retains rendered contrast and offline-font checks.
Hydrated palette cases retain 320px overflow, French heading fonts, button token
propagation, matching-control bounds and reflection entry. Minimal light and
Plum dark also run the complete wrong/retry/right keyboard journey, including
feedback focus and result colours. The other ten cases omit that repeated answer
cycle. Existing text-size and forced-colour coverage remains separate.

Navigation layout and first/last boundaries live in `nav-configs.spec.ts`.
`nav-a11y.spec.ts` owns each matching variant's forward activation, exact next HTML
URL, accessible control names, skip-link operation and destination H1 focus.
The seven basic-navigation cases formerly in nav-configs repeated those checks
or the no-navigation landmark check. Comprehensive required-content traversal
remains in `interactions.spec.ts`; outline visit meaning remains checked in both
languages, including wrong/retry/right and legacy HTML return.

The comprehensive export is served at the a11y root. The unused duplicate
`/comprehensive` extraction and the unreferenced desktop `block-variety.prax`
fixture have been removed. Desktop QA stage 09 covers protocol and external
navigation guards. Unsaved close and autosave acceptance remain a manual desktop
boundary; the deleted unconditional empty skip provided no automated evidence.
Before a release, edit a course, close while a save is pending, reopen and verify
the authored changes persist. Record the save/close outcome on the release host.

Editor-core also has structural accessibility checker tests, including an integration fixture that must trigger every registered rule. Update that fixture and the matching English and French rule metadata when adding a rule.

VoiceOver and VPAT/ACR evidence remain manual or focused release work. The refocus adds published slide-mode evidence for narration, synced reveals, navigation, and assessment announcements.

## Minimum checks by change

| Change | Minimum validation |
|---|---|
| Grammar or supported-block registry | Grammar tests, then `pnpm test` |
| Block renderer or shared navigation | Focused shared-blocks/published-output tests, then `pnpm test` |
| Export HTML or assets | Export-pipeline tests; add a11y suite for learner-visible changes |
| SCORM manifest or runtime | `pnpm test:scorm-adl` plus relevant published-output tests |
| Desktop IPC or workflow | Desktop Vitest and the affected Playwright stage |
| Theme, navigation, or interaction | Published-output Vitest and Playwright a11y |
| Docs only | No build gate |

Use `docs/test-fixtures/sample-course-grammar.md` for broad published-output coverage and `docs/test-fixtures/renderer-fidelity.prax` for desktop grammar-to-export coverage.

## Authoring contracts

`apps/desktop/src/renderer/__tests__/grammar4-insertion.test.ts` checks independent semantics
for every offered starter before round trips and composed-document boundary checks.
`enum-source-contract.test.ts` checks advertised values and explicit compatibility
values separately. An implemented metadata flag does not prove runtime behavior.
`apps/desktop/src/renderer/components/panels/__tests__/grammar4-compositions.test.ts` checks every starter and composition for retired authored
syntax, then verifies composition boundaries and selected block semantics. Sidebar insertion uses schema-backed templates. Raw slash insertion is disabled.

The isolated authoring catalog in
`packages/export-pipeline/tests/fixtures/authoring-catalog.ts` feeds static and real
compiled-artifact contracts, then Chromium/WebKit small/full preview tests. Keep
expected content independent of production metadata. Use local assets, fail on
missing required fixtures, and await the target lazy island before interacting.
Visual option cases check computed appearance and geometry with the compiled CSS.

The Electron app, its QA suite and launch scripts have been deleted.
Formal, private and internal CLI candidates share the Intel MacBook Pro runner
under its non-admin account. Formal dry runs retain shipped CLI and headless
browser journeys; internal builds use x64 native smoke and arm64 packaging checks.
Every main push builds an internal candidate for its exact SHA. Squash admission
uses the merged PR head, equal Git trees and the squash commit's first parent as
the candidate's exact recorded main base and ancestor. Its newest CI run must
succeed with a successful `merge-gate` and `Candidate base <SHA>` step in `changes`.
CI records the main SHA fetched for that run; old candidates without the step
refuse and can use a full main dispatch instead. PR/job lists paginate. Installer
fixtures exercise the same admission owner, newest admitted main selection,
main-push reuse, non-main source refusal and private-draft requirements.
`CLI candidate freshness` runs hourly on `ubicloud-standard-2`. Main's commit gets
two hours from the oldest uncovered server push/merge for capacity, build and
setup. A successful or in-progress candidate for that update or a newer main
update clears the gap. New merges cannot reset the deadline. Tests cover repeated
fresh merges, future committer dates, paginated activity/runs, the exact boundary,
unrelated runs, failures and queued runs.
Green-main build-ahead, requested internal installs and formal dry runs have
separate pending queues. Public publication refuses during hosted admission and
again in the publisher until Rubato checks the exact pack on native arm64.
`ci-minutes.test.mjs` scans every workflow and permits only scheduled or manual
self-hosted runs, plus `push` to exactly `[main]` in `cli-candidate.yml`.
Mutation cases refuse PR events, wildcard or other push branches, tags and pushes
in any other self-hosted workflow. Runner detection includes private labels,
label arrays and matrix expressions, and refuses unresolved runner expressions
on PRs. It checks shared runner
routing and queue separation. The native release and preview workflows have retired.
Dependency audits run on dependency/configuration PR changes, every Monday at
08:00 UTC, and manual Security runs.

Browser-editor journeys build the UI once and give each Playwright worker its own
project and server. Disk assertions after saves hold the project read admission,
including packaged CLI journeys, because T1 capture temporarily removes the target.

The authoring journey measures container guide geometry and checks actual iframe
contents and live versus saved revisions. Opening full preview flushes pending saves first.
Run this small journey locally with:

```bash
pnpm --filter @praxity/desktop e2e:browser-editor --workers=2
```

Keep combinations in fast source/compiled tests; add browser permutations when
there is a concrete interaction or layout risk. Existing schema, security, state,
identity, SCORM, and accessibility suites remain separate gates.

Design-panel browser contracts use compiled desktop fixtures for colours,
typography, layout, motion, navigation, brand assets, component defaults, and
section separators. Check painted properties and geometry in small and full
preview; record intentional small-preview suppression of navigation and motion.
Panel tests cover control changes and serialization, while browser journeys check source saves, live preview and compiled export.
