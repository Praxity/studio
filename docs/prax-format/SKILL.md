---
name: prax-format
description: Write, edit, validate and export Praxity course source (.prax lessons and course.yaml). Use to write or change lessons and blocks, fix grammar diagnostics, record course identity, or export HTML, SCORM or PDF.
version: "4.0"
---

# Author Praxity courses

A course folder holds `course.yaml` (lesson order, shared design and cast) and one grammar-4 `.prax` file per lesson. Grammar 3 needs conversion, which this pack doesn't include; stop and tell the person. `praxity` below is Studio's CLI; through Rubato it is `~/.praxity/bin/praxity`.

For a new course from a brief or a training problem, start with Rubato's [`composer` skill](https://github.com/Praxity/rubato/blob/main/skills/composer/SKILL.md). It owns the behaviour, barriers, pattern selection and outline, then hands source writing to this skill.

## Build or change a course

1. Read before writing: the lesson you are changing, the [course manifest](reference/course-manifest.md), [document structure](reference/document-structure.md) and the [block reference](reference/blocks.md) entry for every block type you touch. Start a new lesson from the [minimal example](examples/minimal.prax). `examples/patterns/` holds one focused example per block pattern.
2. Choose blocks by [authoring for learners](skill/learners.md). Load the topic guide for the work: [assessments](skill/assessments.md), [containers](skill/containers.md) or [design and media](skill/design.md).
3. Edit the `.prax` files and `course.yaml` directly. Keep learner language and untouched content as written, including links, glossary definitions and Unicode spacing.
4. Validate with `praxity inspect <course> --schema 1` and fix every diagnostic at its file and line. Then run the [validation checks](skill/validation.md).
5. If the course has scored choice questions, write and attack them with the `assessment-writing` skill before going on. Its independent probes are required.
6. Record identity, below.
7. Show the person the course with the `studio-editor` skill when it is installed. Export, then check accessibility with the `praxity-check` skill. For a design review, use `praxity-trace`.

Write source this way:

- Start every page with `# Title`. Open blocks with `::: type subject {settings}` and close each with `:::`. Start container items with `:: Title`.
- Put settings in braces on structural lines: `key=value` with no spaces around `=`, quotes around values with spaces, a bare key for true, each key once. Use only settings and parts the block reference declares.
- Put learner text in declared `name: text` parts. Images use `![alt](source){settings}`. Use [inline formatting](reference/inline-formatting.md) for emphasis, links, icons and source notes. Define a glossary term once with `[term]{definition}` and mention it elsewhere as `[term]{}`.
- Source holds content and human logic names. Studio keeps opaque IDs in `.praxity/identity/` ([content identity](reference/content-identity.md)); keep `.praxity/` and `narration.yaml` with the course in version control.

```prax
---
title: Workplace safety
lang: en
---

# Before your shift

::: note Check the route {tone=tip}
Locate the emergency exit.
:::
```

