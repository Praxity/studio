# 0020: Export bundle boundaries

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- Keep pLimit local to asset resolution to avoid adding dependency-resolution requirements to standalone packages. Governed code: `packages/export-pipeline/src/asset-resolver.ts`, `pLimit`.

- Remove an export temp dir reliably. The previous `fs.remove(dir).catch(()=>{})` silently swallowed transient EBUSY/ENOTEMPTY errors from async file-handle release, leaking `praxity-export-*` dirs into the OS temp dir on every export. Native fs.rm with retries handles the transient case; a persistent failure is logged (not fatal; a leaked temp dir must not fail an otherwise-good export). Governed code: `packages/export-pipeline/src/build.ts`, `removeTempDir`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- LOM headers refer to license.txt; never replace an incomplete prepared set silently. Governed code: `packages/export-pipeline/src/build.ts`, `loadSchemaFiles`.

- Every file a viewer manifest references, relative to the assets directory with forward slashes. Copy and verify through this list so a new asset field (as `resume` was) cannot be missed by one consumer. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `viewerManifestAssetPaths`.

- Copied legal text contributes to prepared runtime notices and their cache key. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `collectSourceFiles`.

- Conservative input inventory, never an entry registry. Include literal data and test-named code too, so moving a bundled input cannot silently retain old assets. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `patternSourceFiles`.

- In the island JavaScript build, treat component CSS imports as empty so they do not keep unrelated block modules alive in the island graph or emit duplicate CSS bundles. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `bundleViewer`.

- Both launch modes use the self-check-classic.ts core. The ESM wrapper statically imports its IIFE bundle. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `bundleViewer`.

- Keep the self-check support closure free of shared chunks retaining unrelated island exports. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `bundleViewer`.

- A new entry in the shared split graph changes existing chunk fingerprints. Keep retrieval independent so courses without sheets retain exact assets. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `bundleViewer`.

- Only SCORM hosts import the shared classic asset. Other hosts and the shell retain normal imports, so their output has no SCORM dependency or guard. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `bundleViewer`.

- Chromium file:// refuses module imports. Keep the same island entries in classic bundles. Governed code: `packages/export-pipeline/src/bundle-viewer.ts`, `bundleViewer`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- HTML compilation must not load the native bundler to discover this asset name. Governed code: `packages/export-pipeline/src/patterns/write-distractors/assets.ts`, `WRITE_DISTRACTORS_STYLESHEET`.

- A nested {type:"module"} file sets module scope, not package ownership. Governed code: `packages/export-pipeline/src/third-party-notices.ts`, `readPackageNotice`.

- Copied presentation needs MIT attribution even without an upstream JS import. Governed code: `packages/export-pipeline/src/third-party-notices.ts`, `collectRuntimeNotices`.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
