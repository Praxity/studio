# 0004: Grammar source and reader boundaries

## Status

Accepted. Records existing behaviour.

## Context

The grammar keeps a lossless source tree alongside learner projections. Source edits must preserve unrelated bytes and author-only practice content.

## Decision

### `packages/grammar/__tests__/helpers/lesson-fixture.ts`

- `readLessonFixture`: Block-focused fixtures omit page boundaries. IDs are explicit test allocations, so reparsing can compare semantic data without random transient UUIDs.
- `readBlockFixture`: Fragment fixtures belong to one explicit, hidden-title page. Their block syntax is still read by grammar 4; this does not translate legacy declarations.
- `replayLesson`: Grammar 4 saves the token stream, including trivia, rather than renderer data.
- `withoutNodeIdentity`: Identity-only wrappers do not change a list's learner-visible HTML.

### `packages/grammar/__tests__/page-nav-overrides.test.ts`

- `toBe`: Duration predates this mechanism and renders viewer-side only; it must not flip existing static pages to the full viewer.

### `packages/grammar/__tests__/v4-adapter-compatibility.test.ts`

- `toEqual`: The compiler-node binding amendment adds compile-only provenance; keep the original literal checking that response settings stay off prose children.

### `packages/grammar/__tests__/v4-body.test.ts`

- `definitions`: Literal declarations stand in for the grammar 4 semantic schema. The tree owns no block/setting vocabulary.
- `toEqual.map.first`: For page-boundary metadata compatibility, a folded H1 group retains its title while its page also has explicit metadata.

### `packages/grammar/__tests__/v4-docs.test.ts`

- `fences`: Fences are full lessons, including a page. Error examples declare every expected diagnostic as code@line:column in their fence info, in source order.

### `packages/grammar/__tests__/v4-lex.test.ts`

- `isSettingName`: Schema owns the vocabulary. The lexer receives only a spelling classifier.

### `packages/grammar/__tests__/v4-schema.test.ts`

- `toEqual`: The semantic schema owns undeclared assessment types. Any error from a grammar 4 declaration still fails.

### `packages/grammar/__tests__/v4-tree.test.ts`

- `corpusOptions`: Literal corpus declarations, not the production schema, which arrives in the grammar 4 semantic schema.
- `assertSpans.owned`: Leaves own their raw range. Structural headers, closers and trivia fill all other gaps.

### `packages/grammar/__tests__/validation/cli-validate.test.ts`

- `TSX_LOADER`: Match the package command without spawning a platform-specific shell shim.

### `packages/grammar/src/course-reading-palettes.ts`

- `palette.dark.colorSuccess`: Dark status saturation must retain the existing Lc75 reading floor.
- `legacyPalettes`: Saved Studio designs contain the old preset's default colours. Keep these migration facts separate from the current roles; authored overrides survive.

### `packages/grammar/src/course-theme-ids.ts`

- `COURSE_PRESET_ALIASES`: Saved IDs migrate here in grammar, authoring and published output.
- `withCoursePresetAliases`: Old direct reads still work, while pickers enumerate the five current IDs.

### `packages/grammar/src/deck-design.ts`

- `normalizeDeckDesign`: Retain only valid authored keys, so normalization does not erase course inheritance.
- `resolveDeckDesign`: Share the same effective defaults between Studio and export.

### `packages/grammar/src/font-catalog.ts`

- `FONT_LIST.faces`: The combined Latin/Latin-ext stylesheet covers French Ÿ.
- `normalizeTypography.id`: The owner chose Sans even for saved courses containing the old serif default. Only legacy Atkinson carries a pairing choice when there is no persisted id.
- `getDesignSettingWarnings`: Report authored settings before look v2 normalization supersedes them.
- `getTypographyWarnings`: Inspect authored settings before normalization discards retired font choices.
- `getTypographyWarnings.checkRole.matches`: Saved Clear headings used 600 before the Next migration.
- `collectTypographyFontFaces`: Authored emphasis can occur in prose, control labels and headings.

### `packages/grammar/src/frontmatter-range.ts`

- `findFrontmatterRange`: Dependency-free fence ownership for the lexer, metadata reader and source editor. Raw offsets include one optional leading BOM and the authored line endings.

### `packages/grammar/src/line-endings.ts`

