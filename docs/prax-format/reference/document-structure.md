# Document structure

One .prax file is one lesson. Optional YAML frontmatter comes first. Every content page starts with a `# Title` line. Content before the first page is an error.

## Frontmatter

Start the file with YAML between `---` lines. Use a mapping. Add title and lang for a named lesson and its language. Frontmatter holds no IDs.

One UTF-8 BOM may precede the opening fence. Metadata edits retain it and preserve source bytes outside the edited YAML entry, including comments and mixed line endings. An opening fence without a closing fence is invalid; metadata edits refuse it.

Source edits also preserve CRLF, lone CR, mixed line endings and a missing final newline outside their edit ranges. Generated insertion text uses the first authored line ending; copied source retains its raw endings. Invalid ranges and malformed metadata produce coded refusals without writing. Whole-node deletion may include one adjacent blank line; appending to an unterminated final line may insert its terminator. Recorded inverses restore the original bytes.

```prax
---
title: Workplace safety
lang: en
kicker: Module 1
time: About 12 minutes, including the lab
variables:
  ready: false
pageStyles:
  plain:
    cornerImage: none
design:
  palette: standard
---

# Before you start {style=plain}
```

| Key | Meaning |
|---|---|
| title | Lesson title. Set it for navigation. The reader accepts files without frontmatter. |
| lang | Lesson language, such as en or fr. Overrides course locale, then workspace defaultLocale; the fallback is en. |
| kicker | Group label, such as Module 1. Renders above the lesson's first page heading. Omit for no label. |
| time | Free text describing how long the lesson takes, such as About 12 minutes, including the lab. Renders below the lesson's first page heading. Omit for no time line. |
| design | Presentation overrides. See [frontmatter design](frontmatter-design.md). |
| pageStyles | Named page treatments. Select one with a page's style setting. |
| variables | Map of variable names to scalar starting values. See [logic](logic.md). |

Narration scripts and attachments live in narration.yaml. Course cast belongs in course.yaml. Identity lives in .praxity/identity/. Keep those sidecars with the project.

Write `kicker` and `time` as YAML strings in the lesson's language. Numbers, booleans, nulls, lists and mappings are invalid. Blank strings show no line. Both fields render as plain text outside the H1, on the first page only, in single- and multi-lesson courses. The time line is small, regular, non-italic text. Neither field changes the heading's accessible name or description. They accompany the visible page heading; `{hideTitle}` omits them along with that heading.

Both lines use the theme's muted text colour. Accent and ink slide backgrounds use a contrasting foreground instead. Text wraps within the page; neither line uses opacity to reduce contrast.

When the first page heading has its own `kicker`, the lesson frontmatter `kicker` takes precedence, so only one label appears above that H1. Without a lesson kicker, the heading keeps its own. Other headings retain their kickers. The single-lesson sidebar also keeps the lesson kicker above its lesson title as a navigation label.

## Pages and navigation

