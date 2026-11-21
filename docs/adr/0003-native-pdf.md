# 0003: Native PDF representation

## Status

Accepted. Records existing behaviour.

## Context

Native workbooks preserve authored meaning through Typst, including shaping, headings, alternatives and answer sheets.

## Decision

### `packages/format-renderers/__tests__/course-pdf-native.test.ts`

- `skipIf`: Native checks require the bundled compiler and Poppler. A supplied path must work.
- `toHaveLength`: Poppler 24.02 omits alt text; the exact /Alt assertion in this test reads the PDF itself.

### `packages/format-renderers/__tests__/helpers/pdf-structure.ts`

- `parsePdfStructure`: Poppler's two-space nesting is stable; 24.02 omits the newer inline alt field.
- `parsePdfStructure`: Windows Poppler adds one terminal NUL; keep any authored internal NUL.

### `packages/format-renderers/__tests__/self-check-wrapping.test.ts`

- `mock`: This suite also tests formatting beyond authored admission limits. Keep the real validator everywhere except the explicitly scoped lower-level formatting calls.
- `formattingOnly.mockImplementation.mocked`: Only task/label maxima are bypassed at this test boundary; all actual PDF text, geometry, evidence, identity, and copy checks still use the originals.
- `toContain`: Poppler normalizes no-break spaces and omits word joiners, including on main.
- `toEqual`: Poppler reverses RTL text; compare the Arabic character inventory separately.

### `packages/format-renderers/src/pipelines/course-pdf-assessments.ts`

- `renderPdfAssessment`: Only display fields reach body serializers. Solutions and feedback are rendered separately.
- `renderPdfAssessment.feedbackHtml`: Compare source HTML before rich() allocates unique PDF inline placeholders. The grammar adapter wraps promoted option feedback in a single text paragraph.
- `renderPdfAssessment.explain`: Promotion uses interactive HTML; retain its block so links and definitions survive.
- `renderPdfAssessment.html`: Rich collections, locale overrides and text layout settings keep their own rendering.

### `packages/format-renderers/src/pipelines/course-pdf-content.ts`

- `renderPdfContent`: Static content only; the caller owns inclusion, assets, references, and assessment numbering.
- `renderPdfContent.itemLabel`: Accordion, tab and step labels are headings in the published course; keep them in the outline.
- `renderPdfContent.title`: A block title always travels with the content it introduces.
- `renderPdfContent.svg`: The published static SVG, with theme colours and the body font made concrete for Typst.
- `renderPdfContent.svg`: Outlines only separate light fills from white paper; on dense bar charts they read as noise.
- `renderPdfContent.visual`: Pick the variant whose built-in text size suits the printed width.
- `renderPdfContent.warn`: Without authored alternative text the source data stays in print as the text equivalent.
- `renderPdfContent.length`: Long, narrow source tables sit in two balanced halves, each with its header, when every word still fits the halved columns; otherwise the single table prints.
- `renderPdfContent.columns`: Authored columns stay side by side, in their published proportions; a label stays with its column's content, and comparisons keep a dividing rule.

### `packages/format-renderers/src/pipelines/course-pdf-math.ts`

- `commands`: Reviewed against MiTeX 0.2.7. Unknown commands fail rather than reaching its dimension eval handlers or commands that silently discard authored content.

### `packages/format-renderers/src/pipelines/course-pdf-theme.ts`

- `coursePdfTheme`: Print mapping of the course theme: light-mode tokens on white paper, text roles re-checked for contrast, and only theme fonts that the engine directory supplies.
- `coursePdfTheme.chart`: Concrete values for the published chart SVG, which Typst cannot resolve from CSS variables.
- `coursePdfTheme.tint`: Tints are printed on white, so derive them from the paper-safe accent, not a dark theme surface.
- `coursePdfTheme.leading`: Web line heights are screen-generous; 1.6 maps to Typst's print leading of 0.7em.

### `packages/format-renderers/src/pipelines/course-pdf.ts`

