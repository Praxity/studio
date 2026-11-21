# 0002: Content model display boundaries

## Status

Accepted. Records existing behaviour.

## Context

Authored values, rendered HTML, answer keys and durable identities have different consumers.

## Decision

### `packages/content-model/src/assessment-feedback.ts`

- `assessmentFeedbackText`: Result-specific text wins over option feedback, then generic question text. Legacy feedback timing values are settings, not learner prose.

### `packages/content-model/src/assessment-grading.ts`

- `assessmentGroupRequirements`: Group completion and score requirements retain their distinct fallback sets.
- `resolveAssessmentDontKnow`: Resolve renderer metadata without replacing the author's optional setting.
- `resolveAssessmentDontKnow.source`: Source narration keeps its original block types and target roles.

### `packages/content-model/src/constants.ts`

- `ASSET_FIELDS`: Keep the asset-field list shared by publication, export and preview. Adding separate field lists would let asset rewriting drift between those outputs.
- `escapeHtml`: Escape text for HTML text content and double-quoted attributes. This is the only HTML escaper: published pages, the grammar and shared blocks all import it, so one fix reaches every output.
- `escapeJsonForScript`: Escape JSON for a `<script type="application/json">` element. The HTML tokenizer reads script content as raw text, where `</script` ends the element early and `<!--` followed by `<script` enters the "script data double escaped" state, in which `</script>` no longer ends it and the rest of the page is swallowed. Writing `<` as a JSON string escape keeps `JSON.parse` output unchanged; `>` and `&` are escaped too, following the usual JSON-in-HTML convention.

### `packages/content-model/src/escaping.ts`

- `LEGACY_RESERVED`: ASCII punctuation is the grammar policy. Unknown escapes remain literal.
- `findUnescaped`: Find syntax before decoding so literal delimiters never become syntax.

### `packages/content-model/src/fill-blank.ts`

- `fillBlankParts`: Keep source markers separate from literal text, including escaped braces and underscores.
- `parseFillBlankContent`: Dropdown markers use * for correct choices; typed blanks keep their original alternatives.
- `validFillBlankSelections`: Checks partial selections as well as complete attempts, including bank occurrence counts.

### `packages/content-model/src/inline-fields.ts`

- `InlineField`: Compiler trees are bound to the exact display field they describe.
- `rebindInlineFields`: A display transform may carry provenance forward only from matching input.

### `packages/content-model/src/inline-footnotes.ts`

- `parseMaterialFootnote`: Material recognition only. The two learner parsers keep their existing contracts.

### `packages/content-model/src/inline-icons.ts`

- `inlineIconPlaceholder`: HTML placeholder kept in parsed content until the export catalog is available.
- `replaceInlineIconMarkup`: Replace trusted icon placeholders or generated SVGs without accepting arbitrary markup. The callback owns the final output and can return a text fallback.
- `renderInlineIcons`: Rebuild only validated, build-embedded markers after HTML sanitization.

### `packages/content-model/src/inline-markdown.ts`

- `InlineMarkdownOptions.emphasisOnly`: Restrict narration to visual bold/italic; leave cues and other syntax literal.
- `parseInlineMarkdown`: Display-field semantics, including legacy escapes and unresolved forms.

### `packages/content-model/src/inline-preparation.ts`

- `isInlineHtml`: Legacy block data can already contain rich HTML. Sanitize at the render sink.
- `getInlineField`: Display HTML only. Never use this result as an answer value or accessible name.
- `prepareInlineBlocks`: Prepare display fields before collectors and runtime planning inspect them. Raw labels and answer values stay intact; render-only HTML lives beside them. Existing content/stem child blocks already hold HTML from the grammar parser.
- `prepareInlineBlocks.visit`: Matching/categorization values also serve as answer keys. Keep them raw.

### `packages/content-model/src/inline-tree.ts`

- `InlineRange`: Half-open UTF-16 offsets in the original lesson, including raw escape spelling.
- `InlineReferenceTrivia.referenceTrivia`: Ancillary separator whitespace in neighbouring text. Raw spans stay lossless.
- `InlineTerm.definition`: Empty means a mention whose definition belongs to the course glossary.
- `InlineTree.envelope`: Compiler-created paragraph; authored HTML never acquires this ownership.
- `inlineMaterial`: Signature facts come from compiler kinds, without rendering another HTML tree.
- `ownInlineTrivia`: Classify a whole ancillary run before assigning any gap, across bold/italic only.
- `ownInlineTrivia.sequence.flatten`: Nested annotations keep local trivia; the parent stays one ancillary boundary.
- `ownInlineTrivia.sequence.retained`: Between material siblings the last existing gap remains a word separator.
- `inlineParagraph`: Mark the generated paragraph while its source constructs are still available.
- `InlineTreeRenderOptions.resolveTerm`: The semantic schema supplies course definitions; this renderer never builds a glossary.
- `renderInlineTree`: Render parsed semantics without scanning source. Sanitize at the existing HTML sink.

### `packages/content-model/src/narration-display.ts`

