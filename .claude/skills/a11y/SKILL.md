---
name: a11y
description: "Accessibility entry point: operating principles, evidence rules, browser and screen-reader testing process, and routing to the specialist agents. Invoke before any a11y task: building or reviewing a component, auditing a page, running the a11y suite, writing an audit report, or checking VPAT/ACR claims."
---

# Accessibility entry point

This is the only a11y entry point. It sets how every accessibility agent works, tests, gathers evidence and reports findings, and which specialist to consult. The specialist agents in `.claude/agents/` hold the detailed guidance; this file holds the process.

Everything below applies to any project except **§0 Project bindings**. To reuse it in another HTML or eLearning project, copy `.claude/skills/a11y/`, `.claude/agents/*`, and the a11y checklist, then rewrite §0.

---

## §0 Project bindings

This is the only project-specific section. Replace all of it when porting.

| Binding | This project |
|---|---|
| Detailed rule checklist | `docs/rules/a11y-checklist.md` |
| Published-output a11y suite | `pnpm --filter @praxity/export-pipeline test:a11y` |
| VPAT claim validation | `pnpm test:a11y:vpat` (runs the published-output a11y suite) |
| On-demand pre-release Studio/ATAG audit | `references/pre-release-authoring-audit.md`; invoke `/a11y pre-release` |
| Suite config (engines, fixtures) | `packages/export-pipeline/tests/a11y/playwright.config.ts` |
| In-editor checker rules | `packages/editor-core/src/lib/a11y/checker.ts` |
| Checker rule metadata (category, severity, fix domain) | `packages/editor-core/src/lib/a11y/rule-metadata.ts` |
| Rule-coverage test (must trigger every rule) | `packages/editor-core/src/lib/a11y/__tests__/checker-integration.test.ts` |
| Rendered-output package scan | Praxity Check against the exported folder or ZIP; use the command documented by the installed Check version. Maintainers: see `AGENTS.local.md` for local setup. |
| Praxity Check evidence contract | Use the report schema shipped with the Check version under test. |
| Conformance target | WCAG 2.2 AA (AODA); AAA readability for learner content |
| Authoring-tool scope | Apply ATAG 2.0 Parts A and B to Studio. Record the criterion, level, applicability, and evidence for each item. Choose a formal conformance level as a separate decision. |
| ATAG conformance target | ATAG 2.0 AA for Parts A and B. Before making a claim, define which output technologies and workflows it covers. AAA readability for learner content stays a separate product target. |
| Praxity defaults | The defaults in §5. They go beyond WCAG and apply to Studio, previews, and generated courses. |
| Shipping engines | Chromium (thin canvas and Chromium learners), WebKit (Safari learners), Gecko (Firefox learners, including NVDA) |

**When porting,** delete any row whose binding the target project lacks, and do not invent a command to fill it. A skill that names a missing command does more harm than one that names none. Stale commands are what led to this file.

---

## §1 Operating principles

Every accessibility agent follows these principles without exception.

Studio and the courses it produces must meet WCAG 2.2 AA. That is the minimum. Learner content must also meet AAA readability, and Studio falls under the ATAG scope in §0. The Praxity defaults in §5 go further. They draw on established accessibility practice and user evidence for things WCAG does not require. Check every change against both WCAG and the defaults. Report a missing default as an advisory finding, with severity set by its effect on users (§6).

### 1. Intent-first

Find out what the code is meant to do before you flag or fix anything. Behaviour that works with real assistive technology matters more than strict spec compliance.

- If it works with real AT and the only issue is strict spec compliance, rate it minor, not critical.
- Never change working UX silently to satisfy the spec.
- Ask "does this work for a real user with a real screen reader?" before "does this satisfy the letter of SC X.Y.Z?"

### 2. Revert-first

If a change broke accessible behaviour that used to work, offer to revert it at once. Ask what the intended behaviour was, and re-implement only after you understand it. Revert a breaking change rather than fixing forward.

### 3. Confidence on every finding

| Confidence | Definition | Example |
|---|---|---|
| **high** | Definitively wrong. Measurable, unambiguous. | Contrast 2.1:1 where 4.5:1 is required. Missing `alt`. |
| **medium** | Likely wrong. Needs context verification. | Dynamic colour that may fail in some states. Ambiguous link text. |
| **low** | Possibly wrong. Context-dependent. | Heading level that may be correct depending on page structure. |

Confidence rates the evidence for the finding as stated, whether the finding concerns conformance or a Praxity default. Rate the observation separately from its cause and from the standard it falls under. A spoken phrase you can reproduce does not by itself establish the cause or the classification. A low-confidence finding stays a suggestion for review.

### 4. Source citation

Cite an authoritative source for every claim about accessibility behaviour. Prefer sources in this order:

1. **Normative specs**: WCAG, WAI-ARIA, HTML Living Standard
2. **Informative guidance**: Understanding WCAG, ARIA Authoring Practices Guide (APG), Techniques
3. **Platform vendor docs**: MDN, WebKit/Apple, Android
4. **AT vendor docs**: NVDA, JAWS, VoiceOver
5. **Practitioner guidance**: Adrian Roselli, Scott O'Hara, Sarah Higley, Léonie Watson, Steve Faulkner, Denis Boudreau, Sara Soueidan, Jacob Wood
6. **Government and legal**: Section 508, EN 301 549, AODA, ADA technical assistance

A claim without a citation is a recommendation, not a finding.

