# Studio release notes

Studio 0.3.0 was the last standalone desktop release; Studio continues inside Rubato.
The desktop workflow no longer publishes.

## Unreleased

`praxity studio` opens the thin canvas in Read mode. Its Edit text link opens the authenticated author document. The legacy browser editor and Electron application are removed, including desktop IPC sharing, auto-update and desktop packaging. Existing course and identity files stay in place. Previous desktop workflows remain at `v0.3.0`; converter tags are unchanged. CLI export, `inspect --schema 1`, identity and narration commands remain supported.

Save open edits before upgrading. Durable drafts from the retired editor remain in `.praxity/local/drafts/`; `v0.3.0` predates that storage. Use `praxity recovery list <course-directory>` to list them and `praxity recovery export-drafts <course-directory> <new-directory>` to copy every draft into a separate plain text file. The destination must be new. Recovery preserves saved source and stored drafts; it does not apply draft text to the course. Studio prints the retained count and recovery command at startup. Add `--lang fr` for French notices.

## Owner steps before the first public release

The owner does these three once, before the first public Rubato pack:

1. Turn on immutable releases in `Praxity/rubato`. The publisher refuses to run without them.
2. Create `RUBATO_RELEASE_TOKEN`, scoped to `Praxity/rubato` with Contents write and Administration read, as described below.
3. Run the ADL Windows checks against the candidate Studio revision and keep their conformance artifacts.

Decision, 2026-10-16: Studio stays on GitHub Free and uses the repository-secret fallback described below, accepting its residual risk. Revisit when anyone other than the owner and the owner's agents gets write access to the repository that runs the Rubato publisher.

## Publish a Rubato pack

A private `CLI candidate` builds only a full SHA on Studio main or the head of a
branch in this repository. Admission refuses pull-request and fork refs, which
GitHub also serves through this repository.
Formal and private candidate builds run in private CI on a macOS runner
under a non-admin account.
To produce a public Rubato pack, dispatch its `main` revision with `ref` set to a
full Studio SHA and `pack_version` set to a new stable version. The SHA must be
an ancestor of Studio main, and its newest `CI` run must be a successful full
main run with a successful `merge-gate`. Run `CI` on main first when necessary.
Admission runs for every candidate, on the same Ubicloud runner class as PR CI.
A private candidate then keeps its build/publish path.
Before a public run, the owner must confirm Studio's Actions billing permits
GitHub-hosted Linux and macOS jobs. With hosted billing blocked, native smokes
and the public publisher cannot start. Fund those runners before dispatching;
private candidates need no new hosted runner.

Leave `publish_pack` false for a dry run. The workflow builds and tests both Mac
archives through the existing candidate script, creates the private candidate,
then runs package smoke checks on native hosted ARM64 and Intel Macs. Only after
those jobs succeed does a hosted Linux job run Rubato's pack publisher. Public
publication currently refuses `publish_pack=true` during hosted admission,
before any Mac build, and again in the publisher step with:
"Formal release needs the native arm64 install check on Rubato's macos-15 job; not wired yet."
Rubato's `macos-install` job on GitHub-hosted `macos-15` must pass a native arm64
install of the exact pack to publish, matched by SHA-256, before that refusal
can be removed. Its current workflow installs the committed `pack.json` and
cannot accept Studio's unpublished pack. Studio's archive smokes do not prove
that pack install. Dry runs and private candidates still work; no PR runs the
self-hosted Mac jobs. The owner's immutable-release, token and Windows ADL
steps above remain required before the first formal release.

Before the first real run, merge the Rubato publisher and provide
`RUBATO_RELEASE_TOKEN`, scoped to Rubato with Contents write and Administration
read. The publisher job always runs in environment `rubato-release` and reads
`RUBATO_RELEASE_TOKEN` only in the hosted publisher step, after admission, both
native smokes and the serialized release build. Studio is private and currently
uses GitHub Free, which cannot provide private environment secrets or deployment
branch policies, so the environment carries no protection there and the job
falls back to a Studio repository secret of the same name.