- `SONIOX_HUMAN_SOUND_TAGS`: Human sounds convey audible information and belong in accessible transcripts/captions.
- `narrationDisplayText`: Learner text only. Keep the authored script (including delivery tags) for synthesis and hashes. Supported directions: https://soniox.com/docs/tts/concepts/emotion-and-tone.
- `narrationDisplayText.nextTag`: Known adjacent cues take precedence over reference-link syntax; real references stay intact.
- `narrationDisplayText`: A reference definition starts its own line. A colon within prose is ordinary punctuation.

### `packages/content-model/src/page-slug.ts`

- `buildSlugMap.usedFinalSlugs`: Keep content, glossary links and utility documents on distinct URLs in every caller.

### `packages/content-model/src/types.ts`

- `SelfCheckPrompt`: Generic self-check reader data. Full authored Content belongs to grammar.
- `RetrievalSheetContent`: Public authored recall content; every field is literal plain text.
- `HighlightContent`: Public authored highlight content; every text field stays literal.
- `WriteDistractorsPrompt`: Generic prompt only. Full authored Content belongs to grammar.
- `isLiteralTextBlockType`: These block projections contain literal text, never inline grammar or rich HTML.
- `PraxityBlock.locale`: ISO 639-1 locale for this block's content, if different from the course sourceLocale.
- `PraxityBlock.sectionTheme`: When set, this block starts a new section with the given palette (manual rhythm mode).
- `PraxityPage.locale`: Resolved language of the containing lesson; otherwise inherit the course.
- `PraxityPage.data`: Arbitrary metadata attached to the page by its preceding pageBreak.
- `PraxityPage.lessonTitleIsFallback`: The lesson label is generated because there is no authored title.
- `Lesson.sortOrder`: Independent title for the first page on canvas.
- `Lesson.role`: Lesson role, "content" (default), "glossary", or "resources". Non-content lessons are hidden from learner navigation.
- `HeadingBlockData.headingOffset`: Offset added in published output to maintain heading hierarchy after auto-titles.
- `QuoteBlockData.style`: Omitted and legacy styles retain the original left-line quote treatment.
- `DialogueTurnData.speaker`: Speaker key exactly as the author wrote it; undefined for an unattributed item.
- `DialogueTurnData.paragraphs`: Paragraphs of inline markdown.
- `DialogueTurnData.name`: Filled by resolveDialogueSpeakers; never serialized.
- `DialogueBlockData.speakers`: Local speaker declarations keyed by the author's key spelling.
- `NoteBlockData._tablerIconNodes`: Export-only Tabler outline nodes; authors never set this directly.
- `ColumnItem`: Column-specific item, separate from ContainerItem to avoid polluting other container types.
- `ColumnItem.label`: Positive relative proportion; omitted or invalid persisted values use 1 Author-supplied heading for semantic column presets.
- `ColumnsBlockData`: Columns block data, does NOT extend BaseContainerData.
- `HeroCoverBlockData.headingOffset`: Publish-time semantic heading offset injected by html-gen.ts.
- `AssessmentBlockData.stemLevel`: Heading level the author wrote the question at. The stem renders as a real heading so questions are reachable by heading navigation (WCAG 2.4.6); the level has to be the authored one or the page's outline order breaks.
- `AssessmentBlockData.headingOffset`: Publish-time semantic heading offset injected by html-gen.ts.
- `AssessmentBlockData.description`: Optional supporting prose shown between the question stem and the response controls, scenario setup, instructions, extra context. Rendered as rich text and wired to the response controls via `aria-describedby`.
- `AssessmentBlockData.feedbackMode`: Assessments with answer keys can reveal them after one attempt. Legacy modes retain retry behavior.
- `AssessmentBlockData.private`: Keep an ungraded text response on the learner's device instead of reporting it.
- `FillBlankResponse.wordBank`: Shared, consumable options; duplicate entries allow repeated selections.
- `FillBlankResponse.blanks.answerSources`: Raw typed-answer syntax when escapes distinguish literal and wildcard punctuation.
- `HotspotResponse.hotspots.coords`: Percent of image axes: rect [left, top, width, height], ellipse [cx, cy, rx, ry] (legacy circle [cx, cy, radius]), polygon [x1, y1, ...].
- `AssessmentGroupBlockData._foldedPageTitle`: Internal projection flag: this group replaces its page's standalone heading.
- `AssessmentGroupBlockData._headingLevel`: Authored heading level; older blocks default to H2.
- `AssessmentGroupBlockData.headingOffset`: Publish-time outline adjustment; not authored grammar.
- `isValidNodeId`: IDs used in DOM references must be safe tokens. UUID identities satisfy this contract.
- `isIdentityNodeId`: Durable content identities use lowercase UUID-shaped tokens.
- `isRuntimeNodeId`: Read-view identity has no durable UUID representation.
- `isDisplayNodeId`: Display joins accept stored identity and runtime identity; durable ingress does not.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the inline regression cases in `packages/grammar/__tests__/v4-inline.test.ts`, `packages/grammar/__tests__/ancillary-inline-ownership.test.ts`, `packages/shared-blocks/src/__tests__/inline-preparation.test.ts` and `packages/shared-blocks/src/viewer/__tests__/page-slug.test.ts`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
