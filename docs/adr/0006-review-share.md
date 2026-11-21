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
- `lookupShare.stored`: KV defaults to 60 s, minimum 30 s; the explicit TTL preserves that existing window. Revocation or shortened expiry can take up to 60 s to reach this edge.
- `createShare`: Return the server-computed expiry so clients render the authoritative date rather than recomputing it (avoids build/upload clock skew).
- `serveFile.conditional`: Preserve R2's existing range and conditional semantics, including If-Range.
- `serveFile.exists`: Cached bytes must not bypass R2 retention or manual deletion.
- `serveFile`: Date and weak validators cannot establish an exact representation match here.
- `serveFile.object.range`: A minimal read lets R2 evaluate If-None-Match before a 416 response.

Sources: the corresponding comments and implementations at commit `bed54f6109aa4ae868c981f53233a5ee9c5afdd7`, and the regression cases in `packages/review-share/tests/`.

## Consequences

Changes to these boundaries must preserve the recorded distinctions and their existing regression coverage. Removing source comments does not change these contracts.