In a public repository, or once the plan supports private environments, create
`rubato-release` with a required reviewer and deployment limited to `main`, put
the secret in that environment and remove the repository secret. These are
owner setup instructions; the workflow does not change the plan or settings.
GitHub documents the [plan restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

Residual risk for the owner: the repository-secret fallback restricts token use
only in this workflow. Any workflow on a writable Studio branch can request
that secret. Its Rubato Contents write permission can alter repository code and
older mutable releases. The release runner uses a non-admin account on the
MacBook Pro. Any process running as that account can rewrite the archives
during the build, before digests are captured; no earlier persistent compromise
is required. The owner must trust Studio writers and all processes in that
account before adding the token. Environments do not isolate that machine.
Move builds to isolated hosted runners when billing permits as the upgrade path.

Enable Rubato release immutability in repository settings. The publisher
refuses versions at or below Latest or any published stable version, an existing
release or tag, and never replaces its assets. A failed upload leaves an inactive draft for owner inspection;
use a new version for a later attempt. Complete the Windows checks below for the
same candidate revision before choosing public publication.

Every push to main starts internal CLI build-ahead for that exact main SHA.
Internal admission accepts successful full main CI or the merged PR's candidate CI.
For a squash merge M of candidate head H, admission requires equal Git trees and
M's first parent as H's ancestor and exact tested main base. Candidate CI records
the fetched main SHA in a successful `Candidate base <SHA>` step, visible through
the run's jobs API. The commit's merged PR association supplies H; PR and job
lists are paginated. Missing associations or recorded-base evidence refuse.
Older revisions can use a successful full `CI` dispatch on main. GitHub's REST run
response does not expose dispatch inputs, so candidate identity uses the exact
`CI candidate <H>` title and H's run metadata.
The newest CI run for H must succeed with a successful `merge-gate`; a later
failure blocks admission. Formal dry runs keep the full main-CI requirement.
The installer uses the same internal-admission adapter, searches main's first 100
first-parent revisions newest first, and reuses successful or running main-push
internal candidates. It still requires a private draft prerelease for installation.
The hourly `CLI candidate freshness` check on Ubicloud measures the oldest
uncovered main push or merge using GitHub's server timestamps. After two hours,
it fails with main's SHA unless that update or a newer main update has a successful
or in-progress build-ahead. New merges do not reset the deadline. Queued runs do
not count. Two hours cover capacity wait, build and setup; committer dates do not
supply freshness evidence.

Green-main build-ahead, requested internal installs, formal dry runs and
private candidates use separate private CI concurrency groups. GitHub keeps one pending run per
group and replaces it when another arrives, even with `cancel-in-progress: false`.
Build-ahead must have its own group so it cannot cancel a pending internal install.
The single runner serializes Mac jobs. See GitHub's
[concurrency rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
Builds wait up to 30 minutes for capacity. The 120-minute job budget covers that
wait, the existing 75-minute build step and 15 minutes for setup and cleanup.
CLI proof runs at 12:00 UTC, after the 07:00 macOS nightly's combined 270-minute
job budget. Internal candidates' x64 archive
receives native smoke; arm64 is build and packaging only until the owner's
version/doctor installation gate. Build job outputs capture each archive name
and SHA-256 before handoff. The private
publisher checks handoff bytes against those outputs and returns its draft's
release ID. Both native smokes and the public publisher download assets by that
ID and compare bytes to the build outputs. Downloaded checksums never supply
the expected digests.

The publisher captures Rubato main once, verifies both archive hashes, inventory,
legal notices and Studio SHA, then exports only Rubato's public install payload.
It checks installer-owned entry, notices and skill paths from the manifest.
Dry runs check remote version/immutability prerequisites without creating a
release. Real runs upload a draft, download and rehash every draft asset before
activation, and read the live release back to require immutability and the exact
asset digest set. A readback failure is a failed release job requiring owner
inspection, even though activation has already occurred.
The release contains the native archives, `pack.json`, `rubato-<version>.tar.gz`
and `SHA256SUMS`. The manifest records Studio's SHA as `tools[].sourceRevision`.
The private source checkout and build-input review provenance stay private.
Historical pack manifests and published releases are never edited. New manifests
use the current Rubato repository URL for carried pins.

## Check the Windows release candidate

Before releasing Studio code inside Rubato, run the ADL Windows checks against the
candidate revision and retain the conformance artifacts. The owner decided on
2026-10-11 to run private Windows checks by hand before release.

When hosted Windows billing is available, dispatch the unchanged suite:

```sh
gh workflow run scorm-adl-conformance-windows.yml --repo <private-ci-repository> --ref <candidate-ref>
```

Hosted uploads contain Praxity reports only. Installed-file inventories and manual
ADL UI evidence stay runner-local. Review the ADL-generated summary and detailed
logs from a private local run before making a full conformance claim; the hosted
artifact alone cannot support that review.

With no payment method and a $0 Actions budget, hosted dispatches cannot start.
On Windows, check out the candidate and the `scorm-adl-2026-05-12` ref of
the private CI asset snapshot into `adl-assets`. Install pnpm, Node 24.22.1 and
Java 8 as specified in the workflow, then run from the Studio checkout:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @praxity/export-pipeline exec tsx scripts/build-test-package.ts scorm2004
.\scripts\scorm-adl-conformance-windows.ps1 -Suite both -AssetDir adl-assets -AssetRef scorm-adl-2026-05-12 -Mode install -Scorm2004PackagePath packages/export-pipeline/test-course-scorm2004.zip
```

These commands match the workflow's defaults. Installation diagnostics and the
manifest validator do not prove ADL UI suite conformance. Complete the required
interactive suite and include its logs with `-ManualUiEvidenceDir <logs-directory>`.
Review `adl-conformance-windows-artifacts/conformance-summary.json` before releasing.

## Historical desktop release notes

The rest of this page records how standalone desktop releases worked.

Write public release notes in [Praxity/desktop Releases](https://github.com/Praxity/desktop/releases).
Create a draft release for the candidate's exact tag before the desktop workflow publishes.
The public site reads those notes when it builds.

Use the exact headings `## English` and `## Français` at the start of a line.
Put a short summary and at least one of these sections inside each language:

| English | Français |
| --- | --- |
| `### New` | `### Nouveautés` |
| `### Improved` | `### Améliorations` |
| `### Fixed` | `### Corrections` |
| `### Changed` | `### Modifications` |

Omit empty sections in both languages. Every section you include needs its counterpart.
For example, notes with only `### Fixed` and `### Corrections` pass the check.
Keep download links and shared installer details above the language headings.
Write Markdown and have a person write or review the French.

The workflow checks the existing release body for the tag, including build-only candidates.
It looks up the tag, then searches one page of up to 100 releases for a matching
draft if the tag lookup returns 404. The check only reads GitHub.

The check warns when a language heading is missing, a language has no allowed
change sections, or a section lacks its counterpart. It names the missing heading
without quoting release content. It also warns if it finds no release or GitHub
returns an error. Warnings never block publication.

After publishing or editing notes, follow the site's
`context/studio-changelog.md` to refresh its snapshot and check both language pages.
