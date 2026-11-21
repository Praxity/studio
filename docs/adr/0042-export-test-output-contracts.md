# 0042: Export test output contracts

## Status

Accepted. Records existing test constraints; no executable change.

## Context

Export tests include platform observations, fixture admission rules and measured allowances that are not apparent from their assertions. The records below preserve that context when code comments are removed. Platform observations describe the harness versions recorded by the tests; they are not new compatibility claims.

## Decision

### packages/export-pipeline/src/__tests__/block-state-privacy.test.ts

- `highlightHostFormats`: Pre-publication proof: real renderer/enhancer, course host and reporting adapters. Never weaken publication admission to exercise a learner activity.
- `highlightHostFormats`: A future host, including cmi5, must add a privacy proof before this typecheck passes.

### packages/export-pipeline/src/__tests__/build-desktop-mode.test.ts

- `holds the 4.5:1 text floor for a palette that starts below it`: The unit tests in export-contrast.test.ts prove the helper corrects each role. This proves every emission path actually runs through it: a real build with a palette an author could plausibly pick, where every text role starts below the floor. Author-supplied brand colours reaching output unvalidated was the P1 in the 2026-07-28 audit.

### packages/export-pipeline/src/__tests__/choice-baseline.test.ts

- `$name: description $block.data.description.0.data.content`: Literal output captured before extraction. Preserve the entire baseline, including wrappers, whitespace, disabled inputs, localized notices and identity fallbacks.

### packages/export-pipeline/src/__tests__/forced-palette-coverage.test.ts

- `unassertedBranches`: Only statements executed on the branch count: a callback, nested condition or unawaited promise cannot stand in for an assertion of the no-palette rendering.
- `asserted`: expectFocusRing's normal-palette path owns the >=3:1 floor. A literal true third argument selects forced-palette behavior instead.
- `PALETTE_INDEPENDENT_SPECS`: These journeys assert the same semantics, geometry or visible indicator in both palettes. New emulating specs require a palette branch unless reviewed here.
- `emulatesForcedColors`: Include named/indirect media objects conservatively, not only inline options.
- `unexpectedForcedColors`: One explicit exception: this observer query invalidates marker geometry. It never reads matches or chooses palette-specific rendering. Remove only that one literal, so any additional reference still fails ownership.
- `unexpectedForcedColors`: Join adjacent quoted fragments to catch the reviewed split-literal query.
- `inputs`: bundle-viewer.test.ts checks this inventory against every bundle's metafile.

### packages/export-pipeline/src/__tests__/html-gen.test.ts

- `compiles the %s Pages resume cue from the shared template`: The prefix ends with a non-breaking space so NVDA keeps the gap before the title.
- `compiles the %s Pages resume cue from the shared template`: French also keeps the colon on the same line with a non-breaking space.
- `forwards the query string and hash like the page-N shims do`: index.html is the SCORM launch file and the review-share entry point, so it carries ?embed=1, ?minimal=1 and review tokens that the viewer reads. A bare meta-refresh dropped them, while the page-N shims already preserved them.
- `config`: With interactive shell controls disabled, the static page links are the navigation and must stay visible without an island.
- `emits theme vars into course CSS`: The selector also carries Mantine's own, so the token aliases we set there are not outranked by Mantine's defaults.
- `cases`: The exporter used to reverse-infer the layout from individual nav toggles. That inference could not express `minimal` (its preset turns off outline, prev/next and edge arrows, so the `none` branch claimed it) or `embedded` (absent from the chain), and it downgraded a course to `sidebar` whenever an author adjusted a toggle — including a brand-new project, which scaffolds as `slides`. Pin every archetype to its own class.
- `html`: The slides preset's toggle combination previously *was* the only way to reach praxity-layout-slides; toggles must no longer override the choice.
- `html`: `none` means no navigation chrome. The fallback IS the navigation on static pages, so leaving it in shipped a full page list on every text-only page of a course that asked for none.
- `config`: The author's own heading block carries the title; a hidden duplicate would make assistive tech announce it twice.

### packages/export-pipeline/src/__tests__/learning-patterns-admission.test.ts

- `beforeAll`: One real build for this file. Copied policy/source and links to read-only dependencies prevent the planted manifest omission from touching other builds.

### packages/export-pipeline/src/__tests__/module-deck-runtime.test.ts

- `controls`: WebKit focuses the enclosing controls landmark when a More button is pressed.

### packages/export-pipeline/src/__tests__/new-tab-links.test.ts

- `fixtureBlocks`: G4 inline Markdown has no new-tab option. Rich model fields retain their existing sanitizer policy; generated button targets exercise each container.

### packages/export-pipeline/src/__tests__/pilot-pattern-renderers.test.ts

- `$name: source $block.data.sourceUrl, locale $options.sourceLocale`: Literal pre-extraction output, including wrapper whitespace, focus markers, sanitization, locale precedence and the existing note/heading domain rules.

### packages/export-pipeline/src/__tests__/published-markup.test.ts

- `keeps media and href JSON policies distinct: %s`: Browsers drop leading C0 controls and inner tabs and newlines before reading the scheme.
- `keeps media and href JSON policies distinct: %s`: Entities are not decoded: "&" cannot appear in a scheme, so these stay relative URLs.

