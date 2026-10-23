# Content identity

`@praxity/content-identity` owns course namespaces, lesson/page/block/part IDs,
canonical descriptors, reconciliation and operation fates. It performs no reads
or writes. The host supplies SHA-256 over UTF-8 text and an opaque UUID allocator.
Grammar 3 does not use this package.

```ts
const result = resolveIdentity(
  { course, parsedDocuments, priorSnapshots, priorHeads, operations },
  { allocateId, digest },
);
```

`parsedDocuments` contains `{path, tree}`, with a grammar-4 `AnalyzedLessonTree`.
Use `tokenizeLesson` and `analyzeLessonTree` with the schema's `getDefinition`.
Pass the current course's head snapshots, rather than its whole history.
`priorHeads` binds lesson paths to those snapshot hashes; it preserves the lesson
namespace through content changes and distinguishes an existing lesson from a
copied file. Without heads, only unambiguous exact descriptors provide evidence.
With `activeHistoryIds`, equal-count identical block groups can move across owners.
Copies keep as many IDs under their saved owners as possible; remaining copies
pair by file and source order. Containers bind before their children. Parts keep
their owner-scoped rules; pages and lessons do not use the block-group rule.
`mergeBase` validates historical snapshots. Competing heads for one lesson
are refused by resolution; use `mergeIdentity` for branch merging.

The result contains `course`, `heads`, `snapshots`, `mapping`, `inverseMapping`,
`sourceMappings`, `unresolved`, `exportIds` and `exportable`. All are in-memory
values. Hosts persist them through the transaction owner. Identity resolution
never changes source or the supplied parse/snapshot objects. A save with unchanged
source and node records reuses its immutable snapshot and head hash.

`createIdentityResolver(input, dependencies)` captures its own validated baseline
and returns `initial` plus `resolve(parsedDocuments)`. Supply the complete inventory
on each call. Matching source bytes reuse descriptors and the unchanged ordered
tree proof; changed lessons still compete against all course descriptors. A changed
inventory or unproven baseline runs the full resolver. The host must discard this
resolver when store bytes change. Returned objects cannot alter its retained evidence.

`createIdentityReadSession(dependencies)` provides explicit runtime continuity.
Each `resolve(input)` first resolves a separate `candidate` from the supplied
stored baseline, then returns a `view` with display bindings for the complete
inventory. The existing matcher proves continuations from the last read only.
Unchanged source retains its runtime bindings, including repeated nodes; changed
ambiguity and recorded replace/copy intent cannot select an old runtime winner.
The `runtime-read` view contains mappings, current node records and lesson source
hashes, with no persistable snapshots, heads or operation mappings. Its runtime
tokens use `rt-` followed by 32 lowercase hex characters and are disjoint from
candidate records. Supply `allocateRuntimeId` for deterministic read allocation;
when omitted, the session formats a separately allocated UUID as a runtime token.
The allocator's output must satisfy the runtime format. An absent store also gets
a runtime course and lesson namespace in the view, while the provisional durable
course namespace remains private to the candidate. After stored admission, `correspondence`
maps proven runtime continuations to durable IDs for author selection and drafts.
Durable ingress refuses runtime tokens by format, independent of session state.
Incoming operations, namespaces, node keys, parents, lineage and merge history
use the existing durable parsers. Private read matching accepts display IDs through
an internal mode that no public resolver or parser exposes. A stateless final check covers
outgoing snapshots, mappings, inverse mappings, unresolved references and export
IDs. Its refusal differs from the ingress refusal. Authored runtime tokens remain
ordinary content.
This correspondence is not lineage or write authority. Every result is owned by
its caller. Namespace replacement, `invalidate()`, resolution failure and
`dispose()` revoke continuity. A disposed session cannot resolve again. Hosts
must invalidate on admission/watcher errors and use separate sessions for drafts.
The desktop I4 integration remains a separate change; existing callers still use
the ordinary candidate resolver.

`createIdentityPlan(baseline, dependencies)` captures course, heads, snapshots and
reader options for one operation. `sourceHash(headHash)` shares the canonical
snapshot index with revision checks. `prepare(parsedDocuments)` copies the complete
course inventory and describes each document once, returning caller-owned
`descriptors` and `resolve(operations)`. Resolution uses private copies and keeps
snapshot, namespace, inventory and operation validation. Discard the plan after
the operation. It retains nothing across plans and supplies no disk admission proof.

