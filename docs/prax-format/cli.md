# Praxity Studio CLI

The headless CLI validates and exports grammar-4 projects. Use the bundled launcher or the standalone Node package. See [document structure](reference/document-structure.md) for lesson syntax.

Commands that need durable writes refuse before accessing project files when Node's `--permission` model is enabled, with code `EPERMISSIONMODEL`. Node blocks the file synchronization needed for safe saves even with filesystem write grants. Run durable writers, including `init`, `identity`, `edit` and `studio`, without `--permission`. The same conservative guard also refuses durable writers under `--permission-audit`, although Node permits synchronization in that diagnostic mode; run them without either flag. Read-only commands such as `inspect`, `comments list`, `narration status` and `recovery list` remain supported with read grants. Export also remains supported with read grants for its input and assets, write grants for its output, and `--allow-child-process` for PDF's Typst process. Export leaves course identity unchanged and uses atomic output replacement without the durable-write protocol. Ordinary unrestricted launches retain their existing durability guarantees.

When RUBATO_TOOLS_DIR is set, run `"$RUBATO_TOOLS_DIR/bin/praxity"` and `"$RUBATO_TOOLS_DIR/bin/typst"` instead of bare commands.

## Command

```sh
praxity init [<course-dir>] [--lang en|fr]
```

`init` defaults to the current directory. When the course folder is the folder
opened in VS Code, it hides `.praxity` and
`.praxity-write-*` recovery copies in VS Code through `files.exclude` and
`search.exclude` in `.vscode/settings.json`. It inserts only missing entries,
preserving comments, other settings and existing values. An explicit `false`
stays `false`, including matching patterns such as `**/.praxity` or
`**/.praxity/**`, with a notice naming the entry. Empty settings files are
accepted. Invalid or ambiguous settings refuse without changing them.
A matching `false` in either exclusion section prevents new hide entries for
that target in both sections.

To show these files again, set the matching entry to `false` or remove it from
`.vscode/settings.json`. Init preserves matching `false` patterns on reruns.
Init cannot read User settings reliably and never changes them. VS Code merges
object settings by key, and a workspace value takes precedence for the same key.
To let a User-level `false` take effect, set the workspace entry to `false` or
remove it. A different matching `true` pattern can still hide the same path.

`.praxity/` stays versioned in Git because it holds block identities. Inside a
Git work tree, `init` adds only `.praxity-write-*/` recovery directories and
`.praxity-transaction.json` to the course-scoped `info/exclude` rules, including
the shared metadata directory for linked worktrees. The summary reports editor
hiding or retained author choices for each target, and whether Git exclusions
changed, were already present, or were skipped outside Git. It never creates or
edits `.gitignore`, initializes identity, or removes recovery copies. Rerunning
leaves configured files unchanged. Read-only settings or Git exclusions refuse
with a nonzero exit and a message naming the file, without replacing it or
changing its permissions. Each file is written atomically. If a later write
fails, init reports any settings update that already completed.

Use `git status --ignored` to list recovery copies excluded by Git, or
`praxity recovery list <course-dir>` to find retained copies without the editor.

## Initialize content identity

Studio preserves the saved identity when opening changed source would retire IDs.
Read mode previews the current source without saving those IDs. Entering Edit text
lists the affected file, page, block label and its old line when known. The author
can continue by confirming that the course has not been published. This has the
same effect as `identity init --rederive --confirm-unpublished`. Close returns to
Read without changing identity. Undo the source edit to retain the existing IDs,
or run `praxity identity init <course>` to inspect the refusal. Additions that
preserve every existing ID still save identity without asking. While confirmation
is pending, identity-writing Studio RPCs refuse with `identity_retirement_pending`.
A source change after review requires a new review.
Duplicate-only and invalid results remain transient when Studio opens a course.
If a recorded edit makes a lesson invalid, Studio saves the source and reports
diagnostics. Its stored identity stays unchanged until the lesson parses again.
Invalid lessons do not block edits to valid lessons. Design-only metadata edits
also save invalid source while preserving its line endings and stored identity.
Duplicates alone do not trigger a retirement review. Background author refreshes
also render current source transiently. The next author write refuses until the
retirements are reviewed. Review changes keeps typed text available to copy and
requires explicit discard before navigating to the review page.
A full-source save that would itself remove saved content refuses and lists the
affected entries without changing storage. Keep that text or make the change in
the canvas, where Studio records the operation. This refusal does not send the
author to a review of unchanged disk source.
When duplicates coexist with retirements, Studio lists only the retirements and
uses the same mixed advice as initialization: make the text unique, run plain
initialization, and rederive remaining changes only if the course has never been published. Confirmation
remains unavailable, including through its endpoint, until ambiguity is resolved.
Previously saved provisional pending identities are discarded when the extra
copy is removed or reworded. They do not trigger a Studio retirement gate.

```sh
praxity identity init <course> [--rederive --confirm-unpublished] [--lang en|fr]
```

After writing a course by hand, run this command before exporting it. The folder
must contain `course.yaml`. The command resolves the complete lesson inventory
and records page and block identities in `.praxity/identity/` through the project
transaction. It preserves source bytes. Rerunning with current identity changes
no files and reports that identity is already current. Source errors refuse
initialization and name the lesson file and one-based line.

After adding blocks by hand, run plain `identity init` again. When the identity
resolver matches every saved block, it keeps their IDs and records fresh IDs for
the additions. This works for additions at the end or in the middle of a page.
Ambiguous duplicates refuse. Change or remove the extra copy, then run
`praxity identity init <course>`. The copy with unchanged text keeps the original
durable ID, including when pending identity was previously saved. Provisional
IDs discarded while settling a duplicate never count as learner-record retirements.
If several saved blocks had identical text and fewer copies remain, restore the
removed copy anywhere in the course, then initialize again. Only a course that
has never been published can instead use `--rederive --confirm-unpublished`,
giving those blocks new IDs.
When a duplicate accompanies other unmatched edits, make the duplicated text
unique, then rerun. The remaining edits require `--rederive --confirm-unpublished`
only if the course has never been published.
Adding items inside a container, such as an accordion item, choice option or
list entry, currently counts as a rewrite and can require re-derivation.

If a rewrite leaves existing blocks unmatched, or blocks have been removed,
the author of a course that has **never been published** can run:

```sh
praxity identity init <course> --rederive --confirm-unpublished
```

Re-deriving gives blocks new IDs. Learner records from any earlier published
version will not map to the new blocks. Without `--confirm-unpublished`, the
command refuses with that warning. Studio has no publication record; the flag
is the author's assertion that the course has never been published.
Before writing, the standalone CLI prints the warning and every block receiving
a fresh ID, plus every ID being retired, by lesson file, page and readable label.
Removed blocks retire their IDs; learner records for them stop mapping. A
deletion alone uses this warning without claiming that blocks receive new IDs.
The success JSON lists new blocks in `added[]` with `{file, page, line, label, id}`,
and retired identities in `retired[]` with the same fields plus `kind` and saved
`span: {start, end}` offsets. A retired line is exact only when the saved source
hash matches the current source; otherwise `line` is `null` and the notice
shows "unknown". Schema 1 snapshots do not retain the original source or lines.
Matched IDs remain unchanged; stale records are retired through the identity
transaction. Repeating the command with current identity writes nothing,
returns `added: []` and `retired: []` and says no blocks receive new IDs.
Invalid source takes precedence over duplicate and rederive advice, in both init
and export. Export names the source file and line without listing added blocks.
Missing or corrupt established identity requires
recovery; re-deriving cannot bypass that check.

