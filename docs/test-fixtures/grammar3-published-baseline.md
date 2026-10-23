# Grammar-3 published-output baseline

G8 captured the baseline before changing the adapter, from Studio revision
`973abeafc1bc4d9a3a46da6c66046bccd8dd4908` on Node 24.19.0 and pnpm 10.28.2.
The historical baseline packages are retained separately by the maintainers and are not included in this tree.

There are 23 inputs: the full leadership course, the toolkit welcome lesson,
`sample-course-grammar.md`, and all 20 published pattern examples. Every input
has `artifact.json` and complete `html.zip`, `scorm12.zip`, and `scorm2004.zip`
packages. `baseline.json` records source SHA-256 hashes, package hashes, page
counts, tool versions and the capture command. Leadership has 29 pages; toolkit
has one; the comprehensive fixture has ten.

The archived recorder accepts a fresh output directory:

```powershell
pnpm exec tsx packages/export-pipeline/scripts/record-grammar3-baseline.ts <new-output-directory>
```

To reproduce the pre-G8 output, use the recorded Studio revision in a separate
worktree, copy the capture script from the G8 commit into the same relative path,
install with `pnpm install --frozen-lockfile`, and run the command with a fresh
output directory. The archived recorder contains local input paths; update them
to point at copies of the matching courses. Verify the source hashes before comparing. Project loading is
read-only, includes narration and course design, and disables ancestor workspace
settings. Pattern examples use the comprehensive fixture's local asset map.

X1 compares learner HTML, settings and asset behavior after ID normalization.
ZIP timestamps, transient IDs and resulting artifact/file hashes are not
byte-reproducible. Normalize identity only, preserve learner words, inline markup,
answer keys, settings and asset references, and write an allowlist for intended
format changes. Keep the original packages and baseline manifest unchanged.

The recorder is retained only on the archived converter tag. Prepare that checkout with [converter-archive.md](../context/converter-archive.md); the grammar 4 tree does not regenerate a grammar 3 baseline.
