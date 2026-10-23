# Grammar 4 content identity

Grammar 4 source contains authored content and optional human logic names.
Opaque course, lesson, page, block and referenced-child UUIDs live in
`.praxity/identity/`. A fingerprint describes content; it is not an entity ID.

The pure `@praxity/content-identity` package owns the schema and matching rules,
including the file schemas, canonical descriptors, operation mappings and undo
interface. Hosts own file access and transaction durability.

Identity schema 1 stores `course.json`, lesson heads named by lesson UUID, and
immutable snapshots named by their canonical JSON SHA-256. Every snapshot has
the course namespace, lesson UUID, parent snapshot hashes, exact source hash,
and node records. Nodes retain ownership, order, source spans, canonical content,
fingerprints, revisions, status and lineage. Page records also preserve slugs and
aliases. The learner-state owner may supply consumer revisions.

Each node may include `canonicalVersion: 2`; absence means the legacy descriptor.
Course and head formats and snapshot schema remain at version 1. Parsers accept
mixed descriptor versions, reject unknown versions, and validate fingerprints
and immutable snapshot hashes as before. Writers still omit the field and use
legacy descriptors and matching. Older readers reject the extension as an unknown
field. Resolution, merge and host admission currently refuse every version-2
record until a version-aware matcher is available. The pure refusal code is
`EIDENTITY_CANONICAL_VERSION`; hosts wrap it in `EIDENTITY`. No IDs are allocated
and no files are written. Writers must wait until every reader and matcher of a
store supports it before emitting version-2 nodes.