For an external duplicate of a block with an existing ID, keep one copy's text
unchanged and remove or reword the extra copy, then run initialization again.
The unchanged text keeps the original ID, including after saving the
pending duplicate. If several identical copies already had durable IDs, reducing
their count remains ambiguous. Restore the missing copies to their saved count,
then run initialization again. Those block and part IDs bind in saved source order
even if other siblings were temporarily added, edited or reordered and later
restored while the copies were missing. Restoring the exact original source
resolves those copies on the first initialization. Identical blocks also keep
their IDs when moved between pages, containers or lessons, provided their total
copy count across the course stays the same. Missing copies can be restored at
the destination. Existing owners keep as many of their saved IDs as possible;
remaining copies bind by saved file and source order. A moved container keeps its
children's IDs under it. Parts bind under their matched owner. Pages and lessons
are excluded from this copy-count rule. Same-titled pages moved between lessons
cannot yet keep their saved IDs. Move the page back, then run
`praxity identity init path/to/course` to keep those IDs. Only if the course has
never been published, use
`praxity identity init path/to/course --rederive --confirm-unpublished`
to give those pages new IDs. Same-titled pages within one
lesson can also remain ambiguous because a title does not prove that their content
is identical.

Identity readers accept the optional per-node `canonicalVersion: 2` extension to
schema-1 snapshots. Missing versions remain legacy; unknown versions refuse.
Initialization still writes legacy descriptors by default. Older readers reject
the new field. This build parses the extension but refuses admission and matching
of version-2 records, without allocation or writes, until a
version-aware matcher is available.
Initialization reports `identity_init_failed`; the underlying store refusal is
`EIDENTITY` with cause `EIDENTITY_CANONICAL_VERSION`.

Stdout is JSON with `ok` and, on success, `changed`. Failures have an `error`
with `code` and localized `message`. Exit status is `0` for success, `1` for a
source, identity or filesystem failure, and `2` for invalid arguments. Messages
use English by default, or French with `--lang fr`.

If a committed initialization cannot finish journal cleanup, success JSON also
contains `cleanupError` with the cleanup failure. Exit status stays `0`: identity
was recorded. Keep the course folder and its recovery files, then reopen it in
Studio or run `praxity recovery run <course>` to finish recovery.

## Export a course

HTML and SCORM exports mark every new-tab link with a decorative external-link
icon and a visually hidden warning in the course language. This includes glossary
popovers, resource links and media fallbacks. Inline Markdown links have no
new-tab option; use a `button` block with `{newTab}`.

```sh
praxity export <project-dir> \
  --format html|scorm-1.2|scorm-2004|pdf \
  --output <file-path> \
  [--paper-size a4|letter] \
  [--include-answer-sheet] \
  [--allow-critical-a11y-issues]
```

The command exports the complete course in the order defined by `course.yaml`. It
does not export single lessons.

CLI export holds a strict read admission and never persists source or identity.
For unrecorded additions, the refusal names `praxity identity init <course>` and
lists the new blocks by lesson file, page and line. When existing blocks cannot
be matched, it names `identity init --rederive` and the unpublished-course
confirmation instead. Run the appropriate command explicitly, resolve any
reported errors, then export again.
Ambiguous duplicates alone get the same change-or-remove-the-copy route as initialization.
Duplicates combined with other unmatched edits require unique text first, then
the unpublished-course re-derivation route.

`--format` and `--output` are required. The output is the exact filename, and its
parent directory must already exist. HTML and SCORM formats produce a ZIP, so the
filename must end in `.zip`. The `pdf` format produces a single file ending in
`.pdf`. The command replaces an existing file only after the new one has been
built, so a failed export leaves the old file in place.

