# AGENTS.md

If `AGENTS.local.md` exists, read it before starting. It holds maintainer context and is not part of the repository.

Follow `CLAUDE.md`, the canonical project instructions. Load only the references it routes to for the current task.

Before implementation or review, read the applicable checklists in `CODING_STANDARDS.md` and use them as fail-first cases.

Grammar 4 is the only current source format. Identity is stored in `.praxity/identity/`; narration uses v2. Convert old courses with the archived branch `converter/v3-to-v4` or tag `converter-v3-to-v4`, following `docs/context/converter-archive.md`. The legacy editor and Electron app are retired. `praxity studio` opens the local Read preview. Keep CLI-imported modules under `src/main/`; see `docs/context/browser-editor.md` for the retained boundaries.
Before reporting, run `pnpm test:affected`. Local runs stop at the first failure.
When a change selects the whole a11y or deck suite, a local run skips that complete suite, prints the paths that selected it and its case count, and leaves the rest of the suite to the merge candidate's CI. Edited browser specs and contrast-themes for CSS still run locally. Use `--full` only when CI reports a failure in that suite or the controller asks; it runs all selected steps and continues after failures. CI always runs every selected step and the complete suites.

PR titles, bodies, commits, comments, code, fixtures and docs must never name clients, machine paths or private repositories. Keep client material private. Use invented examples and repository-relative paths.

See `CONTRIBUTING.md` for build commands and PR expectations.
