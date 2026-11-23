# 0008: Workspace test configuration

## Status

Accepted. Records existing behaviour.

## Context

Bare Vitest invocation must use the same package environments as the workspace command.

## Decision

### `vitest.config.ts`

- `module initialization`: Re-export `vitest.workspace.ts` so a bare `vitest` uses the package environments, setup files and aliases. Without this entry, auto-discovery runs tests with the wrong configuration.

### `vitest.workspace.ts`

- `test.maxWorkers`: Serialize filesystem-heavy Mac files; their child writers still run concurrently.

### CLI workspace name

The executable host lives in `apps/cli`, with private workspace package `@praxity/cli`, because Studio no longer contains an editor app. Distribution remains `@praxity/studio`, binary `praxity` and output `dist/studio-cli`. The Vitest project keeps the name `desktop` for nightly selection compatibility. Source filenames and mode values retain their existing contracts.

### Slow-test allowlist path migration

The validator permits the fixed, one-way move from `apps/desktop/` to `apps/cli/`. It first matches exact file/name keys. A migrated entry must retain every field except `file`, remove the old key from the current list and have a unique destination. Dated entries still undergo expiry, date and run validation. Other additions remain subject to the existing shrink-only and dated-addition rules. Once the base no longer contains an old key, the migration cannot restore it.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7` and the project definitions in `vitest.workspace.ts`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
