# Frozen SCORM learner state

`scorm-learner-state.json` contains synthetic LMS fields, captured by calling the
current SCORM adapters and `createBlockStateRuntime` at Studio `08a6a0d8d`,
with the privacy input seeded as described below.
`scorm-runtime-contract.test.ts` restores these literal strings with the existing
strict LMS APIs and compares with independently written literal results. Tests
never generate their expected input by calling the encoder.

Capture recipe for both adapters, with `Date.now()` fixed to `1800000000000`:

- Bookmark: `setBookmark("page-feedback")`.
- Visit: visit `page-intro`, `page-practice`, then `page-intro` again.
- Answer: submit `question`, `choice-a`, incorrect, 40, attempt 1 of 2; save its
  block state `{answer: "choice-a", submitted: true}`.
- Retry: submit `quiz`, `choice-a`, incorrect, 40, attempt 1 of 2, member
  `question`; advance the clock by 1000 ms; submit `choice-b`, correct, 100,
  attempt 2 of 2 with the same membership.
- Privacy: the captured reported interaction and block state are retained. Seed
  a synthetic device-owned `journal` interaction and block state containing
  `SYNTHETIC PRIVATE` into the LMS envelope, modeling old or untrusted data.
  Restore with policy `{journal: "device", reported: "lms"}` through
  `createPrivateBlockStateRuntime`; device records must be excluded from reads
  and removed from the LMS envelope after saving reported state.
- Current format without attempt fields: a synthetic supported envelope with
  `legacy-page`, one incorrect `legacy-question` answer at `1600000000000`, and
  answer block state. It claims no historical format or epoch. The runtime has no
  learner-state epoch; strict envelope equality after a later save guards against
  introducing epoch or attempt metadata.

Only bookmark and suspend fields are retained. In SCORM 1.2 custom block state is
an escaped JSON string within the suspend envelope; SCORM 2004 stores it directly.
Neutral interactions omit correctness and score. These distinctions are frozen.
Existing privacy-routing, learner isolation and retry behavior tests remain in
their current owners alongside these byte fixtures.
