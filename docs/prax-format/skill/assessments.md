# Write questions and feedback

Read the affected type in [questions and groups](../reference/blocks-assessments.md). The subject is the question. Body prose supplies visible instructions. Settings stay in braces; parts supply feedback and input hints.

For choice, use one marker kind throughout. Parentheses allow one selection; brackets allow several. Mark correct options for a knowledge check. Leave all options unmarked for an ungraded poll or reflection. Put question feedback before options and option feedback directly after its option, without a blank line.

Write or revise choice questions with the `assessment-writing` skill, which Rubato installs beside this one ([source](https://github.com/Praxity/rubato/blob/main/skills/assessment-writing/SKILL.md)). It covers distractors, feedback and the required independent cue probes. This guide owns the syntax: `{shuffle}` randomizes option order at runtime, and `dontKnow` adds an "I don't know" answer that the runtime keeps last, so never author it as an option. The answer has no letter; it shows a decorative "?" marker in the key position. Its accessible name stays "I don't know" in English or "Je ne sais pas" in French. Confidence and per-option "right when" fields are planned and have no syntax yet.

```prax
# Check your understanding

::: choice Which action is safest first? {attempts=2 shuffle}
incorrect: Review the emergency procedure.
(x) Isolate the hazard
feedback: Isolation prevents further injury.
( ) Keep working
feedback: Continuing leaves the hazard in place.
:::
```

Use [match](../reference/blocks-assessments.md#match) for bullet pairs joined by ->, [order](../reference/blocks-assessments.md#order) for numbered steps, and [categorize](../reference/blocks-assessments.md#categorize) for titled category items with bullet entries. Each needs at least two responses or categories.

[Fill-blank](../reference/blocks-assessments.md#fill-blank) supports typed, dropdown and word-bank responses. Star dropdown answers. Include every word-bank answer in bank, with enough copies for repeated blanks. Open blanks cannot reveal an authored answer.

[Rating](../reference/blocks-assessments.md#rating) uses 2 to 10 labels or a numeric scale. [Matrix](../reference/blocks-assessments.md#matrix) adds bullet statements after a numbered scale. [Hotspot](../reference/blocks-assessments.md#hotspot) needs one image, valid percentage coordinates and at least one correct spot.

Use [free-response](../reference/blocks-assessments.md#free-response) for reflections. Keep instructions visible; placeholders are brief hints. Set private to exclude LMS reporting.

A [group](../reference/blocks-assessments.md#group) nests questions with one submit action. Close each question before the group. PassingScore is a group threshold; questions have no per-question pass threshold. Use an attempt gate for surveys. See the [assessment variants pattern](../examples/patterns/assessment-variants.prax) and [module deck reference](../reference/module-deck.md).
