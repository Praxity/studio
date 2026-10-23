# Project structure

Praxity is a pnpm workspace centred on the standalone Studio CLI.

```text
apps/
  desktop/
packages/
  content-model/
  grammar/
  content-identity/
  operations/
  shared-blocks/
  editor-core/
  export-pipeline/
  review-share/
  format-renderers/
```

## Apps

### `apps/desktop/`

The standalone CLI and browser canvas host. The directory keeps its historical name.

- `src/main/`: CLI, rooted HTTP services, filesystem transactions, operations, identity, narration and export.
- `src/main/export/`: local export owners shared by CLI and server.
- `src/renderer/browser/canvas*.ts`: native author document and text adapter.
- `src/renderer/themes/`: shared theme values still imported by CLI/export and tests.
- `src/shared/`: service schemas, transport types, manifest types and path utilities.
- `e2e/browser-editor/`: headless canvas and retained inspection journeys.
- `scripts/`: viewer prebuild, standalone CLI packaging and release verification.

## Core packages

### `packages/content-model/`

Dependency-free block data types, shared constants, and inline grammar formatting. Grammar and renderers both depend on it; `shared-blocks` keeps compatibility re-exports for existing imports.

### `packages/grammar/`

Grammar 4 tokenizer, lossless tree, schema, reader projection, frontmatter and validation. `src/supported-blocks.ts` defines core and hidden block status.

### `packages/content-identity/`

Durable content identity resolution, snapshots and sidecar serialization. Depends on grammar's tree and operation contract types.

### `packages/operations/`

Grammar 4 source operation runtime. Plans exact source edits and identity evidence using grammar and content-identity. The shared contract types stay in `packages/grammar/src/operations/contract.ts`. See [the operation reference](../prax-format/reference/operations.md).

### `packages/shared-blocks/`

Shared React block renderers and authoring projections.

- `src/blocks/`: the live assessment island, inline content and shared block styles.
- `src/viewer/`: shared navigation components, page splitting, learner preferences, and viewer types.
- `src/logic/`: variables, conditions, actions, persistence hooks, and mention resolution.
- `src/i18n/`: viewer strings.
- `src/asset-graph.ts`: shared asset traversal.

### `packages/editor-core/`

Reusable authoring UI and state.

- `src/components/`: grammar editor, design controls, media workflows, and accessibility UI.
- `src/stores/`: grammar document and editor stores.
- `src/adapters/`: host capabilities supplied by retained service adapters. The standalone CLI and thin canvas own the supported host; the Electron app is retired.
- `src/lib/a11y/`: structural accessibility checker, rule metadata, and tests.
- `src/lib/themes/`: design variants, tokens, and theme resolution.
- `src/messages/`: English and French editor strings.

### `packages/export-pipeline/`

Standalone HTML and SCORM packaging.

- `src/build.ts`: `buildScormPackage()` and export orchestration.
- `src/html-gen.ts` and `src/render-block-html.ts`: canonical server-rendered learner HTML.
- `src/scorm/`: SCORM 1.2 and 2004 runtime code.
- `template/src/island-loader.ts` and `template/src/islands/`: planner-selected learner enhancements.
- `schemas/`: bundled SCORM schemas.
- `tests/published-output/`: structural output tests.
- `tests/a11y/`: Playwright and axe browser suites.
- `tests/scorm-local/` and `tests/scorm-cloud/`: LMS compatibility suites.

## PDF rendering

### `packages/format-renderers/`

Native course PDF rendering, shared asset resolution, Typst helpers and typography.

## Root files

- `package.json`: shared scripts and tool versions.
- `pnpm-workspace.yaml`: workspace discovery.
- `vitest.workspace.ts`: default Vitest project list.
- `biome.json`: lint and formatting rules.
- `tsconfig.json`: shared TypeScript settings.
- `docs/`: product context, canonical specs, format documentation, archived tasks and research, and test fixtures.
