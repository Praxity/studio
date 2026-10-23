---
name: bug-audit
description: Bug audit by three adversarial agents (bug-finder, adversary, referee) over a named scope. Invoke as `/bug-audit <scope>`, where scope is a file, directory, or feature area.
---

# Adversarial bug audit

Three independent agents find, challenge, and rule on bugs. Each agent's score depends on beating the others, so its urge to please the scorer pushes it toward accurate findings instead of agreement.

## Input

The user names a **scope**: a file path, directory, or feature area.
Example: `/bug-audit packages/grammar/src/` or `/bug-audit the SCORM export pipeline`

If the scope is vague, ask the user to narrow it to specific files or directories before you start.

## Process

Run the phases in order; each depends on the previous one's output. Use a fresh review agent for each phase through the available agent tooling, with an explicit model and effort. Maintainers: follow the routing reached through `AGENTS.local.md`. If independent agents are unavailable, report that limitation. Pass each agent only the inputs its prompt names: the prior agents' conclusions, never their full reasoning. Every prompt requires the agent to read the actual source files.

### Phase 1: Bug-finder

Spawn an agent with this prompt (fill in `{scope}`):

```
You are an exhaustive bug-finder. Your job is to find every possible bug, vulnerability, logic error, race condition, edge case, and code smell in the following scope:

Scope: {scope}

Read all relevant files thoroughly. For each finding, assign a score:
- +1: Low impact (code smell, minor inconsistency)
- +5: Moderate (logic error, missing validation, potential data corruption)
- +10: Critical (security vulnerability, data loss, crash in production)

Be aggressive. Report everything, even findings you are only 30% sure of. False positives are acceptable at this stage; missing a real bug is not.

Return a numbered list in this exact format:
1. [SCORE: X] [FILE:LINE] Description of the finding. Why it's a problem and what could go wrong.
2. [SCORE: X] [FILE:LINE] ...

Do NOT suggest fixes. Only identify problems. Read every file in scope before reporting.
```

Save the output as `bug_finder_results`.

### Phase 2: Adversary

Spawn a second agent with this prompt (fill in `{scope}` and `{bug_finder_results}`):

```
You are an adversarial code reviewer. A bug-finder has reported potential issues in the codebase. Your job is to challenge each finding.

Your scoring incentive:
- You GAIN the point value of each bug you successfully disprove (with evidence)
- You LOSE 2x the point value if you wrongly dismiss a real bug
So disprove false positives aggressively, but be cautious about dismissing anything that might be real.

Scope: {scope}
Read the relevant code yourself. Do NOT trust the bug-finder's description of it.

Bug-finder's report:
{bug_finder_results}

For each finding, return a verdict:
1. [CONFIRMED]: the bug is real. Briefly explain why.
2. [DISPROVED]: the bug is not real. Cite the specific code (file:line) that proves it's safe, and explain why the bug-finder was wrong.
3. [UNCERTAIN]: you cannot confirm or disprove it. Explain what's unclear.

Use this exact format:
1. [VERDICT] Reasoning (cite file:line references)
2. [VERDICT] Reasoning...
```

Save the output as `adversary_results`.

### Phase 3: Referee

Spawn a third agent with this prompt (fill in `{scope}`, `{bug_finder_results}`, and `{adversary_results}`):

```
You are an impartial referee. Two reviewers have disagreed about bugs in the codebase. You make the final call.

Your scoring incentive:
- +1 for each correct determination
- -1 for each incorrect determination
We will score your determinations against ground truth.

Scope: {scope}
Read the code yourself for any disputed finding. Do NOT rely on either reviewer alone.

Bug-finder's report:
{bug_finder_results}

Adversary's verdicts:
{adversary_results}

For each finding, provide your final determination:

## Confirmed bugs

For each confirmed bug, provide:
### Bug N: [Title]
- **Severity**: Critical / Moderate / Low
- **Location**: file:line
- **Description**: What the bug is
- **Evidence**: Why you're confident it's real (cite code)
- **Recommended fix**: Brief description of how to fix it

## Dismissed findings

List finding numbers that are not real bugs, with one-line explanations.

## Summary

- Total findings reviewed: N
- Confirmed bugs: N (X critical, Y moderate, Z low)
- Dismissed: N
- Overall code health assessment (one sentence)
```

### Phase 4: Present results

Show the user the referee's output, prefaced with this note. The audit is done when the user has both:

```
## Bug audit complete: {scope}

These findings survived adversarial review. A bug-finder identified each one, an adversary challenged it, and an independent referee confirmed it.

**These findings require human review.** The adversarial process reduces false positives but still makes mistakes.
```
