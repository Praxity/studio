/**
 * Root config so a bare `vitest` does the same thing as `pnpm test`.
 *
 * Without this file Vitest finds no root config and falls back to auto-discovery: it
 * sweeps every `*.test.*` in the repo with none of the per-package environments, setup
 * files or aliases. On a clean checkout that reported 197 failed files — all
 * configuration, none of them real — which is a long detour for anyone who reaches for
 * the obvious command, human or agent.
 *
 * `vitest.workspace.ts` already defines the projects, so this just re-exports it rather
 * than describing the same thing twice.
 */
export { default } from "./vitest.workspace.ts";
