# A11y & UX Review — provenance and audit record

**Process, principles, testing and agent routing live in `/a11y`** (`.claude/skills/a11y/SKILL.md`).
This file holds only what does not belong there: where the agents came from, and what
past audits established.

## Agent provenance

The specialist agents in `.claude/agents/` are adapted from
[Community-Access/accessibility-agents](https://github.com/Community-Access/accessibility-agents)
(79 agents across 8 teams, MIT). We maintain local, edited copies — do not re-sync
upstream wholesale; our versions carry project-verified corrections.

Naming note: upstream `live-regions-manager` is `live-region-controller` here.

## Audit record

**July 2026 — slides mode** (5 specialist agents + live VoiceOver on WebKit). Confirmed
clean: reveal-pending content read without audio; hamburger collapsed/expanded + dialog +
focus-in; seek slider speaks `aria-valuetext` rather than "0:00 / 0:00"; quiz
radiogroup/labels/required; nav-after-content. Fixes shipped in PR #977.

**August 2026 — external-methodology review.** Audited our system against a
CPACC-certified practitioner's 83-round AI-assisted remediation log. Outcomes folded
into `/a11y`: environment-triage gate, dual-engine testing rule, component decision log,
plain-language-first findings, WCAG-EM report structure, claims and Praxity defaults register (§5).
Accordion follow-ups it surfaced were fixed in PR #1060:

- Accordion controls now render inside heading wrappers, so heading navigation reaches
  each section.
- Large multi-open accordions use groups instead of creating excessive region landmarks;
  smaller and single-open accordions retain the region relationship.

That review also produced a separate tool, now its own repo: **Praxity Check**
(`../praxity-check`, `github.com/Praxity/praxity-check`). It scans
learning packages and records named states, exact occurrence baselines, explicit
untested scope, and rule outcomes in schema v4. This repo stays the upstream
knowledge source: `/a11y` and `docs/rules/a11y-checklist.md` guide agents, while
Praxity Check implements the machine-checkable rendered-output subset.

**August 2026 — production export and YouTube frames.** The rebuilt comprehensive
HTML export has zero Praxity Check findings at every confidence level in its
offline run. A network-enabled pass loaded both YouTube frames. Chromium and
WebKit keyboard checks left the generic player, and VoiceOver 10 on WebKit spoke
the video frame's full title and reached the generic player's "Play video"
control. Findings inside YouTube's generated cross-origin DOM remain external
coverage, not Studio-owned markup. The course sidebar now exposes one "Course
navigation" landmark; page and reference sets are labelled groups rather than
extra landmarks.

## September 18, 2026: narrated module deck

Local published fixtures were rebuilt from the narrated-deck branch. VoiceOver
ran against headed Playwright WebKit 1.59.0 on macOS 26.5.2 at the default desktop
viewport, 1280 × 720. Guidepup 0.19.1 supplied the temporary harness. These are
focused runtime checks, not an application-wide conformance claim.

| Journey and state | Method | Status | Result |
| --- | --- | --- | --- |
| Identity header, skip links and active slide | WebKit with VoiceOver | tested | Header precedes main content; hidden slides are omitted. |
| Transcript reading and Follow toggle | WebKit with VoiceOver | tested | Headings, paragraphs, ordered and unordered lists are spoken. Follow announces its selected state. |
| Transcript close | WebKit with VoiceOver | tested | Focus returns to the collapsed Transcript opener. |
| Outline current and locked entries | WebKit with VoiceOver | tested | Announces “current page link Introduction” and “dimmed link Certification, Assessment, Locked”. |
| Assessment choice and submitted feedback | WebKit with VoiceOver | tested | Required radio options and selected state are spoken; submitting announces incorrect feedback. |
| Auto-advance and playback | WebKit with VoiceOver | tested | Auto-advance changes selected state; Play and Pause controls operate and announce their labels. |
| Review context and submission | WebKit with VoiceOver | tested | Comment field describes the active slide. Saved comment appears and the submitted draft clears. See live-announcement limitation below. |
| Pending, successful and failed comment requests | Headless Chromium and WebKit | tested | Pending comments are not shown as saved. Success clears the unchanged draft and inserts the saved comment together. Failure preserves the draft. A mutation observer found no duplicate display state. |
| Eight updated English/French help pages | Chromium and WebKit, axe and 320px reflow | tested | No axe violations or horizontal overflow in the checked pages. YAML examples support keyboard scrolling. |

Hydrated landmark inventory: the closed deck has one optional identity banner,
one main, and Course controls navigation. Opening Transcript adds its
complementary landmark and the keyboard-scrollable Reading text region. Opening
Course outline adds one navigation landmark. Its redundant outer complementary
landmark has been removed; mobile uses a labelled dialog. Closed panels and
inactive slides are excluded. No additional generic region was needed.

The comment status stays in the accessibility tree while its text changes;
success is visually hidden. The earlier list render toggled `hidden` around the
same status node. Regression tests now assert persistent node identity and no
`hidden` mutations. The comment list waits for a successful response rather than
showing an optimistic copy beside the pending draft.

### Live-announcement limitation

Gate notices and the visually hidden comment-success message are **cantTell** for
spoken delivery in this run. Their DOM changes were verified, but VoiceOver's
captured speech did not include the polite update. A minimal native HTML
`role="status" aria-live="polite"` control was also silent with Live Regions
confirmed enabled. A Safari cross-check did not remain on the controlled page,
so it supplies no result. This does not establish a runtime defect or a pass.
The stable comment status node is retained as a structural correction, not as
proof that spoken delivery was fixed. Repeat these two announcement checks in a
controlled screen-reader session before recording them as passed.

[Apple's web-announcement guidance](https://support.apple.com/guide/voiceover/by-web-announcements-vo34654/mac)
was used to check the environment. VoiceOver and its utility were closed after
testing; the preference directory preserved during the harness check was restored.

### Generated HTML review

The audit inspected generated reading, audio, formatted-transcript and grouped
assessment fixtures, before and after hydration, in Chromium and WebKit. Both
skip links focused their real `main` and course-controls `nav` targets. Hidden
slides were excluded from the accessibility tree. The code review found no new
P1/P2 issues in the final outline, follow-preference and comment work.

The semantic cleanup removes the duplicate outline destination, shortens seek
labels to a heading or short whole-word excerpt, and separates assessment
headings from supporting paragraphs and lists in both renderers. Incomplete
assessment fallbacks retain the supporting content. Slide article labels remain
because assessment slides can lack a separate heading with the slide title.
Generic wrappers are retained when they carry layout or runtime identity; nested
spans alone were not treated as an accessibility defect.

The temporary harness and raw evidence were retained separately from the source
tree. No harness was added to CI. Local documentation commits
also update the selected public Prax format files and eight English/French Studio
help pages. No documentation or review package was published.

### Final navigation and chart checks

The toolbar arrows now cross module boundaries, with localized accessible names
and existing gates. Automatic narration still stops at the boundary. Separate
footer links remain in the no-JavaScript fallback. Runtime/bundle checks passed
38 tests. The broad dual-engine deck run passed 69 of 74 checks; after correcting
new-test hydration/focus assumptions, all eight affected Chromium/WebKit checks
passed, including a rerun of an existing WebKit audio timing failure.

Published charts return to static SVG with centred titles and accessible data
tables. The chart/planner checks passed 94 tests; both engines confirmed the
title alignment and absence of hover overlays. The full workspace run passed
8,416 tests with one CSS-size failure; the final focused bundle check passes the
unchanged limit at 30,585 gzip bytes. Final typecheck and 27 SCORM checks pass;
lint reports 27 existing warnings and no errors. The full workspace suite was not
repeated after the bounded navigation/chart changes.

### Phone images and compact option results

Floated images now use the available narrow-container width, capped by intrinsic
size, and retain their authored side when stacked. Existing tablet wrapping stays
in place. Image-float browser checks passed 19 cases across Chromium and WebKit;
one WebKit CDP zoom check was skipped because that protocol is Chromium-only.

Choice results now use regular-weight Correct/Incorrect labels beside the option
on wide layouts and below its text on narrow layouts. Selection controls retain
their checked state, including missed correct answers. Existing feedback summaries
are unchanged. The 61 assessment unit tests pass; both engines verified keyboard
submission, result restoration, accessible option names and 320px/1280px layout.
Four other answer-reveal browser checks also passed. These follow-up changes were
not retested with VoiceOver. The two earlier polite-announcement limitations remain.
The user is handling the authored highlight styling; no highlight fix was applied.

### Required activity guidance

Blocked advancement now displays a larger contextual notice beside the first
unfinished local activity. The left gutter is used only when there is enough
space and the activity is aligned with the content edge; otherwise the notice
appears above the activity. Manual blocked navigation scrolls the notice into
view without moving focus. Activating it explicitly focuses the activity heading.
The stable footer status remains the sole polite live announcer, visually clipped
while a contextual notice is present. A distant blocked destination retains the
general footer message if there is no unfinished local activity to identify.

Chromium and WebKit checks cover English/French copy, individual/group activities,
wide/side-panel/mobile layouts, enlarged text, focus preservation, explicit focus
transfer and removal on navigation. Unit checks cover successive unresolved gates
and clearing after completion. The final callout screenshots were visually reviewed.
These browser checks alone do not establish VoiceOver spoken delivery.

### Authorized VoiceOver follow-up

Two agents performed the follow-up: one controlled the WebKit/VoiceOver session;
the other independently reviewed the capture code without using the screen.
The local export fixture was rebuilt from the current source. Comments used a local
mock endpoint, with no requests posted to the published review service.

The independent review found that earlier Guidepup logs were not continuous speech
recordings: default initial capture could stop before a polite update, and stored
phrase arrays could pick up later commands. The corrected run used one raw
AppleScript observer and copied log snapshots. Repeated polls of the same last
phrase were not counted as repeated announcements.

| Journey | Observed result | Status |
| --- | --- | --- |
| Blocked Next | Focus remained on Next; contextual notice appeared. Automatic spoken notice was not captured. | Interaction tested; polite delivery cantTell |
| Focus and activate contextual notice | VoiceOver read the notice as a button, then spoke the required question as a level-three heading; DOM focus moved to that heading. | tested |
| Submit required activity | VoiceOver spoke “Correct and 1 more item group”; the completed activity's notice disappeared. | tested |
| Save local review comment | Saved comment appeared, draft cleared, and status became “Comment posted.” Captured speech included the focused button's “Posting…” label, not the success announcement. | Save behavior tested; polite delivery cantTell |
| Native polite status baseline | Live Regions was enabled and the DOM updated. No announcement appeared in the capture. | cantTell |

The native baseline prevents attributing missing captured speech to the runtime.
Exact-once polite delivery is not verified. No production code was changed to
compensate for the capture uncertainty. Evidence and the final environment cleanup
ledger were retained separately from the source tree; the earlier failed harness
run is not treated as a product failure.

VoiceOver and VoiceOver Utility were stopped after verification. An independent
cleanup check confirmed all 12 saved preference entries matched their original
file hashes or symlink destinations. Nothing was published.
