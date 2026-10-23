# Questions and groups

Settings go in braces on the opener. Parts hold learner text. Omitted settings keep the schema or renderer default.

## choice

Ask learners to choose one or more answers. See the [example](../examples/patterns/assessment-choice.prax).

The subject is the question. Write at least two nonempty options. `( )` and `(x)` allow one selection and at most one correct option. `[ ]` and `[x]` allow several selections. Keep the marker kind consistent. A choice with no correct option is an ungraded poll or reflection. It completes on submission, contributes no score, and does not require a correct result, even with scored or required. Its LMS result is neutral. Page completion rules still apply.

Put question parts before the first option. Put an option's `feedback:` directly after that option or its indented continuation, with no blank line. Each option owns at most one feedback part. Result-specific question feedback overrides option feedback; generic question feedback supplies a missing result. Timing words such as immediate and never are not feedback text.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

An explicit `{shuffle}` or `{shuffle=false}` overrides lesson and course component
defaults. Omitted shuffle uses the effective component default; without one,
options keep authored order.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `dontKnow` | `true`, `false` | Derived from scoring and pass gates | Offer the last "I don't know" radio. Single-answer choices only. |
| `private` | `true`, `false` | Omitted | Opt in to device-only practice. Single-answer choices only. |

```prax
# Example

::: choice Which action is safest first? {shuffle}
incorrect: Review the procedure.
(x) Stop work and isolate the hazard
feedback: Isolation prevents further injury.
( ) Keep working
feedback: Continuing leaves the hazard in place.
:::
```

Single-answer choices offer a final, unkeyed "I don't know" answer. Set `{dontKnow}`, `{dontKnow=true}` or `{dontKnow=false}` to override the default. Values must be booleans, without quotes. This setting is an error on multiple-answer choices and other block types. When omitted, it is on for ungraded checks and off for questions that contribute to a score or pass gate, including a group's or module deck's effective pass gate.

Choosing it counts as answered for required questions and attempt gates. It earns no points and follows the same retry and gate rules as an incorrect answer. A pass gate stays locked while retries remain and opens after the submitted final attempt when no retries remain. The chosen row has a neutral question-mark icon and `You chose "I don't know"`, or `Vous avez choisi « Je ne sais pas »`. The correct answer and explanation appear after submission. Group summaries count these answers separately. Print includes the option last. Option narration, when enabled, reads it last.

SCORM 1.2 saves a submitted choice and its interaction row together within the
4,096-character suspend-data limit. It compresses choice state losslessly when
needed and still reads existing JSON saves. If the payload cannot fit or the LMS
refuses it, the previous saved progress remains intact. The choice stays editable,
shows an English/French not-saved notice and permits retry without consuming an
attempt. Saving never removes another answer or interaction row to make room.
If saved data cannot be decoded, the course keeps those bytes and grants no
current credit from them. Every LMS-bound assessment, including open text, keeps
its answer editable and shows the storage notice. Tab storage can recover the
unsaved draft after reload for the same course, LMS learner and damaged attempt.
If tab storage or learner identity is unavailable, keep a copy before leaving.
The course reports no completion, success or score while the data is held. This
submission refusal applies only to SCORM 1.2; other formats retain their existing submission behavior.

Set `{private}` or `{private=true}` for device-only practice. Omitted privacy and `{private=false}` keep ordinary choice behavior. Write booleans without quotes. Privacy settings are unavailable on multiple-answer choices, even with a false value.

A private choice must be optional, unscored, outside assessment groups and without a gate. `scored=true`, `required=true`, either `deckGate` value and group membership are errors. A positive unscored `points` weight does not create a score. Optional containers may hold private choices. Grammar 4 has no container `required` or `deckGate` setting.

Course logic can't read a private choice. `if:`, `and:`, `or:` and `visible` can't refer to it, and `require` can't target it or a container that holds it. Public conditions may show or hide it.

Private choices use the same radios, Check, feedback and Try again as ordinary choices. A secondary-text line after the actions explains that the answers stay in this browser and are not sent to the LMS. When the provider identifies both learner and attempt, saved work is separate for that course, learner and attempt; otherwise the line explains that other people using this browser may see it. Restoring progress is shown silently. Saving and successful saves show no message; a failed save uses the existing error text style and is announced once on the first deliberate failed write, including after a silent restore failure. A private draft that adds a device policy needs a full preview refresh before it can render. Native PDF prints private choices like any other choice.