### packages/export-pipeline/src/__tests__/render-block-html.test.ts

- `renders an ordered list of named turns with decorative avatars`: WebKit + VoiceOver read alt="" images inside a figure by file name without it.
- `static assessment shell`: This markup is the pre-hydration shell: the React viewer owns answering, submitting, feedback and scoring. Shipped with live inputs it was a form a learner could fill in that could never be submitted — no submit control, no feedback, answers gone at the next page.
- `media blocks and the heading outline`: A media block used to append `<h3 class="praxity-sr-only">Continue after video</h3>`. It put a phantom section in the heading outline with nothing under it — on a page whose first real section was an h2, a screen-reader user browsing by heading hit an h3 between the page title and the first section. The block is already a labelled region, which is what AT navigates past, and the string was hardcoded English with no French entry. The existing accessibility decision rejects a mandatory following heading: WCAG 2.4.1 requires a way to bypass repeated blocks and does not prescribe this technique.
- `hides decorative images from assistive technology`: WebKit + VoiceOver read alt="" images inside a figure by file name.

### packages/export-pipeline/src/__tests__/retrieval-sheet-assets.test.ts

- `runtimePlan`: The sheet stylesheet must arrive before shared and author styles.
- `keeps the full sheet island below the 10 KiB lightweight allowance`: The independent R04 bundle keeps other pages out of this closure.

### packages/export-pipeline/src/__tests__/retrieval-sheet-controls.test.ts

- `rejects unsanitized date %s at the input interface`: jsdom erases these native date values. Expose the raw field value to the real event handler.
- `fixed`: A fixed 168-hour interval lands on the wrong local date at these transition boundaries.

### packages/export-pipeline/src/__tests__/retrieval-sheet-print.test.ts

- `clean`: jsdom queues zero-delay focus bookkeeping independently of the print owner.

### packages/export-pipeline/src/__tests__/untrusted-course-text.test.ts

- `renderPage`: Course text can come from imported material or an agent, and SCORM content may run on the LMS origin, so learner pages must never carry a URL that runs script or markup from text.
- `hidden renderers that take block data`: Grammar 4 produces neither block nor the resources page, but imported block data can.

### packages/export-pipeline/src/__tests__/viewer-css-contract.test.ts

- `ungatedForcedColors`: Capture only: returning the AST round-trips unsupported at-rule shapes. Omit targets so nesting and grouping-rule children remain intact.
- `reserves activity borders for controls and decorative borders for dividers`: The matching connector is gone: adjacency in the grid is the pairing, and a 24px dash spanning nothing read as an artifact.

### packages/export-pipeline/tests/build.test.ts

- `isolatedBase`: Isolate this test's temp dirs from concurrent test files by pointing os.tmpdir() (which reads TMPDIR/TMP each call) at a private base. Vitest isolates files into workers and runs a file's tests sequentially, so swapping TMPDIR here cannot race other tests.
- `keys`: Save originals so we can RESTORE exactly — including deleting keys that were unset. Assigning `undefined` stringifies to "undefined" and would poison os.tmpdir() for later tests (Linux CI leaves TMPDIR unset).

### packages/export-pipeline/tests/choice-icon-names.test.ts

- `'${producer} compiles and exports mixed raw and compiler icons with exact main learner bytes'`: Pinned from the display owners at the recorded main revision, with no signature call.

### packages/export-pipeline/tests/compiled-choice-bytes.test.ts

- `expected`: Regenerate by capturing every slug from this exact fixture through prepareHtmlCourse/renderHtmlDocument, then stripChoiceStateFacts and SHA-256. Compare raw old/new documents before accepting a new hash or UTF-8 byte count. Change baseBytes/baseHash only for reviewed markup changes; the facts-only delta must remain independently checked. Do not copy failure output blindly. Verify: pnpm --filter @praxity/export-pipeline exec vitest run tests/compiled-choice-bytes.test.ts --maxWorkers=1 Each fact now retains the visible term label in "Pick one". `escapeJsonForScript` writes `<`, `>` and `&` as `\u003c`, `\u003e` and `\u0026`, adding five bytes per escaped character: the facts carry 36 such characters on practice and second, 52 on resources and none on glossary.
- `records exact per-document additions against main`: Pinned from main before adding facts. Every other learner/config byte stays exact.

### packages/export-pipeline/tests/compiled-choice-facts.test.ts

- `html`: Regenerate from this test file's `course()` and `render()`, then apply `stripChoiceStateFacts` and SHA-256. Capture raw old/new documents and review every byte difference before updating this literal. Keep the existing normalization; do not add exclusions for drift. Verify: pnpm --filter @praxity/export-pipeline exec vitest run tests/compiled-choice-facts.test.ts --maxWorkers=1

### packages/export-pipeline/tests/course-outcome-writes.test.ts

- `%s Finish caller authority`: Generated on main before restoring the refactor. Calls and return values share one log.

### packages/export-pipeline/tests/fixtures/choice-facts.ts

- `stripChoiceStateFacts`: Normalize only the three authorized inert fields for frozen document comparisons.