Establish a standards failure from normative sources. A Praxity default can rest on first-hand practitioner tests, government design patterns, W3C COGA guidance, or the Inclusive Design Principles, with no matching WCAG requirement. Read the underlying source, check its scope and date, and say where sources disagree. A source that reports its own tests is evidence for the combinations it tested, not proof that every combination works.

For Praxity defaults, use these sources where they cover the task: the A11Y Project, A11Y Collective, GOV.UK Design System and Service Manual, WebAIM, Deque University, Inclusive Components, Adrian Roselli, Scott O'Hara, Sara Soueidan, and TetraLogical. Check their technical claims against the specifications and against how shipping browsers behave. WCAG 3 drafts show where the standard is heading; cite them with their date and draft status.

### 5. Plain language first

Open every finding with what is wrong and who it blocks, in words an author or subject-matter expert understands. Put the success criterion after that, as a reference.

```
Wrong:  1.4.1 Use of Color (Level A): required state conveyed by border colour.
Right:  Required fields are marked only by a red outline.
        Blocks: colourblind users, low-vision users, and every screen-reader user,
        who gets no indication at all.
        Criterion: 1.4.1 Use of Color (Level A)
```

The in-editor checker addresses authors in the same order. Its readers are course designers, not developers, and a bare SC number gives them nothing to act on.

### 6. Device-neutral language

In all user-facing copy (UI strings, error messages, instructions, learner content), write "select", not "click". "Click" assumes a mouse and excludes keyboard, touch, switch and voice users. This applies to our own findings and remediation text too.

### 7. The subject matter can exclude people

Conformant markup cannot help with a task that needs sight or hearing to complete. A person who cannot see cannot complete a course that has them operate a forklift. When auditing learner content, check the activity as well as the interface. Route these reviews to `content-quality-auditor`.

---

## §2 Testing process

### 2.1 Triage the environment before you triage the code

Before treating any manual finding as a defect, rule out the tester's environment. Each of these has produced a confident false bug report:

| Symptom | Check this before calling it a bug |
|---|---|
| Tab skips buttons and links in Safari | macOS **Keyboard Navigation / Full Keyboard Access** is off (System Settings → Keyboard). Turn it on and retest. |
| Tab reaches buttons but still skips `<a href>` in Safari | A separate Safari setting: **Settings → Advanced → "Press Tab to highlight each item on a webpage."** No markup change affects this. |
| Scanner reports "no headings" or an empty `<body>` on a page that visibly has them | The tool is scanning a wrapper, not the content. Extension content scripts often cannot cross a cross-origin iframe. Test the raw file directly, outside any iframe, before you trust the result. |
| VoiceOver Landmarks rotor shows duplicates on the very first load | One-time scan and settle timing on first paint. Reload once before treating it as a defect. |
| VoiceOver announces character counts or blank phrases | Check the target application and harness under §2.3. Browser documents and actual host pane transitions need separate evidence. Record tool failures separately from product defects. |
| The server works but the automated browser lands on the wrong page | `npx serve` 301-rewrites `.html` to clean URLs. Use `python3 -m http.server`. |

Once the environment and harness are ruled out, decide whether the result shows a barrier in the product. Record the checks you ran, and keep tool failures apart from product findings.

### 2.2 All three engines, always

**Test every keyboard, focus, and visual-state fix in WebKit, Chromium, and Firefox before calling it fixed.** Some real defects are 100% reproducible in one engine and 100% invisible in the others. The two that come up most often are WebKit-only CSS repaint gaps on custom form indicators and WebKit-only tab-order behaviour.

An automated suite that runs only Chromium cannot catch these. If the project's suite runs one engine, treat that as a gap to close.

### 2.3 Match VoiceOver testing to the application

For published output and the thin canvas in Safari, run Guidepup `voiceOverTest` with Playwright `browserName: "webkit"`. Start the canvas with `praxity studio <course> --no-open`; exercise Read and Edit mode. Run browser journeys with `pnpm --filter @praxity/desktop e2e:browser-editor` in all three engines.

For embedded preview pane entry and exit, use core Guidepup against the actual host application. Maintainers: read the VoiceOver runbook reached through `AGENTS.local.md` first. Browser-only checks cannot verify host pane focus transitions. Record application and browser versions, actual speech and focus.

Earlier browser-automation runs against Chromium announced raw character counts ("5 characters", "12 characters") and blank phrases, and sometimes froze VoiceOver. The July 2026 browser comparison supports WebKit for browser automation. Check what VoiceOver actually says, and record tool failures separately from product defects.

**macOS setup, user-performed and opt-in:**

The user must opt in and perform host setup before the agent runs VoiceOver checks. Full Disk Access widens the agent's access to the whole disk. The user should revoke it after testing.

- The user grants **Full Disk Access AND Accessibility** to the host app that spawns the test process, then relaunches that app. Identify the actual host from process ancestry; granting permissions to an unrelated terminal does not cover it. From that host, verify access with `ls "/Library/Application Support/com.apple.TCC/"`.
- The user runs `npx @guidepup/setup@0.29.3 setup`, then `npx @guidepup/setup@0.29.3 install` (downloads the VoiceOver-preferences DMG for the OS version). Without `install`, `voiceOver.start()` fails with "Failed to mount Guidepup preferences".
- For published-output browser checks, run `npx playwright install webkit`.
- Turn on VoiceOver AppleScript control. It is on when `defaults read com.apple.VoiceOver4/default SCREnableAppleScript` returns `1`.

