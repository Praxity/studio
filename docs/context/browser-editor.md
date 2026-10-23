# Browser editor implementation status

Studio runs through the standalone CLI, an authenticated local HTTP session and the thin canvas. `pnpm build:cli` packages the native text adapter in `dist/studio-cli/editor/`; missing or substituted canvas bytes refuse startup before listening.

`praxity studio <folder> [--review] [--port <n>] [--no-open]` starts a foreground server. The printed ready URL opens `/`, which enters Read mode on the separate learner origin. Edit text admits the author document through `/launch`. Ctrl+C closes listeners, subscriptions and watchers and waits for admitted file operations. Export, inspect, identity and narration use the standalone CLI.

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
The optional `pages` array maps captured page IDs to same-origin Read URLs for review navigation.
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
Edit text keeps its destination in the review header. Plain Read uses a fixed styled link with a reserved row above the shell; both retain a 44 px target and visible focus, including forced colours.
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
Ordinary course links, Edit text, Back, reload and closing can discard session-only
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
projection chooses the stored panel even while hidden.
Quotes match visible text first; text inside concealing elements is searched
only when nothing visible matches. A target gets no marker unless it has a box
with positive width and height: it reads "Not visible here" when Show on page
can open every concealing element, and "Not on this page" otherwise.
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

Bare Studio keeps its existing response bytes. Edit documents and reusable
compiled artifacts contain no local review bootstrap or assets. The existing
Read link returns to review-enabled Read mode. Restart keeps the review ID and
remints its capability. The author bearer never enters learner HTML, config or
storage. Ordinary HTML and SCORM exports contain no local review capability or
comment data.

Opening a course that would retire existing identities keeps the resolution
transient. Read remains available; `/launch` and author document admissions show
a server-rendered review page. The author must confirm that the course has not
been published before Studio calls the identity initializer with re-derivation.
The POST requires the editor origin, session bearer and the reviewed source
revision. Every identity write refuses unrecorded durable retirements unless
the caller supplies the confirmed re-derivation policy. Recorded operations and
explicit source deletions remain admitted.
Closing the review returns to Read and does not save identity or snapshots.
Pure additions that preserve all existing identities still persist at open.
Duplicate-only and invalid resolutions remain transient too. Duplicate-only
results do not trigger a retirement review. Manifest errors refuse admission.
An invalid lesson without retirements leaves ordinary author entry available.
If source errors coexist with retirements, the gate shows the invalid file and
line, keeps Read and Close available, and blocks confirmation until the source
is repaired. Confirmation still validates every lesson before writing.
When duplicates coexist with true retirements, the page lists only the retirements
and uses the CLI's mixed advice: make the text unique, run identity initialization,
and rederive remaining changes only if the course has never been published. Confirmation is unavailable,
and its POST refuses without saving until the ambiguity is resolved.
Discarded provisional identities never enter the gate. This includes old stores
with pending IDs accumulated through repeated opens: a source save that removes
or rewords the extra copy keeps the durable original and settles the provisional IDs.

Background author refreshes render current source through transient resolution,
without a gate or identity writes. The next author write refuses with
`identity_retirement_pending`. An open field retains its text and Copy action,
announces the refusal, and places Review changes next in Tab order. That action
uses the existing discard confirmation before entering the review page. Cancelling
keeps the typed text and input focus.

A full-source draft that introduces its own retirements refuses with
`identity_draft_retirement`, the affected entries and advice to retain the text
or make the change in the canvas. It keeps storage unchanged and offers no
Review changes route, since disk has no corresponding change to review.

Custom narration cannot be saved against a transient block ID. Its write returns
422 `narration_target_unresolved` with localized repair advice and the exact
attempted source in `error.details.source`. Existing sidecar and identity bytes
stay unchanged. A previously saved script remains in authoring's unresolved
entries when its block becomes invalid; preview reports `ENARRATIONUNLINKED`
and inspection remains available.

## Implemented boundary

### Direct thin canvas documents

