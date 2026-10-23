---
name: fp-check
description: "Systematic false positive verification for security bug analysis with mandatory gate reviews. Source: Trail of Bits (https://github.com/trailofbits/skills)"
disable-model-invocation: true
---

# False Positive Verification

Systematically verify suspected security bugs to eliminate false positives, producing TRUE POSITIVE or FALSE POSITIVE verdicts with documented evidence.

## When to Use

- Verifying specific suspected vulnerabilities reported by scanners or reviewers
- Triaging security bug reports before investing in fixes
- Validating findings from automated security tools
- Confirming or disproving bugs found by the `/bug-audit` skill

## When NOT to Use

- Hunting for new bugs (use `/bug-audit` instead)
- General code review
- When no specific bug claim exists to verify

## Verification Workflow

### Step 0: Restate the Claim
Precisely document:
- Exact vulnerability claim
- Alleged root cause
- Supposed trigger conditions
- Claimed impact
- Threat model and privilege context
- Bug classification
- Execution and caller analysis

### Routing Decision
Determine verification depth:

1. **Standard Verification** — Linear checklist for clear, single-component bugs with straightforward data flow
2. **Deep Verification** — Task-based orchestration for ambiguous claims, cross-component paths, concurrency issues, or inconclusive findings

### Verification

Trace the complete data flow from input to impact. Check:
- Does the vulnerable code path actually execute?
- Is there upstream validation that prevents the issue?
- Are the preconditions for exploitation actually achievable?
- Does the claimed impact match the actual behavior?

### Verdict

For each finding, deliver:
- **TRUE POSITIVE** — The bug is real, with evidence
- **FALSE POSITIVE** — The bug is not real, with specific code citations proving safety

## Principles

- Pattern recognition alone is insufficient — trace complete data flows
- Do not skip verification for efficiency
- Unsafe-looking code is not automatically vulnerable — check upstream validation
- Similar vulnerabilities elsewhere do not prove this instance is vulnerable
- Do not overrate severity based on initial impressions

## Batch Processing

When handling multiple suspected bugs:
1. Restate all claims first (often collapses obvious false positives immediately)
2. Route each independently
3. Check for exploit chains combining individually-rejected findings
