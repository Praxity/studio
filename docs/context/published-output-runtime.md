# Published output runtime

Read this file before changing HTML or SCORM rendering, runtime selection, islands, published navigation, output CSS or assets, or performance budgets. Read `architecture.md` first when the change also affects desktop preview.

## Runtime boundary

`html-gen` compiles validated choice facts once per prepared course. Courses with
choices publish `choiceStateQuestions` and `choiceStateSignatures` in both host and
island config scripts. `choice-state-facts.ts` owns their schema and paired runtime
admission, separately from core course configuration. Admission recomputes each short
signature from effective facts and normalized visible text, then projects only declared
question/option fields. Term labels, highlights and doodles retain their visible text;
definitions, compiler footnotes, glossary entries, attributes and element boundaries
do not count. Invalid pairs are omitted
together, retain an explicit invalid status and diagnostic ID, and leave unrelated
reporting operational. The assessment island selects its block's admitted pair;
editor mounts without compiled facts keep their local policy. Each admitted host
binds a fresh evidence view before restoration. Signed answers with unchanged
material restore exactly. Unsigned submissions and changed material offer New
attempt in English and French. The previous verdict remains in ordinary course
outcomes while the learner edits a recovery draft; resubmission replaces it and
can lower the result. History adds no waiting gate or exit policy.

Studio's nonblocking `choice-raw-html-footnote` advice checks option label source
with content-model's HTML classifier and footnote recognizer. It deliberately
does not predict material signatures or parse or sanitize HTML. Labels containing
both forms may display footnote syntax as plain text, and editing the note later
may offer learners a new attempt. Authors can use
Markdown formatting or move the note to the question. This source check leaves
learner output, block data and signature derivation unchanged, and imports no
signature or DOM runtime at checker or CLI startup.

Raw compiled choice facts reject invalid attempt counts before publication.
Invalid choice-attempt settings also produce a located `choice-invalid-attempts`
source-admission diagnostic before omitted settings can invoke defaults. Studio
opens the project with preview fenced so authors can repair it. Outside edits
retain the last good preview, draft preview returns a refusal, and all publication
formats, including native PDF, refuse before output. Other reader diagnostics
retain their existing policy.
Identical facts under a repeated block ID are reused;
conflicting facts refuse with a named duplicate-ID diagnostic because a single
course-wide pair cannot represent both questions.

SCORM 1.2's suspend-data codec owns the wire representation and the 4,096-character
limit. Courses with choices use lossless JSON when it fits and a bounded,
versioned compact envelope otherwise. Every destination saves the same short
signature without an option proof. The export estimate uses that
same encoding decision with its allowance reserved first. Privacy filtering runs
before compression. Compressed saves require canonical Base64 and must match their
declared decoded length and checksums. Every replacement passes exact-payload
preflight. The row reader uses the admitted payload without decoding it again.
Courses without choices retain their ordinary codec. Unreadable saves remain
untouched and restore no current credit. Every LMS-bound assessment stays
editable and shows the storage notice. Draft recovery uses tab storage scoped to
the course, LMS learner ID and exact damaged bytes. It never becomes LMS credit.
Self-check drafts use the same recovery while comparison admission and submission
stay refused. The unavailable notice remains visible, including before any draft exists.
Completion, success and score writes are suppressed until a readable launch.
No saved answer or interaction row is discarded to fit.
`stageSubmission` keeps checked choice state provisional until `trackInteraction`
accepts it with its row in one suspend write. A failed write leaves previous bytes
and the draft intact, restores editable controls and attempt count, and shows the
localized storage notice. This staging applies only to SCORM 1.2; other hosts
retain their existing submission and reporting behavior after a failed state write.
Group completion follows successful submission only for the staged path. The
estimate retains the non-choice storage warning budget in mixed courses.

The compiler emits a course-wide `blockStatePolicy` in the host config. Self-check
defaults to device-only state; `{private=false}` permits LMS reporting.
`compileBlockStatePolicy()` owns that rule and device membership for exactly
`assessment` blocks with `assessmentType: "choice"`, `response.selectionMode: "single"`
and `private: true`. `writeDistractors` always has a named device member,
including direct input with `private: false`; it has no reporting option.
Absent/false choices create no policy entry or privacy asset
selection. Free-response/journal privacy keeps its existing meaning and storage.
Private choices with that exact policy predicate are publishable only when optional,
unscored, outside assessment groups and without a gate. Compiled input enforces
those practice-only conditions with `private-choice-practice-only`; omitted or
multiple `selectionMode` still refuses with `unsupported-runtime`. A fragment
cannot introduce a device policy absent from its preview context: it needs a full
context refresh.
Private-choice notice presentation loads in a separate asset only on documents
containing private choices. Ordinary choices and existing self-check-only courses
retain D03's bytes and observers. Localized notice text comes from server markup;
the controller caches and observes only the private activity roots.
After the actions, the existing secondary-text style explains device storage and
either identified course/learner/attempt scope or shared-browser visibility.
Restoring is visible and silent; saving and success are invisible. Failed saves
reuse `selfCheckNotSavedDevice` in the existing error text style, with one activity
status announcement on the first deliberate failed write per failure transition,
including when the failure began silently during restore. The static destination
line contains only the device sentence; scope appears after provider admission,
and identified scope requires an available persistent store. Result focus, retry and host reset retain the existing choice behavior.
The shared choice component captures its focused control on either print-media
entry or beforeprint, retaining the first capture across both events. Media exit
or afterprint restores focus only after screen styles return and only when printing
left focus on BODY. Later control focus or a pointer/key gesture, pagehide and
unmount cancel restoration. This also covers ordinary choices; printing changes
no selection, feedback or learner state.
The host routes private block reads and writes to `LocalStorageRuntime`, scoped by
course, learner and attempt when an LMS learner identity exists. SCORM carries
an opaque attempt token in custom suspend data and renews it on `ab-initio`;
xAPI uses launch registration when available. A manual xAPI actor is shared
build-time configuration and supplies no learner identity. Standalone HTML,
review shares and SCORM/xAPI launches without an LMS learner save under a
separate course-and-device scope in this browser. The device notice names that
scope. Preview retains its existing local state, reset, freeze and inspection
lifecycle.

SCORM 1.2 ordinary interaction rows append at
`max(history length before append, Number(LMS _count) || 0)`. Empty/non-numeric counts
fall back to history length. The optional ordinary count read bypasses the throwing
LMS error wrapper, so an unsupported count response does not abort the row. This
small ordinary-host check protects a resumed publication after its last private
choice was removed. While device policy can filter history, the existing lazy
private-support chunk validates the LMS count and advances a shared launch high
water on accepted IDs, before optional fields. Non-empty malformed counts skip
optional device-policy rows while preserving public suspend history. No additional
private append logic ships in the ordinary host.

SCORM 1.2 courses with device self-checks already use the private host; this change
therefore affects live self-check courses as well as future private-choice courses.
When privacy support fails to load or the LMS count is empty or errors, ordinary
interaction rows still use the history index as on base. Existing private-data
filters stay active before every outgoing write. With support available, a retained
accepted-row high water also protects subsequent rows when count support fails.
If support fails, its readiness promise still settles and ordinary controls,
feedback and suspend history remain usable. Private edits remain in memory with
the existing not-saved result/notice. Private choice failure notices remain visible
while the current selection and feedback stay usable.

Private legacy block state, interactions and objectives are removed from outgoing suspend envelopes. Course
logic admission refuses every private choice read before it can write variables
(`v` or legacy `variables`), including indirect navigation/completion effects;
unrelated public variables retain their existing bytes.

The provider's `getPolicy()` retains the authored permission; `getReportingDestination()`
drives the self-check notice from that permission and the active runtime. Standalone
HTML stays device-only with `{private=false}`. xAPI can report an answer while saving
its draft and comparison on the device, so storage destination alone cannot choose
the reporting notice. The lazy privacy buffer exposes the same decision before
storage support loads.

`SCORMRuntime.destinations` declares reporting and saved-state destinations.
xAPI reports only when its launch actor resolves; without an actor, its reporting
notice stays device-only and unsaved reporting state gets the existing copy warning.
Hosts combine that capability with the authored policy without inferring it from
storage methods or export format.

Starting a new identified attempt removes earlier attempts' private local state
for that course and learner. `LocalStorageRuntime` owns the storage prefix and
attempt cleanup; the private provider supplies its course/learner tuple, so other
courses, learners and unidentified device state stay untouched. SCORM `ab-initio`
renews the attempt token; cleanup runs only when SCORM mints a fresh token or
xAPI selects a registration this device has never stored for that course and
learner. A content-free registration marker survives draft cleanup. Reopening
an existing attempt or registration, including another LMS shell with its own
existing token, removes nothing. Cleanup runs before private state is exposed,
including when the new attempt has no edits.
If storage access, cleanup or saving fails, the draft stays in memory and the
provider returns `storage-unavailable`.

The self-check island emits document `praxity:self-check-completion` with exactly
`{ blockId: string, completed: boolean }` after a validated comparison, silent
restore or Start over. It carries no answer, ticks, revision or reporting metadata.
The deck consumes it for attempt gates, including a false value on reset. Private
gate releases stay in memory; deck suspend writes omit device-policy IDs and
self-check IDs without explicit LMS policy. Saved releases/interactions cannot
restore them. Valid device snapshots restore
their local release. Required self-checks and attempt deck gates use the current
document session, including prerequisites in later modules. Self-check publication
is supported; missing required runtime assets still refuse compilation.

The self-check session serializes reducer and continuation jobs in a synchronous
FIFO. `shared-blocks/src/activity-effects.ts` owns this queue, revision/intent tickets,
per-activity dirty-write slots, subscriber delivery and end-of-turn settlements.
It checks authority around provider writes and subscriber callbacks. The typed
self-check adapter retains admission, projection, commands and state transitions;
its external operations also retain their captured tickets. Enqueuing an edit,
reset, retry or disposal revokes the interrupted ticket immediately; the public
revision advances only when state commits. Each activity retains its dirty write
and unfinished read/admission progress. Dispatch still
returns a Promise; inside a reentrant callback, synchronous reads see the last
committed state until the queued command runs. Its admission receipt supplies a
current predicate after settlement, without assuming a revision increment.
State commits precede storage or publication. The
document owner adds its build/provider epoch and mounted activity, projects every
completion attribute before the first completion event, then drains interaction,
response and status effects. It checks ownership after each callback. Replacing
the provider cancels the previous session before rebinding controls. A response
already dispatched may finish, but cancellation prevents its later status update.
Private and native draft projection covers every committed activity before
completion publication. A subscriber exception is reported through the host and
cannot suppress later current subscribers or turn admission into failure.
Passive restoration writes no state and reports no response.

The lightweight document owner loads before privacy support and host discovery.
Rating-bearing documents load that external classic script synchronously in the
head, before the parser exposes native rating controls. Input capture covers
radios and the visible range control. Click capture binds to controls already
parsed. Focus entering a later control or pointer-down on it or its label binds
its activation listener before the native click, including clicks that leave
focus unchanged. Containers and document keep no click listener.
Pending choices survive the first provider install from the initial, undefined
provider. That admission gives only those choices a current ticket before
publishing the provider lifetime; the initial ticket itself stays revoked.
Reset, hide and later provider replacement discard pending choices. Attachment
consumes a current choice once through the rating's normal interaction and save
path, or restores the current provider when no choice remains.
Every activation has a distinct revocable lifetime. Hide invalidates it before
session cancellation; persisted return admits once, including held startup.
Provider replacement and explicit same-provider reset use fresh admission.
Retry and Start over keep their activity scope. Runtime attachment follows
registration and provider readiness. Session cancellation drains before a
successor replaces its controls; successful code loads remain cached.
A late bootstrap joins the current owner's existing admission without a second
runtime-ready publication.
Bootstrap, resource results, observers, frames and reporting callbacks retain
scheduling authority. Observers reattach under each current lifetime. Cached
return keeps the previous control geometry until current attachment settles,
retains explicit empty and failed-save drafts, and restores displaced criterion
focus without a comparison announcement. Disposal restores the provider property
before another build binds it. SCORM termination still belongs only to End.

