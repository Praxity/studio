# Praxity Studio

Local authoring and export for grammar 4 eLearning courses. Studio runs through the standalone CLI and a thin browser canvas.

```sh
pnpm install --frozen-lockfile
pnpm build:cli
node dist/studio-cli/praxity.mjs studio <course-directory> --no-open
```

Open the printed URL for Read mode. Edit text opens the authenticated author document; Enter saves and Escape cancels. Structural edits, export, inspection, identity and narration use the CLI. Validate a course with `praxity inspect <course-directory> --schema 1`. Run `praxity --help` for commands.

The optional local review HTTP service caps new threads at 1,000, reviewer writes at 100 total messages per thread, and mutations at 100,000 per review. Author replies and resolves bypass the message and mutation count caps. Reviewer writes stop at 3,670,016 serialized UTF-8 bytes, reserving 524,288 bytes for the author up to the 4,194,304-byte state cap. The byte cap normally binds before the mutation count cap. Reaching a cap refuses the new write without changing history; identical retries retain their original receipts. See [review HTTP behavior](docs/context/browser-editor.md).

The legacy browser editor and Electron application are retired. The last desktop release remains at tag `v0.3.0`. Courses and identity records are unchanged by retirement.

Development checks: `pnpm typecheck`, `pnpm lint`, `pnpm test:affected`, and `pnpm test:cli` after building. See [browser canvas](docs/context/browser-editor.md) and [testing](docs/context/testing-strategy.md).

Praxity-authored code uses [PolyForm Perimeter 1.0.1](LICENSE). See [NOTICE](NOTICE) for third-party and separately licensed content.
