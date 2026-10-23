# Learning-patterns installed-byte admission

`scripts/learning-patterns-admission.json` records package-relative paths,
SHA-256 hashes, the full source commit, execution roles and reviewer/date/receipt
fields. The initial baseline refers to the pin audit in PR #1670.

## Guarantee and merge admission

When this check passes on an unmodified workflow, installed learning-patterns
files reached by static Node-side discovery match the SHA-256 and full source
commit in the manifest, with non-empty reviewer, date and receipt fields. Every
learning-patterns input consumed by the learner viewer build, the CLI Node bundle
and the Studio inspection frame must also match
its admitted hash and execution role. The check fails closed in the normal flow
and catches unrecorded or accidental changes to installed library bytes, including
pin, lockfile, patch and ordinary import changes. The real gate is the Studio merge process requiring green CI.
PR CI requires the fetched base verifier and shared admission module. Missing base
files or a failed fetch fail the check, even when a candidate verifier is available.
This is not a defence against anyone whose PR edits the workflow, scripts, dependencies or tooling. The reviewer metadata is checked for presence only;
anyone can type those fields. The Opus receipt bound to the pin and manifest digest
is policy, not proof supplied by CI.

This plan has no branch protection. Red CI does not disable merging, and writers
can push to main. Pull requests supply their own workflow, dependency installation,
lifecycle scripts, environment and verifier tooling. Fetching base verifier source
does not make those candidate-controlled inputs trusted. Security review before
merge must cover changes to `.github/workflows/`, the admission scripts and
manifest, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, package scripts/dependencies/
overrides, `patches/`, `.pnpmfile.cjs` and `.npmrc`. Installed-byte checks do not
replace capability or execution-role source scans.

## Checks and build ownership

Run `node scripts/check-learning-patterns.mjs` after a frozen install. It never
executes upstream modules. It scans tracked and untracked non-ignored source/CSS/
JSON files throughout the repository, excluding only `node_modules`. Static
imports and upstream transitive metafiles establish conservative Node admission,
including test imports. Actual learner, CLI and Studio browser bundle inputs are authoritative
for bundled inputs. `bundleViewer` checks every build, covering source publish,
cache preparation, the course-HTML tool and desktop preparation; CLI packaging
checks its own Node metafile and the collected Vite browser inputs too.
`prebuild-viewer` checks the inspection-frame esbuild metafile with the
`studio-browser` role before accepting its assets. Viewer hashing includes the policy, manifest and
actual installed bytes, so cache lookup cannot conceal installed-byte drift.

Non-literal and template imports refuse unless their exact file and expression
are in the reviewed workspace-loader list. Test fixture source strings remain
inert data. Literal package specifiers, literal resolver/fs/URL paths naming
`learning-patterns/` and JSON alias targets refuse; known root legal reads remain
covered by legal hashes. Static Node-side discovery catches literal imports and known patterns only.
It does not catch computed `createRequire` paths, `fs` reads anchored on allowed package files,
or TypeScript path aliases. Computed reads injected through esbuild `define` or
`banner` also escape its input metafile. Each such route needs a visible Studio
source or configuration change and security review. CSS imports and URLs include
relative and unquoted forms. Upstream
`exports`, `imports` or `browser` conditions refuse until resolution is reviewed.
The pnpm package link resolves to a canonical root; interior symlinks and escaping
files refuse. Hash/pin/role mismatches and missing review fields refuse.

A successful CLI run prints exactly one receipt beginning
`learning-patterns admission verified:`, with file count, full pin and manifest
SHA-256. CI and local base verification require this positive receipt, including
when the temporary directory contains symlinks.

## Base selection

Normal PR CI resolves the checked-out merge commit's first parent, the main
revision GitHub merged the candidate onto. It fetches that revision into an empty
temporary bare repository, then extracts the verifier and its shared admission
module. It does not use the PR event's potentially stale base SHA. An unresolved
first parent fails the check.
The empty object database forces remote contact without altering checkout
ancestry. Fetch includes the checkout Git config for origin/authentication; that
config remains candidate-controlled. Fetch, invalid revision and extraction
errors fail, including when the base predates the verifier. There is no candidate
fallback for PR runs. Local strict equivalent:
`node scripts/check-learning-patterns.mjs --trusted-base origin/main`.

Every manual workflow dispatch explicitly skips trusted-base mode, logs that it
uses the candidate copy, and still requires a positive verified receipt. It makes
no base-source claim for the candidate head.

## Updating the shared pin

1. Review the full old-to-new upstream diff and existing native consumers. Update
   the one catalog pin, lockfile and frozen installation.
2. Run `node --import tsx scripts/check-learning-patterns.mjs --regenerate`. It discovers Node
   inputs, captures real viewer and inspection-frame inputs in disposable builds and writes their
   union. Every reviewer/date/receipt field is cleared, so verification refuses
   until review. Explicit `--bundle-inputs <json> --inspection-inputs <json>` accepts retained
   real input lists for regeneration; both lists are required, and subsequent real
   build admission remains mandatory.
3. Run `node scripts/check-learning-patterns.mjs --digest`. It prints the full pin
   and SHA-256 of the files projected to `path`, `sha256`, `sourceCommit`, `roles`,
   sorted with `localeCompare(..., "en")`, serialized with `JSON.stringify` and no
   newline. Excluding review metadata avoids a circular receipt digest.
4. Obtain the Opus review bound to that pin and digest, retain its receipt and
   fill reviewer/date/reference fields. Verify installed inputs, native consumer
   compatibility, actual bundle closures, notices and byte budgets. Commit the
   pin, lock, manifest and compatibility work together.