`write-distractors-session.ts` drives its typed reducer through `activity-effects.ts`.
Revision changes re-admit a matching saved revision. The effects owner's separate
`activityTicket(scope)` retains activity generations; `ticket()` keeps its existing
revision/intent contract. Announcement keys are one-publication events consumed
through `subscribe`, while notices and `mount.notSaved` remain persistent. The first
edit while an existing unadmitted saved envelope is held announces
`practiceNotSaved` once per transition (Round 3 override). Edits while the initial
read is pending stay silent; after a failed read the first edit announces once.
An empty read saves held edits silently unless encoding refuses or the write fails.
Conflicting preactivation edits stay silent on restore entry; the next edit announces
once while recovery remains held.
A provider already reporting `storage-unavailable` before the read, with no value,
permits memory-only practice with `notSaved`. A failure first reported during the
read keeps the hold, as do previously observed or uncertain saved bytes. After a
failed initial read, explicit Start over discards unread saved work if its write
succeeds; a failed write never certifies durable deletion.
Its caller supplies the existing document lifetime's captured provider and `current`
function. Reads and writes go through `captureLearnerBlockState()`; no distractor
host or global runtime is installed. Async admission tickets retain the activity
request and generation, so sibling admission cannot cancel another activity.
Synchronous effect tickets retain revision and intent as before.
The adapter keeps refused saved input opaque, exposes bounded recovery fields,
and remembers the notice preceding a conflict. Empty initial reads flush held
local drafts immediately; successful restores never write. Only unsaved local
work can flush. An accepted write records storage evidence separately from the
receipt for the latest draft; missing acknowledgements keep revision changes
held rather than inferring an empty store. `rules.checkAnswer` was removed;
answer validation stays with `validateDistractorAnswer`.
The distractor island uses this same document lifetime. Its prompt-only baseline
retains a native answer field and the unsaved JavaScript notice. The early owner
marks edits, including explicit empty edits, before attachment. The initial island
probes captured storage only to choose whether saved-state admission is needed;
this observation never admits a saved value or authorizes a write. The unchanged
typed session reads and admits again when needed. Empty untouched activities need
no session/support request. First input, saved bytes or a failed read load the
session support; a valid Check alone requests authored content. Native drafts are
captured before the session subscription's immediate projection. Provider changes
and cached return revoke old continuations before rebinding.
The explicit bootstrap owns attachment in both HTTP/ESM and file/classic launches;
the island entry does not also attach itself. A mount guard revokes released
instances even if their document lifetime remains current. Native storage probes
may replace the provider reentrantly, so deferred session startup checks the
captured lifetime again before touching controls or reserving a load. Retry stays
mounted and guarded while its request is pending, and only a previous Check
intent permits Retry to continue into reveal.

Learner presentation belongs to `patterns/write-distractors/`. The Content
owner exposes only the answer and misconception labels for that stage; author
options never enter its DOM. Check refuses blank/oversized text without truncation.
Reveal keeps Check focus and announces only the short localized status. Rating
uses native toggle buttons, with option fields B onward and a conditional custom
input. Compare uses reducer validation and associated field errors, focusing the
first invalid field. Successful comparison replaces the builder with stacked
learner and author previews. Coverage counts normalized labels only; the visible
no-grade note explains that meaning and quality are not assessed. Compare remains
focusable and guarded, and the rating locks. Compare and Start over announce their
result followed by any save failure in a single status update.
Saved drafts, builders and shown results restore silently without writes. Failed,
invalid and outdated admission retains full codec-extracted text in labelled,
read-only recovery fields alongside memory-only edits. Empty recovery fields stay
hidden. The first held edit announces the unsaved transition once; later edits
keep the notice and recovery without repeating it. Retry cannot overwrite
conflicting edits and retains guarded focus in that state.
Start over explicitly releases the hold and returns focus to the empty answer.
The destination line shares private choice's admitted scope rule and stays
truthful before the first save. Failed saves retain the current view and announce
once per failure transition. Before browser print, the island copies visible field
values into wrapping text beside their labels, omitting unchosen select placeholders.
Print CSS presents the selected rating as plain text. Existing
revealed answer and comparison text prints in place; hidden stages remain hidden.
Controls, notices and errors do not print. Unenhanced and no-JS output prints the
question, answer label and blank writing space; empty enhanced answers keep that
space too. Comparison label separators use the shared locale formatter on screen
and in print. Print reads no session or authored
asset and performs no save or report. Afterprint, pagehide and teardown remove the
copies; afterprint restores a field only when print displaced its focus to body.
Publication admission
and direct rendering still refuse the block. ESM and classic draft support contain
reading and draft persistence. Comparison validation, digest admission and reveal
load separately after Check, or to restore a checked result. The initial budget
counts the loader, early document owner, island and every support file that a
returning learner can request without a new action. The controller permits a
22.5 KiB ceiling for this full closure in both ESM and classic output and 8 KiB
for Check/restore support pending final size work. Web Crypto is a candidate for
replacing the hash dependency, but `crypto.subtle` needs a secure context;
plain-HTTP LMS hosts need a fallback first.
Authored content payloads remain measured separately. Both rating toggles stay in the Tab order.
Start over is described by the visible loss hint. Refusal errors come from the
reducer and replay through it on a return within the same provider scope.

`writeLearnerBlockState()` requires the caller's captured lifetime and refuses a
revoked write. Learner code reaches the runtime, tracker and course finish through
`learnerRuntime(current)`, `learnerTracker(current)` and
`finishLearnerCourse(current)` in `learner-block-state.ts`. They read the host's
current object and gate writes with the ticket of the write's cause. Reads pass
through. Mounts and trusted gestures capture authority at entry; learner-event
handlers take the dispatch stamp; deferred work inherits its cause's ticket.
The host retains the raw globals for admission, lifecycle commits and End.
The privacy buffer delegates to internal storage
adapters under its own captured admission; learner consumers cannot call the
public provider's `set()` directly. The source-owner check enforces that boundary.
Dispatch stamps remain immutable across provider and build replacement, including
owner disposal. An unstamped learner event is refused while a document owner
exists. Cancellation may publish a false completion for UI projection with a
revoked write stamp; that notification grants no learner-state authority.
Host event handlers consume that ticket after earlier listeners return, and
fresh admission binds a fresh tracker without transferring old event authority.
Islands and viewer runtimes create observers, frames and timers through
`self-check-consumers.ts`. Observer attachment uses `observeSelfCheckLifetime()`;
each installed observer retains that attachment's predicate, including disposal.
Frame and timer helpers require captured authority. The source-owner check
rejects raw observers and schedulers in those directories, including aliases,
`setInterval` and `requestIdleCallback`. Two named exceptions retain their guards:
NarrationBar's idle metadata callback checks lifetime and cancellation; the
YouTube UI poll checks destruction, player and readiness.
Across the merged viewer bundle closure, the check bans raw learner global names,
requires stamped publication for every learner event except the named UI-only
list, requires write-capable listeners to consume their event stamp, and refuses
fresh ticket acquisition after an await or in a scheduled or promise callback.
React render bodies and effect callbacks inherit mount or handler tickets rather
than acquiring fresh authority. Assessment persistence keeps the state-changing
handler's ticket in a ref, initialized from its mount ticket. Write-capable
learner listeners must use their event stamp for every ticket acquisition.
The learner accessors and provider write helper require a captured ticket variable,
parameter or ref. DOM logic uses its named `synchronous` predicate for synchronous
writes behind guarded entries; deferred writes need per-admission state.
The authority proxy hides object-valued fields and passes through only `get*`,
`has*` and `calculateScore`; all other methods, including lifecycle and completion
methods, check the ticket.
The bundle test verifies that every non-dependency source input is scanned.

The source check is deliberately bounded. Template-literal global names,
concatenated names passed to `Reflect.get`, and folded names passed to
`getOwnPropertyDescriptor` can evade its name ban. Listener types taken from loop
variables, `initCustomEvent` and conditional event types can evade the event rules.
`queueMicrotask` and a same-file helper called inside `.then` can evade deferred
ticket acquisition checks. Lowercase components returning `createElement` can
evade the render-body rule. Any named predicate satisfies the captured-ticket rule,
including a made-up predicate. Fresh tickets in nested callbacks or same-file
helpers inside listeners or effects can evade acquisition checks.
These bypass forms have no production callers today. The compiled authority
regressions and runtime refusal remain required; these known
limits do not grant fresh authority to deferred work.

skipped: closure-wide scheduler rule, add when a display effect outside the current directories is reproduced

S9a adds only static validation. Course validation rejects self-check predicates
that request correctness or a score, with a content-free code and source location.
`deckGate=pass` retains its existing source refusal. Self-checks stay outside
`requiredAssessmentIds` and `scoredAssessmentIds`, so required knowledge checks
and course pass marks continue to count only eligible assessments. Runtime
completion predicates and required/deck gates consume the S9b session snapshot;
S7's submission and reset behavior is unchanged.

The compiler supplies content-free dependency references. Forward actions stop
synchronously before logic, navigation, tracking or completion while the current
owner is pending. The owner finalizes consumers after every relevant activity has
settled and its islands have attached. A failed dependency keeps its gates closed;
an unrelated optional activity cannot hold that batch. Required checks and deck
access read admitted views, never DOM completion attributes or saved release bits.
The existing navigation band presents EN/FR reasons and Retry/Start over controls.
The course host publishes provider-ready first, then defers page-visit completion
to the owner's current finalization ticket. Provider replacement revokes that
ticket. No blocked gesture is replayed when restoration finishes.

Adapters apply the policy before initialization, suppress private interactions
and objectives, remove private blocks from outgoing suspend-data round trips, and
filter private xAPI outbox entries before resend. Private responses must use
`reportLearnerBlockResponse()`, which checks the provider before creating an event;
the host also stops private response events before document consumers see them.
Course visits and course completion keep their existing reporting.

Reporting-mode self-check submissions reuse the neutral text-response adapters.
SCORM 2004 writes `long-fill-in`, the stable block ID, localized task description
and submitted answer; SCORM 1.2 writes `fill-in` with the same ID and answer.
Both write `neutral` without weighting or correctness. xAPI writes `answered`
with localized task name/description, `long-fill-in` and `result.response`, without
success or score. Restore never emits a response.
When a SCORM adapter cuts the answer to its existing field limit, its
`onResponseTruncated` callback supplies the actual limit to the host. For LMS-policy
blocks only, the host emits content-free `praxity:assessment-response-truncated`
with `{ blockId, responseLimit }`. The self-check displays the EN/FR disclosure
that the report was shortened, without calling the UTF-16 field budget a character count,
and includes it in the same single comparison-status update. The full activity
answer stays intact; its existing save result still determines whether it resumes.
A later short submission or Start over clears the notice. It is not persisted
or replayed on restore, and private responses never reach this reporting path.

S7 reads `readLearnerBlockPolicy()` and `readLearnerBlockSaveResult()` and renders
the English/French `selfCheckDeviceNotice`, `selfCheckLmsNotice` and not-saved
strings. Failed device storage and LMS writes retain the current draft
in memory and return coded, content-free save results. xAPI resume state is local,
so its save result names the device even in reporting mode. The SCORM 1.2 Publish
estimate budgets both self-check answer snapshots, ticks and content revision;
unbounded answers reserve the SCORM 2004 report length per snapshot. This is a
warning estimate, not a guarantee that every answer fits. Publish's EN/FR notice
and the CLI notice warn that answer text may exceed SCORM 1.2's limit and name
SCORM 2004 or device-only self-check mode as alternatives only when the estimate
counts reporting-mode self-checks. Ordinary long courses keep the course-length
warning and SCORM 2004 alternative. Self-check publication uses the same compiled
island and host state policy as preview.

Self-check activation has an independent small ESM entry and classic variant.
It installs answer validation and save notices, preserves pre-activation edits,
and saves fresh drafts without loading authored content. The server supplies
the library's empty-answer copy and the localized required-activity message.
The viewer manifest lists `selfCheckSupport` separately from the initial island
dependency closure. The compiler packages both support variants only for courses
using self-check, with their existing runtime notices. Activation uses
`loadBrowserModule()` on the first valid Check, or immediately when this block
has saved state. HTTP and Electron use ESM; `file://` uses the fingerprint-matched
classic support. The support bundle owns S5 validation, content loading,
criterion rendering and comparisons. A support load failure keeps the draft
field usable, shows comparison-unavailable copy and reveals no authored content.
Editing while restoration loads preserves even an emptied draft and retains
the submitted comparison. Start over is a quiet secondary action, visible only
after Check or a restored submitted comparison. Part counts name the selected
state; feedback states use neutral text with decorative icons. The parts label
uses the scene card's strong label pattern without adding heading levels.

Self-check browser print preserves the learner's revealed DOM. Labels appear
only after Check; model evidence and hints appear only after Show feedback.
The permanent document owner copies the current draft into wrapping print text
on `beforeprint`, without loading Content, saving or reporting. `afterprint`
clears that copy and restores focus if print styling displaced it. Print hides
controls and status/save notices without changing the screen comparison.

Author workbooks use the separate `CoursePdfLesson.selfCheckContents` input,
populated from `readSelfCheckContent` only when `includeAnswerSheet` is explicit.
The PDF owner validates Content against the prompt's task and ordered part IDs,
then prints the model, upstream numbered evidence, every hint and whole-answer
legend in the answer sheet. Full Content never enters reader blocks. Without
the answer option or its owning input, self-check PDF still refuses.

Workbook wrapping determines break points across the complete model before evidence
annotation. Empty inline boxes provide breaks every 16 graphemes in long tokens,
preserving copied text without invisible Unicode separators. Native PDF/UA refusals
list distinct unsupported authored graphemes with lesson and block IDs in EN/FR;
generated Typst source and temporary paths stay out of that message.

