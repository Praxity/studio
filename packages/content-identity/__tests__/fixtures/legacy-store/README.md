# Legacy identity stores

Synthetic stores captured on 2026-10-19 with the unmodified resolver at
`a7c88dfa4f2aa51e1bf70aa89f82a2ccd0796f66`.
These bytes and UUID assignments predate descriptor-version support. Tests load
the files directly; they never regenerate their expected stores.

Captured JSON files use `.json.txt` so formatters cannot rewrite the writer's
literal bytes. Tests install them under the store's ordinary `.json` filenames.

Each mode contains the original source and writer snapshot, current source,
course and lesson head, immutable snapshots, and literal current source
mappings, export IDs and statuses. `tree-only` omits virtual reader roles;
`reader-roles` includes them. Both cover an accordion, a nested list, a choice
with option feedback, repeated sibling paragraphs, blanks and a rating scale.
These two stores each retain three snapshots. `duplicate-projections` adds two
same-title accordions with different children, repeated identical option labels
and generated `level:*` rating roles, with one snapshot.

Capture used `readLesson` and `resolveIdentity`, with `readerRoles` set to the
mode and a sequential UUID allocator starting at
`00000000-0000-4000-8000-000000000001`. The first allocation is the course ID.
`initial-snapshot.json` pins the fresh writer bytes. A synthetic state-owner
signature and epoch were then attached to the choice and its head rehashed.
Two recorded delete operations removed the note as cut and the text block as
retired, retaining each generated snapshot and its ancestry. No production
course or learner records were used.

The `flow` producer was removed in `914823d8dce671207bd8c369fcd325532c5138a7`,
after I1 introduced the schema in `11447c06b4dba51d5aeb279a96da8845a365a437`
but before I4 added reader-role persistence in `9682b3e735210d574a3d416259aef4ac0a9ba344`;
no revision could both produce and persist a flow role, so no flow fixture exists.

To reproduce, create a clean checkout of the pinned baseline revision and install
its frozen dependencies, then run from this candidate checkout:

```sh
pnpm exec tsx packages/content-identity/scripts/capture-legacy-store.ts <baseline-checkout> <output-directory>
```

The script imports the resolver and grammar from that baseline, reads only the
synthetic initial-source fixtures here, and writes into the supplied output
directory. Captured store bytes reproduce exactly; `expected.json` presentation
can be formatted with Biome without changing its literal assignments.
