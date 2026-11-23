# 0008: Workspace test configuration

## Status

Accepted. The Vitest configuration sections record existing behaviour; the dated sections record the CLI rename decisions.

## Context

Bare Vitest invocation must use the same package environments as the workspace command.

## Decision

### `vitest.config.ts`

- `module initialization`: Re-export `vitest.workspace.ts` so a bare `vitest` uses the package environments, setup files and aliases. Without this entry, auto-discovery runs tests with the wrong configuration.

### `vitest.workspace.ts`

- `test.maxWorkers`: Serialize filesystem-heavy Mac files; their child writers still run concurrently.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7` and the project definitions in `vitest.workspace.ts`.

### CLI workspace name

Decided 2026-11-22. The executable host lives in `apps/cli`, with private workspace package `@praxity/cli`, because Studio no longer contains an editor app. Distribution remains `@praxity/studio`, binary `praxity` and output `dist/studio-cli`. The Vitest project keeps the name `desktop` because the macOS nightly test job selects `--project=desktop`. Keep filenames such as `desktop-design.ts`, the `desktop` mode value and message keys such as `desktop.identity`; these are separate contracts.

### Slow-test allowlist path migration

Decided 2026-11-22. The validator uses `priorStudioAppPath` from `scripts/studio-app-layout.mjs` for the fixed, one-way move from `apps/desktop/` to `apps/cli/`. Its path sets are projected from file/name keys, so the shared owner handles the prefix and old-entry removal rules while the validator checks every field except `file` for equality. Exact keys take precedence and destinations stay unique. Dated entries still undergo expiry, date and run validation. Other additions remain subject to the existing shrink-only and dated-addition rules. Once the base no longer contains an old key, the migration cannot restore it.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