To change one field with the CLI instead, see [edit source nodes](cli.md#edit-source-nodes). Select a page as `--page <lesson.prax>:<page>`: a bare page number is ambiguous across lessons. For text targets use `inspect --text-fields`; `inspect --blocks --eligibility` is slow on large courses.

## Choose a block

Each row links to a complete grammar-4 lesson. Media paths are placeholders; add the assets before export.

| Block | Use | Example |
|---|---|---|
| `text` | Wrap prose to give it width, visibility or animation settings. | [patterns/text.prax](examples/patterns/text.prax) |
| `note` | Call out advice, a warning or a point to remember. | [full-featured.prax](examples/full-featured.prax) |
| `quote` | Show a quotation with its speaker or source. | [full-featured.prax](examples/full-featured.prax) |
| `figure` | Keep an image and its caption together. | [full-featured.prax](examples/full-featured.prax) |
| `float` | Let prose flow beside an image. | [patterns/image-layouts.prax](examples/patterns/image-layouts.prax) |
| `video` | Play a video with captions and a transcript. | [full-featured.prax](examples/full-featured.prax) |
| `audio` | Play an audio recording with a transcript. | [full-featured.prax](examples/full-featured.prax) |
| `embed` | Show an external resource inside the page. | [full-featured.prax](examples/full-featured.prax) |
| `bookmark` | Link to a resource in a preview card. | [full-featured.prax](examples/full-featured.prax) |
| `button` | Show a link as a button. | [full-featured.prax](examples/full-featured.prax) |
| `dialogue` | Present a conversation between named speakers. | [patterns/dialogue.prax](examples/patterns/dialogue.prax) |
| `table` | Compare rows of data or present them as a chart. | [patterns/data-display.prax](examples/patterns/data-display.prax) |
| `stats` | Show a few values with short labels. | [patterns/data-display.prax](examples/patterns/data-display.prax) |
| `accordion` | Let learners expand titled sections. | [patterns/faq-accordion.prax](examples/patterns/faq-accordion.prax) |
| `tabs` | Let learners switch between related sections. | [interactive-module.prax](examples/interactive-module.prax) |
| `sequence` | Present steps or events in order. | [patterns/guided-reading.prax](examples/patterns/guided-reading.prax) |
| `cards` | Group short entries or reveal answers on card backs. | [patterns/flashcard-drill.prax](examples/patterns/flashcard-drill.prax) |
| `comparison` | Compare two versions or approaches. | [full-featured.prax](examples/full-featured.prax) |
| `columns` | Place related content side by side. | [patterns/image-layouts.prax](examples/patterns/image-layouts.prax) |
| `choice` | Ask learners to choose one or more answers. | [patterns/assessment-choice.prax](examples/patterns/assessment-choice.prax) |
| `match` | Ask learners to pair related entries. | [full-featured.prax](examples/full-featured.prax) |
| `order` | Ask learners to put steps in the correct order. | [full-featured.prax](examples/full-featured.prax) |
| `categorize` | Ask learners to sort entries into categories. | [full-featured.prax](examples/full-featured.prax) |
| `fill-blank` | Ask learners to complete missing words. | [patterns/fill-blank-styles.prax](examples/patterns/fill-blank-styles.prax) |
| `free-response` | Collect a written reflection or explanation. | [patterns/assessment-variants.prax](examples/patterns/assessment-variants.prax) |
| `write-distractors` | Answer from memory, then write wrong options and compare mistaken ideas. | [write-distractors/en.prax](examples/write-distractors/en.prax) |
| `highlight` | Practise finding key ideas or evidence in a passage. | [highlight/en.prax](examples/highlight/en.prax) |
| `retrieval-sheet` | Print questions and answers for later recall practice. | [retrieval-sheet/en.prax](examples/retrieval-sheet/en.prax) |
| `self-check` | Compare a written answer with criteria and a model. | [self-check/en.prax](examples/self-check/en.prax) |
| `rating` | Ask learners to select a value on a labelled scale. | [patterns/assessment-variants.prax](examples/patterns/assessment-variants.prax) |
| `matrix` | Ask several questions that share one rating scale. | [patterns/matrix-likert.prax](examples/patterns/matrix-likert.prax) |
| `hotspot` | Ask learners to select a region of an image. | [patterns/hotspot-regions.prax](examples/patterns/hotspot-regions.prax) |
| `group` | Submit related assessment questions together. | [patterns/assessment-choice.prax](examples/patterns/assessment-choice.prax) |
| `checklist` | Let learners check off tasks. | [full-featured.prax](examples/full-featured.prax) |
| `signature` | Collect a drawn or typed acknowledgement. | [patterns/multicol-signature.prax](examples/patterns/multicol-signature.prax) |
| `rule` | Show content or change course variables when a condition holds. | [patterns/scenario-feedback.prax](examples/patterns/scenario-feedback.prax) |
| `divider` | Separate sections within a page. | [full-featured.prax](examples/full-featured.prax) |
| `page` | Start a page with its title. | [minimal.prax](examples/minimal.prax) |
| `image` | Show an image with a text alternative. | [patterns/image-layouts.prax](examples/patterns/image-layouts.prax) |
| `heading` | Give a section inside a page a heading. | [minimal.prax](examples/minimal.prax) |

French versions: [self-check](examples/self-check/fr.prax), [retrieval-sheet](examples/retrieval-sheet/fr.prax), [write-distractors](examples/write-distractors/fr.prax), [highlight](examples/highlight/fr.prax). Read each block's reference for its privacy, narration and print limits.

## Record identity

Run `praxity identity init <course>` before every export and before opening Studio. It records IDs for new or hand-written blocks and keeps existing ones. A rerun with nothing new changes nothing.

- `ok: true`: continue.
- A source error names a lesson file and line. Fix it and run init again.
- Any other refusal, including pending identity: stop. Don't export or open Studio. Show the person what init reported and ask how to proceed. Never edit or delete `.praxity/` to get past it.

Never pass `--rederive` unless the person has confirmed in this conversation that no version of the course was published.

Rederivation is planned; the current CLI doesn't accept it. Today, when init says a rewritten course needs new identity and it has never been published, stop and let the person decide.

## Export

```sh
praxity identity init ./course
praxity export ./course --format html --output ./course-html.zip
```

Formats are `html`, `scorm-1.2`, `scorm-2004` (ZIP output) and `pdf`. The output's folder must exist. Read the JSON result: a PDF lists `diagnostics` to review, and SCORM 1.2 reports `scorm12Storage.atRisk`. Fix problems in the source or `course.yaml` and export again; never patch exported files. For example, set `courseHomeUrl` in `course.yaml` to change where "Back to the course" goes. Export blocks critical accessibility issues; pass `--allow-critical-a11y-issues` only when the person asks for it. [CLI reference](cli.md#export-a-course).