Hosts using the grammar reader pass `readerRoles: true`. This adds virtual part
descriptors for page titles, question stems, pair answers, generated scale levels,
variables and split prose/code projections. `describeDocument(document,
{readerRoles:true})` supplies each projection's `readerRole` and `readerOwnerPath`
for the reader's `ids(node, role)` provider. Fill-blank roles bind to the existing
blank descriptors. Virtual paths append child indexes after source children;
operation placements and undo use those same descriptors. Role records use
`reader-role:*` types and the ordinary UUID allocator, status, lineage and matching
rules. A removed and later reintroduced role gets a new ID; a recorded inverse can
restore its retired ID. Resolution infers this mode when prior snapshots contain
role records. Tree-only callers and the history study keep their existing inventory.

## Files

`serializeIdentity` produces deterministic JSON with sorted object keys. Snapshot
filenames and head references are SHA-256 of that serialization. `sourceHash` is
SHA-256 of the exact UTF-8 source, including its BOM and line endings.

- `.praxity/identity/course.json`: `{schema:1, courseId:UUID}`.
- `.praxity/identity/lessons/<lessonId>.json`: `{schema:1, path, head:SHA256}`.
- `.praxity/identity/snapshots/<SHA256>.json`: `{schema:1, courseId, lessonId,
  parents:[SHA256], sourceHash:SHA256, nodes:{UUID:Node}}`.

`Node` has `kind`, `type`, `parent`, `order`, `canonical`, `matchText`, `label`,
`span`, `fingerprint`, `revision`, `status` and `lineage`. Kinds are `lesson`,
`page`, `block`, `part`; a part's type distinguishes items, options, pairs, steps,
turns, blanks and other child records. Pages also have `slug` and `aliases`.
`consumerRevisions.state` may hold `{signature:SHA256, epoch:number}`; the state
owner supplies that record, and I1 preserves it when identity continues.

Nodes may carry `canonicalVersion: 2`. Absence identifies the legacy descriptor.
Parsers accept mixed versions within schema-1 snapshots and reject other version
values. Fingerprint and immutable snapshot hash checks apply to both versions.
Resolution, merge and host admission refuse any version-2 record with
`EIDENTITY_CANONICAL_VERSION` until a version-aware matcher is available. Host
admission wraps that cause in its existing `EIDENTITY` refusal, without writes.
Writers still produce legacy descriptors and omit the field by default; matching
is unchanged. Older readers reject `canonicalVersion` as an unknown field, so a
writer must not emit it until every reader and matcher of that store supports it.

Snapshot `courseId` guards namespace mismatches independently of the heads.
Statuses extend the proposal with `pending` and `cut` alongside `active` and
`retired`. Cut records retain their IDs and descendants, are excluded from
`exportIds`, and do not block export. Pending records block export and retain
displaced identities for later resolution. Retired IDs never enter exact or fuzzy matching.

`parseCourseIdentity`, `parseLessonHead`, and `parseIdentitySnapshot` throw on
corrupt JSON, conflict markers, unknown schemas or fields, invalid IDs/hashes,
unsafe paths, invalid graphs, and namespace mismatches. Snapshot parsing accepts
`{courseId, lessonId, expectedHash, digest}` to verify its namespace and content
address. Resolution also checks global identity uniqueness and head hashes.

## Descriptors and matching

`describeDocument` reads G3/G5's tree and G6's inline semantics. It records
formatting, link destinations, glossary definitions, icons, variables, sources,
doodles, settings, heading levels, response keys and table cells. Schema types
normalize numeric and boolean settings. Names remain authored content. Matching
normalizes line endings and NFC; prose whitespace folds, while code/math content
retains whitespace. Runtime identities and consumer provenance never enter the
descriptor.

Lesson descriptors cover metadata; page descriptors cover the title/settings.
Their `revision` covers their whole subtree. Other nodes' descriptors cover their
subtree, so changed container contents need recorded operations or reconciliation
evidence. `matchText` contains semantic text for lexical comparison. It does not
become a public identity or a saved-answer compatibility signature.

