# Pixel equivalence gate

Run the trusted gate **from the base checkout**, with Node/pnpm versions from
`package.json` and frozen dependencies installed in both checkouts. The running
script's realpath must equal `--base/scripts/equivalence/pixel-gate.mjs`;
nested candidate checkouts do not qualify. Imported gate modules must resolve
to the exact files beside that entry point; module symlinks are refused.
Install its pinned Playwright Chromium if needed
(`pnpm --filter @praxity/export-pipeline exec playwright install chromium`).
Use the directory containing `course.yaml` (the sample repository's leadership
input is `leadership/course/`). F1's pinned-input verifier is separate.

```sh
cd "$BASE_STUDIO"
node scripts/equivalence/pixel-gate.mjs \
  --base "$BASE_STUDIO" --candidate "$CANDIDATE_STUDIO" \
  --course "$LEADERSHIP_COURSE" --course "$TOOLKIT_COURSE" \
  --out "$SCRATCH/new-run"
```

Both commit IDs and dirty status are printed. Fetch `origin/main` first. A dirty
base (including gate edits) refuses unless `--allow-dirty-base` explicitly
acknowledges it. Provenance records `originMain`, `baseIsOriginMain` and
`baseIsAncestor`; the base must be an ancestor of the candidate except in
`--control` mode. A historical main base is allowed and identified in the ledger.
Identical realpaths, or identical
commits with clean trees, refuse unless `--control` is explicit. For a clean
control, use two clean checkouts at the candidate commit with `--control` and
repeat with a fresh output directory. Each side still prepares and builds
independently. `provenance.json` records commits, status, SHA-256 of the binary
uncommitted diff and of the path/content hashes of untracked files.

Candidate committed differences from the base commit, working-tree differences
from HEAD, and untracked files under `scripts/equivalence/` or its unit test
refuse. To evaluate an intentional tooling change, first review it, then pass
`--allow-gate-change`; the gate prints and records the diff summary. This flag
does not change which checkout supplies the running gate. When bootstrapping
this gate onto an older main without the tooling, install the reviewed tooling
into the trusted base first, review it, pass `--allow-dirty-base`, and retain
that dirty base in the evidence. After this tooling is accepted, ordinary refactors need no such bootstrap.

The output directory must be new and outside the checkouts and inputs. Both
checkouts must have the same lockfile. The gate prepares each checkout's viewer
and export assets in scratch using the production preparation owners, then calls
that checkout's real `exportProject` HTML export path. Accessibility enforcement
and strict saved identity reads stay enabled. Workspace settings inheritance is
disabled so both copies use only their captured course settings. Inputs are
copied once, then separately for each build; original courses are never written.
Exports, ZIPs, logs, captures, inventories and results stay under `--out`.

Cache audit of the export path:

- `image-result-cache.ts`: every prepare/export process gets its own new empty
  HOME, XDG cache/config/data directories, LOCALAPPDATA, APPDATA, USERPROFILE and
  temporary directory (`TMPDIR`, `TMP`, `TEMP`). Base image results cannot warm
  the candidate's cache, even without an encoder-version bump. Environments are
  retained beside each build log and cannot be reused.
- `bundle-viewer.ts` / `export-assets.ts`: each side bundles directly from its
  source into separate fresh scratch assets. The desktop export receives these
  assets explicitly; the source-mode `viewer-cache.ts` / checkout `prebuilt/`
  fallback is not used by this path.
- `shared-blocks` and `grammar` package exports resolve to TypeScript source,
  with no disk compilation cache in that path. Their maps, sanitizer memo,
  preparation caches and codec promises are process-local; each build starts a
  fresh process. Project-local caches are confined to separate scratch copies.
- tsx disk caching is disabled (`TSX_DISABLE_CACHE=1`); Node compile caching is
  disabled (`NODE_DISABLE_COMPILE_CACHE=1`, inherited NODE_COMPILE_CACHE removed).
  Builds use Node’s tsx import hook, avoiding CLI IPC sockets in long scratch paths.
  esbuild builds a new bundle per side; it has no persistent incremental context.

