# Standalone PDF assets and an external Typst

## Status

Accepted 2026-11-21.

## Context

The standalone npm package needs a separately installed Typst. Changing executable lookup alone would break PDF assets: `exportCoursePdf` in `packages/format-renderers/src/pipelines/course-pdf.ts` reads both `fonts/` and `mitex/` relative to `executablePath`. Official Typst installations do not include Studio's theme fonts or MiTeX files.

This requires a change to the PDF renderer interface beyond the standalone build script and executable lookup.

## Decision

The standalone CLI uses the following boundaries:

1. Give `exportCoursePdf` a PDF asset-directory option separate from `executablePath`. Have `exportProject` pass Studio's packaged asset directory. Preserve existing direct callers' results and test a compiler installed outside that directory, including math and a theme font.
2. Stage fonts, MiTeX and their notices without downloading or shipping the Typst executable. Remove Typst-only inventory entries; retain every notice for files still shipped.
3. Resolve the existing trusted `typstExecutablePath` option first, then `PRAXITY_STUDIO_TYPST`, then PATH. Require Typst 0.15.1 and explain official installation options on failure. Reject Windows `.cmd` and `.bat` shims with instructions to select the real executable: this preserves shell-free execution without parsing third-party scripts.
4. Give `@praxity/studio-cli` the existing `praxity` command, Node `>=24.22.1 <25`, MIT licence, repository metadata and the runtime dependencies needed by an npm tarball. Preserve the canvas and all export assets.

## Consequences

The PDF renderer accepts a separate asset directory. Omitting it preserves existing direct callers' asset lookup beside the compiler. Canvas behaviour is unchanged. Installer behaviour changes: a Rubato pack using this CLI must set `PRAXITY_STUDIO_TYPST` from its own tools directory. Rubato release remains paused until its wrapper supplies that environment variable or legacy installer packaging is retired.

Explicit PDF asset directories must contain `fonts/`; absence is an error. Programmatic export hosts can set `pdfAssetsDir` independently of viewer assets and the compiler.

The npm payload is platform-independent and has no build-platform gate. Inventory `platform` and `arch` remain as legacy archive provenance because `scripts/install-internal-studio.mjs` checks them when admitting an archive. They do not restrict npm installation. Remove those fields when that legacy archive consumer is retired.

Acceptance remains: affected checks; lookup tests for precedence, missing and wrong versions, PATH and Windows shims; and a clean tarball install running `npx praxity --help`, HTML export and PDF export with a digest-verified official Typst 0.15.1 download. PDF evidence must also exercise math and theme fonts so the asset-directory separation is tested.

For the implementation, CI coverage comes from `fast-checks`, `node-checks` and `affected-test` on the PR, with candidate `test` shards and published-output gates. The scheduled or manually dispatched `Standalone CLI proof` workflow builds and exercises the standalone artifact on macOS from `main`; the existing Linux `node-checks` job also packs, installs and exercises the tarball.