**Published-output runs.** Run VoiceOver verification on demand; it is not a committed CI suite. It needs a macOS host with Full Disk Access and live VoiceOver, which CI lacks, and a committed suite would rot. Build the output → serve with `python3 -m http.server` → scratch harness with `@guidepup/playwright` (webkit config) → run a `smoke.spec.ts` first (fails in ~10s if setup is wrong) → flow specs pinned to explicit `http://localhost:PORT/<page>.html`. Never rely on a browser opening "the right URL" on its own. Quit VoiceOver between runs. Full runbook: `.claude/agents/screen-reader-tester.md`.

### 2.4 Verify components before assembly

Test each interactive component (tabs, toggle, modal, accordion, carousel, radio group) with keyboard and screen reader **on its own**, before you place it on a full page. If you assemble first and test once at the end, each fix tends to break a neighbour without notice, and the corrections drag on.

### 2.5 What automation can and cannot do

| Use automated tests for | Use agents and manual AT for |
|---|---|
| Preventing regressions in known behaviour | Designing a new component or interaction pattern |
| Deterministic DOM and runtime output | Copy clarity, wayfinding, cognitive load |
| Repeatable checks in CI | One-time deep reviews before rollout |

Agents set and refine the quality bar, and tests hold it there. Neither replaces using the product with a real screen reader. "The ARIA attributes are correct" and "the screen reader says the right thing" are different tests, and only the second one counts.

### 2.6 Match the tool to the target

| Target | First method | Boundary |
|---|---|---|
| Studio source and author intent | Embedded `editor-core` checker | Fast guidance on source. It cannot inspect a browser accessibility tree or establish full conformance. |
| Generated HTML or SCORM runtime | Praxity Check with named states | Evidence from rendered output, with exact baselines. It does not assess the Studio authoring UI. |
| Known runtime behaviour | Chromium, WebKit, and Firefox Playwright suite | Deterministic regression evidence. It does not replace manual review. |
| Studio authoring UI and native macOS surfaces | Keyboard journeys, accessibility-tree review, and real AT | WCAG 2.2 plus ATAG Parts A and B. Browser scanners do not cover the whole target. |
| Generated HTML syntax | Nu HTML Checker as an occasional external diagnostic | HTML conformance only. Keep its messages separate from accessibility outcomes. |

Use a second automated engine to cross-check the first, not as a second score. Run it on the same known-defect or clean fixture, in the same named state. Keep it only if it finds a confirmed defect the first method missed, or gives evidence that reproduces more reliably. Move each confirmed defect into the smallest regression test in the owning package, or into Praxity Check. Report each engine's raw counts and conformance claims separately.

### 2.7 Pre-release authoring audit

For a release accessibility audit, an ATAG readiness review, or `/a11y pre-release`, read and follow [the pre-release authoring audit runbook](references/pre-release-authoring-audit.md). Run it on demand before a release; it is not another CI suite. Commit deterministic regression tests for the defects it finds, and keep VoiceOver harnesses out of the repository.

---

## §3 Component decision log

A model fixes what you point it at and often misses what the fix breaks nearby. Without a written record, a component can cycle through the same three wrong answers indefinitely. Fix A silences a double announcement, fix B restores the state but goes silent, and fix C brings the double announcement back.

Any component that takes more than two attempts to get right gets a decision-log entry before the work counts as done. Record the combinations you tried and rejected, as well as the one that shipped.

Keep the log next to the component, as a comment block or a sibling `*.a11y.md`:

```
Auto-play toggle, settled 2026-08
  SHIPPED: stable visible label + single polite live region
  REJECTED: changing label + live region     → announced twice
  REJECTED: changing label + aria-pressed    → announced nothing
  REJECTED: stable label + aria-pressed      → works, but AT's own "pressed"
                                               wording only; cannot carry exact copy
  Verified: WebKit + VoiceOver, Chromium + NVDA
```

Before you change an accessible name, a live region, or a state attribute on a logged component, read its log. If your idea appears there, someone has already tested it.

---

## §4 Task-to-agent routing

Most tasks need more than one agent. Start with the agent in the "Start with" column and consult the others for detail.

The calling agent coordinates the review. This skill passes no context to specialists on its own, so the calling agent writes each specialist an explicit brief. The brief names:

- the target, relevant paths or URL, framework, and scope;
- the audit method, planned journeys, and named states;
- the available browser and assistive-technology environment;
- excluded checks, with the reason for each;
- evidence already collected and checks still needed.

Specialists follow §6 and mark checks that did not run as `untested`.

| Building or reviewing… | Start with | Also consult |
|---|---|---|
| Interactive component (modal, tabs, accordion, combobox) | interaction-designer | aria-specialist, keyboard-navigator |
| Keyboard behaviour, focus management, tab order | keyboard-navigator | aria-specialist |
| Colour, contrast, dark mode, visual indicators | contrast-master | visual-designer |
| Motion, animation, reduced-motion | contrast-master | interaction-designer |
| Design tokens, theme colours, spacing | contrast-master | data-visualization-accessibility |
| Live updates, toasts, loading states | live-region-controller | keyboard-navigator, contrast-master |
| Learner-facing course content quality | content-quality-auditor | content-strategist |
| Product UI copy, labels, error messages | content-strategist | content-quality-auditor |
| Navigation, menus, breadcrumbs, wayfinding | navigation-architect | keyboard-navigator, aria-specialist |
| Screen reader behaviour verification | screen-reader-tester | aria-specialist |
| ARIA roles, attributes, patterns | aria-specialist | keyboard-navigator |
| Full page or component audit | wcag-audit-specialist | coordinates the others |
| ACR/VPAT authoring or vendor evaluation | acr-vpat-reviewer | wcag-audit-specialist |
| Page layout, typography, visual hierarchy | visual-designer | contrast-master, navigation-architect |
| User flows, onboarding, multi-step journeys | journey-mapper | ux-psychologist, interaction-designer |
| Persuasion, cognitive bias, trust | ux-psychologist | content-strategist, visual-designer |
| Email design and content | email-designer | content-strategist, contrast-master |
| Alt text quality, template-variable leaks | text-quality-reviewer | wcag-audit-specialist |
| Charts, graphs, dashboards | data-visualization-accessibility | contrast-master, keyboard-navigator |
| PDF, EPUB, document export | document-accessibility | wcag-audit-specialist |
| Multilingual, RTL, bidi, lang attributes | i18n-accessibility | aria-specialist, content-quality-auditor |