The author bootstrap adds adjacent, labelled Edit buttons for snapshot-admitted
heading, page-title, caption, paragraph, list-item and choice-label fields.
List-item fields cover only the item's own text; child content stays outside the field.
Pasted bullet markers refuse. A leading `N. ` is inline text after the item's marker.
Choice labels refresh only their compiler-owned text span, retaining the input.
One native textarea opens at a time. Enter and
blur save once; Escape cancels. Refusals keep exact input. Unknown saves check
admitted disk bytes before enabling a same-transaction retry. Copy and inline
reload confirmation stay beside the field. Buttons, fields and errors use
protected shadow roots, normal-flow placement and contrast-corrected controls matching
the compiler's light or dark course appearance. The first author control is a native
Edit text toggle with `aria-pressed`. It stays disabled and unpressed while connecting
and after startup failure, with the recovery message as its description. Successful
author entry starts pressed; switching it off
hides every Edit button and its reserved space on the editor origin. Pending saves
settle first and kept text requires explicit discard. No keyboard shortcut is bound.
Every name starts with its kind and ordinal among that kind in current page order,
such as "Edit paragraph 3: Repeated paragraph." French uses the same order with
" : " before the excerpt. `shared/canvas-messages.ts` owns the templates and
`editButtonName`; authored text is appended literally after whitespace normalization
and a 40-grapheme limit, with an ellipsis when cut. Empty text has only the prefix.
The renderer recounts after refresh and save, across choice questions too. Unknown
binding kinds have no button. Choice
fields occupy their original option row, leaving its inert input and badge in place.
One polite status announces mode, save, cancel and refusal outcomes. A persistent
non-live error describes a refused field; the status announces it without a second
visible copy. The author panel reserves its own space above the course and scrolls
with the document. Status and Read-link changes keep the toggle in place.
At widths of 768px and above, the toggle, Read link and status share one compact row.
Loading-label space and a status slot also keep course Edit targets from moving
when the Read link updates or a refusal becomes announcement-only. A delayed
mode exit returns focus only from controls it hides, preserving later course focus.
A committed reply refreshes the saved compiled presentation through the existing preview owner.
Paragraphs keep their source wraps. Shift+Enter adds a wrapped line; plain Enter
saves. Structural pastes refuse through the operation owner without resetting
the textarea or its native undo history. Authored feedback still awaits a compiler
presentation and has no Edit button.
Acknowledged source edits retain the exact baseline and shifted field ranges for
rapid repeated edits, including CRLF paragraphs before background refresh.

Untouched fields close without an operation. Read mode and course links wait for
an in-flight save. Refused or unknown text requires inline discard confirmation
before leaving or cancelling; other unloads prompt while a save is pending or
kept text exists. Top-level `_top` and `_parent` links wait for pending saves too.
A later save retires an earlier discard confirmation. Corrected input
still saves on author departure. Studio's own focus moves and focus within the
field's recovery controls never save. The confirmation's question names its group
when focus enters Keep editing, without another live announcement. Each host follows
its run in the document flow. Opening hides only that run and replaces it with a
growing native field. Choice fields occupy the text column, and prevent label
activation even if course radios are enabled. Caption Edit buttons follow the caption
container. An open field replaces its own run inside that container, while the figure
keeps its captured authored name. Closing restores its original name attributes,
so controls never contribute to the figure's accessible name. Each closed caption
control shows its run in an aria-hidden context clipped at 24ch. Opening the field
hides that context; cancel and save restore it before the output refresh.
Playwright computes the
caption-derived name while closed, but Chromium's native accessibility tree has
an empty figure name in that state. C15 must verify the spoken name.
Refresh reanchors every retained host before recounting names, including reordered
choice options. Fields scroll with the course beneath sticky navigation. Focus
measures hit-tested sticky and fixed chrome, including exposed edges of overlapping
headers, and sets protected scroll margins in the host's own units. Keyboard focus
reveals Edit buttons; pointer focus leaves the target in place until activation.
Recovery controls use their own measured margins and instant scrolling.
Native instant scrolling handles zoom and nested scrollers.
Studio checks the control's centre and inset corners, or the field and its label,
then tries one centred reveal with fresh chrome measurements before field fallback. Tall textareas cap their
height to the uncovered scrolling ancestor, including body or html, and scroll internally to keep the caret visible
alongside the label. A button
stays at its native position if chrome leaves too little room. No scroll handler
pins controls over neighbouring content.
If course CSS hides, shrinks, displaces or makes the field unfocusable, the adapter
moves only that open host outside body into a named top-layer group. Body becomes
inert until close, preventing background clicks and removing course controls from
the accessibility tree. Closing restores the previous inert state and host position.
When close returns focus, it tries the run's Edit button, then the author toggle
outside body if the Edit button cannot take focus.
The author
root's display, visibility, content visibility, interactivity, zoom, opacity and filter remain owned
so root-level CSS cannot hide, inert or shrink these controls.
Root opacity and filter effects, including intentional grayscale or invert, are
suppressed in Edit mode, so its appearance can differ from Read mode. The panel's
reserved body margin also clears headers when course CSS takes body out of flow. A startup
failure after mounting disposes the Edit hosts before disabling the toggle.
Tab and Shift+Tab
resume native course traversal at the heading's position. Native composition completion clears composition
state even for Chromium's untrusted completion event. Keyboard admission still
requires trusted input and checks the event's composition state.

