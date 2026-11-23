# Local Read preview and review comments

Studio runs through the standalone CLI and local Read preview. `pnpm build:cli` packages the retained inspection and review assets with their provenance. The retired canvas renderer and its bundle are removed; preview startup needs no editor asset directory.

`praxity studio <folder> [--review] [--port <n>] [--no-open]` starts a foreground server. The printed ready URL opens `/`, which enters Read mode on the separate learner origin. Source changes use `praxity edit`, including `--rendered`. Browser Edit mode, its author document, generic RPC transport and identity confirmation endpoint are removed. Ctrl+C closes listeners, subscriptions and watchers and waits for admitted file operations. Export, inspect, identity and narration use the standalone CLI.

## Local review launch

`--review` requires a regular `course.yaml` before opening the course's private
review store and minting a separate 32-byte process capability. Store refusals
stop startup with their storage code. The CLI
passes the shipped asset directory inside the existing review option. Both
`review-comments.js` and `review-comments.css` must be regular, nonempty files before
the learner listener binds. API-only callers can omit that directory.

Only captured Read-mode canvas HTML receives an inert
`<script type="application/json" id="praxity-review-config">`, followed by a
stylesheet and deferred external script. Its JSON is
`{ schema: 1, reviewId, capability, endpoint: "/api/reviews/<reviewId>", limits,
textRules, blockNames, locale, page: { lessonId, pageId, pageIds, pageIndex, revision } }`.
`limits` and body `textRules` come from the review contract; `blockNames` reuses
the editor's localized block catalogue. Locale is `en` or `fr`. An optional
`draftOriginChanged: true` marks a preferred learner port fallback. Page identities,
lesson-local zero-based index and sibling IDs come from `canvasPageScope` for the
captured document. Revision is the SHA-256 of the JSON-encoded source-revision
entries sorted by source path. This whole-course source hash deliberately departs
from the approach's lesson-scoped revision. It changes on any course source edit,
including an edit in another lesson, and excludes the build revision. Consumers
treat a mismatch only as "may be stale". C7 disables positional CSS and child-pin
paths on a mismatch; identity and quote resolution remain available. A child path
also needs its stored target label to match (including both-null labels), otherwise the pin stays on its node
with "Pin moved to block". Missing scope gives null page
fields; missing source revisions give a null revision. Script delimiters and
Unicode line separators are escaped. There is no context route.

