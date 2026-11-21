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

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7` and the project definitions in `vitest.workspace.ts`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
