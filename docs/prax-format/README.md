# The .prax format

A .prax file holds one lesson in plain text. Grammar 4 combines Markdown prose with explicit blocks. Pages begin with a title. Settings stay in braces on structural lines; learner text belongs in subjects, bodies and named parts.

```prax
---
title: Workplace safety
lang: en
---

# Before you start

Every worker deserves to go home safe.

::: note Check your gear {tone=warning icon=alert-triangle}
Inspect your hard hat before each shift.
:::

# Protective equipment

## Head protection
Hard hats protect against falling objects.
## Eye protection
Goggles stop splashes and flying debris.
```

Read [document structure](reference/document-structure.md) for pages, blocks, items and parts. Use the [block index](reference/blocks.md) to choose a block. [Inline formatting](reference/inline-formatting.md) covers links, glossary terms, icons and source notes.

Use [authoring for learners](skill/learners.md#authoring-for-learners) to choose blocks that help learners complete the task.

For a multi-file course, define lesson order and shared speakers in [course.yaml](reference/course-manifest.md). [Frontmatter design](reference/frontmatter-design.md) holds presentation overrides. [Module decks](reference/module-deck.md) add narration stops and question gates. [Logic](reference/logic.md) defines variables and conditions.

[Examples](examples/minimal.prax) start with a small lesson. [Full-featured](examples/full-featured.prax), [interactive-module](examples/interactive-module.prax) and [quiz-course](examples/quiz-course.prax) cover more blocks. The [agent skill](SKILL.md) guides generated content. [CLI commands](cli.md) validate and export projects. [Authoring evidence](reference/authoring-evidence.md) reports the format experiments.

Example media paths are placeholders. Add those assets before exporting a copied example.

Grammar 4 replaces grammar 3 without backward compatibility. Convert older files with the converter before opening them in a grammar-4 host. Exported packages keep their existing format. Source contains no machine IDs; [identity sidecars](reference/content-identity.md) keep learner state and attachments tied to content.

This folder is the format's source. Releases mirror its committed files to [Praxity/prax-format](https://github.com/Praxity/prax-format). The Studio CLI ships these same reference pages and skill files.
