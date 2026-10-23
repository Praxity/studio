# Tasks, signatures and rules

Settings go in braces on the opener. Parts hold learner text. Omitted settings keep the schema or renderer default.

## checklist

Let learners check off tasks. See the [example](../examples/full-featured.prax).

The subject is an optional title. Write at least one `- [ ] Task` line. Use `- [x] Task` for an authored checked state.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `required` | `true`, `false` | Omitted | Require completion. |
| `shuffle` | `true`, `false` | Omitted | Shuffle response entries or items. |

```prax
# Example

::: checklist
- [ ] First task
:::
```

## self-check

Compare a written answer with criteria and a model. See the [example](../examples/self-check/en.prax).

Self-checks work in preview, HTML, SCORM and xAPI exports. In xAPI, the default private mode keeps answers on the device; `private=false` permits answer reporting to the configured learning record store. Write an answer, select Check to reveal the criteria, then select Show feedback to compare with the model and hints. Check moves focus to the first criterion. Show feedback keeps focus and announces one summary. Zero selected criteria is a valid comparison. Editing keeps the previous comparison until the next Show feedback; Start over clears it. Narration reads only the task.

Without JavaScript, the task and labelled answer field remain usable with a notice that comparison needs JavaScript. Model answers and hints ship in each activity's own runtime asset and can be read from the offline package. Missing required runtime assets refuse compilation. Browser print includes only revealed content and the current answer. Learner PDF export refuses courses containing self-checks. Enable the author answer sheet to export a workbook with tasks, model answers, evidence numbers and criterion hints.

Your narration script may give away the model or hints before someone answers. When narration is on and the segment is enabled, Studio warns on the self-check's opening line if your script contains a whole model, hint or evidence field, or if the whole script or a quoted excerpt appears in one of those fields. Matches need at least eight characters. Matching ignores case and treats curly quotes as straight quotes. Container overrides also check their nested self-checks. Invalid drafts keep their grammar errors without this advice. Your script stays as written. Use the default task script to keep the answer out of speech.

Write the task as the required opening-line subject. Add one nonempty `model:` before the first item, then at least one `:: Label` criterion. Close the block with `:::`. Each criterion needs a nonempty label and `missed:` hint; `evidence:` is optional. Evidence must appear exactly once in the model, counting overlaps: `aa` appears twice in `aaa`. Omit evidence for a whole-answer criterion. An explicitly empty evidence part is an error.

The task, model, labels, hints and evidence are literal plain text. Markdown, HTML, variables, doodles and glossary syntax are not interpreted. A backslash before ASCII punctuation escapes it, so `\*` gives `*`. Other backslashes stay, so `\d+` and `a\b` keep theirs. Indent continuation lines two spaces to keep line breaks, including another paragraph after a blank line.

Authored self-check fields have inclusive maxima: task 400; model 1,500; each criterion label 120; each hint (`missed:`) and non-null evidence 1,500. Counts use decoded Unicode code points, after escape decoding and continuation/CRLF handling. An astral character counts once; combining marks count separately. Spaces and line breaks count. Studio refuses overflow without trimming, truncating or normalizing authored text; Studio reports the refusal on the self-check's opening line without quoting hidden content.

These limits apply only to authored text. Learner answers and the number of criteria have no length or count limit. Drafts keep the learner's complete answer.

If SCORM 1.2 saved progress can't be read, Studio leaves it untouched and shows an unavailable notice. Learners can edit their answer, but Show feedback stays unavailable. The browser tab can restore the unsubmitted draft after reload for the same course, LMS learner and unreadable saved progress. It won't restore that draft for another course, learner or saved record, or after saved progress loads successfully. If the browser can't save the draft or the LMS can't identify the learner, keep a copy before leaving.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `required` | `true`, `false` | Omitted | Require a valid Show feedback action for completion, including zero ticks. |
| `deckGate` | `attempt` | Omitted | Release a guided-slide gate after a valid Show feedback action. |
| `private` | `true`, `false` | `true` | `false` allows the learner's answer in LMS reporting. |

