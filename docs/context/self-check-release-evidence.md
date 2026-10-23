# Self-check release evidence

Checked 2026-10-16 against browser fixture revision `f79d4a346`, based on
`bce9c3214`. The same authored fixtures and literal expectations feed the compiler,
project CLI, learner browser journeys and author workbook tests.

| Fixture | SHA-256 of source |
| --- | --- |
| `packages/export-pipeline/tests/fixtures/self-check-release/en.prax` | `8b9f4a33b617fc03e534d23582026efe81276b8cd0f71e12efd15345bd0cb368` |
| `packages/export-pipeline/tests/fixtures/self-check-release/fr.prax` | `94b0ec056db8a2227fc908f9300e852a398fd74b5e0405756dabc03d2ce3b28a` |

Headless Ubuntu 24.04, Playwright 1.59.0, one engine at a time, one worker used
with a maximum of two. Retries disabled.

| Engine | Bundled version | Passed | Failed | Skipped | Retried |
| --- | --- | ---: | ---: | ---: | ---: |
| Chromium | 147.0.7727.15 | 28 | 0 | 0 | 0 |
| Firefox | 148.0.2 | 28 | 0 | 0 | 0 |
| WebKit | 26.4 | 28 | 0 | 0 | 0 |

Each engine covers both languages:

- Full keyboard journey in the actual preview host protocol, HTML, SCORM 1.2,
  SCORM 2004 and classic `file:` output. The SCORM journeys install the respective
  LMS API, verify initialization and keep private answers outside LMS data.
- Write, Check, zero-tick Show feedback, literal labels/hints/evidence marks,
  completion, edit while retaining the previous comparison, silent restore,
  readable browser print and Start over with answer focus. Compare again after reset.
- No JavaScript, failed initial island import and failed comparison-support import
  preserve an editable answer without model, criterion or hint bytes in HTML.
- 320 CSS-pixel reflow, 400% zoom geometry, text spacing, RTL, forced colours and
  reduced motion. Zoom geometry uses a 320 by 240 CSS-pixel viewport at device scale
  four, equivalent to 1280 by 960 physical pixels. This is headless geometry
  emulation, not an automation of the browser's zoom menu.
- Text-spacing overrides use line height 1.5, paragraph spacing 2 em, letter
  spacing 0.12 em and word spacing 0.16 em. Bounds and overflow assertions run
  before and after comparison. Narrow comparisons stack. Forced colours retain
  the focused control's outline; reduced motion leaves no running animation.
- Axe 4.11.1 returns zero violations for each complete learner document in the
  comparison state, including the preview's learner frame and each display
  condition. The fixture host's own controls are outside that scan.

`tests/self-check-release.test.ts` checks project publication, missing runtime
refusal with `EISLANDASSET`, literal author workbook source, and the learning-patterns
notice in HTML and both SCORM packages. Native Typst 0.15.1 compiled both workbooks;
Poppler extraction retained the task, model with numbered evidence, all criteria,
all hints and the whole-answer legend.

The existing `tests/self-check-output-invariant.test.ts` still scans decoded
archive entries, raw unowned ZIP ranges, preview, inspection, narration and utility
output. Successful project exports now pass through that same invariant. Authored
answer bytes are allowed only in their activity's declared asset or an explicit
author output. Planted marker, unlisted asset and archive-comment violations still
fail the invariant.

The export notices and built CLI payload contain the complete pinned MIT license.
The upstream license SHA-256 is
`d817c04f10efaffd1ab6dba0792a6567dce98f8ab41e86c64833a7b9cff7ecc5`.
The CLI proof checks both its dependency/file inventory and the actual license bytes.

Reproduce from the repository root:

```sh
pnpm --filter @praxity/desktop prebuild
pnpm --filter @praxity/export-pipeline prebuild:client
for engine in chromium firefox webkit; do
  pnpm --filter @praxity/export-pipeline exec playwright test \
    --config tests/deck/playwright.config.ts self-check-release.spec.ts \
    --project="$engine" --workers=2 --retries=0
done
pnpm exec vitest run --config vitest.workspace.ts \
  packages/export-pipeline/tests/self-check-release.test.ts \
  packages/export-pipeline/tests/self-check-output-invariant.test.ts --maxWorkers=2
pnpm build:cli
node --test --test-name-pattern='CLI payload retains' apps/desktop/scripts/standalone-cli.proof.mjs
```

Set `PRAXITY_TEST_TYPST` to the prepared bundled Typst executable to include native
PDF compilation and text extraction. The reproducible fixtures replace retained
binary workbooks. Engine JSON reports and fail-first publication logs accompany
the implementation handoff.

This is automated evidence for this fixture and these states. S14b screenshot
judgment, S14c spoken NVDA/VoiceOver checks and the pattern page remain separate.
No screen-reader listening or accessibility-conformance claim is made here.
