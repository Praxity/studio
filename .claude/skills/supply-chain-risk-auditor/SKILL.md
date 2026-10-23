---
name: supply-chain-risk-auditor
description: "Audit supply-chain threat landscape of project dependencies for exploitation or takeover risk. Source: Trail of Bits (https://github.com/trailofbits/skills)"
disable-model-invocation: true
---

# Supply Chain Risk Auditor

Assess dependency vulnerabilities and identify high-risk components within a project's supply chain ecosystem.

## When to Use

- Pre-audit dependency risk assessment
- Supply chain attack surface evaluation
- Identification of unmaintained or problematic dependencies
- Security engagement scoping

## When NOT to Use

- Active vulnerability scanning (use npm audit, pip-audit instead)
- Runtime dependency analysis
- License compliance review

## Risk Assessment Criteria

Dependencies receive high-risk classification based on:

### Single Maintainer Vulnerability
Projects relying on individual developers without organizational backing present elevated takeover risk. Anonymous maintainers significantly increase risk.

### Maintenance Status
Stale projects (extended update gaps) or explicitly archived repositories face delayed vulnerability patching. Unaddressed bug reports signal abandonment.

### Popularity Metrics
Limited GitHub stars or download volume correlates with reduced code review coverage and slower malicious code detection.

### High-Risk Capabilities
Dependencies featuring FFI, deserialization, or third-party execution warrant heightened scrutiny due to inherent exploitation vectors.

### Historical CVEs
Past critical vulnerabilities, particularly in disproportionate quantities relative to project scope.

### Security Reporting Absence
Missing security contact information impedes responsible vulnerability disclosure.

## Operational Process

### Phase 1: Setup
- Establish workspace directory
- Initialize results report
- Catalog direct dependency repositories
- Normalize entries to standardized URL format

### Phase 2: Evaluation
- Apply risk criteria systematically using `gh` CLI tooling
- Verify all cited metrics (star counts, issue volumes) through automated queries
- Populate high-risk dependencies table with flagged items
- Exclude low-risk dependencies from reporting

### Phase 3: Synthesis
- Identify superior alternatives for flagged dependencies
- Generate risk factor category counts
- Deliver executive summary and actionable recommendations
