# Research Before Implementation

Never mix research and implementation in the same pass. When a task requires decisions:

## Phase 1: Research
- Explore the codebase, read relevant files, check docs
- Compare approaches, identify trade-offs
- Output: a decision or plan with clear rationale

## Phase 2: Implementation
- Start with precise instructions from the research phase
- No exploratory reading — you already know what to do
- Focus on writing code, not discovering architecture

## Why this matters
Research artifacts (long file reads, multiple grep results, doc comparisons) consume context. If you research and implement in the same pass, by the time you're writing code, the early research has been compressed and you've lost the details you discovered.

## When to apply
- Adding a feature that could be implemented multiple ways
- Debugging a problem where the root cause is unknown
- Working with unfamiliar parts of the codebase

For simple, well-understood changes (typo fix, adding a field to an existing pattern), skip the research phase and just implement.