Source mappings use the tree's child-index paths and original UTF-16 spans.
Frontmatter belongs to the lesson descriptor. Fill blanks use the existing
content-model blank parser, with G6 shielding code, variables and glossary terms.
Virtual blanks append child indexes after a body's real children; their character
ranges lie inside the body's tokens. Every addressable tree child has an ID.

Exact matching accepts unique course-wide descriptors, unique descriptors under
a matched owner, and entire unchanged sibling sequences with stable global
multiplicities. For blocks and parts under a matched owner, equal durable and
current exact-key counts bind in saved span order to current source order, even
when other content changed. This includes containers and reader projections;
pages and lessons are excluded. Tied saved positions remain ambiguous.
Settling previously pending groups requires supplied durability facts.
Adding an external duplicate never chooses an ordinal winner.
The old ID and provisional new IDs remain pending, with candidates in
`unresolved`. Invalid structural or inline drafts retain missing old records as
pending. This retention is deliberately conservative within the affected lesson.
Recorded placements for unchanged provisional copies cannot resolve an external
duplicate. Both those copies and the displaced donor remain pending.

Hosts may supply `ResolveIdentityInput.activeHistoryIds`, the IDs active anywhere
in validated history plus IDs protected by author artifacts. With that evidence,
never-active pending IDs are provisional and never participate in matching or
retained placements. Pending descriptors reuse provisional IDs of the same exact
key in saved span order. A unique durable donor binds the one remaining exact
match; discarded provisional IDs stay recorded as `retired` and never get reused.
`isDurableIdentity(id, node, activeHistoryIds)` is the shared classifier. Consumer
revisions also protect a record. Omitting history keeps the conservative behavior
that treats every ID as durable. Durable pending donors remain eligible for the
usual lexical matching rules. Two durable identical siblings reduced to one stay
pending; restoring the copy count restores both IDs even with other edits.
During an exact copy-count change, unchanged siblings retain the
complete saved order, including following anchors that temporarily shift. Source
mappings still describe the current positions. Changed fixed anchors, new content
or competing saved positions cannot preserve that proof. Pages and lessons cannot
use the pending ordinal escape because their exact keys exclude child content.

`lexicalScore(a, b)` implements L: half multiset word Dice plus half
multiset character-trigram Dice, with normalized whitespace/NFC, lowercase text,
Unicode letters/numbers and Unicode scalar trigrams.

The shared whitespace set is Unicode `White_Space` plus U+FEFF. U+0085 and
U+202F fold to spaces, including internal U+FEFF; U+001C remains a character.
This deliberately differs from Python's `str.split()` and the study's `\s`:
Python also folds U+001C through U+001F and does not fold U+FEFF. Descriptors,
lexical scoring and fragment detection share the same normalization.

After exact matches, reconciliation scores same-kind/type candidates with
`S = .70L + .20P + .10A`. P is a matched owner, or the recorded path for a lesson.
A is the fraction of two matched neighbouring anchors. A matched owner binds
start/end anchors; a unique unchanged lesson/page label supplies both hints.
Require `L >= .80`, `S >= .90` and a mutual `.15` margin against every compatible
candidate, including scores below either threshold. Ownerless moves require
`L >= .96` and use `max(S, L)`. Boundaries are inclusive; integer score weights
and one machine epsilon on margin subtraction prevent rounding from rejecting
exact equality. Fuzzy stages follow tree depth, so nested bodies and faces get
their owners' evidence. Each stage freezes its candidate scores and neighbouring
anchors before binding any winners. Each target gets one fuzzy decision;
rejected siblings never retry after winners deplete the candidate set.
The tree-depth stages extend the study's flat kind stages for grammar-4 nesting.
All unmatched compatible descriptors still compete in each stage's margins.

Before fuzzy scoring, the split/merge guard rejects a donor of at least two tokens
and a chain of two or more adjacent same-kind/type fragments under one owner.
Each fragment has at least one token and is smaller than the donor. Ordered,
non-overlapping fragments must jointly cover at least 95%, start within its
first 5% and end within its last 5%. The guard runs in
both directions. This deliberately strengthens the study's two-fragment guard
and its minimum 12-token donor and unique-occurrence/two-token/5-95% fragment
limits: 94/3/3, 96/4, 8/1 and one-word tails, including repeated words, get fresh
IDs unless a recorded operation chooses a survivor. A lost match costs a fresh ID;
a wrong match transfers learner answers or narration to different content. Whole
unchanged descendants may still keep exact identities. D8's registry chooses
its split survivor and passes it explicitly.