| Part | Learner text |
|---|---|
| `model:` | Required nonempty model answer before the first criterion. |

Ticks express the learner's judgment; they do not give a score or establish correctness. Ordinary `free-response` keeps its existing behaviour.

Self-checks never contribute to course pass marks, scored assessment lists or required knowledge checks. Logic predicates requesting correctness or a score are source-located errors, including in visibility settings and across lessons. `isAttempted` and `isCompleted` count only the learner's latest Show feedback. While saved progress is loading or can't be read, gates that depend on them stay closed.

Unknown or duplicate settings, `deckGate=pass`, scoring, points, attempt limits, shuffle, correct/incorrect feedback, download and scenario settings are errors. Assessment groups cannot contain this block. Nested blocks, free prose, item settings, repeated named parts and a model after the first item are errors. Diagnostics identify the source line. No email context fields are supported. No Turn into targets or group wrapping are declared.

Read the [English example](../examples/self-check/en.prax) or [French example](../examples/self-check/fr.prax).

### Developer details

Narration spoiler advice uses `ENARRATIONSELFCHECKSPOILER`.

Decoded Unicode code-point counts use `[...text].length`. Host-supplied criterion IDs have a 120-code-point maximum. The library's context fields (`to`, `initials`, `subject`, `placeholder`) each have a 120-code-point maximum; Studio source and export refuse context.

Generic reader pages and blocks contain only the literal task, Studio settings and criterion IDs. Author tools obtain model answers, labels, hints and evidence through grammar's `readSelfCheckContent(read, blockId)` accessor; invalid content or missing identities refuses that access. Ordinary inspection uses the prompt projection. Guarded `inspect --blocks` source is explicitly author-raw.

## self-check-item

Give learners one criterion and a hint for missing it. See the [example](../examples/self-check/en.prax).

Start each criterion with `:: Label`. The label is required plain text. The next item or block closer ends the criterion. Items accept no settings, nested blocks or free prose. Each named part may appear once. Use two-space continuations to preserve line breaks.

| Part | Learner text |
|---|---|
| `missed:` | Required nonempty hint explaining what to add. |
| `evidence:` | Optional nonempty text that appears exactly once in the model. Omission means a whole-answer criterion. |

## highlight

Practise finding key ideas or evidence in a passage. See the [example](../examples/highlight/en.prax).

Highlight is optional practice. It publishes with limited support in preview, HTML, SCORM 1.2/2004, xAPI and module decks. Author it in grammar 4 source. Marks and Check results stay in page memory, reset on reload and never contribute to reporting, scores or completion. Browser Print / Save as PDF prints the authored passage followed by the complete Answer. Native PDF export refuses any course that contains highlight practice, hidden or nested included, and answer-sheet exports too. Block narration is unavailable. Canvas Read runs the learner activity; Canvas Edit shows the plain passage and collapsed native Answer, with no learner controls, memory notice or highlight text editing.

Without JavaScript, the passage and Answer stay readable. If the highlight script fails to load, a notice in the learner's language says marking is unavailable.

Write a required literal title after `::: highlight`, an optional `question:` before the first item, then one or more `:: Passage` chunks and the `:::` closer. Each item may have one nonblank `note:` explanation. Evidence mode requires a root question. At least one chunk must have `key=true`. Bare `key` means true; omitted keys remain absent and explicit false stays false.

The first chunk starts paragraph 1. Later chunks continue the current paragraph with one ordinary space between chunks, unless `paragraph=true` starts another paragraph. `paragraph=false` continues it; `paragraph=true` on the first chunk is harmless. Blank source lines are trivia. Chunk subjects are single-line text; questions and notes support the ordinary two-space continuations.

