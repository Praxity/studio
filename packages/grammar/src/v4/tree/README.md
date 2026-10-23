# Grammar 4 structural tree

Import `buildLessonTree` and its types from this directory's `index.ts`.
Call `buildLessonTree(tokenizeLesson(source), {isPart})`. The result is
`{stream, root, diagnostics}`. It retains the supplied G1 stream by reference and
never changes its source, tokens or line classifications. Grammar 3 does not use it.

`root` is a lesson with frontmatter and pages in source order. A page holds blocks,
headings, images, dividers and body runs. A block holds nested blocks and `::` items.
An item has its front content in `children`; its `::: back` face is a `back` child
with its own header, children and closer. Bare `:::` closes the innermost block or
back face. Item lines belong to the innermost open block, with schema constraints
left to G4/G5. The tree does not guess a missing inner closer from an outer item.

Each node has `span`, `raw`, `status`, `children`, `trivia` and `settings`.
Spans have half-open UTF-16 `start`/`end` and half-open `tokenStart`/`tokenEnd`
indexes. Every boundary is a G1 token boundary. `lineColumn` from G1 converts an
offset to one-based line and UTF-16 column coordinates. `raw` is the exact source
slice, including original terminators, whitespace, BOM and escapes.

Semantic spans enclose their children. A page extends to the next page or EOF.
A closed block includes its entire closer line. An item excludes the container's
closer and its trailing blank lines. Blank gaps between items belong to the
container; blanks between body siblings inside an item belong to that item.
These trivia spans, child spans, headers and closers partition each enclosing
node without dropping or claiming any token twice at that level.

Subjects, image alt/source, setting values and part values retain a `SourceValue`
with `span`, `raw` and `value`. Settings are ordered entries, not an object that
could overwrite duplicate names. G1's first duplicate entry wins; malformed
tokens remain in the header's raw span and produce diagnostics. Flags have the
key token as their value span and decoded value `true`. Empty parts have an empty
value span before their terminator.

`isPart(name, owner)` supplies contextual part declarations. No schema vocabulary
lives here. Without a declaration, a named line stays learner body text. Declared
parts include following lines indented two spaces, plus blank paragraph boundaries
when another indented line follows. Trailing blanks belong to the enclosing block.
Continuation lines are body children and internal blanks are part trivia. The
combined value preserves the indentation and line endings for later interpretation.
`buildLessonTree` remains the structural interface. G3 callers use
`analyzeLessonTree(stream, {definition, suggestType?, glossaryDefinitions?})`.
G4/G5 inject block declarations, including body kinds, parts, heading roles, item
containers, setting enums/validators and spelling suggestions. The tree owns no
block or setting vocabulary. Page, image, divider and item property declarations
can be supplied under those node-kind names. Schema constraints and course-wide
validation remain G4/G5 work.

G4's `getDefinition` in `../schema.ts` supplies content and container declarations.
Inject it as `definition`, composing G5's lookup when assessments are available.
`itemDefinition` resolves an item's settings, parts and body against its enclosing
container; `definitionOf(node, parent, definition)` applies that rule for every
caller. `isPart(name, owner, parent)` receives the owner's parent so an item's
parts come from that `itemDefinition`. Optional `validate(node, parent)` callbacks return neutral issues after
body interpretation and before error-status propagation. They own subject, child,
count and cross-setting constraints; the tree adds source positions and messages.

A page boundary or EOF recovers every unclosed block at its opener, without
inventing source closers. Those nodes and their ancestors have status `unresolved`.
An orphan item/closer or standalone lexical diagnostic becomes a raw `recovery`
node. Content before the first page goes on an unresolved untitled page;
frontmatter and leading blank trivia stay on the lesson. A schema-invalid unknown
type still has generic block structure until schema validation resolves it.
Diagnostics contain neutral codes, token spans, line/column and relevant facts.

The golden corpus covers all five converted lessons with LF, CRLF and mixed
terminators. Interface tests check nested ownership, recovery, raw/decoded values,
multiline parts, 1,000 malformed drafts and 2,000 unclosed nested blocks. Golden
files were authored before the builder; they contain every structural and body
node with depth and inclusive source line ranges. They are not parser snapshots.

## G3 semantic contract

Analysis adds `option`, `task`, `pair`, `step`, `turn`, `spot`, `list`, `list-entry`
and `table` nodes. `text`, pair `answer`, turn `speaker`, spot `bodySettings` and
table cells keep raw/decoded `BodyValue` slices with UTF-16 `range` offsets.
Those editable slices can fall within a G1 prose token. Node spans, headers,
closers, trivia and table-row spans still cover whole original tokens. The supplied
stream and its tokens never change. Invalid/dropped settings retain their source
in the original header. Invalid body lines remain raw recovery nodes.

Option nodes own their indented text continuation and at most one `feedback`
part. The feedback owns its own two-space continuation paragraphs. A blank before
`feedback:` or a repeated feedback line produces an error and a recovery node.
Mixed markers recover to the first option's kind across the entire question.

Lists keep the first authored number, peer numbers and marker-width nesting.
Blank gaps between peers belong to the list; gaps before a nested list belong to
its parent entry. Trailing blanks stay on the enclosing structural owner.
Numbered assessment bodies contain `step` children inside a list. Nested steps
remain nested lists and produce `nested-order-list`, never flattened steps.
Tables retain row/cell slices and optional Markdown delimiter-row alignments;
escaped pipes and matched inline-code runs do not split a cell.

Visible page headings are H1. A `{hideTitle}` page retains a scope of 1 but has no
visible `headingLevel`. Authored ATX content headings keep their level. A titled
block is one below its scope's last content heading. Titled container items are
one below their container; untitled containers' items use the container's level.
An untitled group introduces no heading level. Item and block scopes never change
their parent or sibling baseline. `{level=1}` through `{level=6}` override derived
levels. A deeper derived title becomes H6 with a warning.

All analysis diagnostics have `{code, span, line, column, severity, message}`;
`message` is a `MessageRef` with a `grammar.v4.<code>` key and language-neutral
arguments. Translation belongs to the host. Error status propagates to ancestors;
warnings alone do not invalidate a draft. An unshielded `as:` line refuses the
entire file with `refused: true`, no parsed children, retained root raw text and
the `praxity convert` command argument. Strict closer nesting remains unchanged.
An outer item recovers an unclosed non-item block at that item boundary.

G6/G5 can inject decoded inline/course glossary definitions. The temporary local
fallback checks literal same-lesson definitions outside fenced and inline code.
It does not replace G6's formatted/nested-term parser or G5's course validator.
The supplied definition order decides which conflicting definition is first.

G3 tests cover every FORMAT-NEXT 6.3 row and every Q1 review case. The literal
`authored-heading-levels.json` fixture was extracted from the original grammar-3
courses' ATX lines, independently of either parser. All five converted lessons
must match it, with the toolkit's hidden navigation title excluded. Semantic
ownership also tiles all five lessons in LF, CRLF and mixed endings, plus 500
malformed body drafts.