The fixed learner-origin routes `/_praxity/review/review-comments.js` and
`/_praxity/review/review-comments.css` accept only GET/HEAD with the existing
Host, Origin and Authorization guards, no-store, nosniff and asset CSP. Other
names and encoded aliases refuse. An asset lost after startup returns 503.
The optional `pages` array maps captured page IDs to same-origin Read URLs and
current plain-text titles for review navigation and group headings. Missing pages
fall back to the title stored with the thread.
The client reads only the typed inert JSON script, then removes the element and
keeps the configuration in its closure. It lists the whole review, grouped by page
with the current page first. Open, Resolved and All filters stack vertically,
show their refreshed counts and announce the selected count. Show on page opens the owning lesson page or deck slide
and focuses the target; missing targets retain their messages and resolution state.
Deck arrival waits for the owning slide's activation signal, then focuses after
Deck's own orientation. A newer jump, a conflicting ready Deck activation or
outside pointer/key/focus input cancels the pending arrival and removes
`review-thread`; successful arrival removes it too. Pagehide cancels the arrival.
Deck's access notice owns refusal feedback. Its synchronous orientation focus
does not cancel an accepted arrival.
The header has the single Expand/Collapse comments control; the footer shows local review status.
The review header keeps its comments controls in keyboard order. Plain Read serves the captured HTML without an Edit link or reserved row.
Off-page threads show “On another page” until their page is active; they never resolve or mark the current page.
Replies show compact localized times and generic labels derived from actor ID and
role, never stored display names. The local CLI uses the same actor ID with role
`author`, shown as Agent in both languages; the viewing reviewer sees You, other reviewers Local user.
Reviewers can reply and reopen; resolving stays an author action through the CLI.
The list refreshes every five seconds while visible and when the window gains
focus, so CLI changes appear without reloading. Failed polls back off to 60 seconds,
show a visible stale notice and announce once until a successful refresh. Success
or focus resets the delay; bfcache restoration restarts polling. Recovery restores
the empty/count status even if nothing changed. Polls skip only the current
generation's in-flight list; a superseded request cannot block later polls, and
create acknowledgement cannot end the timer chain. Unchanged responses leave the list DOM alone. Thread IDs and versions retain
controls, focus, scroll and unsent text; older responses cannot replace newer data.
Reply text and frozen request retries stay in memory for this page session and
are lost when the document closes or reloads. New-comment drafts keep the rules below.
Cross-document Show on page uses a native modal dialog before discarding any reply
text or pending retry; Cancel or Escape returns focus to Show on page. A frozen
reply is read-only, and a frozen Reopen keeps Retry available even after a refresh
shows the committed result. Retry replays the original receipt before another action can start.
The Read-mode CSP omits `allow-modals`, so `beforeunload` cannot show a leave prompt.
Ordinary course links, Back, reload and closing can discard session-only
replies and retries without a prompt. Course links are not intercepted by the dialog.
Comment on… opens a native target picker, including selected
text, the whole page, top-level blocks and their nested order items, tab titles
and accordion summaries. Labels contain authored text only. Known renderer
projections (Button wrapper/control and tab title/active panel) resolve to one
identity owner; unrelated duplicate identities remain ambiguous. Pin captures the next course pointer
target while suppressing learner activation. A selection also exposes an adjacent
Comment button. All targets use one native modal composer; acknowledgement opens
the sidebar and focuses the saved thread. Unknown outcomes retain the original
anchor, exact body and request ID for Retry, including after reload.
Definitive refusals leave the exact text editable. A reused create ID receives a new draft ID; other definitive refusals keep the same ID.
The composer checks the shared body rules before sending: CRLF pairs are allowed;
lone CR, prohibited C0/C1 characters, bidi overrides and bidi isolates are refused.