Recorded maps take precedence. Fresh mapped subtrees cannot steal old IDs.
Invalid descriptors and changed exact-duplicate buckets never enter fuzzy
matching. Rejected scores and split/merge suspects get fresh IDs; ambiguous
exact duplicates and invalid drafts retain I1's pending records. External
replacement can have the same bytes as a typo. The controlled test pins that
known wrong match; only recorded replacement intent distinguishes it.

## Course moves, renames and branch merge

Resolution needs the complete current `.prax` inventory. An omitted live file
cannot be distinguished from a rename by this pure package. The host must check
inventory completeness before calling it.
Block and page matching runs course-wide and keeps I2's ownerless `.96` threshold,
mutual margins, duplicate and fragment guards.

An absent lesson path and a unique unchanged source hash prove a rename, including
simultaneous renames of metadata-identical lessons. The whole unchanged file keeps
its ordered node IDs, including repeated siblings. Changed rename candidates use
the existing conservative matcher over whole-lesson semantic text. Unchanged
lesson metadata plus a completely conserved descendant identity graph also proves
a rename. Metadata alone never chooses an absent lesson when heads are supplied.
If the old path remains, a new file matching its saved source is a copy, even when
the original is also edited. Its entire tree gets fresh IDs. Slugs, aliases,
consumer revisions and lineage follow continuing IDs; retired lessons never
reenter automatic matching.

```ts
const merged = mergeIdentity(base, ours, theirs, parsedDocuments, { allocateId, digest });
if (merged.resolution) {
  // Persist merged.resolution through the host's transaction owner.
}
```

Each side is `{course, heads, snapshots}` for the complete course at that revision.
Only head snapshots belong here, not every immutable historical snapshot. The
caller obtains `base` from git's common base and supplies the already text-merged
parsed documents. The package neither reads git nor merges source bytes.

The result is `{resolution, conflicts}`. Conflicts contain `reason`, `ids`, and
an optional `field` or merged-source `file`/`path`. Reasons are `divergent-change`,
`two-ids-for-entity`, `id-claimed-by-entities`, `retired-id`, and
`documents-mismatch`. Any conflict makes `resolution` null, so there is no partial
result to install. Corrupt schemas, namespaces, fingerprints and head references
still throw, as they do during ordinary resolution.

Disjoint canonical-content, owner, lesson-path, slug and consumer-revision changes
merge by comparison with the base. Different edits to one block, delete/edit,
competing ownership and newly formed parent cycles require a decision. Lineage
and historical aliases retain both branches' entries. The merged source supplies
order, spans and subtree revisions. UUIDs allocated independently stay distinct;
ambiguous correspondence to merged source requires resolution. Missing or changed
selected entities produce conflicts rather than silently discarding branch work.
Retirement wins over an unchanged side; restored source allocates fresh IDs.
A branch claiming an ID already retired in the base is a conflict. Only recorded
inverse operations in ordinary resolution can restore historical identities.

Each resulting snapshot records the unique, sorted head hashes of both branches
for that lesson. The temporary reconciliation pool is never persisted or recorded
as a parent. New source-only entities use the supplied allocator. The later CLI
only needs to load the three complete states and merged source, call this API,
display conflicts, and install a successful result through T1.

## Leadership history gate after C2

Run from the repository root:

```powershell
pnpm exec tsx packages/content-identity/scripts/replay-history.ts C2-manifest.json report.json C2-proof-directory
```

The harness is ready; the full historical gate requires C2's five proven
grammar-4 conversions and occurrence maps. Build the manifest with this shape:

```ts
{
  schema: 1,
  snapshots: [{
    commit: "full study commit SHA",
    proofHash: "SHA-256 of the archived C2 conversion proof",
    sources: { "lesson.prax": "converted grammar-4 source" },
    occurrences: { "study node key": { file: "lesson.prax", path: [1, 0], kind: "block", type: "body" } }
  }],
  transitions: [{ old: "full SHA", new: "full SHA", pairs: { "new study key": "old study key" } }]
}
```