Every emitted HTML document (including utilities and redirects) and every
logical module slide is inventoried independently on both sides. Document views
use ordinary learner navigation; slide views use publisher inspection mode.
The latter does not establish learner gate behavior. Final redirect targets,
normalised to the served output root, must match as well as pixels.

Capture uses the base checkout's pinned headless Chromium for both sides, one
loopback origin, initial 1280×900 viewport, scale 1, light scheme, reduced motion,
en-US, UTC, fixed date and authored shuffle seed `0x1234abcd`. Each view gets a
fresh context with empty storage. After navigation and every viewport/scroll
change, a request/requestfinished/requestfailed tracker requires zero in-flight
requests for a fresh 500 ms (30 s timeout, failing closed). This covers requests
after initial load, including resize-triggered background images, posters,
iframes and script fetches. Capture also waits for each rendered island root's
existing
`data-hydrated` runtime marker, fonts, images and narration duration verification.
Lazy islands are brought into viewport proximity with node references retained
to restore the runtime's natural scroll positions afterward.
Roots on inactive/hidden slides are checked when their own slide is captured.
Media is paused and muted.

Before any expansion, capture records every initial scroller's position and a
viewport-only 1280×900 PNG in the natural scroll state. Both must match; sticky
layout and changed runtime starting offsets cannot hide in the expanded layout.
A full-page PNG alone misses nested scrollports. Capture audits all visible
scrollable containers, expands viewport height by their vertical overflow and
re-settles until none remain. PNGs therefore retain width 1280 but can exceed
height 900. The ledger records initial/intermediate/final viewport and scroll
region dimensions. Horizontal overflow or vertical overflow still present after
10 expansions (or requiring height over 20,000) fails closed. No content or
pixels are masked. This covers the natural initial viewport plus expanded
layouts, not every intermediate scroll position at the original viewport height.
**Hidden-clipping limit (R2-P3c):** focusable content outside an overflow
hidden/clip ancestor is recorded in `clippedFocusables` and
`finalClippedFocusables` as a diagnostic, not a gate failure. The real leadership
slide `5d05b891-eb3a-416c-8a94-da04be56c915` has two legitimate skip links at
y=-900 in the natural viewport and y=-1744 after expansion; focusing the first
reveals it at y=0 with height 45.4375. A blanket static refusal would reject clean
courses. Evidence: PR #1633 round 3 handoff, `clipping-real.json`,
`clipping-natural.png` and `clipping-skip-focused.png`. Consequently, two links
with different text hidden by overflow can still compare equal visually. A
keyboard/nonvisual gate must cover that case. The diagnostic excludes inert,
disabled and negative-tabindex elements; ordinary auto/scroll containers are
handled by expansion. No pixels or content are masked.

External requests, console/page errors, HTTP/network errors, broken images and
incomplete captures fail. An aborted media preload is accepted only when a
request for that exact URL completed in the same view. Unfinished media URLs
are independently fetched to completion in-page; HTTP/body-load errors fail.
Cancellation, completion and verification URLs are recorded. An active macOS VoiceOver process refuses the run.

All RGBA channels must match exactly, with zero pixel or dimension tolerance.
Missing/extra views fail even when both sides have the same error. Exit 0 means
the whole run passed; failures exit nonzero. One line is printed per failing
view. Top-level `results.json` records counts/timings; each course's
`diff/results.json` records comparisons and difference PNGs (changed pixels pink).

For capture-only reproduction or a planted change in a scratch build (this mode
does not build or certify source-checkout equivalence). Identical HTML realpaths,
including symlink aliases, require `--control`:

```sh
node scripts/equivalence/pixel-gate.mjs --base "$BASE_STUDIO" \
  --base-html "$BASE_HTML" --candidate-html "$PATCHED_HTML" \
  --out "$SCRATCH/new-capture"
```

To repeat comparison, including altered PNGs or capture inventories:

