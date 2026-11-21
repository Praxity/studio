# 0027: Export test baseline capture

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Renderer baselines compare output bytes. Comparing a compiler against its own output or reparsing and serializing the output can conceal a regression.

## Decision

- In `packages/export-pipeline/scripts/update-page-compiler-baseline.mts`, `recordBaseline` hashes full-build HTML, not `compileDocument` or `compilePage` output. Regeneration requires a reviewed design reason for every changed entry.
- `normalizeRendererAssets` and `rendererMetadata` in that file remove deployment script URLs, bundle fingerprints, font preloads and build-only loading/icon metadata absent from the renderer fixtures. Asset references round-trip through offline relative URLs. This compares renderer bytes separately from downloaded asset bytes.
- `bodyHashes` in that file slices source bytes at jsdom node locations. DOM serialization would change the bytes under test.
- `packages/export-pipeline/vitest.config.ts` includes all of `src/__tests__`. A formerly narrow pattern excluded HTML-generator coverage and let missing static navigation escape detection.
- In `packages/export-pipeline/vitest.global-setup.ts`, `setup` builds shared published-output fixtures once on disk. Vitest forks do not share a module-level cache, so caching there would rebuild the fixture per worker.

Source: these files at commit bed54f6, before comment removal.

## Consequences

Keep baseline capture independent of the compiler under test. Review normalized fields when changing either fixtures or deployment output.