### packages/export-pipeline/tests/fixtures/inline-island.ts

- `inlineIslandImports`: Preserve both named and side-effect imports when an esbuild island runs on about:blank.

### packages/export-pipeline/tests/fixtures/load-grammar-fixture.ts

- `ensureDesktopExportAssets`: The desktop prebuild command, run through Node: Windows has no pnpm executable to spawn.
- `legacy`: Stemless assessments remain a supported stored model. G4 authored hotspots require a question, so retain the publisher fallback case at its interface.

### packages/export-pipeline/tests/fixtures/review-page-layout.ts

- `reviewPageLayout`: JSDOM has no layout. Keep concealment and contents behavior at the browser seam.

### packages/export-pipeline/tests/fixtures/self-check-release.ts

- `releaseExpected`: Literal release expectations, independent of renderer and library output.

### packages/export-pipeline/tests/fixtures/silent-audio.ts

- `silentWav`: Local PCM silence for playback-state checks. Keep short clips for natural-end checks.

### packages/export-pipeline/tests/fixtures/staged-answer-output.ts

- `stagedAnswerOutputInvariant`: Both staged-answer patterns share byte scanning and exact per-activity allowances. Their builders and positive controls stay with each pattern's contract tests.
- `start`: Only the compressed payload is owned. Names, extras, comments and trailing bytes still scan.
- `assertOutput`: Never let another decode complete a truncated marker at either boundary.
- `assertOutput`: A digest/URL prefix can be part of the same token. Four offsets cover every base64 alignment without joining independent strings.
- `normalizePdfOutput`: Decode PDF metadata/outline/ActualText channels as well as compressed streams. Glyph-mapped content still needs pdftotext; neither view substitutes for the other.
- `endOfDictionary`: DecodeParms can follow Filter, so the nearest opener may belong to a nested dictionary.

### packages/export-pipeline/tests/focus-assertions.ts

- `expectFocusRing`: A user-selected forced palette controls contrast; honor its system colors.
- `expectFocusRing`: WebKit emulates the media query without replacing authored colors.

### packages/export-pipeline/tests/learning-patterns-notices.test.ts

- `emits the pinned learning-patterns MIT text and version through the viewer notice collector`: SHA-256 of the upstream LICENSE at the reviewed pin, independent of collector output.

### packages/export-pipeline/tests/published-output/authoring-catalog.test.ts

- `rect and polygon hotspots keep their bounds and names in inert static HTML`: Hydration replaces these nodes, so a focusable fallback would drop the learner's focus.

### packages/export-pipeline/tests/published-output/setup.ts

- `PUBLISHED_FIXTURE_PATH`: Deterministic path for the pre-built fixture zip. Written by vitest.global-setup.ts, read by each worker.
- `getBuild`: Load the pre-built comprehensive grammar fixture from disk. The globalSetup writes the zip once; each Vitest worker reads it. Falls back to building in-process if the cached file is missing.
- `{ loadGrammarFixture, loadAuthoringCatalogFixture }`: Fallback: build in-process (slower, but works if globalSetup didn't run)

### packages/export-pipeline/tests/review-anchors.test.ts

- `open`: JSDOM has no layout hit testing; individual occlusion cases supply their own hit.
- `fill`: CSS color-mix(in srgb, …, transparent) composites encoded sRGB channels; the theme's compositeOver helper deliberately mixes linear RGB instead.

### packages/export-pipeline/tests/review-composer.test.ts

- `open`: JSDOM has no SubtleCrypto. Keep native SHA-256 behind that platform seam.
- `collisionIds`: Golden SHA-256 UUID chain for [candidate, "Kept text", collisionAnchor].

### packages/export-pipeline/tests/review-threads.test.ts

- `open`: Native `Response` bodies need an event-loop turn before they can be read; draining microtasks alone does not settle them.

### packages/export-pipeline/tests/tracking.test.ts

- `compares the score with the pass mark as the manifest rounds it`: 66.666...% is below the 66.67% the manifest declares.

### packages/export-pipeline/tests/update-page-compiler-baseline.test.ts

- `records every P2 baseline hash from full build output`: Images exercise build-added hints in HTML and deck JSON; documents include index and numbered redirects that compileDocument alone does not emit. The serialized media action key is `mediaOpen`.
- `omits the three inert choice fact fields from recorded document hashes`: Frozen renderer fixture bytes, including the question/group configuration apart from the same three fields excluded by the page-compiler guard.

### packages/export-pipeline/tests/write-distractors-output-invariant.test.ts

- `placement`: Cards share one root. Remove sibling activities so a front refusal cannot accidentally stand in for proof that the back also refuses publication.
- `lessonInputs`: The web fixture also exercises an emoji unsupported by bundled PDF fonts. Native publication uses the same marked fields with supported font characters.

Sources: the comments and corresponding implementations in the named files at Studio commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. Explicit spec sections, issue numbers, capture revisions and owner dates above retain the original evidence references.

## Consequences

Preserve these constraints when changing the named fixtures or measurements. Recheck a recorded platform limitation before replacing its harness path. Deferred coverage and size work remain separate changes; this record does not waive their checks.
