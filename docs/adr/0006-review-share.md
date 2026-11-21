# 0006: Review state and edge delivery

## Status

Accepted. Records existing behaviour.

## Context

Review commands retain historical receipts while edge delivery must respect authoritative expiry and storage state.

## Decision

### `packages/review-share/src/review.ts`

- `REVIEW_LIMITS`: String bounds count UTF-16 code units. HTTP adapters enforce requestBodyBytes.
- `ReviewOutcome`: Original mutation outcome; current lifecycle facts always come from the thread.
- `ReviewDeps.storedPrincipal`: Local adapters set this only after matching the principal to its stored manifest identity.
- `REVIEW_TEXT_RULES`: Serialized into the local review bootstrap so the browser and review command owner use one text rule.
- `text.storedControls`: Read existing records under their original text rules; only new input gets stricter admission.
- `messageBody`: Windows reply files retain their CRLF bytes; other free text keeps the stricter rule.
- `parseReviewState`: Parse persisted bytes before using them; no repair, clamping or identity invention.
- `command.parsed`: A receipt admits historical text only for replay; the digest still requires the exact request.

### `packages/review-share/src/worker.ts`

- `global.CacheStorage`: Vitest also loads DOM declarations, which hide Workers' default cache property.
- `immutableFile`: Match exporter fingerprints, never ordinary authored filenames or HTML.
- `lookupShare.stored`: Use an explicit 60 s read-cache TTL. Cloudflare documents a 60 s default and a 30 s minimum in its [2026-01-30 KV changelog](https://developers.cloudflare.com/changelog/post/2026-01-30-kv-reduced-minimum-cachettl/). Revocation or shortened expiry can remain stale at another location for 60 s or more; 60 s is not a global propagation bound. Source: [How KV works, consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency).
- `createShare`: Return the server-computed expiry so clients render the authoritative date rather than recomputing it (avoids build/upload clock skew).
- `serveFile.conditional`: Bypass the edge cache for `Range` and `if-*` requests. Studio evaluates `If-Range` against object metadata and computes the byte range; R2 evaluates the supplied `onlyIf` conditions and range read. Source: [R2GetOptions](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2getoptions). Studio response coverage: `packages/review-share/tests/worker.test.ts`, "keeps conditional/range behavior with a warm edge cache: %j" and "respects If-Range %s".
- `serveFile.exists`: Cached bytes must not bypass R2 retention or manual deletion.
- `serveFile`: Date and weak validators cannot establish an exact representation match here.
- `serveFile.object.range`: For an unsatisfiable range on a nonempty object, request offset 0 and length 1 with `onlyIf` before producing 416. If R2 returns metadata without a body for an unmet condition, return 304 first. Source: [R2 conditional operations](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations). Studio precedence coverage: `packages/review-share/tests/worker.test.ts`, "evaluates conditional GET before range %s"; this uses the test adapter rather than a deployed R2 service.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the regression cases in `packages/review-share/tests/`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