When Web Locks are available, unsent text lives in browser localStorage under
`praxity-review-draft:<reviewId>:<pageId>:<draftId>`, with
`{ body, anchor, savedAt }`. Each draft ID is a random UUID. Restoration matches
the complete admitted anchor, including revision and tab; a different stored
anchor remains reachable through Open draft. Drafts contain no capability and
restore with a new process capability on the same browser origin. With `--review --port N`, the learner listener prefers
`N + 1000` to preserve that origin across restarts. An out-of-range preference or
any preferred-port bind refusal falls back to port 0; failure to bind port 0
still refuses startup. The review option reports fallback to the CLI, which
prints an EN/FR stderr notice. The collapsed toggle and composer show that
earlier drafts may be unavailable and new drafts may not survive a restart. Without
`--port`, learner ports remain random and drafts do not survive an ordinary
restart. Published comments stay in the course's store regardless of port. Cancel and
Escape keep drafts; Discard draft removes only the complete last-seen value.
Every shared-storage mutation holds one Web Lock per review and page across its complete
read-check-write operation. Each edit compares the last-seen value before
writing. A conflicting edit forks into a new draft and announces every fork.
Without Web Locks the tab-only store writes synchronously. Lock denial and storage
failures retain the existing memory fallback and warning.
Chromium synchronizes localStorage between renderers asynchronously through a channel separate from lock grants; use IndexedDB transactions if later workflows need strict cross-renderer atomicity.
An unchanged stale session writes nothing and explains that another tab changed
the draft. An unchanged removed draft disables Save and offers Keep as new
draft. Storage events refresh only the keyed list
and preserve its focus; they never change an open composer.
Save first writes an immutable record under
`praxity-review-outbox:<reviewId>:<pageId>:<draftId>`, containing
`{ body, anchor, requestId, draftId, savedAt }`. The request ID equals the draft
ID. An equal established outbox is adopted; a differing one causes a new draft ID
before Save. The draft-to-outbox move holds the same lock. Retry resends the exact
frozen body, full anchor and ID. C1 arbitrates identity through its durable
per-actor receipts: an equal create replays the original comment and announces
"Already posted" or "Déjà publié". A changed payload returns `request_id_reused`;
the browser keeps its text as an editable draft with a new ID and requires a
manual Save. Other definitive refusals make the same draft ID editable again,
since refusals create no receipt. Acknowledgement removes only its outbox key.
A failed outbox removal leaves the frozen retry intact.
Deduplication is per actor: two capability links can share browser drafts but have
different receipt owners.
A matching outbox hides its equal draft predecessor after an interrupted
move; Retry completes that guarded removal before sending. A send is blocked
until its equal editable predecessor is removed. Quota failures block puts but
never skip removals; memory-only outbox records keep the same request ID until
the page closes. A quota edit retains its durable predecessor's key and exact
raw value in memory; Send or Discard retires it only if that value is unchanged.
A refusal creates no draft if another tab already retired its
outbox key. Without Web Locks, only this tab's sessionStorage is used and the
composer explains that drafts are confined to this tab. Neither mode stores a
capability. Lock acquisition failure switches the page to memory-only records
without further shared-storage mutations. In memory-only mode with readable storage,
records loaded before lock denial are not removed after sending.
With `--review --port N`, unsent comment drafts stay in this browser across reloads
and restarts. An edit made a moment before reloading can be lost, especially while
another tab is editing comments on the same page: the lock is per review and page.
Text already saved is kept. The review page's CSP sandbox suppresses the leave
prompt. A follow-up PR restores a crash journal. The existing
beforeunload handler attempts a warning for queued writes, volatile text and
unconfirmed outbox records when the host permits dialogs; it cannot prompt in Read mode.
Settled durable drafts do not request a warning.
Storage refusal keeps the composer usable in memory for the rest of that page
session. The warning is announced on first composer open if loading was blocked,
or when persistence first fails while open, and describes the textarea. Buttons,
canvas graphics, order items and disclosure/tab titles admit
identity capture while their text stays outside quotes. Nested identity targets
carry only their authored labels in context. A node-identified capture always
has `cssPath: null`; order-item positions never enter stored anchors. Tab/panel
projection chooses the stored panel even while hidden, returning Not visible here.
Text-line
pin tips end at cap height; graphic pins keep their captured point. The
frozen `window.PraxityReview` interface exposes only read-only DOM capture and
resolution functions for page tests; the transport stays private to the client.
It starts no legacy share request. Every course-file response admits only
same-origin scripts through `script-src 'self'`; inspection keeps its nonce-only
policy. This deliberately tightens ordinary Read headers as well as review and
artifact headers. The `frame-src` provider list is unchanged. Review tools share
the learner document's JavaScript realm with the Praxity runtime, so any script
in that realm can read the comment capability and feedback. Compiled HTML/SCORM
uses plain cross-origin YouTube embeds and never loaded the YouTube iframe API.
The course CSP refuses third-party scripts should a future change add one.
YouTube video keeps its authored iframe title, provider keyboard controls and
caption controls. The retained React player hooks have no production caller;
their unit test is not evidence of review-page video operation.

The tracked-storage check inspects Git repositories in the course's ancestor
chain. It cannot discover a Git directory elsewhere whose configured worktree
covers the course, such as an external `--git-dir`/`--work-tree` repository.
The private ignore still excludes comments from an ordinary add; feedback can
enter that repository only through a forced add.

Plain Read preserves captured HTML bytes. Review-enabled Read adds only its review
bootstrap and shipped assets. Restart keeps the review ID and remints its
capability. Ordinary HTML and SCORM exports contain no local review capability
or comment data.

Opening a course that would retire existing identities keeps resolution transient.
Read remains available and preserves stored identity. Pure additions that preserve
all identities may still persist during startup. Startup also retains interrupted
write recovery. Use the identity CLI to inspect or explicitly rederive identity;
there is no browser confirmation route.

## Read admission and retention

`GET /` and `/launch` redirect to Read admission. One-use admissions are bounded
and expire after 30 seconds. The launch listener retains the process probe at
`GET /api/identity` and calls `canvasPreviewBuild` internally. It never dispatches
browser RPCs. Old author `/canvas/...` URLs and `/launch?canvas=1` refuse.
Read launches use an explicit empty fragment before leaving the launch origin.
Concurrent document navigations share an in-flight build; invalid document
admissions retry through the root without author credentials.