- `CoursePdfLesson.blocks`: Parsed source, with durable IDs and narration sidecars, before display normalization.
- `CoursePdfLesson.selfCheckContents`: Explicit author Content from the grammar accessor, never from reader block data.
- `CoursePdfLesson.writeDistractorsContents`: Explicit native answer-sheet input; generic reader data remains prompt-only.
- `CoursePdfOptions.diagnosticLocale`: Author diagnostic language, independent of the lesson content language.
- `CoursePdfOptions.resolvedAssets`: Keys are authored references, not host paths. Only selected images are consumed.
- `CoursePdfOptions.availableFonts`: Fontsource slugs staged beside the engine; other theme fonts fall back to bundled faces.
- `joiningScript`: Joining scripts and shared tatweel must stay in one shaping run, including with Latin.
- `coursePdfLiteral`: Empty boxes permit line breaks without adding copyable characters.
- `coursePdfLiteral.boundaries`: An evidence span can start inside a cluster, such as at its combining accent.
- `coursePdfLiteral.boundSpace`: UAX 14 keeps a space attached to its opening/closing punctuation.
- `coursePdfLiteral.markRun.measured`: Measure the prepared heading itself, including its show rules and Typst's implicit heading scale. Body runs keep their existing style and output.
- `coursePdfLiteral`: Heading bodies must contain text, not a layout/context node, for PDF/UA. Resolve break decisions outside the heading before wrapping the literal text.
- `dropSourceLists`: Print sets sources as page footnotes, so a source-list placeholder, and a disclosure holding nothing else, is dropped.
- `dropSourceLists.narrated`: Anything carrying an enabled custom script stays, so its narration still prints.
- `narrationPieces.heading`: Script headings are delivery cues, not document structure; keep them out of the outline.
- `narrationPieces`: Never split inside inline emphasis.
- `assertNoHighlightPdf.visit`: Permanent native limitation, independent of temporary runtime publication admission. Scan hidden descendants before rendering or staging any workbook.
- `buildCoursePdfSource`: Pure preparation: referenced assets come only from selected printable content.
- `buildCoursePdfSource.convert.element`: A heading stays a short title; its definition moves to the foot of the page.
- `buildCoursePdfSource.finish`: The appended block, if any, is only the source list; its items print as page footnotes.
- `buildCoursePdfSource.select`: Malformed response records become PDF diagnostics before normalization; the adapter requires identities on actual child records.
- `buildCoursePdfSource.pageNotes`: Narration is collected per page as (paragraph, sentence) units; px-slide places as many beside the slide as fit its height and continues the rest below.
- `buildCoursePdfSource.renderBlockUnsafe.sheet`: Native workbooks consume the sheet’s public authored Content.
- `buildCoursePdfSource.renderBlockUnsafe.authored`: Only explicit native answer sheets read this grammar-owned Content map.
- `buildCoursePdfSource.renderBlockUnsafe.length.authorOptions`: Native answer sheets require the source subset's one option per item.
- `buildCoursePdfSource.renderBlockUnsafe.capacity`: 1.8 em allows margin beyond the widest packaged Latin face, including legacy OpenDyslexic.
- `buildCoursePdfSource.renderBlockUnsafe`: A heading's own stickiness stops at this wrapper, so the wrapper keeps it with what follows. Surrounding paragraph breaks make lone inline text a tagged P rather than a block Span.
- `buildCoursePdfSource.flushPage.parts`: Text runs keep a readable measure; figures, tables and code take the full width. A run ending in a heading stays with the figure after it.
- `buildCoursePdfSource.flushPage.wrapUnits`: Authored wrap: a small or medium floated image sits at its side with following blocks beside it. Large floats stack, as the published page does at this width. Wrapped text splits into paragraphs and list items so it can continue below the image mid-block, as it does on the page. Consecutive items regroup into one list in Typst.
- `buildCoursePdfSource.flushPage.first`: Navigation labels are not visible titles; show one only where no heading opens the slide.
- `buildCoursePdfSource.answerSections`: Retrieval subsections follow all ordinary answers, so later Q answers never inherit a sheet's heading scope. Preserve ordinary-only appendix bytes.
- `buildCoursePdfSource.typstSource.join.filter`: Running header and folio repeat on every sheet; Typst tags them as pagination artifacts.
- `exportCoursePdf`: Host-neutral: no project loader, Electron, viewer build, network or destination writes.

### `packages/format-renderers/src/pipelines/typst-native-compiler.ts`

- `CompileOptions.temporaryRoot`: Host-owned parent for recoverable private compiler workspaces.
- `compileTypstNative`: Native-only entry keeps the optional legacy WASM compiler out of host bundles.
- `compileInWorkspace.env`: The explicit engine must not inherit host Typst, font or package settings.

### `packages/format-renderers/src/renderers/typst/common.ts`

- `TypstHtmlOptions.element`: Return undefined to use the shared semantic HTML mapping.
- `safeTypstLink`: Only external web/email links. Unsafe targets retain their visible content.
- `trimLayout`: Trim layout whitespace without removing intentional no-break spaces.
- `renderTypstNode.signed`: Typst item numbers cannot be negative; retain HTML labels via its numbering function.

### `packages/format-renderers/src/renderers/typst/escaping.ts`

- `escapeTypst`: Escape authored text, never generated Typst markup.
- `typstString`: A complete Typst string literal, for function arguments rather than content.

### `packages/format-renderers/vitest.config.ts`

- `bundledTypst`: Native PDF tests compile with the Typst that ships in the app. It exists after `pnpm --filter @praxity/desktop prepare:typst`, which `dev` and `build` also run.
- `test.testTimeout`: Real Typst compiles take a few seconds each, longer on a loaded machine.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the regression cases in `packages/format-renderers/__tests__/`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