```sh
node scripts/equivalence/compare.mjs \
  --base "$BASE_CAPTURE" --candidate "$CANDIDATE_CAPTURE" --out "$SCRATCH/diffs"
node --test scripts/equivalence.test.mjs
```

The fast tests run in the normal root Node suite. PNG decoding/encoding uses the
locked `@jsquash/png`; no dependencies added. Coverage is initial visual output
at width 1280, light scheme and reduced motion only. Screenshot animations are
disabled, so infinite-animation changes can be hidden. Dark scheme, other
widths, animation behavior, interactions, nonvisual output, print, security and
accessibility require their own gates.

## Nonvisual equivalence

The sibling command requires the exact realpath `scripts/equivalence/nonvisual-gate.mjs`
in the trusted base, including when invoked through a symlink. It shares the trusted-base guard, checkout provenance, source
preparation adapter and fresh process/cache environments above. Install frozen
dependencies in both checkouts. F1's `inputs.json` and `verify-inputs.mjs` must
exist in the trusted base. Specify each manifest key and its original Git course
directory. Every manifest course is mandatory; a deliberate partial proof requires
`--subset`. The selected names and subset status are printed and recorded. Both original checkouts are verified before building, then every pinned
byte in each scratch copy is verified again. Source clones are read-only.

```sh
node scripts/equivalence/nonvisual-gate.mjs \
  --base "$BASE_STUDIO" --candidate "$CANDIDATE_STUDIO" \
  --course "leadership=$LEADERSHIP_COURSE" --course "toolkit=$TOOLKIT_COURSE" \
  --typst "$PINNED_TYPST_DIR/typst" --pdf-tools "$POPPLER_BIN" \
  --out "$SCRATCH/new-nonvisual-run"
node --test scripts/equivalence-nonvisual.test.mjs
```

For a control use current main for both sides and add `--control`. When
bootstrapping before F2/F3 merge, copy the reviewed gate files into the trusted
main checkout, review it, and pass `--allow-dirty-base` to acknowledge its
recorded dirty provenance. `--allow-gate-change` separately acknowledges edits in
the candidate's gate files. Run that trusted main copy, never candidate tooling.
The same-code refusal, clean-base default, ancestor requirement and
candidate-tooling guard apply here, including the nonvisual root test. The shared
guard binds this sibling to the exact nonvisual entry and checks the realpaths
of its complete trusted module closure; the pixel entry keeps its original
closure and remains the default. All stages, exports and PDF extraction run sequentially;
each child process has a ten-minute hard deadline. Expiration kills the child
process group and fails its categories. No browser runs in this command.

The eleven required JSON results per course are `pages`, `nav`, `narration`,
`runtime`, `fragments`, `playlist`, `html`, `scorm-1.2`, `scorm-2004`, `pdf-source`
and `pdf`. Top-level `results.json` lists their outcomes, counts, first literal
differences and wall time. Side-specific logs, stage dumps, exports and extraction
results are retained. Missing output, an import failure, an empty inventory or a
tooling error fails; no category can pass by skipping. Stage preparation failure
fails every dependent stage category, while the export categories still run.

Production entry points are loaded from **each selected checkout's own source**:

- `build-export-input-from-project.ts::buildCourseExportInput` and
  `preview/course-context.ts::createCourseContext` supply the admitted pages with
  lesson/page/block IDs, types, titles, order, locales and metadata. Completion
  settings use the existing `project-config.ts::resolveCompletionSettings` owner
  and each checkout's default export configuration, as real exports do.
- `preview/compile-page.ts::preparePageCompiler` supplies slug lists/maps, deck
  grouping and effective `outputPlans` using production's prepared inputs.
  `runtime-plan.ts::resolvePageNavigation` supplies navigation. `diagnosticPages`
  and `diagnosticModules` are additional localisation probes with all islands
  available and config page order; they are not production runtime plans.
  Utility
  documents, glossary and resource facts are captured too.
