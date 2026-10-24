# Revised choice attempt route, 2026-10-23

Published and preview hosts bind saved-choice evidence before restoring answers.
An unchanged answer restores its verdict, selection and attempt count. Changed
material offers New attempt while preserving the previous submission.

Reuse the outline action and secondary text. The new-attempt button is described
by the history notice, so reaching it supplies the reason for the action without
another live announcement. Activation uses the existing retry focus path to reach
the first enabled radio or checkbox. The action remains mounted until focus moves.
History keeps its saved verdict, score and completion until resubmission. Opening
New attempt and editing a draft preserve that result. A new submission replaces it,
including a lower score or a failed result. Unchanged retries add no history.
The notice does not display historical answer details. It also describes the
answer fieldset while its answers are disabled. A saved recovery draft restores its
selection without showing New attempt again; its old submission still counts as
history until the learner submits the new answer.

EN/FR component and browser checks cover single and multiple answers, Don't know,
draft reload, the accessible description and keyboard focus. The injected pages
and deck journeys cover light/dark appearance, 320px and 200% reflow (a 640×800
viewport's effective 320×400 CSS pixels), and ordinary attempt/pass gates in
Chromium, WebKit and Firefox. History introduces no waiting gate.
These checks do not establish spoken delivery with a screen reader.

# Choice storage refusal, 2026-10-19

A refused SCORM 1.2 submission leaves the selected answer editable and the submit
action available. One localized status notice explains that saving failed and
previous progress remains. Successful retry removes it. The existing result focus
path runs only for an accepted submission. EN/FR browser checks cover keyboard
retry and retained selection in Chromium, WebKit and Firefox; they do not establish
spoken delivery with a screen reader.

# Assessment action and review states, 2026-10-01

Reserve the existing Check/Submit row while retaining its interaction eligibility.
Group questions use the group's submission row. Put the focused result before the
attempt count and Try again in DOM and visual order. Empty feedback stays mounted
without adding a gap; status-only and authored feedback share the bordered surface.

Inline-only fill-blank results add the English/French review summary to the existing
feedback surface. Submission focuses Try again when available, otherwise the
card's Continue action. That button keeps its visible name and is described by
the result then authored explanation, using two ids in reading order when both
exist. Choice uses the selected option's inline explanation if there is no overall
explanation. Categorize/keyed matrix use their count summary; free responses use
Completed followed by authored feedback. Generic review status is excluded.
Reference ids derive from block identity. Retry clears input and button feedback
descriptions while retaining the visible choice review.
If no next action exists, focus the first nonempty feedback text with tabindex=-1.
No text uses a live region, and the feedback container stays plain and unnamed.

The generic choice status and inline-only fill-blank summary follow the result
rows, for individual questions and group members. Both say "results above" in
English and French; the generic summary remains excluded from button descriptions.

N11 focus decision, 2026-10-09, based on the 16-cell NVDA 2026.2 fixture trial
in Chrome 155 and Firefox 148, browse and focus modes:
- Shipped D: Retry described by the explanation, heard once in all four cells.
  Up Arrow reads the explanation in place once in both browsers.
- Rejected B: feedback group named by its text repeats the explanation in both
  browse-mode cells, despite reading it once in focus mode.
- Rejected C: group named by the short label omits the explanation in focus mode.
- Fallback A: feedback paragraph works in three cells. Firefox focus mode says
  only "paragraph". Terminal correct/exhausted questions and standalone completed
  free responses without Continue can reach this residual.

Group submissions now focus an available Retry, Continue or next action described
by the score. The summary is plain and nonfocusable unless no action exists;
terminal groups then focus it with tabindex=-1. Summary refreshes retain the node,
and partial saves retain score and review without a second live announcement.
Individual submissions yield focus when their group's required responses are ready;
incomplete groups retain member feedback focus. Group speech needs its own
NVDA recheck; browser assertions establish focus and description only. Keep the existing retry
button mounted until focus reaches an enabled response. Attempt, scoring and
saved-answer rules remain unchanged.

Matching prompts stay top-aligned and disabled answer text retains the course text
color. Submitted hotspot numbers and checks keep their colors without fading.
Matrix and likert radios and checkboxes now receive the same submitted lock as
other responses and re-enable on retry. The token owner chooses a readable
foreground for the actual accent fill. Mantine's generated accent shade can
differ from that fill, so its inherited mark color is insufficient in some dark
themes. Submitted controls retain a contrasting boundary and use the accent
foreground for their mark; hotspot checks use the same foreground. Forced colors
uses Canvas/CanvasText for marks, badges and matching answer text.

- Rejected: always-visible aria-disabled Check. Reserving its row preserves the
  accepted submission policy without introducing empty submissions.
- Rejected: focusing empty feedback or adding a second live result channel.
  Inline review needs a meaningful target, while the next action carries the feedback description.

Component regressions cover result order, English/French inline review focus, and
matrix locking/retry. Published checks measure action geometry, matching alignment,
painted review contrast across themes and forced colors, and wrong/retry/right
behavior in Chromium, WebKit and Firefox. These checks do not establish spoken
screen-reader delivery; no new NVDA session is part of this change.

# Fill-blank select containment, 2026-09-26

Keep dropdown and word-bank controls inside their sentence at enlarged text sizes.
Typed inputs retain their original inline grouping.

- Rejected: the original nowrap word-plus-control unit. At 320px and 34px text,
  small-preview units reached 305.8px in a 224.5px template and caused page overflow.
- Rejected as sufficient: wrapping the unit and subtracting the select margin from
  its maximum width. Small preview fit, but the full renderer's unconstrained
  inline-flex response wrapper still grew to its select's intrinsic width.
  The shell clipped that overflow while document scroll width remained 320px.
- Final: allow selectable units to wrap; subtract their 0.25em select margin;
  bound selectable response wrappers to 100% and let feedback wrap onto a new line.
  A wrapper width limit alone squeezed the correctness label into a narrow column.

Measured in Chromium and WebKit with the published fixture, full and small preview,
320px viewport, and the actual response font doubled from 17px to 34px. Before the
wrapper limit, full word-bank selects were 285px and 288px; the long dropdown was
625px and 627px. Afterward all selects were 216px inside the 224.5px template,
with matching right edges. Submitted correctness labels wrapped without exceeding
the template. Check descendant bounds and actual control font size, not only page
scroll width. These layout measurements do not establish screen-reader behavior.

# Matrix and categorize column sizing, 2026-09-29

Keep French option headers whole in published output, the module deck, and small preview.

- Rejected: automatic hyphenation. It split words that had room to stay whole.
- Rejected: a 24 px radio input minimum. It changed small-preview row geometry
  and broke the small-preview tests in round 1.
- Final: intrinsic option columns reserve room for their longest words. Labels
  wrap between words without automatic hyphenation. The radio inputs keep their
  original size and use target spacing to meet WCAG 2.5.8 AA.

The controller verified the layout in Chromium and WebKit via Playwright for
published output, small preview, and the module deck. The new hydration wait
still needs a browser rerun.

# Assessment item ids, 2026-09-29

Use block identity and source index for categorize rows, matching controls, and
fill-blank result references. Keep learner answer keys unchanged.

- Rejected: `attributes.options.id` on Mantine Select. ComboboxOptions overwrites
  it with its own id, leaving our controls reference dangling.
- Rejected: relying on Mantine's automatic controls reference, including with
  `keepMounted`. The mounted listbox had an id but the input lacked controls.
- Rejected: pointing controls at the dropdown wrapper. The popup reference must
  target the listbox, not its presentation wrapper.
- Final: set the listbox id through a scoped MantineThemeProvider component
  default. It inherits the course theme and adds no CSS or colour provider.

The component regression requires the controls reference to resolve to the
actual listbox. Chromium and WebKit verification remains with the controller.

[WAI-ARIA 1.2 combobox requirements](https://www.w3.org/TR/wai-aria-1.2/#combobox)
require controls to reference the associated popup with its supported popup role.

# Untouched required questions, 2026-09-30

Use option 1. Remove native `required` from choice and categorize radios,
matching comboboxes, and published rating radios. Single-choice and rating groups
expose `aria-required="true"` on `radiogroup`. Multiple-choice and categorize
fieldset labels retain the localized required text. Fill-blank selects and text
inputs already use `aria-required`, and matrix controls have no native `required`.

Group submission checks the existing answered state. Forward navigation checks
completion. Neither path calls `checkValidity()`, so removing native `required`
does not remove a validation gate. Failed group submissions set `aria-invalid`
and associate the error with the focused control. Preserve its original ARIA
attributes when the error clears, including supporting instructions.

- Rejected: option 2, native `required` with `aria-invalid="false"`. No WebKit or
  VoiceOver evidence establishes that it suppresses native constraint invalidity.
  Do not depend on an unverified override when native `required` is unnecessary.
- Rejected: `aria-required` on a generic checkbox group or an individual radio.
  Keep required text in the group label rather than adding unsupported ARIA.

The user verified the original "required invalid data" announcement with VoiceOver
in WebKit on 2026-09-29. Component checks verify no native required constraint on
untouched controls, failed-submit error association, and successful-submit cleanup.
The published browser regression records an ARIA snapshot and checks `:invalid`
in both shipping engines. Browser execution and the VoiceOver WebKit recheck are
pending with the controller. No screen-reader result is claimed here.

[HTML radio constraint validation](https://html.spec.whatwg.org/multipage/input.html#radio-button-state-(type=radio))
defines the empty required group as missing a value.
[WAI-ARIA invalid state](https://www.w3.org/TR/wai-aria-1.2/#aria-invalid)
places required-input error reporting after a submission attempt.
[WAI-ARIA required state](https://www.w3.org/TR/wai-aria-1.2/#aria-required)
provides required status independently of native constraint validation.

## Export test fix round

The two failing export assertions protected the former native `required`
attribute. Keep the new group-level `aria-required` contract and require no
`aria-invalid` on untouched static or enhanced markup. Preserve the other checks
for accessible names, points, radio identity, selection and completion events.

The no-JavaScript choice baseline already has disabled inputs, no submit control
and a localized explanation that the question needs JavaScript. It does not offer
a native browser submission flow. Keep that baseline inert and free of initial
invalid state rather than adding a new submit behavior. The published rating
fieldset has no form submission flow either. Its enhancer finds all radios by
`input[type="radio"]`, not `[required]`, and retains completion tracking after
selection. Existing defaults and saved project formats do not change.

Regression checks cover the no-script assessment contract and required status
before and after rating enhancement. The existing required-rating lifecycle test
also covers blocked continuation, focused errors and successful completion.

## Activity review and full matching answers (2026-10-06)

Categorize and keyed matrix rows expose an icon and localized result text.
Submission focuses the count summary with `preventScroll`; ancestor scroll
positions are retained while the new feedback changes layout. Unkeyed matrix
surveys keep their existing neutral feedback. Existing answer controls, authored
feedback, saved learner state and SCORM grading remain their owners.

Matching retains the Mantine combobox's accessible name, value, listbox identity
and keyboard interaction. A wrapping `aria-hidden` sibling paints the complete
answer beside the separate chevron. Review contrast checks measure this painted
copy against the input background, including forced colours. Rejected: widening
the input alone, which still truncates longer answers on phones.

Published-output regressions cover row results, summary focus and scroll, resume,
matching wrapping, checkbox contrast and keyboard state, and localized downloads.
Chromium and WebKit checks are automated evidence; manual screen-reader speech
has not been checked for this change.

## Unreadable LMS state (2026-10-19)

The existing localized status notice applies to every LMS-bound assessment while
SCORM 1.2 data is held unreadable. Submission keeps the draft and controls editable,
without feedback, completion or attempt credit. Tab recovery restores the draft.
Rejected: the choice-only guard, which let open answers appear submitted and vanish
on reload. EN/FR component tests cover both ordinary and private-course providers.
The focused browser spec covers notice, keyboard submission and reload in all three
engines. Spoken screen-reader delivery remains untested.