The C02 entry is `GET /launch?canvas=1`. It mints a single-use compilation
admission for `/canvas?admission=...`. Cross-site and same-site subresource
requests cannot redeem it. Document navigations with Fetch Mode `navigate` and
Fetch Destination `document` also accept `same-site`, so Edit text can return
from Read's separate loopback port. Cross-site documents remain refused; fetches
and other requests retain the stricter site check. The admitted GET compiles saved content with the
existing preview owner, then returns through `/launch` to `/canvas/preview/...`, where the path
must resolve to captured HTML in the read-only artifact host. These routes add
no arbitrary project-file serving. `GET /` redirects to `/launch?canvas=read#`, which uses the same one-use compilation admission and opens the captured learner document on the read-only origin. The explicit empty fragment keeps the ready URL bearer out of learner HTML. `/launch?canvas=1` remains the direct Edit entry. `/index.html` and shell asset routes return 404.
The project owns the newest four distinct canvas revisions from hosting onward.
Unchanged builds share a ring slot. The newest build has no timer; cancelled
launches and lost replies stay bounded by the ring. Project shutdown drains
in-flight compilation and releases every build. A 256-revision page identity
index keeps old field scopes available after their files leave the ring.
Released documents redirect to the same page in the newest build, falling back
to that lesson's first page, then the course's first page, without compiling.
Read redirects use explicit arrival unless the request supplies a resume choice,
so an old learner bookmark cannot override the preserved slide fragment.

The author document is explicitly **non-opaque** on the editor origin. This
departs from the Page lens policy; existing opaque inspection responses and
their private-port protocol keep their policy. `author-document.ts` reuses
`stripInspectionMarkup` with author stripping enabled, removes authored bases,
and inserts one admitted learner-document base. Resources stay on the learner
origin. Only the per-response nonce-bearing Studio bootstrap executes; inline
handlers, course scripts, refreshes, shadow roots, invokers and authored control
markers are removed. Author stripping also removes noscript, whose parse mode
changes between jsdom and the browser, and referrer-policy overrides. Fragment
links name the author document explicitly so the learner base cannot move a
skip-link activation out of Edit mode. Its CSP permits authenticated connections only to itself,
denies forms, objects and workers, and refuses framing. No raw learner HTML,
SVG, media or embed is served on the authenticated origin.