- `normalizeLineEndings`: Normalize parser input while leaving raw filesystem save baselines intact.
- `normalizeYamlLineEndings`: YAML accepts LF/CRLF. Normalize lone CR while keeping every raw offset.
- `findLineEnding`: First authored terminator, including lone CR. An unterminated source has none.
- `preserveLineEndings`: Keep the existing file's newline style when an editor or serializer emits LF.
- `displayText`: Two spaces are the part/continuation dialect, not learner indentation. The tree retains them.

### `packages/grammar/src/manifest.ts`

- `ManifestParameter.implemented` and `INERT_PARAMETERS`: Preserve parsing of inert authored settings, but mark them unavailable in authoring controls. A syntactically accepted setting must not be presented as a working output capability. Update the exhaustive manifest test when implementing or retiring one.
- `ASSESSMENT_SHARED_PARAMETERS`: `pass` is deliberately absent: it duplicated `passingScore`, and it was the inert half of the pair. `passingScore` is the canonical group pass threshold.

### `packages/grammar/src/nav-archetype-layout.ts`

- `LAYOUT_CLASS_BY_ARCHETYPE`: The single mapping from an author's chosen navigation archetype to the layout class the viewer and the exporter both use. There used to be two resolvers that disagreed. The runtime mapped `navigationStyle` directly, while the exporter reverse-inferred a layout from individual nav toggles (`navEdgeArrows && !navOutline` → slides, and so on). That inference could not express `minimal` (its preset turns off outline, prev/next and edge arrows, so the `none` branch claimed it first) or `embedded` (absent from the chain entirely), and it silently downgraded a course to `sidebar` whenever an author adjusted a toggle. A new project scaffolded as `slides` exported as `sidebar`. Keep this the only place the mapping lives. Toggles still customise a layout; they no longer decide which one it is.
- `LAYOUT_CLASS_BY_ARCHETYPE.custom`: `custom` means "the author took over the toggles"; it has no layout of its own and inherits the sidebar chrome.
- `navArchetypeSuppressesNav`: `none` means the author asked for no navigation chrome. The no-JS fallback nav is the navigation on static pages, so it must be suppressed here too, otherwise a "no navigation" course still shipped a full page list on every text-only page while its other pages showed nothing.

### `packages/grammar/src/nav-archetype-presets.ts`

- `NavToggleValues`: The nav toggles each archetype implies when the author has not overridden them. These presets live in `grammar` rather than `editor-core` because both sides of the pipeline need them and they must not drift: the desktop editor resolves them for the live preview, and `export-pipeline`'s `desktop-design.ts` resolves them for the published package. While the exporter had its own sidebar-shaped default table, a course whose only nav setting was `navArchetype: slides` exported with `navOutline: true`, `navEdgeArrows: false`, `navHamburgerMenu: false`, `navSlideCounter: false` and `navProgressStyle: bar`, the slides layout class with sidebar navigation, so the published slides had no edge arrows, no hamburger outline, no counter and no dots.

### `packages/grammar/src/operations/contract.ts`

- `OperationIntent`: Identity intent is derived by the registry, including for source edits.
- `IdentityFate`: Fates tell identity consumers which IDs continue, disappear or await resolution.
- `NodeRef.path`: Supplies a structural locator when identity is unavailable, never sole authority.
- `NodeRef.fingerprint`: Disambiguates structural matches without becoming an identity.
- `InsertionPoint.parentRef`: ID-free anchors from an admitted read view; each requires a unique fingerprint and current path.
- `OperationTarget.expectedText`: Guards replacement against exact source text, including its original line endings.
- `OperationTarget.inline`: Selects one token in the node by base-revision UTF-16 offsets and exact raw spelling.
- `OperationFileBase.baseRevision`: Binds this file to the SHA-256 of its UTF-8 bytes before resolution or rebase.
- `OperationRequest.files`: Gives every participating file its own revision precondition.
- `OperationRequest.targets`: Declares all targets so resolution succeeds for every member or refuses entirely.
- `OperationRequest.args`: Carries operation-specific input for the registry to validate at its boundary.
- `OperationFileEdits.edits`: Reuses half-open UTF-16 offsets into UTF-8-decoded text with original line endings.
- `WrittenNodeGuard.text`: Prevents undo from overwriting changes to the operation's own slice.
- `DeletedNodeGuard.nodeId`: Requires the removed identity to remain absent before undo restores it.
- `DeletedNodeGuard.ref`: Locates the restoration slot when the deleted node has no current slice.
- `InsertionBoundaryGuard.ref`: Requires the same owner and adjacent siblings, including start and end boundaries.
- `InsertionBoundaryGuard.beforeText`: Guards the following sibling's exact slice; null requires the owner's end.
- `InsertionBoundaryGuard.afterText`: Guards the preceding sibling's exact slice; null requires the owner's start.
- `OperationInverse.files`: Records per-file reverse transitions; rebased undo must recompute offsets and hashes.
- `OperationInverse.mapping`: Restores the recorded identities instead of allocating replacements during undo.
- `OperationInverse.guards`: Protects written slices, absent identities and boundaries while unrelated edits may rebase.
- `OperationResult.transactionId`: Associates the result with the request's all-or-none transaction.
- `OperationResult.intent`: Reports the registry's identity decision instead of trusting the caller's guess.
- `OperationResult.mapping`: Supplies authoritative old-to-new identity evidence to all consumers.
- `OperationResult.inverse`: Gives history the edits, identity restoration and guards needed for atomic undo.
- `OperationResult.diagnostics`: Reports contained invalid source while preserving pending identities.
- `OperationRefusal.ok`: Discriminates a refusal, which contains no committed edits or identity mapping.