Self-check narration resolves the literal task to `{id: blockId, role: "title"}`.
Default container narration gives nested tasks their own targets, retaining
disclosure and card ancestry. Automatic scripts and source fingerprints exclude
criteria, model, hints, dynamic feedback and learner answers. Follow searches,
highlights and scrolls only the task heading; it may open the enclosing disclosure
without checking or submitting the activity. Feedback narration targets remain
deferred, so Show feedback never starts audio or sends learner text to recording.
Explicit author scripts remain subject to the existing spoiler advice.

Full-course preview and published output use one compiled learner artifact:

```text
PraxityPage
  -> planPageRuntime()
       -> static  -> semantic server HTML + bounded course shell only
       -> islands -> semantic server HTML + only the required enhancers
```

There is no full-viewer fallback. A supported block must have a complete server-rendered baseline and, when needed, a named island. Unsupported or retired capabilities and missing required island assets fail during compilation instead of changing renderers.

Every document loads the same small, fingerprinted `course-shell` before first paint. It may apply stored accessibility and color preferences, set query-driven minimal mode, route redirects/deep links, expose localized strings to deferred runtimes, and handle document-level arrow navigation. It must not render blocks, own learner state, infer capabilities, import React/Mantine, or grow feature-specific behavior. Course-specific shell data stays in the versioned inert `praxity-shell-config`; never restore executable inline templates.

