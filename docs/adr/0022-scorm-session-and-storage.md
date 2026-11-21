# 0022: SCORM session and storage

## Status

Accepted. Records existing behaviour without changing executable code.

## Context

Exported courses run in browsers and LMS frames with different loading, focus and storage constraints. These rules preserve the reasons recorded beside the implementation before comment removal.

## Decision

- Use URL construction to validate activity IRIs. LMS browsers older than Safari 17 and Chrome 120 lack URL.canParse. Governed code: `packages/export-pipeline/src/scorm/activity-id.ts`, `isAbsoluteIri`.

  Evidence: [MDN Browser Compat Data, URL.canParse support](https://github.com/mdn/browser-compat-data/blob/main/api/URL.json) records Safari 17 and Chrome 120 as the first supported versions.

- Shared SCORM API discovery for the runtime bundle and published viewer. LMSs normally expose their API on a parent or opener window rather than on the SCO itself. Keep that traversal in one place so detection cannot drift between runtime initialization and accessibility resume handling. Governed code: `packages/export-pipeline/src/scorm/api-discovery.ts`, `findWindowProperty`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Discover only the API required by the package. LMS compatibility aliases do not identify the package version and cannot substitute for its required API. Governed code: `packages/export-pipeline/src/scorm/api-discovery.ts`, `findScormApi`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- SCORM has no attempt identifier. Keep an opaque token in its existing custom state, shared across documents and resume; it contains no block data or flags. Both adapters share this owner without adding it to the session support bundle. Governed code: `packages/export-pipeline/src/scorm/api/device-attempt.ts`, `deviceAttemptId`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- An explicit launch without registration cannot inherit a previous attempt. Governed code: `packages/export-pipeline/src/scorm/api/device-attempt.ts`, `resolveLaunchAttempt`.

- Resolve against the LMS each time: other document adapters can append objectives. Governed code: `packages/export-pipeline/src/scorm/api/objective-slots.ts`, `writeObjectiveId`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- An unknown slot could own this id. Never guess and overwrite another group. Governed code: `packages/export-pipeline/src/scorm/api/objective-slots.ts`, `writeObjectiveId`.

- LMS pages served over HTTP lack randomUUID, but still expose getRandomValues. Governed code: `packages/export-pipeline/src/scorm/api/runtime-uuid.ts`, `runtimeUuid`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- SCORM 1.2's 101 is a general exception, not proof of an active session. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `initialize`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Set initial status to "incomplete" if the LMS hasn't already set a terminal status. Without this, SCORM Cloud auto-marks the registration as COMPLETED when the session terminates without an explicit status. Unreadable progress must also stay incomplete to avoid that default. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `initialize`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- A failed or thrown Finish leaves LMS state uncertain. Close before calling it. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `terminate`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Suspend history can include refused rows; prefer the LMS's accepted count. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `trackInteraction`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- ADL 1.2 choice tokens are single characters; performance permits readable labels. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `trackInteraction`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- A page can complete before an assessment submits in the same save. Transfer status after its score; Cornerstone locks transcript score at completion. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `flushCompletion`.

- Persist the attempt across a window close; page navigation only commits. A failed attempt stays suspended so the learner can resume it and retry toward the pass mark. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `prepareExit`.

- String() guards against LMS implementations that return numbers. Governed code: `packages/export-pipeline/src/scorm/api/scorm12.ts`, `throwIfError`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Terminate failure leaves LMS state uncertain, so no caller may retry. Governed code: `packages/export-pipeline/src/scorm/api/scorm2004.ts`, `terminate`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Keep immediate course decisions, but send status after the save's score and success values. Cornerstone locks transcript score when completion arrives. Governed code: `packages/export-pipeline/src/scorm/api/scorm2004.ts`, `flushCompletion`.

- ADL RTE: suspended exit preserves the attempt and yields entry=resume. With a pass mark, keep the attempt open until it is passed so the learner can finish or retry. Governed code: `packages/export-pipeline/src/scorm/api/scorm2004.ts`, `prepareExit`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- An accepted ID consumes the row, even if a later reporting field fails. Governed code: `packages/export-pipeline/src/scorm/api/scorm2004.ts`, `trackInteraction`.

- RTE 4.1.1.7: a time zone designator requires fractional seconds (at most two digits). Governed code: `packages/export-pipeline/src/scorm/api/scorm2004.ts`, `trackInteraction`.

- ADL uses the last cumulative session time, never the sum of intermediate writes. Governed code: `packages/export-pipeline/src/scorm/api/session-time.ts`, `sessionTime`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- CMITimespan has at most four hour digits. Preserve a valid value at its ceiling. Governed code: `packages/export-pipeline/src/scorm/api/session-time.ts`, `sessionTime`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- SCORM 1.2 RTE 3.3.3: 301; 2004 RTE 3.1.7.2.8: 122. Only "not initialized" proves that a persistent API has started another launch. Governed code: `packages/export-pipeline/src/scorm/api/session.ts`, `resetSessionState`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Non-extensible API objects share the record on the LMS window instead. Governed code: `packages/export-pipeline/src/scorm/api/session.ts`, `storeSessionState`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- ADL SCORM 2004 4th edition RTE 3.1.7.4.1 and 4.2.23 distinguish General Get Failure (301) from an unset suspend value (403). SCORM 1.2 RTE 3.3 / 3.4.4 requires LMSGetLastError to distinguish an empty value from a failed LMSGetValue. Check before another API call. Governed code: `packages/export-pipeline/src/scorm/api/suspend-data-reader.ts`, `read`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- xAPI (Experience API / Tin Can) runtime wrapper. Unlike SCORM 1.2 and 2004, xAPI does not use a window-injected API object. Instead, it sends JSON statements to a Learning Record Store (LRS) via HTTP. The LRS endpoint and authorization credentials are configured at build time. Actor identity is resolved either from LMS launch context (`actorMode: "lms"`) or from build-time config (`actorMode: "manual"`). Local state (bookmarks, visited pages, interactions, suspend data, completion and success) is kept in memory and, when a course ID is given, persisted to localStorage per course and learner, because the xAPI spec does not prescribe a bookmarking or suspend-data mechanism and each course page creates a new runtime. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `XapiRuntime`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Some LMS frames block Web Storage; even reading the property can throw. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `browserStorage`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Persist only for an identified learner so two learners never share one saved state. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `XapiRuntime`.

- POST a statement to the configured LRS endpoint. Failures are logged but never thrown -- the LRS may be unreachable when the learner is offline. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `sendStatement`.

- xAPI permits 409 for an already-stored statement with the same ID. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `sendStatement`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- The LMS passes the actor only on the launch URL; later course pages carry it forward in this tab's sessionStorage. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `resolveLaunchActor`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- xAPI Data 2.4.2.1: the Agent name is optional; mbox identifies the learner. Governed code: `packages/export-pipeline/src/scorm/api/xapi.ts`, `resolveLaunchActor`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Budget the SCORM 2004 localized_string_type smallest permitted maximum separately from its optional language delimiter. Governed code: `packages/export-pipeline/src/scorm/interaction-description.ts`, `interactionDescription`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Omit the argument for unprefixed text; an empty language requests SCORM's default. Governed code: `packages/export-pipeline/src/scorm/interaction-description.ts`, `interactionDescription`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Explicit default language also shields authored delimiter syntax. Governed code: `packages/export-pipeline/src/scorm/interaction-description.ts`, `interactionDescription`.

- Restricted browser contexts can deny the accessor itself. Keep the host operational without persistence so navigation still receives runtime-ready. Governed code: `packages/export-pipeline/src/scorm/local-storage-runtime.ts`, `LocalStorageRuntime`.

- Reads and legacy migration can fail before Initialize. Start a fresh in-memory attempt; failed migration leaves the stored legacy data intact. Governed code: `packages/export-pipeline/src/scorm/local-storage-runtime.ts`, `readState`.

- Learner interaction must remain usable when storage is full or the bounded state serializer rejects an oversized update. Governed code: `packages/export-pipeline/src/scorm/local-storage-runtime.ts`, `updateState`.

- Reserve room before choosing the codec, so the allowance cannot trigger a false overflow immediately below the runtime's compression threshold. Governed code: `packages/export-pipeline/src/scorm/scorm12-storage.ts`, `estimateScorm12Storage`.

- Repeated placeholder text compresses far more than a learner's open answer. Keep the existing non-choice warning budget when choices enable compression. Governed code: `packages/export-pipeline/src/scorm/scorm12-storage.ts`, `estimateScorm12Storage`.

- CRC-32/ISO-HDLC, also used by gzip and ZIP. fflate 0.8.3 has no public CRC export. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `CRC32_TABLE`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Dictionary tokens mirror learner-state signature syntax; update when that format changes. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `EVIDENCE_TOKEN`.

- Dictionary bytes stay outside DEFLATE; only shapes and references are compressed. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `encodeEvidence`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- UTF-8 has no representation for a lone surrogate. Keep tag 5 for valid strings. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `encodeEvidence` and `decodeEvidence`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Allocate from the checked declaration, never the untrusted DEFLATE stream. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `decodeEvidence`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- fflate accepts bytes after DEFLATE's end. A complete stream must need its last byte. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `decodeEvidence`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Removing the last DEFLATE byte normally makes the stream incomplete. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `decodeEvidence`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Tag 5 retains its original, valid UTF-8 meaning. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `encodeEvidence` and `decodeEvidence`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Tag 9 stores UTF-16 code units in big-endian order, including lone surrogates. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `encodeEvidence` and `decodeEvidence`.

- Choice answers repeat option IDs. Preserve the existing opaque custom-data and self-check size contracts for envelopes without choice state. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `serializeScorm12SuspendData`.

- Cover unused DEFLATE padding bits as well as changes in decoded data. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `serializeScorm12SuspendData`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- One extra byte detects output beyond the declared length without unbounded allocation. fflate does not verify the zlib trailer's Adler-32. Governed code: `packages/export-pipeline/src/scorm/scorm12-suspend-data.ts`, `parseScorm12SuspendData`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Completion follows the page rule; pass/fail follows the score. Runtimes with a separate success status report both. SCORM 1.2 has one status, and "completed" would end the attempt before a result exists, so it stays "incomplete" until the course has a final failure, or passes with the page rule met. Governed code: `packages/export-pipeline/src/scorm/tracking.ts`, `outcome`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- A partial authored score would let the LMS judge pass/fail early. Governed code: `packages/export-pipeline/src/scorm/tracking.ts`, `outcome`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

- Success first, so a completion report carries the current result. Reporting it on every check also tells the runtime a pass mark is active (see SCORM 2004 exit). Governed code: `packages/export-pipeline/src/scorm/tracking.ts`, `outcome`.

  Evidence: the code comment this replaced (commit bed54f6); not independently verified.

## Consequences

Preserve these constraints when changing the named owners. A replacement needs the same output, failure handling and platform coverage.

Source: the named source files at commit bed54f6, before this cleanup. SCORM requirements are indexed in [SCORM and xAPI standards](../context/scorm-xapi-standards.md); delivery and accessibility decisions are recorded in [published output runtime](../context/published-output-runtime.md).