### `packages/grammar/src/page-nav-overrides.ts`

- `getPageNavArchetype`: Per-page navigation overrides, written as page-break params: --- Knowledge check nav: minimal navKeyboardArrows: false Precedence (later wins): course-resolved toggles -> page `nav:` archetype preset -> page individual keys. The compiler uses these helpers for both preview and published output.
- `getPageNavArchetype`: The page's `nav:` archetype param, if valid. `custom` is meaningless per page.
- `mergePageNavToggles`: `duration: show|hide` predates this mechanism; it is sugar for navReadingTime.
- `getPageFocusDefault`: Author default for reading-focus on this page. Learner choice overrides (viewer-side).
- `pageHasNavOverrides`: Whether this page carries any type-valid nav or focus override. The exporter forces the full React viewer for such pages: static/islands pages render course-level chrome server-side, so an override there would silently not apply. `duration:` is deliberately excluded, it predates this mechanism, renders viewer-side only, and must not flip existing static pages to the heavier runtime.
- `inferNavStyleFromToggles`: The toggle->layout inference chain, extracted verbatim from the legacy viewer so the compiler can compute the layout class for a page whose overrides change individual toggles without naming an archetype. Order matters, do not reorder branches.
- `PAGE_NAV_AFFORDANCES`: The affordances a learner can actually use to change page. Progress dots and breadcrumbs are deliberately absent: dots render as `role="progressbar"` with `aria-hidden` children, and breadcrumbs render as text. Neither navigates. Swipe is absent because it is the failure mode this guards against, not a remedy for it.
- `applyKeyboardNavFloor`: Keyboard arrows cannot be the last thing switched off. A page can turn every visible control off, `nav: minimal` does most of it, and the individual keys finish the job. With `navKeyboardArrows: false` on top, the only way left to leave the page is a swipe: unusable with a keyboard (2.1.1 Keyboard, Level A) and unusable with a mouse, since a swipe is a dragging movement with no single-pointer alternative (2.5.7 Dragging Movements, AA). The kitchen-sink fixture had exactly this page, and a learner on a desktop was stranded there. So when no visible affordance survives, arrow-key navigation comes back on. It is invisible chrome, so it cannot spoil the minimal look the author asked for, and it is the only repair that needs nothing from the author. Every other toggle is left exactly as written.

### `packages/grammar/src/parameter-metadata.ts`

- `canonicalComponentDefaults`: Defaults are authored source too: retain canonical names without mutating the input.

### `packages/grammar/src/practice-admission.ts`

- `practiceAdmissionDiagnostics`: Selective publication admission. Existing course diagnostics remain advisory to these hosts; never turn validateCourse's entire result into a build gate.
- `practiceAdmissionDiagnostics`: Rejected settings disappear from the renderer projection. Carry their source refusal through the same located error path as the other admission codes.
- `practiceAdmissionDiagnostics`: Native PDF admission is separate from grammar validity. Retain lossless source locations even when a malformed ancestor has no projection.

### `packages/grammar/src/practice-diagnostics.ts`