For a new or hand-written course, `praxity identity init <course>` records the
complete current identity without changing source bytes. Repeating it with
current identity writes nothing. Invalid source reports its file and line;
pending conflicts and missing established identity refuse. Hand-added blocks
receive fresh IDs while every matched saved block keeps its ID. An edit that
leaves existing blocks unmatched requires explicit
`praxity identity init <course> --rederive --confirm-unpublished`. This assertion
is only for a course that has never been published. The command warns that
earlier learner records will not map to the new blocks, lists added and retired IDs,
and retires stale records in the existing transaction. It cannot bypass corrupt
or missing established identity. CLI export uses a strict read admission,
lists unrecorded additions and names the appropriate initialization route.
Recovery takes precedence over source errors, which take precedence over duplicate
and rederive advice. Duplicate and invalid-source refusals omit the added-block
list. Settling a provisional duplicate preserves the durable donor and discards
provisional IDs without listing them as learner-record retirements.
See the [CLI workflow](../cli.md#initialize-content-identity).

Reader projections without a separate source node are ordinary part records with
`reader-role:*` types. These include page-title blocks, question stems, pair answers,
generated rating levels and variables. Fill-blank projections use the blank node's
identity. The host enables reader-role descriptors; matching, retirement and
recorded undo remain in the identity owner.

Recorded modifications and moves keep IDs. Deliberate replacements and copies
get fresh IDs. A split keeps its chosen survivor; a merge records absorbed IDs.
Undo restores the recorded identities. These maps bind to both source and
snapshot revisions. Human names remain authored logic names, never UUIDs.

Exact matching never picks an ordinal winner after an external duplicate changes
multiplicity. Ambiguous nodes and invalid drafts remain pending, which blocks
publication. Cut nodes retain their IDs and attachments but are excluded from
export; an unpasted cut alone does not block publication. Retired identities stay
as history and do not enter automatic exact or fuzzy matching.

An ID active in the current head or any validated historical snapshot is durable.
A pending ID that has never been active is provisional. Provisional IDs supply no
matching or retained-placement evidence. One durable donor and one exact current
match settle to the donor's ID. Equal counts of durable and current identical
blocks or parts under a matched owner bind in saved span order to current source
order, even after other edits. Containers bind before their children, and reader
projections follow the same rule. With durability facts, equal-count block groups
also bind across owners after the other matching stages. Copies first keep IDs
under their matched saved owners, in source order. Remaining copies pair by file
path and source span. An unresolved owner with durable candidates must settle
first; an owner without candidates may receive a fresh ID. Children follow their
matched container. Parts never use this cross-owner group rule.
Pages and lessons are excluded. Tied saved
positions remain ambiguous. Settling previously pending groups requires supplied
durability facts. More current copies than durable members remain
pending; reducing two durable identical siblings to one also remains pending.
Restoring their copy count restores both IDs, including when a temporary removal
shifted later siblings. During an exact copy-count change,
unchanged siblings retain the complete saved order; source mappings retain their
current positions. Competing saved positions still block this proof. Page and
lesson descriptors exclude their children, so their matching titles or metadata
cannot use this restoration proof. Durable pending records remain eligible for
the usual lexical matching rules.

Lesson head paths identify lessons even when several pending lessons share
metadata. Pending pages compete by title only within the same saved lesson.
These namespace rules do not settle same-titled pages within one lesson.

Unchanged pending copies reuse provisional IDs in saved span order, so repeated
resolution writes no new snapshots. Unused provisional IDs become discarded
records with status `retired`, preserving the never-reuse rule without counting as
learner-record retirements. The identity owner's `isDurableIdentity(id, node,
activeHistoryIds)` classifies durability for callers. Without historical facts it
conservatively treats every ID as durable. Consumer revisions, narration targets
and review anchors protect referenced IDs even if they have never been active.
The host guards those artifact bytes, including absence, through identity installation.

External edits use same-kind/type lexical matching after exact matches. L is
half multiset token Dice plus half character-trigram Dice; matching normalizes
line endings, NFC, prose whitespace and case. S is `.70L + .20P + .10A`, where
P is a matched owner or a lesson's recorded path, and A is the fraction of two
matched neighbouring anchors. Owner-bound start/end and a unique unchanged
lesson/page label can supply anchor evidence. Reuse requires L at least `.80`,
S at least `.90`, and a mutual `.15` margin over every compatible competitor.
Ownerless moves require L at least `.96` and use the greater of S and L.
The shared whitespace set is Unicode `White_Space` plus U+FEFF. U+0085,
U+202F and internal U+FEFF fold to spaces; U+001C remains a character.
Fuzzy stages follow tree depth. Scores and anchors freeze before each stage's
winners bind; rejected siblings never retry against fewer candidates.

Before fuzzy matching, a split/merge guard blocks a donor of at least two tokens
and a chain of two or more adjacent same-type fragments under one owner.
Each fragment has at least one token and is smaller than the donor. Their
ordered, non-overlapping spans jointly cover at least 95% of the donor and
reach its first and last 5%. Recorded operations supply explicit survivors.
Whole unchanged descendants may retain their own exact identities.

Reconciliation cannot distinguish an external replacement from a typo with
identical bytes. Recorded replace/copy intent controls that decision. Rejected
scores and split/merge suspects receive fresh identities; ambiguous duplicates
and invalid drafts retain pending records for review.

Corrupt JSON, conflict markers, unsupported schemas, invalid graphs, duplicate
active identities and namespace mismatches fail visibly. Identity resolution
does not rewrite `.prax` bytes.

Studio opening a course persists only valid pure additions. Duplicate-only,
invalid and retiring resolutions remain transient. Read mode and background
author refreshes render the transient result. Author
entry lists the affected identities and requires an explicit assertion that the
course has not been published before applying re-derivation. Closing that page
leaves identity and snapshots unchanged. Additions that keep all prior identities
continue to persist silently. This gate and CLI initialization use the same
retirement classifier and re-derivation owner. Old source lines are reported only
when the saved source hash matches the current source; otherwise they are unknown.
Ambiguous identities that remain pending do not trigger the gate.
When ambiguity coexists with retirements, Studio refuses confirmation and asks
the author to make the text unique and run identity initialization, with the same
mixed advice as the CLI. It never uses
re-derivation to retire ambiguous originals through that gate.
Source errors alongside retirements produce a located repair message in the
same gate, with confirmation unavailable and Read mode still accessible.
Without retirements, an invalid lesson does not block ordinary author entry.
Old stores with accumulated provisional pending IDs settle through the same
owner classifier. Discarding those provisional IDs does not count as retirement
of durable content or trigger the gate.

The persistence owner refuses unrecorded durable retirements by default for every
caller. Recorded operations include descendants of explicitly deleted subtrees;
explicit removed lesson paths also count as recorded. The check uses saved input
from the operation base, so unrelated outside deletions cannot be hidden by an
intermediate resolution. Only confirmed re-derivation opts out explicitly.
Validation and source conflict checks precede retirement review.
Source drafts that introduce unrecorded retirements refuse separately from
outside losses. Their response lists the draft's affected saved content and
recommends keeping it or using a recorded canvas operation. Storage stays
unchanged; there is no review link for a change absent from disk.

The host supplies the complete lesson inventory. Cross-file block and page moves
use the same course-wide matching rules. A unique unchanged file at a new path
keeps its lesson and entire ordered tree, including repeated nodes, slugs and
aliases. Changed renames require conservative whole-lesson content evidence or
unchanged metadata with a completely conserved descendant identity graph.
Metadata alone does not identify an absent lesson. If the old path remains,
a new file equal to its saved source gets fresh IDs throughout, including when
the original is edited at the same time. Retired lesson IDs never return through
automatic matching.

`mergeIdentity(base, ours, theirs, documents, dependencies)` accepts three complete
course states, each containing the course namespace, lesson heads and their
snapshots, plus the parsed merged source. The host reads git's common base and
performs source merging. The pure package applies disjoint identity changes and
returns either a complete resolution or conflicts with no writable result.

Different edits to one block, delete/edit, competing UUIDs for one entity,
multiple entities claiming one UUID, incompatible metadata changes, parent cycles,
retired-ID reuse and source that omits or changes selected entities require
resolution. Identity merge does not choose a branch to settle these conflicts.
Lineage and historical aliases retain both sides' entries; the merged source
supplies order, spans and subtree revisions. Retirement survives an unchanged
branch, and restored content receives a new ID. Each merged lesson snapshot
records both branch head hashes as parents.

`praxity identity merge [<course>]` reads committed identities at the common git
base, `HEAD`, and `MERGE_HEAD`, and the merged working sources. The identity store
validates revision files with the same schema, ancestry and namespace rules as
disk reads. It installs the merged heads and snapshots, retaining both branches'
complete history, through one T1 transaction. Conflicts leave files unchanged and
produce English and French diagnostics with exit status `3`. The command refuses
outside a merge and never changes git's index or merge state. See [CLI](../cli.md).
