---
name: differential-review
description: "Security-focused differential review of code changes with git history analysis and blast radius estimation. Source: Trail of Bits (https://github.com/trailofbits/skills)"
disable-model-invocation: true
---

# Differential Security Review

Security-focused code review methodology for analyzing PRs, commits, and diffs. Emphasizes risk-driven analysis backed by evidence, scaling effort based on codebase size.

## When to Use

- Reviewing PRs for security implications
- Analyzing commits before merging
- Pre-deployment security review of changes
- Evaluating blast radius of code modifications

## Core Principles

1. **Risk prioritization** — Focus on authentication, cryptography, value transfers, external calls
2. **Evidence-based findings** — Connected to git history, specific line numbers, realistic attack scenarios
3. **Adaptive depth** — Calibrated to codebase scale
4. **Transparent limitations** — Acknowledge coverage boundaries and confidence levels
5. **Artifact generation** — Produce comprehensive markdown reports

## Codebase Size Mapping

- **Small (<20 files):** Deep analysis with complete dependency tracing
- **Medium (20-200 files):** Focused approach targeting priority files
- **Large (200+ files):** Surgical analysis concentrating on critical paths

## Risk Classification

### HIGH
- Authorization systems
- Cryptographic operations
- External integrations
- Fund/value transfers
- Validation logic removals

### MEDIUM
- Business logic changes
- State modifications
- New public interfaces

### LOW
- Documentation
- Test additions
- UI changes
- Logging enhancements

## Workflow

**Phase 0** — Triage and risk classification
**Phase 1** — Code analysis of changed files
**Phase 2** — Test coverage evaluation
**Phase 3** — Blast radius calculation
**Phase 4** — Contextual deep-dive
**Phase 5** — Adversarial threat modeling
**Phase 6** — Report generation

## Escalation Triggers

These patterns demand immediate investigation:
- Removed code from security-focused commits
- Stripped access control modifiers
- Eliminated validation without replacement
- Changes affecting 50+ downstream callers

## Anti-Patterns to Avoid

1. Assuming small changes cannot introduce vulnerabilities
2. Assuming codebase familiarity prevents blind spots
3. Assuming refactoring carries no security implications
4. Skipping blast radius analysis for "simple" changes
5. Trusting that test coverage equals security coverage
6. Dismissing findings because "it worked before"
7. Assuming the PR description accurately reflects all changes
