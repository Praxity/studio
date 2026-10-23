# Internal Studio install

Run this from the course directory on a Mac with Node 24.18 or later in the 24.x
series, Git and `gh`. Authenticate with a GitHub account that has Studio repository
write and Actions access. Close Studio after saving or copying all open text.

One-time setup, after the local-install Rubato API and this command merge:

```sh
gh auth status --hostname github.com
export STUDIO_SOURCE_REPO="<source-owner>/<source-repository>"
export STUDIO_CANDIDATE_REPO="<candidate-owner>/<candidate-repository>"
gh repo clone "$STUDIO_SOURCE_REPO" <studio-checkout>
gh repo clone Praxity/rubato <rubato-checkout>
```

Both repository variables are required outside GitHub Actions. Set the source to
the repository holding main and CI, and the candidate to the repository holding
internal candidate runs and draft releases. They are the same until the go-public
cutover, when the candidate repository becomes the private CI repository.
Missing-variable refusals print export commands derived from the Studio
checkout's origin, or placeholders if that remote cannot be parsed.

If those folders already exist, use their reviewed clean main checkouts instead
of cloning again. Rubato must be on main at origin/main after fetch, without
tracked or untracked changes. Update both with `git -C <folder> pull --ff-only` after installer
changes merge. No dependency installation or local build is needed.

Install, or run the same command again for a newer Studio main:

```sh
node <studio-checkout>/scripts/install-internal-studio.mjs --rubato <rubato-checkout>
```

The command examines the latest 100 main commits, their latest CI runs and the
paginated candidate history. It picks the newest commit with successful CI,
including the merge gate, and a candidate WebKit pass. PR checks alone do not
qualify. It prints the selected SHA and CI
run URL, commit date and age in hours, and refuses if no commit qualifies.
When selection is older than current main, it prints both SHAs and warns that
recent features require newer successful full-main CI. An installed newer
Studio is preserved: the command refuses to downgrade and asks for successful
full CI on current main. Unproven or divergent source ordering also refuses.
Older installed packs that report no `studioSha` print a note that the downgrade
check is unavailable. Their source order cannot be verified by this command.

After successful full CI on main, `cli-candidate.yml` runs the complete WebKit
accessibility and deck suites on the MacBook Pro before building an internal
candidate ahead of installation. Source selection requires both green CI and a
candidate run whose WebKit job passed. Legacy candidates without that job are
refused. Candidates use private draft release assets,
independent of the Actions artifact quota. The command reuses a verified
internal candidate for that SHA without waiting, or dispatches `cli-candidate.yml`
on main with the selected source SHA as `ref` and `purpose=install`. The run title is exactly
`CLI candidate <full source SHA>` for both push and dispatch runs. Discovery
ignores missing or malformed titles. For dispatches, the title identifies the
source while `head_sha` identifies the workflow tooling. Draft release bodies
record `Studio SHA: <full source SHA>`; the release target belongs to the
workflow repository. The installer requires matching source metadata even
when source and workflow commits are the same.
Before reusing either a completed or an in-progress run, it also requires
`head_branch=main` and proves the workflow's tooling commit belongs to main at
the time of admission. The tooling SHA can differ from the selected source SHA.
The same admission runs after waiting, while the draft and archive inventory
must independently match the selected green source exactly. A branch-built
candidate is never activated, even when it uses the expected source input.
Both manual internal builds and build-ahead run on the Intel test runner. It
builds both archives and runs the x64 native CLI smoke. The arm64 archive has
build and packaging checks only; the local installation supplies its native
check through version and doctor, with rollback on certification failure.
Push builds coalesce in their existing build-ahead concurrency group, with one
running and one replaceable pending run. After the source and candidate repositories
split, a 15-minute poll builds source main in that same group. Scheduled candidates
record the source SHA in a successful WebKit step, independently of the tooling SHA.
Private tooling pushes then wait for the next poll. Manual internal builds and
hosted formal releases keep separate groups. Before preparation, WebKit and build jobs
wait up to 30 minutes for VoiceOver to stop and 1-minute load to fall to 6 or less.
The archive build skips browser downloads and journeys; the preceding WebKit job
installs only WebKit, enables keyboard navigation and restores the original
preference even after failure. Candidate admission checks the exact selected
run's WebKit result again before downloading. Formal release inputs belong to
the separate hosted `cli-release.yml` workflow, which retains the full browser gates.
The command never creates a public Rubato release.

A failed candidate reports `refused: candidate build failed: cli-candidate.yml
run <id> <url>` and exits nonzero. The workflow prints runner free space before
and after. A displaced queued build-ahead run also reports `candidate build failed`;
rerun the command to recover. An unfinished candidate reports `candidate build did not finish`.
The workflow removes its source/tooling checkouts and run-specific temporary
directory, including browser downloads and its pnpm store, on success or failure.
The verified handoff survives until the private publish job removes it.

The draft must name the captured SHA. Its native archive must match both its
checksum asset and GitHub's SHA-256 asset digest. Rubato's publisher checks the
archive inventory, source SHA, architecture, legal notices and permitted payload.
The local manifest carries that verified hash and full `sourceRevision`. A local
bootstrap exported from the clean reviewed Rubato checkout invokes the same
journaled installer and skill refresh as `praxity update`. Failed activation
restores the prior activation; the prior pack remains available for rollback.

Require 8 GiB free on both home and temporary volumes before downloading. The
command removes its temporary download and bootstrap directory on exit. Rubato
retains its installer cache and installed versions for recovery. Only candidate
drafts whose dispatch IDs this command recorded are eligible for deletion. It
keeps the newest two of those drafts. Other drafts stay untouched.

The same Studio SHA and reviewed Rubato commit return `already current` after
checking the active inventory, running doctor and retrying both skill scopes.
A newer Rubato main commit installs a new pack even if Studio main is unchanged.
Pack versions include the Studio SHA, Rubato commit and candidate run ID. The
manifest uses the stable candidate URL; verified bytes travel in the temporary
bootstrap under their SHA-256, so retries reuse the journal and cache.
The active pack's platform chooses the archive, including under translated Node.
Interrupted activation restores its prior pointers immediately or through the
journal on the next install. An uncertified current pack refuses with rollback
instructions. A running Studio session refuses. Every refusal or failed step
exits nonzero and reports the active pack version and Studio SHA when available.
If skill refresh refuses, the pack can already be active; resolve the reported
ownership conflict and run `praxity skills refresh --scope user` or `--scope
project` from the course directory. Restart the agent host when skills change.

Trust the reviewed Studio and Rubato checkouts, Studio writers, the authenticated
GitHub API and the internal candidate runner. Same-source checksums
provide integrity; they do not independently authenticate that runner. Dispatch
uses GitHub's returned run ID, so draft ownership does not depend on a time-based
guess. [GitHub's workflow API](https://docs.github.com/en/rest/actions/workflows?apiVersion=2026-03-10#create-a-workflow-dispatch-event)
documents that response.