The first head script removes the bearer fragment synchronously, authenticates
a supplied token before replacing storage, and captures browser APIs before
course elements can clobber document properties. A fragment gets the first
authentication attempt; only its HTTP 401 permits a stored-token fallback.
This recovers fixed-port restarts without persisting forged tokens. Editor
responses carry `Cross-Origin-Opener-Policy: same-origin`.
The bootstrap retains its own controls in a shadow root, with a manual popover
and inline important geometry protecting them from course selectors. It performs
one `configRead` RPC, or two for the authentication fallback. Authentication and
the persistent event stream start in a task after DOMContentLoaded. A hanging course image or embed does not block author controls.
Firefox uses the captured fetch event reader so its pre-load XHR cannot hold
document load open. Its request uses `cache: "no-store"` so another author tab's
identical pending stream cannot block it in the HTTP cache. The event response
also retains `Cache-Control: no-store`. Chromium and WebKit retain the XHR progress transport.
Both paths enforce the transport owner's existing byte limit and cancellation.
Fragment cleanup and token capture still happen in the first head script. Both
transports use the absolute editor URL, independent of the learner base.
It marks Edit mode and offers Read mode. It imports no old
session controller, drafts, frame bridge or structural editing commands. The
native text adapter is described above. `editorChanged` invalidates saved output;
it never acknowledges a save. A committed reply or cancellation also invalidates
it. Once no field is open, the existing preview build owner reads current disk
and serves a fresh author projection. Replacement waits for an unchanged field
generation and matching admitted source bindings before and after compilation.
The fetched bootstrap never executes. Reconciliation reuses unchanged course nodes
and owned Edit buttons, including when another page changes. Removed mounts are
disposed; superseded builds remain in the project's bounded ring. Native document getters and the captured
root protect initial mounting and refresh from named course elements.
Reconnection invalidates changes missed between streams.
Blur preserves moved focus, including repeated link destinations and unnamed
course controls. Enter and Escape return to the retained owning Edit button.
Bootstrap invalidations are replayed after the first snapshot is mounted.
Startup compares the captured source and manifest hashes with a fresh snapshot,
so a watcher event for matching content does not compile again. If an event
overtakes the first snapshot reply, startup reads a new snapshot before comparing.
After restoring refresh scroll, the placement owner reveals the focused Edit
button and checks it again after layout changes, including delayed images.
Canvas RPCs carry the captured author-document path in `X-Praxity-Canvas`. The
server resolves its captured compiler manifest to lesson and page identities,
with page position as a fallback for a retired transient identity. Captured sibling
identities distinguish a deleted middle page from its ordinal replacement and
select the lesson's first page;
snapshots contain only that page, and writes to any other page refuse inside
operation admission. A captured `deck` runtime renders every slide in its lesson,
so its scope includes those lesson pages for both snapshots and writes. Other
lessons remain outside that scope. Course DOM markers never select that scope.

Fields opened before another tab's first durable write resolve their captured
runtime node, lesson and page IDs through I4's successfully installed
correspondence. This session evidence stays private and is revoked on identity
session invalidation and close. Retained aliases reserve their tokens in the runtime
allocator. Aliases stay until session invalidation or close, including deleted
fields, so their tokens cannot target new fields. A request during another tab's
launch rebuild can temporarily lose document admission without losing those aliases.
It never replaces the exact whole-file revision or field
text checks. Unchanged fields can save after promotion; deleted nodes still refuse.

Canvas builds deploy the captured artifact as `standalone`, using the same
top-level learner host as published HTML. Iframe previews retain `electron-preview`.
Saved-output refresh also requests `standalone` and replaces the Read link with
the saved document's learner URL, keeping `praxity-resume=0` after every save.
The committed field's page ID is promoted through issued identity correspondence.
Read resolves it in the saved build, including the compiler's later-slide alias.
If that page disappears, Read uses the current admitted page and clears the
remembered ID. That optional target never blocks author refresh.
During compilation Read has no href. It stays focusable with link semantics,
`aria-disabled`, `aria-busy` and a localized visible Updating name. Pointer,
keyboard, auxiliary activation and browser link menus have no stale destination.
A completed or failed refresh restores the admitted link. A Read departure from
an open field waits for the save/discard decision and the refreshed destination.
If another open field defers a superseding refresh, Read stays Updating until
that field settles and fresh output is accepted. A requested Read departure
waits across discarded builds and deferred refreshes.
The standalone host initializes its learner runtime and tracker without a parent
handshake, so guided decks become ready and their slide navigation works.
Read mode uses the host's explicit-arrival marker, `praxity-resume=0`, to open
the edited page even when learner state bookmarks another page. The host consumes
the marker, so a later reload can still resume. Read mode navigates to this learner artifact on its separate origin, with
the `/canvas/preview/...` namespace adding only a localized Edit text link.
Relative Next, Previous and menu links keep this namespace. The response inserts
the escaped link at a parser-proven body offset, or as the deck's first child to
reserve a row above its header, without reserializing the captured
HTML; removing exactly that link recovers the original bytes. Course scripts and
interactions remain enabled. The link points to
`/launch?canvas=<encoded-captured-path>`, which admits only a canonical captured
HTML path before redirecting to the matching author document. The learner HTML
contains no editor bearer, and its origin receives no editor session storage or
RPC/event route. Both documents retain no-store and no-referrer headers. The
read-only artifact listener grants resource CORS only to the exact editor origin
for author fonts and other non-HTML captured resources; API CORS stays closed.

