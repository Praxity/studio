# Review-share Worker

This Cloudflare Worker hosts standalone Praxity Studio review builds in R2, keeps share metadata and
comments in KV, expires review access, and accepts anonymous per-page comments. It is review
infrastructure only; learner and SCORM traffic never uses it.

## Bindings

`wrangler.toml` expects:

- `REVIEW_KV`: KV metadata, comment lists, and short-lived rate-limit counters.
- `REVIEW_FILES`: the `praxity-review-share` R2 bucket containing uploaded review files.
- `UPLOAD_TOKEN`: a Worker secret used only to authorize share creation and file uploads.

## Configuration

Deploy the Worker in your own Cloudflare account. Set `reviewShareUrl` in the desktop app
to the HTTPS URL printed by Wrangler, and set `reviewShareToken` to the same value as the
Worker's `UPLOAD_TOKEN` secret to enable Share for review. Keep the token out of source control.

To rotate the token: `wrangler secret put UPLOAD_TOKEN` and update the desktop setting.

## Deploy

Run these commands from `packages/review-share`:

```sh
wrangler login
wrangler kv namespace create REVIEW_KV
wrangler r2 bucket create praxity-review-share
wrangler r2 bucket lifecycle add praxity-review-share --name expire-review-builds --expire-days 60
wrangler secret put UPLOAD_TOKEN
wrangler deploy
```

After creating the KV namespace, replace the `id` under `[[kv_namespaces]]` in `wrangler.toml`
with the ID printed by Wrangler before deploying. The checked-in all-zero ID is a placeholder.
Deployment is manual; no workflow substitutes an account-specific namespace ID. Keep your
deployment configuration local and do not commit the real ID.

The edge cache takes effect only on a custom domain or a zone route. On the default
`workers.dev` deployment, Cache API operations are inert and every file request still
reads R2. A custom domain or route is an owner decision; no route is configured here.
See Cloudflare's [Cache API documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/).

No deployment is required for local unit tests. The tests call the exported fetch handler with
plain in-memory KV and R2 stubs; they do not use Miniflare or the network.

## Storage and expiry

Creating a share stores its metadata in KV. Each subsequent `PUT` streams one relative file path
to `REVIEW_FILES` under `<slug>/<path>`. The Worker checks metadata expiry before serving files,
accepting uploads, or reading/writing comments. Expired file requests receive a `410 Gone` page;
API requests receive a JSON `410` response.

