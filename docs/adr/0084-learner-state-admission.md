# 0084: Learner state admission and effect lifetime

## Status

Accepted. Records existing behavior; no executable change.

## Context

An observation, a proposed write and a confirmed write carry different authority.

## Decision

### `packages/shared-blocks/src/activity-effects.ts`

- `createActivityEffects`: Async admissions retain their activity generation; synchronous turns
  retain revision/intent. Both use this owner's external lifetime authority.

- `publish`: Visit activity order, rather than dirty-insertion order, on every resumed pass.

- `drain`: Local cancellation and receipts settle even after external ownership is lost. Receipts
  observe the entire synchronous command/effect turn.

- `append`: Internal continuations join the FIFO without invalidating their originating turn.

### `packages/shared-blocks/src/block-state-policy.ts`

- `filterPrivateSuspendData`: Filter private block answers from round trips through logic/deck
  custom state and older suspend records. Preserve unrelated bytes exactly when nothing private was
  removed.

### `packages/shared-blocks/src/choice-learner-state.ts`

- `prepareChoiceAssessmentState`: Only a deliberate write can sign state or archive a preceding
  submitted answer.

### `packages/shared-blocks/src/choice-state-facts.ts`

- `choiceGroupDefinitionIsValid`: Refuse lossy normalization; omitted mode retains the renderer's
  schema default.

### `packages/shared-blocks/src/learner-block-state.ts`

- `withLearnerStateAuthority`: Tracker state and reporting methods retain their admitted adapter and
  refuse writes after authority is revoked.

- `writeLearnerBlockState`: All learner writes retain the caller's authority, including across
  reentrant callbacks.

- `captureLearnerBlockState`: A session retains one admitted provider. Replacement can never
  redirect its writes.

- `read`: An absent device store reports unavailable before get. The host also catches failed reads
  and reports unavailable afterward; that transition cannot establish an empty store or authorize
  overwriting unread bytes.

- `write`: A saved receipt is also evidence of stored bytes, even if an injected set queued a newer
  edit. The session must not certify that newer draft with it.

### `packages/shared-blocks/src/learner-state.ts`

- `isChoiceContentSignature`: Persisted syntax must not load the material-hashing runtime.

### `packages/shared-blocks/src/logic/variable-store.ts`

- `persist`: A refused save must not certify progress or retry with the other keys removed.

### `packages/shared-blocks/src/self-check-consumers.ts`

- `dispatchSelfCheckEvent`: A reentrant listener cannot turn an old dispatch into a fresh learner
  effect.

- `dispatchSelfCheckEvent`: Cancellation still notifies UI observers, with a revoked write stamp.

- `requestSelfCheckFrame`: Scheduling captures authority once; callback delivery cannot borrow a
  later lifetime.

### `packages/shared-blocks/src/self-check-prompt.ts`

- `scalarSetting`: A future object-valued schema setting must not broaden this record.

### `packages/shared-blocks/src/self-check-session.ts`

- `initialize`: Every member has independent progress; one reentrant read cannot abandon siblings.

### `packages/shared-blocks/src/self-check-state.ts`

- `selfCheckContentRevision`: Comparison compatibility, independent of source/artifact revision and
  part order. Hash exact decoded Content: grammar already handles structural line endings and
  continuation indentation; authored whitespace and Unicode spelling can carry meaning.

### `packages/shared-blocks/src/write-distractors-session.ts`

- `write`: A missing receipt can mean execution without acknowledgement. Never infer an empty store
  from it on a subsequent revision change.

- `read`: Retry after an unacknowledged write observes the store again. An older confirmed receipt
  must not mask those newly read bytes in the reducer.

### `packages/shared-blocks/src/write-distractors-state.model.test.ts`

- `model oracle`: Keep the generated model oracle independent of production codecs, bounds helpers
  and comparison validators. Stage permissions come from the learning-patterns CONTRACTS.md stage
  table; stored fixtures supply independent admission classifications.

### `packages/shared-blocks/src/write-distractors-state.ts`

- `save`: A changed unencodable value retires the prior proposal. Its late receipt cannot certify
  that this newer text was saved.

- `reduceWriteDistractors`: Hold writes while the initial read is pending. Failed admission still
  permits an explicit learner discard, as required by the learning-patterns CONTRACTS.md admission
  and passive-restore table.

## Sources

The comments and corresponding implementations in the files named above at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. These record the existing rationale;
they are not new platform measurements or a new accessibility conformance claim.

## Consequences

Changes to these owners must preserve the stated behavior or replace this record with
the reason for changing it. Comment removal alone does not establish new browser or
assistive-technology evidence.