Captured Read artifacts retain page/deck playback, inspection and revision fallback.
The project keeps the newest build and three older revisions. Released Read URLs
redirect to the matching page in the current head, then the lesson's first page,
then the course's first page, preserving query and deck fragments. Ordinary Read
does not automatically reload after source changes; a fresh launch builds current
source. Shutdown drains admitted builds and releases their files.

## Retired hosts

The legacy React browser shell and Electron application have been removed. No shell HTML, browser bridge, preload, desktop IPC, auto-updater or desktop build ships. Share for review retired with desktop IPC. Use CLI commands for structural authoring, export, `inspect --schema 1`, narration and identity operations. Tag `v0.3.0` preserves the previous desktop release; it predates durable editor drafts. `praxity recovery list <course>` lists retained drafts, and `praxity recovery export-drafts <course> <new-directory>` exports each as exact plain text without deleting it or changing source. Studio prints a count and that command when drafts exist; `--lang fr` selects French notices. Existing author records are untouched.

## Retained export services

`StudioExportService` owns the session's accessibility policy and one cancellable
HTML ZIP or native Typst PDF job. It calls `exportProject()` with read-only
manifest handling and no workspace inheritance, saves atomically beneath the
authorized project's `exports/`, and registers a distinct read-only download
capability for that file. Downloads validate the captured path and size and send
an attachment response with exact MIME, nosniff and no-referrer. They expose no RPC.
The CLI exports saved source. The session service remains available internally;
browser RPC and event-stream routes are removed.
Cancellation leaves no new output. Internal session commands cannot persist or bypass the policy.
Narration status reports environment credential availability and region only;
no key is returned and synthesis remains deferred.

## Isolated preview and media

The second loopback listener serves only capability-authorized `assets/` files
and captured compiled artifact manifests. Media and preview capabilities differ
from each other. It accepts GET/HEAD, rejects bearer
headers and RPC, validates Host/Origin, and sends nosniff, no-store, no-referrer,
exact MIME and single byte ranges. Raw authored assets receive a sandbox CSP
without script permission. Only media reads grant CORS to the exact launch origin.

An optional `review: { store, capability }` server option enables comments-only
HTTP routes on this learner listener. It is absent by default; `--review` enables it and the Read-page bootstrap. The caller mints a fresh
`randomBytes(32).toString("base64url")` capability for each start and holds it in
memory for bootstrap. Startup refuses noncanonical base64url or fewer than 32
decoded bytes. The server result exposes no review credential. Restart uses a new
caller-supplied capability. Requests use `X-Praxity-Review`, never Authorization,
cookies or query credentials. The store admits its local reviewer with `local-preview` provenance;
every list uses the store's visibility policy. No author API gains a route or
accepts this capability. Captured artifact bytes are unchanged. Course-file
responses, with or without review enabled, use `script-src 'self'`; inspection
keeps its nonce-only policy. No third-party script source is admitted.

| Review route | Method | Success |
| --- | --- | --- |
| `/api/reviews/<reviewId>/comments` | GET | 200 `{ok: true, reviewId, changeSeq, threads, nextCursor}`; optional `page`, `status`, `cursor`, `limit` |
| `/api/reviews/<reviewId>/comments` | POST | 200 `{ok: true, thread, receipt, replayed}` |
| `/api/reviews/<reviewId>/comments/<threadId>/reply` | POST | 200 mutation result |
| `/api/reviews/<reviewId>/comments/<threadId>/reopen` | POST | 200 mutation result |

Admission checks duplicate security headers first, returning 400, then exact bound
Host, returning 403 for a mismatch. Authorization is refused with 403; missing or
wrong review capability returns 401. POST requires the exact learner Origin; GET
permits absent Origin or the exact learner Origin. Foreign or null Origin and
supplied Fetch Metadata other than `same-origin` return 403. POST accepts only
`application/json` with an optional `charset=utf-8` parameter. Unsupported content
type or encoding returns 415. Bodies are capped at 65,536 bytes while streaming;
overflow returns 413 and malformed UTF-8/JSON returns 400. Review responses retain
the learner listener's CSP, no-store, no-referrer and nosniff headers without CORS.

