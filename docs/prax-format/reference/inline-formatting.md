# Inline formatting

Use inline formatting within learner text. Structural settings, URLs and rule expressions keep their own syntax.

| Form | Meaning |
|---|---|
| `**bold**`, `*italic*` | Strong and italic emphasis |
| `~~struck~~`, `==marked==` | Strikethrough and highlight |
| `` `code` `` | Literal code |
| `[label](destination)` | Link with a formatted label |
| `[term]{definition}` | Glossary definition with a formatted label |
| `[term]{}` | Mention of a term defined elsewhere in the course |
| `@icon{mail}` | Decorative Tabler icon |
| `@circle{text}`, `@underline.wavy{text}`, `@highlight{text}`, `@box{text}`, `@arrow{text}` | Hand-drawn marks |
| `@source{citation}` | Numbered source note |
| `@sources` on its own line | Source-note list at that position |
| `{{learnerName}}` | Variable interpolation |

```prax
# Equipment

Inspect your **hard hat** and [PPE]{Personal protective equipment}.
Use [PPE]{} before entering the site.
@highlight{Review the [procedure](https://example.com/procedure).}
Contact support @icon{mail}.
Read the annual review @source{Safety team, Annual review, 2025.}

@sources
```

Glossary labels can contain emphasis, as in `[**PPE**]{Protective equipment}`. Repeated mentions share a course definition. Conflicting definitions and missing definitions are course errors. Set design.glossaryPage to false to keep tooltips without publishing the aggregated glossary page.

Inline Markdown links open in the current tab. To author a new-tab link, use a
[button block](blocks-content.md#button) with `{newTab}`. Published new-tab links,
including links inside glossary popovers and media fallbacks, carry a decorative
external-link icon and a visually hidden warning, "(opens in a new tab)" in English
or "(s’ouvre dans un nouvel onglet)" in French.

Doodles accept nested inline formatting. Modifiers include wavy, thick, thin and dashed. Keep the marked text readable without the decoration.

## Where formatting works

Formatting applies in prose, headings, titles, item labels, captions, table cells, questions, option labels, feedback and other displayed learner text. Code stays literal. Link destinations and source-note contents keep their raw values. Balanced parentheses and escaped closing parentheses can occur in link destinations. Images use the [image line syntax](blocks-content.md#image).

Glossary entries in matching prompts and answers, ordering labels, categorization items, matrix statements and rating labels also appear on the course glossary page. Glossary syntax inside inline code stays literal, including beside a real term in the same field.

See [inline icons](../inline-icons.md) for icon names and rendering. See [logic](logic.md) for variables.

### Footnotes in choice option labels

Avoid raw HTML in option labels with footnotes. Learners may see the note as
plain text, such as `@source{N}`. Editing the note later may make them answer again.
Use Markdown formatting or move the note to the question. Studio's advice
checks the label's source, including code that looks like HTML.

## Escaping

A backslash escapes ASCII punctuation. Use `\*`, `\[`, `\{` or `\@` to write literal syntax. Unknown escapes such as `\q` stay literal. Code needs no punctuation escapes.

```prax
# Literal syntax

\::: not a block
Write \*stars\* without emphasis.
Use `@icon{mail}` to describe an icon command.
```

## Inline tree for tool authors

tokenizeInline returns a lossless tree with half-open UTF-16 offsets into the decoded lesson. Sibling ranges partition the selected source; children nest inside their parent. Delimiters belong to the parent. A formatted glossary label remains one term node.

Malformed reserved forms remain unresolved and render literally. renderInlineTree can flatten links and definitions for noninteractive output. Course validation resolves glossary mentions. HTML and URLs still pass through the host's sanitizer and URL policy.

parseInlineMarkdown exposes the same node vocabulary for display fields. It keeps
that producer's existing escapes and unresolved forms, including its legacy
`@footer{note}` and `@footer.insert` spellings. It does not change grammar syntax.

Source notes, highlights, doodles and glossary terms record their adjoining
ancillary ASCII whitespace in `referenceTrivia` ranges. Original text, raw
spelling and spans remain intact. At sequence edges an ancillary node owns its
adjoining separator. Between material siblings the final existing gap remains a
word separator. Consecutive ancillary nodes share this classification. Bold and
italic are transparent to it; links and strikethrough keep their own sequence
boundaries. Highlight, doodle and term contents belong to the whole ancillary node.

inlineParagraph marks compiler-created paragraph envelopes. A paragraph containing
only ancillary nodes records the generating kind in `generatedBy`, with `sources`
identifying a source-list insertion. These node details
are compiler data; display HTML and exported block JSON keep their existing bytes.

Choice signatures hash effective compiler facts and whitespace-normalized visible
text. Term labels, highlighted words and doodled words always count, whether a
mark covers part or all of a field. Definitions, compiler footnotes, source lists
and glossary entries do not count. Attributes and element boundaries do not count;
paragraphs are separated by a space. Literal code keeps its text. Exported choice
facts carry this signature; saved-answer behaviour remains unchanged until activation.

`choiceContentSignature` counts an icon by its name from the compiler node.
This keeps an icon distinct from its escaped literal spelling. Swapping, adding or removing an
icon changes the hash. Catalog paths and paint, resolved versus unresolved
display, and the icon's display HTML or SVG details do not count. This applies
inside every compiler inline context that contributes visible text.
Every question receives a hash, including questions with icons.

Authored raw HTML `data-praxity-inline-icon` markers do not create icon nodes in
the current grammar or display producer. In a field with a matching compiler
tree, its literal text counts. Without such a tree, material uses the sanitized
HTML's text and image sources. Attributes and SVG paths do not count. Marker
attributes never confer compiler provenance.
