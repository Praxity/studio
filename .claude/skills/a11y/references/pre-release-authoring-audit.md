# Praxity Studio pre-release authoring accessibility audit

Use this runbook before a major release, before publishing or materially changing an
accessibility claim, and after a macOS, VoiceOver, browser, or preview-host upgrade.
For ordinary changes, run the smallest relevant tests instead of the full sequence.

The audit produces a dated evidence report and verified fixes. A clean scanner score is
not the goal.

Create the report's execution ledger before testing. Give every planned journey a row
for target, state, browser, engine, viewport, assistive technology, and status. Finish
with every row marked `tested`, `cantTell`, or `untested`, and record why each untested
row did not run.

## Safety and scope

- Read the canonical `/a11y` skill and `.claude/agents/screen-reader-tester.md` first.
- Freeze the build under review. Record Studio, preview host, macOS, browser, VoiceOver, UI
  language, and output-format versions from current evidence; never copy old values.
- Include Read and Edit mode, text controls, save/cancel/refusal recovery, help,
  embedded pane transitions, HTML export and SCORM export.
- Assess the thin canvas as browser UI. Assess embedded pane transitions in the actual host.
- Warn the user immediately before every VoiceOver run, because VoiceOver takes over
  speech, focus, and browser control. Use WebKit only, and quit VoiceOver after each run.
- Keep VoiceOver and mock-renderer specs under `/tmp`; do not commit them. Commit only
  deterministic regression tests that run reliably without live assistive technology.
- Preserve unrelated working-tree changes. Update public claims or publish a report only
  when the user authorizes it.

## Sequence

### 1. Establish the claim boundary

Read the latest dated ATAG/accessibility report and the current public claim. Check every
criterion name against the current normative source instead of copying an older VPAT
row.

ATAG 2.0 does not define Part-A-only conformance. Until a full matrix of the applicable
Part A and Part B criteria supports a formal level, use wording such as:

> Praxity Studio is being evaluated against ATAG 2.0 Part A, with a focus on
> making the authoring workflow usable by blind authors.

Primary sources:

- https://www.w3.org/TR/ATAG20/
- https://www.w3.org/TR/IMPLEMENTING-ATAG20/
- https://www.w3.org/WAI/atag/report-tool/
- https://developer.apple.com/design/human-interface-guidelines/accessibility/
- https://developer.apple.com/documentation/accessibility/performing-accessibility-testing-for-your-app

### 2. Inventory the release surface

Map each author-facing action before testing. Include at least:

- install/launch, welcome, create/open/switch workspace, and file navigation;
- editing, slash commands, search, pages, headings, blocks, and nested structure;
- each left/right panel, settings, preview, and return to the exact editing position;
- accessibility finding → editor repair → return to the same finding;
- media, narration, translation, design, undo/redo, save/reopen, and recovery;
- export/publish, errors, permissions, native file dialogs, updater, and app menus;
- English and French UI, long/malformed projects, and authored non-text/media states.

Also list every action that changes content. ATAG A.4.1.1 requires each change to be
immediately reversible or to ask for confirmation. Editor history alone is not evidence
for changes made by panels, stores, or frontmatter synchronizers.

### 3. Run deterministic release gates

Run from the repository root:

```sh
pnpm lint
pnpm typecheck
pnpm test:a11y:vpat
```

Confirm that the published-output suite actually ran Chromium, WebKit, and Firefox.
Classify each skip by its documented platform limitation, and never count a skip as a
pass. Use focused tests while fixing defects, then rerun the affected release gate.

When the release changes generated output, run Praxity Check against representative
exported HTML and SCORM runtime entries. Use named states for closed interactive content,
and an exact reviewed baseline when one exists. Report launcher shells, cross-origin
frames, and failed scenarios as `untested`, not as clean results.

### 4. Exercise blind-author keyboard journeys

Run the frozen renderer in Chromium and WebKit, then any supported embedded host. Test these
as continuous tasks, not isolated controls:

1. Launch or switch workspace → locate and open a file → enter the editor.
2. Jump among pages and heading levels → edit → return to navigation.
3. Invoke and operate slash commands without moving DOM focus away from the editor.
4. Move editor → left/right panel → editor with F6 and Shift+F6 in visual order.
5. Open a specific accessibility finding → repair it → return to that same finding.
6. Open settings from both a ribbon control and the editor → change a setting → return
   to the correct trigger or caret position.
7. Open preview → inspect content → return to the correct trigger or caret position.
8. Search, save/reopen, publish/export, recover from an error, and complete an update.

For every journey, record keyboard access, focus order, exact return point, accessible
name/role/value/state, status announcements, Escape behavior, and traps. Where macOS Full
Keyboard Access and VoiceOver Quick Nav change input, test each both on and off.

### 5. Inspect navigation and repeated speech

With VoiceOver on WebKit, inspect ordinary traversal and the rotor. Check Landmarks,
Headings, Links, Form Controls, and any other rotor menus the UI exposes. Look for:

- repeated labels or state words, especially visible text duplicated by `aria-label`;
- generic icon names, filenames without context, and silent current/expanded state;
- controls reached in a surprising order, and unreachable panel/editor boundaries;
- stale announcements after state changes, and focus entering inert/background UI;
- lost page, heading, tree parent/child, workspace, or issue identity.

Reload once before recording a first-load rotor anomaly. Capture the spoken phrase log
for a real failure. Correct ARIA without confirmed speech is structural evidence only.
It does not prove that VoiceOver announces the interaction well.

### 6. Review ATAG Part A criterion by criterion

Create a Yes / No / Not Applicable matrix with rationale and evidence for every item.
Verify at least:

- A.1: renderer WCAG accessibility and native macOS accessibility services;
- A.2: text/media alternatives and programmatic editing-view status indicators;
- A.3: keyboard access/traps, timing, static views, display independence, and preview;
- A.4: reversible content changes, reversible settings, and accessible feature help.

For blind-author productivity, also review the Level AA criteria for efficient keyboard
access, navigation by structure, complete text search, saved/platform preferences, and
documentation of all features. Automation supports the verdict but never decides it.

### 7. Record and close the audit

Create or update a dated evidence report. Maintainers: use the destination in `AGENTS.local.md`. Obtain consent before including participant information, and keep private evidence out of the public tree. Include:

- exact scope and environment;
- an execution ledger covering every planned journey and check;
- completed automated, keyboard, accessibility-tree, and VoiceOver evidence;
- each criterion assessment, N/A rationale, blocker, and confidence level;
- known evidence gaps, kept apart from known product failures;
- safe public wording, and any claim that must be withdrawn or delayed;
- test counts, skips, and links to committed regression tests.

Before a formal claim, run task-based sessions with blind VoiceOver authors and get an
independent review from an accessibility specialist. Record participants, tasks,
environment, assistance, failures, and limitations. Usability testing supports a
conformance claim but does not establish it.

Finally, quit VoiceOver, stop temporary servers, remove `/tmp` audit artifacts that
contain project data, run `git diff --check`, and report which changes remain
uncommitted. Keep reusable local tooling and unrelated user files.
