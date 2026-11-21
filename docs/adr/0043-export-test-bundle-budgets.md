# 0043: Export test bundle budgets

## Status

Accepted. Records existing size allowances; no budget change.

## Context

Bundle budgets were raised as working features added code. The owner required size optimisation after functional work, with measured headroom rather than a cap that blocks the feature. Earlier measurements explain the current literals; they are not new limits.

## Decision

In `packages/export-pipeline/src/__tests__/bundle-viewer.test.ts`:

- `HOST_GZIP_BUDGETS` retains these measured gzip bytes and allowances: standalone 13,274 plus 1 KiB; Electron preview 16,572 plus 1 KiB; xAPI 16,908 plus 1 KiB after #76; SCORM 1.2 24,121 plus 2 KiB; SCORM 2004 15,968 plus 2 KiB. Round allowances up to 256 bytes. The SCORM allowances follow the owner's 2026-10-24 decision in #42.
- `LOGIC_INITIAL_RAW_CEILING` retains the owner's 2026-10-11 allowance for learner-state lifetime handling. `NAV_INITIAL_GZIP_CEILING` retains the 2026-10-16 allowance after reporting-destination types changed minified names and moved the measured gzip size from 12,287 to 12,288 bytes.
- The highlight initial-closure test measures page and deck output separately. Earlier page/deck measurements were 43,137/135,602 and 39,577/131,639 gzip bytes, with earlier caps of 36,864/129,024. Recovery measured 138,176 for the deck; group rollback measured 44,590 for the page; activation measured 48,487/141,555. These received 1 KiB, rounded up to 256 bytes. The later 142,663-byte deck measurement and 49,741-byte page measurement after SCORM commit refusal received 2 KiB under the owner's size rule.
- The distractor no-gesture closure test keeps its full dependency closure. Replacing `@noble/hashes` with Web Crypto requires an alternative for plain-HTTP LMS hosts, where `crypto.subtle` requires a secure context.
- The generated-island cleanup test also checks CSS and initial-load budgets. Shared CSS measured 31,871 gzip bytes on 2026-10-19 and keeps its 33,024 cap. Deck focus rings measured 2,845; the outcome-owner refactor measured 2,480. Download generators remain packaged for offline use but count only after a download gesture.
- Reflection-journal downloads and partial-save/resume explain added initial code. The rating owner measured 4,217 raw bytes and its total 16,636 on 2026-10-18, after an 18 KiB allowance was approved on 2026-10-17. Later focus restoration moved 25,209 to 27,750; add 1 KiB and round to 256 bytes without changing full page/deck caps. Submission timer cleanup in #78 measured 26,257 raw bytes. Check scrolling with shared outcomes measured 30,343 raw bytes. Recovery measured 82,156 gzip bytes for its shared closure and 256,599 for its complete closure. Those allowances add 1 KiB and round to 256 bytes.
- `isolatedViewerSources` uses a separate package-layout copy so hash tests cannot race live builds. Workspace symlinks resolve to the original repository; compare their inputs to corresponding copies in the isolated tree. The SCORM 2004 test adapter retains Moodle's 64,000-character suspend-data limit.

In `packages/export-pipeline/src/__tests__/html-gen.test.ts`, the optional-course-CSS test shares the 31,871-byte measurement and 33,024-byte cap. It separately checks the incremental cost of course decoration.

Source: the comments, budget literals and tests at Studio commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, including the owner dates and public PR references above.

## Consequences

Keep full dependency closures and offline operation when optimising. Deferred optimisation remains backlog work; removing comments does not lower a budget or excuse a failing check.