- `messages`: Compiler/reader diagnostic copy. Kept outside learner bundles and content-free. The editor's op.diagnostic entries use the same frozen EN/FR messages.
- `practiceFieldMessages`: Default-English field diagnostics for grammar/CLI. Runtime refusal copy lives in the bilingual catalogue in this file; localized author UI uses op.diagnostic.

### `packages/grammar/src/read-lesson.ts`

- `refuseUnavailableLessonRuntime`: Keep typed practice prompts and their source diagnostics available during authoring. Publication must refuse write-distractors until the runtime exists; compiled admission checks each practice reader type independently.
- `nodeIds`: Only the identity index is cached. Authored content stays in the source tree.
- `readSelfCheckContent`: Author-only Content from this read's source and allocated identities. Invalid drafts remain available through the tree.
- `readSelfCheckContent`: Crash reporting forwards errors; never attach library errors or authored text.
- `readHighlightContent`: Fresh public content from this read's AST and identity index, never its projection.
- `readHighlightContent`: Do not cache a mutable identity index. Ambiguous aliases and detached records must still refuse after an earlier successful read.
- `readHighlightContent`: Never forward authored text or upstream exceptions to crash reporting.
- `readRetrievalSheetContent`: Author content from this read's source and identities, independent of editor projections.
- `readRetrievalSheetContent`: Never forward authored text or upstream exceptions to crash reporting.
- `readWriteDistractorsContent`: Author content from this read's source and identities, independent of editor projections.
- `readWriteDistractorsContent.code`: Runtime availability does not invalidate author content.
- `readWriteDistractorsContent`: Never forward authored text or upstream exceptions to crash reporting.
- `readLesson`: Grammar 4 reader. Invalid drafts return their source tree and diagnostics; publication callers must refuse when hasErrors is true. Course checks remain validateCourse's responsibility, with the host's complete cast/glossary/context.
- `lessonSourceText`: Authoring hosts may use exact source for revision admission and hashing; learner output must use the reader projections instead.
- `lessonPageBodyBlocks`: Preview and output callers may select projected page content without its generated title; raw author nodes and full self-check Content stay private.
- `withLessonIds`: Rebuild ID-bearing projections from an existing parse after identity resolution.

### `packages/grammar/src/source-edit.ts`

- `yamlEditDocument.input`: YAML accepts LF/CRLF only. Normalize lone CR without moving any raw offset, then restore CST trivia so collection edits retain the author's bytes.
- `setYamlPath`: Edit only the selected value or collection entry. CST tokens retain authored trivia; document serialization would rewrite unrelated flow syntax and EOLs.
- `setYamlPath.text`: Flow replacements fit anywhere a value can occur, including inline maps. Multiline strings use quoted escapes so no neighbouring indentation changes.
- `setYamlPath.first`: Delete the entry's own line, leaving preceding standalone comments and the following entry's indentation at their exact offsets.
- `setYamlPath`: Reject an edit whose syntax changes the wrong data, before returning any bytes.

### `packages/grammar/src/supported-blocks.ts`

- `RETIRED_BLOCK_TYPES`: Tombstones retained so stale persisted content fails clearly instead of disappearing.

### `packages/grammar/src/types.ts`

- `TypographyVariants.pairing`: Missing in legacy courses; normalization persists the current pairing.
- `DesignVariants.brand.logoPlacement`: `left` and `center` are accepted only when loading older projects.

### `packages/grammar/src/utils.ts`