Every share lookup explicitly uses KV `cacheTtl: 60`, including file-cache hits and the slashless
entry redirect. KV defaults to 60 seconds and permits a minimum of 30 seconds, so this
setting documents the existing window without extending it. See the
[KV read documentation](https://developers.cloudflare.com/kv/api/read-key-value-pairs/).
A revoked or expired share can keep being admitted for up to 60 seconds
while an older active KV record remains at an edge location. The Worker still compares
the returned record's `expiresAt` with the request time, so an unchanged expiry is enforced
even when that record came from KV's edge cache. Revocation means deleting the share's
KV record. This window also applies if an operator shortens expiry in KV.

## File cache and timing logs

After the share check passes, ordinary GETs use `caches.default` only for these existing
exporter fingerprint formats:

- Optimized photos, `assets/__praxity-<24 lowercase hex>.webp`, from
  `optimize-resolved-images.ts`.
- Root stylesheets, `<name>.<12 lowercase hex>.css`, from `build.ts`.
- JavaScript, `<name>-<8 uppercase letters or digits>.js`, optionally with `.classic`
  before `.js`, from `bundle-viewer.ts`. These can be at the root, in `islands/`,
  `chunks/`, `islands/chunks/` or `privacy-chunks/`. Exported islands normally have
  their `islands/` prefix removed by `build.ts`.

These names change with compiler inputs or content. The upload endpoint still allows
overwrites, so publishers must keep fingerprinted names bound to their original content.
HTML and all paths outside these formats bypass the edge cache. In particular, ordinary
authored media names, unversioned scripts and JSON are mutable. Other fingerprint formats
also bypass the cache until explicitly admitted. Existing browser Cache-Control headers
are unchanged; the KV check applies to requests that reach the Worker.

Cache keys are GET requests to
`<request origin>/.review-cache/v1/<SHA-256 admitted share slug>/<SHA-256 decoded file path>`.
Both digests use full lowercase hex. Queries, fragments, userinfo, cookies and authorization
headers never enter the cache key. The share segment comes directly from the admitted
record, independently of telemetry. Shares cannot reuse each other's entries.
The `/.review-cache/` isolation assumes the Worker owns every path on its whole host,
including that cache namespace. Partial `/s/*` and `/api/*` routes leave it unguarded.
A cache hit first checks R2 object existence with `head`, so a file deleted by retention
or manually cannot be served from an older cached copy. This skips the R2 body read, then
returns the stored response with the same headers and bytes as the fresh response.
Misses read R2 and put a clone of a full `200` response through `ctx.waitUntil`.
HTML, refusals, missing files and partial responses are never stored. Cache writes do not
delay the response. Cache-match failures fall through to the guarded R2 path and add
`cacheMatchFailed: true` to the request log with `cache: "bypass"`. Failed background
writes are caught and emit a `review_share_cache_put_failed` JSON follow-up line with
the same log identifier, without exception text.

Range and all `If-*` requests bypass the edge cache and retain the existing R2 behavior,
including ETag `304`, `If-Range`, `206` and `416`. HEAD retains its existing `405` with
`Allow: GET`. The Worker needs its execution context for caching; direct calls without
one continue to read R2.

Each request emits one JSON line with `event: "review_share_request"`. In `wrangler tail`,
compare `kvMs` for share-metadata reads, `r2Ms` for file reads, existence checks and range
metadata, and `cacheMs` for edge-cache lookup time. `cache` is `hit`, `miss` or `bypass`.
On a cache hit, `r2Ms` measures the existence check without fetching the file body.
`totalMs` measures handler time up to the response, excluding streamed body transfer and
the background cache write. `status` includes refusals and `500` failures.
`shareHash` is SHA-256 of `review-share-log:<slug>`, or null when no share lookup ran.
That fixed prefix separates the log identifier from the cache-key digest.
Logs contain no raw share slug, path, URL, token, request headers or exception message.
These fields do not measure comment operations, KV writes or file uploads.

MIME types come from the exporter's runtime-neutral `artifact-media-types` public entry,
shared with `build.ts`. This is the sole table for both callers, without Node imports or a
dependency cycle. It includes MJS, WASM, WebM, WOFF, M4A, OGG/OGV/Opus, MOV, WAV, FLAC,
AAC, TXT and XML alongside the existing formats. Unknown extensions retain
`application/octet-stream`.

## Retention and comments

File responses support single HTTP byte ranges for audio and video seeking. The Worker streams
the requested R2 range with `206 Partial Content`, `Content-Range`, and `Content-Length`.
Invalid or multipart ranges fall back to the full file; valid ranges outside the file return `416`.
Keep these transport checks in the Worker tests: player-level seek tests alone cannot detect a
review host that ignores range requests.

Expiry does not delete KV or R2 data. Configure an R2 lifecycle rule on the
`praxity-review-share` bucket to delete objects after 60 days, matching the maximum share lifetime.
Edge copies can remain stored under their existing one-year max-age, but every hit must
pass the share check and R2 existence check. Deleted R2 content is therefore refused even
if its share record remains active; this change uses `head` rather than a shorter cache TTL.
KV metadata and comment cleanup can be handled separately if retention requirements change.

The comment rate limit is intentionally naive: one KV counter per share, SHA-256 IP hash, and UTC
minute, with at most 10 accepted comments. KV updates are not atomic, so this is abuse friction,
not a strict distributed quota.

Comment values are stored raw and returned only as JSON. Review clients must render `name`, `text`,
and `page` as text (for example with `textContent`), never by inserting them as HTML.

Comments may include an optional `pageHeading` snapshot, stored separately from the stable
`page` ID and comment `text`. The worker validates it as a non-empty string and clamps it
to 500 characters. The sidebar renders it as text. Existing comments without a heading
remain readable; navigating a module deck loads comments for the active slide ID.

## Review contract

`@praxity/review-share/review` owns schema-1 records, strict parsers, bounds, snapshot
listing and pure lifecycle commands. It uses Web Crypto for SHA-256; it has no HTTP,
filesystem or Node dependencies. Legacy `comments.ts` retains its clamping, KV and
Worker behavior, importing and re-exporting the same name/body limits from this owner.

Schema 1 is review-only: it holds author review comments. Learner discussion will
use a separate versioned container and partition, sharing this contract module
but not review storage.

`create`, `reply`, `resolve` and `reopen` take `(state, principal, payload, deps)`.
The caller admits the principal; payloads cannot supply one. Reviewers may create,
reply and reopen; authors may also resolve. Resolve appends a reply atomically.
A reviewer reply reopens a resolved thread; author replies keep the current status.
That reopening rule is review policy, not a thread invariant.
Explicit reopen, including on an open thread, advances the version and sequence.
Resolving an already resolved thread appends the reply and records the new resolution.
Dependencies supply `now(): string` (canonical UTC ISO timestamp with milliseconds)
and `uuid(): string`. Invalid dependency output throws; expected refusals return
`{ ok: false, code, detail }`. Callers must parse persisted state before using it.

Parsers return `{ ok: true, value }` or a refusal with a `$`-rooted field path.
`parseReviewPrincipal` admits principals before any read-visibility policy call.
All record fields are required, including nullable anchor IDs. UUIDs use canonical
lowercase spelling; actor and anchor IDs are nonblank strings up to 200 UTF-16 units.
A bound course requires a namespace; a non-null anchor course ID must match it.
Binding a review later keeps its old unbound threads, with their null course IDs.
IDs refuse surrounding whitespace and C0 controls. `revealPath` is an ordered array
of at most 16 nonblank IDs; `tab` and `cssPath` are nullable strings.
Context titles/labels are nullable, bounded
text. Both `blockId` and `pin` require `nodeId`. A pin path is empty for the node
itself, or direct child steps such as `p:nth-of-type(1) > span:nth-of-type(2)`
(16 steps, 512 units).
`REVIEW_LIMITS` exposes all bounds. Text is preserved, never trimmed or clamped;
whitespace-only bodies and lone surrogates refuse.
Free-text fields refuse C0 control characters except line feed and tab. Message
bodies also accept CR immediately followed by LF, preserving CRLF bytes exactly.
A lone CR still refuses. Quotes, titles and all other free-text fields refuse CR,
including CRLF pairs. No line endings are normalized.
V1 has no body-edit command. Later privileged redaction may replace a body with
a content-free tombstone.

Persist receipts together with state. Each binds actor/request UUID to a canonical
SHA-256 digest of command kind and complete payload. Every success returns the current
`thread` and an original-outcome `receipt: { threadId, version, messageId }`; `messageId`
is null for reopen. A retry returns `replayed: true`, the current thread and unchanged
state, and the original receipt. A replayed resolve therefore reports an open thread
if newer reviewer feedback reopened it. Reusing a request UUID for different input refuses.
Receipts are retained without eviction; adapters must not prune them independently.
Receipts hold digests and outcome references, never message bodies.

Local and hosted adapters share fixed flood bounds: at most 1,000 threads per
review. Reviewer replies stop at 100 total messages per thread, including the
opening message and any author responses. These are `REVIEW_LIMITS.threadsPerReview` and
`REVIEW_LIMITS.messagesPerThread`. A new mutation exceeding either returns
`limit_reached`, with `detail.path` equal to `$.threads` or `$.messages`.
Retries are checked first and still return their original receipt at capacity.
Existing records remain readable; admission never truncates stored feedback.
Successful mutations are also capped at 100,000 per review through
`REVIEW_LIMITS.mutationsPerReview`, with refusal path `$.receipts`. This bounds
receipt growth from repeated reopen operations. Identical retries remain available
at this cap; stored receipts are never evicted. Author replies and resolves bypass
the message and mutation count caps; author creation still uses the thread and
mutation caps. At a cap, existing feedback remains readable and no history is
truncated or reset.

Adapters call `serializeReviewState(state, role)` before publishing a new state.
It returns the JSON string or `limit_reached` with `$.bytes` above
`REVIEW_LIMITS.stateBytes` (4,194,304 UTF-8 bytes) for authors. Other roles stop
at 3,670,016 bytes, reserving `REVIEW_LIMITS.authorReserveBytes` (524,288 bytes)
for author writes. The byte cap normally binds before the 100,000-mutation count
cap, which remains as an independent count bound. Local writes check the byte
bound inside the exclusive transaction. Identical retries precede serialization
and retain their original receipt at the byte cap.

`listThreads(state, principal, { pageId?, status?, cursor?, limit? }, policy?)` returns a promise of a list
or a refusal. Default: all threads in creation order, 50 per page; maximum 100.
Cursors bind review, sequence, filters, principal ID, role and the visible thread set.
A principal, role or visibility mismatch refuses `invalid_cursor`; snapshot drift returns `snapshot_changed`.
Changing page size is allowed; changing filters requires restarting. Returned thread
records are copies. Stores serialize mutations and replace state plus receipts atomically.

`ReviewVisibilityPolicy.visibleTo(principal, thread, state)` owns read visibility.
The default `reviewVisibility` shows every thread of the review. Lists apply the rule
before pagination and any counts. Every read path, including list, get, count,
export and notify, must call this rule. Clients must not assume a capability sees
every thread or filter visibility in the browser.

The local store scopes every key to the admitted review under
`.praxity/reviews/<reviewId>/`; receipts belong to that review's state.
URLs, export slugs, T3 threads and page titles are never storage keys.
The versioned manifest keeps the local principal's stable ID and display name
separate from any role. Callers grant the role at use through `principalFor(role, provenance)`. The host supplies provenance independently of role.
`principalFor` reads only the manifest; thread operations validate state independently.
`openReviewStore(courseDir, policy?)` accepts the same policy; its
`list(principal, options?)` passes the admitted principal through to the contract.
Schema-1 files reopen unchanged. A newer manifest or state schema refuses with the typed
`newer-schema` storage error and leaves the file untouched.

Local mutations return `{ ok: true, thread, receipt, replayed, cleanupError? }` or a
contract refusal, never raw state. A hidden result thread is `null`; mutations
on hidden targets refuse `not_found`, including retries. Review writes use flushed
temporary files beside each target, never the public course recovery journal.
First use publishes `.gitignore`, a manifest with `initialized: false`, empty state,
and finally the manifest with `initialized: true`. No comment can be acknowledged
before that final durable publication. Only explicit `false` permits first-use
repair; a missing flag counts as initialized for compatibility. Missing state in
an initialized review refuses without resetting comments or receipts.
Read admissions do not repair storage or reclaim course recovery archives.
Mutations remove only stale UUID temp siblings of the store's own fixed files,
after validating the admitted state. Unknown files remain untouched.

Before initialization and every mutation, the store checks Git under the write
admission. The private folder's `*` ignore rule cannot protect already tracked files.
`.praxity/` and `.praxity/identity/` remain versioned and are never ignored.

| Git decision | Write admission |
| --- | --- |
| No repository | Allow |
| Repository, no tracked review files | Allow |
| A Git repository containing this course or its review folders tracks review storage (including sibling courses) | Refuse `tracked-storage`; untrack those paths |
| A repository is rooted in `.praxity`, `.praxity/reviews` or the active review folder | Refuse `tracked-storage`, reason `repository-in-storage`; move or remove the repository, submodule or worktree, even if its index is empty |
| An enclosing repository redirects its worktree below or away from discovery, or has `core.bare=true` | Refuse `git-unavailable`, reason `git-error` |
| Cannot inspect the index or prove there is no repository | Refuse `git-unavailable` |

When child processes are allowed, the store first checks each existing plain
`.praxity`, `.praxity/reviews` and the active review folder named by the current
manifest for local Git metadata, using the same detector as the fallback below.
Sibling review folders are not probed. Any `.git` entry or git-directory shape
refuses `tracked-storage`, reason `repository-in-storage`, including broken
metadata, submodules and linked worktrees. Then the store asks Git at every ancestor
from the course directory to the filesystem root: `ls-files -z --full-name -- :/` lists the
whole index. The store sets `GIT_CEILING_DIRECTORIES` to that ancestor's parent
(omitted at the root), so discovery normally examines only that directory.
The walk advances independently of Git's `core.worktree` configuration. A nested
course repository cannot hide an outer index, even across non-repository ancestors.
After a clean index check, `rev-parse --show-toplevel` must resolve to that directory
or one of its ancestors. A ceiling containing `;` on Windows or `:` on POSIX can be
skipped by Git, so an ancestor top remains valid and the walk checks that root later.
A downward or unrelated `core.worktree` redirection refuses with `git-unavailable`,
reason `git-error`; it cannot hide storage behind shorter index paths.

The store matches the listed paths itself, without comparing course names.
It splits slash and backslash components, removes stream suffixes, applies NFKC,
removes default-ignorable code points, folds upper-then-lower case and strips
trailing dots and spaces. A `.praxity` alias anywhere before a `reviews` alias
refuses. Any component containing `~` followed by a digit may alias either name,
including NTFS hashed short names and VFAT collision tails. This deliberately
over-refuses ordinary paths such as `build/chunk~1/reviews/x` and `.praxity/chunk~1/x`.
This deliberately refuses sibling courses' tracked reviews in the same index.
Listings are buffered up to 64 MiB; overflow refuses rather than allowing a write.

Git always spawns from Node's executable directory, never the course or process
working directory, and receives no inherited `GIT_*` variables. The store sets
`GIT_DISCOVERY_ACROSS_FILESYSTEM=1` so discovery checks ancestors across mount points;
the mount-point diagnostic still refuses as a backstop. All Git calls in
one admission share a 3.5-second deadline, below the five-second lock wait. The
store's optional third argument accepts `gitTimeoutMs` to shorten that deadline for process tests.
Only exit 128 with the entire stderr line
`fatal: not a git repository (or any of the parent directories): .git`
proves there is no repository at that ancestor; the walk continues. A single final
LF or CRLF is allowed. The
`not a git repository: <gitdir>` and `up to mount point` variants refuse.
A missing Git binary permits a write only after readable checks of the private
folders and every ancestor find no `.git` or git-directory shape. Other failures,
including a corrupt index, broken worktree, timeout or
`safe.directory` dubious ownership, refuse with `git-unavailable`.

`git-unavailable` includes a path-free `reason`: `no-child`, `git-missing`,
`git-too-old`, `git-error` or `timeout`. Recovery copy distinguishes allowing child processes,
installing Git, repairing the repository or marking it safe after verifying
ownership. Timeout recovery reads "Git did not answer in time; retry."

Each Git call disables fsmonitor, implicit bare-repository discovery, optional
index writes and paging. `protocol.allow=never` and an empty store-owned
`GIT_ALLOW_PROTOCOL` block every transport, including repository-specific protocol
overrides, so a sparse-index lazy fetch cannot run an uploadpack or remote helper.
Missing sparse-index trees or other diagnostics
refuse with `git-unavailable`. Untrack review storage in the repository that
tracks it, using its actual spelling, including case variants.
When Git is installed, its version is checked once per admission within the same
deadline. Git 2.39 or newer is required; older versions refuse `git-unavailable`
with reason `git-too-old`. The check uses no `--no-lazy-fetch` option, so Apple's
Git 2.39 remains supported.

Without child-process permission, the store checks the existing private folders
and walks every ancestor to the filesystem root. Any `.git` entry, including a linked
worktree's `gitdir:` file, a directory
with `HEAD` and both `objects`/`refs` or `commondir`, or any denied
existence check refuses with `git-unavailable`. Only a fully readable walk with no
repository allows writes. Existing reviews remain readable without Git admission.

The inside-storage refusal has a separate path-free `repository-in-storage`
reason and tells the author to move or remove the repository, submodule or worktree
in `.praxity` or its review folders. Untracking files alone cannot clear that
refusal. Enclosing indexes that track reviews retain the untrack advice.

The discovery boundary has residual limits. Repositories with no discoverable git
directory or `.git` entry at the checked storage paths or their ancestors cannot
be found. This includes `GIT_DIR`-only repositories and git directories in sibling
review folders, sibling course folders or anywhere else whose `core.worktree`
points at the private folder. Git cannot discover those from the storage path.
Tracked files through a differently named link to `.praxity` or
`reviews` are outside the name rule; POSIX Git refuses leading symlinks, while
Git for Windows can follow junctions. Hard links retain the old
bytes when an atomic temp-and-rename write replaces a file; the store also refuses
hard-linked storage targets. Another process can still track files between the
check and publication (TOCTOU).
