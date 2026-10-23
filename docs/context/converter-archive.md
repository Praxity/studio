# Grammar 3 converter archive

Use the annotated maintenance tag `converter-v3-to-v4.1`, commit `9adf7f44b3f393d24781aa057250c386831127a0`, for new conversions. It fixes C2's cast declaration projection for course-relative lesson paths. The original tag `converter-v3-to-v4` still pins `8905c116e` and remains unchanged. The maintenance branch and tag await review and publication.

## Cast placement

Lesson frontmatter `cast` is supported. Both grammar 4 [dialogue](../prax-format/examples/patterns/dialogue.prax) and [branching dialogue](../prax-format/examples/patterns/dialogue-branching.prax) examples use it. `readLesson()` passes that cast to `toBlocks()`, which supplies lesson speaker overrides to `resolveDialogueSpeakers()`. Shared course defaults belong in [course.yaml](../prax-format/reference/course-manifest.md#course-cast). The reference prose omits frontmatter cast and says local speaker declarations are unsupported. This fix follows the executable examples and reader; it does not reinstate the retired block declaration syntax.

C2 now compares cast declarations at any lesson path, retaining speaker properties, extra cast entries and neighbouring frontmatter. It removes only duplicate empty speaker entries for that dialogue's turn keys in semantic and published JSON comparisons. Variable relocation remains restricted to the original seven named files. Literal, complete tree and visible HTML comparisons remain strict. No course YAML cast move is required.

## Reproduce the archive

Run from a Studio checkout containing the tag:

```powershell
git archive --format=zip --prefix=praxity-converter/ --output=converter-v3-to-v4.1.zip converter-v3-to-v4.1
Get-FileHash converter-v3-to-v4.1.zip -Algorithm SHA256
```

Maintenance archive SHA-256: `987a742cfda6b5618ce93bdcc186271a538a554a73b8d9e3026ce2cd73124817`.

The original archive recipe uses the same prefix with tag and filename `converter-v3-to-v4`; its SHA-256 remains `7749516aa19899c84abb57c8da30ff282d2957570bb6e9fa52c7c5011b5cf89c`.

The tag excludes this record, so its hash has no self-reference. Extract the ZIP or create the checkout below. Use Node 24.22.1 and pnpm 10.28.2.

## Build, test and convert

Replace `<converter-checkout>` with a new directory of your choice.

```powershell
git worktree add --detach <converter-checkout> converter-v3-to-v4.1
pnpm --dir <converter-checkout> install --frozen-lockfile
pnpm --dir <converter-checkout> --filter @praxity/convert typecheck
pnpm --dir <converter-checkout> --filter @praxity/convert test --maxWorkers=2 --no-file-parallelism
pnpm --dir <converter-checkout> --filter @praxity/convert prove:corpus
pnpm --dir <converter-checkout> --filter @praxity/desktop prebuild
pnpm --dir <converter-checkout> --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>
pnpm --dir <converter-checkout> --filter @praxity/convert convert --install <approved-directory> --report-sha256 <approved-hash>
```

The converter runs TypeScript directly through tsx. Desktop prebuild supplies publisher artifacts for full HTML proof. Stage into a new directory outside the course. Review `conversion-report.json`, its SHA-256, allocation manifest and narration review before installation. The install command requires the independently recorded report approval hash. Never edit the original course for a trial. The corpus runner also requires the external, hash-pinned G8 baseline and HTML asset packages from the retained cutover evidence; those course assets are not part of the archive.

To prove a staged course, write a manifest containing every `.prax` path relative to the course copy, its original SHA-256 and one course name. Set `assetRoot` to the absolute path of that copy, then run:

```powershell
pnpm --dir <converter-checkout> --filter @praxity/convert prove <course-copy> <new-output-directory> --manifest <expected-files.json>
```

Use a Studio CLI built from the current main revision for HTML, SCORM 1.2, SCORM 2004 and PDF export checks. Overlay unchanged assets onto a separate copy of the staged payload for those checks. CLI export enforces critical accessibility checks by default. Keep both CLI provenance and narration status evidence with the staging report.

Studio's grammar 3 refusal directs you to this staging command. Substitute the
path of your prepared converter checkout:

```powershell
pnpm --dir <converter-checkout> --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>
```

The preceding worktree and install commands prepare it. After publication, a fresh clone must fetch `converter-v3-to-v4.1` first.

## Fixtures, proof and notices

At the tag, `tools/praxity-convert/__tests__/fixtures/` contains frozen leadership and toolkit sources, expected grammar 4 output and notices. The proof also reads the original Studio corpus at its pinned repository paths. `tools/praxity-convert/README.md`, `ALLOWLIST.md` and `PROOF-TRIAGE.md` describe byte, semantic, published HTML and mutation comparisons. C5's converted fixture and deletion records belong to the X1 merge, after the archive tag.

Keep the root `LICENSE`, `LICENSING.md`, `legal/` and fixture notices with any archive. Publication of the archived converter requires separate approval. Rustici drivers, ADL materials, course assets outside the pinned fixtures and credentials are never included.