[Shared block settings](blocks.md#shared-block-settings) apply only to the root. Its heading uses an explicit `level`, otherwise the current heading scope with fallback 2. The only additional root settings are:

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `mode` | `key`, `evidence` | `key` | Find key ideas or evidence for a question. |
| `maxMarks` | Whole number, 1 or more | Derived from mode and target count | Limit marked chunks. |

| Part | Author text |
|---|---|
| `question:` | Optional single nonblank question before the first item; required in evidence mode. |

Items accept only `key` and `paragraph`, both boolean, default false. Accept bare flags and unquoted `true` or `false`; quoted booleans refuse. Write `maxMarks` as a decimal integer from 1 to 9,007,199,254,740,991. Quoted numbers, zero, signs, fractions, leading zeroes and exponents refuse. Its omitted default is the target count in evidence mode and target count plus one in key mode. Authored limits may be below the target count or above the chunk count.

Inclusive limits count decoded Unicode code points: title 120, question 400, chunk 1,500 and note 1,500. Astral characters count once and combining marks separately. There is no paragraph count, chunk count or aggregate passage length maximum. Authors cannot set chunk IDs.

All fields are literal text. Decode ASCII punctuation escapes once, normalize CRLF to LF and remove two continuation spaces. Preserve other whitespace, Unicode, HTML entities, quotes and French punctuation exactly as authored. No automatic French spacing occurs. Markdown, HTML, glossary, icon, variable and footnote spellings stay visible as written. Chunks can't start or end with a space, including a non-breaking space. Studio reports an error instead of removing the space.

In a header subject, any unescaped `{` preceded by a space or tab starts settings, even in mid-chunk. Write `:: Read \{this} carefully. {key}` for literal braces. Keep settings last on the line. Unescaped braces can make the line invalid.

Blank or repeated question/note parts, root notes, item questions, `answer:`, `feedback:`, prose and nested blocks refuse. A question after the first item belongs to that item and is disallowed; evidence mode still diagnoses its missing root question. Unknown part names remain prose. Unsupported root settings, including `scored`, `required`, `private`, `deckGate`, `state`, `id` and `commit`, refuse even when their value is false.

Optional placements match retrieval sheets: top level, accordion, tabs, sequence, columns, either card face and module deck. Assessment groups and their nested descendants refuse. Public conditions may show or hide the activity. No highlight field can be read by `visible`, `if:`, `and:`, `or:` or compiled reference operands, including completion fields and inline block output. `require` cannot target highlight or a container holding it; required or gated ancestors also refuse. Duplicate names cannot shadow this boundary. No Turn into conversion or assessment-group wrapping is offered.

### Developer details

Native PDF refuses with `highlight-native-pdf-unsupported` before producing a partial workbook.

Literal fields bypass glossary, icon, variable and footnote collectors. Decoded chunk edges refuse nonstructural whitespace, including U+00A0, without trimming. Ordinary ASCII header separator whitespace follows the lexer.

Each generated chunk identity uses the existing item allocator and is unique across paragraphs. The `paragraph` flag is structural and disappears from content. Mode is resolved once; an omitted `maxMarks` stays absent.

Field diagnostics retain the exact header, part or setting span. Length diagnostics are `practice-title-too-long`, `practice-question-too-long`, `highlight-chunk-too-long` and `highlight-note-too-long`. Edge whitespace produces `highlight-chunk-whitespace`; a passage without targets produces `highlight-no-target`. Remaining upstream semantic refusals use the content-free `highlight-invalid`. Compiled-only refusals identify a block and structural path without invented source coordinates.

The lexer reports `settings-not-final` for settings followed by text; malformed groups retain `missing-settings-close` or `unclosed-setting-quote`. `maxMarks` must match `^[1-9][0-9]*$` and fit a JavaScript safe integer. Course logic refusals use `practice-no-tracking`; unsupported own settings retain `unknown-setting`.

## highlight-item

Give learners one passage chunk to mark. See the [example](../examples/highlight/en.prax).

A required literal passage subject, followed by an optional single explanation. Each item is one selectable chunk. Root settings do not apply to items.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `key` | Unquoted `true`, `false`, or a bare flag | `false` | Mark an authored target. |
| `paragraph` | Unquoted `true`, `false`, or a bare flag | `false` | Start a new paragraph before this chunk. |

| Part | Author text |
|---|---|
| `note:` | Optional single nonblank literal explanation. |

The bilingual course covers key and evidence modes, next to an ordinary reporting choice and a public variable. Read the [English lesson](../examples/highlight/en.prax), [French lesson](../examples/highlight/fr.prax) and [course manifest](../examples/highlight/course.yaml).

## write-distractors

Answer from memory, then write wrong options and compare mistaken ideas. See the [example](../examples/write-distractors/en.prax).

Available in published HTML, SCORM, xAPI, standalone launch, preview and native PDF. Learners write an answer, check it against the author's answer, self-rate, then write wrong options and compare their mistaken-idea labels. This comparison does not grade the meaning or quality of their answers. Drafts and comparisons stay on this device and contribute no LMS response, score, objective or completion gate. Without JavaScript, the question and an answer field remain with a notice that checking needs JavaScript and typing is not saved.

Native PDF defaults to a workbook with the question, instructions and writing space. Explicit `includeAnswerSheet` adds the right answer and numbered labels with their paired authored options. Ordinary browser print includes current writing and only content already revealed.

Write the question as the required opener subject, then exactly one nonblank `answer:` before the first item. Each `:: Mistaken idea` item needs a nonblank label and exactly one nonblank `option:`. On screen, learners see the right answer after Check and the authored wrong options after Compare. An explicit PDF answer sheet also prints them. Automatic narration reads only the question.

Fields are literal plain text. Markdown, HTML, glossary, footnote, variable and icon spellings never expand. ASCII punctuation escapes decode once; other backslashes stay. Two-space continuations belong to their named part; CRLF becomes LF and the continuation prefix is removed. Preserve all remaining whitespace and Unicode. A field with only spaces counts as blank; other text keeps its spaces.

Inclusive authored limits count decoded Unicode code points, including whitespace: question 400, right answer 300, mistaken idea label 120, wrong option 300. Astral characters count once, combining marks separately. Labels must be distinct after trimming, collapsing whitespace and lowercasing; Unicode is not normalized. A wrong option matching the right answer under that same comparison produces a warning at its `option:` line. Content quality still needs human review.

[Shared block settings](blocks.md#shared-block-settings) apply. The additional `count` setting is an unquoted integer from 1 to 5, default 2. It sets the number of learner wrong options independently of the authored item count. At least one authored item is required, with no maximum. Items accept no settings. Identities come from Studio, never authored IDs or references; each item's identity pairs its label and option.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `count` | Unquoted integer 1–5 | `2` | Number of learner wrong options. |

| Part | Author text |
|---|---|
| `answer:` | Exactly one nonblank right answer before the first item. |

Privacy is unconditional. `private`, `scored`, `required`, `points`, `deckGate` and `id` are unsupported regardless of value. Additional parts, free prose, nested blocks, repeated answers or options, and a root answer after the first item are errors. Unknown parts are disallowed prose.

Optional placement is allowed at the top level, in accordions, tabs, sequences, columns, either card face and module decks. Assessment groups, Turn into conversions and group wrapping are unavailable. These activities expose no logic fields and cannot supply scores, completion or progression conditions. Course validation refuses every field read in `visible`, `if:`, `and:` and `or:`, regardless of the actions. It also refuses `require` targeting the activity or any containing container, and authored required/gated containers holding it, at the offending condition, action or setting. Public conditions may show or hide the activity.

Read the [English example](../examples/write-distractors/en.prax) or [French example](../examples/write-distractors/fr.prax).

### Developer details

The right answer, labels and author options stay out of generic reader blocks, inspection, glossary, footnotes and diagnostic text. The typed `writeDistractors` reader projection stores only the literal `question`, `count` and ordered `items: [{ id }]` in `data.content`, plus the resolved heading `level` and supported shared settings. Count has no second location in generic data. Moving or reordering an item preserves its allocated identity; copying it allocates a fresh identity. Source and outline labels remain available to explicit author tools. The grammar-owned `readWriteDistractorsContent(read, blockId)` accessor reconstructs validated library Content from the admitted source and identities, never from the generic projection. Its content-free error codes are `write-distractors-not-found`, `write-distractors-identity-invalid` and `write-distractors-content-invalid`. Compiler admission constructs fresh closed prompt records and refuses extra fields, accessors and non-plain objects with `EWRITEDISTRACTORSPROMPT`. Narration source fingerprints include only the literal question. See the [author guidance](#write-distractors) for narration and print behaviour.

Blankness uses `trim()` without trimming valid text. Structural, blank, duplicate and length checks precede the upstream `validateContent`; an unexpected refusal becomes the content-free `write-distractors-invalid` diagnostic.

IDs use ASCII letters, digits, underscores or hyphens, at most 120 code points, unique and never `other`.

A wrong option matching the right answer uses the nonblocking `write-distractors-author-right` warning. Course logic refusals use `practice-no-tracking`; unsupported own gate settings retain `unknown-setting`.

## write-distractors-item

Pair one mistaken idea with a plausible wrong option. See the [example](../examples/write-distractors/en.prax).

Start each mistaken idea with `:: Label`. Each label is nonblank, at most 120 Unicode code points and distinct after whitespace/case comparison. Items accept no settings, nested blocks or free prose. Each item pairs its label with exactly one nonblank wrong option of at most 300 Unicode code points. Both fields are literal plain text. Items publish with their parent activity in HTML, SCORM, xAPI and native PDF; authored labels and options appear during comparison or in an explicit PDF answer sheet.

| Part | Author text |
|---|---|
| `option:` | Exactly one nonblank wrong option for this mistaken idea. |

## retrieval-sheet

Print questions and answers for later recall practice. See the [example](../examples/retrieval-sheet/en.prax).

An optional, unscored practice sheet. Published HTML and SCORM show numbered questions and answers, with a blank date line when JavaScript is unavailable. With JavaScript, learners choose a date, switch between Front and Back, and print one sheet. Date and side stay in memory until reload; choosing a date sends no reminder. The sheet sends no practice records to the LMS and writes no learner storage.

Write a required title of 1–120 Unicode code points and 1–8 question items. Each item has a required question of 1–400 code points and exactly one nonblank `answer:` of 1–1,500 code points. Whitespace-only fields are refused. Limits count decoded code points, including spaces and line breaks; astral characters count once and combining marks separately. Fields are never truncated or Unicode-normalized.

[Shared block settings](blocks.md#shared-block-settings) apply; no other root settings are accepted. Omitted width inherits layout; omitted level follows heading scope with fallback 2. Scoring, points, required, gates, privacy, dates, spacing, side, reminders, learner inputs and authored IDs are unsupported, even with a false value. Retrieval sheets cannot belong to assessment groups or supply scores, completion or progression conditions. Optional placement is allowed at the top level, in accordions, tabs, sequences, columns, either card face and module decks. No Turn into targets or group wrapping are declared.

Title, questions and answers are literal plain text. Markdown, HTML, glossary, footnote, variable and icon spellings are displayed literally. Escape structural line shapes with a backslash before ASCII punctuation; escapes decode exactly once, and other backslashes remain. Two-space continuations belong to the answer; structural CRLF becomes LF and the two-space continuation prefix is removed. Remaining authored whitespace is preserved. A field with only spaces counts as blank. Source header separators and settings braces remain grammar syntax.

Automatic narration reads the title and questions, leaving out answers, dates and controls. Native PDF workbooks show questions and writing space; an explicit answer sheet adds numbered answers. The published sheet includes all authored answers, so learners can read them without completing the questions.

Course logic can't read a retrieval sheet. `if:`, `and:`, `or:` and `visible` can't refer to it, and `require` can't target it or a container that holds it. Required or gated containers can't hold a sheet. Public conditions may show or hide it.

Read the [English example](../examples/retrieval-sheet/en.prax) or [French example](../examples/retrieval-sheet/fr.prax).

### Developer details

Blankness uses `trim()` only for validation. The upstream content schema and `validateContent` own the content contract. Studio supplies field-specific length, missing, blank, duplicate and structure diagnostics before semantic validation; unexpected library refusal becomes `retrieval-sheet-invalid` without exposing exception text. Item IDs come from the existing identity owner, never source: ASCII letters, digits, underscores or hyphens, unique within the sheet, at most 120 code points. Reordering retains identity; copying creates new identity. The authoring reader projects a typed `retrievalSheet` block with `data.content` containing the title and ordered questions (`id`, `question`, `answer`), plus the resolved heading `level`. All authored answers are intentionally included. Literal fields bypass glossary, footnote and icon collectors. Inspection reports each field as plain text. Narration pauses after the title and retains every repeated question. Narration scripts, source content and fingerprints exclude answers, dates and control copy. Learner state, dates and DOM state are absent. See the [author guidance](#retrieval-sheet) for narration and PDF output.

The [retrieval-sheet logic restrictions](#retrieval-sheet) use `practice-no-tracking` at the condition, visibility setting, action or required/gated ancestor setting. Unsupported container settings still receive `unknown-setting`. The sheet's own unsupported gate settings receive `unknown-setting` without an additional practice refusal. Compiled required or gated containers are also refused.

## retrieval-sheet-item

Pair one recall question with its answer. See the [example](../examples/retrieval-sheet/en.prax).

Start each question with `:: Question`. The question is required literal text. The next item or the block closer ends it. Items accept no settings, body prose or nested blocks. No author-written IDs are accepted.

| Part | Meaning |
|---|---|
| `answer:` | Exactly one nonblank literal answer, 1–1,500 Unicode code points. Two-space continuations preserve line breaks. |

### Developer details

Missing title/question gives `missing-subject`; overflow gives `practice-title-too-long`, `practice-question-too-long` or `practice-answer-too-long` at the relevant opener/part. Missing, blank and repeated answers give `missing-part`, `empty-part` and `duplicate-part` respectively. Zero or nine items gives `child-count` at the root opener. Unknown parts such as `answers:` and `feedback:` are body prose and give `disallowed-child`; the required answer remains missing. An answer before the first question, stray prose or nested blocks also gives `disallowed-child`. Setting and closer diagnostics retain their ordinary source locations.

## signature

Collect a drawn or typed acknowledgement. See the [example](../examples/patterns/multicol-signature.prax).

The subject is the required label. The sublabel is optional. Mode selects the initial draw or type method; both methods remain available.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `mode` | `draw`, `type` | `draw` | Select the mode. |
| `required` | `true`, `false` | Omitted | Require completion. |

| Part | Learner text |
|---|---|
| `sublabel:` | Text below the signature label. |

```prax
# Example

::: signature Confirm completion
sublabel: Your signature
:::
```

## rule

Show content or change course variables when a condition holds. See the [example](../examples/patterns/scenario-feedback.prax).

The opener has no subject or settings. Write one if part, optional and or or parts, then one or more then parts. Use and or or within one rule; mixing them is an error. See [logic expressions](logic.md).

| Part | Learner text |
|---|---|
| `if:` | First condition. |
| `and:` | Additional condition. Repeat to require all conditions. |
| `or:` | Alternative condition. Repeat to accept any condition. |
| `then:` | Action. Repeat for several actions. |

```prax
# Example

::: rule
if: ready
then: show @target
:::
```