Read-mode learner progress, responses and deck preferences persist in this
browser's local storage on the read-only learner origin, scoped by course.
The standalone runtime uses the `default` attempt. A reload can resume that state;
a new listener port has a different origin and does not reuse it. There is no
connection to Studio's preview-state store, editor storage or project files.
Edit mode strips the course scripts, including the standalone host, shell and
deck island. The unenhanced deck shows every slide in document order, with
snapshot-admitted Edit buttons beside its headings. No learner state runs there.

`apps/desktop/src/main/studio/server.ts` binds explicitly to `127.0.0.1` on an
OS-assigned port, or exactly `--port <n>` when supplied. Occupied requested ports
fail without fallback and identify the holding Studio's course where available.
Editor assets and project files must have disjoint real roots.
Only captured shipped UI paths can be served as static resources. There is no
project asset, arbitrary filesystem, download or preview route on this origin.

Every parsed request checks the exact Host including port and rejects a supplied
Origin other than the editor origin, including `null`. RPC also requires that
Origin. RPC, session reads and events require the bearer capability. CORS stays
closed and OPTIONS is refused. Duplicate security headers, malformed UTF-8/JSON,
unsupported content types and compressed bodies are refused. The request body
limit is 10,500,000 bytes, including source and its expected-content baseline.
Unknown editor document navigations and expired or evicted canvas admissions return to `/` with an explicit empty fragment. The server retains up to eight one-use admissions for 30 seconds. Admitted documents arriving during a compile share its captured output, so six concurrent tabs reach Read mode without invalidating each other's files. Non-document requests retain their JSON refusals; exact one-use admission and Host/Origin/Fetch Metadata guards still apply.

Root Read launches carry `praxity-resume=0` through compilation, matching C02's explicit-page arrival behavior. The HTTP header limit is 16,384 bytes. Responses, including parser rejections,
have CSP, no-referrer, no-store and nosniff policies.

| Route | HTTP method | Authentication | Result |
| --- | --- | --- | --- |
| `/` | GET | Exact Host, exact supplied Origin | Private 303 to `/launch?canvas=read#`, then captured learner Read document |
| `/index.html` and retired shell assets | GET, HEAD | None | 404 |
| `/launch` | GET | Exact Host, exact supplied Origin | Private 303 to `/#session=<token>` |
| `/api/identity` | GET | Exact Host, exact supplied Origin | Studio service marker and canonical course directory |
| `/api/session` | GET | Bearer, exact supplied Origin | Selected lesson, source, config, version |
| `/api/rpc` | POST | Bearer and exact required Origin | `{ok, result}` or `{ok: false, error: {code, message, details?}}` |
| `/api/events` | GET | Bearer, exact supplied Origin | Fetch-readable newline-delimited JSON |

`/launch` lets project actions commit a stable preview URL without a token.
It has no side effects, sends no CORS headers and uses the same no-store and
no-referrer response policies. Cross-origin navigation works; cross-origin scripts
cannot read the redirect. Any local process able to request loopback can obtain
the token. See the [architecture security trade-off](architecture.md).

