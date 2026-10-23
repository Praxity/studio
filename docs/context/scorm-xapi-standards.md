# SCORM/xAPI Standards Reference

## SCORM References

ADL is the normative source for SCORM. Rustici/SCORM Cloud is compatibility validation
against an important real LMS/runtime implementation, not official conformance evidence.

| Spec / Resource | URL |
|------|-----|
| ADL SCORM versions and resources | https://www.adlnet.gov/past-projects/scorm/#scorm-versions-and-resources |
| SCORM 2004 4th Edition Technical Specification | Linked from ADL SCORM 2004 4th Edition resources |
| SCORM 2004 4th Edition Testing Requirements / Conformance Requirements Version 1.1 | https://www.adlnet.gov/assets/uploads/SCORM_2004_4ED_v1_1_TR_20090814.pdf |
| SCORM 2004 4th Edition Conformance Test Suite 1.1.1 | Linked from ADL SCORM 2004 4th Edition compatibility testing resources |
| SCORM 2004 4th Edition LMS Test Packages and Sample RTE | Linked from ADL SCORM 2004 4th Edition compatibility testing resources |
| SCORM 2004 4th Edition content examples | ADL Bookmarking, Data Model, Manifest Basics, and Sequencing Essentials examples |
| SCORM 1.2 Technical Specification | Linked from ADL SCORM 1.2 resources |
| SCORM 1.2 Conformance Test Suite 1.2.7 | Linked from ADL SCORM 1.2 resources |
| SCORM 1.2 Sample Run-time Environment and API Wrappers | Linked from ADL SCORM 1.2 resources |
| SCORM 1.2 Content Package Examples | Linked from ADL SCORM 1.2 resources |
| Rustici SCORM Cloud | Target LMS verification and compatibility testing |

See `docs/context/adl-scorm-official-resource-index.md` for the resource intake plan.
See `docs/context/scorm-adl-conformance-exceptions.md` for current official-suite execution exceptions.
See `docs/context/adl-scorm-ui-suite-runbook.md` for the manual browser/Java UI suite evidence procedure.

## Conformance Strategy

- **Conformance evidence:** comes from ADL conformance-suite results for the specific SCORM version.
- **Automated spec checks:** deterministic package/runtime checks derived from ADL CAM/RTE/testing requirements run in normal tests.
- **Compatibility evidence:** SCORM Cloud and local Rustici-driver tests prove practical launch/tracking behavior in a widely used runtime family.
- **Deprecation rule:** do not remove existing Rustici checks until ADL-derived checks are stable and have proven the overlap.

## xAPI References

| Spec | URL |
|------|-----|
| IEEE 9274.1.1 xAPI Base Standard | https://opensource.ieee.org/xapi/xapi-base-standard-documentation |
| Tin Can API Verb Registry | https://registry.tincanapi.com/ |
| xAPI spec version used | 1.0.3 |

### ADL Verb IRIs

The verb identifiers used in `xapi.ts` (`http://adlnet.gov/expapi/verbs/*`) are canonical per the IEEE spec. ADL was dissolved in 2023 and the domain no longer resolves, but the IRIs remain the interoperability standard — every LRS and content tool expects them. Do not change these to alternative URLs.

### Course activity IDs

An xAPI package declares `https://praxity.io/courses/<course id>` in `tincan.xml` and passes that same ID to the runtime in its deployment config. Completion, pass, fail and launch statements use that course ID. Page and interaction IDs are children of it. An LMS launch `activity_id` takes precedence when it is an absolute IRI; the runtime saves it in the tab's `sessionStorage` for later pages that have no launch query. A configured `activityBase` takes precedence over the default ID, and the package declares its existing course ID shape, `<activityBase>/course`. The launch ID takes precedence over `activityBase`. Older packages without the deployment field derive the default ID from their course ID and still honour a configured `activityBase`.

## Code → Spec Mapping

| File | Implements |
|------|-----------|
| `packages/export-pipeline/src/scorm/manifest.ts` | IMS Content Packaging, XSD schema bundling |
| `packages/export-pipeline/src/scorm/api/scorm12.ts` | SCORM 1.2 RTE, CMI data model |
| `packages/export-pipeline/src/scorm/api/scorm2004.ts` | SCORM 2004 RTE, CMI data model |
| `packages/export-pipeline/src/scorm/api/xapi.ts` | IEEE 9274.1.1, ADL verb registry |
| `packages/export-pipeline/src/scorm/tracking.ts` | Completion/scoring logic (Praxity-internal) |
| `packages/shared-blocks/src/tracking.ts` | Injected writer for course outcomes, group objectives and explicit Finish |
| `packages/export-pipeline/src/scorm/tincan-xml.ts` | Tin Can launch file for xAPI packages |

