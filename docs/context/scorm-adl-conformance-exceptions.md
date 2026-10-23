# SCORM ADL Conformance Exceptions

Track known gaps between Praxity's automated ADL-derived checks and full official ADL conformance-suite evidence.

The official suites and their licensed assets run in private CI. The workflow names below refer to that private CI checkout.

## Current Status

| Suite | Status | Reason | Evidence |
|---|---|---|---|
| SCORM 1.2 Conformance Test Suite 1.2.7 | Installer diagnostics workflow available | The official ADL suite is distributed as `CTS1_2_7STSetup.exe`, an InstallShield/MSI GUI-era installer. The readme requires Java 1.4.2-era browser/applet interaction and manual launch of the installed `TestSuite\main.htm`; it is not a headless CLI conformance runner. | `.github/workflows/scorm-adl-conformance.yml` uploads the summary, known exceptions, metadata, checksum log and deterministic `test:scorm-adl` log. `.github/workflows/scorm-adl-conformance-windows.yml` defaults to quiet installer diagnostics and uploads `summary.md`, `metadata.json`, `conformance-summary.json`, and the checksum and execution logs. ADL suite files, installer logs and inventories, and UI evidence stay in the run folder. |
| SCORM 2004 4th Edition Conformance Test Suite 1.1.1 | Installer diagnostics plus Manifest Tester CLI available | The official ADL suite is distributed as `SCORM.2004.4ED.TS.v1.1.1.exe`, an InstallShield/MSI GUI-era installer. The installed suite documents `java -jar adlvalidator.jar` as a command-line Manifest Tester utility, so the Windows workflow can run that official manifest/package check against a generated Praxity SCORM 2004 package. The CLI is run with Java 8; Java 17 fails before validation because the old tool references Java applet-era DOM classes. Full official suite passage still requires driving the installed browser/Java runtime test UI and preserving its generated reports. | `.github/workflows/scorm-adl-conformance.yml` uploads the summary, known exceptions, metadata, checksum log and deterministic `test:scorm-adl` log. `.github/workflows/scorm-adl-conformance-windows.yml` defaults to quiet installer diagnostics, runs the SCORM 2004 Manifest Tester CLI when enabled, and uploads `summary.md`, `metadata.json`, `conformance-summary.json`, the checksum and execution logs, and validator output. ADL suite files, installer logs and inventories, and UI evidence stay in the run folder. |
| ADL public asset downloads | External cache used | ADL public download availability has been unreliable from local/CLI contexts. Normal conformance workflows use a pinned private CI asset snapshot instead of downloading from ADL during the run. | `packages/export-pipeline/tests/fixtures/adl/resources.json` records the pinned asset repo tag and commit. |

## Review Rules

- Do not claim official SCORM conformance from `test:scorm-adl` alone. It is an ADL-derived deterministic gate, not the full official ADL conformance suite.
- Treat `.github/workflows/scorm-adl-conformance.yml` as conformance evidence preparation.
- For `.github/workflows/scorm-adl-conformance-windows.yml`, review `summary.md` for the human-readable claim status and `conformance-summary.json` for the structured evidence record before citing a run.
- Use `docs/context/adl-scorm-ui-suite-runbook.md` when collecting browser/Java UI suite evidence.
- Treat `manualUiEvidenceResults.status=captured` as a summary of runner-local manual evidence only. Hosted artifacts exclude the evidence files; review the ADL-generated summary/detailed logs from a private local run before making a conformance claim. Prefer `inputType=asset-path` for release evidence because it is reproducible from the private CI asset snapshot. Treat `manualUiEvidenceResults[].evidenceManifest` as selected metadata, not an independent validator. Operator and notes stay private; deviations appear only as a count.
- Treat a passing SCORM 2004 Manifest Tester section as official ADL manifest/package CLI evidence only. It does not prove full SCORM 2004 runtime conformance.
- Treat `.github/workflows/scorm-adl-conformance-windows.yml` as official executable evidence only after the ADL tools install or execute successfully. Full UI suite conformance additionally requires completing the installed browser/Java test UI and reviewing its ADL-generated reports/logs from a private local run.
- Update this file whenever a manual official suite run passes, fails, or gains a documented exception.
- Keep artifacts for release-gate runs long enough to support the release decision.
