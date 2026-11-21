# 0044: Export test LMS harnesses

## Status

Accepted. Records existing test constraints; no executable change.

## Context

Export tests include platform observations, fixture admission rules and measured allowances that are not apparent from their assertions. The records below preserve that context when code comments are removed. Platform observations describe the harness versions recorded by the tests; they are not new compatibility claims.

## Decision

### packages/export-pipeline/tests/adl-conformance.test.ts

- `ships the complete publisher IMS sequencing schemas and distribution notices`: `https://www.imsglobal.org/xsd/<filename>`, retrieved 2026-10-19, exact bytes.
- `ships the unmodified W3C 2001/03 XML namespace schema`: `https://www.w3.org/2001/03/xml.xsd`, retrieved 2026-10-19.
- `maps every content namespace in the exported %s %s schemaLocation`: XML, namespace declarations and XSI are built-in XML machinery.

### packages/export-pipeline/tests/adl-manifest-validator.ts

- `assertAdlManifestPassed`: ADL exits zero for invalid manifests. Its summary and checkpoint marker decide passage.
- `result`: The official distribution loads its schemas/resources relative to this suite root.

### packages/export-pipeline/tests/fixtures/scorm12-compact-vectors.ts

- `default` export: Pinned dictionary/shape vectors. Tag 9 stores big-endian UTF-16 code units.

### packages/export-pipeline/tests/gate-prerequisites.ts

- `rusticiDriverDir`: Rustici's licence forbids redistribution, so the drivers are never committed. PRAXITY_RUSTICI_DRIVERS names a folder holding scorm12/ and scorm2004/, which lets every worktree share one local copy; otherwise the gitignored folder is used.

### packages/export-pipeline/tests/objective-slots.test.ts

- `set`: Moodle scorm_13.js: duplicate ids and changing a saved id are refused.

### packages/export-pipeline/tests/scorm-cloud/fixture.ts

- `identifiers`: This runtime fixture originally fits SCORM 1.2's fixed state budget. Give its public model deterministic test IDs; preserve every reference, including option IDs and rendered data-node-id attributes. UUID capacity remains covered by the storage-risk and overflow contracts.

### packages/export-pipeline/tests/scorm-cloud/learner-simulation.ts

- `deadline`: 30s timeout — resume sessions restore suspend data from the SCORM API which can take longer than a fresh launch.
- `readCurrentOrder`: Item identities survive hydration and distinguish duplicate or overlapping labels.
- `clickMoveUp`: Click the "move up" button for the item currently at DOM position `index`. Index 0 has no up-button; up-buttons exist for indices 1..n-1. The nth up-button (0-based) corresponds to the item at list position (n+1).
- `checkbox`: Mantine Checkbox doesn't render a value attribute — find by label text
- `simulateLearner`: Playwright navigation errors may include bearer launch URLs.

### packages/export-pipeline/tests/scorm-cloud/playwright.config.ts

- `defineConfig`: Cloud launch URLs are bearer credentials; do not retain browser network traces.

### packages/export-pipeline/tests/scorm-cloud/scorm-cloud.spec.ts

- `detailed`: Cloud requires the separate interaction flag even when runtime data is requested.

### packages/export-pipeline/tests/scorm-index-navigation.test.ts

- `initialize`: Moodle 1.2 replays committed interaction defaults onto a missing row object.
- `initialize`: Moodle rebuilds cmi even when rejecting an already initialized call.
- `commit`: Moodle 1.2 updates defaults when collecting data; 2004 keeps launch defaults.
- `'${format} preserves both answers and block state across index, frozen=${frozen}'`: The index redirects to page one before the learner reopens page two.

### packages/export-pipeline/tests/scorm-interaction-index.test.ts

- `set`: The fake requires contiguous rows and IDs before fields; Moodle's latter rule is 2004 only.

### packages/export-pipeline/tests/scorm-launch-outcomes.test.ts

- `host`: Moodle-style getters reset the error on each call. Unset 2004 data also permits 403.

### packages/export-pipeline/tests/scorm-local/lifecycle.spec.ts

- `reloadDocument`: Guided's replaceState also emits framenavigated. Only a replacement document loses this marker; the outgoing document can already have reached load.
- `url`: GET discards an action query, so use a successful form control.
- `'${format} ${mode}: cumulative session time survives documents, reload and cached-page events'`: Pages resumes Two; Guided has visited every slide and starts again at One. Wait past any entry/resume redirects before advancing the new launch clock.

### packages/export-pipeline/tests/scorm-local/local-harness.ts

- `createLocalHarness`: Serve sibling `scormdriver/` and `scormcontent/` directories from one HTTP origin. The Rustici driver's `indexAPI.html` resolves `../scormcontent/index.html` relative to that layout. Retain the returned server and directory cleanup function.

### packages/export-pipeline/tests/scorm-local/local.spec.ts

