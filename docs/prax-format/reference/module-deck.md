# Module deck settings

For narrated graphics, follow [add narration to graphics](../skill/learners.md#add-narration-to-graphics).

Studio's Design panel enables module playback with `moduleDeck: true` in `course.yaml`. Missing or false keeps the existing page runtime. The value must be a boolean.

```yaml
title: Example course
moduleDeck: true
lessons:
  - introduction.prax
```

The Course settings panel sets each assessment's release rule. Add a slide's narration stop in `.prax` source. Both choices stay with their content:

```prax
---
title: Introduction
---

# Try it {deckStop}

::: choice Choose an answer {deckGate=attempt}
(x) First answer
( ) Second answer
:::

# Reflection {deckStop}

Read and reflect.
```

`deckStop` is an optional boolean on a page heading. True pauses after the slide's final narration segment. `deckGate` is an optional assessment or group setting, `attempt` or `pass`. An explicit rule also gates an assessment marked `required=false`. With no rule, required checks with an automatically checked answer use pass, required surveys or manually reviewed responses use attempt, and optional ungraded checks add no gate. A pass rule needs an automatically checked answer; private responses cannot release a gate.

Studio omits the correct-answer choice for text responses, file uploads, matrices and Likert responses, and explains the restriction beside the field. An imported unsupported `deckGate=pass` remains in the lesson until the author selects another rule. The field shows an empty choice, an error and the saved setting. Changing the response type makes the choice available again but requires an explicit selection to confirm the previously invalid setting. Assessment groups keep their separate answer and group-mode validation.

Studio saves these settings with the lesson and matches them to pages and blocks by their durable IDs, so preview and export apply the same stops and gates. Turning module playback off keeps your choices for later. Set `moduleDeck` only in `course.yaml`, never in lesson frontmatter, and write stops and gates on the pages and blocks themselves rather than as lists of IDs.

An attempt rule accepts a submitted answer; a pass rule opens after a correct answer, a passing group result, or a submitted final attempt when no retries remain. While retries remain, an incorrect answer keeps the pass gate locked. Unlimited attempts still require a correct answer. Listening duration never releases a gate. A blocked advance shows a persistent notice beside the first unfinished activity: in the left gutter when space allows, or above the activity on narrow layouts. Activating the notice moves focus to the activity. It clears when the required activities are satisfied or the learner navigates away. If the blocked activity is on another slide, the controls retain a general notice instead. Routine playback pauses do not add a visible status row. Earned access remains available for the learner attempt, including after resume; course reset clears it. Course completion and scoring keep their separate existing configuration.

Narration pauses after the final segment of a slide marked `deckStop`. Questions also pause after their prompt. Audio begins only after explicit Play. It continues through playable segments until a stop, a missing segment or module boundary. A new module starts paused.

Each contiguous lesson compiles to one document. Stable page URLs remain aliases to module fragments. Slides, history, reading seeks and module controls share the authored ordering and assessment gate rules. The narration reading text is available without generated audio. Recognized nonspoken Soniox delivery cues are omitted from this text, while human sound captions remain. Studio retains the original script for generation and recording freshness. The content keeps the native Praxity layout and authored width/spacing. The optional outline sidebar sits on the left and the optional current-slide transcript sidebar on the right, outside the content area. With the default Compact preset, both start closed and share sidebar styling. Authors can choose the initially open panel through `design.deck` on wide layouts. Fresh visits below the replacing-layout cutoff start with the full lesson visible and both panels closed. The learner's explicit saved panel choice takes precedence over authored settings and this fresh-visit default when browser storage is available. A saved open panel receives focus at its heading when it replaces the lesson; wide arrival keeps focus in place. At 950px wide and 36rem tall or larger, one open panel takes a side column of up to 374px, its normal 22rem width. This leaves at least 576px for the slide area, including its margins, even with Larger text. A 960px popup therefore shows the panel beside the slide. The outline and transcript remain mutually exclusive. Below either cutoff, an open panel replaces the slide area while playback and navigation remain available. On wide screens the reading panel scrolls independently. Closing the panel returns to the slide and restores focus to its toggle. The slide scrollport spans the available width, including the margins around the authored content. Timing data may drive seeking and highlighting, but timestamps are not displayed in the transcript. The reading panel shows only the current slide. It updates with navigation and narration auto-advance; inactive slide scripts are excluded from keyboard and screen-reader navigation. No separate captions interface is added in this mode.

Module playback does not support logic, variables, conditional content, branching action buttons, private gated responses, pass gates on manually reviewed responses or required non-assessment activities. Studio reports these instead of silently changing how they behave. Block identities must be unique in the sidecars and each lesson's pages must be contiguous.

## Longer assessments and surveys

A logical slide can contain a full, scrollable assessment or survey. Keep related
questions between the same page heading and the next page heading and use an group for a shared submit action. There is no fixed slide height, and scrolling
through questions does not advance to the next slide. Existing block and section
width settings still apply.

```prax
# Experience survey

::: group Your experience {mode=all requireAll deckGate=attempt}
::: choice How confident do you feel?
( ) Confident
( ) I would like more practice
:::
::: choice Which support would help?
( ) A worked example
( ) A discussion
:::
:::

# Reflection

Review what you learned.
```

The group releases access as one unit. `mode=all` submits the questions together;
`mode=oneOf` submits only the selected question, without requiring hidden
alternatives. A group-level `deckGate` overrides its members' release rules.
Otherwise, the group uses pass when any member requires pass, attempt when a
member requires attempt, and no gate when all members are optional and ungraded.
A pass gate uses the group's `passingScore`, or all automatically checked members'
pass results when no threshold is set. Retrying remains subject to each question's
attempt limit. If the learner exhausts those attempts without passing, the group
gate opens once the group is complete. A survey uses attempt, without turning
its answers into a score.
Group members must stay on the same logical slide. An `all` group can combine
automatically checked questions with written responses; a `oneOf` pass gate needs
an automatically checked answer for every selectable question.

The no-JavaScript baseline exposes all semantic slides and full reading text. These packaged access rules guide the learner flow; they do not protect confidential content. Physical Safari, assistive-technology and real LMS validation remain separate release checks.

## Learner controls and section navigation

Activating a slide, including a restored or directly linked slide, warms images
on that slide and its immediate neighbours in the current module. Neighbouring
images load eagerly at low priority. Other images retain lazy loading until their
slide enters that window. The document's static LCP image can also be requested
on a cold restore or deep link, before the runtime selects a slide.

Within these slides, tabs contribute only their selected panel's content,
including selected panels of deeper nested tabs. Hidden tab panels are excluded
from warming, even in the active slide. Tab selection retains native image loading
and can still show a late image.

Navigation does not wait for downloads or report prefetch failures. The first
image on the entering slide keeps its high-priority policy. Rapid navigation and
outline jumps outside the prepared window can still outrun downloads.

Next, Previous, keyboard arrows and outline links focus the destination's first
visible heading, or main content when no heading is available. Programmatically
focused headings have no outline or shadow, except the SCORM resume cue, which
keeps its ring. Keyboard focus rings remain visible
on interactive controls and keyboard-scrollable main content.

The footer groups outline/transcript and reading-support controls, the shared audio
transport when recordings exist, and labelled previous/next arrows with a slide
count. Playback speed stays directly available beside the transport, including on
narrow screens; course tools keep their own options disclosure. The outline
reserves a column for activity icons so slide titles align. Icon buttons use a
44px target and a visible marker when a toggle is on. The outline supplies direct
slide navigation. Follow narration is a toggle button in the Transcript panel,
with an accessible name and pressed state. Automatic slide advancement is a switch
in More, with an accessible name and checked state; disabling automatic
advancement still plays the remaining narration within the current slide and stops
any `cards {layout=slides advance=N}` playthrough. On a narrated slide, that
playthrough uses narration Play/Pause and stops at the last card or when narration
ends. A resume waits a fresh N seconds from the current card. Card-targeting
narration cues take precedence over `advance`. Slides without playable audio,
including intentionally unnarrated slides, have a separate Play cards/Pause cards
command. Cards never start turning on load or loop. See [cards](blocks-containers.md#cards).
Transcript text remains selectable, with quiet block-level seek actions only for recorded
segments. Production narration is not required for reading.

The footer's Play button starts the first recorded target at or after the current
position on the slide, skipping unrecorded blocks, and changes to Pause while
playing. Opening slides use this same control on desktop, tablet, and mobile.
Slides without recordings hide the timeline and show the unavailable playback
control labelled "No narration on this slide". Module completion
hides playback, keeps Review module in the content, and uses the footer's Next
button to continue.

An authored `---` divider stays inside the current slide and introduces no playback
stop or tracking event. A `# Title` page heading defines the next logical slide. `deckStop`
and interaction prompts define playback stops. Scrolling and section-heading links
do not advance slides or seek audio. Scrolling slide content keeps narration playing
and temporarily suspends automatic scrolling so learners can read at their own pace.
Deliberate slide or card navigation within a module pauses narration when Follow is enabled. When enabled, the existing floating section
navigation lists headings in the active slide and stays outside the transcript rail.
On narrow layouts, headings remain available in ordinary content order.

Slide changes start the content and transcript at the top; same-slide transcript seeks do
not reset content scrolling. Arrow-key navigation respects the authored keyboard
setting and leaves form controls and arrow-key widgets alone. Space toggles narration playback when focus is outside interactive controls and the current segment has audio; it does not replace native button or form keyboard behavior. In a mixed narrated module, an intentionally unnarrated slide shows a headphones-off control in the playback position. It remains keyboard-focusable, exposes its unavailable state, and explains “No narration on this slide” on hover or focus. Missing or failed recordings are not treated as intentional silence. Automatic advancement
waits when focus is within the outgoing slide.

At a module boundary, the same Previous and Next arrow buttons move to the adjacent
module. Their labels and tooltips change to Previous module or Next module. Left
and right arrow keys do the same when keyboard navigation is enabled. Previous is
disabled at the start of the course; Next is disabled at its end. Assessment gates
still apply. Automatic narration stops at each module boundary, and the new module
starts paused. Enhanced decks hide the separate footer links between modules;
the no-JavaScript fallback keeps those links available.

When navigation would disable the focused Previous or Next button at a course
boundary, focus moves to the enabled opposite button in the same control band
before disabling the original button. A one-slide presentation uses its active
content, or the open panel heading when that panel replaces the content. Other
focus stays in place, including during natural narration advancement. The existing
manual slide-position announcement remains the only boundary status message.

On a confirmed LMS resume, the host resolves the saved destination before Guided
initializes. Authored ordering and assessment gates still apply. Guided focuses
the allowed active slide heading, or the slide itself when it has no heading, and
announces one localized "Resumed at slide N of total: title" message. N and total
refer to the current module's slide counter. A bookmark denied by a gate identifies
the allowed slide, including when that requires returning to an earlier module.
Narration remains paused. If the learner's explicit saved panel choice replaces the
slide, that visible panel stays open and receives focus at its heading after slide
restoration. Initialization chooses one visible focus destination and preserves the
saved panel preference. Resume focus skips hidden headings and closed disclosures,
falling back to the visible slide when needed. Other arrivals keep the panel rules
below. Explicit links retain their own arrival behavior even when matching the saved
bookmark. Explicit fragments and ordinary navigation retain their
own arrival behavior. Ab-initio and HTML index returns start at the entry, retain
recorded visits and do not announce an LMS resume. Legacy bookmarks remain readable;
this policy does not change the authored grammar or saved-state schema.

## Studio presentation metadata

Studio's Design panel places Presentation above Theme. Course format offers Pages
and Guided slides and saves the choice as `moduleDeck` in `course.yaml`.
Edit settings for selects Course defaults or This module. Course defaults save
under `design` in `course.yaml`; This module writes lesson-level overrides.
Existing module overrides take precedence over course defaults.
Changing format applies its presentation defaults at course level and preserves
module overrides. Changing an option retains the format name with a Modified
indicator. Reset defaults restores the selected scope's presentation defaults
without changing its theme, assessment gates, or narration follow/auto-advance
preferences.

Selecting Guided slides opens the transcript initially on wide layouts, includes links to other
modules, and shows the course/module header. The Include links to other modules switch maps to
`deck.outlineDetail`. Selecting Pages opens the course outline initially and shows
the header; Show page sections enables `navFloatingToc` for long pages. Pages
always retains links to other modules. Turning off Show outline sidebar when module starts
keeps an outline menu available. Glossary page is also in Presentation. Previously authored navigation values remain
readable, but the panel offers only these two presentation families.

Studio-specific YAML options and authoring steps are documented in
[Studio Help: Edit YAML settings](https://praxity.io/en/help/studio/yaml-settings).
The content format carries these values as metadata; other renderers need not
implement Studio's navigation controls.

`design.deck` accepts these optional keys in course design defaults or lesson frontmatter:

| Key | Values | Default |
| --- | --- | --- |
| `preset` | `compact`, `transcript`, `selfPaced`, `custom` | `compact` |
| `outline` | boolean | `true` |
| `outlineDetail` | `currentModule`, `moduleLinks` | `moduleLinks` |
| `initialPanel` | `closed`, `outline`, `transcript` | `closed` for every preset; fresh replacing layouts start closed |
| `slideCounter` | boolean | `true` |
| `followNarration` | boolean | `true` |
| `autoAdvance` | boolean | `false` for every preset |
| `sequentialLessons` | boolean | `false` for every preset |

In Course settings, **Require lessons in order** saves `design.deck.sequentialLessons`
in `course.yaml`. Turn it on for mandatory training; leave it off for optional
learning. With `true`, learners must visit earlier slides before opening later
slides or lessons. With `false`, the outline, navigation controls and deep links
can open any slide up to the first unfinished assessment gate. Authored
`deckGate` rules still block access and keep their existing messages. Without a
valid inherited override, missing or non-boolean values resolve to `false`.
Courses without the setting, including existing courses, allow free navigation
up to the first unfinished assessment gate.
The setting follows the same per-key course/lesson inheritance as other deck
settings. The destination lesson decides whether its slides require earlier
course slides to be visited: use its `sequentialLessons` override, or the course
value when it has none. For example, a course with ordering off and a lesson
override of `true` locks that lesson until earlier slides have been visited.
A course with ordering on and a lesson override of `false` admits that lesson
freely up to any unfinished assessment gate. Every module uses these same
destination values for the outline, Next, direct entry, history and hash links.
It applies only to Guided slides; Pages has no visited-order lock.
Presentation resets preserve this learner-flow setting.

```yaml
design:
  deck:
    sequentialLessons: true
```

Explicit values override preset defaults. Studio chooses Compact when selecting or
resetting Guided slides. The persisted `transcript` preset remains accepted and
uses the same defaults as Compact, including a closed transcript. Custom uses
Compact defaults for omitted keys. Course and lesson deck settings merge per key;
each module retains its own resolved settings in full-course preview and export. When the layout replaces the
slide with a panel, below 950px wide or 36rem tall, a fresh visit starts closed so
the full lesson remains visible. This applies to explicit authored `initialPanel`
values as well as preset defaults. Wide arrival uses the authored panel without
taking focus. An initial outline falls back to closed when outline access is disabled. Transcript and reading tools remain
available. Follow/advance are learner starting preferences, not completion rules;
changes to them last within the module. The learner's explicit outline, transcript,
or closed panel choice is remembered across modules and visits when browser storage
is available. That explicit learner choice takes precedence over the authored panel
and the fresh replacing-layout default. A stored open choice that replaces the slide
receives focus at its panel heading. Initial resolution does not save a preference;
a later wide visit uses the authored panel until the learner makes a choice.
Disabling the slide count does
not remove screen-reader slide announcements. Transcript seeking preserves the
learner's Follow narration choice. Manual reading can temporarily suspend follow
scrolling; selecting a narration passage resumes it when Follow narration is on.

In Studio, **Include links to other modules** sets `outlineDetail` to `moduleLinks`
when on or `currentModule` when off. Both list the current module's slides. The default,
`moduleLinks`, also shows one link to each other module in course order, using its
module title and opening its first slide. Module links are bold and aligned with
module headings; the current module's slide links are indented beneath its heading. Those links obey the same assessment
gates as slide navigation. Other modules' slides are not listed until the learner
enters that module. This setting does not change authored titles or content. For a lesson override:

```yaml
design:
  deck:
    outlineDetail: currentModule
```

`design.navTopBar: true` enables a compact identity header above the slide and
sidebars. Omitted or false keeps the header hidden. Existing `navCourseTitle` and
`navLessonTitles` switches control the course and module title, respectively, and
default to true. The module title is primary; identical course and module titles
appear once. Disabling both titles removes the header. Course defaults and lesson
overrides apply to these switches, which are available in the deck Design panel.
The header wraps long titles and uses the current navigation theme.

`design.navFloatingToc` and `design.navKeyboardArrows` also apply to decks. Ordinary
page-navigation presets and their chrome options apply to standard pages. Deck
presets do not change theme, gates, stops or course playback mode. The no-JavaScript
fallback still exposes readable content and outline navigation.
