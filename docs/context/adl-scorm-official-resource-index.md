# ADL SCORM Official Resource Index

**Last verified:** 2026-05-12
**Canonical page:** https://www.adlnet.gov/past-projects/scorm/#scorm-versions-and-resources

This file tracks the official ADL SCORM resources we should use for conformance hardening.
It intentionally does not vendor downloaded ZIPs. Add fixture files only after deciding
whether each asset should be committed, fetched on demand, or stored outside git.

## Scope Now

Use these resources for current Praxity export validation:

- SCORM 1.2
- SCORM 2004 4th Edition

SCORM 2004 3rd Edition export is supported; its separate official resource intake is deferred. Shared-schema validation currently uses the retained fourth-edition fixtures.

Defer these additional resources until the export roadmap needs them:

- SCORM to xAPI Wrapper
- xAPI SCORM Profile
- cmi5

## Conformance Evidence

ADL's acquisition guidance separates two acceptance signals:

- **Conformance:** error-free repeatable ADL conformance-suite logs for each content package.
- **Target DL System Verification:** evidence from the intended runtime/LMS that the content runs properly.

Apply that split in our tests:

- `test:scorm-adl` is for ADL-derived deterministic checks.
- `test:scorm-local` and `test:scorm-cloud` are compatibility/runtime checks.
- Do not market a package as SCORM conformant solely because it passes SCORM Cloud.

## SCORM 2004 4th Edition

Normative/spec resources:

- Technical Specification (4th Ed.) zip
- Testing Requirements / Conformance Requirements Version 1.1
- Compatibility Testing Resources:
  - Conformance Test Suite 1.1.1 zip
  - LMS Test Packages (4th Ed.) zip
  - Sample Run-time Environment 1.1.1 zip

Content examples:

- Bookmarking zip
- Data Model zip
- Manifest Basics zip
- Sequencing Essentials zip

Use in Praxity:

- Content package manifest/XSD validation
- SCORM 2004 data model vocabulary and bounds
- Importer/parser fixture coverage for official ADL packages
- Manual or scheduled conformance-suite release evidence

## SCORM 1.2

Normative/spec resources:

- Technical Specification (Version 1.2) zip
- Conformance Test Suite 1.2.7 zip
- Sample Run-time Environment 1.2.2 zip
- Official ADL SCORM API Wrappers zip
- SCORM 1.2 Content Package Examples zip

Use in Praxity:

- SCORM 1.2 manifest/XSD validation, with the known legacy XML namespace schema shim documented in `tests/adl-conformance.test.ts`
- Runtime vocabulary checks for `cmi.core.lesson_status`, score fields, interactions, objectives, and bookmarks
- `cmi.suspend_data` size enforcement at 4096 characters
- Importer/parser fixture coverage for official ADL packages
- Manual or scheduled conformance-suite release evidence

## Asset Intake Rules

Before adding an ADL asset to git:

- Record the source page and download date.
- Record filename, uncompressed size, ZIP size, and SHA-256.
- Prefer keeping large conformance suites out of git and fetching them into a cache directory.
- Prefer committing only small, stable sample manifests or extracted fixture subsets.
- Do not rewrite official fixture contents. If a compatibility shim is needed for a validator, apply it in test temp directories only.

Suggested local cache path:

```text
packages/export-pipeline/.adl-cache/
```

Keep the cache gitignored unless a fixture is intentionally promoted.

The machine-readable intake manifest is:

```text
packages/export-pipeline/tests/fixtures/adl/resources.json
```

Validate the inventory:

```bash
pnpm --filter @praxity/export-pipeline adl:intake
```

Download resources with confirmed `downloadUrl` values and record SHA-256 metadata:

```bash
pnpm --filter @praxity/export-pipeline adl:intake -- --download
```