For HTML exports, set [`courseHomeUrl` in course.yaml](reference/course-manifest.md#lesson-order-and-navigation)
to choose where the glossary's "Back to the course" link and the Pages and Guided
"Back to course" actions go.
It accepts a relative URL or an absolute HTTPS URL and defaults to `index.html`.
Other export formats keep their existing navigation. Invalid values prevent the
course from loading in Studio and in CLI commands, including non-HTML exports.
Correct the field in `course.yaml` or remove it to load the course again.

Next and Previous move focus to the destination's first visible heading without
drawing a ring around it. Keyboard focus rings remain visible on interactive
controls and keyboard-scrollable main content.

In HTML and SCORM courses, an individual Check brings the revealed feedback and
its focused action into view after the reveal finishes. The scroll is always
instant. Scroll destinations stay clear of sticky navigation bars. Sidebar
collapse and expand icons retain their full contrast at rest.

## Open Studio

```sh
praxity studio <course> [--review] [--port <n>] [--no-open]
```

Studio prints its ready URL and serves the learner page in Read mode. `--no-open`
prints the URL without opening a browser. `--port` accepts a loopback port from
1 to 65535. Without `--port`, the OS assigns a port. A busy `--port` refuses startup.

With `--review --port N`, the separate learner listener prefers `N + 1000`, so
browser-local comment drafts survive a restart on the same browser origin. If
that learner port is out of range or any bind attempt fails, Studio uses an
OS-assigned learner port. The CLI prints an EN/FR notice on stderr. The collapsed
review toggle and composer warn that earlier drafts may be unavailable and new
drafts may not survive a restart.
Published comments remain in the course's review store on either port. Without
`--port`, both listeners use OS-assigned ports and browser drafts do not survive
an ordinary restart. The editor port itself never falls back.
Stop Studio with Ctrl+C.

`--review` requires a regular `course.yaml` file before opening review storage.
It enables local review comments for this process and creates private
storage on first use and keeps the same review ID across restarts. Each process
mints a fresh comments-only capability in memory. Corrupt, newer-schema or unsafe
review storage refuses startup with the storage error code. Missing
shipped review assets also refuse startup. Duplicate flags refuse.
With `--review --port <n>`, unsent comment drafts stay in this browser across reloads
and restarts. An edit made a moment before reloading can be lost, especially while
another tab is editing comments on the same page; text already saved is kept.

When the course is inside a linked Git worktree, `--review` prints a localized
stderr warning. Comments are stored inside that worktree and are deleted with it
by `git worktree remove` or `git clean -fdX`. The warning does not prevent startup.
Missing Git does not emit this warning.

Each review permits up to 1,000 threads; that cap limits creating threads, not
replies to existing threads. The 100,000-receipt mutation cap does not apply to
author replies or resolves. The 4 MiB state limit remains hard, with 512 KiB
reserved for author writes. Writes that would exceed an applicable limit refuse
with `limit_reached` without saving changes. There is no archive command in this
version.

The Read document carries captured page context and loads the shipped review
assets. Edit mode stays unchanged; its Read link returns to review-enabled Read
mode. Without `--review`, Studio behaves as before. Local feedback and its
capability never enter ordinary HTML or SCORM exports. `--lang fr` selects French
CLI notices.

## Edit source nodes

```sh
praxity inspect <course> --blocks
praxity inspect <course> --blocks --eligibility --json
praxity edit <course> setProperty --at lesson.prax#1.1 --arg name=tone --arg value=warning --json
praxity edit <course> moveBlocks --line lesson.prax:3-5 --arg direction=down --dry-run
praxity edit <course> setText --page Safety --block 1 --arg field=subject --arg text=Exit
praxity edit <course> setProperty --page lesson-03.prax:2 --block 1 --arg name=tone --arg value=warning
```

`inspect --blocks [--eligibility] [--lang en|fr]` prints schema-1 JSON with `transientIdentity` and `blocks`.
Each source node has `address`, `file`, `nodeId`, node `revision`, `fileRevision`,
`type`, `kind`, `label`, page name and slug, one-based `pageNumber` and `blockNumber`,
inclusive `startLine` and `endLine`, exact `source`, and `settings`.
`slug` is the live HTML export filename without `.html`, derived from the current
page title by the same formatter as export. Collisions are resolved across visible
pages in manifest lesson order, including reserved utility filenames. Hidden pages
and pages in unlisted lessons have `slug: null` because course export omits them.
`identitySlug` retains the identity store's allocated page slug, which survives
heading edits and changes only through an explicit identity slug rename. It is
separate from the export filename. This field is an additive schema-1 extension;
consumers should tolerate added fields. Page selectors fall back to identity slugs
for compatibility when no current title, export slug or page number matches.
`file` identifies the lesson. `--eligibility` adds `operations`, the eligible
single-node operations from registry probes. These probes plan edits against the
course and can be expensive on large courses. The default omits `operations`
and skips the probes. Schema settings remain available in both modes.
Settings include the grammar declaration's
type, values, bounds, default and helper where present, plus the current lexical
`value` or null. Inspection never initializes identity or changes files.

Addresses use a lesson-relative file path, `#`, and one-based tree child indexes.
`lesson.prax#1.2` names the second child of the first root child. With frontmatter,
the first page is the second root child, so that block is `lesson.prax#2.2`.
Additional indexes address nested items and blocks. Addresses and lines describe
the inspected revision. Persisted UUIDs continue to identify a node after a move. IDs allocated
by read-only reconciliation are provisional until an operation persists identity.

Supply exactly one selector: `--at <address|uuid>`, `--line <file:line[-end]>`,
`--page <title|slug|number|file:page> --block <number>`, or `--find <literal-text>`.
Use `--page lesson-03.prax:2` to select page 2 in that lesson. The lesson path
is relative to the course root and must match an admitted `.prax` lesson exactly,
including case and spacing. Absolute paths, traversal, backslashes and colons in
lesson paths are refused. Course admission refuses lesson symlinks, including links
escaping the course. The page number after `:`
must be a positive whole number. Bare page numbers still work when unique, including
in a one-lesson course. If several pages match, the refusal lists each
`<lesson file>:<page>` selector and page title, before checking the block number.
The JSON refusal includes the same choices in `candidates[]`, each with `selector`
and `title`. Reuse a returned selector with `--page`; no block inspection is needed.
Unknown lesson files and page numbers return `orphaned` with a specific message.
A selector ending in `:<number>` that matches no page title or slug reports the
unknown lesson, even when its filename has a wrong extension, trailing slash or space.
Page numbers follow the grammar reader's pages within each lesson, excluding
frontmatter and including pages with `{hideTitle}`. Block numbers count a page's
direct source children represented in the grammar page model, excluding `nav:`,
generated title headings and frontmatter declarations. A source child projected
into several renderer blocks still counts once. Inspection prints these same
numbers; `blockNumber` is null for pages, metadata parts and nested children.
A line range uses one-based whole-file lines and resolves to the deepest node
containing the entire range, including a copied reference for an agent. Literal
find excludes pages and must match exactly one node. Repeated page names or find
matches refuse; use a qualified address. A new course can edit a unique fingerprint
without first writing identity. Ambiguous provisional fingerprints refuse.

Repeat `--arg k=v` for operation arguments from the [operation reference](reference/operations.md).
Values that parse as JSON retain their JSON types. Other values are strings.
To supply a literal string such as `true`, pass a JSON-quoted string. Duplicate
argument names and selector combinations refuse. This slice supports one existing
source node per invocation. Single-node eligibility is probed through the registry;
operations requiring insertion points, inline guards, several nodes or persisted
clipboard state are unavailable. `--batch` refuses the whole invocation before
applying any member. Atomic batch support needs a service adapter.

For annotations, `praxity inspect <course> --text-fields --json` returns only
the schema, transient identity status, whole-file revisions in `files[]`, and
`textFields[]`. It skips the per-block operation eligibility probes.
`praxity inspect <course> --blocks --json` also skips the probes and returns
`textFields[]` from the canvas binding owner. Each entry has the rendered `nodeId`,
lesson `file`, `field`, source `ownerId`, source `kind`, current raw inline `text`,
character `range`, whole-file `fileRevision`, and a part `name` where applicable.
Authored assessment feedback also carries optional presentation data in `feedback`:
sanitized learner `html`, placement by option ID or question block ID and result,
and `alsoIncorrect: true` for option feedback promoted to the incorrect result.
Every option's nonempty feedback is admitted. Shared result bindings keep their
separate rendered IDs, with presentation on exactly one binding per source owner.
Promoted option feedback uses the learner's paragraph-wrapped HTML. Strict export
accepts identity stores written before the author-only `option-feedback` records
existed, without writing an upgrade. Learner-data IDs, including caption locators,
must still be persisted.
Only admitted fields with exactly one authored owner appear. Generated page titles
have their own rendered ID and can appear here without an entry in `blocks[]`.
Use `--blocks --eligibility` when you need operation eligibility. `--eligibility`
is refused with `--text-fields`.

Join an annotation by exact rendered `nodeId` and lesson `file`, requiring exactly
one match. Use that entry's field and revision:

```sh
praxity edit . setText --at <rendered-node-id> --rendered --arg field=<field> --arg text='"Revised text"' --expect-revision <fileRevision> --dry-run --json
```

After reviewing the dry run, repeat without `--dry-run`. Rendered-field edits use
the canvas's descriptor, expected-text and whole-file guards. They preserve source
bytes outside the field and update identity snapshots and the lesson head. No
other `.praxity/` files change. Missing, ambiguous, forbidden, structurally changed and stale
targets refuse without writes. No bearer token is needed. Ordinary source UUID
selectors retain their existing behavior, including when their IDs coincide with
rendered IDs. `--rendered` explicitly selects rendered-field admission for `setText
--at`; it requires `--expect-revision`. Rendered-only IDs use that admission even
without `--rendered`. Source addresses remain available for source operations.

`--expect-revision <sha256>` binds the selected lesson's `fileRevision`, not its
node revision. S1 checks it inside admission and refuses a stale revision even
when the selected node is unchanged. Without that option, S1 can rebase an
unchanged node by UUID. `--dry-run` plans through the same service without writing
source or identity. Successful writes install source and identity in the same
journal transaction. Edits never create or update `.praxity/review/`; existing
review files stay untouched, including retired run metadata.

Use `--lang en|fr` for messages; English is the default. Its position does not
affect the language of argument errors or unsupported-batch refusals. `--json`
prints one schema-1 object. Success has `schema`, `ok: true`, `dryRun`, `operation`, `files`,
`intent`, `mapping`, `summary`, `diagnostics` and `focus`. Those operation fields
follow the shared operation contract. Refusal has `schema`, `ok: false`, `code`
and localized `message`; operational failures also have `details.reason`.
The strict consumer schema is `apps/desktop/src/shared/edit-cli-schema.ts`.
Session transaction IDs, history IDs and executable inverse records are omitted.
Newly allocated identities can differ between dry runs.

The exit-code table is owned by `editExitCodes` in `apps/desktop/src/main/edit-cli.ts`
and printed by `praxity edit --help`.

| Exit | Result |
| --- | --- |
| 0 | Acknowledged operation or plan |
| 1 | Filesystem or operational failure, `failed` |
| 2 | Invalid arguments, `invalid-args` |
| 3 | Target orphaned or not found, `orphaned` |
| 4 | Ambiguous target, `ambiguous` |
| 5 | Stale expected revision, `stale` |
| 6 | Operation or target not allowed, `not-allowed` |
| 7 | Selected source changed, `conflict` |
| 8 | Edit would escape the selected source range, `escapes-range` |
| 9 | Empty text, `empty-text` |
| 10 | A single-line field contains a line break, `line-break` |
| 11 | Text would change block structure, `unsupported-syntax` |
| 12 | Text would become a list item, `list-marker` |
| 13 | Braces would become heading settings, `settings` |
| 14 | Selected lesson has invalid source, `source-invalid` |
| 15 | Selected lesson has malformed frontmatter, `bad-yaml` |
| 16 | Saved content was removed without a recorded operation, `identity-retirement-pending` |

For page titles and headings, `setText` removes spaces and tabs at the start and
end of the supplied subject. Interior whitespace and paragraph edge spaces stay
unchanged. Text that would become a list item or heading settings is refused.

A journal cleanup warning after a committed write still returns `0` and reports
the warning on stderr.

## Review comments

```sh
praxity comments list <course> [--status open|resolved] [--page <pageId>] [--json] [--lang en|fr]
praxity comments reply <course> <threadId> --text-file <path> --expect-version <n> --request-id <uuid> [--json] [--lang en|fr]
praxity comments resolve <course> <threadId> --reply-file <path> --expect-version <n> --request-id <uuid> [--json] [--lang en|fr]
praxity comments reopen <course> <threadId> --expect-version <n> --request-id <uuid> [--json] [--lang en|fr]
```

These commands use the course's existing local review, including while Studio is
running. If no review exists, `list` returns an empty snapshot with `reviewId: null`
and `changeSeq: 0`, without creating one. Mutations refuse `not-initialized`.
A review whose first initialization is unfinished refuses `recovery-required`;
listing never repairs that storage or treats retained state as an empty queue.
That refusal has `detail.reason: "unfinished-init"`. Open the course in Studio
with review enabled to finish setup, then retry.
The CLI obtains the stable local principal from the store with the `author` role
and `local-cli` provenance. Flags cannot select a principal, role or display name.
Review storage and request IDs stay scoped to the admitted review.

Every comments command prints a localized stderr warning when the course is
inside a linked Git worktree, including with `--json`. The comments live inside
that worktree and are deleted with it by `git worktree remove` or `git clean -fdX`.
This warning does not change the command's result or exit code. Main checkouts
and missing Git do not emit it. The 1,000-thread cap limits creating threads;
replies to existing threads remain available. The 100,000-receipt mutation cap
exempts author replies and resolves. All writes remain subject to the hard 4 MiB
state limit, including the 512 KiB author reserve. A write that would exceed an
applicable limit refuses with `limit_reached`; reads remain available.

The course argument must name a directory containing a regular `course.yaml`.
Missing paths refuse `course-not-found`; file arguments refuse
`course-not-directory`; absent manifests refuse `course-manifest-missing`;
non-file or symlinked manifests refuse `course-manifest-not-file`. These checks
happen before opening review storage. Relative paths, `.`, and symlinked course directories
are accepted. A non-course child directory never becomes an empty review list.

`list` defaults to every visible thread, including resolved threads, in creation
order. `--page` selects a stable anchor page ID. It collects pages of at most 100
threads into one consistent snapshot. A concurrent change between pages restarts
collection from the beginning, for at most three attempts, then refuses
`snapshot_changed`. A complete JSON result larger than 8,388,608 UTF-8 bytes,
excluding its final newline, refuses `list-too-large` with the bound in `detail`.
Visibility changes that invalidate the CLI's own cursor also restart collection
within that same attempt bound. Filters can reduce some results, but cannot
make an included thread fit if that thread alone exceeds the size limit.
It never returns a partial list,
drains comments or updates review records. Visibility is applied by the store
before paging and counts. Text output prints the visible count and each thread's
ID, localized current status and version.
Agent-facing text escapes C0/C1 controls, bidi controls and zero-width characters
as visible `\u{XXXX}` sequences. JSON uses `\uXXXX` escapes for those characters;
decoding the JSON restores the original text. Stored bytes are unchanged.

`reply` appends a message. `resolve` atomically appends a reply and resolves the
thread. `reopen` opens it without a message. Mutations require a positive safe
integer `--expect-version` and canonical lowercase UUID `--request-id`.
A stale version refuses with `detail.currentVersion` and makes no change.
Reread the thread before deciding whether to resolve newer feedback.

Message text comes only from `--text-file` or `--reply-file`, never argv. Files
must be regular readable UTF-8 files containing 1 to 2,000 UTF-16 code units of
text, with at least one non-whitespace character. BOM, spaces and all line endings
are preserved, including trailing newlines. Reads are bounded to 6,001 bytes to
detect inputs exceeding the body limit without reading an unbounded file.
Message bodies accept CRLF pairs unchanged; a lone CR and other C0 controls
except LF and TAB refuse `invalid_input`. Quotes, titles and other review
free-text fields still refuse CR, including CRLF pairs. No normalization occurs.
All new free-text input refuses C1 controls U+0080 to U+009F. Message bodies also
refuse bidi overrides U+202A to U+202E and isolates U+2066 to U+2069. Quotes and
labels may retain these bidi characters for RTL text. Existing records containing
these characters remain readable.
Missing, unreadable, empty, whitespace-only, oversized and malformed UTF-8 files
have separate codes. UTF-8 bytes attempting to encode a surrogate have the
`lone-surrogate` code. Files are data and are never evaluated.

Retain the exact request UUID, version and message bytes when an acknowledgement
is lost. An identical retry adds nothing and returns `replayed: true`. Its `thread`
is current, including later replies, status and version. Its `receipt` records
the original operation's outcome, so its version can be older than `thread.version`.
Changing the command, version, thread or body under the same request ID refuses
`request_id_reused`. Receipts contain outcome references, never copied message bodies.
Mutations return only the visible target thread and outcome, without the review
state, other threads or a review change sequence. An invisible target refuses
`not_found`. If the operation makes its target invisible, success has `thread: null`;
text output acknowledges the operation without guessing a hidden status.

With `--json`, stdout contains one schema-1 object followed by a newline and
stderr is empty. Keys and codes are independent of `--lang`. Without `--json`,
success goes to stdout and a localized refusal goes to stderr. Raw filesystem
errors, absolute host paths and credentials are never added to output. Authored
message and anchor data are returned as stored.

List success:

```json
{ "schema": 1, "ok": true, "reviewId": "<uuid>", "changeSeq": 12, "threads": [] }
```

Each thread contains `id`, `reviewId`, `anchor`, `status`, `version`, `createdAt`,
`updatedAt`, `messages` and nullable `resolution`. The anchor contains nullable
`courseId`, `lessonId`, `pageId`, `nodeId`, `blockId`, `revision`, `quote`, `pin`,
`tab` and `cssPath`, ordered `revealPath` and `context: { pageTitle, targetLabel }`.
Messages contain `id`, exact `body`, `actor: { id, displayName, role }`, `at` and
`provenance`. A resolution contains `actorId` and `at`.

Mutation success:

```json
{
  "schema": 1, "ok": true, "reviewId": "<uuid>",
  "thread": "<current thread object>",
  "receipt": { "threadId": "<uuid>", "version": 3, "messageId": "<uuid or null for reopen>" },
  "replayed": false
}
```

`thread` is the current visible thread object or `null`. A post-commit storage
cleanup warning adds `cleanupPending: true`; raw cleanup errors are omitted.
Text output reports that warning on stderr while keeping exit 0. JSON stderr stays empty.

Refusal:

```json
{ "schema": 1, "ok": false, "code": "stale_version", "detail": { "currentVersion": 4 } }
```

`detail` defaults to `{}`. Domain validation may include a schema field `path`,
which names a schema field rather than a filesystem path.
Argument refusals name a recognized failing option in `detail.flag`; invalid
thread IDs use `flag: "<threadId>"`. UUIDs must use lowercase spelling.
Size refusals include `limit` and `unit`, either
`utf16` or `utf8-bytes`. Exhausted snapshot collection includes `attempts: 3`.
Storage errors omit their private paths and causes.

`praxity comments --help [--lang en|fr]` prints the four command lines above and
the following code line, translated in French. The exit table and help are owned
by `commentsExitCodes` in `apps/desktop/src/main/comments-cli.ts`.

```text
Comments exit codes: 0=ok, 1=failed, 2=invalid-args, 3=stale_version, 4=not_found, 5=forbidden, 6=request_id_reused, 7=wrong_review, 8=invalid_input, 9=snapshot_changed, 10=invalid_cursor, 11=text-file-missing, 12=text-file-unreadable, 13=invalid-utf8, 14=empty-text, 15=whitespace-only, 16=text-too-large, 17=lone-surrogate, 18=list-too-large, 19=corrupt-json, 20=invalid-state, 21=newer-schema, 22=unsafe-path, 23=read-only, 24=disk-error, 25=interrupted-write, 26=tracked-storage, 27=not-initialized, 28=busy, 29=recovery-required, 30=git-unavailable, 31=filesystem-unsupported, 32=course-not-found, 33=course-not-directory, 34=course-manifest-missing, 35=course-manifest-not-file, 36=limit_reached.
```

| Exit | Code | Meaning |
| --- | --- | --- |
| 0 | `ok` | Acknowledged result |
| 1 | `failed` | Unexpected operation failure; no successful acknowledgement |
| 1 | `EPERMISSIONMODEL` | General host refusal before `comments reply`, `resolve` or `reopen` when Node's Permission Model is present, as described above |
| 2 | `invalid-args` | Missing, duplicate, unknown or malformed arguments |
| 3 | `stale_version` | Thread changed; current version in detail |
| 4 | `not_found` | Thread absent from this review |
| 5 | `forbidden` | Principal lacks permission |
| 6 | `request_id_reused` | Request ID reused for different input |
| 7 | `wrong_review` | Request belongs to another review |
| 8 | `invalid_input` | Domain admission refused input |
| 9 | `snapshot_changed` | Snapshot collection exhausted three attempts |
| 10 | `invalid_cursor` | Not emitted by list; its own cursor refusal restarts collection |
| 11 | `text-file-missing` | Message file absent |
| 12 | `text-file-unreadable` | Message file unreadable or not regular |
| 13 | `invalid-utf8` | Invalid UTF-8 bytes |
| 14 | `empty-text` | Empty message file |
| 15 | `whitespace-only` | Message contains only whitespace |
| 16 | `text-too-large` | Body exceeds 2,000 UTF-16 units |
| 17 | `lone-surrogate` | Surrogate encoding incompatible with UTF-8 |
| 18 | `list-too-large` | Complete result exceeds 8,388,608 UTF-8 bytes |
| 19 | `corrupt-json` | Storage JSON or UTF-8 corrupt |
| 20 | `invalid-state` | Invalid or inconsistent persisted state |
| 21 | `newer-schema` | Manifest or state requires a newer Studio |
| 22 | `unsafe-path` | Linked or aliased review storage |
| 23 | `read-only` | Store not writable |
| 24 | `disk-error` | Disk failure |
| 25 | `interrupted-write` | Interrupted persistence |
| 26 | `tracked-storage` | Reserved for Git admission of tracked review storage |
| 27 | `not-initialized` | No local review exists |
| 28 | `busy` | Store lock/admission is busy |
| 29 | `recovery-required` | Course recovery required |
| 30 | `git-unavailable` | Reserved for unavailable Git admission |
| 31 | `filesystem-unsupported` | Filesystem lacks required persistence guarantees |
| 32 | `course-not-found` | Course path does not exist |
| 33 | `course-not-directory` | Course argument is not a directory |
| 34 | `course-manifest-missing` | Course directory has no course.yaml |
| 35 | `course-manifest-not-file` | course.yaml is not a regular file |
| 36 | `limit_reached` | Review storage or activity limit reached; no changes saved |

## Review narration

Before accepting a recording, check [add narration to graphics](skill/learners.md#add-narration-to-graphics).

```sh
praxity narration status <project-dir>
praxity narration accept <uuid:role> --project <project-dir>
praxity narration attach <uuid:role> assets/recording.mp3 --project <project-dir>
```

Status prints JSON lists of flagged and unresolved targets without changing files.
Use the returned `uuid:role` target for accept or attach. Without `--project`, those
commands use the current directory. Targets must belong to saved grammar-4 nodes;
unknown or unresolved targets are refused.

Accept clears the current review flag while retaining the recording and its
original `audioFor`. The `acceptedFor` field records the script and settings the
author accepted. Later source, script, language, voice or speed changes flag it
again. Attach links an existing file under project `assets/`; absolute paths,
traversal, missing files and links escaping the project are refused.

Both commands write `narration.yaml` through the project journal, preserve unrelated
entries and leave recording bytes unchanged. Exit status is `0` for success,
`1` for an operation failure and `2` for invalid arguments. The Studio Narration
panel uses the same v2 sidecar; save source changes before editing its targets.

## Merge content identities

```sh
praxity identity merge [<course>]
```

Run this during a two-branch git merge after resolving the `.prax` sources.
The course defaults to the current directory and must contain `course.yaml`.
The command reads the content identities at git's common base, `HEAD`, and
`MERGE_HEAD`, then merges them against the complete working source inventory.
Existing identities must be committed on both branches.

Disjoint edits and a lesson renamed on one branch and edited on the other can
merge automatically. Different edits to one block, competing UUIDs, and other
identity conflicts require an author decision. Conflicts name the lesson, page,
block and each branch's changes in English and French. A conflict writes nothing.

A successful merge installs snapshots, their complete ancestry, and lesson heads
in one durable file transaction, with heads installed last. Source bytes and line
endings stay unchanged. The command uses only read-only git commands. It leaves
git's index and merge state untouched. Review and stage the identity files before
finishing the git merge.

Stdout contains a JSON result. Exit status is `0` for success, `1` for a refused
or failed merge, `2` for invalid arguments, and `3` for identity conflicts or
unresolved source conflict markers. The conflict error code is `identity_conflicts`.
Outside a merge, the error code is `identity_not_merging`. Other failures use
`identity_merge_failed`. Merges with several `MERGE_HEAD` entries are refused.

## Review recovery copies

If recovery finds an outside edit, Studio keeps the current files and retains the
original, replacement and displaced bytes. Its recovery notice stays until you
resolve the retained copies.

```sh
praxity recovery list <project-dir>
praxity recovery extract <project-dir> <archive> <new-directory>
praxity recovery restore <project-dir> <archive> original <path>
praxity recovery resolve <project-dir> <archive>
```

`list` prints JSON with archive names, file hashes and status. Status `held` means
an archive kept by a restore until you explicitly resolve it. Use a returned archive name
for `extract`. The destination must not exist. Extracted `original/` and
`replacement/` directories contain the journal's exact bytes; `captured/` contains
all retained storage files, including outside edits captured during installation.
Unverified archives can also be extracted, with their bytes under `captured/`.
Malformed hold metadata reports `unverified`; safe retained storage can still be
extracted and explicitly resolved without blocking other archives from listing.

To keep block IDs after missing or corrupt identity files, restore the complete
`.praxity/identity/` store from a backup. When an archive contains the needed files,
`restore` copies one exact journal file back to its recorded project path. Choose
`original` for the pre-save copy or `replacement` for the proposed saved copy.
Repeat for each needed file. Before restoring, it holds the source archive until
you call `resolve`, including across later saves and identity cleanup. It creates
missing parent directories and saves displaced live bytes through the normal transaction.
If applying the restore fails after the hold is published, the archive stays held.
The refusal reports that hold and explains how to delete it with `resolve` when
you no longer need the archive.
An invalid journal, absent copy or unrecorded path refuses without writes. An
archive may contain only part of a store; it cannot reconstruct missing history
that it never captured.

Review the copies before calling `resolve`. That command deletes the named archive
under the project lock and keeps the current course files. Retry opening the course
to refresh the notice after resolution. It restores no files. If `narration.yaml`,
`.praxity/review` or `.praxity/content-identity.json` remains without the course
identity, identity setup still refuses. Restore the corresponding identity store.
Retrying without identity files or remaining evidence creates new block IDs.
To start a new identity deliberately, copy the course manifest, sources and assets
into a new directory without `.praxity/`, `narration.yaml` or recovery archives.
Keep the original directory.

## Export a PDF workbook

`--format pdf` produces a printable, tagged PDF/UA-1 study workbook. It follows the
course theme's colours and fonts, prints narration scripts after their slides, and
expands interactive blocks such as tabs, accordions and flip cards so every panel
is on the page. Questions print with space to answer. The workbook does not record
completion, attempts or scores.

- `--paper-size` sets `a4` (the default) or `letter`.
- `--include-answer-sheet` appends an answer sheet after the course content. It
  includes each question's authored answer and explanations. Leave it off for a
  learner handout.

These two options only apply to `--format pdf`. The PDF export runs entirely
offline, with the typesetting engine and fonts included in Studio.
The [Clear typography pairing](reference/frontmatter-design.md#typography) uses
Atkinson Hyperlegible Next, with regular body text and ExtraBold 800 headings.
HTML and SCORM exports bundle its fonts locally too.

A printed page can't react to a learner, so PDF export stops with an error when
the course uses logic rules (`if:`/`then:`), conditional visibility, variables or
answer piping, or branching action buttons. The error gives the lesson and block IDs.
Author a static version of that content to export a PDF. HTML and SCORM exports
are unaffected. Equations also need an authored text alternative before they print.

## Standalone package

An integrator can supply the standalone Studio package with Node 24.22.1. Keep
`praxity.mjs`, its generated chunks, `editor/`, `export-assets/`, `typst/`, and `node_modules/` together. Studio does not need
to be installed. The command and JSON results are the same:

```sh
node /path/to/studio-cli/praxity.mjs export /path/to/course \
  --format html --output /path/to/course.zip
```

## Project requirements

The input is a complete project directory with:

- `course.yaml`, including the ordered lesson list;
- every listed `.prax` lesson;
- any local files referenced under `assets/`;
- optional `praxity.json` export settings.

## Course cast

Declare shared dialogue speakers in `course.yaml`:

```yaml
cast:
  roger:
    name: Roger
    avatar: assets/roger.png
    voice: v1
    side: end
```

Each key starts with a letter and then uses letters, digits, `_`, or `-` without
spaces. Keys are matched case-insensitively to dialogue turns. `name` is required;
`avatar`, `voice`, and `side` are optional. `side` is `start` or `end` and fixes the speaker's bubble to that logical side. Change `name` to rename the displayed speaker
without changing the key used by lessons. Define speakers in the course cast; local speaker declarations are not supported.
Invalid sides warn and are ignored. Without a side, the first speaker in a dialogue uses start and other speakers use end.

Course and lesson settings take precedence over an immediate parent
`workspace.praxity.yaml`. Fixed defaults apply when neither defines a value.
`praxity.json` can also set a pass mark, `export.passingScore`, as a fraction such as
`0.8`. SCORM and xAPI exports then report passed or failed from the learner's score on
required questions marked `scored: true`, once every one has been answered.
`praxity.json` supplies the completion threshold when valid; otherwise the fixed
threshold is `1`, so learners must visit every page, including the last page.
Saved explicit thresholds keep their value. The command does not read Studio's
global settings.

The CLI resolves [identity sidecars](reference/content-identity.md) in `.praxity/identity/`. It does not add machine IDs to lesson source or course YAML. Preserve `.praxity` and narration.yaml with the project.

## Validate authored lessons

Run `praxity inspect <project-dir> --schema 1` to inspect parsed content and diagnostics. Run an HTML export to apply course, accessibility and asset checks before publishing. Inspect the affected pages in the result. Grammar errors identify the source line; resolve them before export. Inspection alone does not prove export readiness.

Grammar 3 requires conversion before a grammar-4 host reads it. The converter is maintained separately from the authoring format. This reference describes grammar 4 only.

## Machine-readable results

Each `export` run writes one JSON object to stdout. A successful export looks like
this:

```json
{
  "ok": true,
  "outputPath": "/absolute/path/course.zip",
  "format": "scorm-2004",
  "pageCount": 12,
  "accessibility": {
    "status": "passed"
  }
}
```

Failures use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "project_invalid",
    "message": "Missing course manifest: course.yaml"
  }
}
```

A PDF export also returns `diagnostics`: a list of conversion notices naming
the lesson and, when available, the block, such as media that has no transcript to print. Review them
before you share the workbook.

If a content block is empty or has unusable data, PDF export skips that block and
returns a localized diagnostic with a code, block ID, and page title when available.
Other blocks still print. The CLI also prints these diagnostics to stderr and exits
with status 0 when the export otherwise succeeds. PDF export still fails when
printing would expose answers, misrepresent branching content, break internal links,
or leave the PDF incomplete because of a compiler or asset error.

A SCORM 1.2 export also returns `scorm12Storage` with `atRisk`, `estimatedLength`
and `limit`. SCORM 1.2 gives a course 4,096 characters to save learner progress.
The estimate counts every page ID, one short answer per question and saved choice
state, plus room for other block state. It uses the runtime's lossless compression
for choice state and reserves that room before choosing the encoding. Mixed courses
retain the warning budget for reportable self-checks and open-text interactions.
When `atRisk` is `true`, the CLI prints a warning to stderr and still
exits with status 0. Learners in such a course may stop saving progress partway
through, so export SCORM 2004 when the LMS supports it. A choice submission that
cannot fit keeps the previous saved bytes and the editable draft. The learner sees
a localized not-saved notice and can retry without consuming an attempt. Unreadable
saved data is kept untouched and grants no current credit. All LMS-bound assessment
types keep editable drafts and show the notice while data is held. Draft recovery
uses tab storage for the same course, learner and damaged attempt, including
self-check drafts whose comparison remains unavailable. Completion and
score reporting are suppressed until a readable launch.

Human-readable failures, PDF diagnostics, override warnings, and SCORM 1.2 storage
warnings go to stderr.
Export emits no progress messages and sends no telemetry. `--help` and `--version`
return plain text.

Stable error codes are:

- `invalid_arguments`
- `project_not_found`
- `project_invalid`
- `accessibility_blocked`
- `export_assets_missing`
- `output_invalid`
- `output_write_failed`
- `export_failed`

Course practice admission failures include the source file, line, column and
diagnostic code in the message. `--lang en|fr` selects the author advice language
independently of the course language. Studio export RPC accepts an optional
`locale: "en" | "fr"` for the same advice, defaulting to English.

For write-distractors tracking or gating refusals, the Studio RPC returns error
code `practice-no-tracking`; the CLI returns `export_failed`. Private-choice
practice-only refusals retain `export_failed` in both hosts. The difference comes
from the RPC's explicit mapping of `practice-no-tracking` to a structured export
error; the other cases use the generic export failure handler. Their messages
retain the admission diagnostic code and source location.

`write-distractors` exports as optional, device-private practice. Native PDF creates a prompt-only workbook; `--include-answer-sheet` adds the author answers and labelled options. Course logic, required/gated containers, assessment groups and unsupported settings remain refused.

`highlight` publishes with limited support as optional, memory-only practice in HTML, SCORM 1.2/2004 and xAPI. It reports no marks, results, scores or completion. The CLI exports `html`, `scorm-1.2` and `scorm-2004`; xAPI uses the deployment API. Browser Print / Save as PDF prints the authored passage and complete Answer. `--format pdf` refuses before producing output, including `--include-answer-sheet` and hidden or nested highlight blocks. The CLI JSON preserves `error.code: "highlight-native-pdf-unsupported"` with exit status `1`. Course logic references to highlight, required/gated ancestors and assessment groups remain refused. Block narration and canvas text editing are unavailable.

Exit status is `0` for success, `1` for project or export failure, and `2` for invalid
command usage.

## Accessibility override

Export blocks critical accessibility issues by default. During the early alpha,
`--allow-critical-a11y-issues` permits an export after the checker runs. The success
JSON then reports `"status": "overridden"`, the critical issue count, and every issue.
The flag applies only to that invocation and cannot be enabled through project files.

## Inspect a course

`praxity inspect <project-dir>` prints the parsed course as one JSON object and
does not modify the project. Unlike export, it adds no IDs and writes no
identity sidecar. Other tools can read this output instead of
parsing `.prax` themselves.

```json
{
  "ok": true,
  "schema": "praxity-inspect/0",
  "studioVersion": "0.2.0",
  "warnings": [],
  "course": { "id": "…", "title": "Safety", "locale": "en", "description": null },
  "lessons": [
    {
      "file": "start.prax",
      "id": "…",
      "title": "Before You Start",
      "sha256": "…",
      "frontmatter": { "title": "Before You Start" },
      "pages": [
        {
          "id": "…",
          "number": 1,
          "title": "Welcome",
          "data": {},
          "blocks": [
            { "id": "…", "type": "heading", "line": 5, "data": { "content": "Welcome", "level": 2 } }
          ]
        }
      ]
    }
  ]
}
```

Lessons follow `course.yaml` order. `line` is the 1-based line where a top-level
block starts in its lesson file, or `null` when it cannot be located. Nested blocks
appear inside their container's `data`. Narration from `narration.yaml` is merged
into the page and block `data` it belongs to. `sha256` hashes the lesson source.
Dialogue blocks have `type: "dialogue"` and resolved turns in `data.turns`, including `side` when set.
`warnings` lists dialogue speaker resolution notices as `{ "blockId", "message" }`.

Schema `praxity-inspect/0` is experimental. Block `data` mirrors the parsed grammar
([block reference](reference/blocks.json)) and may change between Studio versions.
A project that Studio has never saved has no durable page or block IDs, so those IDs
change on every run; line numbers do not. Errors and exit codes match export.

### Typed inspection, schema 1

Opt in with `praxity inspect <project-dir> --schema 1`. Omitting `--schema`, or
passing `--schema 0`, retains the schema 0 shape above. Unknown versions, missing
values, duplicate flags, and malformed values return `invalid_arguments` with
exit status 2. The schema identifier, not `studioVersion`, selects the contract.
Consumers should tolerate added fields and reject unsupported schema identifiers.

Schema 1 returns `ok`, `schema: "praxity-inspect/1"`, `studioVersion`, `revision`, `warnings`,
`projectionVersion: 2`, `course`, and `lessons`. The projection marker identifies the expanded
evidence described below; old schema 1 producers omit it. Consumers must explicitly map
these additions and bump their own interpretation version when they start using them.
Course metadata retains schema 0's fields and adds `language`. Each
lesson contains `file`, `id`, `title`, `sha256`, `language`, `pages`, `narration`, and
`unlinkedNarrationCount` and `unlinkedNarration`. Each page contains `ref`, `id`, `number`, `title`, and
`blocks`. Pages use Studio's page splitter, which omits hidden pages.

#### Language provenance

Language evidence is an additive extension within projection 2. Existing fields,
including `course.locale`, keep their meanings. Older projection-2 producers omit
this evidence, so consumers that need provenance must check for these fields,
not just the projection marker. No projection 3 is required for these additions.

`course.language` records the manifest declaration separately from its fallback:

```json
{
  "declared": "en",
  "source": "manifest",
  "workspaceContext": "unavailable"
}
```

`declared` is the manifest's `locale` string or `null` when absent. `source` is
`manifest` when declared, otherwise `default`. A missing locale returns
`{"declared":null,"source":"default","workspaceContext":"unavailable"}` even
though the retained `course.locale` is `"en"`. It is not an authored English
declaration. Empty or unsupported strings are retained as declarations, not
validated or inferred language tags.

Every lesson adds `language: {"value":"en","source":"course"}`. `value` is
the resolved language. `source` is `lesson` for a nonblank frontmatter `lang`,
`course` for an inherited manifest `locale`, or `default` for the `en` fallback.
Lesson declarations are trimmed by the settings resolver. For an English course
with a French lesson, that lesson returns `{"value":"fr","source":"lesson"}`;
other lessons still return `{"value":"en","source":"course"}`.

Inspect does not load workspace settings. `workspaceContext: "unavailable"`
states that limit even when the project sits in a workspace. This producer never
reports a `workspace` source. Settings resolution with workspace context can use
that source, but the inspect command has no such context.

The top-level `revision` binds the course declaration and all lesson language
declarations, including manifest-only and `lang`-only edits. Associate language
evidence with that revision and each lesson's `file` and `sha256`. Declarations
describe authored metadata; they do not prove the language of every sentence.
Consumers must treat missing provenance from older producers as unknown.

A page's blocks form a flat preorder list, including nested blocks. `parentRef`
links a child to its containing block and is `null` at the top level. Each block
contains `ref`, `id`, `type`, `coverage`, `location`, and `texts`. Each text has
`ref`, `role`, `value`, `format`, and `location`, for example:

```json
{
  "ref": "lesson/start.prax/blocks/0/text/content",
  "role": "heading",
  "value": "<p>Welcome</p>",
  "format": "html",
  "location": { "file": "start.prax", "startLine": 5, "endLine": 6 }
}
```

Text formats are explicit. `html` preserves parsed markup, `markdown` preserves
inline grammar formatting, and `plain` needs no markup interpretation. These
values are inspection data, not trusted HTML for direct insertion into a page.
Choice prompt and overall feedback use HTML; option labels and option feedback
use Markdown. Feedback can occur both on an option and as the whole-question
fallback, matching Studio's choice adapter.

Inline node ranges, reference-spacing ownership and generated paragraph envelopes
are compiler data. They do not change these inspection formats or add fields to
learner block JSON. See [inline trees](reference/inline-formatting.md#inline-tree-for-tool-authors).
Exported choice signatures hash compiler facts and normalized visible text. Term
labels and highlighted or doodled words count, including partial marks. Definitions,
compiler footnotes, glossary entries, attributes and element boundaries do not.
Inspection output and saved-answer behaviour are unchanged until activation.

Choice content material counts each compiler icon by its name. Catalog paths,
paint and resolved versus unresolved display do not count. All questions receive
a hash. The derivation does not change CLI output or saved answers.

This version covers a bounded set of authored text:

| Block or content | Roles and coverage |
|---|---|
| Heading, body paragraph | `heading`, `body`; `coverage: "text"` |
| Choice, matching, ordering, categorization, fill-blank, free-response, matrix and hotspot assessments | `prompt`, description as `body`, `option`, `feedback`; `coverage: "text"` |
| Card, columns, accordion, tabs, sequence | Container/item labels as `heading`, descendants as separate blocks; `coverage: "container"` |
| Inline glossary in projected text | `glossary-term` as plain text and `glossary-definition` as decoded tooltip HTML |
| Media titles/captions, notes, quotes, tables, charts, stats, checklists, rating/signature labels, code, equations, buttons and assessment-group headings | `heading`, `body`, `prompt`, `option` as appropriate; `coverage: "text"` |
| Dialogue captions and turns | `body` as Markdown; `coverage: "text"` |
| Other blocks and unknown response types | `coverage: "unsupported"`; no claim that their prose was extracted |

Coverage describes the text projection. Layout and logic remain outside this contract.
Answer values embedded in fill-blank templates are replaced with `____`; dropdown
choices and word-bank entries are `option` text. Feedback, glossary definitions,
media alternatives and transcripts are separate channels, not visible prose. Supported descendants remain visible even inside an
unsupported parent. Glossary entries use Studio's collector, with the first
case-insensitive definition winning within each text field. Definitions and
terms remain associated with that field's source location. Schema 1 omits the
opaque parser `data`; consumers that need it can still request schema 0.

A schema 1 dialogue block also has `style` (`"bubbles"` or `"script"`),
`speakers`, and `turns`. `speakers` lists distinct speaker keys in first-turn order;
each entry has `key`, resolved `name`, boolean `avatar` and `voice` flags, and optional resolved `side`.
`turns` preserves all turns, including unattributed ones. Each has Markdown
`text` and a 1-based source `line` (or `null` when unavailable). Attributed
turns also have `speaker`; unattributed turns omit it. Turns with an explicit resolved side also have `side`. Paragraphs in a turn
are separated by a blank line in `text`. Unknown speaker notices appear in
the top-level `warnings` array as `{ "blockId", "message" }`.

`narration` lists the scripts resolved by Studio's narration helper, including
disabled candidates. Entries have `ref`, `role: "narration"`, `value`,
`format: "plain"`, `blockRef`, `pageRef`, `origin`, `disabled`, and `location`.
Studio's speech-text helper removes script emphasis and list markers while
preserving paragraph boundaries. `origin: "sidecar"` means the script came from
a linked sidecar override, whose location covers its authored `narration.yaml` entry. `origin: "derived"` uses
the owning block's location where available. Derived page-title narration has a block reference and source location when Studio
associates it with a matching source heading; otherwise both are `null`. An audio/settings-only sidecar entry does not
change script provenance. `unlinkedNarrationCount` reports entries that could
not be attached; their scripts are not silently added to the resolved list.
`unlinkedNarration` exposes their authored scripts and sidecar locations with
`blockRef: null` and `pageRef: null`. `unresolvedAnchor` gives the saved kind, type,
page number and label, not an asserted current link or raw internal AST. A missing
script is an empty value; Studio does not invent a script from an unresolved anchor.

#### Assessment evidence

An assessment block adds `assessment` with `responseType`, `correctness`,
`selectionMode`, `inputMethod`, and `scoring`. `correctness` is `keyed`, `open`, or
`unavailable`; it does not classify the pedagogical quality of the question.
Choice assessments also include `assessment.shuffle: boolean`, the effective
runtime option-order setting after course and lesson component defaults.
An explicit question setting wins over those defaults, including `shuffle=false`.
`true` shuffles the options; `false` preserves authored order, including when
`{shuffle}` is omitted and no component default enables it. This applies to
scored and unscored choices. Other response types omit the field.
This is an additive extension of schema 1, projection 2. Earlier projection-2
producers omit it; consumers must treat absence as unknown, not fixed order.
Choice options include `correct`; matching pairs include `prompt` and `correctMatch`;
ordering items have zero-based `correctPosition`; categories include their assigned
items; hotspots include shape, percentage coordinates and correctness. In schema 1,
`hotspots[].coordinates` uses `[left, top, width, height]` for rectangles,
`[centreX, centreY, radiusX, radiusY]` for ellipses, and flattened `x, y`
pairs for polygons. Point spots keep `[x, y, 6]`. Schema 0 exposes authored
regions as `data.spots[].shape` and `data.spots[].region`.
Fill-blank
assessments include `blankStyle`, a shared `wordBank`, and `blanks` with `answers`,
`answerRules` and `choices`. Duplicate bank entries are consumable occurrences.
Each answer rule declares `match: "literal"`
or `"wildcard"`; a wildcard also retains its authored pattern after the leading `~`,
including escapes for literal `*` or `?`. Typed comparisons normalize Unicode, case
and whitespace; selectable choices compare literal values. These records use deterministic snapshot
refs. Answer values are evidence only and must not be added to visible prose.
Matrix statements/scale points and open response types do not imply correctness.

`scoring.gradingMode` is the configured mode after project course/lesson component
defaults. Workspace configuration is outside this source inspection contract. `scored` reports whether the runtime
can emit a score; an all-open fill-blank remains completion-only even with configured
grading. `points` is the authored finite value or null; the runtime score maximum
when omitted is 100. `required` and `attempts` include runtime defaults; zero attempts
means unlimited. `feedbackMode` is authored or null. Ungraded keyed activities can
still check correctness. Open responses never acquire an inferred answer key.

Assessment-group blocks add `assessmentGroup` with `memberRefs`,
`unresolvedMemberCount`, `mode`, `requireAll`, `passingScore`, `pointsOverride`, and
`aggregation: "mean-of-scored-member-percentages"`. `oneOf` uses the selected member;
`all` uses the participating members. Open/completion-only members are excluded from
percentages. A null passing score means every checked member must pass. The
`pointsOverride` field is authored metadata, not a claim that the runtime applies it.

#### Media and recorded narration

Media-bearing blocks add `media`. Each item has `kind`, `source`, plain `alt`,
`decorative`, formatted `description`, `caption`, `transcript`, and `captionTracks`.
Absent text/source fields are null. Caption tracks retain source, language, label,
kind and default status. Transcripts are authored plain text, not extracted speech.
Track contents and remote transcripts are not downloaded or converted to prose.
Captions may also appear in visible block text; consumers must not count them twice.

Asset references have `uri`, `availability` (`present`, `missing`, `remote`, or
`blocked`), and `sha256` for readable local bytes, otherwise null. Studio reads only
referenced project files, confines reads through symlink resolution, and never
fetches remote URLs. A leading slash is a project asset path. Invalid schemes,
traversal, out-of-project symlinks and unreadable files are blocked.

Resolved and unlinked narration add `audio`, `timings`, `audioProvenance`, and
`duration`. Audio provenance records saved script/language/voice/speed; it does not
prove that an audio file exists or matches the current script. `duration: null`
means unknown, never zero. A stored duration has `seconds`,
`provenance: "sidecar-recorded"`, `measurement: "unknown"`, and
`isFullFileDuration: false`. Studio's generated duration is a synthesis alignment
endpoint; manual attachment clears duration. Persisted sidecars do not establish
which process produced a particular number, so this contract does not call it a
measured full-file duration or use it to assert a measured speaking rate.

#### Source coordinates and identity

Block and text locations refer to the original UTF-8 lesson file whose exact bytes
are hashed by `sha256`. Sidecar narration locations refer to their `narration.yaml`
entries. `startLine` and `endLine` are 1-based, inclusive line numbers, with
frontmatter included. Lines split at LF, including
CRLF files. There are no byte or JavaScript character offsets. Text locations
cover their owning block, not the exact substring. Containers cover their full
parser-recorded range. Nested body blocks retain their own ranges; choice
prompt/options/feedback share their assessment range. `null` means no authored
location is available. Non-ASCII text does not change line coordinates.

`ref` values are deterministic addresses within one inspection snapshot. Treat
them as opaque and correlate them only together with `revision`; inserting or
moving blocks may change them. They are not edit targets or durable learner IDs.
Studio resolves sidecar identities in `id`, but
unsaved pages and stateful blocks may have transient IDs that differ between
processes. Inspection never persists identities or upgrades identity sidecars,
and leaves a missing course or lesson ID as `null`.

`revision` is a SHA-256 fingerprint of schema 1's inspection inputs: normalized
course manifest and returned course metadata, producer `studioVersion`, ordered
lesson paths and source hashes, narration sidecar source, and persisted identity
sidecar source, projection version and referenced local asset availability/content hashes. It changes for relevant course metadata or sidecar-only edits even when lesson
`sha256` values stay the same. Sidecar formatting changes may also change it.
Fresh transient IDs are excluded, so inspecting unchanged inputs with the same
Studio version in separate processes gives the same revision and refs. A Studio
upgrade changes the revision because parser and narration behavior may change.
Media-only replacements and appearance/disappearance of referenced files change the
revision. Unreferenced assets and remote contents are excluded, as is the published
artifact. Do not modify files during inspection; concurrent edits are unsupported.

## Retained editor drafts

`praxity recovery list <course>` includes durable drafts from the retired editor. `praxity recovery export-drafts <course> <new-directory>` writes each draft's exact text as `draft-1.txt`, `draft-2.txt`, and so on. Its JSON result maps each output name to the stored draft ID and source file. The destination must be new and outside project metadata and recovery storage. Drafts and saved source remain unchanged, including orphaned drafts whose lesson no longer exists.

`recovery export-drafts` remains supported under `--permission` with read grants for the course and write grants for the destination. It uses read admission and creates new output files without fsync or changes to stored drafts.

`praxity studio` prints a retained-draft count and the recovery command on stderr when needed. The ready URL stays on stdout. `--lang fr` selects French notices.

Draft discovery is best-effort. Foreign filenames, sync conflict copies, malformed JSON and unreadable files never prevent Studio from starting. List and export results include `skippedDraftFiles`, with each skipped filename and a reason. If the draft directory itself cannot be inventoried, list still returns archives and a `draftsError`. Export copies readable drafts, preserves competing valid buckets, and refuses aliased storage or any existing destination directory, including an empty one. Nothing under `.praxity/local/` is modified or deleted.
