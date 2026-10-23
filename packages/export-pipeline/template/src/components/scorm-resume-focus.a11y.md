# LMS resume orientation

Implementation policy, 2026-10-02, owner-approved visible resume cue.

The host confirms LMS entry or a standalone HTML return and resolves the bookmark before runtime-ready. Both transports use the course host's destination policy; standalone keeps its course-scoped local-storage adapter. Pages
uses the shared course shell to load the packaged classic `course-resume` script
only on confirmed resume, then insert a visible localized position prefix inside
its heading before focus. Static Pages keeps local-file loading without a module
loader. A load after `pagehide` cannot take focus. Position and title form one name from ordinary heading
text. Static
Pages receives the same orientation without a navigation island.
Its navigation island waits for that decision and suppresses ordinary arrival only
for the confirmed return. Guided uses the same host destination, applies its access
checks, then describes the allowed active slide with its module-local counter.
It focuses that slide's heading with the same visible prefix. An intentionally
opened panel that replaces the lesson gets the full-summary fallback.
The learner's explicit panel preference stays in effect.
Both modes skip hidden headings and closed disclosures before choosing their
content focus destination. Explicit index links keep their own arrival policy
even when they name the saved bookmark.
Narration stays paused. The next ordinary navigation keeps its existing heading
focus; since 2026-10-02 Pages writes no arrival position message (see
`docs/context/published-output-runtime.md`). No resume message is written to a
separate live region.

The primary applies only when the visible heading's plain text matches the resolved
title and it has no authored `aria-label` or `aria-labelledby`. Otherwise insert a
plain visible paragraph with the full resume position and title, `tabindex="-1"`,
as the sole focus destination before the original visible content/panel heading.
Show only its position visually. Keep the localized separator and resolved title
in the existing `praxity-a11y-sr-only` span, preserving the full focused text.
Keep the authored heading level, inline nodes and name overrides. Do not follow
fallback focus with a second heading focus. Repeated initialization adds no duplicate
cue. Keep it through blur and preference changes until leaving the restored page
or slide. Both modes clean up on `pagehide` so a browser history return cannot restore
the old cue. Cleanup removes only runtime-owned cue nodes. Print hides those nodes;
outline labels and document titles retain their compiler-owned canonical values.

Rejected approaches:

- Independent normal-arrival and delayed resume writes reproduce the Pages duplicate
  reported in audit findings 7 and 8 and addressed in PR #1240.
- A separate polite resume write paired with heading focus omitted position in the
  supplied SCORM Cloud P8c relaunch logs for both Pages and Guided. Research dated
  2026-10-02 inspected NVDA 2026.2 portable, Chrome for Testing 154.0.8037.92, Windows
  11 Pro 24H2 build 26100.9550. Speech requests for heading focus were captured,
  but no resume phrase. Later ordinary Guided navigation did capture slide position.
  This observation does not establish the cause; COM/UIA warnings need separate triage.
- Heading `aria-describedby` as the only position carrier depends on description
  reporting settings. A hidden prefix loses the visible, recoverable orientation.
- Assertive alerts, populated status insertion, fixed delays and repeated focus
  have no verified speech advantage for this ordinary arrival and can interrupt reading.
- Treating a nonzero slide or any stored bookmark as resume confuses fragments,
  ab-initio and HTML return with confirmed LMS entry.
- Closing a stored replacing panel for resume disregards the plan's explicit
  preference precedence. Keep it open and orient with the visible full summary.
- Independent panel and resume focus creates competing writes. Restore the active
  slide and transcript, then focus the single destination visible in that state.
- Marking every explicit index link as a resume confuses a selected link with a
  confirmed return when both name the same saved page. Only bookmark and gate
  redirects carry the confirmed marker; explicit links carry the false marker.

The name-from-content choice follows the [APG naming guidance](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
and [AccName 1.1](https://www.w3.org/TR/accname-1.1/). Visible recoverable position
follows [W3C cognitive location guidance](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p04-clear-steps/).
Their application to this LMS arrival is a recommendation, not a speech guarantee.
This deliberate focus change is orientation; missing live speech alone does not
establish a [WCAG 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) failure.

Automated checks cover focused name/text, no paired resume live write, destination
identity, visible active focus, preserved visits, denied gates, fallback, cleanup,
320px reflow, Larger text and print in Chromium, WebKit and Firefox. The same-origin
LMS fixture exercises both SCORM adapters. Retain the results with the tested revision and reproduction command.
Live primary/fallback listening in NVDA Chrome/Firefox, JAWS Chrome/Firefox and physical
Safari with VoiceOver on macOS/iPhone/iPad remains untested. Browser exposure cannot
establish speech during a real SCORM Cloud relaunch.
