# Grammar 4 cutover evidence

The converter archive is pinned to `converter-v3-to-v4`, commit `8905c116e`.
See [the archive recipe](converter-archive.md) for its build, commands and SHA-256.

X1d removes the grammar 3 parser, serializer, source-ID machinery, narration v1,
adapter fallbacks and frozen Electron QA. Shared renderer playback uses resolved
v2 data, including whole-container targets retained by conversion. The standalone
CLI proof verifies I4 lesson heads, snapshot hashes and unchanged identities
across HTML and SCORM exports.

X1 ran the tagged C2 proof against the C5 converted Studio fixtures and five
pinned C1 lessons on 2026-10-06. The unchanged proof passed 35 inputs, 34
conversions, one expected unmatched-card-back refusal, two expected missing
caption build refusals, 511 blocks and all 1,008 mutation checks. It compared
published packages for 29 courses. The original 11 allowances remain unchanged.

The first run exposed three stale grammar 4 leadership goldens. They changed
French nonbreaking spaces and represented folded assessment-group titles as
separate headings. X1 regenerated those three goldens from the pinned C1 source
bytes with the archived converter. Authored heading checks still compare the
original literal titles and ranks. They apply C2's existing
`page-boundary-metadata` allowance to the explicit page title beside a folded
H1 group with the same title.

Reproduce the proof from the archived checkout prepared with [the archive recipe](converter-archive.md):

```powershell
pnpm --filter @praxity/convert prove <v3-directory> <v4-directory> --manifest <expected-files.json>
```

The historical proof logs, inputs, output hashes and manifest are retained separately by the maintainers and are not included in this tree. Keep the same artifacts with any new proof run.

This is C2's paired published comparison using the pinned original source bytes.
It does not claim byte equality with historical G8 packages built by a different
renderer revision. C2 verifies G8 package hashes before using their assets.
