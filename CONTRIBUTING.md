# Contributing

Use the Node and pnpm versions in [package.json](package.json). Use pnpm throughout.

```sh
pnpm install --recursive --frozen-lockfile
pnpm build:cli
pnpm lint
pnpm typecheck
pnpm test:affected
```

Install from the repository root with development dependencies for every workspace package. The source-owner lint check needs complete workspace dependency links; a filtered or production-only install is insufficient.

Changes to the learning-patterns pin follow [installed-byte admission](docs/context/dependency-admission.md), including manifest regeneration and review receipts.

After building, `pnpm test:cli` checks the standalone CLI. See [testing guidance](docs/context/testing-strategy.md) for checks required by your change. CI runs the full merge-candidate gate.

Open a focused PR from a feature branch. Explain the problem, resulting behavior and checks run. Add regression coverage for behavior changes. Follow [agent instructions](CLAUDE.md) and [coding standards](CODING_STANDARDS.md), including accessibility, English/French copy and grammar-spec updates.

Outside PRs need a maintainer to push the reviewed change to a repository branch before the merge-candidate gate runs. Maintainers admit candidates and merge after required checks pass.

PR titles, bodies, commits, comments, code, fixtures and docs must never name clients, machine paths or private repositories. Keep client material private. Use invented examples and repository-relative paths.

Studio is source-available under PolyForm Perimeter 1.0.1. Read [LICENSE](LICENSE) and [LICENSING.md](LICENSING.md); retain third-party notices and the separate terms for exported course runtimes.