`CourseTracker.outcome()` computes the existing quiz and course pass-mark rules.
The host supplies saved answers for the tracker's finality check and delegates
group objectives and Finish to the tracker. The shared writer also serves End
when only a runtime is installed. It preserves score, success and completion write
order; SCORM adapters still prepare explicit completion inside their termination
guard. `scripts/check-source-owners.mjs` rejects outcome writes outside this writer,
and calls to `writeCourseOutcome` outside CourseTracker and the writer module.
`finishRuntimeCourse` owns the runtime-only End exception in that module. Any future
waiting gate must cover that exception as well as `CourseTracker.outcome()`.

## CMI Data Model Elements Used

### SCORM 1.2
- `cmi.core.lesson_status` — completion/pass-fail
- `cmi.core.score.raw/min/max` — numeric scoring
- `cmi.core.lesson_location` — bookmarking
- `cmi.core.exit` — suspend incomplete or failed attempts; empty exit after completed or passed
- `cmi.core.session_time` — cumulative wall time for the communication session
- `cmi.suspend_data` — JSON state or a losslessly compressed choice envelope, capped at 4,096 characters on every write. `scorm/scorm12-storage.ts` estimates a full attempt with the same codec at export, and Publish and the CLI warn when it may not fit. SCORM 1.2 choice submissions save state and the interaction row together; failed writes preserve previous bytes and allow retry. Compressed saves require canonical Base64, matching declared decoded length, zlib checksum and decoded/compressed CRC-32 values. Unreadable saves remain untouched and grant no current credit. All LMS-bound assessments retain editable drafts with the storage notice; tab recovery is scoped to course, learner and original damaged bytes. Completion and score writes, including explicit Finish completion, are suppressed while held. Other hosts retain their existing behavior after failed state writes.
- `cmi.interactions.N.*` — interaction tracking
- `cmi.objectives.N.*` — objective tracking

### SCORM 2004
- `cmi.completion_status` — completion state
- `cmi.success_status` — pass/fail
- `cmi.score.raw/min/max/scaled` — scoring with scaled [-1, 1]
- `cmi.location` — bookmark
- `cmi.exit` — suspend incomplete attempts or unresolved/failed tracked success; normal after completed and passed or ungraded
- `cmi.session_time` — cumulative wall time for the communication session
- `cmi.suspend_data` — JSON state blob
- `cmi.interactions.N.*` — interaction tracking (uses `learner_response`)
- `cmi.objectives.N.*` — objective tracking with `success_status`

### xAPI Verbs Used
- `initialized` — course launch
- `attempted` — interaction attempt
- `completed` — course completion
- `passed` / `failed` — pass/fail status
- `answered` — question response
- `experienced` — page visit

## Readable interaction reports

Assessment response events carry the authored stem as decoded plain text. Empty
stems use the assessment group's title, then the page title. SCORM 2004 writes
that text to `cmi.interactions.n.description`, collapses whitespace and limits it
to 250 Unicode characters, ending at a word boundary with an ellipsis. A validated
`{lang=<course language>}` prefix precedes the literal text. ADL RTE 4.1.1.6
excludes this delimiter from the SPM. If language is absent or malformed, the
explicit default `{lang=en}` keeps authored syntax literal. Rejected reporting
writes warn once with the rejected element through the runtime diagnostic path.
Each later reporting field is attempted independently, retaining the accepted row
and submitted answer in suspend history. Later answers, scoring and completion continue.
Group completion events use the group title. xAPI keeps the complete plain-text
description in the question's language, without SCORM's 250-character limit.
Interaction IDs remain the block IDs.

The assessment renderer reports choices as lowercase label slugs, at most 250
characters each, with numeric suffixes for collisions within the question.
Multi-select responses join those identifiers with `[,]`. Internal option IDs
still own scoring and saved answer state. No correct-response patterns are
currently written. Free-text responses retain their existing handling.

