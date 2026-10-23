# Tech stack and tooling

## Product stack

- **Host:** Node 24 standalone CLI, local HTTP services and a native DOM canvas adapter.
- **Shared UI/runtime:** React 19, Mantine 9 and Tabler remain in learner rendering and retained editor-core libraries. The Electron and raw source editor hosts are removed.
- **Grammar:** TypeScript grammar 4 tokenizer, lossless tree and reader with `yaml` for frontmatter.
- **Course rendering:** Desktop previews and published output use canonical compiled server HTML with planner-selected islands from `packages/export-pipeline`. Shared React block and navigation components live in `packages/shared-blocks`.
- **Export:** Direct HTML generation, esbuild bundles, Archiver ZIP packaging, and bundled SCORM schemas. The supported release formats are SCORM 2004, SCORM 1.2, and standalone HTML. xAPI remains experimental and hidden.
- **Public site:** maintained separately in `../praxity-site/`.
- **Local services:** Chokidar watches project files; session-local settings stay in memory.
- **Validation and sanitization:** Zod at RPC and data boundaries; isomorphic DOMPurify for user HTML.

There is no production web application, database, collaboration server, or account system in the current authoring and export path.

## Development tools

- **Runtime:** Node 24 LTS.
- **Packages:** pnpm 10 workspaces.
- **Language:** TypeScript 5.9.3.
- **Unit and integration tests:** Vitest 4 with JSDOM where browser APIs are needed.
- **Browser E2E:** Playwright 1.59.
- **Accessibility automation:** axe-core through Playwright.
- **Lint and formatting:** Biome 2. Run scoped fixes; do not rewrite the repository wholesale.

Common commands:

```bash
pnpm build:cli
pnpm test
pnpm lint
pnpm typecheck
pnpm test:scorm-adl
```
