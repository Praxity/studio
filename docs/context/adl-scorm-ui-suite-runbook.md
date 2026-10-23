# ADL SCORM Browser/Java UI Suite Runbook

Use this runbook when collecting evidence for full official ADL SCORM conformance-suite passage beyond the automated installer and SCORM 2004 Manifest Tester CLI evidence.

The official suites and their licensed assets run in private CI. The workflow and script names below refer to that private CI checkout.

## Current Automation Boundary

`.github/workflows/scorm-adl-conformance-windows.yml` verifies the pinned ADL asset snapshot, installs the official SCORM 1.2 and SCORM 2004 Windows suites, runs the official SCORM 2004 Manifest Tester CLI when enabled, and uploads `summary.md`, `metadata.json`, `conformance-summary.json`, and the checksum, execution and validator logs. `scripts/scorm-adl-conformance-windows.ps1` also collects installed entrypoints, any ADL UI-generated log directories that already exist, and any operator-provided ADL UI evidence directory passed through `manual_ui_evidence_dir` or `manual_ui_evidence_asset_path` into the run folder. Those are ADL files or private test assets, so the workflow never uploads them. Review them from a private local run.

The workflow does not drive the browser/Java UI suite. A passing hosted workflow run proves the selected automated path only. Full SCORM 1.2 or SCORM 2004 conformance-suite passage requires completing the installed ADL UI suite and reviewing its summary/detailed logs from a private local run. Hosted summaries describe runner-local evidence; the uploaded reports do not include it.

## Entrypoints

After a successful Windows `install` mode run, use these installed entrypoints:

| Suite | Entrypoint | Runner-local generated log locations |
|---|---|---|
| SCORM 1.2 Conformance Test Suite 1.2.7 | `installed/scorm12/TestSuite1_2_7/TestSuite/main.htm` | `installed/scorm12/TestSuite1_2_7/TestSuite/LMSRTE/tempdir/LMSLogs/` and `installed/scorm12/TestSuite1_2_7/TestSuite/metadata/tempdir/MDLogs/` |
| SCORM 2004 4th Edition Conformance Test Suite 1.1.1 | `installed/scorm2004-4th/SCORM_2004_4th_Ed_TS_V1.1.1/TestSuite/main.htm` | `installed/scorm2004-4th/SCORM_2004_4th_Ed_TS_V1.1.1/TestSuite/Logs/LMS/`, `Logs/CP/`, and `Logs/SCO/` |

The script also copies those entrypoints and readme pages into the run folder's `adl-ui-evidence/` so reviewers can find the exact suite UI files.

## Manual Evidence Procedure

1. Run `scripts/scorm-adl-conformance-windows.ps1` privately on a Windows machine at the target branch, using the same asset snapshot and settings as `ADL SCORM Conformance Windows`:
   - `suite=both`
   - `mode=install`
   - `asset_ref=scorm-adl-2026-05-12`
   - `run_scorm2004_validator=true`
   - `strict=true`

2. In the run folder, confirm:
   - `summary.md` says installers passed.
   - `conformance-summary.json` has `scorm2004ManifestTester.status` set to `passed`.
   - `logs/installed-files.txt` lists the SCORM 1.2 and SCORM 2004 `main.htm` entrypoints.

3. In a Windows environment compatible with the installed ADL suite, open the appropriate `main.htm` entrypoint and follow ADL's on-screen instructions for the selected suite area.

4. For each completed ADL UI test area, preserve:
   - ADL Summary Log.
   - ADL Detailed Log.
   - Any generated timestamped folder under the log locations listed above.
   - A short operator note identifying suite, test area, package under test, result, timestamp, and any deviations.

5. Re-run so the generated log directories are included under `adl-ui-evidence/`. The script captures installed-suite log directories automatically when they exist.

6. Prefer storing completed UI evidence under private CI asset storage using a dated path, for example `SCORM/evidence/adl-ui/2026-05-12/<run-or-release>/`. Set `ManualUiEvidenceAssetPath` to that repo-relative directory in the private local run. The script copies it to the runner-local `adl-ui-evidence/manual-provided-from-assets/`, records `manualUiEvidenceResults` in `conformance-summary.json`, and adds an `Operator-Provided ADL UI Evidence` section to `summary.md`. A hosted dispatch with the equivalent input uploads the reports only; review the evidence through the private local run.

7. If the completed UI logs are already available as a local directory, pass `ManualUiEvidenceDir` pointing to that directory instead. Provide either `ManualUiEvidenceDir` or `ManualUiEvidenceAssetPath`, not both.

8. Add an `evidence-manifest.json` file at the root of the private evidence directory when possible. The script surfaces selected fields in `manualUiEvidenceResults.evidenceManifest` and `summary.md`. Operator and notes remain private; deviations appear only as a count in the reports.

Example `evidence-manifest.json`:

```json
{
  "suite": "scorm2004-4th",
  "testArea": "content-package",
  "result": "passed",
  "packagePath": "packages/export-pipeline/test-course-scorm2004.zip",
  "completedAt": "2026-05-12T22:00:00Z",
  "operator": "github-handle-or-initials",
  "deviations": [],
  "notes": "ADL UI summary and detailed logs are included in this directory."
}
```

The marker scan is review triage only. `captured` means the directory was attached and no obvious failure/error markers were found in common text log formats. `captured-with-failure-markers` means at least one attached text file contains words such as fail, failed, error, or exception and must be reviewed manually. Neither status independently proves full ADL UI suite passage.

## Claim Wording

Use precise wording:

- Passing SCORM 2004 Manifest Tester means the generated package passed ADL's official SCORM 2004 manifest/package CLI check for that run.
- Passing installer diagnostics means the ADL suite installers completed and entrypoints/log locations were captured.
- Operator-provided UI evidence means completed manual ADL browser/Java suite logs were summarized; the evidence stays runner-local and reviewers must inspect it from a private local run.
- Full official ADL suite passage requires completed ADL browser/Java UI test execution and private review of the ADL-generated summary/detailed logs.

Do not use `test:scorm-adl`, SCORM Cloud, installer success, or Manifest Tester success alone as a claim of full official SCORM conformance.