Keep snapshots chronological: `2e8f7677`, `c109fb1b`, `1dd9a0fd`, `da791a9b`,
`e7d96576`. Copy each transition's `old`, `new` and `pairs` from the study's
`gold.json`; the CLI pins their sorted-JSON hash and all five snapshots' study
key inventories. Include every study entity in each occurrence map, including
genuinely new entities. The converter must map
overlapping study entities to their actual converted addresses; additional
grammar-4 bodies/parts do not inflate the study's denominator.

Archive each C2 binding as `<proofHash>.json`, with its hash computed over the
exact UTF-8 file bytes. The CLI reads the supplied proof directory, or `proofs/`
beside the manifest if that argument is omitted. C2 must produce this record
alongside its full conversion evidence:

```ts
{
  schema: 1,
  commit: "full study commit SHA",
  checks: { semantic: true, literal: true, publishedOutput: true, mutations: true },
  sourceHashes: { "lesson.prax": "SHA-256 of exact converted source bytes" },
  occurrences: { "study node key": { file: "lesson.prax", path: [1, 0], kind: "block", type: "body" } },
  aliases: [{ keys: ["overlapping study key", "study node key"], reason: "C2's explanation of why these entities convert to one node" }]
}
```

Use `aliases: []` unless conversion evidence justifies an alias. Each alias
must name exactly the whole group sharing one address and give a nonempty
reason. Occurrence kind/type describes the converted node, not the old grammar.
The archive is evidence from C2; a manifest cannot create or change that evidence.
The replay verifies file hashes, commit, passed checks, complete source hashes,
complete occurrence bindings, converted node kind/type and duplicate addresses.
Missing proof files and changed bindings fail before identity resolution.

The harness resolves all source nodes and scores only those labelled study
occurrences. Invalid converted source or out-of-order history also throws.
It scores each transition independently, as the study's `evaluate.py` does, checks
exactly 831 continuations and 66 new entities across four transitions, requires
at least 804 retained and zero wrong, and writes lost/wrong cases before
returning a failing gate. C2 owns conversion evidence and archival; the replay
verifies the archived bindings. These records establish provenance, not a new
run of C2's semantic or published-output comparison. The full historical gate
remains pending until C2 supplies all five verified conversions and bindings.

## Operations and undo

`IdentityOperation` reuses the operation contract's `OperationIntent` and
`IdentityMapping`. Each participating file has `path`, `fromRevision`,
`toRevision` and `fromSnapshot`. Each resulting mapped node has a placement
`{mappingIndex, file, path}` into the resulting parse. All preconditions validate
before a result can be returned. Null `newId` on a placed `new`, `copied` or new
`pending` mapping requests allocation; an already allocated fresh ID is also
accepted. The result contains completed mappings.

Modify, move and convert retain explicitly mapped IDs. Replacement retires the
old subtree and allocates the replacement subtree. Copy allocates the entire
copy, records donor lineage, and leaves the original intact. Split retains at
most each explicitly chosen survivor; merge records absorbed donors as retired
and adds their IDs to survivor lineage. Cut/paste-move restores the exact nested
IDs. A map covers every current node and every old node whose fate changes;
untouched archived retirement records do not enter undo.

`invertIdentityMapping` removes new/copied entities and restores deleted, cut or
absorbed entities with their recorded IDs. The host applies the contract's source
inverse and guards, then calls resolution with `inverse:true`, the inverse map,
result placements and the current revisions. A pending newly allocated entity
retires on undo; a pending continuing entity keeps its prior ID. An unplaced
durable donor returns to pending without reviving discarded provisional IDs.
Source edit guards and durable undo belong to the
operation service, outside this package.
Resolution supplies prior pending IDs to `invertIdentityMapping` so undo restores
pre-existing ambiguity, including donors absent from source. Without that prior
status, a continuing pending mapping undoes to `kept`, as for a newly invalid draft.

Page resolution assigns unique slugs through content-model's shared formatter.
Existing slugs remain stable; a changed title adds an alias. New pages and aliases
reserve every prior page URL, including retired records. `restoreIdentityMetadata`
compares the prior and written resolutions and restores only changed metadata
fields after an inverse. `canRestoreIdentityMetadata` guards those same fields
against the current resolution. Unchanged metadata keeps its current values;
the new parse supplies current spans and ownership. Cut resumes invert to cut;
undo of retirement from an existing cut also restores cut status.