`# Title` starts a page and supplies its visible H1 and navigation label. Use `{hideTitle}` to keep the label and heading scope without displaying the title. Put `nav:` directly below it for a shorter label. Page settings are in the [page reference](blocks-content.md#page).

```prax
# Comment je me vois, comment je vois les autres {hideTitle deckStop}
nav: Positions de vie

Réfléchissez à votre prochaine conversation.

# Next steps

Choose one action to practise.
```

A bare `---` within a page is a divider. It does not start another page. `--- {palette=warm}` starts a coloured section band. See [dividers](blocks-content.md#divider).

## Blocks, items and parts

Open a block with `::: type subject {settings}`. Close it with a bare `:::`. Each closer ends the innermost open block. Close nested blocks before their parent.

```prax
# Practice

::: tabs Before and after
:: Before your shift
Review overnight incidents.
::: note Check the route {tone=tip}
Locate the emergency exit.
:::
:: During your shift
Escalate hazards promptly.
:::
```

`:: Title {settings}` starts an item inside an item container. The next item or the container closer ends it. Items have no separate closer. Only the type's declared parts count as named text. A part is `name: text`; indent its continuation lines two spaces, including another paragraph after a blank line.

```prax
# Watch the walkthrough

::: video /assets/intro.mp4 {captions=/assets/intro.en.vtt}
title: Emergency route
transcript: Start at the loading dock.

  Follow the green exit signs.
:::
```

## Settings

Put settings in braces at the end of the structural line. Write `key=value` with no spaces around the equals sign. Quote values containing spaces or braces. Bare boolean keys mean true; explicit true and false also work. Write each key once.

```prax
# Practice

::: note A reminder {tone=tip visible="ready is true"}
Check your equipment.
:::
```

Setting lines under the opener are not supported. Put learner text in the subject, item title, body or a declared part. Unknown named lines remain prose. A declared part with whitespace before its colon remains prose and warns. U+202F after the colon is a separator.

## Heading scope

Use `##` through `######` headings inside a page. Authored levels stay as written. A block title is one level below the last content heading in its scope. Titled container items are one below the container title. Untitled containers keep the surrounding scope; an untitled item uses its container's level.

Headings inside an item affect only that item. They do not change a sibling or the question after the container. Use `{level=4}` to override a derived level, from 1 to 6. Deeper derived titles stop at H6 and warn. See [headings](blocks-content.md#heading).

## Prose and literal content

Use Markdown paragraphs, lists, pipe tables, block quotes, code fences and `$$` math blocks. Images use Markdown syntax on their own line. Underlined setext headings are not supported.

A list starts with `- ` or `1. `. A numbered list starts at its first authored number; later numbers do not change its sequence. Indent continuation lines to the item's text column, two spaces after `- `, three after `1. `, four after `10. `. Blank lines keep a list going. An unindented non-item line ends it.

Code fences open with at least three backticks and close with at least that many. Code, math and block-quote contents shield structural line shapes. Prefix a structural line with a backslash to make it literal. See [inline escapes](inline-formatting.md#escaping).

## Named page styles and corner artwork

Define styles in frontmatter pageStyles and select one with `# Title {style=name}`. The style must exist. Corner artwork is decorative; meaningful images need ordinary image blocks with alt text.

| Property | Values | Default |
|---|---|---|
| cornerImage | Asset path or none | No artwork |
| background | paper, surface, accent, ink | paper |
| measure | narrow, default, wide, full | default |
| align | start, center | center |
| scale | default, display | default |
| chrome | default, minimal | default |
| accentRule | true, false | false |
| mediaPlacement | stacked, left, right | stacked |

The image is omitted in dark mode, forced colours and print. Keep local artwork with project assets. See [frontmatter design](frontmatter-design.md) for course-wide presentation.

## Errors

Grammar 3 declarations are refused with the archived converter command. This includes `as:`, `close:`, titled `---` page breaks, `--` section breaks, `var:`, `when:`, standalone `if:`, `card: back`, bare media paths or media URLs, and legacy `firstPage` metadata. Whitespace after the colon is optional. Code fences, inline code, math, quotes and escaped lines shield examples. Body markers in frontmatter are metadata. The `if:` part inside a grammar 4 rule remains valid. Convert a legacy course with the command the refusal message prints.

Diagnostics identify a source line and column. Invalid drafts retain their text for correction. Unknown settings do not become resolved settings. Orphan closers and items remain recovery text. A page boundary or end of file reports unclosed blocks. Fix errors before export.

This example intentionally produces only `bad-setting-value` at line 2, column 12. Stats accepts 2 to 4 columns.

```prax error=bad-setting-value@2:12
# Stats
::: stats {columns=5}
| 3 | Checks |
:::
```

This example intentionally produces only `stray-closer` at line 2, column 1. Remove the extra closer.

```prax error=stray-closer@2:1
# Practice
:::
```

Course validation also checks cast speakers, logic names, variables, page styles and glossary definitions across files. Two conflicting glossary definitions report both locations; write `[term]{}` for later mentions. See [validation](../skill/validation.md).

Retrieval-sheet declarations use literal title/question/answer fields and item-only `answer:` parts. Published sheets provide questions, answers, date controls and instance-scoped printing; see [retrieval-sheet](blocks-interactive.md#retrieval-sheet) for limits, settings and bilingual examples.

Write-distractors declarations use a literal question, root `answer:` and labelled items with `option:`. See [write-distractors](blocks-interactive.md#write-distractors) for limits, settings and bilingual examples.

Highlight declarations use literal passage chunks, target flags and optional notes for memory-only practice. See [highlight](blocks-interactive.md#highlight) for limited support, settings and bilingual examples.