- `getContentFrame` and `injectScormApiMocks`: Local SCORM integration tests using the Rustici SCORM Driver. These tests are self-contained — no internet access, no SCORM Cloud account. They require the Rustici driver files to be present in: tests/scorm-local/drivers/scorm12/ tests/scorm-local/drivers/scorm2004/ If either driver directory is absent the corresponding tests are skipped. The player uses a `<frameset>`. The SCO runs inside the frame named "scormdriver_content". Playwright accesses it via page.frame(). The SCORM API (window.API for 1.2 / window.API_1484_11 for 2004) is exposed on the top-level page (the frameset owner), which is where the driver JS runs.
- `injectScormApiMocks`: Inject a lightweight in-memory SCORM API mock into the page BEFORE navigation. Only the API for the given format is injected: - scorm12 → window.API (SCORM 1.2) - scorm2004 → window.API_1484_11 (SCORM 2004) Injecting both simultaneously causes the runtime auto-detector to always pick SCORM 2004 (it checks API_1484_11 first), so a SCORM 1.2 package would use the wrong runtime and write to the wrong CMI fields. The mock stores data in `window.__scormStore` so we can read it back later. Uses `page.addInitScript` so it runs before any frame content loads.
- `injectScormApiMocks`: Only inject on the TOP-LEVEL frame (indexAPI.html). Child frames also receive addInitScript, which would create separate store closures. The guard `window.frameElement === null` skips injection in child frames so that our content's findAPI() walks up to the parent and uses the single shared store.
- `injectScormApiMocks`: Skip injection in child frames — only the top-level frameset page should host the API objects.
- `injectScormApiMocks`: SCORM 1.2 API only — do NOT inject API_1484_11 or the runtime auto-detector will pick SCORM 2004 instead.
- `deadline`: The frameset loads blank.html initially; wait for the driver to navigate the content frame to the SCO's first page.
- `getContentFrame`: Wait until it's no longer blank.html (driver is still initialising)
- `test.describe` comprehensive fixture suites: Comprehensive fixture tests — full grammar fixture is slow, so keep this coverage focused on one happy-path traversal per SCORM version.
- `'Local SCORM driver: ${format}'`: Logic rule tests — SCORM 1.2 only (branching is a shared runtime feature; no need to duplicate across formats).
- `Local SCORM driver: scorm12 — navigation variants`: Navigation variant tests — SCORM 1.2 only because navigation rendering is format-independent and the core/default path is already covered for 2004.

### packages/export-pipeline/tests/scorm-local/playwright.config.ts

- `defineConfig`: Headless works here: the driver uses `<frameset>`, not window.open().
- `defineConfig`: Disable trace/screenshot — these tests manage their own browser instances (chromium.launch + context.newPage) rather than using Playwright fixtures, so the trace artifact system cannot hook into them and produces ENOENT errors.
- `defineConfig`: The full local Rustici suite is serial and can take 10-15 minutes when proprietary driver files are present. Keep the per-test timeout generous so long comprehensive runs do not fail after the learner flow has completed.

### packages/export-pipeline/tests/scorm-local/retry.spec.ts

- `writes`: Guided can commit its new bookmark after saving the result. Check the commit that transfers completion, which is the point at which an LMS can lock the score.
- `'${format} ${mode}: retryable failure resumes the saved assessment before ${retryPasses ? "passing" : "final failure"}'`: Firefox can retain the LMS launch button's outer-document focus. Verify the course document's focus destination separately from that host policy.

### packages/export-pipeline/tests/scorm-runtime-contract.test.ts

- `StrictScorm2004Api`: SCORM 2004 RTE 4.1.1.7 time(second,10,0): YYYY[-MM[-DD[Thh[:mm[:ss[.s[TZD]]]]]]]. A time zone designator requires fractional seconds, at most two digits.
- `uses valid SCORM 2004 lifecycle, vocabulary, and interaction fields`: SCORM Cloud rejected the former "...:35Z" form with error 406.
- `frozenLearnerState`: Captured runtime writes at 08a6a0d8d; privacy also seeds untrusted device data. These literal inputs are never regenerated by tests.

### packages/export-pipeline/tests/scorm12-submission.test.ts

- `restores equal answer and row counts for %i UUID questions under the real cap`: The capacity reviews used unrelated UUIDs, one page per four-option question, a short readable response and every page visited before answering.

### packages/export-pipeline/tests/scorm12-suspend-data.test.ts

- `raw`: 65,521 spaces leave both Adler-32 sums unchanged modulo 65,521.

### packages/export-pipeline/tests/scorm2004.test.ts

- `writes interaction data to cmi.interactions.0.*`: RTE 4.1.1.7: a time zone designator requires fractional seconds.

Sources: the comments and corresponding implementations in the named files at Studio commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. Explicit spec sections, issue numbers, capture revisions and owner dates above retain the original evidence references.

## Consequences

Preserve these constraints when changing the named fixtures or measurements. Recheck a recorded platform limitation before replacing its harness path. Deferred coverage and size work remain separate changes; this record does not waive their checks.
