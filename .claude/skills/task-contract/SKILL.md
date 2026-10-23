---
name: task-contract
description: Task contract for non-trivial work. Records acceptance criteria before implementation and verifies every criterion before calling the task done.
---

# Task contract

A contract record holds specific, testable acceptance criteria. Verify every criterion before you claim the task is complete. Keep the record in the PR or a local task record so it survives context compaction.

Use one for any non-trivial task: new features, bug fixes spanning multiple files, refactors, or any work that could take more than a few minutes. Write one contract per task, and keep unrelated work in separate contracts.

## Create the contract

1. **Settle the task.** Take it from the user's request or the current plan. If it is ambiguous, ask the user to clarify before writing the contract.
2. **Write the contract** in the PR description or a local task record with a kebab-case task name. Maintainers: use the planning destination in `AGENTS.local.md`. Keep private context out of public records. Use this structure:

```markdown
# Contract: {Task Title}

**Created**: {date}
**Status**: In progress

## Objective

{One sentence describing what we're trying to achieve.}

## Acceptance criteria

- [ ] {Specific, testable criterion 1}
- [ ] {Specific, testable criterion 2}
- [ ] {Specific, testable criterion 3}
- [ ] Required checks pass; any test replaced under the test rule is named with its reason
- [ ] Required lint and typechecks pass
- [ ] Every exemption, skip or blocked check is recorded

## Verification steps

1. Run `/verify-and-ship` checks, including `pnpm test:affected` for code changes
2. Run the change-specific gates in `docs/context/testing-strategy.md`
3. Record results and any docs-only exemption; the merge candidate requires full CI
4. {Task-specific verification step}
5. {Task-specific verification step}

## Files to modify

- `{path/to/file}`: {what changes}

## Rules

- **Test rule**: If tests fail, fix the implementation. Edit an existing test only to replace one that checks internals with an interface test covering the same behaviour, and name it in this contract.
- Do not consider this task complete until every acceptance criterion is checked off.
- If requirements change, update this contract first.
```

3. **Track it.** Track each acceptance criterion with the available task tooling.
4. **Announce it** to the user:

```
Contract recorded for {task-name} with {N} acceptance criteria.
```

## During implementation

- After context compaction, re-read the contract record from the PR or local record to recover the acceptance criteria.
- If the requirements need to change, update the contract record first and tell the user.
- If tests fail, fix the implementation. Follow the contract's test rule for any test you replace.

## Complete the contract

Finish every step below before you claim the task is done.

1. **Run** the checks required by `/verify-and-ship` and the task, and read the output. Code changes run `pnpm test:affected`; the merge candidate runs the full CI gate. A pass you did not observe does not count. Record docs-only exemptions and checks blocked by the environment explicitly.
2. **Walk every criterion.** For each one, state it, give evidence that it is met (test output, code reference, or demonstration), and check it off in the contract record. If a criterion cannot be met, explain why and get the user's approval before changing the contract. Skip none.
3. **Report** to the user in this format. Retain the contract record and verification in the PR or local task record.

```
## Contract fulfilled: {Task Title}

All {N} acceptance criteria verified:
- [x] {criterion 1}: {brief evidence}
- [x] {criterion 2}: {brief evidence}
...

Verification: {commands, observed results and checks not run}
```
