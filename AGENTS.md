# AGENTS.md

If `AGENTS.local.md` exists, read it before starting. It holds maintainer context and is not part of the repository.

Follow `CLAUDE.md`, the canonical project instructions. Load only the references it routes to for the current task.

Before implementation or review, read the applicable checklists in `CODING_STANDARDS.md` and use them as fail-first cases.

Grammar 4 is the only current source format. Identity is stored in `.praxity/identity/`; narration uses v2. Convert old courses with the archived branch `converter/v3-to-v4` or tag `converter-v3-to-v4`, following `docs/context/converter-archive.md`. The legacy editor and Electron app are retired. `praxity studio` opens the thin canvas in Read mode. Keep CLI-imported modules under `src/main/`; see `docs/context/browser-editor.md` for the retained boundaries.
Before reporting, run `pnpm test:affected`; CI runs the full gates.

PR titles, bodies, commits, comments, code, fixtures and docs must never name clients, machine paths or private repositories. Keep client material private. Use invented examples and repository-relative paths.

See `CONTRIBUTING.md` for build commands and PR expectations.