### Cross-cutting ownership

**Tooltips.** UX pattern: interaction-designer · copy: content-strategist · glossary mechanism: content-quality-auditor · roles and accessible name: aria-specialist · contrast: contrast-master

**Error messages.** Copy (what happened, why, what to do): content-strategist · markup (`aria-describedby`, never `aria-errormessage`): wcag-audit-specialist · submit availability: [Disabled controls](../../../docs/rules/a11y-checklist.md#disabled-controls) · validation timing and focus: keyboard-navigator · announcement policy: live-region-controller · learner-content corrections: content-quality-auditor

**Disabled controls.** Read [Disabled controls](../../../docs/rules/a11y-checklist.md#disabled-controls) before choosing or reviewing an unavailable state. Consult keyboard-navigator for focus behavior, interaction-designer for task flow, and contrast-master for visual review.

**Accordions.** Markup, roles, keyboard: aria-specialist · when to use, multi-open default: interaction-designer · density vs discoverability: content-strategist

**Reading level.** Learner content: content-quality-auditor, grade 7–9 (3.1.5) · product UI for professionals: content-strategist, grade 10–12 · critical flows (onboarding, errors, sign-up): content-strategist, grade 6

**Text quality.** Template variables and code syntax in names: text-quality-reviewer · alt-text presence and copywriting: wcag-audit-specialist · label consistency across pages: content-quality-auditor · accessible-name computation: aria-specialist

**Data visualisation.** SVG ARIA, table alternatives, keyboard: data-visualization-accessibility · colour-blind-safe palettes and mark contrast: contrast-master · chart descriptions in course content: content-quality-auditor

**Document export.** PDF/UA and tagged structure: document-accessibility · source HTML before conversion: wcag-audit-specialist · alt text in output: text-quality-reviewer

**Multilingual.** Lang, RTL, bidi: i18n-accessibility · `aria-label` translation safety: aria-specialist · readability in target language: content-quality-auditor · number and date locale formatting: i18n-accessibility

---

## §5 Claims and Praxity defaults

Each row takes a claimed accessibility requirement and answers two questions separately. The Conformance status column says whether a standard actually requires it. The Praxity default column says what Studio and its courses do. A claim that no standard backs can still lead to a useful default.

Apply each default to the task and surface it names, and report departures under §6. Where a row sets no default, decide from the task and the user evidence. Record each exception with its reason and evidence.

An exception to a default needs evidence and approval from the responsible product or accessibility owner. Record the affected journey, the reason, the test evidence, and what should trigger a review. Agents report every exception they find; they never waive a default on their own.

| Claim | Conformance status | Praxity default | Evidence |
|---|---|---|---|
| Add `tabindex="0"` to every native `<button>` and `<a>` so Safari can tab to them | **Do not adopt** | P01. Rely on native focus behaviour, and set up Safari for testing as §2.1 describes. Keep the focus rules that composite widgets set on purpose. [WebAIM](https://webaim.org/techniques/keyboard/) | macOS Keyboard Navigation and a separate Safari link setting control Safari's behaviour (§2.1). WebKit bug 199671 reports that WebKit ignores explicit `tabindex` on affected native controls, so the workaround is unreliable in Safari and redundant in every other engine. It also conflicts with roving-tabindex widgets. Treat the Safari settings as a testing prerequisite, not a code rule. |
| Every toggle whose visible label changes needs a paired live region | **Unproven** | P02. Give toggles a stable label and the right state attribute, with no paired live region. Add an announcement only when testing shows the task needs feedback that the control does not give. Keep required disclosure and selection states. [APG buttons](https://www.w3.org/WAI/ARIA/apg/patterns/button/) | Prefer a stable toggle label with `aria-pressed`. A command label that changes, such as Play/Pause, can omit `aria-pressed` instead. That exception leaves required widget states in place, such as a custom disclosure button's `aria-expanded`. Before adding a paired live region, show in a real AT test that the change is not spoken, and do not repeat the same words in both. [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/), [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) |
| Every dynamic update needs a live region or moved focus | **Refuted as a mandate** | P03. Give clear feedback for changes that matter to the task. Announce completion, errors, result counts, and important background changes when users would otherwise miss them. Keep announcements polite and short, and keep the user's place. Leave other DOM mutations unannounced. [Inclusive Components](https://inclusive-components.design/notifications/) | Classify the update first. A status message that 4.1.3 covers must be exposed programmatically without taking focus. Ordinary widget state changes and newly revealed content do not automatically need another announcement. Check the required states and the real task flow before adding a channel. [Understanding 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) |
| Native `<input type="date">` is a keyboard trap; replace it with a text input | **Refuted** | P04. For dates the user already knows, prefer typed entry with clear labels, examples and parsing that suit the locale, and useful errors. Accept localized month names where they fit. Use a calendar when seeing nearby dates helps the user choose. [GOV.UK](https://design-system.service.gov.uk/components/date-input/) | VO+Shift+Down is VoiceOver's standard command for entering a compound group, not a trap. WebKit improved date/time VoiceOver behaviour in Safari 17–18. Choose text input for known dates, such as a birthdate, for usability reasons; conformance does not require it. |
| Turn `autocomplete` off to stop the browser offering autofill | **Context-dependent** | P05. Keep useful autofill. Turn it off only when evidence shows the task needs that, and keep the input-purpose metadata that applies. Test actual entry behaviour as a separate check. [GOV.UK](https://design-system.service.gov.uk/patterns/addresses/) | Fields covered by 1.3.5 must keep a programmatically determinable purpose. Form-level `autocomplete="off"` can conform when suitable purpose tokens remain on individual controls. Field-level `off` is not an input-purpose token. Browser autofill behaviour is a separate question; verify it in the target browser. [Understanding 1.3.5](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html), [HTML autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill) |
| Never put `tabindex` on a `role="tabpanel"` | **Refuted as stated** | P06. Follow APG's rule for when a tab panel takes focus. Check that keyboard users reach the start of the meaningful content without needless focus stops. [APG tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | APG's rule is conditional. Add `tabindex="0"` when the panel has no focusable content or its first meaningful content is not focusable. Omit it when focus can land on a real control immediately. |
| Name every `<ul>` so the Lists rotor can tell them apart | **Contested** | P07. Do not name lists by default; clear headings around them come first. Name a list when it is still ambiguous and testing shows that naming helps navigation. Name individual list items only with specific evidence. [Scott O'Hara](https://www.scottohara.me/blog/2020/05/02/labelled-lists.html) | Naming lists is allowed and optional. Naming a list that is truly ambiguous helps; naming every list adds its own verbosity. |
| Only add `autocomplete` where the field matches a defined input-purpose token | **Adopt** | P08. Use the correct standard autocomplete token wherever one fits. Leave personal-information tokens off course metadata and assessment responses. [HTML autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill) | The claim is correct. Add a token where it fits, not because a scanner flagged the field. 1.3.5 does not cover a field outside WCAG's input-purpose list, and forcing a token onto it is an error. |
| Exactly one `<h1>` and no skipped heading levels are WCAG requirements | **Refuted as conformance rules** | P09. Give each page one descriptive top-level heading, and nest headings without skipping levels on the way down. Guide authors toward this, and keep the hierarchy intact through preview and export. Review a justified exception as a departure from this default, not as a conformance failure. [A11Y Project](https://www.a11yproject.com/posts/how-to-accessible-heading-structure/) | A descriptive hierarchy is useful, but W3C lists nested ranks as advisory for 1.3.1 and sufficient for the AAA section-heading criterion. Report structure concerns as recommendations unless the markup fails to expose a real relationship. [W3C G141](https://www.w3.org/WAI/WCAG22/Techniques/general/G141) |
| Every page needs every landmark, singleton landmarks must be unnamed, and accordion panels require regions | **Refuted** | P10. Put ordinary page content inside suitable native landmarks. When landmarks serve different purposes, give each a useful name, preferably from a visible heading. Leave a singleton landmark unnamed when a name would add nothing. Add a region to an accordion panel only when it is a useful navigation destination. Review the landmark inventory after hydration. [Scott O'Hara](https://www.scottohara.me/blog/2018/03/03/landmarks.html) | Which landmarks a page needs depends on its content. Names on singleton landmarks are optional; leave out words that repeat the role. Give repeated landmarks with different purposes different names; identical navigation sets may share a name. Accordion panel regions are optional. To avoid too many regions, count the panels that can be open at once, not the total number of panels. [WAI landmarks guidance](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/), [WAI accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) |
| Every navigation needs a skip link, every media embed needs a following heading, lesson navigation must follow content, and visual order must always match DOM order | **Refuted as mandates** | P11. Put a skip-to-content link, visible on focus, before any repeated controls that come ahead of the content. Place lesson Next/Previous after the content. Keep the visual, reading, and focus order in step wherever the order carries meaning. Give users a practical way past long media controls, without adding a heading after every embed. Test responsive layouts and complete journeys. [WebAIM](https://webaim.org/techniques/keyboard/) | These are useful defaults, not requirements. 2.4.1 covers bypassing repeated blocks, 1.3.2 covers a meaningful reading sequence, and 2.4.3 covers a focus order that preserves meaning and operation. Test the real keyboard and reading journeys instead of requiring one technique or placement. [Understanding 2.4.1](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html), [Understanding 1.3.2](https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html), [Understanding 2.4.3](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) |
| New-tab warnings and download format/size are mandatory | **Refuted as WCAG requirements** | P12. Links to external resources in a course open in a new tab, like the glossary, because they sit beside the learning flow. Each one says so in its visible text and in its accessible name, as the product's "(opens in new tab)" and "Glossary (opens in a new tab)" strings do (`opensInNewTab` and `glossaryNewTab` in `packages/shared-blocks/src/i18n/strings.ts`). Any other link that opens a new tab, window, or browser gives the same warning before activation. For downloads, show the file format and, when known, the size. Show media duration where it helps. [GOV.UK links](https://design-system.service.gov.uk/styles/links/), [attachments](https://design-guide.publishing.service.gov.uk/components/attachment/) | G201 is advisory, including for AAA 3.2.5; a missing warning does not by itself fail a success criterion. File format and size are usability guidance. Report a conformance failure only when the link independently fails an applicable criterion. [W3C G201](https://www.w3.org/WAI/WCAG22/Techniques/general/G201) |
| Every table needs a caption/name and every chart needs a data table | **Refuted as absolutes** | P13. Give generated data tables a caption. Give generated numeric charts a takeaway and an accessible data view that every user can open. Give authors the fields they need to write meaningful descriptions. Use structured prose when it conveys a diagram or chart's information better than a table. [WebAIM](https://webaim.org/techniques/tables/data), [TetraLogical](https://tetralogical.com/blog/2022/01/24/text-descriptions/) | A native HTML table whose purpose is clear from context does not always need a caption or computed name. An explicitly authored ARIA `table` role requires an accessible name. Charts need equivalent information, which can be a data table, structured prose, or another suitable text alternative. [WAI table captions](https://www.w3.org/WAI/tutorials/tables/caption-summary/), [WAI-ARIA table](https://www.w3.org/TR/wai-aria-1.2/#table), [WAI complex images](https://www.w3.org/WAI/tutorials/images/complex/) |
| `px` font sizes fail automatically, and `clamp()` must have a max at least twice its min | **Refuted** | P14. Use relative font sizes, do not shrink the browser's root font size, and let form controls inherit typography. Test browser text settings, text enlargement, zoom, and reflow. Check fluid text from several starting widths; a min-to-max ratio does not prove that text scales. [Adrian Roselli](https://adrianroselli.com/2019/12/responsive-type-and-zoom.html) | Test the rendered result at 200%. The failure is loss of content or functionality, not the unit or a ratio heuristic. Browser zoom is a sufficient technique when the layout survives it. [W3C G142](https://www.w3.org/WAI/WCAG22/Techniques/general/G142.html) |
| Dark mode, `prefers-contrast`, reduced transparency, and universal reduced-motion handling are required | **Refuted as universal requirements** | P15. For users who set prefers-reduced-motion, remove or reduce non-essential motion. Otherwise motion is welcome, used with taste; the motion-timing, motion-performance, transitions-dev, and interface-craft skills govern how. Honour supported contrast and transparency preferences. Where both light and dark themes are supported, offer both and follow the system setting until the user picks one. In exported courses, keep the meaning of author content, including meaningful colours in images and charts, and let learner preferences override cosmetic theme choices. [A11Y Project](https://www.a11yproject.com/checklist/), [Inclusive Design Principles](https://inclusivedesignprinciples.info/) | Supporting these preferences is worthwhile, but a missing media query is not by itself a failure. 2.2.2 covers moving content that starts automatically, lasts more than five seconds, and appears alongside other content. It also covers automatic updates alongside other content, which get no five-second exemption. Both fall under its exception for essential content. AAA 2.3.3 covers letting users turn off non-essential motion triggered by interaction. Treat wider product preferences as a separate question. [Understanding 2.2.2](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html), [Understanding 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) |
| Skeleton placeholders require 3:1 contrast | **Refuted when decorative** | P16. Decorative skeleton shapes have no contrast minimum. Show loading feedback on screen and expose it programmatically, block interaction with controls that are not ready, and apply P15 to skeleton motion. [COGA](https://www.w3.org/TR/coga-usable/) | Non-text contrast applies only to graphics needed to understand content or to identify a control or its state. Decorative skeleton shapes are exempt; expose the loading state in text. [Understanding 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| Always add `novalidate` and never use native constraint validation | **Refuted** | P17. Use native validation for simple flows when testing shows it works. Use a complete custom flow when multiple errors, persistent instructions, localization, or recovery need more control. Associate clear error messages with their fields, keep what the user entered, and do not announce on every keystroke. Add novalidate only with a tested custom flow in place. [Deque University](https://dequeuniversity.com/checklists/web/form-validation-feedback), [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/) | Native validation is valid, and current browsers expose `required`. Use custom validation only when the product needs behaviour that native validation cannot provide. [WAI form validation](https://www.w3.org/WAI/tutorials/forms/validation/) |
| Never disable submit, and prefer `disabled` or plain text over `readonly` | **Refuted as blanket requirements** | P18. Follow the submit and display-value defaults in [Disabled controls](../../../docs/rules/a11y-checklist.md#disabled-controls). Start with an enabled submit that shows validation feedback, and with plain text for display-only values. Keep readonly when the task needs it. [Adrian Roselli](https://adrianroselli.com/2024/11/avoid-read-only-controls.html), [Kitty Giraudel](https://kittygiraudel.com/2024/03/29/on-disabled-and-aria-disabled-attributes/) | Use [Disabled controls](../../../docs/rules/a11y-checklist.md#disabled-controls) to choose the state and the task flow. |
| Always use `aria-disabled`, or always use native `disabled` whenever supported | **Refuted as blanket requirements** | P19. Follow [Disabled controls](../../../docs/rules/a11y-checklist.md#disabled-controls) for discovery, activation, focus, and legibility. Neither attribute is right everywhere. [Kitty Giraudel](https://kittygiraudel.com/2024/03/29/on-disabled-and-aria-disabled-attributes/) | Use [Disabled controls](../../../docs/rules/a11y-checklist.md#disabled-controls) to decide focusability and to check that activation is blocked. |
| Native `required` on one radio means every radio must be checked | **Refuted** | P20. Use native radio groups that share a name, with a meaningful legend, a visible "required" instruction, and a clear error for the group. Test entering and correcting a choice in the group. [A11Y Project](https://www.a11yproject.com/checklist/) | Radios with the same name form one group. If any member is required, the group is missing a value only while every member is unchecked. [HTML Standard](https://html.spec.whatwg.org/multipage/input.html#radio-button-state-(type=radio)) |
| Alerts and statuses cannot contain actions, so any actionable message must be a modal `alertdialog` | **Refuted as absolute** | P21. Informational feedback leaves focus where it is. Keep important actions in UI that stays on screen and is easy to find; a toast that disappears is never the only place for an essential action. Use a modal alertdialog for an urgent decision that has to interrupt the user. [Scott O'Hara](https://www.scottohara.me/blog/2019/07/08/a-toast-to-a11y-toasts.html) | Use `alertdialog` for an urgent modal interaction that takes focus. A message can offer a separate action without becoming modal. Verify focus, timing, and the announcement; do not infer the role from its descendants alone. [WAI alert-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/) |
| Hide an idle live region with `visibility: hidden` | **Refuted** | P22. Keep a live region in the accessibility tree before you update it. Prefer the visible message as the source of the announcement. When a separate announcer is needed, hide it with an accessible visually-hidden style. [Sara Soueidan](https://www.sarasoueidan.com/blog/accessible-notifications-with-aria-live-regions-part-1/) | `display:none`, `visibility:hidden`, and `hidden` remove the region from the accessibility tree, so nothing is announced. Keep an empty region rendered, and if necessary hide it visually with a clipping or off-screen pattern. [WAI-ARIA 1.2 §7.1](https://www.w3.org/TR/wai-aria-1.2/#tree_exclusion) |
| All CSS-only widgets fail | **Refuted** | P23. Prefer native controls. Choose disclosure markup by P27. A custom widget implements the semantics and keyboard model of the widget it actually is. CSS-only implementations are allowed. Verify behaviour in the supported environments. [A11Y Collective](https://www.a11y-collective.com/blog/the-first-rule-for-using-aria/) | Styling does not remove native checkbox or radio semantics or state. Native `<details>` exposes disclosure state through its `<summary>` without an authored `aria-expanded`. Custom disclosure buttons need that state attribute. Judge the actual name, role, state, keyboard behaviour, and focus behaviour, not whether JavaScript is present. [HTML details](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element), [ARIA in HTML](https://www.w3.org/TR/html-aria/#el-summary) |
| `EN-US` is not valid BCP 47 | **Refuted** | P24. Write generated language tags in conventional casing, keep valid imported tags as they are, and mark real changes of language. Casing alone is never a defect finding. [WebAIM](https://webaim.org/techniques/screenreader/), [BCP 47](https://www.rfc-editor.org/rfc/rfc5646.html) | Language tags are case-insensitive; `en-US`, `en-us`, and `EN-US` compare as equal. Use conventional casing for readability, not validity. [BCP 47 / RFC 5646](https://www.rfc-editor.org/rfc/rfc5646.html) |
| Every interactive chart should use `role="application"` | **Refuted and dangerous** | P25. Do not use the application role by default. Prefer ordinary content and standard controls, with accessible descriptions and data views. An exception needs a specific interaction requirement and evidence from real AT. [WebAIM](https://webaim.org/techniques/aria/) | The role changes how assistive technology handles the keyboard. Use it only for a focusable interaction model that no standard widget role supports, and only after real AT testing. A chart being interactive is not reason enough. [WAI-ARIA application role](https://www.w3.org/TR/wai-aria-1.2/#application) |
| Native `<dialog>` both requires and forbids `aria-modal="true"` | **Refuted as blanket guidance** | P26. Prefer a suitable native `<dialog>` for new dialogs. Open a modal one with showModal, and give it a clear name, deliberate initial focus, a way to dismiss it, and focus return. Do not require ARIA that repeats native semantics. Keep a justified custom dialog whose behaviour is tested. [Scott O'Hara](https://www.scottohara.me/blog/2023/01/26/use-the-dialog-element.html) | `showModal()` gives native modal behaviour. Do not add `role="dialog"`. Treat explicit `aria-modal` as redundant on a correctly opened native modal, and never claim modality when the background still responds to input. [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) |
| Native `<details>` is always accessible, or custom disclosures always work better | **Neither is established.** WCAG requires neither pattern. | P27. In published courses and their previews, build each content disclosure as a `<button type="button">` whose `aria-expanded` matches its panel. Put accordion buttons inside headings and point each at its panel with `aria-controls`. The server-rendered content stays readable when JavaScript fails or reader mode strips the enhancement. Show the content first, and collapse a panel only once its button works. In Studio's own interface, native `<details>`/`<summary>` is fine for simple disclosures after keyboard and screen-reader testing. A native disclosure in a published course needs an exception under this section's approval rule. This covers transcripts and image descriptions too. Tabs, selection controls and other widgets keep their own patterns. | This is a Praxity default; native HTML does not fail WCAG. [Roselli's tests](https://adrianroselli.com/2020/05/disclosure-widgets.html) found an iPadOS 16.5 state regression on 9 August 2023, and correct state announcements on iPadOS 17.3 on 28 January 2024. [Mozilla bug 1834198](https://bugzilla.mozilla.org/show_bug.cgi?id=1834198) is still open, with a Firefox 147.0.4 on Android 16 reproduction that shows missing cues and extra navigation stops. Test the actual markup, styling, fallback and LMS journey with current assistive technology, and record versions, dates and limits. A native `<summary>` exposes its own state, so never add `role="button"` or `aria-expanded` to it. [ARIA in HTML](https://www.w3.org/TR/html-aria/#el-summary), [APG disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/), [APG accordion](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) |

When you add or revise a row, check the conformance claim and the Praxity default separately. Cite the evidence for the default and name any material disagreement between sources. Record the default, or record that the row has none and why. A refuted requirement does not cancel a finding against a supported default.

---

## §6 Reporting

### Execution ledger

Start every planned audit with a ledger that has one row per journey or check. Each row records the target, journey, named state, browser, engine, viewport, assistive technology, and one status:

- `tested` when the planned method ran;
- `cantTell` when it ran but a person must decide the result;
- `untested` when it did not run, with the reason.

A skipped, blocked, or unsupported check stays `untested`, never a pass. Add `comparison` only when an explicit baseline exists. Add `disposition` only after review. Disposition does not change the outcome: an accepted failure is still a failure.

### Severity

Rate each finding critical, serious, moderate, or minor by its evidenced effect on the user's task.

Finding type is separate from severity and confidence. Where it helps, add Type: Violation when evidence shows harm, or Type: Opportunity when evidence supports an improvement. Neither type establishes WCAG nonconformance. Name the applicable requirement separately, or mark the finding advisory.

For audit reports delivered to a client or stakeholder, use this four-point remediation scale instead. It ranks findings by their effect on users, not by criterion:

- **Critical**: content or functionality is completely inaccessible to some users.
- **Significant**: content or functionality is very difficult for some users.
- **Moderate**: extra time or effort required; guidelines and best practices not followed.
- **Recommendation**: usable, but could be better for everyone.

### Finding format

Every reviewer uses this format. Each finding carries a confidence level (§1.3) and opens in plain language (§1.5). Put agent-specific observations under Evidence and agent-specific remediation details under Suggested fix. Add a finding type only when it helps explain the issue.

When evidence shows that a Praxity default is missing but does not show a standards failure, write Requirement: advisory and Basis: Praxity default. Name the default and cite its evidence. Set severity by the effect on the user's task. An advisory finding can have any severity. Being advisory is no reason to drop a finding or lower its severity.

For a check against a default, Outcome: failed means the default was not met. It does not mean WCAG failed. Use cantTell when the context or evidence cannot settle the result. When the same barrier also fails a standard, report it once with Basis: conformance, and mention the related default under Evidence or Suggested fix.

End a specialist review with two finding counts, one for conformance and one for Praxity defaults, each broken down by severity and confidence. List the checks that still need review or testing. Keep the conformance verdict apart from the assessment against defaults. Coverage and test status belong in the execution ledger. A finding count does not establish conformance.

```
### [N]. [What is wrong, in plain language]

- **Blocks:** [who, named concretely, never just "users with disabilities"]
- **Severity:** critical | serious | moderate | minor
- **Confidence:** high | medium | low
- **Outcome:** failed | cantTell
- **Basis:** conformance | Praxity default
- **Requirement:** [WCAG, ATAG, ACT, platform evidence, or "advisory"]
- **Default:** [§5 ID such as P12, or another cited Praxity default, when applicable]
- **Target:** [surface or artifact]
- **Journey/state:** [journey and named state]
- **Environment:** [browser, engine, viewport, assistive technology]
- **Location:** [file:line, selector, or component]

**Evidence:** …
**Reproduction:** …
**Suggested fix:** …
```

Add `comparison`, `disposition`, and the review reason, owner, and date only when a baseline or review exists. Studio may omit owner and date for a local-only review. Shared or CI baselines require all three.

### Full audit reports

For a formal audit (a client deliverable, a conformance claim, or the evidence behind a VPAT), follow the **W3C WCAG-EM** structure. It is the recognised method, and it requires the parts that an ad-hoc list of findings leaves out:

1. **Cover page**: what was audited, date, auditor.
2. **Evaluation methods**: the techniques actually used, e.g. manual keyboard-only navigation (Tab, Shift+Tab, Enter, Escape); screen-reader spot check (VoiceOver on WebKit, NVDA on Chromium/Firefox); automated + manual contrast checks; manual heading outline review.
3. **Scope and sample**: which pages or components, and why they are representative. State what was *not* covered.
4. **Executive summary**: count by principle, and the conformance verdict (conforms / partially conforms / does not conform, at which level).
5. **Severity scale**: the four-point scale above, stated in the report.
6. **Detailed findings**: one per barrier, each in the finding format above.

Reference: W3C WCAG-EM 2.0. `acr-vpat-reviewer` owns the VPAT/ACR document itself; this structure is the evidence that feeds it.

---

## §7 Checklist before calling a11y work done

The work is done when every item holds:

1. Environment ruled out before any manual finding was recorded as a defect (§2.1).
2. Keyboard, focus, and visual-state changes verified in WebKit, Chromium, and Firefox (§2.2).
3. Browser VoiceOver checks ran on WebKit; host pane checks ran in the actual application (§2.3).
4. New interactive components verified standalone before page assembly (§2.4).
5. Every finding has a confidence level and a cited source (§1.3, §1.4).
6. Findings lead with what is wrong and who it blocks (§1.5).
7. Components that took more than two attempts have a decision-log entry (§3).
8. No user-facing copy says "click" (§1.6).
9. Project suite and rule-coverage tests pass (§0).
10. Every changed page or view has a final hydrated landmark inventory. Each generic `region`, including an implicitly named `<section>`, is a proven navigation target, widget, or keyboard-scroll container. Any other region has been removed.
11. Every planned journey or check is `tested`, `cantTell`, or `untested` in the execution ledger (§6).
