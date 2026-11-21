# 0085: Narration identity and media integration

## Status

Accepted. Records existing behavior; no executable change.

## Context

Narration must retain authored identity and privacy while media adapters respect browser lifetimes.

## Decision

### `packages/shared-blocks/src/blocks/video-player/url-utils.ts`

- `observeEmbedFailure`: Iframe load events do not prove a cross-origin provider rendered
  successfully. Keep the source link visible; remove the empty frame on observable failures.

- `waitForConfirmation`: A cross-origin load event also fires on network errors. If the provider
  sends no confirmation, offer a compact fallback and explicit recovery. Never infer failure from
  opaque, zero-valued Resource Timing fields.

- `observeEmbedFailure`: Bind before navigation so even a synchronous CSP refusal is observed.

### `packages/shared-blocks/src/blocks/video-player/use-video-player.ts`

- `useVideoPlayer`: For YouTube we must append enablejsapi=1 and origin so postMessage commands
  work. Without origin, YouTube refuses to initialize the JS API. onReady never fires, currentTime
  never updates, and cue points never trigger.

- `finalEmbedUrl`: Omit the origin parameter for file:// documents, whose origin is the string
  "null".

- `useVideoPlayer`: CSP can refuse the API while the cross-origin player and its native controls
  still work.

### `packages/shared-blocks/src/blocks/video-player/use-vimeo-player.ts`

- `useVimeoPlayer`: Load the Vimeo SDK dynamically only for an active Vimeo embed, so other video
  sources do not pay for its bundle.

### `packages/shared-blocks/src/blocks/video-player/use-youtube-player.ts`

- `useYouTubePlayer`: Use YT.Player around the existing iframe, with enablejsapi=1, rather than raw
  postMessage commands. The previous approach had origin and race failures. Poll every 500ms because
  the API reports discrete state changes rather than continuous time updates.

- `useYouTubePlayer`: Do not call player.destroy() during React cleanup: it removes the iframe from
  the DOM. Just drop the reference; React will unmount the iframe element.

### `packages/shared-blocks/src/narration.ts`

- `resolveNarrationV2`: The host supplies SHA-256, as it does for identity. No paths or positions
  enter revisions. Identity joins precede review checks; a changed revision never detaches a
  recording.

- `narrationScriptText`: Speak escaped bracketed cues as words before Markdown consumes the escape.

- `assertHighlightNarrationInputs`: Validate before visibility, container scripts or v2 cleanup can
  hide an explicit input.

- `selfCheckSourceData`: Narration sources ship in page data. Self-check contributes only its task;
  comparison content and private answers must never reach this channel.

- `sourceValue`: A silent highlight contributes no record, even to a surrounding recording. Reader
  and item identity never contributes to recorded content. Grammar 4 uses durable or runtime display
  IDs; keep authored names.

- `normalizeNarrationSourceContent`: Page-title text and unknown legacy fingerprints must survive
  writes intact.

- `derivedBlockScript`: The task is literal text; feedback narration awaits a learner-step target
  contract.

- `visit`: A whole-container clip/script cannot become an introduction after splitting.

- `segment`: Group membership uses parser IDs at runtime. Fingerprint the members' content so edits
  elsewhere cannot detach the group's introduction.

### `packages/shared-blocks/src/viewer/NarrationBar.tsx`

- `textRange`: Keep normalized character positions tied to original DOM offsets, including collapsed
  whitespace. Case-insensitive matching must not change their length.

- `closestBlock`: Returns null when the playlist item has no real block (page-title segments):
  callers that only need a search scope fall back to root, but the visual active-block marker must
  never land on root and stripe the whole page.

- `NarrationBar`: Keep the narration disclosure before grouped transport controls in both DOM and
  visual order. The accepted design dated 2026-08-31 puts Listen, Play, position and options in that
  order, with secondary controls disclosed inline at narrow widths and highlighting only during
  playback. The Guided shell decision dated 2026-10-01 gives sentence and Follow controls to the
  shell, retains speed inline and uses one shell-owned options disclosure. Pages retains Listen and
  inline narration options. Both Play entry points use the same command and reading protection.
  Rejected designs were a floating popover, hidden content after main, the full script in a live
  region, a missing-timings status and controls before Listen. The original record cited published
  Chromium and WebKit accessibility checks.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