```prax
# Private practice

::: choice Which action comes first? {private scored=false required=false}
(x) Stop and check
( ) Continue without checking
:::
```

This differs from [free-response privacy](#free-response): free-response `private=true` suppresses interaction reporting but still saves the response text in the LMS's saved progress. That existing behavior is unchanged.

### Developer details

Unsupported private-choice scoring, required, gate or group settings use `private-choice-practice-only`. Container `required` and `deckGate` spellings retain `unknown-setting`.

Reporting uses the reserved `dont-know` response. SCORM 1.2 and 2004 record `neutral`, retaining the readable question description. SCORM 1.2 uses its existing performance interaction representation for readable choice identifiers. xAPI and cmi5 record `success: false` and a choice definition with an English/French `dont-know` entry. The course score still counts the answer as incorrect.

For the [private choice settings](#choice), omitted privacy and `private=false` add no state-policy entry. Quoted booleans use `bad-setting-value`. Privacy on multiple-answer choices uses `response-invariant` with `private-single-only`.

The [private choice logic restrictions](#choice) use `practice-no-tracking` at the condition, visibility setting or action, including attempted/completed field reads. Scalar action values that merely spell a reference remain literal text. Desktop project-session admission, preview input, export and the HTML build script enforce only `practice-no-tracking` and `private-choice-practice-only` from course validation; other course codes retain their existing non-blocking status. Refusals carry the source file, line, column, span and localization reference. A source refusal at startup leaves the editor session open with the preview fenced and delivers those diagnostics when its event stream subscribes, so authors can repair the source. The thin canvas still shows a generic failure until its diagnostic display is connected.

## match

Ask learners to pair related entries. See the [example](../examples/full-featured.prax).


The subject is the question. Write at least two flat bullet pairs as `- Prompt -> Answer`. Both sides need text.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

| Part | Learner text |
|---|---|
| `placeholder:` | Brief input hint. Keep instructions in visible body prose. |

```prax
# Example

::: match Question
- First -> Answer
- Second -> Other answer
:::
```

## order

Ask learners to put steps in the correct order. See the [example](../examples/full-featured.prax).

The subject is the question. Write at least two numbered steps in their correct order. Nested lists are errors.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

```prax
# Example

::: order Question
1. First step
2. Second step
:::
```

## categorize

Ask learners to sort entries into categories. See the [example](../examples/full-featured.prax).

The subject is the question. Write at least two titled `::` categories. Each contains a nonempty flat bullet list of its correct entries.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

```prax
# Example

::: categorize Question
:: First category
- First entry
:: Second category
- Second entry
:::
```

## categorize-item

Name one category and list its correct entries. See the [example](../examples/full-featured.prax).

Start an item with `:: Title`. Its title is required. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

## fill-blank

Ask learners to complete missing words. See the [example](../examples/patterns/fill-blank-styles.prax).

The subject is the question. Body prose needs at least one blank. Typed blanks accept `{colour|color}` alternatives, `{~permit*}` wildcard patterns, or open `____` blanks. Dropdown blanks need distinct choices and at least one starred correct answer, such as `{red|*blue}`. Word-bank answers must appear in `bank:`; repeated answers need enough occurrences. Escape a pipe within a word as `\|`. Open blanks cannot use feedbackMode=reveal. Variables, glossary terms, escaped braces and code are not blanks.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `typed`, `word-bank`, `dropdown` | `typed` | Select the style. |

| Part | Learner text |
|---|---|
| `placeholder:` | Brief input hint. Keep instructions in visible body prose. |
| `bank:` | Word-bank entries separated by unescaped pipes. |

```prax
# Example

::: fill-blank Question
Complete the {answer}.
:::
```

## free-response

Collect a written reflection or explanation. See the [example](../examples/patterns/assessment-variants.prax).

The subject is the question. Put instructions in visible body prose and a short input hint in placeholder. The button part labels the completion action. Private responses are excluded from LMS reporting.

The description keeps every paragraph, ordered or unordered list, nested list and supported inline format, including emphasis and links. An optional `::: text` wrapper keeps the same prose. Other nested blocks, headings, images, tables, dividers and code or math fences are refused with a source location during inspection. Put those beside the question instead.

HTML, previews, narration and PDF retain the complete description. Interaction reporting sends the question and description as plain text in authored order. Learners see the complete question and description, SCORM 2004 reports shorten that text to 250 characters, and xAPI reports keep it whole. The SCORM 2004 summary is localized and ends with an ellipsis when shortened. SCORM 1.2 has no interaction description field; its learner page still contains the complete description. Private responses send no interaction. Their text still saves in the LMS's saved progress; this setting does not make free-response storage device-only. Choice privacy has a separate device-only contract.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `download` | `txt`, `docx`, `both` | Omitted | Offer response downloads in these formats. |
| `private` | `true`, `false` | Omitted | Keep the response out of LMS reporting. |

| Part | Learner text |
|---|---|
| `placeholder:` | Brief input hint. Keep instructions in visible body prose. |
| `button:` | Submit or completion button label. |

```prax
# Example

::: free-response Question
placeholder: Write your reflection
:::
```

### Developer details

LMS suspend `blockState` stores free-response text even with `private=true`. See the [privacy guidance](#free-response).

## rating

Ask learners to select a value on a labelled scale. See the [example](../examples/patterns/assessment-variants.prax).

The subject is the question. Write a numbered list of 2 to 10 scale labels, lowest first, or set scale to a number from 2 to 10. Use one form.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `likert`, `stars`, `slider` | `likert` | Select the style. |
| `scale` | integer, at least 2, at most 10 | Omitted | Numeric rating scale. Use this or a numbered label list, never both. |

```prax
# Example

::: rating Question
1. Low
2. High
:::
```

## matrix

Ask several questions that share one rating scale. See the [example](../examples/patterns/matrix-likert.prax).

The subject is the question. Write a numbered scale of 2 to 10 labels, then at least one bullet statement. Each statement uses that scale.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `likert` | `likert` | Select the style. |

```prax
# Example

::: matrix Question
1. Low
2. High
- First statement
:::
```

## hotspot

Ask learners to select a region of an image. See the [example](../examples/patterns/hotspot-regions.prax).

The subject is the question. Put exactly one image before a nonempty flat bullet list of spots. Each spot is `- Label {settings}`. At least one spot must be correct. Coordinates are percentages of the image. Shapes must stay inside its bounds. See the spot settings below.

[Shared block settings](blocks.md#shared-block-settings) apply.

[Shared question settings and parts](blocks.md#shared-question-settings-and-parts) apply.

```prax
# Example

::: hotspot Question
![Description](/assets/diagram.png)
- Target {x=50 y=50 correct}
:::
```

## hotspot-spot

Define one selectable region on the question image. See the [example](../examples/patterns/hotspot-regions.prax).

Point uses x and y. Rect uses x, y, w and h. Ellipse uses x, y, rx and ry. Polygon uses at least three comma-separated coordinate pairs in points. Quote the polygon value. Widths, heights and radii must be positive.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `shape` | `point`, `rect`, `ellipse`, `polygon` | `point` | Select the shape. |
| `x` | number, at least 0, at most 100 | Omitted | Select the x. |
| `y` | number, at least 0, at most 100 | Omitted | Select the y. |
| `w` | number, above 0, at most 100 | Omitted | Select the w. |
| `h` | number, above 0, at most 100 | Omitted | Select the h. |
| `rx` | number, above 0, at most 100 | Omitted | Select the rx. |
| `ry` | number, above 0, at most 100 | Omitted | Select the ry. |
| `points` | string | Omitted | Question score weight. |
| `correct` | `true`, `false` | Omitted | Select the correct. |

## group

Submit related assessment questions together. See the [example](../examples/patterns/assessment-choice.prax).

The subject is an optional group title. Nest assessment blocks, each with its own closer. Text, headings, images, dividers and tables can introduce questions. At least one direct assessment is required. Nested groups and item containers are errors. A pass gate needs automatically checked answers; a oneOf pass group needs one in each selectable question. Passing score also requires checked content.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `mode` | `all`, `oneOf` | `all` | Select the mode. |
| `passingScore` | number, at least 0, at most 100 | Omitted | Group pass threshold as a percentage. |
| `showResultsSummary` | `true`, `false` | Omitted | Show the group results summary. |
| `requireAll` | `true`, `false` | Omitted | Require all group members. |
| `pointsOverride` | number, at least 0 | Omitted | Authored group points override. |
| `deckGate` | `attempt`, `pass` | Omitted | Guided-slide release rule. A pass gate requires an automatically checked answer. |

| Part | Learner text |
|---|---|
| `button:` | Submit or completion button label. |

```prax
# Example

::: group Check
button: Submit answers
::: choice Question
(x) Yes
( ) No
:::
:::
```
