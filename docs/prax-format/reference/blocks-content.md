# Content blocks

Settings go in braces on the opener. Parts hold learner text. Omitted settings keep the schema or renderer default.

## text

Wrap prose to give it width, visibility or animation settings. See the [example](../examples/patterns/text.prax).

Wrap prose when it needs settings. The opener has no subject. Plain paragraphs need no wrapper.

[Shared block settings](blocks.md#shared-block-settings) apply.

```prax
# Example

::: text
Text
:::
```

## note

Call out advice, a warning or a point to remember. See the [example](../examples/full-featured.prax).

The optional subject is a title. The body is prose. An untitled note shows its tone's label.

Follow [use one callout per screen](../skill/learners.md#use-one-callout-per-screen) when adding notes.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `tone` | `note`, `info`, `tip`, `success`, `warning` | `note` | Select the tone. |
| `style` | `outline`, `shaded` | `shaded` | Select the style. |
| `icon` | icon | Omitted | Omit for the tone's icon, use a lowercase Tabler name to choose one, or none to suppress it. |

```prax
# Example

::: note {tone=note}
Text
:::
```

## quote

Show a quotation with its speaker or source. See the [example](../examples/full-featured.prax).

The opener has no subject. Put the quotation in the body and its attribution in parts. Use a plain `>` quote when attribution is unnecessary.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `none`, `outline`, `shaded`, `primary`, `secondary` | Omitted | Select the style. |
| `source` | url | Omitted | Safe attribution URL. |

| Part | Learner text |
|---|---|
| `speaker:` | Speaker's displayed name. |
| `work:` | Work containing the quotation. |

```prax
# Example

::: quote
Quoted words
speaker: Speaker
:::
```

## figure

Keep an image and its caption together. See the [example](../examples/full-featured.prax).

The opener has no subject. Write exactly one image, then caption prose. The image keeps its own alt text and settings.

Follow [use decorative images sparingly](../skill/learners.md#use-decorative-images-sparingly) when choosing the image.

[Shared block settings](blocks.md#shared-block-settings) apply.

```prax
# Example

::: figure
![Description](/assets/image.png)
Caption
:::
```

## float

Let prose flow beside an image. See the [example](../examples/patterns/image-layouts.prax).

The opener has no subject. Put exactly one image first, then the content that flows beside it.

Follow [use decorative images sparingly](../skill/learners.md#use-decorative-images-sparingly) when choosing the image.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `side` | `left`, `right` | `left` | Select the side. |

```prax
# Example

::: float {side=left}
![Description](/assets/image.png)
Text
:::
```

## video

Play a video with captions and a transcript. See the [example](../examples/full-featured.prax).

The subject is a required file path or safe media URL. Use the parts for learner text. Supply captions for speech and a transcript. Times are finite nonnegative seconds.

Visible `caption:` text uses grammar-4 inline syntax. `@source{...}` adds a numbered page footnote, as it does in figure captions.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `captions` | path | Omitted | Safe local or HTTPS .vtt caption track. |
| `start` | number, at least 0 | Omitted | Start time in seconds. |
| `end` | number, at least 0 | Omitted | End time in seconds, strictly after start or zero if start is omitted. |
| `autoplay` | `true`, `false` | Omitted | Request automatic playback. Browser policies can prevent it. |

| Part | Learner text |
|---|---|
| `title:` | Visible title. |
| `caption:` | Visible caption. |
| `transcript:` | Text version of the recording. |

```prax
# Example

::: video /assets/example.mp4
transcript: Transcript
:::
```

## audio

Play an audio recording with a transcript. See the [example](../examples/full-featured.prax).

The subject is a required file path or safe media URL. Supply a transcript through the named part. Times are finite nonnegative seconds.

Visible `caption:` text uses grammar-4 inline syntax, including numbered page footnotes for `@source{...}`.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `captions` | path | Omitted | Safe local or HTTPS .vtt caption track. |
| `start` | number, at least 0 | Omitted | Start time in seconds. |
| `end` | number, at least 0 | Omitted | End time in seconds, strictly after start or zero if start is omitted. |

| Part | Learner text |
|---|---|
| `title:` | Visible title. |
| `caption:` | Visible caption. |
| `transcript:` | Text version of the recording. |

```prax
# Example

::: audio /assets/example.mp3
transcript: Transcript
:::
```

## embed

Show an external resource inside the page. See the [example](../examples/full-featured.prax).

The subject is a required HTTPS URL on a third-party origin. Provide a title that names the embedded resource.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `height` | integer, above 0 | Omitted | Embed height in pixels. |

| Part | Learner text |
|---|---|
| `title:` | Visible title. |

```prax
# Example

::: embed https://example.com/embed
title: Embedded resource
:::
```

## bookmark

Link to a resource in a preview card. See the [example](../examples/full-featured.prax).

The subject is a required Markdown link. The block has no body.

[Shared block settings](blocks.md#shared-block-settings) apply.

```prax
# Example

::: bookmark [Resource](https://example.com)
:::
```

## button

Show a link as a button. See the [example](../examples/full-featured.prax).

The subject is a required Markdown link. The block has no body. URLs follow Studio's safe link policy.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `filled`, `outline`, `light` | `filled` | Select the style. |
| `newTab` | `true`, `false` | Omitted | Open the link in a new tab, with a decorative external-link icon and a localized warning for screen readers. |

```prax
# Example

::: button [Open resource](https://example.com)
:::
```

## dialogue

Present a conversation between named speakers. See the [example](../examples/patterns/dialogue.prax).

The opener has no subject. Write `- speaker: words` for each turn. Indent continuation paragraphs two spaces. Define speaker keys in the course manifest's cast. Lookup ignores case; names keep their authored spelling. Local speaker declarations are not supported.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `bubbles`, `script` | `bubbles` | Select the style. |

| Part | Learner text |
|---|---|
| `caption:` | Visible caption. |

The default `bubbles` style puts the speaker's name inside each bubble, above the
paragraphs. Decorative portraits sit beside the bubble on the speaker's start or
end side. Below 20rem of dialogue width, portraits share the name row inside a
full-width bubble. At wider sizes, a turn without a portrait keeps that column
when another turn has one. Consecutive turns by the same speaker sit closer together and hide
the repeated portrait and visible name; the name remains available to assistive
technology. The `script` style keeps its plain transcript layout.

```prax
# Example

::: dialogue
- alex: Hello
- sam: Hello
:::
```

## table

Compare rows of data or present them as a chart. See the [example](../examples/patterns/data-display.prax).

The opener has no subject. Write a pipe table in the body. A plain pipe table needs no wrapper. Use the wrapper for chart settings or named text. A delimiter row sets cell alignments; escaped pipes and pipes inside matched code stay inside their cells.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `chart` | `bar`, `line`, `scatter`, `area`, `radar`, `stacked` | Omitted | Select the chart. |
| `orientation` | `vertical`, `horizontal` | Omitted | Select the orientation. |
| `header` | `row`, `column`, `none` | Omitted | Select the header. |
| `striped` | `true`, `false` | Omitted | Select the striped. |
| `showPoints` | `true`, `false` | Omitted | Chart point markers. Omit to keep the renderer default. |
| `gridlines` | `none`, `rows`, `columns`, `inside`, `all` | Omitted | Select the gridlines. |
| `columnAlignments` | string | Omitted | Comma- or whitespace-separated left, center, right values. |
| `sortOrder` | `none`, `asc`, `desc` | Omitted | Select the sortOrder. |

| Part | Learner text |
|---|---|
| `title:` | Visible title. |
| `subtitle:` | Text below the title. |
| `caption:` | Visible caption. |
| `alt:` | Text alternative for the table or chart. |
| `xLabel:` | Horizontal axis label. |
| `yLabel:` | Vertical axis label. |
| `description:` | Text explanation of the chart. |

```prax
# Example

::: table
| Heading | Value |
| --- | --- |
| Example | 1 |
:::
```

## stats

Show a few values with short labels. See the [example](../examples/patterns/data-display.prax).

The opener has no subject. Write a pipe table with each value in the first cell and its label in the remaining cells. The delimiter row is optional. One row uses a single statement layout. Grid settings accept only 2, 3 or 4 columns; more than 4 is refused at the setting's line. Responsive grids reduce to two columns, then one.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `columns` | integer, at least 2, at most 4 | Omitted | Authored grid column count. Other counts are refused and the diagnostic names the line. |
| `size` | `default`, `large`, `very-large` | `default` | Select the size. |

| Part | Learner text |
|---|---|
| `caption:` | Visible caption. |

```prax
# Example

::: stats {columns=2}
| 3 | Examples |
| 2 | Columns |
:::
```

## image

Show an image with a text alternative. See the [example](../examples/patterns/image-layouts.prax).

Write `![alt text](source){settings}` on its own line. Alt text is required unless decorative is true. Use empty alt text with decorative images. Keep settings after the closing parenthesis. A leading slash resolves from the project's asset root; remote assets need a safe media URL.

Follow [use decorative images sparingly](../skill/learners.md#use-decorative-images-sparingly) when choosing images. For narrated graphics, follow [add narration to graphics](../skill/learners.md#add-narration-to-graphics).

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `size` | `small`, `medium`, `large` | Omitted | Select the size. |
| `alignment` | `left`, `center`, `right` | Omitted | Select the alignment. |
| `ratio` | `square`, `4:3`, `3:2`, `16:9` | Omitted | Select the ratio. |
| `fit` | `contain`, `cover` | Omitted | Select the fit. |
| `effects` | string | Omitted | Image effect expression, such as grain(20). Quote expressions containing spaces. |
| `decorative` | `true`, `false` | Omitted | Mark an image as decorative and use empty alt text. |

```prax
# Example

![Description](/assets/image.png)
```

## divider

Separate sections within a page. See the [example](../examples/full-featured.prax).

Write `---` on its own line, after the page begins. It separates content inside the page. A palette setting starts a coloured section band. It creates no page or playback stop.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `palette` | `light`, `dark`, `accent`, `warm`, `cool`, `growth` | Omitted | Select the palette. |

```prax
# Example

---
```

## heading

Give a section inside a page a heading. See the [example](../examples/minimal.prax).

Write `##` through `######` headings inside a page. Authored levels stay as written. A raw `#` begins another page. `## Title {level=1}` keeps an H1 inside the current page. See [heading scope](document-structure.md#heading-scope).

[Shared block settings](blocks.md#shared-block-settings) apply.

```prax
# Example

## Heading
```

## page

Start a page with its title. See the [example](../examples/minimal.prax).

Write `# Title` to start a page. The title is required. Put `nav:` directly below it for a shorter navigation label. Settings apply to the page. Define style names in frontmatter pageStyles. See [document structure](document-structure.md).

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | name | Omitted | Select the style. |
| `hide` | `true`, `false` | Omitted | Hide the block initially. |
| `deckStop` | `true`, `false` | Omitted | Pause after the page's final narration segment. |
| `hideTitle` | `true`, `false` | Omitted | Keep the page name and H1 scope without showing the title. |

| Part | Learner text |
|---|---|
| `nav:` | Navigation label, placed directly after the page heading. |

```prax
# New page
```