RPC accepts `{method, args}` and refuses extra envelope or argument properties.
The project session in `src/main/studio/project-session.ts` owns the complete method list and strict argument schemas. The canvas calls `canvasTextSnapshot` and `canvasTextApply`. Retained CLI and inspection services also use project, metadata, preview and export methods. `projectReadTextFile`
admits only `course.yaml` and `narration.yaml`, through the rooted file reader, to
load retained service metadata baselines. Absolute paths from the shared
draft owner are made relative to the admitted project before the same allowlist
check. The thin canvas uses `canvasTextSnapshot` and `canvasTextApply`; the legacy App and broad browser bridge have been removed. The reader does not admit arbitrary
plaintext, assets, identity records or writes. Lesson writes require expected source
and use the shared identity-aware transaction. Course-directory arguments must
resolve to the authorized root; lesson arguments must identify its admitted
top-level lessons. Course reads do not add a manifest identity or read a parent
workspace. Session snapshots, module/tree/config/metadata reads and preview/export
preparation use Phase A's read transactions. They preserve exact source bytes,
identity files and recovery stages. The identity owner supplies an in-memory,
path-derived lesson ID for read-only preparation before a module's first save.
`courseLoad` returns `manifestSource` from the same loaded snapshot.
Lesson saves use the shared write transaction with expected source and return
`ProjectWriteResult`. A cleanup warning acknowledges committed bytes; the editor
advances its baseline and displays Phase A's warning. Source saves write the submitted grammar 4 bytes without source IDs. The
identity sidecars and own-save notifications retain drafts typed during
acknowledgement. Busy codes cross HTTP as
`EPROJECTBUSY`; browser messages and Retry use the shared EN/FR recovery copy.
Root admission calls `path-security.ts` before either listener opens and refuses
the private lock cache, its ancestors and canonical aliases.
A standalone folder requires exactly one lesson; a course selects
the first lesson in manifest order, even when source texts are identical.

Preview leases/state and the session's HTML/PDF export, cancellation and confirmed
accessibility policy methods are also admitted through strict argument schemas.
`narrationStatus` discloses environment credential availability without credentials.
`narrationAuthoringRead`, `narrationAuthoringWrite` and `narrationCleanup` use the
same rooted narration owner as the CLI. Reads supply saved grammar 4
node identities and revision hashes. Writes require the exact sidecar baseline
and use the project journal; recording paths must resolve to existing files inside
project `assets/`, including after symlink resolution. Cleanup admits only reserved
generated pairs and preserves any recording referenced by the saved sidecar.

Events carry `ready`, `heartbeat`, `grammarChanged`, `treeChanged` or an explicit
watcher error. Each session allows eight streams and bounds each stream's queued
bytes to 20,000,000. Disposal removes its subscription and heartbeat. Watchers do
not follow symlinks. Unresolvable and escaping input links fail admission.
No server helper imports Electron, global credential/settings storage or upload
telemetry. `project-tree.ts` and `project-config.ts` remain CLI/server owners.

## Retired hosts

The legacy React browser shell and Electron application have been removed. No shell HTML, browser bridge, preload, desktop IPC, auto-updater or desktop build ships. Share for review retired with desktop IPC. Use CLI commands for structural authoring, export, `inspect --schema 1`, narration and identity operations. Tag `v0.3.0` preserves the previous desktop release; it predates durable editor drafts. `praxity recovery list <course>` lists retained drafts, and `praxity recovery export-drafts <course> <new-directory>` exports each as exact plain text without deleting it or changing source. Studio prints a count and that command when drafts exist; `--lang fr` selects French notices. Existing author records are untouched.

## Browser export

`StudioExportService` owns the session's accessibility policy and one cancellable
HTML ZIP or native Typst PDF job. It calls `exportProject()` with read-only
manifest handling and no workspace inheritance, saves atomically beneath the
authorized project's `exports/`, and registers a distinct read-only download
capability for that file. Downloads validate the captured path and size and send
an attachment response with exact MIME, nosniff and no-referrer. They expose no RPC.
The CLI exports saved source. Progress and policy acknowledgements
arrive through the existing event stream. NDJSON writes include whitespace
padding after the record delimiter so Windows WebKit delivers short progress
updates during compilation.
Cancellation announces completion and leaves no new output. Browser settings
cannot persist or bypass the policy.
Narration status reports environment credential availability and region only;
no key crosses the bridge and synthesis remains deferred.

## Isolated preview and media

The second loopback listener serves only capability-authorized `assets/` files
and captured compiled artifact manifests. Media and preview capabilities differ
from each other and from the editor bearer. It accepts GET/HEAD, rejects bearer
headers and RPC, validates Host/Origin, and sends nosniff, no-store, no-referrer,
exact MIME and single byte ranges. Raw authored assets receive a sandbox CSP
without script permission. Only media reads grant CORS to the exact editor origin.