SCORM 1.2 reports these readable choice strings as `performance`, within the
255-character CMIFeedback limit, including separators. The renderer budgets tokens
against all options in the question, preserving stable, unique identifiers as the
selected subset changes. When readable tokens cannot fit, it reports one-based
positions separated by commas. If that list exceeds 255 characters, `positions-hex:`
introduces a hexadecimal bitmap, four option positions per digit, low bit first.
Responses that cannot fit even this representation fail explicitly. The adapter
never truncates choice selections. Other response types keep their existing cap.
Its normative `choice` response
format permits only one character per option, so it cannot carry readable label
slugs. SCORM 1.2 has no interaction description field. See the ADL-authored
[SCORM 1.2 RTE](https://lms.technology/for/scorm/1.2/standards/SCORM_1.2_RunTimeEnv.pdf),
sections 3.4.4 and 3.4.5, and the ADL-authored
[SCORM 2004 RTE](https://lms.technology/for/scorm/2004/4th_edition/standards/SCORM_2004_4ED_v1_1_RTE_20090814.pdf),
sections 4.1.1.7 and 4.2.9.

## API discovery

The deployment chooses the SCORM version. A 1.2 package searches only for `API`;
a 2004 package searches only for `API_1484_11`. Both globals may exist as LMS
compatibility aliases, so their presence never chooses or changes the package
version. Hosts and resume-entry reads use the same version-specific discovery.
The course shell and Guided deck consume the host's confirmed resume arrival
without detecting a version again.

When the required API is absent, the host preserves its local-storage fallback.
This keeps the course readable outside an LMS but does not report progress to an
LMS or establish SCORM conformance. It never substitutes the other SCORM API.

The normative API names come from the ADL-authored
[SCORM 1.2 RTE](https://lms.technology/for/scorm/1.2/standards/SCORM_1.2_RunTimeEnv.pdf),
sections 3.3.5.1 and 3.3.6.1, and
[SCORM 2004 4th Edition RTE](https://lms.technology/for/scorm/2004/4th_edition/standards/SCORM_2004_4ED_v1_1_RTE_20090814.pdf),
sections 3.2.1 and 3.3.1. Neither specification authorizes replacing a package's
API with the other version. The existing traversal checks the opener before the
current window's parent chain. This differs from the parent-first order required
by 2004 section 3.3.1; the version-selection correction preserves that traversal.

## Session time

The launch record stores the time of Initialize. Every commit, including document
exits and explicit finish, writes elapsed wall time from that start. Pages documents,
Guided module documents, reload and cached-page returns share the clock. Only the
launch-entry reset starts another clock. Time in hidden documents or breaks stays
included. SCORM 2004 allows the SCO to choose whether breaks count; neither version
requires an inactivity deduction. A new launch excludes the gap between launches.

SCORM 1.2 writes `cmi.core.session_time` as `HHHH:MM:SS.SS`, capped at
`9999:59:59.99`. SCORM 2004 writes `cmi.session_time` as an ISO 8601 duration
with at most two fractional second digits. Both truncate elapsed milliseconds to
hundredths. Neither adapter writes the read-only total time. A rejected session-time
write prevents that commit and leaves explicit finish retryable.

ADL's [SCORM 1.2 RTE](https://lms.technology/for/scorm/1.2/standards/SCORM_1.2_RunTimeEnv.pdf),
section 3.4.4, core session_time and total_time, and the
[SCORM 2004 4th Edition RTE](https://lms.technology/for/scorm/2004/4th_edition/standards/SCORM_2004_4ED_v1_1_RTE_20090814.pdf),
sections 4.1.1.7, 4.2.21 and 4.2.25, define these formats and accumulation rules.
The LMS uses the last cumulative value for the session, so intermediate writes
must not send per-document deltas.

## Exit and resume

One exported course is one SCO, including its HTML pages and module decks. Initialize
once per communication session. The adapters share the launch record by API identity
and keep `__praxityScormInitialized` for older document bundles. Later documents
sharing that record skip Initialize. A bare `index.html` launch redirect resets
existing bookkeeping, so an LMS that resets and reuses its API object starts a fresh
session. An index route with a mapped `praxity-page` target retains the session,
including native GET forms. Internal navigation, bookmark resolution and page or
slide alias redirects also retain it.

The record is content-owned bookkeeping, not an LMS requirement. An API-identity
WeakMap on an accessible LMS parent or opener also records session state, covering
APIs that reject custom properties. A store on the shared Initialize callable covers
restricted API and window properties. Document-local windows cannot own this store.
If every shared store rejects bookkeeping, initialization fails before an LMS call.
The shared record carries closure and the course success policy across documents,
including utility pages that carry no pass-mark configuration. A glossary can join
an active SCORM launch, but cannot start one, move its bookmark or count as a visit.
Published SCORM hosts load the shared classic support asset before initialization.
It transports these existing owners without changing the API-identity record.
The initialization fallback accepts SCORM 2004 error 103. SCORM 1.2 error 101 is a general exception,
so accepting it also requires a successful read of `cmi.core.lesson_status`.

### Explicit finish policy for 0.3.0

The owner decided that content terminates communication only on explicit finish.
Pages offers the authored End/Finish lesson button and the End lesson logic jump
when the learner advances. Both use the same host finish path. Guided has no
functioning finish action today. Its last-slide boundary and automatic completion
save progress without termination. Adding a Guided finish control needs an owner
decision.

Finish preserves recorded pass/fail, including retryable failures reported as
`incomplete` in 1.2 and `incomplete` plus `failed` in 2004 when passing is required,
writes the exit value, commits, then calls exactly one `LMSFinish` or
`Terminate`. A false or thrown final commit prevents
termination and permits retry. A shared in-progress guard covers synchronous LMS
callbacks, including completion preparation before the final commit. Once
termination is attempted, all adapters in that launch stop LMS
calls and cannot initialize again, even when the LMS rejects termination. Retained
adapters keep their closed record when index starts another launch.

Every `pagehide` and `beforeunload` commits only. Internal links, utility visits,
history, reload, forms, redirects, auxiliary windows and frame removal never
authorize termination. The runtime does not infer departures from browser
navigation APIs, link intent, frame connectivity or parent lifecycle events.

Two independent review rounds of departure detection found false terminations.
Those closed usable launches irreversibly. This policy preserves communication
through navigation and leaves window closing and other departures to the LMS,
as in 0.2.0. It writes no sequencing request and does not close the LMS window.

ADL requires SCO communication to end with its termination method. SCORM 2004
RTE section 3.3.2.1 describes LMSs simulating termination when initialized content
becomes inaccessible; this is permitted, not required. Learners who close without
finishing therefore rely on their LMS's unload handling. This policy does not
guarantee termination on every departure or establish full ADL conformance.

Normative lifecycle references are the ADL-authored
[SCORM 2004 4th Edition RTE](https://lms.technology/for/scorm/2004/4th_edition/standards/SCORM_2004_4ED_v1_1_RTE_20090814.pdf),
sections 3.1.3, 3.1.6 and 3.3.2.1, and the
[SCORM 1.2 RTE](https://lms.technology/for/scorm/1.2/standards/SCORM_1.2_RunTimeEnv.pdf),
sections 3.3.2.1 and 3.3.2.2. These are archived ADL specifications. ADL remains
the authority; the archive and SCORM Cloud do not supply normative requirements.

SCORM adapters write the exit state before each commit and explicit termination. Unfinished
attempts use `suspend`, allowing the LMS to return `entry=resume` on the next launch and
preserve the bookmark and answer state. Completed attempts use the version's normal exit
value: an empty string in SCORM 1.2 and `normal` in SCORM 2004. SCORM 1.2 also treats
`passed` as terminal. A retryable scored failure reports `incomplete`; an exhausted
failure reports `failed`. Both keep `suspend`, preserving the exit matrix from the
explicit-finish policy. Suspension alone does not guarantee that an LMS will resume
a final `failed` attempt. SCORM 2004 uses its
separate completion status; once a course pass mark reports a result, the attempt ends
normally only when it is completed and passed. A tracked unknown result also
suspends. Legacy `completionMethod: "quiz"` without a pass mark or scored question
IDs records failed success through the same shared policy, so completed plus failed
still suspends. Page navigation commits without terminating the shared LMS session.
When an ungraded assessment group saves only some answers, the runtime writes the partial
group state to suspend data and then commits it. A resumed attempt can restore those answers
without waiting for page navigation or unload.

SCORM completion decisions take effect immediately through `getCompletion()`. The
adapters keep the pending completion value in the shared launch record and transfer
it on commit, after that save's score and success writes. This covers page completion
at host startup followed by an assessment submission before the first commit. A
retained utility adapter can flush the same value. A rejected completion transfer
prevents commit or termination and keeps the pending value for retry; a new launch
discards it. Explicit finish flushes pending completion inside the existing shared
guard before preparing its final status, preserving SCORM 1.2 pass/fail.

This order follows Cornerstone's documented transcript score locking when completion
is sent. It does not delay the course's completion rule until every future assessment
is answered, and cannot update a locked score after completion was saved in an earlier
commit. See Cornerstone's
[online-course score article](https://cornerstoneondemand.my.site.com/s/articles/What-is-the-difference-between-Assessment-Quiz-Transcript-and-Module-Scores?language=en_US).
ADL remains normative for the data model: SCORM 1.2 RTE section 3.4.4,
`cmi.core.lesson_status` and `cmi.core.score`, and SCORM 2004 4th Edition RTE
sections 4.2.4, 4.2.20 and 4.2.22. These define the statuses and score fields;
Cornerstone's locking behavior is compatibility evidence.

Normative exit references: SCORM 1.2 RTE section 3.4.4, `cmi.core.entry` and
`cmi.core.exit`; SCORM 2004 RTE sections 4.2.7 and 4.2.8; and
[SCORM 2004 4th Edition Testing Requirements](https://www.adlnet.gov/assets/uploads/SCORM_2004_4ED_v1_1_TR_20090814.pdf),
REQ_62.3.2 and REQ_63.2–63.5. Live SCORM Cloud checks provide compatibility evidence for
this lifecycle, not official ADL conformance.

The course host owns confirmed resume orientation. It reads the version's entry
value after initialization, resolves stable-ID URLs or legacy slug bookmarks, and
publishes the destination before runtime-ready. An active API session alone does
not trigger another resume during internal navigation; the existing redirect marker
continues the confirmed launch across content documents. Pages inserts a visible,
localized page-position prefix into the restored heading before focusing it.
Guided applies its existing gate checks before inserting the slide-position prefix
and focusing the allowed active heading, using the module-local slide count. Gate redirects
between modules preserve this confirmed arrival. Ab-initio, explicit unrelated deck
links, missing APIs and local-storage fallback receive no resume cue. Explicit
index links carry `praxity-resume=0` through aliases, including when their target
matches the bookmark; confirmed bookmark redirects carry `1`. The host consumes
either marker on resume entry before runtime-ready. Standalone HTML uses the same
destination and orientation policy with its course-scoped local-storage bookmark.
Reopening its index or reloading the saved page or slide resumes; explicit links
retain their arrival policy and recorded visits. Invalid bookmarks fall back to the
entry without a cue. Suspend data and SCORM exit rules are
unchanged. The local same-origin LMS browser fixture tests SCORM 1.2 and 2004 return
behavior; it supplies compatibility evidence, alongside the existing ADL-derived
normative checks, and does not replace official ADL suite execution.

The focused heading carries both position and title as ordinary visible text.
There is no separate resume live-region write. An authored accessible-name override,
title mismatch or absent suitable heading uses one visible full-summary paragraph
with `tabindex="-1"` as the sole focus destination, including in a saved replacing
Guided panel. The paragraph shows the position and keeps the localized separator
and title visually hidden in its full focused text. The cue remains until leaving the restored page or slide and is
excluded from print and canonical navigation labels. Browser focus/name evidence
does not establish screen-reader speech during a real LMS relaunch.

## Completion threshold units

New projects and exports without saved completion settings require every page to
be visited, including the last page. `DEFAULT_COMPLETION_THRESHOLD` in
`packages/content-model/src/constants.ts` owns this default. Explicitly saved
project and app thresholds keep their values.

Studio project settings and IPC store completion thresholds as fractions (for example,
`0.8` for 80%). The published learner runtime compares page-visit percentages from 0
through 100. The desktop export boundary converts fractions once and also accepts
legacy direct callers supplying percentages above 1 through 100. A value of `1`
continues to mean 100%; use `0.01` for 1%. Nonfinite, negative, and above-100 inputs
fail export instead of producing an impossible completion requirement.

Regression coverage in `build-desktop-mode.test.ts` inspects the actual SCORM ZIP's
host configuration for fractional and percentage inputs, including the `80` that
previously became `8000`. Existing exported packages require a new export to receive
this correction.

## Course pass mark

`praxity.json` `export.passingScore` is an optional fraction above 0 through 1, set in
Publish (in percent) and read by the CLI. Omitted, exports stay completion-only: the SCO
reports no score, so practice-check results stay in the course. When set,
the course score is the average of the latest scores of the required, automatically scored
questions (`scored: true`, not optional), with each assessment group counted once by its
group result. These are the same checks the knowledge-check rule collects, so hidden,
conditional and private required checks fail export for the same reason. A pass mark with
no such question also fails export.

The result is decided only once every counted question has a submitted answer. Until then
the SCO reports no score, so neither Praxity nor an LMS applying the manifest mastery value
can judge pass/fail from a partial score. Retries follow the latest-attempt rule, so a
correct retry can turn `failed` into `passed`.

Studio exports use the percentage page rule even when a pass mark is set. SCORM 2004
also keeps a failed result incomplete while passing is required and retries remain.
The runtime accepts `completionMethod: "quiz"`; with a pass mark and scored question IDs,
it uses the same score rule and page threshold. Older quiz configurations without scored
question IDs use their quiz score and the same retryable-failure policy. A decided score, including
zero, is reported with a minimum of 0 and maximum of 100; SCORM 2004 and xAPI also report
the corresponding scaled score. No `passed` result is sent before every counted question
has a finite score. Courses without a pass mark keep their existing completion behavior.

- SCORM 2004: `cmi.completion_status` follows the page rule and knowledge-check rule,
  with retryable failures kept `incomplete` when passing is required;
  `cmi.success_status` is `unknown`, then `passed` or `failed` from the score. The manifest
  item declares `imsss:sequencing` with a primary objective, `satisfiedByMeasure="true"`
  and `imsss:minNormalizedMeasure` equal to the pass mark, so the LMS derives the same
  result from `cmi.score.scaled`.
- SCORM 1.2: `cmi.core.lesson_status` stays `incomplete` until a result exists and
  while a below-mark result has an available retry. It becomes `failed` when those
  retries are exhausted, and `passed` once it meets the mark with the page rule met.
  The decided score is retained, including zero, and is written before status.
  The manifest item declares `adlcp:masteryscore`.
- xAPI: `passed` or `failed` statements are sent once per change, with `result.success`
  and the score, before any `completed` statement. Each course page creates a new runtime,
  so the xAPI runtime saves visited pages, answers, completion, success, score, bookmark and
  suspend data to `localStorage` per course and learner and restores them on the next page.
  Stored data is validated on load. Without that storage, a multi-page xAPI course could
  not count pages or decide a result. Only the latest attempt and latest scored attempt per
  question are kept. Nothing is saved for an unidentified learner, and blocked storage falls
  back to in-memory state. The LMS passes the actor only on the launch URL, so the runtime
  carries it to later pages in the tab's `sessionStorage`. Statements the LRS rejects or never
  receives go to a saved outbox of up to 50 and are resent when the next page initializes.
- A `oneOf` assessment group scores only the member the learner picks. With a pass mark,
  every member of a counted `oneOf` group must be automatically scored, or export fails.
- A graded `all` group reports the average of answered graded questions and unanswered
  required graded questions. Unanswered required questions count as zero; unanswered
  optional questions are excluded. Groups with every question required keep the same score.
- The tracker and manifest use the same pass mark, rounded to two decimal places in
  percent, so the SCO and an LMS agree at the boundary.
- Standalone HTML ignores a saved pass mark: it has no LMS to report to. An invalid
  `passingScore` in `praxity.json` stops the export instead of silently dropping it.

Regression coverage: `tests/tracking.test.ts` (decision timing, groups, retries, SCORM 1.2
status), `build-desktop-mode.test.ts` (host config and both manifests from a real package),
and `adl-conformance.test.ts`, which validates pass-mark manifests against the bundled ADL
XSDs.

## Course completion rule and retries

### SCORM 1.2 retryable failure policy for 0.3.0

The owner approved passed/incomplete reporting while a failed course result can
still change through an authored retry. `CourseTracker` owns that decision. It uses
the latest submitted attempts and the assessment runtime's resolved attempt limits,
including the active members of a scored group. An exhausted counted question does
not make the course failure final while another counted question can still retry.
After a group member submits again, the old aggregate remains pending until the
group reports its updated score, so a member's last retry cannot finalize a stale
failure before the new aggregate arrives.
Passing with the completion rule met reports `passed`; exhausting the available
retries reports `failed`. xAPI retains its existing reporting.
The tracker records a decided failure in the shared launch state. Explicit Finish
ends communication while preserving `incomplete` and suspend for a retryable
failure, including when a retained utility adapter performs the finish.

Graded questions default to one attempt. Automatically scored knowledge checks
default to unlimited attempts; authored `attempts: 0` is also unlimited. Revealing
answers limits supported reveal questions to one attempt. The assessment owner
resolves these rules for the UI and tracking event. Suspend data retains the
submitted attempt metadata across pages and launches, within the adapter's existing
payload limit. Older saved answers without this metadata are treated as final until
a new submission supplies it. Existing packages need a new export to receive this
policy.

ADL's [SCORM 1.2 RTE](https://lms.technology/for/scorm/1.2/standards/SCORM_1.2_RunTimeEnv.pdf),
section 3.4.4, defines `failed` as completed and failed, and `incomplete` as begun
but unfinished. Its `cmi.core.entry` and `cmi.core.exit` rules associate suspend
with resume. SCORM Cloud compatibility tests found that `failed` plus suspend
returned empty entry despite retaining the bookmark and answers. The policy keeps
an attempt unfinished while retry remains available. An LMS may still override
status from the manifest mastery score, so content cannot guarantee every LMS's
attempt handling.

No empty-entry bookmark fallback is added. Empty entry can mean review of a
completed SCO. Retained location and answers alone do not confirm continuation
of a suspended attempt. The visible resume cue still requires confirmed LMS resume.

### SCORM 2004 retryable failure policy for 0.3.0

When passing is required, a failed result with retries remaining reports
`cmi.completion_status = incomplete` and `cmi.success_status = failed`, with its
score. Exhausted retries report `completed` plus `failed`; passing reports
`completed` plus `passed`. Existing page and required-check gates still apply.
Page-only completion preserves separately recorded success, including `completed`
plus `failed` when the page rule is met.

The Publish option stores optional `export.passingScore` as a fraction. Export
converts it to runtime `passMark` and `scoredAssessmentIds`. Those fields, or legacy
`completionMethod: "quiz"`, identify passing-required completion. `CourseTracker`
uses the same attempt metadata and retry decision for both SCORM versions.
SCORM 2004 suspend data now preserves and validates that metadata on resume.

Score and success transfer before completion within a commit. Explicit Finish
preserves retryable incomplete completion through the shared launch state.
Exit remains `suspend` while incomplete or tracked success is failed or unknown,
and `normal` when completed and passed or completed without tracked success.
Saved-page orientation still requires confirmed LMS resume. Existing packages
need a new export to receive this policy.

ADL's [SCORM 2004 4th Edition RTE](https://lms.technology/for/scorm/2004/4th_edition/standards/SCORM_2004_4ED_v1_1_RTE_20090814.pdf),
sections 4.2.4 and 4.2.22, separates SCO-defined completion from mastery.
Section 4.2.21 defines session time, not success status. The owner chose to keep
a passing-required failure unfinished while retry remains available.
Cornerstone's [status mapping](https://cornerstoneondemand.my.site.com/s/articles/How-CSOD-LMS-handles-completion-and-success-statuses-sent-from-courses?language=en_US)
documents `completed` plus `failed` as Completed by default and `incomplete` plus
`failed` as In Progress. Its failed-status feature can map either to Failed.
That article covers 3rd Edition; verify 4th Edition and tenant settings separately.
Local browser evidence establishes the saved-page journey, not Cornerstone
tenant behavior or official ADL conformance.

Publish stores `export.requireKnowledgeChecks` in `praxity.json`. Omitted or false
preserves page-based completion. When true, the page threshold must be met and every
required automatically scored knowledge check must have a passing latest submitted
attempt. Optional and ungraded surveys are excluded. Assessment groups contribute
their group outcome, so a choose-one group does not require every alternative.

Required checks that are private, hidden, or conditional cannot provide a guaranteed
reportable result; gated exports reject those configurations. Authors can make those
checks optional or choose the page-only course rule. Manual/ungraded responses are
not automatic completion gates.

Scoring uses the latest scored interaction for each question ID, while LMS interaction
history retains every attempt. Resume uses this same saved history for the completion
gate. A later incorrect submitted retry can remove the passing result; it is not a
highest-score policy.
