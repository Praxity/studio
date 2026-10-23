# Praxity Studio grammar reference

Praxity Studio supports Grammar v3 only. Grammar v3 is augmented Markdown: standard Markdown elements become Praxity Studio blocks through `as:` keys, while media uses a path or URL on its own line.

The published language reference is [`docs/prax-format/`](../../docs/prax-format/README.md). Start with [document structure](../../docs/prax-format/reference/document-structure.md) and the [block index](../../docs/prax-format/reference/blocks.md). The April 2026 design spec records historical proposals and does not define current syntax.

## Structure

- Each `.prax` file defines a lesson; `course.yaml` orders lessons in a multi-file course.
- `---` starts a page and may include a navigation title.
- `--` creates a styled divider within a page.
- `#` through `######` create visible H1 through H6 headings. Headings do not start lessons or pages.
- Frontmatter is allowed only at the start of the document.

```text
---
title: Workplace Safety
lang: en
---

# Safety Basics

--- Introduction

Welcome to the course.
```

## Blocks and parameters

Use `as:` after a Markdown element to transform it. Put parameters on following lines.

```text
> Wear appropriate protective equipment.
as: note
color: warning
style: filled
```

Media paths are content blocks:

```text
/assets/hard-hat.webp
alt: A yellow hard hat
width: full
```

Explicit containers use matching `close:` keys:

```text
as: col
First column

as: col
Second column

close: col
```

## Assessments

Assessment questions are headings followed by an `as:` key. Single-choice answers use `( )` and `(x)`; multiple-choice answers use `[ ]` and `[x]`.

```text
### Which item protects your head?
as: choice
points: 2
shuffle: true

( ) Safety glasses
(x) Hard hat
( ) Ear plugs
```

## Validation CLI

Run strict schema validation from the repository root:

```bash
pnpm grammar:validate path/to/file.prax
```

- Exit code `0`: only warnings or no findings
- Exit code `1`: one or more `error` or `critical` findings
- Exit code `2`: invalid usage
