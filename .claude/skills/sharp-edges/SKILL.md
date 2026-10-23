---
name: sharp-edges
description: "Identify error-prone APIs, dangerous configurations, and footgun designs that enable security mistakes. Source: Trail of Bits (https://github.com/trailofbits/skills)"
disable-model-invocation: true
---

# Sharp Edges Analysis

Identifies insecure API designs where developer misuse is easy and secure usage requires special knowledge or effort. The core principle: **secure usage should be the path of least resistance.**

## When to Use

- Reviewing API designs for security footguns
- Evaluating library or framework configuration surfaces
- Auditing cryptographic API usage
- Checking for dangerous defaults in dependencies
- Reviewing security-critical configuration options

## Key Sharp Edge Categories

### Algorithm/Mode Selection Footguns
Letting developers choose cryptographic primitives. Example: JWT `alg` header allowing `"none"` to bypass signatures.

### Dangerous Defaults
Zero or null values with ambiguous semantics. A timeout of `0` might mean infinite or immediate — the ambiguity itself is dangerous.

### Primitive vs. Semantic APIs
Exposing raw bytes instead of meaningful types. When a function accepts `bytes` for both nonces and keypairs, developers can swap them without type errors.

### Configuration Cliffs
A single wrong setting creates catastrophic failure silently. A boolean flag disabling security entirely.

### Silent Failures
Functions returning booleans instead of throwing exceptions on verification failures. Developers forget to check return values.

### Stringly-Typed Security
Security-critical values stored as plain strings, enabling injection and confusion attacks.

## Analysis Workflow

1. **Identify** security-relevant APIs and choice points
2. **Probe** edge cases (especially zero/empty/null values)
3. **Threat model** three adversary types:
   - Malicious developer (intentional misuse)
   - Lazy developer (skips documentation, copies examples)
   - Confused developer (misunderstands semantics)
4. **Validate** findings through reproducible misuse demonstrations

## Rationalizations to Reject

- "The documentation explains the correct usage" — documentation cannot excuse unsafe design
- "It's configurable, not a bug" — configuration options are code and must be validated
- "We need backwards compatibility" — backwards compatibility cannot justify insecure defaults
- "Developers should know better" — blame-shifting from API designers to users