- Host-resolved V2 segments (including revision/stale status) and warnings are
  captured from production's host-prepared pages. `diagnosticResolutions` is a
  localisation aid from `readNarrationSidecar` / `resolveNarrationV2`, using
  regrouped pages without componentDefaults and page-level enablement/defaults.
  It is not the host's `resolveLessonNarration` result or a claim about its inputs.
  The playlist category reads the emitted HTML's inert config, including deck
  pages, so it compares the playlist the output actually uses.
- `preview/compile-page.ts::compilePage` supplies ordered `HtmlFragment[]` and
  explicit fragment IDs/order for every page, including exact markup.
- The real `export-project.ts::exportProject` produces all three packages and
  native PDF with strict identity and accessibility enforcement. PDF source uses
  `course-pdf.ts::buildCoursePdfSource` with the host's prepared lessons and
  `resolve-pdf-assets.ts::resolvePdfAssets`, and the same staged fonts. The
  `pdf-source` dump also records `[ref, length, sha256]` for every resolved asset.

Both checkouts require a `node_modules` realpath beneath their own root. A
trusted Node resolve hook checks every loaded `apps/` or `packages/` source path
against that checkout before execution, including escaped workspace symlinks;
the adapter also audits `require.cache` after loading. Preparation uses the same
hook. A shared node_modules tree or workspace source outside its side refuses.

A later slice moving any entry must keep these import paths/exports working,
using a compatibility export if necessary; otherwise the gate fails loudly,
naming the missing owner/entry. This is a fixed observational adapter, not a
second compiler or stage registry. It does not change learner behavior.

Package comparison parses central/local ZIP headers, checks every payload file's
name, length and SHA-256, and also compares the whole ZIP after zeroing **only**
the four DOS time/date bytes at local header offsets 10–13 and central header
12–15. Payloads, comments, compression and all other ZIP bytes remain literal.
No file is ignored. Fingerprint names must match exactly; the gate currently
accepts no filename aliases, even when a manifest could declare one. It never
infers a mapping by stripping hashes. Any future alias support must be backed by
the manifest's declared mapping and preserve payload comparison.

PDF requires the pinned Typst 0.15.1 bundle (fonts and MiTeX beside the executable)
and Poppler 24.02 tools. Provision with the repository's
`apps/desktop/scripts/prepare-typst.mjs --output "$PINNED_TYPST_DIR"`.
`pdftotext -enc UTF-8 file.pdf -` preserves extraction order;
`pdfinfo -struct-text file.pdf` supplies structure and tagged text as a
localisation aid; Poppler does not expose every `/Alt`, `/ActualText`, `/Lang`
or link URI. These extraction outputs compare literally, without whitespace
normalization. The entire native PDF also compares byte for byte after replacing
only observed volatile metadata values with same-length placeholders. The parser
follows the classic xref, trailer `/Info`, catalog `/Metadata` and uncompressed
XMP stream. Unsupported layouts fail closed. It preserves file length, xref
positions, stream lengths, content, image bytes and all nonvolatile fields.

The four normalized XMP values are `xmp:CreateDate`, `xmp:ModifyDate`,
`xmpMM:DocumentID` and `xmpMM:InstanceID`; the corresponding Info `/CreationDate`
and `/ModDate` values and trailer `/ID` pair also normalize. The trailer IDs must
match their XMP values. No content-stream dates or IDs normalize. XMP extraction
is additionally compared with only those four named values replaced. Tool
versions are checked and binary hashes recorded. Extraction stderr is retained
and compared separately; a warning cannot stand in for a missing text/tree
result. No PDF text, tag, alt value, ordering or source diagnostic is normalized.
Missing Typst, fonts, Poppler, failed extraction or an empty text/tree result
blocks and fails the PDF category; native-test skip conventions do not apply.
This compares native PDF content, not spoken AT behavior.

The native `fixtures/figure.pdf` regression was compiled from the adjacent Typst
and SVG with the pinned toolchain; `figure.structure.txt` is actual Poppler 24.02
output and omits its `/Alt`. The byte regression changes that native alt value
while retaining the identical extraction, and must fail.