- `RASTER_IMAGE_DATA_URL`: Raster images only: an SVG document can carry script.
- `UrlRefusal`: Why a URL is refused; each code has its own diagnostic that names what to use instead.
- `isSafeUrl`: Whether a URL from course source may go into an href: relative URLs, fragments, and http, https, mailto and tel. Every other scheme is refused, including `data:`, so an unknown or disguised scheme never reaches the page.
- `isSafeMediaUrl`: Media src attributes accept the same URLs plus raster image `data:` URLs.
- `urlRefusal`: Read schemes as the URL Standard basic URL parser does (https://url.spec.whatwg.org/#concept-basic-url-parser): remove leading C0 controls and spaces, remove ASCII tabs/newlines throughout, then recognize an ASCII scheme ending in a colon. This makes disguised javascript schemes refuse as the browser would interpret them. Use linear passes; a backtracking edge-trim regex took quadratic time on long whitespace runs.
- `isSafeCaptionTrackUrl`: A caption attachment is a safe VTT path or an HTTPS VTT URL.
- `isSafeEmbedUrl`: Safe iframe embed URLs must be HTTPS and third-party (not Praxity origin).

### `packages/grammar/src/v4/inline.ts`

- `escapeLength`: Use the lexer's punctuation rule. Decoding happens only after a token's bounds are known.
- `tokenizeInline`: Pass the full lesson and an undecoded lexer token or span to retain lesson-relative offsets.

### `packages/grammar/src/v4/lex/offsets.ts`

- `toUtf8Offset`: UTF-8 encodes isolated surrogates as U+FFFD, as TextEncoder does.
- `toUtf16Offset`: Rejects byte offsets inside a UTF-8 scalar instead of rounding a write boundary.
- `lineColumn`: One-based UTF-16 columns. A CRLF break completes after LF, a lone CR after CR.

### `packages/grammar/src/v4/lex/settings.ts`

- `decodePunctuation`: Decode after identifying boundaries. Unknown escapes and ordinary backslashes survive.
- `settingsStart`: First reserved suffix, including malformed or non-final groups. Escaped braces are text.
- `lexSettings.pop`: The equals sign owns this error because an empty value has no source range.

### `packages/grammar/src/v4/lex/types.ts`

- `TokenLine.start`: UTF-16 offsets, including the BOM on the first line and its original terminator.
- `TokenLine.tokenStart`: Half-open indexes into TokenStream.tokens. No synthetic EOF line/token.
- `LexOptions.isSettingName`: Schema/tree supplies contextual setting names, aliases and near misspellings. Unknown name: lines remain part candidates for the tree to resolve as learner text. The offset lets the caller select its enclosing schema without a second stack here.

### `packages/grammar/src/v4/schema.ts`

- `toggle.default`: Parameter defaults often live in renderers. Do not invent false for omitted settings.
- `entranceIcons`: These legacy vocabularies have types but no runtime export. Exhaustive keys keep them tied to their owners.
- `toneIcons`: NoteTone has no runtime constant. This exhaustive record is checked against its owning type.
- `cardColours`: CardBlockData has no runtime colour vocabulary; exhaustive keys track its owner.
- `linkSubject.nodes`: Delimiters must be identified before the lexer's subject escapes are decoded.
- `constraints.kind`: A model: line after the first criterion parses as that criterion's body.
- `constraints`: Group prose can itself contain blocks. Check its full subtree too; direct members and choices with forbidden settings already receive this diagnostic.
- `selfCheckContent`: The library's content from grammar's literal fields. The lexer decodes each value once; this only normalizes line endings and continuation indentation. The host supplies IDs.
- `selfCheckIssues`: ValidateContent owns the content rules. Blank and missing fields already have their own subject, part or child-count diagnostic. Evidence that isn't found exactly once in the model has its own code, and any other refusal is self-check-invalid, so a new library rule never passes silently. The library stops at its first failure, so a later criterion's evidence is checked once earlier blank fields are filled. IDs are positional stand-ins: analysis has no identity, and the reader's allocator refuses missing or duplicate IDs.
- `highlightContent`: Literal conversion shared by semantic admission and the grammar projection. Paragraph breaks are structural; the item identity allocator owns chunk IDs.
- `highlightIssues`: The shared lexer preserves the quoted spelling; numeric and boolean coercion would otherwise erase the source contract's distinction.
- `highlightIssues`: Precise structural/field diagnostics own known failures. Upstream owns the remaining semantic admission and its exception must never expose authored text.
- `retrievalSheetContent`: No identities are authored here. Analysis supplies positional stand-ins; the reader supplies the existing lesson identity allocator's item IDs. Decode raw fields once, including continuations, and preserve all nonstructural whitespace.
- `retrievalSheetIssues`: Do not turn the same failure into an additional library-invalid error.
- `writeDistractorsContent`: Paired literal fields for semantic admission and the source-owned typed accessor.
- `writeDistractorsIssues`: The named checks own structure, blankness, lengths and duplicates. Never repeat them as a generic library failure or expose upstream exception text.
- `SPOT_SETTINGS`: Spot geometry belongs to hotspot, not the lexer or generic tree. Coordinates are percentages.
- `parseRuleAction`: Rule action syntax is strict. Callers never recover an unknown verb as a show action.
- `isPrivateChoice`: Choice privacy is opt-in; free-response's existing flag has a separate contract.
- `wordBankEntries`: Separators belong to the raw spelling; only individual words decode escapes.
- `responseConstraints.proseOnly`: Description sinks accept rich prose HTML, not arbitrary block renderers. Check wrappers too so inspect cannot admit content those sinks discard.
- `responseConstraints.nested`: Each nested group owns its subtree's membership diagnostics.
- `BLOCK_SCHEMA`: Grammar-4 declarations only. Grammar 3 never imports this registry.
- `BLOCK_SCHEMA.stats.settings`: StatsBlock accepts exactly 2, 3 or 4; its CSS reduces grids at smaller widths.
- `BLOCK_SCHEMA."write-distractors".settings.count.accepts`: This new setting uses canonical source integers. Keep the legacy level/points numeric parser's leniency unchanged.
- `learnerInline`: Learner fields only. Never scan structural settings, URLs, frontmatter or rule expressions.
- `learnerInline.read.cursor`: Split around protected block literals while preserving multiline inline ranges elsewhere.
- `validateCourse`: Course-wide checks are pure and retain the first definition/name in supplied lesson order.
- `validateCourse.push`: Replace the body interpreter's literal same-lesson glossary fallback with the inline compiler course check.
- `validateCourse.practiceOwners`: Parents precede children in `all`; one reverse pass indexes subtree ownership and strict sheet ancestors without walking each subtree again.
- `validateCourse`: Duplicate-name diagnostics are non-blocking in publication hosts. Any matching practice definition must still establish the privacy boundary.
- `validateCourse`: Unknown gate spellings remain unknown-setting. The same authored token must also establish the course practice refusal before schema filtering removes it from the analyzed settings.
- `TURN_INTO`: Empty rows deliberately offer no conversion. Transformations and state compatibility belong to the operations and learner-state owners.
- `WRAP_IN`: A selection can wrap only if every selected type lists that target. Columns use their dedicated operation.
- `generateBlocksIndex`: JSON-only schema projection. Executable validators stay in grammar; no timestamps or host state.
- `generateBlocksIndex.stringify`: The published index names message keys `label`: secret scanners read a `"labelKey": "dotted.value"` pair as a generic API key.

### `packages/grammar/src/v4/to-blocks.ts`

- `inlineTree`: Keep the current footer planner's inert placeholder contract. Source spelling remains in the lossless tree; this projection is only renderer data.
- `inlineHtmlFields`: Mark HTML-valued fields at projection so consumers never parse them as source.
- `toBlocks`: Adapt semantic nodes directly to the canonical renderer shapes. Never call the v3 parser.
- `toBlocks.block.resolved`: Schema defaults remain available to semantic decisions in the schema. Runtime metadata contains authored settings only, under the existing renderer names.
- `toBlocks.block`: False is the legacy choice contract: no new data key or policy membership.
- `toBlocks.bodyHtml`: HTML-valued prose containers keep Markdown's native block elements. Their current renderer interface is a string, so retain each source wrapper here.
- `toBlocks.assessment.common`: Retain the source of compatibility-promoted option feedback so the activity renderer can place it beside that option without repetition.
- `toBlocks.assessment.safeTemplate`: Escape protected braces in the legacy template so its blank scanner agrees with the schema. Raw spelling remains in the lossless tree.
- `toBlocks.table`: Preserve grammar 4 inline semantics beside the raw cell values used by sorting and charts. The display preparer still accepts legacy Markdown.
- `toBlocks.convert.speakers`: Empty declarations establish a grammar 4 speaker key without adding a local override to the renderer's cast-resolution interface.
- `toBlocks.convert`: The current accordion/tabs/sequence/columns renderers draw only item labels.
- `toBlocks.convert`: Only the literal prompt and allocated item identities enter generic data.
- `toBlocks.convert`: Generic readers get only the prompt and criterion identities. Full author Content is read explicitly through readSelfCheckContent, never block data.
- `toBlocks.firstBlock`: Declarations have hidden runtime wrappers. Keep the authored page title first, matching the existing publisher's heading and reading order.
- `toBlocks.blocks`: A flat stream keeps the current desktop/export API usable. Every page, including the first, has a pageBreak so callers need no firstPage frontmatter exception.
- `toBlocks.blocks.data`: Let the existing publisher infer plain navigation from the visible heading. Explicit nav and hidden titles retain their authored label.
- `toBlocks`: Allocate author-only records last so sequential allocators retain every learner ID.
- `AUTHOR_ONLY_READER_ROLES`: These reader roles locate author fields but never emit IDs into learner data.

### `packages/grammar/src/v4/tree/analyze.ts`

- `legacyDeclaration`: Grammar 4's lexical partition shields fences, math, quotes, escapes and frontmatter.
- `legacyDeclaration`: Distinct grammar 3 productions from the archived parser. Shared Markdown, bare dividers and headings cannot distinguish the formats. `if:` is also a grammar 4 rule part.
- `analyzeLessonTree.legacy`: Lexical classifications shield code, math, quotes, escaped lines and frontmatter.
- `analyzeLessonTree.tree.isPart`: After the first option, feedback belongs to the body interpreter. It enforces adjacency instead of treating detached lines as question parts.
- `analyzeLessonTree`: Name the allowed link forms; never echo the refused URL.
- `analyzeLessonTree.glossaryDefinitions`: Inline/course owners can supply definitions; the local fallback recognizes literal terms only.
- `analyzeLessonTree.finalNodes`: Errors invalidate their smallest containing node, then propagate through ancestors.
- `analyzeLessonTree`: Valid practice declarations still have durable authoring identities while publication waits for its runtime. All structural errors propagate.
- `localDefinitions.start`: The inline compiler replaces this fallback with its inline tree for formatted/nested terms.

### `packages/grammar/src/v4/tree/body.ts`

- `interpretBodies`: A semantic run may bridge blank trivia, but never a structural sibling.
- `interpretBodies.trivia`: Only blanks now enclosed by a semantic child change owners.
- `interpretRun.flush`: Unconsumed gaps remain on the original owner; interpretBodies removes owned gaps.
- `interpretRun.protectedLine`: Protected lexical lines remain protected in the body interpreter too.
- `interpretRun.length`: A short continuation is literal prose, never a flattened nested item.
- `interpretRun`: Code inside a list is lexically protected even when its raw indentation is zero.

### `packages/grammar/src/v4/tree/build.ts`

- `readHeaderSettings`: The lexer replaces duplicate names with diagnostic tokens. Their trailing values have no key.
- `buildLessonTree.finishItem.trailing`: Blank gaps between items, including empty items, belong to the container.
- `buildLessonTree.body.gap`: Blank lines become internal part trivia only when an indented paragraph follows.
- `buildLessonTree`: The body interpreter distinguishes this boundary from EOF/page recovery.
- `buildLessonTree`: Openers/pages/items are now on the stack; leaf headers are still its last child.
- `buildLessonTree.nodes`: Iterative postorder keeps deeply nested authored drafts off the JavaScript call stack.

### `packages/grammar/src/v4/tree/headings.ts`

- `deriveHeadings.ownLevel`: Derived titles do not change their parent's last authored heading.

### `packages/grammar/src/v4/tree/types.ts`

- `SourceSpan`: Half-open UTF-16 offsets and indexes into the unchanged lexer token stream.
- `BodyValue`: Editable slices within a lexical prose token. Node spans still cover whole tokens.
- `BodyDefinition.literalText`: Authored fields are plain text, excluded from inline and glossary interpretation.
- `BodyDefinition.itemDefinition`: Item declarations belong to the enclosing container, not a global item vocabulary.
- `TreeOptions.isPart`: The grammar 4 semantic schema owns part names. Unclassified named lines stay in the body.
- `TreeOptions.allowsItems`: Semantic pass enables schema-aware item recovery; the structural tree callers keep strict generic structure.

### `packages/grammar/src/validation/schemas/assessment-schema.ts`

- `assessmentSchema.attributes.timed`: `pass` is gone, not deprecated. It duplicated `passingScore` and was the half nothing read, so a pass threshold is a group-level concept: use `assessment-group` with `passingScore`. Unknown parameters are ignored rather than flagged (validate.ts iterates the schema, not the document), so existing files carrying `pass:` keep parsing exactly as before, the value was never applied either way.

### `packages/grammar/src/validation/schemas/page-break-schema.ts`

- `pageBreakSchema.attributes`: `focus` and `duration` are validated by the block validator: the parser coerces true/false to booleans (focus), and `duration` doubles as the reading-time toggle (show|hide) and the documented page-transition duration (e.g. 500ms), so neither fits a plain string enum.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the regression cases in `packages/grammar/__tests__/`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