Routes require literal canonical UUID paths. Another review, encoded separators,
dot segments, trailing slashes and unknown paths return 404. Other methods on
known routes return 405. Resolve, context and draft paths are absent. POST bodies
use C1's complete strict payloads, including review/thread IDs matching the path.
Unknown fields and invalid input return 422; mismatched thread IDs return 422 and
mismatched review IDs return 404. Identical retries return the original receipt
without adding a message. Version conflicts, changed-payload request ID reuse and
changed list snapshots return 409; invalid cursors return 400. Refusals are
`{ok: false, code, detail}`. Typed store failures return 500 with their code and
no filesystem path or message body.
Store `busy` returns 503 with `Retry-After: 1`; a cursor belonging to another
principal returns 400 `invalid_cursor`. New threads stop at 1,000 per review and
reviewer writes at 100 total messages per thread. Successful mutations stop at 100,000 per
review to bound receipt growth, including repeated reopens. Author replies and
resolves bypass the message and mutation count caps; author creation still uses
the thread and mutation caps. Reviewer writes stop at 3,670,016 serialized UTF-8
bytes, reserving 524,288 bytes for author writes up to `stateBytes` at 4,194,304
bytes. Either byte boundary returns `limit_reached` with `$.bytes` before any
write. The byte cap normally binds before the mutation count cap. These C1 limits
return 409 without truncation or resetting history.
Identical retries still return their original receipt at capacity. Free-text
fields refuse C0 control characters except line feed and tab.

Hidden-target mutations, including successful create retries whose target is now
hidden, return 404 without disclosing a receipt. The HTTP adapter explicitly
admits `principalFor("reviewer", "local-preview")`; requests never choose either grant.

`CoursePreviewService` accepts hosting, state and host preferences as dependencies.
Browser sessions use HTTP hosting and session-local state, and prepare input with
`inheritWorkspaceSettings: false` and `manifestPolicy: "read-only"`. The internal lesson-preview API can compile unsaved source; Read launches compile disk.
The shared MessageChannel retains learner state and writer fencing. Glossary
actions open a retained in-page frame and return focus to the course link.

Preview input uses `mode: "preview"`. Unlinked narration becomes an artifact warning and does not block preview compilation.
Export keeps the narration guard and sends `ENARRATIONUNLINKED` with
`details: {file, count}`. Use `praxity narration status` and the narration CLI to inspect and resolve retained narration. Preview failures reach the calling service; the retired narration panel, Retry button and page counter do not ship.

Host preview and export resolve narration v2 targets through I4 and N1. Source edits preserve `.prax` bytes as supplied; they do not rewrite narration fingerprints or allocate source IDs. A changed target revision requires narration review. The narration CLI reads and writes narration v2. Save source changes before
editing narration so targets use durable identities. Script edits retain the old
recording and flag it; Accept records `acceptedFor` without changing the original
`audioFor`. Later script, language, voice, speed or source changes require review
again. Authors use the narration CLI to attach an existing `assets/` recording by path and accept reviewed changes. Browser narration authoring is retired.

The CLI uses the same owner and journal:

```sh
praxity narration status <project-dir>
praxity narration accept <uuid:role> --project <project-dir>
praxity narration attach <uuid:role> assets/recording.mp3 --project <project-dir>
```

Status lists flagged and unresolved targets without writes. Accept and attach
refuse unknown targets. Accept keeps recording bytes; attach never copies or
replaces the existing asset. CLI target edits preserve unrelated sidecar entries,
comments and line endings; YAML constructs that cannot be preserved are refused.

Grammar 4 is the only supported source format. Grammar 3 is refused with `pnpm --dir <converter-checkout> --filter @praxity/convert convert <course-copy> --from 3 --out <new-output-directory>`. Prepare the archived converter as described in [converter-archive.md](converter-archive.md). Conversion runs on a scratch copy and requires C4's report approval hash for installation.

## Standalone browser build

The build packages review assets, inspection support, learner assets and their provenance. It emits no canvas editor bundle or digest. Preview startup does not validate an editor payload.

Set `PRAXITY_BROWSER_ARTIFACT` to an absolute standalone artifact directory when
running `pnpm --filter @praxity/desktop e2e:browser-editor`. Without it, the journeys start
the source server. The retained journeys run headlessly across Chromium, Firefox
and WebKit. See [the testing strategy](testing-strategy.md).
