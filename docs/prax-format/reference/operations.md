# Source operations

This reference covers the grammar-4 registry. The host supplies source,
identity and hash dependencies. The registry plans edits in memory. The host
owns source and sidecar writes, revision rebasing and history application.

The [CLI](../cli.md#edit-source-nodes) resolves `--page lesson.prax:2 --block 1`
to a source target before calling the registry. Page numbers belong to each lesson
and exclude frontmatter. Ambiguous page selectors refuse with the lesson-qualified
selectors and titles, before the registry plans any edit.
Lesson filenames match the admitted inventory exactly. Unmatched selectors ending
in `:<number>` report a missing lesson; exact page titles and slugs still resolve.

The CLI's `inspect --blocks` lists source addresses and settings without planning
edits. Add `--eligibility` to include the `operations` list from registry probes.
See [CLI inspection](../cli.md#edit-source-nodes) for the output contract.

`applyOperation(files, request, context)` is exported by `@praxity/operations`.
`files` contains `{path, source}` entries for
all current lessons represented by `context.identity`. The context contains
the current `IdentityResolution`, `allocateId` and `digest`. `digest` returns
the SHA-256 of UTF-8 text. File revisions and identity snapshot hashes must
match those sources before planning starts.

The request and common result types belong to
`packages/grammar/src/operations/contract.ts`. A successful registry result
also contains `identity`, the resulting identity resolution, and `evidence`,
the recorded identity operations with placements and allocated descendant IDs. The host can persist the
snapshots with the source edits. Unchanged surrounding nodes carry separate
`modify` evidence when the requested intent is insert, copy or delete.

## Arguments

| Operation | Targets | Arguments |
| --- | --- | --- |
| `editSource` | One node | `text`, the raw source draft |
| `insertBlock` | One insertion point | `text`, or `type` for its schema template |
| `deleteBlocks` | One or more nodes | None |
| `duplicateBlocks` | One or more nodes | None |
| `moveBlocks` | One or more sibling nodes | `direction`, either `up` or `down` |
| `moveBlocks` | Nodes in one lesson and an insertion point in any participating lesson | None |
| `setProperty` | One node | `name` and `value`. Null removes a setting |
| `setText` | One node | `field` and `text` |
| `editInline` | One or more node targets with `inline` token guards | `text`, `target` or `definition`; optional `rename`, `one` or `all` |
| `addItem` | One item or item container | `text`, beginning with `::`; optional `position`, `before` or `after` |
| `removeItem` | One item | None |
| `moveItem` | One item | `direction`, `up` or `down` |
| `moveItem` | One item and one insertion point in an item container in the same file | None |
| `wrapInColumns` | One block or adjacent sibling blocks in the same file | None |
| `unwrapColumns` | One columns container | None |
| `setColumnWeights` | One columns container | `weights`, one positive safe integer per column |
| `wrapIn` | Adjacent sibling blocks in one file | `type`; optional `title` |
| `wrapIn` | One wrapper | `unwrap: true` |
| `turnInto` | One or more nodes | `type`; `title` required for divider to page |
| `mergeBlocks` | Two or more adjacent plain paragraphs in one file | None |
| `replaceBlock` | One node | `text`, or `type` for its schema template |
| `cutBlocks` | Blocks on one page, in source order | None |
| `copyBlocks` | Blocks in one lesson | None |
| `pasteBlocks` | One insertion point in a page or container | `text`, clipboard source |
| `discardCut` | One insertion point in the cut lesson | None |
| `insertPage` | One file-root insertion point | `title`, one nonempty inline line |
| `movePage` | Pages in one lesson and a file-root insertion point in any lesson | None |
| `movePage` | Pages among lesson siblings | `direction`, `up` or `down` |
| `setPageTitle` | One page | `title`, one nonempty inline line |
| `mergePage` | One page with a previous page in the lesson | None |
| `deletePage` | Pages and all their content | None |
| `applyInverse` | No targets | `operation`, a recorded successful registry result |

`setText` accepts the existing `subject`, `value`, `text`, `answer`, `alt`,
`source` or `speaker` field. Its text is raw inline source. Headings and page
subjects stay on one line and retain their settings. Plain paragraph bodies and
list entries accept `field: "text"`, including prose wraps that retain the
same structural nodes. Their final line ending, list marker and indentation stay
outside the field. Existing wrap terminators survive normalized LF input,
including mixed endings. Empty text, paragraph splits, new headings, directives
or lists refuse. Parent entries expose only their own text range; children stay
intact, outside the field in both the canvas and ordinary operations. Pasted bullet
markers refuse. A leading numeric prefix such as `2026. ` stays inline text after
the item's marker; later lines cannot introduce list items. The canvas excludes fill-blank sentences,
whose scored blanks remain available through ordinary operations. Surviving
wraps retain their terminator at the same text boundary when wraps are added or
deleted; new wraps use the field's existing ending, then the file's, then LF.
Choice option `text` and authored feedback part `value` share this validation.
Label edits preserve answer markers, option IDs, response settings and feedback. Pasting an
answer marker or another option refuses. Shared or promoted feedback edits its
authored source part; generated defaults have no editable source field. Canvas edits
cannot turn generic question feedback into a legacy timing word; option feedback
treats these words as literal prose. Ordinary `setText` still fills empty authored
parts and edits question feedback timing values. Empty parts have no canvas field.
Wrapped labels and feedback preserve their existing line endings. Feedback retains
its parsed continuation structure: adding its first continuation or removing its
last continuation refuses with `unsupported-syntax`. These rules also apply to
ordinary `setText` of a named `caption:` part, in every block that owns one.
An exact empty string still clears a caption through ordinary operations;
whitespace-only text refuses with `empty-text`, and leading spaces refuse
with `unsupported-syntax`. Canvas captions cannot be cleared.
These validation rules also apply to the
canvas text API. Author-input refusals are `empty-text`,
`line-break`, `unsupported-syntax`, `list-marker` and `settings`; unavailable
fields return `not-allowed`.
For page titles and headings, `setText` removes spaces and tabs at the start and
end of the supplied subject. Interior whitespace and paragraph edge spaces stay
unchanged.
`setProperty` accepts schema-valid strings, numbers and booleans. It replaces
only the selected value, preserving adjacent tokens' raw quoting and escapes.
Adding a setting creates braces if needed. Removing the last setting removes
the braces and leaves surrounding whitespace intact.

`editInline` selects a token with `target.inline: {start, end, expectedText}`.
Offsets refer to the base lesson's UTF-16 source, and `expectedText` is the exact
token spelling. The containing node uses the usual identity and source guards.
Several tokens may share a node; distinct tokens may lie in an ancestor and its
descendant. Overlapping token edits refuse. Every target must resolve before any
edits are returned, and a refusal names the member that failed.

For links and button/bookmark link subjects, `text` is the plain label and
`target` is the raw destination. Either may change alone or both together.
Destinations use grammar's existing `isSafeMediaUrl` policy, also used by button
and bookmark validation. A rejected URL returns `not-allowed`. Invalid inline
destination syntax returns `invalid-args`. Labels keep their existing emphasis,
code and doodle delimiters. A label that cannot retain those delimiters and its
requested text refuses with `invalid-args`; unsupported label leaves refuse with
`not-allowed`. Neither field rewrites the other field's bytes.

For glossary tokens, `definition` edits the definer wherever it lives. Bind every
lesson in the identity resolution with a file base, including unchanged lessons.
`text` changes the term's plain lookup text. If other occurrences exist, supply
`rename: one` or `rename: all`. One changes this token; all changes every matching
mention and definer across those lessons. Matching and learner-field discovery
come from grammar's course validator, so emphasis does not affect term lookup.
Code, settings, destinations and fill-blank answers are excluded.

Renaming one mention to a term with no definer requires a nonempty `definition`
and turns that mention into a definer. If the new term already exists, the token
stays a mention and a supplied definition edits that term's definer. Definitions
are plain text; punctuation is escaped as needed. Contained multiline definitions
are accepted; a definition that splits or escapes its parsed token refuses.
New undefined mentions or conflicting definitions refuse with `not-allowed`.
Multiple possible definers for a definition edit, or a rename-all collision with
an existing defined term, refuse with `ambiguous`.

The result uses `modify` intent and content-identity's fates. Its count names
planned inline tokens. Focus stays on the first requested member, including when
its definer is in another file. One guarded `applyInverse` restores every file,
identity and authored byte; its inverse permits exact redo.

An item target places `addItem` before or after that item. A container target
places it at the beginning or end of its items. The default is `after`.
The draft must contain one item; nested blocks stay inside it. An untouched
`:: ` draft writes nothing. A body without a required title remains pending.
The container and existing items keep their identities.

`editSource` on an item accepts a new typed `::` line as an item split.
The lexical survivor keeps the original ID; other resulting items get new IDs.
`removeItem`, an empty item source draft and item deletion through `deleteBlocks`
remove the container when its final item leaves. Comparison refuses to go below
its schema minimum of two, including when an item moves to another container.
`moveItem` stops at either end of its owner. An explicit insertion point can move
it to another item container. The item and every descendant keep their IDs.

`wrapInColumns` puts each selected sibling in its own column with `weight=1`.
One selected block produces two columns, with an empty second column for an
insertion draft. Selected blocks and descendants keep their IDs. The new columns
container and column items get new IDs. Allowed children and any column maximum
come from the grammar schema. The current columns declaration has no maximum.
`unwrapColumns` retires the container and its column items and retains all their
children in column order. Both operations use `modify` identity intent.

`setColumnWeights` divides all inputs by their greatest common divisor. `[60, 40]`
writes `weight=3` and `weight=2`. It preserves surrounding settings and body bytes.
It refuses zero, negative, fractional, nonfinite or unsafe integer inputs.

Moving or deleting a column's final block removes the emptied column item. With
one remaining column, the wrapper dissolves and that column's contents stay in
order. With no remaining columns, the wrapper disappears. Existing empty columns
remain available for insertion drafts. Dissolution is part of the same result
and inverse as the move or deletion. Move evidence keeps the moved subtree; a
separate `modify` evidence record retires the removed wrappers.

`wrapIn` accepts only targets declared in the schema's `WRAP_IN` matrix and
checks the target's child constraints. Item wrappers place each selected block
in its own item with a numbered title. A group needs at least one assessment.
Members and their descendants keep their IDs; wrappers and items get new IDs.
`unwrap: true` removes the wrapper and its item delimiters, retaining child order,
source spelling and IDs. Wrapping uses `modify` intent and focuses the new wrapper.

`turnInto` accepts only the schema's `TURN_INTO` pairs. Plain paragraphs use the
text declaration. Conversions use `convert` intent and keep the root ID. Text,
items, nested blocks and answers remain except for the declared losses. The
conversion changes response markers to the target's body syntax. Labels retain
their wording when their former response role disappears. Missing required
response entries and matrix scale labels come from the target's schema template.
Untitled items gain numbered titles when the target requires them. Nested blocks
retain their own schema and answers.

The result's `summary.params` includes `type`, comma-separated schema loss
identifiers in `losses`, and numeric `losesAnswers`, either 0 or 1. Hosts translate
the loss identifiers, filter absent authored values, and handle answer-loss
confirmation. The registry returns no confirmation dialog or rendered copy.

A divider can turn into a page only at page level and with a nonempty one-line
title. The divider's ID becomes the new page ID. Following blocks keep their
bytes and IDs under the new page; existing page titles remain unchanged.

`mergeBlocks` joins adjacent plain paragraphs in document order. Code, math,
quotes, lists, dividers and containers cannot join this way. The earlier ID is
the `survivor`; later IDs are `absorbed` into it. Focus returns to the survivor's
source field. `replaceBlock` uses `replace` intent, retires the old subtree and
allocates a fresh subtree even for identical content. It accepts one valid
standalone block. When both blocks have a closer, the saved closer's exact
spelling stays in place. Unchanged surrounding nodes use separate `modify`
evidence. Each operation returns exact inverse bytes, IDs and guards.

## Studio service

Studio's browser RPC accepts this request directly through `operationApply`
and `operationResolve`. Resolve plans without writing. Apply returns the public
operation result, a session `historyId`, and a `writeResult` acknowledgement.
Every node target must supply `expectedText`. A stale request rebases by UUID
only when the current owned slice matches that text. Without an ID, the
fingerprint must identify exactly one node; a path never resolves a duplicate.
Every lesson changed by the operation must have a client file base, including
an indirectly selected glossary definer.

`historyApply` takes `{transactionId, historyId, direction: "undo" | "redo"}`.
The server holds the inverse and verifies its guards in the current revision.
Clients cannot submit inverse records. History lasts for the session.
The first service slice refuses clipboard operations until their persistence
adapter lands. It also refuses stale insertion boundaries and inline token
offsets, plus manifest and course targets. These refusals write no authored files.

Hosts using I4 pass `readerRoles: true` in the registry context. Other callers
may omit it to infer reader roles from prior identity snapshots. This flag also
applies when the first page introduces a reader title identity into an empty lesson.

## Ranges and identity

Offsets are half-open UTF-16 ranges in the original decoded file. Source drafts
use LF; the registry writes changed text with the existing file's first newline
style through `preserveLineEndings`. It preserves Unicode spelling and all bytes
outside the planned edits. Copied and moved subtrees retain their authored body
bytes; insertion boundaries add the file's newline style.

A container draft includes its opener and body and excludes its final closer.
The saved closer stays in place. An empty draft deletes the entire node and one
adjacent blank line, preferring the following blank. Named deletion uses the
same range. Moving cuts the node span. Insertion adds blank separators at the
requested sibling boundary, preserving existing trivia and closers.

The registry reparses the changed file in place. A same-type result derives
`modify`; a valid changed type derives `convert`; several sibling nodes derive
`split`; whitespace derives `delete`. The split survivor has the highest
identity-owner lexical score, with ties going to the first result.

Contained invalid drafts derive `modify` and return diagnostics and pending
identities. New unmatched delimiters, page or item lines that escape the draft,
unclosed literals and changes to surrounding scopes return `escapes-range`.

Unchanged source ranges provide exact placement evidence. The identity owner
reconciles the remaining descendants for `editSource` and `setText`: exact matches
first, then the content-identity kernel's similarity thresholds and guards.
Below-threshold descendants get new IDs and their old IDs retire. `setText` with
`field: "text"` also edits a plain body's text, preserving its final line ending
and reconciling virtual fill-blank descendants.
Copies allocate IDs throughout their subtree; recorded moves preserve each
descendant ID. Inverse edits restore exact original bytes, and inverse mappings
restore the recorded identities. Guards protect written nodes, removed
identities and insertion boundaries.

Recorded `duplicateBlocks` keeps the original and allocates each copied ID.
External ambiguous duplicates keep provisional IDs and remain unresolved through
later edits and undo. Unchanged source placements cannot resolve that ambiguity.

Structural operations also own the item and container delimiters they remove
or add. Contiguous edits combine before inverse generation so restoring adjacent
deleted delimiters preserves their original order. If a move inserts at a
removed container's boundary, that insertion takes precedence over removing an
adjacent blank line.

The registry refuses stale revisions, mismatched expected text, ambiguous
references, overlapping targets and unsupported arguments before returning
edits. Keyboard moves stay among siblings and leave their parent at its ends.
Leaving a column places the block outside the columns container. Cross-file
moves return edits for both lessons in one transaction. Every source or identity
participant needs its own base revision; a stale second lesson refuses the whole
result before identity allocation. Hosts apply source, snapshots and clipboard
through their durable transaction service.

## Clipboard and pages

The context may include a cut record `{file, text, nodeIds, nodes}`. `nodes` holds
the recorded source mappings for the cut subtree, including descendants absent
from the current source. The result's `clipboard` is the next record or null.
Cut removes source and marks every removed identity `cut`; export omits them
without becoming blocked. The same source text returns in `clipboardText`.
Copy returns `clipboardText` without inserting or allocating source nodes.
Copy, another Cut, and Discard retire a waiting cut and preserve that retirement
in the operation's identity evidence. Duplicate does not replace the clipboard.

Paste compares its text with the record. A match restores the cut IDs with move
intent, consumes the record and requires both lesson bases for a cross-file paste.
The recorded canonical content and subtree revision must also match. Paste without
a matching record uses copy intent and allocates all IDs. A differing paste leaves
the existing cut waiting. Host storage may serialize the record across reloads.
Operations do not access the system clipboard or narration/state storage; consumers
follow the returned identity fates and unchanged IDs.

Page insertion and moves use file-root boundaries with `parentId: null`; their
neighbors are page IDs. Existing frontmatter remains before the first page.
An unstored parent or neighbour may instead use `parentRef`, `afterRef` or
`beforeRef`, with its corresponding ID field null. These are node references
with null `nodeId`, current tree path and fingerprint. A fingerprint must match
exactly one node; its path must also agree. ID/ref pairs refuse, and anchors
must remain adjacent siblings under their parent. Studio requires the current
file revision for insertion boundaries and never treats runtime display IDs
as write authority.
Title changes retain the page ID and persistent slug, adding a unique title alias.
Identity owns slug allocation and reserves historical slugs and aliases. Page moves
retain every subtree ID, slug and alias. Merge removes the selected title, absorbs
its page ID into the previous page and keeps all blocks in order with their IDs.
It adds a blank separator when deleting the title would join adjacent paragraphs.
Delete retires the page and its subtree. The first page cannot merge backward.

A successful result also carries `history`, containing original identity and
clipboard state, source snapshots and logical focus. `applyInverse` takes that
recorded result and current file bases, validates every guard, and computes source
edits from current ID anchors. Changed guarded slices or clipboard state refuse
all files. Unrelated edits and earlier page insertions may shift the offsets.
Inverse mappings restore cut status, page aliases, lineage and consumer metadata.
The returned inverse provides redo with the same checks. Hosts keep and apply
history entries; the registry returns only an in-memory plan.
