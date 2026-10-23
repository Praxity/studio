# Authoring for learners

Write short learner sentences and concrete instructions. Agree on register before writing, then apply the block guidance below. Each Before example is valid source that breaks the rule it illustrates.

## Agree on French register

Ask the person whether learners should be addressed as `tu` or `vous`, and whether to use Québec French or another regional variety. Record the answer in `outline.md` when composer provides one, or in the report to the person otherwise. Keep the register consistent in text that addresses the learner, including instructions, options, feedback and narration. Characters and quoted messages keep their own voices.

For school-age learners, use `tu` as the default unless the brief says otherwise. For adults, including older adults and adult professional courses, use `vous` as the default unless the brief says otherwise. In an unattended run, record the default taken and the unanswered questions in the outline or report.

A stated location, such as Québec, is evidence for the regional choice; record it as a provisional default and still ask for confirmation. With no region in the brief, record the regional variety as unresolved instead of silently choosing one.

Studio's built-in French controls use `vous` for now, even when course text uses `tu`; there is no course-level register setting. Keep those controls and never replace them with authored text. When `tu` is chosen or defaulted, composer tells the person about this mismatch and records it in the outline's Questions section. Without composer, include the mismatch in the report to the person.

When Québec French is requested, use its spelling and terminology. Ask about unfamiliar organisation-specific terms and record the answer with the register choice.

## Keep required content visible

Keep required content outside flips, tabs and accordions. Learners can miss content that needs a click to reveal it.

Before:

```prax
# Before your shift
::: accordion
:: Find the exit
Locate the emergency exit before starting work.
:::
```

After:

```prax
# Before your shift
Locate the emergency exit before starting work.
```

Use accordions for optional detail. Use tabs for optional, parallel material that learners do not need to compare or read in order.

## Use one callout per screen

Use at most one note callout per screen. Several callouts compete for attention.

Before:

```prax
# Check your route
::: note Keep the exit clear {tone=warning}
Move boxes away from the exit.
:::
::: note Find the assembly point {tone=tip}
Check the evacuation map.
:::
```

After:

```prax
# Check your route
::: note Keep the exit clear {tone=warning}
Move boxes away from the exit.
:::
Check the evacuation map to find the assembly point.
```

A screen is the visible area in preview, not a fixed number of source lines. Check phone and desktop widths in Pages and Guided slides.

## Use decorative images sparingly

A decorative image can set the tone, for example one image that opens a module, or the same picture on each self-assessment. Use at most one per screen, and leave most screens without one. Never put one between an instruction and its activity, where it competes for attention, and don't use one in place of an image that teaches. Mark it `{decorative}` so screen readers skip it.

Before:

```prax
# Inspect your equipment
![](/assets/cartoon-worker.png){decorative}
Check your hard hat for cracks.

# Spot the damage
Choose the hard hat you would replace.
![](/assets/cartoon-thinking.png){decorative}
::: choice Which hard hat needs replacing?
( ) A hat with a scuffed sticker
(x) A hat with a crack in the shell
:::
```

After:

```prax
# Inspect your equipment
![](/assets/module-opener.png){decorative}
Check your hard hat for cracks.

# Spot the damage
Choose the hard hat you would replace.
::: choice Which hard hat needs replacing?
( ) A hat with a scuffed sticker
(x) A hat with a crack in the shell
:::
```

Use a labelled photo or diagram when learners need to identify a part or compare details. The decorative flag controls alt text, not teaching value.

## Ask before revealing an answer

Put a question or prediction prompt on each flip-card front. Answering first is what makes the reveal teach.

Before:

```prax
# Practise isolation
::: cards
:: Isolation
::: back
Isolate energy before maintenance.
:::
:::
```

After:

```prax
# Practise isolation
::: cards
:: When should you isolate energy?
Think of your answer before revealing the back.
::: back
Isolate energy before maintenance.
:::
:::
```

Use flip cards to practise material already visible in the lesson. Use a plain card or list for statements without a question.

## Add narration to graphics

When a graphic is present, make narration add to the visible text. Reading it word for word makes learners process the same words twice.

Before:

```prax
# Release the pressure
![Valve beside a pressure gauge](/assets/valve.svg)
Open the valve slowly and watch the gauge fall to zero.
```

Spoken script: "Open the valve slowly and watch the gauge fall to zero."

After:

```prax
# Release the pressure
![Valve beside a pressure gauge](/assets/valve.svg)
Open slowly. Check for zero pressure.
```

Spoken script: "Watch the gauge as you turn the valve. Stop turning when the gauge reaches zero."

Narration scripts live in narration.yaml v2, outside the .prax file. Keep the transcript available. Without a graphic, spoken and written text can match.