The shell's Larger text and Reading guide buttons keep stable localized names and
report their state through `aria-pressed`. Toggling either preference updates its
visible effect and the existing preference store without writing an enabled or
disabled message to the shared live region. Guided uses the same Larger text
control. Guided slide changes keep their own announcement, and utility-page
arrival keeps its title message through `announcePreference()`. Pages content
arrival writes nothing; see [Pages arrival orientation](#pages-arrival-orientation).
Browser tests verify state, persistence and live-region mutations.
Human screen-reader listening must confirm that the state is clear.

The relevant entry points are:

- `packages/export-pipeline/src/runtime-plan.ts`: recursively validates pages and records required islands.
- `packages/export-pipeline/src/html-gen.ts` and `render-block-html.ts`: emit published markup.
- `packages/export-pipeline/template/src/island-loader.ts` and `islands/`: activate page-scoped behavior.
- `packages/shared-blocks/`: owns shared behavior, resolvers, strings, styles, and authoring-projection components.

Electron full-course preview renders the same compiled artifact as published output. Desktop page-list and sidebar small previews use the same compiler, retained artifact lease, and `praxity-course` frame with a query-driven content-only presentation; they do not mount a separate React renderer or learner hosts. Assessment groups reuse their presentation runtime in read-only mode, without loading or saving learner state; response controls remain inert. A block behavior change is incomplete until server HTML, any selected island, and the relevant authoring projection have matching semantics, state, visuals, and accessibility.

The canonical artifact owns learner markup, CSS, assets, navigation, runtime planning, and block behavior. Full-course preview exercises the selected static or islands path exactly as compiled. Page-list cards and the sidebar one-page preview reuse that artifact path but request an inert, content-only presentation; theme specimens remain decorative authoring projections.

Both small-preview modes use natural content height. Page-list cards crop that content
to their visible viewport; they must not centre a taller slide canvas behind the crop.
Full-course preview and published module decks top-align content at 48px below
the stage top, or 24px on phones. Only the stage scrolls; its bottom padding tracks
the footer height. Unseen content reserves a 40px bottom band, or 32px on phones,
with a fade above it and a localized More below button on the paper colour.
The button scrolls the stage by one screen. The band disappears at the content end.

## Pattern presentation ownership

The folder home is `packages/export-pipeline/src/patterns/<pattern>/`. It belongs
beside the compiler's existing `render-block-html.ts`, `bundle-viewer.ts` and
`export-css.ts`: a presentation can contain both server and browser TypeScript,
so `template/src/islands/` alone would not own it. Create a folder only when real
presentation code moves. This foundation does not create a placeholder tree.

A substantive pattern may own its server renderer, substantive published
enhancer, exclusive CSS and literal fixtures. Keep native extensions (`.ts`,
`.tsx`, `.css`) and direct imports from existing owners. No seven-file template,
empty files, forwarding-only enhancers, schema clones, copied EN/FR catalogs or
glob-discovered registries. Grammar-only page/float markers and nonvisual
logic/variables need no presentation folder.

Grammar retains schema, parsing and default resolution; content-model retains
block/page types; shared-blocks retains shared logic, identity helpers, grading,
completion and strings. Pinned upstream learning-pattern logic/schema/strings
stay upstream. The owner approved option C on 2026-10-19 for highlight: copy
the pinned renderer and enhancer, adapt their exclusive CSS to Studio tokens,
and retain MIT attribution and the source revision. Studio owns those copies;
upstream presentation changes require a manual diff, review and tests. Other
patterns retain their existing presentation ownership.
Domain helpers for chart/image geometry, headings and code stay with their
existing owners. Pattern-private helpers stay private until another caller needs
them. Shared published markup and disclosure helpers have one owner, preserving
their distinct escaping, URL and sanitization policies.

The renderer retains common wrapper IDs, focus markers, required gates,
sanitization and JSON projection. Recursive traversal and float grouping stay
with their renderer until containers can consume concrete prepared child slots;
do not introduce callbacks only to break an import cycle. Assessment membership,
layout and report preparation stay with the assessment-group owner. Full preview,
draft/node compilation and publication use these same presentation owners.

Learner state, captured-authority accessors, early self-check document lifetime,
privacy routing, logic engine, section flow, narration/deck players and transports
stay shared. A pattern folder is not an author owner: raw self-check Content
imports/access remain refused. Enhancer entries retain learner-write, stamped
event, host-access and lifetime-helper rules; changing their location grants no
exception. Code anywhere in either `src/patterns/` or `template/src/patterns/`
receives the full checks and enters the TypeScript program, even beneath
`fixtures/`, `tests/`, `test-utils/`, `__tests__/` or `e2e/`, or with a test filename.
Literal data fixtures such as `.json` and `.prax` are not executable code and
remain outside the code scanner. Pattern code also refuses write-capable learner
event strings and raw Content key strings, including exported constants and
concatenations and templates. Computed block-data keys, including destructuring,
resolve imported literal types and fail closed when unresolved. Raw dispatch,
including `.call`, `.apply` and `.bind`, with an unresolved event name fails closed;
`Reflect.construct` of event constructors is refused. Same-file constant identifiers
initialized with a literal `new Event` or `new CustomEvent` retain ordinary UI events.
Use the shared captured-authority owners for learner writes. These stricter rules apply only
to pattern roots; existing islands keep their current rule behavior.

`bundle-viewer.ts` retains explicit island entries, generated names and classic/ESM
behavior. CSS has two composition paths: viewer/deck entries there, and
full/lite/font/print assembly in `export-css.ts`. Pattern CSS owns only exclusive
selectors; shared tokens/reset/typography and print overrides retain their
existing owners and fixed cascade order. A later move must update both applicable
paths and prove identical output, including mixed selectors. Native PDF stays
with format-renderers.

`test:affected` runs the real source-owner command and the export-pipeline suite
(including bundle closure and byte budgets) for pattern files, learner-authority
roots and ownership/routing scripts. Every code change also runs the real
source-owner command, including desktop export-input and format-renderers changes.
The complete export suite supplements cross-project related tests so desktop
importers remain selected. Explicit prefix coverage maps unknown filenames and
non-JS inputs to both complete published browser suites. Missing fallback coverage
or CI output admission fails selection with the path and rule. Existing narrower
browser mappings continue to follow the CI output filter.
The viewer source hash recursively includes code, CSS, literal data and browser
asset extensions under `src/patterns/`, including test-named code. Dotfiles and
editor debris are excluded; symlinked pattern directories refuse with a diagnostic.
`viewerSourceFiles()` exposes the exact hash inventory: bundle-input coverage must
admit every real esbuild input outside dependencies and virtual modules. A new
import outside the hashed roots requires adding its input to that inventory.
This collection does not discover entries. Unrelated documentation/tests outside
the hashed trees do not invalidate the viewer cache. Delivery provenance reports
actual bundle inputs, rather than every inventoried pattern file.
`export-css.ts` retains production pattern CSS under the desktop offline catalog's
`css-sources/patterns/` prefix, excluding `fixtures/`, `tests/` and `__tests__/`.
That copy is source inventory only: full/lite/font/print assembly does not read it.
Pattern CSS reaches learners through explicit imports in the viewer and deck CSS
bundles. Retrieval sheets instead have an explicit `retrievalSheetCss` viewer
manifest asset (`retrieval-sheet.css`), bundled independently and included in the
prepared offline inventory and actual bundle-input hash checks. The compiler uses
its existing stylesheet fingerprint owner to fix the filename before rendering;
it copies the asset only when the document owner reports that a page linked it.
The document owner links it synchronously only when the page/module plan includes
`retrievalSheet`. Preview frames default to the prepared `retrieval-sheet.css`
asset; published packages always pass the content-derived filename. Its link precedes the shared/theme/authored stylesheet, retaining
authored overrides without adding any bytes to other pages or courses.
The retrieval island imports the pinned civil-date helpers and strings. Its native
spacing/date controls and manual Front/Back tabs hold memory only per mount;
arrows move tab focus and Enter/Space selects, matching the course Tabs block.
No learner-state provider participates. Destroy restores the exact public baseline.
A running enhancer failure restores both sides and shows the localized unavailable
notice. The document-scoped retrieval-sheet print owner admits one connected instance
at a time. Print-only ancestor paths expose hidden, clipped, collapsed and deck
placements without changing the screen DOM. Nested sheets remain separate instances.
Questions have about 17 mm of writing space with one 0.75 pt closing rule, then
answers start on a new page. Long content has no two-page height cap.
Scope ends on afterprint, print-media exit, throw, pagehide, destroy, the next page
pointer/key gesture or a five-minute fallback timer. Gestures and the timeout clear
without restoring focus. Cleanup removes all listeners and timers. Only focus displaced to
the document body returns to its original connected control; later control focus,
destroy and pagehide suppress restoration. Ordinary browser Print keeps the whole
course and both sides of every sheet.
HTML, fragments, preview and packaged exports publish retrieval sheets through the same renderer.
Practice logic reads, required/gated containers and assessment-group membership remain refused.
Browser-entry moves must preserve the viewer manifest closure and desktop asset
inventory before shipping.

## Compilation and deployment boundary

`compileCourse()` is the only learner renderer. It returns an opaque artifact whose manifest hashes the target-neutral files and records stable course, page, block, state-schema, and runtime-plan metadata. Keep deployment targets out of this interface.

Shared-blocks owns `constructSelfCheckPromptBlock()`, which builds a fresh record
with `{ task, parts: [{ id }] }`, declared scalar settings validated by grammar,
and explicit accessibility, layout, visibility, name, locale and palette fields.
Unknown keys and malformed values refuse with content-free `ESELFCHECKPROMPT`.
When a self-check is present, the adapter validates its raw defaults before
canonicalisation, including overridden aliases, and constructs the merged record
with authored values winning. Captured contexts validate those defaults on the
first self-check too. Courses without self-checks leave those defaults unused.
Compiler admissions clone first and recursively replace self-checks before inline
preparation, scans and glossary derivation. Fresh, captured, refresh and draft
inputs share construction; adapted replacements pass through it again.
Clone failures use content-free `ECOMPILERCLONE`. The internal HTML renderer
translates the constructed task to its escaped fallback. The compiler derives
glossary terms from admitted pages; export inputs cannot supply a glossary list.
Captured HTML contexts also derive it again before reuse. Unresolved preview
nodes carry the `invalid-source` code and source line keyed by node identity.
The renderer selects fixed localized text; parser messages stay outside the artifact.

Image optimization runs here, after asset resolution and before dimensions, HTML and artifact hashes are prepared. Eligible local PNG/JPEG references use smaller WebP derivatives; unsupported images retain their original references. Project files are untouched, and exported originals remain available to encoded links and custom HTML/CSS. The offline codecs are compiler resources, never learner runtime assets. Preview and deployment use the same captured image bytes. Results persist in the user's OS cache at
`Praxity/images`, outside strict project read admissions. Keys bind source SHA-256,
encoder options and the pinned codec/pipeline version. Entries bind their output
SHA-256, install by atomic rename and use oldest-access eviction at 256 MiB or
1,024 entries. Corrupt entries miss; cache I/O errors are reported and preserve
fresh encoded bytes. No cache files enter the asset inventory or export package.

For package targets, `deployCourse()` works from a private copy of captured artifact bytes. A deployment may only:

- fill the single compiler-owned `<!--praxity-deployment-head-->` slot;
- add the selected host, review, manifest, schema, or xAPI files; and
- package the result.

It must not reparse source, render learner content, change CSS or navigation, select UI runtimes, or read mutable desktop resources. Normalize the deployment slot when comparing core hashes across targets. Repeated and concurrent deployments from one artifact must remain isolated; dispose the artifact explicitly when its owner is finished.

The `electron-preview` target is a retained read-only lease over those same captured bytes. It exposes the immutable manifest, a stable non-sensitive course-origin token, manifest-checked streaming reads, and disposal—never a temporary directory. Electron registers `praxity-course` once before app readiness as a standard, secure, fetchable, streaming scheme. Its URLs include both the stable course token and immutable revision; the handler accepts only the exact retained pair and a manifest-listed relative path. Keep `HEAD`, single byte ranges, MIME types, strong ETags, immutable revision caching, and the course-specific CSP intact. Never add `bypassCSP`, service workers, `file://` access, a localhost server, or a raw filesystem path to make preview hosting easier.

Course frame navigation may start only from Studio chrome, then remain within the same retained course and revision. Query strings and fragments are allowed; path changes still require a manifest entry. Unknown courses, revisions, files, permission requests, and navigation from learner content to another origin stay blocked. A live course frame may open only its retained artifact's `glossary.html` in a separate sandboxed window without a preload or Node access. That window blocks further popups and navigation. All other popup requests remain blocked. Third-party media frames remain subject to the explicit CSP allowlist and do not gain course-file access.

Every learner and utility page carries the same inert `praxity-host-config`. SCORM 1.2, SCORM 2004, and xAPI are separate tree-shaken host bundles selected only by deployment. Do not restore an ambient format detector, umbrella SCORM runtime, or target checks inside islands. Review comments are also a deployment host, with their own CSS and JavaScript rather than rules appended to learner CSS.

SCORM hosts declare their shared support asset in the viewer manifest's host
dependencies. The package loads that classic script before its SCORM host. It
exposes the existing session, API discovery and CourseTracker owners to the host
while the shared records remain keyed by LMS API identity. Validate and copy the
complete dependency list in source and desktop builds. HTML, xAPI and Electron
hosts load no SCORM support dependency.
A nonempty course-wide self-check policy selects the manifest's `privateHosts`
variant and `privacy` assets. Empty policies keep the ordinary host and copy no
privacy assets. The privacy bootstrap is a deferred classic script before the
host: it owns config validation, suspend/outbox filtering and the four EN/FR
mode/save strings synchronously, using the existing `resolveLocale`. It adds
those strings only to policy courses, even if loading support fails. It then
loads persistence and attempt identity as an ES module
on HTTP or a classic fallback on `file://` (including Electron). No island owns
this policy. Private writes return `runtime-loading` and stay in memory until
the provider loads; buffered writes then pass through the existing storage
owner. Ordinary and reporting-mode IDs always use the existing block-state
runtime while support is loading or failed, including LMS reads and writes.
Failed loading returns `runtime-write-failed` for private IDs and keeps their
memory copy.
A missing synchronous guard closes host initialization with `EPRIVACYLOAD`.
Self-check publication remains refused until its output capability is enabled.

The shell retains its direct session-reset implementation for launch redirects.

The retained `standalone` target serves the same host and HTML bytes as the
published HTML package without making a ZIP. Studio's top-level Read mode uses
this target on its read-only learner origin. Its runtime and tracker persist
course-scoped state only in that origin's browser local storage, independently
of Studio's preview-state store and author project. Iframe preview continues to
use `electron-preview` and its authenticated parent handshake.

## Selection rules

Use the first option that satisfies the behavior:

1. Semantic HTML and CSS.
2. A small DOM enhancer over complete server HTML.
3. A framework island when complex shared state or an existing accessible component makes it materially safer.

`planPageRuntime()` is the source of truth. Do not infer runtime needs again in the bundler, HTML generator, or loader. Extend the same recursive plan when CSS capabilities are introduced.

Select navigation from resolved settings, including defaults. Plain and narrated pages with the same navigation settings must retain the same sidebar, toolbar, and footer; only authored page overrides may change their configuration. Test implicit defaults as well as explicitly saved toggles. A text-only page with interactive navigation needs the navigation island even though its blocks are static.

Pages reserve measured sticky top and bottom bars through scroll padding on the document scroller. The shared scroll owner updates those measurements on bar and viewport resizing; group review links use the same clearance. The module deck retains its stage scroll padding for the fixed footer. After an individual Check, scroll the first selected option's feedback when present, then the focused action, with the action taking priority if both cannot fit. Reveal clips reserve room for the action's outline so the complete ring remains visible.

- Static pages emit no block or island learner UI runtime. Initial JavaScript is the bounded shared course shell and deployment host with its declared dependencies. Confirmed LMS Pages resume may load the packaged classic cue script described below. Deployment hosts such as SCORM tracking and review comments remain independent of the page runtime plan.
- Islands declare only their direct capability. Calculate and test the transitive asset closure when enforcing budgets.
- Missing required runtime assets, unsupported block types, and retired capabilities fail compilation. Do not emit a partly interactive page or add a fallback renderer.

## Server HTML and ownership

Server HTML is the accessible baseline. It must retain content, landmarks, names, native controls, stable dimensions, and usable page links when JavaScript fails.

Self-check has an explicit spoiler-policy exception, decided 2026-10-09. Its
baseline contains the literal task heading, labelled native answer field, one empty
status region and an EN/FR notice that comparing with the model requires JavaScript.
Criterion labels, model answers, hints and evidence are absent from static HTML and
generic JSON. Empty criterion targets retain source identity only. Its prepared
controls use `data-praxity-js-control`; full and lite output share the same DOM and
styles. Before the initial entry arrives, the native field retains its draft and
an input marker distinguishes an explicit empty edit from untouched markup.
The initial entry installs the permanent document/provider owner, session, draft
persistence and recovery controls before requesting the eager canonical adapter.
ESM statically imports the same classic core that file launches execute directly.
Both entries handle rejected canonical loading without top-level await.
The build identity covers the core and canonical sources; companion loading joins
one attempt per document/build. Retry clears only a failed attempt and calls its
loader directly. Successful code remains shared. Failed loads retain answer text
and opaque saved bytes, show localized Retry and persistent-failure guidance, and
move focus only when hiding a focused Check. Typing still saves through the captured
provider while canonical code waits. Provider replacement invalidates attachment
before rebinding and carries the explicit draft into the successor session.

The self-check initial raw ceiling is 58 KiB (owner, 2026-10-11) until a startup
split tightens it. Its manifest closure charges the
core, ESM bridge and mandatory canonical
adapter, including transitive dependencies. Fresh request journeys verify that
closure for HTTP and file launches without learner input and record full-page bytes.
Support remains deferred until saved-state admission or a learner Check.
The catalog stays in JavaScript and canonical startup remains eager.

Rating-only documents also start the lightweight document/provider owner before the
host. Native radio input before rating attachment belongs to the captured lifetime;
attachment consumes a current choice once through the normal save path. Reset or
provider replacement discards the old gesture. Rating's asset closure includes the
owner entry without the self-check implementation or support code.

`shared-blocks/src/self-check-session.ts` owns restore membership, admission,
explicit edits, Show feedback, Start over and retry generations. Its injected lazy
adapter keeps full Content private and uses S5's admission and transition rules.
The session snapshot's `startup` outcome owns canonical attachment: pending,
ready, unavailable or cancelled. `ready` resolves a settled snapshot with coded
failures only after canonical startup and every current member settle. Startup
waits for every canonical control set in the current provider epoch before publishing
completion. Fresh empty members remain unavailable while canonical waits. Canonical
failure makes every member unavailable, including for consumers that subscribe later.
Edits and reset retain that failure until an explicit Retry attaches canonical successfully.
An unavailable or refused activity has unavailable completion predicates;
valid empty/draft state is known incomplete. Reset cancels its pending admission
without settling other members. Retry fences older requests and clears failed
support imports while retaining successful support. Disposal and provider replacement
invalidate outstanding work. Completion projections use the existing exact
`{ blockId, completed }` document event, only after the batch settles.

The document adapter binds each session's reads and writes to its admitted provider.
Host admission captures the effective provider returned by an injected accessor after
installation. An empty provider or a reentrant lifetime transition refuses admission;
retaining or wrapping a provider alone does not block island hydration.
Assigning a replacement provider cancels that session immediately, creates its successor
and rebinds every mounted control. The document owner reference-counts mounted roots;
each scope releases only its own references. The final release, explicit document
disposal ends that owner. Pagehide suspends it, invalidates attachment, removes input
capture and retains its draft. A persisted pageshow starts a new provider epoch and
readmits that draft. Synthetic lifecycle tests cover this contract; real browser
back/forward-cache restoration remains release evidence. Old cleanup closures retain their owner and cannot
dispose its successor. Automatic enhancement owns its references until document disposal.

The answer remains editable and copyable during recovery. EN/FR notices describe
restoring progress, unavailable comparison, changed activity and invalid saved
comparison. Changed and invalid recovery messages appear below the answer before
its actions. Load failures hide Check and group primary Retry with secondary Start
over before the save notice. A failure triggered by Check moves focus to Retry.
Persistent failures ask the learner to tell whoever runs the course. Refused state
offers Start over. Passive restore never writes saved bytes or reports a response;
rejected bytes survive until an explicit edit or reset. Restore keeps focus and the
activity status empty. Material failures use the existing navigation announcement
channel once per reason.

Only Check reveals criterion labels; only Show feedback reveals the model,
numbered evidence and hints. Check validates the current answer after asynchronous
admission, then focuses the first native checkbox. An explicit empty edit retains
the old submitted answer/ticks and labels them Previous comparison. Show feedback
replaces that snapshot, leaves focus on its button and announces one summary.
Start over clears local state/completion and focuses the answer. The host retains
S6's privacy/reporting policy. S9b connects logic, navigation, required/deck gates
and tracker startup to the permanent owner's current epoch. Logic skips an entire
rule when any dependency is pending or unavailable, including negative and OR
predicates. Dependency resolution follows variable writers and compound operands
across modules. Variables hydrate from the final provider before reversible
effects; LMS/URL values precede saved variables. Explicit restore origin permits
show, hide, require and disableCompletion, while suppressing assignments, compound
mutations and jumps. Hydration, Retry and Start over use that reversible pass;
hydration preserves an existing jump from a deliberate interaction.
Deliberate Show feedback runs its ordinary interaction pass once. Ordinary learner
input, including a rating after self-check resume, also runs an interaction pass.
A rule consuming that new input may write variables and jump; unrelated rules
consuming only restored self-check state keep their reversible effects. The same dependency resolver follows block
references, variable writers and compound operands for both decisions. The compiler uses the
effective deck-gate resolver with module options, so an options-only attempt gate
on an optional activity selects self-check startup on later dependent modules.
The owner runs
effects before learner tracking and consumes the host's visit continuation once;
each effect checks its epoch ticket. Deferred logic frames retain their scheduling
ticket and reject revocation before evaluation or validation cleanup. Navigation
and deck display frames retain their scheduling epoch and cancel on owner changes
or pagehide. Required-validation timers also retain the current validation and
epoch. The existing owner event signals epoch changes; it grants no readiness.
Held provider-ready continuations check their captured provider and document lifetime.
Clearing a logic gate resumes that deferred
visit after the caller finishes its DOM effects. Provider-ready remains independent so
imports can start while learner gates are closed. Compiler references preserve the
local context-pending exclusion; pending previews expose no admitted completion. Pages packages a small module bridge
over the same classic logic entry for HTTP and file origins. File output also
packages the existing rating island as a classic script for required rating effects.
The permanent document owner also keeps the print answer nodes and print focus.
Attaching canonical controls during an active print preserves the literal draft
output. Its saved activity and action resolve to the live control after recovery
remounts; failure rebinds a captured Check to Retry before hiding Check. A later
focus change cancels print restoration, including when that control then blurs.
After print it restores the same field or the successor Retry control;
printing performs no save, comparison disclosure or response report.
The S14 release evidence is recorded in [self-check-release-evidence.md](self-check-release-evidence.md).
Missing required island assets fail with `EISLANDASSET`.

S4b accepts `selfCheckContents` separately from prompt pages. Each entry binds a
block ID, validated library Content and S5's shared SHA-256 content revision. The
project input bridge calls `readSelfCheckContent`; direct compiler callers supply the
entries explicitly. Missing, duplicate, orphaned and mismatched entries refuse
with content-free codes. `src/self-check.ts` privately captures authored content
and emits one fingerprinted classic script per activity under `self-check/`.
Only those manifest-listed files may contain model, label, hint or evidence bytes.
Asset dependency revisions reuse `selfCheckContentRevision`; manifest hashes cover
the emitted bytes. Page dependencies and asset closures include them, so hidden
edits invalidate the owning page while retained contexts and sibling assets stay intact.
The dormant loader uses packaged classic activity scripts on HTTP, file launches
and the Electron course scheme. The island loader selects the classic self-check core on file launches; HTTP
and Electron import its ESM bridge. Both request the build-bound canonical
adapter, which exposes `PraxitySelfCheckIsland` without mounting on evaluation. Activity
payloads escape non-ASCII code units, so a host's Latin-1 script charset cannot
alter authored content. Unresolved nodes receive no authored runtime asset.
`src/self-check.ts` owns content admission, library logic imports and authored
asset writes. Generic compiler code discards the content channel at two declared
strip sites and receives references and manifest entries. Source-owner checks
enforce this boundary.

Draft `renderNode` fragments carry `data-self-check-context-pending`, including
model-only edits whose prompt is unchanged. S7 disables Check and does not load
or reveal their captured asset or restored comparison. Refreshed context output
replaces them with current references and normal controls. A direct caller can supply older Content
with the same task and criterion IDs and its matching revision. The prompt
projection carries no content revision, so admission cannot prove its freshness
against that caller's source. The project input bridge captures both together.

Sequential labeled graphics display a localized order instruction with a block-specific
ID. The graphic group and pin buttons reference it with `aria-describedby`. Future
unrevealed pins stay natively disabled until the preceding pin is revealed. Revealed
pins remain enabled for rereading, including after restoring partial progress; selecting
a pin keeps focus there. The retained React projection follows the same availability
and rereading rules. Unrestricted reveal keeps its existing caption, and the no-JavaScript
ordered list still exposes every title and description.

Pages outline checkmarks report recorded visits, including entry to an unanswered
required activity. Their hidden text suffix is "Visited", or "Consultée" for a
French page and "Consulté" for a French module. A literal space separates the
full destination title from this suffix. The navigation island reveals the
server-rendered label from stored visits, accepting stable page IDs and legacy
slug aliases. It preserves `aria-current` and adds no live announcement. Module
markers retain their existing visit checks. Assessment and course completion
remain separate and keep their completion labels and rules.

- An enhancer may add behavior, state attributes, or progressive disclosure. It must not replace complete markup with an empty mount.
- Mark a generated control that has no useful no-JavaScript action with `data-praxity-js-control`; do not hide a shared component class globally, because the same component may remain live in an authoring projection.
- If React owns server-rendered markup, its first render must be equivalent and use hydration. `createRoot()` over an existing server tree recreates the DOM and can reset focus, scroll, and input.
- One runtime owns a subtree. DOM enhancers may remain composable inside other DOM-enhanced containers. A React-owned subtree must not also be activated by descendant islands.
- Activation must preserve outer geometry, focus order, authored values, learner state, reduced-motion behavior, forced-colors behavior, and right-to-left layout.
- Initializers are idempotent. Clean up observers and global listeners when their owned DOM is removed.

Signed signature tabs use explicit `aria-disabled="true"` and a visible localized
Clear instruction associated with both tabs. Their single roving Tab entry remains
available; arrows, Home and End move focus without selecting another method,
changing the visible panel or saving learner state. Clear restores selection and
returns focus to the active input. Restored typed signatures follow the same
contract. The retained React projection uses this contract too.

Assessment item DOM ids use the block identity and the item's source index, kept
with the item during shuffling. Categorize row ids, matching controls and their
labels and dropdown references, and fill-blank result references share this rule.
Item text and persisted answer keys do not enter these ids. Learner state retains
its existing keys, including categorize text and occurrence keys, so older saved
answers still restore. This changes no authored syntax or assessment defaults.

Hotspot starters put the learner question inside the assessment, in both heading
source and saved image source with `question:`. For older stemless hotspots, static
HTML and the hydrated response group use the authored image description as the
accessible name. They omit "No question text" from learner content while retaining
the localized required marker and all scoring and attempt rules. Other assessment
placeholders and authoring diagnostics remain available. Missing or meaningless
image descriptions still need correction through the content checker.

Assessments reserve the current Check/Submit row before the first interaction.
Choice server HTML includes the same empty action row before hydration, and both
server and active layouts cancel the empty feedback gap. Group members hide their
individual action rows in both layouts, leaving room only for the shared action.
The existing response eligibility still controls when the button appears. Group
questions leave submission space to their shared action. The focused result comes
before attempt counts and Try again in both DOM and visual order. Empty feedback
adds no spacing. Overall results use the same bordered surface with or without an
authored explanation. Inline-only fill-blank results put a localized review summary
in the existing feedback surface. Submission focuses Try again if available,
otherwise the card's Continue action. The button retains its visible name and
uses `aria-describedby` for the result followed by the authored explanation,
as separate ids in reading order. Choice uses the selected answer's result and
its inline explanation when no overall explanation exists. Row activities use
their count summary; free responses use Completed. Without an explanation, the
visible result alone describes the action. The generic review status never does.
Inline-only fill-blank review has no question-level result or explanation, so its
action has no feedback description; individual blank marks remain beside their inputs.
Ids derive from block identity. Retry removes feedback descriptions from inputs
and buttons while keeping the visible answer review. The container is plain, unnamed and non-focusable;
no live region is added. Without a next action, the first nonempty feedback text
receives `tabindex="-1"` and focus; without feedback, the question text retains focus.
Group submissions focus an available member Retry, then Continue, the remaining
group Check action, or enabled page/deck navigation, described by the group score.
The summary is plain and not focusable when an action exists. Terminal groups
without an action focus the summary with tabindex=-1. Group submission suppresses
member focus once its required responses are ready, so its shared result owns the announcement.
Incomplete groups retain individual feedback focus until a summary exists. Result refreshes retain
the summary node. Partial saves retain the score and review links without adding
the separate saved announcement; journal saves without a score keep that status.
Deck navigation clears Next's feedback description when leaving the slide or entering completion.

Choice labels use the full text column before Check. After Check, the icon and
result word appear below the label, followed by its authored explanation, at all
widths. Multiple choice shows its existing localized selection instruction below
the stem. Attempt counts use the shared assessment label formatter's locale
grouping. Dark success and error inks come from the shared reading palettes;
status tints retain the design record's 10% ceiling.

The N11 NVDA 2026.2 trial in Chrome 155 and Firefox 148 found the described Retry
button reads the explanation once in browse and focus modes, all four cells.
The named feedback group repeats it in both browse-mode cells. The paragraph
fallback reads it in three cells, but Firefox focus mode says only "paragraph".
Up Arrow from the described button reads the explanation in place once in both
browsers. These fixture results guide delivery; published speech still needs
an NVDA recheck, including group action descriptions and terminal summary fallback.


Submitted responses remain readable and noneditable, including matrix and likert
radios and checkboxes. Matching prompts retain their top alignment when per-pair
results appear, and their disabled answer text keeps the course text color. Hotspot
numbers and checks retain their review colors without opacity fading. Retry keeps
its button mounted until focus reaches the first enabled response, with the question
text as the fallback. Attempt limits, scoring, required-status handling and saved
answer formats remain unchanged.

The design token owner derives `--praxity-color-accent-foreground` from the actual
accent fill. Submitted radio and checkbox marks and selected hotspot badges use
that foreground; their meaning must survive pale accents in dark themes. Submitted
controls retain a contrasting boundary. Forced-color review marks, badges and
matching answer text use the Canvas/CanvasText system pair. Legacy section accent
values outside the token owner's parser retain their existing button-text fallback
without preventing export.

Required assessment and rating controls do not use native `required`, because an
empty required radio group can be exposed as invalid before the learner submits.
Single-choice and rating radiogroups expose `aria-required`; multiple-choice and
categorize groups include the localized required status in their accessible labels.
Matching and fill-blank controls expose `aria-required` directly. Existing answer
and completion checks still gate group submission and forward navigation. A failed
submission adds `aria-invalid` and an associated error; clearing it preserves the
control's original required status and description references.

Without JavaScript, the choice assessment baseline keeps its inputs disabled and
explains that the question needs JavaScript. It has no submit control or native
submit validation flow. Rating fieldsets have no form submission flow; their DOM
enhancer selects radios by type and sets completion after a learner selects one.

Choice and assessment-group chooser rows keep their native labels and inputs
stationary during pointer activation. Pressed-state scaling can move the pointer
from label to input between down and up in WebKit, sending the click to their
shared container and losing selection. Hover, checked and focus feedback remain.
The published choice test checks row padding and an integer screen coordinate
inside the empty control wrapper, outside the native input, after paint settles.

## Activation and cross-island behavior

Private, ungraded free responses with a long input are journals. The shared
`isJournal()` owner in `packages/shared-blocks/src/journal.ts` classifies them in
server HTML and the assessment renderer. Journals open with the shared scene
header and a decorative notebook tile. The scene holds the existing prompt
element and id; plain questions keep their existing header. Scene styling uses
the activity padding and card radius, logical margins, and the accent ink token.
Print removes the band background and tile; forced colors retain their boundaries.

Saving a journal records a UTC ISO `savedAt` alongside its existing learner answer.
The response displays the saved date and time in the course document's language,
using `Intl.DateTimeFormat`, and includes that line in TXT and DOCX downloads.
Legacy or invalid timestamps leave the answer readable without a date. Restore
never supplies a timestamp. The date is ordinary text and adds no announcement.
The response and date use the host's existing learner state: LMS suspend data in
SCORM, local storage in standalone HTML, and the preview runtime in preview.
Private responses stay out of assessment interaction reporting; the date is
never part of interaction reporting or xAPI statements.

Choose scheduling from the user-visible requirement, not the module name:

- Eager: document-level state that must be ready immediately, currently navigation and logic, plus explicitly autoplaying media.
- Near-visible: ordinary block enhancers and expensive decoration. Use `IntersectionObserver` with a measured preload margin and an immediate fallback when it is unavailable.
- On interaction: a complete, keyboard-operable server facade can import heavier behavior from the activating click or key event.

Do not mark decoration eager merely because it lacks an observation target. Give it a real target. Do not add an idle scheduler until a measured cross-cutting feature needs one.

Cross-island communication must survive activation order. An event sender must activate the receiver, queue durable state, or target server HTML directly. In particular, test narration reveals, logic-revealed content, required blocks below the fold, and islands nested in accordions or tabs.

Document-wide runtimes have the largest blast radius. Keep them only when the behavior is genuinely document-wide. Prefer explicit state events and owned targets over a broad `MutationObserver`. Batch layout reads before DOM writes, cache geometry within a frame, and coalesce refreshes with `requestAnimationFrame`.

Do not add `click`, `mousedown` or `mouseup` listeners to containers, landmarks, `body`, `document` or `window`. Chromium exposes any element with one as clickable, attributes document and window listeners to the root element, and passes a click-ancestor action to every passive descendant. NVDA then said "clickable main landmark" in Guided, whose deck root delegated link clicks. `template/src/components/deck-control-activation.ts` owns Guided link and transcript-seek activation. The deck binds the controls present when it starts, island-rating binds the feedback links it clones, and `renderIsland()` resolves links inside React roots. React already listens on those roots, so they stay clickable either way. Inline tooltip clicks bind to individual triggers; outside dismissal uses document `pointerdown`. More's outside dismissal uses `pointerdown` plus `focusout`. A Chromium CDP check in `tests/deck/module-deck.spec.ts` fails if the deck, workspace, `main`, `body`, the root element, `document` or `window` gains a mouse-button listener.

## CSS and asset delivery

Desktop prebuild, release verification and standalone CLI packaging share the prepared
export-input inventory in `packages/export-pipeline/src/export-assets.ts`. It gathers
viewer manifest assets, copied resources and CSS/font inputs from their owners.
Legal metadata validation belongs to `third-party-notices.ts`. Release verification
requires the complete selectable font catalog. Course compilation copies selected
font faces and fails when their required bytes or entire catalog are missing, while
retaining nearest available weight/style fallback.

Highlight delivery has an explicit `highlight` runtime capability and an independent
`island-highlight` build, with ESM and offline classic adapters. Its required
`highlightCss` prepared asset is selected synchronously only for that capability;
ordinary courses select no highlight assets. Source hashing and the prepared viewer
inventory cover the island, owned presentation files and CSS. Copied presentation
retains the upstream MIT terms; its memory-only enhancer imports the admitted upstream rules and strings.
Highlight publishes with limited support in preview, HTML, SCORM 1.2/2004, xAPI and module decks. Marks and Check results stay in page memory and reset on reload. Browser Print / Save as PDF prints the authored passage and complete Answer. Native PDF and block narration remain unavailable. Canvas Read runs the learner activity; Canvas Edit shows the script-stripped passage and native Answer without highlight text-edit bindings.

Highlight is optional practice. It reports no marks, results, score or completion. The complete no-JavaScript baseline includes a native Answer disclosure. A failed enhancer keeps that baseline and adds a localized failure notice. The [bilingual source example](../prax-format/examples/highlight/course.yaml) is compiled by `tests/deck/highlight-acceptance.spec.ts` through the real CLI and captured preview/xAPI deployment owners. The suite checks local HTTP ESM and file classic delivery, keyboard operation, denied assets and browser print. Chromium and Firefox also pass with offline emulation; WebKit file checks deny HTTP(S) requests because offline emulation fails on plain local files. WebKit offline acceptance is not claimed. Screen-reader speech needs separate manual evidence.

The memory-only enhancer hides Answer after attach until Check reveals and opens
it; reset and destroy close and hide it. When attach hides a focused baseline
control, focus moves to the first chunk; otherwise attach preserves focus.
The highlight adapter owns atomic attach rollback and captures focus before
destroying instances.
It preserves unrelated connected focus and returns removed or hidden control focus
to Answer. A denied import leaves the baseline untouched. Bootstrap fills the
existing localized status once; highlight failures stay local even in required
preview or document-owner mode. The full memory-only enhancer must keep this
rollback boundary. Bootstrap guards notices with the enhanced marker; the adapter
checks it after teardown. The enhancer sets it on success and clears it on destroy.
The initial 10 KiB gzip target counts every required JS response separately. The
measured delivery caps live in `packages/export-pipeline/src/__tests__/bundle-viewer.test.ts`.
Accounting uses the actual default page/module plans, including shell, selected
host/support, loader, default page navigation and every planned island dependency
across ESM/classic modes. Shared runtimes push totals above the target. The owner
rule permits measured caps plus 1 KiB rounded up to 256 B; existing shell/host
caps remain. Shipping acceptance measures maximum page/deck closures of
39,978 / 132,262 B gzip against the recorded 40,704 / 132,864 B caps.
Highlight CSS is 3,649 B raw / 970 B gzip. Both adapters together measure
27,750 B raw against the recorded 28,928 B cap. The focus-restoration change
added 2,541 B to the earlier 25,209 B adapter total; the existing C5 rule set
the cap to that measurement plus 1 KiB, rounded up to 256 B. These are the
highlight-only default-navigation probes used by the budget tests. An acceptance
course's ordinary reporting choice and public-variable control add their own
runtime dependencies.
The shared loader is unchanged; distractors retain their 23,040 B closure cap and
retrieval its separate 10 KiB ceiling. Required CSS and authored markup are
separate from this JS cap.

CSS required for the first visible state stays synchronous in `<head>`. Deferring required CSS trades bytes for flash, layout shift, inaccessible controls, and print or high-contrast regressions.

The intended delivery shape is:

```text
small shared shell
  + planner-selected navigation styles
  + planner-selected block-family styles
  + print styles with media="print"
  + authored custom CSS last
```

The native module-deck shell is one hand-owned capability group in `packages/shared-blocks/src/viewer/deck-shell.css`. `planModuleRuntime()` marks module documents with `presentation: "module-deck"`; the compiler selects a synchronous deck stylesheet for those pages, while ordinary and utility pages use the shared full/lite stylesheet. Unreferenced deck-course variants are omitted from the artifact. Do not use automatic HTML selector purging; it cannot safely see dynamic states, nested content, forced-colors rules, or authored custom CSS.

- Load Mantine CSS only for a page that loads a Mantine consumer.
- Preload only a resource known to be critical for the initial viewport. A preload competes for bandwidth.
- Append shared viewer CSS, optional deck CSS, generated theme variables, section palettes, and authored custom CSS in that order before hashing. Packaged HTML references a content-derived `styles.*.css`, `styles-lite.*.css`, `styles-deck.*.css`, or `styles-lite-deck.*.css`; stable names are prebuild inputs only. The deck CSS stays in the first-paint stylesheet, including no-JavaScript and print states.
- `viewer-manifest.json` names the separate `deckCss` prebuilt asset. A manifest without it is stale and must be rebuilt; the viewer source hash includes `deck-shell.css`.
- Fingerprinted assets may use long-lived immutable caching. Stable URLs whose bytes can change must revalidate. LMS and review hosts control response headers, so the package cannot guarantee caching by itself.
- Preserve deterministic asset order and authored custom-CSS precedence.

Keyboard focus uses one themed outline per target: 2px for controls and 3px for choice/chooser rows and Guided panel headings. Choice and chooser rows own their indicator; their inner input outline is suppressed only when that row has the equivalent visible ring. Checklist controls have one outline without an extra halo. Published disclosure buttons, audio/video and meaningful assessment feedback targets receive the themed outline without changing focus delivery. Default and unframed accordion titles keep zero inline padding so they align with their panels on the reading edge; their disclosure trigger ring is inset and adds no padding.

Radio focus uses scoped `:focus` rules for choice, group chooser, rating and matrix. WebKit can clear `:focus-visible` during native arrow navigation, so that heuristic cannot be the only condition for their indicator. Meaningful feedback uses `:focus` for the same reason after keyboard submission. Selection remains separate from focus, including in forced colors. Tabs, Guided panel titles and full-width scroll targets inset their outlines at clipping boundaries; the native tabs island scrolls focused tabs fully into view without changing selection. Padded Guided controls use the shared outer ring so a matching border cannot hide it. Footer, menu and panel spacing reserves the outline width plus offset, including thicker platform-contrast rings. System high-contrast/forced-colors rules preserve scoped input suppression and structural clipping protection. Both full and lite CSS bundles preserve this policy. Authored control names, assessment rules and saved responses are unchanged.

Owner decision, 2026-10-19: published forced-color CSS also requires `@supports (forced-color-adjust: auto)`. Narration and signature use the same `forcedPalette()` predicate, requiring both the media query and property support. Engines that emulate the query without forcing a palette retain the normal theme. Their browser cases compare computed styles with emulation off and on and retain the 3:1 focus floor; supporting engines retain the forced-palette assertions. Combined `prefers-contrast: more` rules keep their independent behavior. Checkbox `:focus` suppression applies in both contrast modes,
so choose-many retains one visible row ring instead of an additional inner input ring.

## Motion and navigation updates

Decorative labeled-graphic rings and lazy-block loading backgrounds run three
1.5-second cycles, then stop. Rings animate opacity and transform; loading text
remains readable throughout and persists until the real block finishes loading.
Each newly available sequential graphic label gets its own bounded cue. These
decorations never determine loading completion or whether a label can be opened.

Sidebar grid columns change immediately while the menu retains its transform
transition. Scroll progress uses a full-width fill with `scaleX` and an origin at
the reading-direction start edge; its accessible value still reports the scroll
percentage. Progress-dot shapes and TOC padding change without layout animation.
Choice radio marks scale in place. Numeric rating text and background switch
together so selection cannot pass through an unreadable color interpolation.

Image lift shadows fade through a decorative child's pseudo-element, leaving
the figure's authored lighting and texture overlays available. Tilt returns in
250ms. OS and learner reduced-motion settings suppress these transitions and
pulses while preserving entrance, flip, tooltip and button behavior elsewhere.
Both full and lite export CSS bundles must retain these rules.

## Pages arrival orientation

In the Pages presentation each page is a full HTML document. After Next, Previous,
an outline link or a go-to-page button, `island-nav.tsx` focuses the content
heading and writes nothing to the shared live region. Direct arrival, browser
history return and arrival with both storage areas blocked leave focus where the
browser puts it on a new document; the focus request travels in session storage.
The descriptive document title, the focused heading, the page counter and the
outline's `aria-current="page"` link carry orientation. The counter shows `3 / 6`
and exposes the localized `pageOf` text ("Page 3 of 6") through the
`praxity-a11y-sr-only` class. It is static text with no status role or live
semantics, because it never changes after the document loads. The document title
stays numberless. Utility pages keep their title-only arrival message. Confirmed LMS
resume keeps its visible heading prefix. Guided keeps its single slide-change
announcement for moves that retain control focus. Each slide region is named by
its localized position, preserving its landmark. When Guided navigation focuses
a destination heading, it leaves the live region unchanged; entering the region
delivers the position and heading focus delivers the title. A heading-free slide keeps position plus
title when focus falls back to main content. Narration moves keep focus on their control
and announce position plus title, including auto-advance. Restore keeps its existing
resume cue without a slide live message.

Before October 2026 each ordinary arrival also wrote "Page 3 of 6: title" to the
polite live region while focus landed on the same title. That repeated the
heading, competed with the focus change, and was not reliably spoken: in the
2026-10-02 SCORM Cloud run with NVDA 2026.2 and Chrome 154, the page 3 message was
written 127 ms before heading speech and no position speech was requested, while
pages 2 and 4 spoke both. Neither [WCAG 2.4.2 Page Titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html)
nor [2.4.8 Location](https://www.w3.org/WAI/WCAG22/Understanding/location) requires
spoken counts. They require a descriptive title and location information the
learner can find. If later evidence shows
learners need a spoken count on arrival, choose one channel and remove the
competing one; do not add a second live message to this sequence. Browser tests
in `tests/a11y/nav-a11y.spec.ts` and `tests/deck/resume-orientation.spec.ts` check
focus, the absent write and the counter's exposed text. Live listening remains a
manual check.

## Images, video, and narration

Card slide transitions clear outgoing text over 120ms before revealing incoming text
over 180ms with a 120ms delay. Fade, slide and zoom keep their authored visual modes;
`none` and OS or course reduced motion switch instantly. Inactive slides remain inert
and hidden from assistive technology as soon as navigation changes the active item.
Boundary focus recovery continues to use the enabled opposite navigation button.

Card pagination has fixed 24px targets with an 8px painted dot, or a 16px by 8px pill
for the current slide. Shape and system-color borders preserve position in forced
colors. Previous and Next have 44px targets separated from the card by 12px. Preview
and published cards share these controls and face alignment. Face titles and body
blocks fill the same width and inherit authored alignment; child content keeps its
own explicit alignment.

Published Cartesian charts use compact, medium and wide static SVG layouts selected by the chart's container width. Narrow layouts print fewer category labels while preserving all marks, tick marks and the single accessible data table. Only the active SVG is displayed; print uses the wide layout. Keep physical label size readable when changing either geometry or container-relative font sizing.

Learner polish rules sit in `shared-blocks.css`, with the section and placeholder rules mirrored in `viewer-shell.css` and the export `global.css`:

- Textures lift a page's or section's direct children above the overlay, except the skip link. The page navigation skip link stays off-screen until it has focus; activating it jumps to the page navigation.
- `reading-rhythm.css` owns text wrapping in previews and published courses. Use `text-wrap: balance` only for short page, section, card and scene titles of one or two lines. Sentences use `text-wrap: pretty`: paragraphs, list items, captions, labels, feedback, and question stems or prompts, including stems styled as headings. This keeps long questions filling the line instead of splitting into half-width lines. Browsers without support wrap normally.
- Images get a 1px inset outline at 12% of the text colour, so a pale image keeps its edge on a pale page.
- Shaded table headers mix 7% of the text colour into the surface, so section palettes still remap them.
- Free-response placeholders use `--praxity-color-text-muted`, also bridged to Mantine's dimmed token. Contrast enforcement keeps that colour at 4.5:1; built-in palettes also retain the project's APCA Lc75 reading floor on content, navigation and note surfaces. The preset blend is 88%, giving a measured minimum Lc77.74 across the six light/dark palettes. The advisory quietness cap is 80% of body text contrast because the earlier 75% cap conflicted with Lc75 in dark presets. Custom colours retain their existing blend and 4.5:1 enforcement.
- Note fills come from the resolver's callout tokens (see the Theming section in `architecture.md`). Each note also names its tone in text, so colour is never the only cue. Legacy `color: error` notes still render as Warning.

## Images, video, and narration

Published Cartesian charts use compact, medium and wide static SVG layouts selected by the chart's container width. Narrow layouts print fewer category labels while preserving all marks, tick marks and the single accessible data table. Only the active SVG is displayed; print uses the wide layout. Keep physical label size readable when changing either geometry or container-relative font sizing. Each legend row is one `<text>` run anchored at the chart's centre, with a bullet swatch before each name. The browser or Typst lays out the real glyphs, so entries cannot collide and rows stay centred in any font. The bullet is in every bundled font's Latin set; a glyph missing from the body font, such as U+25A0, makes Typst set the whole run in a fallback font. A row wider than the chart still clips. Bars and swatches carry the `praxity-chart-mark` class: on screen their edge is a same-hue darker stroke rather than a text-coloured outline, and the PDF pipeline still drops rect strokes on fills that already reach 3:1 against paper.

Narration's saved duration can be a caption endpoint rather than the full recording length. The shared player verifies durations through its existing idle media-metadata probes before enabling the module scrubber or presenting a complete total. Loading/failure text replaces partial totals; script-only entries contribute no audio duration. Do not replace this with eager recording downloads.

- Emit intrinsic width and height, or an equivalent stable aspect ratio, for images, video, posters, iframes, and hydrated replacements.
- The likely LCP image must be discoverable in initial HTML, must not be lazy-loaded, and may be the single `fetchpriority="high"` image.
- `warmPaneImages()` warms the active deck slide's own images and its immediate neighbours'. Neighbours load eagerly at low fetch priority, without wrapping or crossing module boundaries. The entering first image regains high priority. Downloads never gate navigation; rapid navigation and outline jumps outside the prepared window can still outrun them.
- Within those slides, nested tabs follow only their selected path, recursively. No inactive tab panel is warmed, including in the active slide. Visible selected tab images retain native loading except for the deck's existing priority-image promotion. Hidden or `aria-hidden` ancestors and unready decks suppress warming; an inert main under a replacing deck panel does not.
- Standalone tabs and continuous scroll sequences retain native lazy loading. Slide-style cards keep their opacity transitions and existing browser fetch behavior. Tab selection can still show a late image. Narration keeps the player's existing metadata probes because `preload="metadata"` cannot guarantee that the browser avoids downloading the audio body.
- User-initiated direct video defaults to `preload="none"`. Use `metadata` only when duration is required before interaction; it is a browser hint and can still download a large range. Autoplay media may use `auto`.
- Preserve native controls, captions, tracks, posters, clip bounds, and the user gesture across any lazy activation.
- Keep the click-to-load YouTube facade unless evidence shows a regression.
- Narration currently scores well despite its React closure. Do not rewrite it for an unused-byte audit alone. First measure a representative narrated page and preserve keyboard activation, announcement, media coordination, segment timing, and reveal behavior.

## Performance and accessibility gates

Use two layers of evidence:

1. Deterministic build tests for runtime classification, emitted assets, transitive compressed sizes, server markup, and no-JavaScript behavior.
2. Browser tests and repeated Lighthouse runs for rendering, interaction, accessibility, and timing.

Starting constraints:

- Shared course shell: at most 4.75 KiB gzip and no React or Mantine closure. Clearing the SCORM session marker at launch brought it to 4,093 bytes in September 2026, so the budget rose from 4 KiB to keep headroom. On 2026-10-09, restoring BODY focus after a new-tab glossary return measured 4,570 bytes. The shared focus-return owner and DOM-ready outline activation binding exceed 4.25 KiB by 218 bytes; the smallest 0.25 KiB step leaves 38 bytes of headroom. On 2026-10-10, Ariel Harlap's Firefox return fix measured 14,046 raw / 4,695 gzip bytes. Coalescing return events and rechecking BODY after the browser settles exceeds 4.5 KiB by 87 bytes; the smallest 0.25 KiB increase leaves 169 bytes of headroom.
- Target host adapters: at most 6 KiB gzip for standalone, 6.75 KiB for SCORM 1.2, 7 KiB for SCORM 2004, 7.75 KiB for xAPI, and 8.75 KiB for Electron preview. The September 2026 required-check completion and latest-attempt scoring changes measured 6202 bytes for SCORM 2004 and 6252 bytes for xAPI. The course pass mark then measured 8545 bytes for Electron preview, 6503 for SCORM 1.2 and 6657 for SCORM 2004, about 350 bytes each; xAPI, which also started persisting course state across page loads, measured 7111 bytes. Declaring one course activity ID for tincan.xml and statements, with the launch `activity_id` carried across pages, brought xAPI to 7648 bytes. Neutral uncertainty reporting raised SCORM 1.2 from 6639 to 6668 bytes, SCORM 2004 from 6911 to 6940, and Electron preview from 8675 to 8708; each ceiling increased by 0.25 KiB to carry the neutral result and island-built choice definition through the reporting options. Standalone measured 5575 to 5611 bytes and xAPI 7683 to 7719, within their existing ceilings. Choice labels and identifier allocation remain in the assessment island. Hosts still exclude React and Mantine.
- Static page: no initial JavaScript beyond the shared course shell and target host adapters with their declared dependencies. The shared SCORM support asset is capped at 3.5 KiB gzip. On 2026-10-19, the outcome owner refactor measured 2,480 bytes; the owner set the cap to that measurement plus 1 KiB, rounded up to 256 bytes. Size caps do not block working features; tighten during final size work. Report its bytes and the combined host payload. Only confirmed LMS Pages resume requests the packaged classic cue script.
- Lightweight island page: keep initial gzip JavaScript at or below 10 KiB unless a measured feature requires more.
- Rating's selected asset closure is capped at 18 KiB raw. Measured 2026-10-18: the document owner adds 4,217 bytes to the previous 12,419, measuring 16,636 total, with 1,796 bytes of margin. Owner, 2026-10-17: allow the startup feature with margin and defer size optimisation.
- Cold SCORM 2004 hosts allow 8,448 bytes gzip. Rating early-input admission measures 8,127 bytes, leaving 321 bytes of margin. Owner rule, 2026-10-17: size caps never block working features; size optimisation comes at the end.
- On 2026-10-19, the outcome owner refactor measured 7,047 bytes for the standalone cold host, 10,247 for Electron preview, 7,937 for SCORM 1.2 and 9,211 for the larger private xAPI variant. Applying the owner rule, the exceeded ceilings rose to 8,192, 11,520, 9,216 and 10,240 bytes respectively. Each new ceiling adds about 1 KiB to the measurement, rounded up to 256 bytes. Other ceilings remain unchanged; final size work will tighten them.
- Heavy assessment and narration pages: separate budgets based on their current transitive closures. Do not hide them inside the lightweight allowance. Resolving the inherited uncertainty default in the shared content model measured narration at 243419 raw / 79781 gzip bytes, up from 241562 / 79124; assessment at 781501 / 242788, up from 779548 / 242082. Removing the group exhaustion exception measured its island at 32112 / 12929, down from 32127 / 12934.
- Assessment-group initial code, excluding its deferred download chunk: at most 22.25 KiB raw. On 2026-10-09 the named summary focus wrapper measured 20,571 bytes. N11 result descriptions, visible-action selection, focus delegation and retaining review across partial saves now measure 21,441 bytes, 705 above the former 20.25 KiB ceiling. The smallest 0.25 KiB steps that fit leave 63 bytes of headroom. Merged with main's self-check learner-state changes (#1465 to #1468) on 2026-10-10, it measured 21,542 bytes, 38 above 21 KiB, so the ceiling rose one 0.25 KiB step, leaving 218 bytes of headroom. Owner: Ariel Harlap, 2026-10-09 and 2026-10-10. On 2026-10-12, lifetime enforcement and dispatch authority raised this cap by 1 KiB under the owner's 2026-10-11 decision to optimise size at the end.
- The viewer manifest contains no full-viewer entry. A new fallback renderer or unplanned runtime path fails the architecture check.
- Shared viewer CSS: at most 33,024 bytes gzip. Sidebar contrast and Check scrolling initially measured 31,750 bytes, six bytes above the former 31 KiB ceiling. The cap added 1 KiB to that measurement and rounded up to 256 bytes. Sticky-bar clearance, option feedback, reserved reveal space and distinct deck control rings plus palette-support gates now measure 31,871 bytes, leaving 1,153 bytes of headroom. Size caps never block working features; tighten during final size work. Keep full/lite stylesheet ownership and contrast-media rules intact. Optional corner artwork remains capped at 1 KiB incremental gzip.
- Deck shell CSS: at most 4,096 bytes gzip. Space for distinct outer focus rings initially measured 2,843 bytes, above the former 2,816 cap. Transcript inset clearance brings the final measurement to 2,845 bytes. The owner-rule cap adds 1 KiB to the initial measurement and rounds up to 256 bytes; tighten during final size work.
- Navigation: less than 31,488 raw bytes. Sticky-bar clearance with the shared outcome owner measured 30,343 bytes, above the former 29 KiB cap. The owner-rule cap adds 1 KiB and rounds up to 256 bytes. Navigation plus loader measures 12,801 gzip bytes, within the unchanged 13 KiB cap. Tighten during final size work.

Run Lighthouse at least three times per representative page in a stable environment and use the median or pessimistic result. Gate byte counts deterministically; timing scores vary between runs. Targets are LCP at most 2.5 seconds, CLS at most 0.1, mobile TBT below 200 ms, and Lighthouse accessibility 100. Preserve stricter baselines, such as zero CLS or TBT, where they already exist.

Browser regression coverage must include Chromium, WebKit and Firefox, desktop and mobile widths, 400% zoom, keyboard-only operation, reduced motion, forced colors, right-to-left layout, and JavaScript failure. WCAG 1.4.12 coverage must apply line height 1.5, paragraph spacing 2em, letter spacing 0.12em, and word spacing 0.16em without clipping, overlap, horizontal scrolling of text, or lost controls.

For SCORM, also verify file and LMS paths, resume state, completion and required-block gates, score, logic jumps, focus restoration, and runtime-ready handoff. Use the change-specific suites in `testing-strategy.md` and the normative ADL gate.

## Current evidence and remaining work

Fresh Lighthouse 13.4.1 runs on September 4, 2026 against compressed canonical routes served through local Wrangler establish the current baseline:

| Viewport | Evidence |
|---|---|
| Mobile, six representative pages | 99–100 performance, 100 accessibility, median LCP 1.37–1.82 s, TBT 0–103 ms, CLS 0–0.001 |
| Desktop, the same pages | 100 performance and accessibility, LCP 0.33–0.46 s, TBT 0 ms, CLS 0–0.010 |

All successful runs also scored 100 for best practices and SEO. These results meet the current performance budgets. No deployed course was rebuilt or changed. They do not replace the dedicated WCAG 1.4.12, browser, and assistive-technology checks.

The September 2 sample remains useful history: static/container scored 100 performance; rich content with doodles scored 93 mobile; media scored 97 mobile with about 1.1 MiB of direct MP4 fetched for metadata; narration scored 99 mobile; and the pre-migration Summary/slides route scored 95 mobile and 63 desktop. The full-viewer script and DOM replacement are now removed, so the fresh canonical-route results replace that last baseline.

Direct-video preload now follows the measured rule: user-initiated direct video uses `preload="none"`; autoplay may use `auto`; use `metadata` only when duration is genuinely required before interaction. Focused renderer checks cover the emitted attribute; browser network behavior still depends on the user agent.

Do not add the earlier Doodle, CSS, cross-cutting-runtime, or narration-splitting work while the current budgets hold. Reopen it only after a measured regression or a new budget.

## Inline preparation

Inline and display equations use the shared MathML-only renderer. Each valid authored
expression has one visible MathML tree. Existing speech wrappers retain their math role
and readable label; expressions unsupported by the speech helper, including matrices,
retain the native MathML fallback.
The generated KaTeX HTML tree is omitted because its required stylesheet does not ship.
Invalid input remains escaped source, including the exceptional render-error fallback,
so this path adds no English-only error copy. Static output, activated pages and inert
small previews use the same markup. Three-engine browser checks cover fractions,
matrices and narrow Larger text rendering; real assistive-technology math listening
remains a separate acceptance check.

Code flex rows are joined without preformatted separator whitespace. Authored empty
rows, indentation, line numbering and highlights remain intact. The code island owns
Copy reconstruction by joining source row text with newlines. Clipboard failures keep
the readable, selectable code fallback and do not announce a successful copy.
The highlighter removes Prism's synthetic newline placeholder from empty rows;
each rendered flex row reserves one line of height, including without line numbers.

`content-model/src/inline-preparation.ts` owns the display-field list. Run
`prepareInlineBlocks()` before glossary collection, icon resolution, footnote numbering
and runtime planning. Read prepared fields with `getInlineField()` in server rendering
and `InlineContent` in shared components. Raw fields remain the source of grading values,
IDs and URLs; `_inline` is render-only metadata, never persisted author content.

When adding a display field, add it to preparation and test its initial HTML and activated
island together. Preserve `_inline` through normalizers. Control labels use
`interactive: false` at formatting and sanitization, including legacy HTML. Sanitize
at every HTML sink. Code and LaTeX stay literal; page footnotes use stable authored order.
Supported source syntax and field contexts live in
`docs/prax-format/reference/inline-formatting.md`.

## Primary references

- [Astro islands architecture](https://docs.astro.build/en/concepts/islands/) and [client directives](https://docs.astro.build/en/reference/directives-reference/)
- [React `hydrateRoot`](https://react.dev/reference/react-dom/client/hydrateRoot) and [`createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [web.dev: avoid layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
- [web.dev: render-blocking CSS](https://web.dev/articles/critical-rendering-path/render-blocking-css) and [optimize LCP](https://web.dev/articles/optimize-lcp)
- [web.dev: optimize CLS](https://web.dev/articles/optimize-cls)
- [WHATWG media preload](https://html.spec.whatwg.org/multipage/media.html) and [web.dev: lazy-loading video](https://web.dev/articles/lazy-loading-video)
- [MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
- [Lighthouse CI configuration](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md) and [Lighthouse variability](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md)
- [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) and [Total Blocking Time](https://web.dev/articles/tbt)

## Experimental module deck

The course host confirms SCORM `entry=resume` or a standalone HTML return and resolves the bookmark before
dispatching `praxity:runtime-ready`. The runtime, tracker and optional
`__praxityResume` destination are available together. Pages inserts a localized,
visible position prefix inside its content heading before focusing it. At this
boundary the shared shell requests the packaged `course-resume` classic script
only for confirmed Pages resume. The script shares Guided's cue implementation;
classic loading preserves static Pages resume from `file://` without an island
loader or module fetch. Its navigation island suppresses ordinary arrival orientation only for
that confirmed return. Static Pages uses the same shell orientation without
requiring the navigation island. A late script load after `pagehide` cannot insert
a cue or move focus. Load failures use the shell's existing readable fallback.
The ready event carries the validated page config.
The compiler expands the shared Pages prefix and full-summary templates into the host's string
binding, using that page's position and decoded title. Guided formats its cue
after resolving the allowed slide. No formatting logic is copied into the shell.
Guided resolves the host destination through its existing sequential and assessment
access checks, then inserts the same visible prefix and focuses the active slide heading.
Its localized resume cue uses the current module's slide counter
and the allowed destination's title. A denied destination in another module carries
the confirmed return through the existing access redirect, so orientation describes
the allowed slide rather than the inaccessible bookmark. Narration starts paused.

On a confirmed Guided return, an explicitly saved panel that replaces the lesson
stays open and receives a visible full resume summary as its sole focus target after restoration.
Other returns use the active slide heading when it identifies the resolved title.
Initialization sets one focus destination from the visible state
and preserves the stored learner panel choice. Ordinary arrival retains the
existing authored and stored panel policy. Explicit links carry `praxity-resume=0`
through alias redirects so they stay explicit even when matching a saved bookmark.
The host removes this marker before runtime-ready. Explicit fragments, ab-initio
launches, ordinary navigation within an
active SCO session, absent LMS APIs and SCORM local-storage fallback do not receive a
resume cue. Standalone HTML uses the same bookmark destination, gate checks,
localized cue and focus policy on fresh entry through `index.html`, from a server
or `file://`. Reload and browser Back/Forward retain the browser's destination,
without consulting the bookmark or adding a resume cue, in HTML and SCORM. Its existing local-storage adapter keeps
validated learner state per course and attempt. Corrupt, unsupported or removed
bookmarks leave the entry at page 1 without a cue. Explicit first-page routes
(`index.html?praxity-page=<page ID>`) start at that page while preserving visits,
just as SCORM explicit links do. Ordinary navigation carries the explicit-arrival
marker, which is removed before runtime-ready. The shared host admits bookmark
restoration only on fresh navigation, with a legacy timing fallback for Firefox
before its navigation entry is available.
Standalone resume keeps learner data in local storage and adds no tracking endpoint
or learner-state schema.

Standalone HTML retains the authored course pass mark, including CLI exports. Pages
and module completion display its score and outcome only after every required scored
question or group has a final answer. Saved answer completion includes authored retry
limits, so a retryable failure leaves the outcome pending. `CourseTracker` computes
the result with the existing latest-attempt scoring rules. The standalone host reads
the existing saved answers after reload and stores no derived score or outcome.
Courses without a pass mark keep their existing completion behavior. The completion
labels and pass/fail labels remain separate, using the existing English and French strings.

Pages keeps its native document navigation when file origins refuse module imports.
Guided packages a classic variant of the same deck entry and selects it only on
`file://`, so slide restoration and resume focus can initialize offline. The variant
uses the module's fingerprint, appears in its manifest dependency closure and
retains its third-party notices. Server launches load the existing split module graph.
If a browser denies access to the local-storage accessor with `SecurityError`, the
local runtime uses its existing nonpersistent fallback and still publishes
runtime-ready. Ordinary page navigation still works when local storage, or both
local and session storage, are blocked. Fallback learner state stays in
memory for the current document and is lost on navigation or reload.
Legacy slug bookmarks and stable-ID bookmark URLs remain accepted. No learner-state
schema or authored syntax changes. Resume does not write to a separate live region.
Ordinary navigation and gate status messages retain their existing channels.
Browser checks verify the focused text and absence of paired resume writes;
manual listening still judges speech in the real LMS player.

Resume focus skips hidden headings and closed disclosures, including headings hidden
by authored CSS. A heading with an authored `aria-label`/`aria-labelledby`, a title
mismatch, or no suitable heading uses a plain visible summary with `tabindex="-1"`
at the start of the visible content or replacing panel. It shows only the position;
the locale's separator and canonical title use the existing visually hidden class
so its focused text still contains the full message. The original heading and its markup remain intact.
The cue persists through blur and reading preferences until the learner leaves that
page or slide. Both modes remove their owned cues on `pagehide`, preventing a stale
cue on browser history return. Guided also removes it before orienting a later slide. Ordinary arrivals
never insert it. Print hides only the inserted cue. Outline labels and document
titles continue to use canonical compiler data, without the temporary prefix.

`CourseExportInput.moduleDeck` and `DesktopExportInput.config.moduleDeck` opt into the first module-per-document runtime slice. Studio persists `course.yaml moduleDeck: true`, authored `deckStop: true` and assessment `deckGate: attempt|pass`; the shared input builders resolve their stable IDs after the identity overlay. `runtime-plan.ts` unions module capabilities; `html-gen.ts` reuses the semantic content renderer and emits stable slide aliases. `island-deck.ts` owns active slides, access and panel state; the shared `NarrationBar` owns media, cues and bounded transcript following. Small previews project one inert slide. Author inspection bypasses learner locks without writing progress. Logical slide identity is reported separately from the immutable preview handshake identity. The host defers visits to slide activation; deck initialization begins with the tracker available before runtime-ready is dispatched. Host deployment counts module documents separately from the logical slide count.

No existing layout opts in implicitly. Unsupported branching/conditional combinations fail compilation. See [the compiler contract](../prax-format/reference/module-deck.md). Run the dedicated compiled browser journey with `pnpm --filter @praxity/export-pipeline exec playwright test --config=tests/deck/playwright.config.ts`.

Guided slides render authored slide styles independently of the navigation archetype. Each module preserves its authored first-slide title separately from the module title. The slide main area is keyboard-focusable; the outline heading and links share one navigation landmark and wrap under increased text spacing.

Guided chrome uses 44px icon buttons and one active-state treatment for the panel,
Follow narration, automatic advancement and reading-support toggles. The shared
dot under the icon uses the theme text colour for contrast and marks the on state
without relying on colour. Forced colours retain a system-colour outline and marker.
The outline reserves an activity icon column,
so slide titles align whether or not they contain an assessment. Other module
links retain their separate indentation.

At narrow widths, the footer keeps course tools and slide navigation together,
with playback on the next row. Guided supplies sentence/follow controls through
its shell, leaving only speed in the shared player's options group. Speed stays
inline at all widths, so the course-tools disclosure is the only options button.
Its P27 Tools button uses 44px geometry and a secondary outline. Its expanded
state drives the active background and forced-colour outline through
`aria-expanded`, without a dot. Unknown duration stays out of its settings rows.
Pages retains Listen and its inline narration-options disclosure. Reading guide
uses text lines with a highlighted band; Follow narration and Resume following
use the same downward-follow arrow. Localized names and pressed/expanded states
remain the text alternatives. Guided uses the footer Play control for narration,
starting the first recorded target at or after the current position within the
slide. NarrationBar owns that lookup; the deck supplies each item's page ID.
Natural advancement and reading-protection stops remain separate. Slides without
recordings hide the timeline and retain the unavailable playback explanation.
Completion hides playback, keeps Review module in the body and uses the footer
Next for continuing.

A paused seek keeps the chosen timeline position while native media time settles.
Playback resumes tracking the player's clock.

Guided learner navigation through Next, Previous, keyboard arrows and outline jumps focuses the destination's first visible heading, or main content when no heading is available. Programmatically focused H1 through H6 headings have no outline or shadow, except the SCORM resume cue, which keeps its ring; interactive controls and keyboard-scrollable main content retain their keyboard focus indicators. A replacing panel closes so that the destination is visible. Module navigation carries the shared Pages arrival marker across documents and focuses the destination heading after runtime initialization. Narration seek, play, automatic advancement and history restore retain control focus. Fresh visits and confirmed resume retain their arrival policies. Native disabled Previous/Next boundaries still recover endangered focus during other control updates; natural narration advancement keeps its existing position announcements. Single-card navigation retains its existing boundary recovery.

Module-deck navigation is shell-owned: optional matching outline-left and transcript-right sidebars are siblings of the native main content area. Every preset starts with both closed. Studio selects Compact for Guided slides; the persisted Transcript preset remains accepted with the same defaults. At 950px wide and 36rem tall, the panel sits beside the slide and its 22rem width is capped at 374px so Larger text leaves at least 576px for the slide area. Below either cutoff it replaces the slide area. No deck-specific content width or slide-height override replaces authored block/section sizing. Deck block widths use the slide area as their limit, so full and breakout blocks cannot extend under an open panel. The text column and authored slide heights keep their existing sizing.

Fresh arrival in the replacing layout starts with the lesson visible and both panels closed, including when the author selects an initial transcript or outline. Resolve this through the existing drawer media query, `(max-width: 949.99px), (max-height: 35.99rem)`. A valid explicit learner panel choice in local storage takes precedence over this default and the authored initial panel. A stored open choice receives focus at the panel heading when it replaces the lesson; a stored closed choice keeps the lesson visible. Wide arrival retains the authored or stored panel without taking focus. Initial resolution does not save a learner preference, so a subsequent wide visit still uses the authored panel until the learner makes a choice. Close and the panel toggles return to visible lesson content and their trigger. Resizing an open side panel into the replacing layout recovers focus from the hidden/inert lesson to that panel's heading. Footer controls stay usable outside these nonmodal panels, and transcript text remains scoped to the active slide.

While the deck runtime resolves bookmarks and access, the synchronous shell enables a pending presentation that keeps the module header visible without painting the full reading fallback. The shell does not select slides or resolve learner state. Script errors, failed deck imports, and host initialization failures restore the readable fallback. Missing JavaScript, printing, and inert small previews retain their normal content presentation. Cover delayed and failed scripts in Chromium, WebKit and Firefox when changing this boundary.


Authored `disableCompletion` gates block forward progress, including Next, shortcuts, swipes, outline/module jumps and end-of-lesson actions. Continue stays visible and focusable with `aria-disabled="true"`; links lose their live destinations while blocked. One visible reason within the primary page-navigation band describes every blocked forward control. Minimal mode uses its visible embed-navigation band for the reason. Keyboard-only navigation shows its proxy controls and explanation while blocked, then returns to the authored hidden navigation on release. Reasons use plain text, are deduplicated in authored order, and fall back to the learner locale for older documents. Gate transitions keep focus in place and restore exact href, role, tabindex and description attributes on release. Restored input hydration refreshes gate predicates without replaying authored variable mutations or jumps. DomLogicRuntime owns this presentation; LogicEngine owns the gate state, and the shared navigation action guards forward progression before jumps or completion. The early shell fallback uses the same evaluated gate without importing required-block presentation; the logic island imports only its small fallback catalog. The main accessibility setup builds these fixtures under `/continue-gate/`. Verify with `pnpm --filter @praxity/export-pipeline exec playwright test --config=tests/a11y/playwright.config.ts continue-gate.spec.ts`, which runs the published journeys in Chromium, WebKit and Firefox and is included in `test:a11y` and CI.

## Published disclosures

P27 uses heading-wrapped buttons and following panels for accordions and media transcripts. Server HTML contains visible content and a plain heading label, with its prepared button hidden. An enhancer installs its handler, moves the plain label into the working button, exposes that button and synchronizes `aria-expanded`. It then collapses the panel unless the learner has already focused content inside it. Reader mode or a failed script therefore retains readable content. Buttons reference stable panel IDs through `aria-controls`; accordion trigger IDs keep their existing `-summary-` form for older links.

The accordion island retains authored heading levels, region policy, single-open settings, arrow navigation and narration reveal. State graphics are centered decorative SVGs. Panel collapse uses display styling rather than `[hidden]`, because the required-activity gate uses that attribute for authored concealment. Required activities inside collapsed panels remain eligible. Print CSS expands accordion and transcript panels without changing the learner's screen state.

Narration Follow sends reveal events to the owning custom disclosure island and opens native `<details>` ancestors retained in older content. Both paths leave focus on the learner's control and respect Follow being off. Concealed or ineligible dialogue remains closed when Follow resumes and receives no reveal event.

The media planner selects its island for audio and video transcripts as well as supported video clip bounds. Media enhances the semantic DOM without `data-block-json`; assessment remains the React block island that requires that payload. Prepared inline icons and decorative disclosure SVGs have separate output contracts. Disclosure focus rings use the theme focus token with the system `Highlight` fallback in platform contrast modes.

Guided deck More is also a disclosure in published output. It uses a native button with synchronized state, preserves the compact breakpoint, focus recovery and dismissal by Escape, an outside pointer or focus leaving, and retains review-comment control placement. Its enclosing transport remains enhancement-only; the course's complete no-script reading baseline stays visible.

Decision and sources: the owner-approved P27 policy in `chore/agent-instructions`, commit `f730a1bc`; [APG accordion](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) and [APG disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/). Browser checks establish DOM, keyboard, state, fallback and print behavior. They do not establish spoken output with current assistive technology.