An optional `review: { store, capability }` server option enables comments-only
HTTP routes on this learner listener. It is absent by default; CLI enablement and
Read-page bootstrap are separate work. The caller mints a fresh
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
`inheritWorkspaceSettings: false` and `manifestPolicy: "read-only"`. Live lesson
previews compile unsaved source; full preview flushes saves and compiles disk.
The shared MessageChannel retains learner state and writer fencing. Glossary
actions open a retained in-page frame and return focus to the course link.

Browser checkpoint RPCs run in order per lease. Each request shares the frame's
three-second state-flush deadline, from dispatch through response parsing.
A timeout rejects that save and lets the next queued snapshot proceed. Bridge
disposal aborts active saves and rejects queued writes. The store still checks
writer tokens, generations and sequences before installing state.

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

The browser build emits `editor/canvas.js` from `canvas-entry.ts`, which composes
the bootstrap, native text adapter and protected control styles, as
a separate IIFE bundle. The author projection runs that shipped bundle as its
first nonce-bearing script, before course markup is parsed. Server startup reads
and captures it before binding either listener. The standalone build runs the
browser build first and embeds the SHA-256 of the emitted canvas bytes in the
generated CLI. Missing, empty or substituted bytes refuse launch with a rebuild
instruction before listening or identity writes. Verification and injection use
the same captured bytes. No environment variable or adjacent inventory can
override the packaged digest.

Source servers use `canvas.sha256`, emitted alongside `canvas.js` by the same
browser build, as their expected digest. Source runs trust that local build
receipt; the packaged CLI ignores it and requires its embedded digest.

The canvas dependency graph rejects the old React shell, broad browser bridge,
session controller, draft persistence and frame bridge. The legacy shell and Electron entry have been removed. The CLI session still imports operation, snapshot and draft-capable service owners. Its captured inspection responses still use `inspection-frame.ts` and the frame bridge. Those modules and their security tests remain. Existing `.praxity/local/` records stay untouched. The actual esbuild canvas inputs join the private source provenance; no function serialization is used.

The Vite build emits only `canvas.js` and `canvas.sha256`. It records the canvas esbuild input closure; the standalone builder also records retained inspection and learner inputs. Those inputs identify `studio-browser-editor`
contributions; upstream files also retain `third-party` ownership. The build
copies full upstream notices and records their source hashes. Every editor
payload file has its own hash and browser component classification in
`inventory.json`. Exact source hashes stay in the private review directory.
The artifact contains no source maps or checkout paths.

Set `PRAXITY_BROWSER_ARTIFACT` to an absolute standalone artifact directory when
running `pnpm --filter @praxity/desktop e2e:browser-editor`. Global setup launches
its actual CLI and tests its production editor. Without that variable, setup
builds the same editor configuration and uses the source server. Both modes run
headless Chromium, Firefox and WebKit in English and French. Native Mac packaging
and assistive-technology checks require separate human evidence.

The old exact-file component schedules exist only in `legal/archive/0.2.0/` and
must stay unchanged. Current PolyForm Perimeter releases use the artifact's
checksummed `inventory.json` and the private exact-file provenance record
`dist/studio-cli-review/build-inputs.json`. There is no current separate
`COMPONENT-SCHEDULE.md`; reconcile any new schedule with the current licensing
rules rather than extending the archived terms.

Run the headless browser checks described in [the testing strategy](testing-strategy.md) to produce evidence for the current revision.

Canvas builds belong to `CoursePreviewService.buildCanvas` before a reply is sent.
The project keeps the newest build and three older revisions, ordered by compile
start, with duplicate revisions sharing one slot. No client release or timer
controls retention. Project close drains in-flight builds and releases the ring.
The read-only listener records page identities for 256 revisions and touches them
on lookup. Saves use that captured scope after file eviction. Released Read and
Edit documents redirect to the same page in the head, then the lesson's first
page, then the course's first page. Queries and native deck fragments survive;
redirects never enter compile admission. Released lazy subresources remain a
separate follow-up.
