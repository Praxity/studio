# Item containers

Settings go in braces on the opener. Parts hold learner text. Omitted settings keep the schema or renderer default.

## accordion

Let learners expand titled sections. See the [example](../examples/patterns/faq-accordion.prax).

The subject is an optional group title. Each `:: Title` item needs a title and holds prose or nested blocks. At least one item is required.

Follow [keep required content visible](../skill/learners.md#keep-required-content-visible) when choosing what to fold away.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `none`, `outline`, `shaded`, `primary`, `secondary` | Omitted | Select the style. |
| `allowMultipleOpen` | `true`, `false` | `false` | Select the allowMultipleOpen. |

```prax
# Example

::: accordion
:: First
Text
:: Second
Text
:::
```

## accordion-item

Put one expandable section inside an accordion. See the [example](../examples/patterns/faq-accordion.prax).

Start an item with `:: Title`. Its title is required. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

## tabs

Let learners switch between related sections. See the [example](../examples/interactive-module.prax).

The subject is an optional group title. Each `:: Title` item needs a title and holds prose or nested blocks. At least one item is required.

Follow [keep required content visible](../skill/learners.md#keep-required-content-visible) when choosing tab content.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `default`, `outline`, `pills` | `default` | Select the style. |
| `orientation` | `horizontal`, `vertical` | `horizontal` | Select the orientation. |

```prax
# Example

::: tabs
:: First
Text
:: Second
Text
:::
```

## tabs-item

Put one section inside a tab. See the [example](../examples/interactive-module.prax).

Start an item with `:: Title`. Its title is required. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

## sequence

Present steps or events in order. See the [example](../examples/patterns/guided-reading.prax).

The subject is an optional group title. Each `:: Title` item needs a title. Keep style and orientation separate. At least one item is required.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `style` | `numbered`, `timeline`, `none` | `numbered` | Select the style. |
| `orientation` | `vertical`, `horizontal` | `vertical` | Select the orientation. |
| `alignment` | `left`, `center`, `right` | `left` | Select the alignment. |
| `distribution` | `uniform`, `scaled` | Omitted | Select the distribution. |
| `scrollable` | `true`, `false` | Omitted | Select the scrollable. |

```prax
# Example

::: sequence
:: First
Text
:: Second
Text
:::
```

## sequence-item

Put one step or event inside a sequence. See the [example](../examples/patterns/guided-reading.prax).

Start an item with `:: Title`. Its title is required. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

## cards

Group short entries or reveal answers on card backs. See the [example](../examples/patterns/flashcard-drill.prax).

The subject is an optional group title. Item titles are optional. A bare `::` starts an untitled card. Cards can hold prose, images and nested blocks. Each card can have one back face. At least one item is required.

For flip cards, follow [ask before revealing an answer](../skill/learners.md#ask-before-revealing-an-answer) and [keep required content visible](../skill/learners.md#keep-required-content-visible).

Recall cards keep the prompt visible. "I have my answer" reveals the answer below it; "Hide answer" conceals it again. Revealing a card in the slides layout records its existing viewed completion credit; hiding the answer does not remove that credit. Without JavaScript and in print, all prompts and answers remain visible. Recall cards use the unboxed reading treatment.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `layout` | `grid`, `masonry`, `slides`, `rows` | `grid` | Select the layout. |
| `style` | `none`, `outline`, `shaded`, `primary`, `secondary` | `none` | Select the style. |
| `color` | `primary`, `secondary` | Omitted | Colour override. A primary or secondary style takes precedence. |
| `shadow` | `theme`, `none`, `subtle`, `elevated` | `theme` | Select the shadow. |
| `columns` | integer, at least 2, at most 4 | Omitted | Authored grid column count. Other counts are refused and the diagnostic names the line. |
| `media` | `inset`, `flush` | Omitted | Select the media. |
| `advance` | number, at least 0 | Omitted | Seconds between cards in a learner-started playthrough with `layout=slides` and at least two cards. Zero disables the playthrough. |
| `transition` | `none`, `fade`, `slide`, `zoom` | `fade` | Select the transition. |
| `showProgress` | `true`, `false` | Omitted | Select the showProgress. |
| `shuffle` | `true`, `false` | Omitted | Shuffle response entries or items. |
| `trackCompletion` | `true`, `false` | Omitted | Track viewed cards. |
| `headings` | `true`, `false` | Omitted | Show card headings. |

`advance=N` never starts on load and never loops. In Pages and slides without playable narration, "Play cards" starts from the current card, or the first card when the last is showing. "Pause cards", manual navigation, or reaching the last card stops the pass. The control changes its command name to "Pause cards" while playing. French uses "Lire les cartes" and "Mettre les cartes en pause".

In a [module deck](module-deck.md), a slide with narration audio uses the narration controls instead. Cards turn every N seconds while narration plays and automatic advancement is enabled in More. Pausing narration or turning that setting off stops the cards. Resuming narration waits a fresh N seconds from the current card. Narration ending stops the pass. Narration cues targeting individual cards take precedence over `advance`. Word timings for a whole cards block highlight the Transcript and leave the playthrough active.

Automatic turns announce the card position through the same channel as manual navigation and keep focus in place. A pass stops before hiding focused card content or disabling its focused Next control. Reduced motion makes each turn instant. Without JavaScript and in print, all cards remain readable and the playthrough control is absent.

```prax
# Example

::: cards
::
Text
::
Text
:::
```

## cards-item

Put one entry inside a cards block. See the [example](../examples/patterns/flashcard-drill.prax).

Start an item with `::`. Its title is optional. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

## back

Add the answer or reverse side of a card. See the [example](../examples/patterns/flashcard-drill.prax).

Open a card's back face with `::: back` and close it with `:::`. It has no subject or parts. Each card accepts at most one back face. Close the back before the next card or the container closer.

Follow [ask before revealing an answer](../skill/learners.md#ask-before-revealing-an-answer) when writing the front and back.

[Shared block settings](blocks.md#shared-block-settings) apply.

```prax
# Terms

::: cards Safety terms {layout=slides}
:: Lockout/tagout
What does it mean?
::: back
Isolate energy before maintenance.
:::
:: Confined space
When do you need a permit?
::: back
When the atmosphere or exit is hazardous.
:::
:::
```

## comparison

Compare two versions or approaches. See the [example](../examples/full-featured.prax).

The subject is an optional group title. Write exactly two items. Their titles are optional. Use slider for an image comparison or side-by-side for adjacent content.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `layout` | `slider`, `side-by-side` | `side-by-side` | Select the layout. |

```prax
# Example

::: comparison
::
Text
::
Text
:::
```

## comparison-item

Put one version inside a comparison. See the [example](../examples/full-featured.prax).

Start an item with `::`. Its title is optional. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

## columns

Place related content side by side. See the [example](../examples/patterns/image-layouts.prax).

The subject is an optional group title. Item titles are optional. Set weight on each item to control relative widths. Two columns with weights 2 and 1 divide the available width in that ratio. At least one item is required.

[Shared block settings](blocks.md#shared-block-settings) apply.

```prax
# Example

::: columns
::
Text
::
Text
:::
```

## columns-item

Put related content inside one column. See the [example](../examples/patterns/image-layouts.prax).

Start an item with `::`. Its title is optional. The next item or container closer ends it. Close nested blocks before the next item.

[Shared block settings](blocks.md#shared-block-settings) apply.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `weight` | number, above 0 | Omitted | Relative column width. Any finite positive number, including fractions. |
