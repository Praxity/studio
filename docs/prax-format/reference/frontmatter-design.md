# Frontmatter design options

These are Praxity Studio presentation metadata, carried by the frontmatter container.
For authoring steps and Studio YAML settings, see [Studio Help](https://praxity.io/en/help/studio/design-your-theme/).
This technical reference remains available for existing source integrations.

## Course metadata

```yaml
title: Course Title
lang: en
```

## Named page styles

Use frontmatter `pageStyles` for reusable page treatments, selected with `{style=name}`
on a page heading. See [named page styles and corner artwork](document-structure.md#named-page-styles-and-corner-artwork)
for syntax, precedence, and supported properties.

## Palette and colors

```yaml
design:
  palette: ink
  colorMode: light
  accentHue: 220
```

In Studio, Theme → Preset and Reset to preset replace the visual defaults:
colours (including status colours), typography, spacing and density, card styling,
motion, and block style defaults. They preserve the brand logo, presentation
settings, and authored custom CSS.

Current Studio presets use these source values:

| Source value | Studio label |
| --- | --- |
| `ink` | Ink |
| `forest` | Forest |
| `plum` | Plum |
| `clay` | Clay |
| `clear` | Clear |

Saved IDs migrate automatically: `standard`, `waves`, `clean` and `minimal` to
Ink; `grove`, `bauhaus` and `blueprint` to Forest; `marquee` and `darkroom` to
Plum; `campfire` and `dunes` to Clay.

All presets have light and dark palettes and share the six-size type scale,
66ch reading measure, spacing scale and radius family. Ink, Forest, Plum and
Clay default to Sans, with Source Sans 3 for body text and headings. Clear uses
Atkinson Hyperlegible Next throughout, with ExtraBold 800 headings. Body text uses
400, controls use 600, and prose bold uses 700. The other pairings use 400 and 600.
Custom themes retain their accent and paper; retired fonts and geometry settings
adopt this structure.
Grain, section darkness and image treatments are ignored. Images retain their files.

Color tokens:

- `colorBackgroundLight`, `colorBackgroundDark`
- `colorText`, `colorAccent`
- `colorButtonBackground`, `colorButtonText`
- `colorSuccessOnLight`, `colorSuccessOnDark`
- `colorWarningOnLight`, `colorWarningOnDark`
- `colorErrorOnLight`, `colorErrorOnDark`
- `colorSuccess`, `colorWarning`, `colorError` (legacy fallbacks)
- `colorSecondary`, `colorTertiary`

Every color token accepts either a six-digit hex value or an opaque numeric OKLCH value:

```yaml
design:
  colorAccent: "oklch(57.7% 0.215 27.3)"
  colorBackgroundLight: "#ffffff"
```

OKLCH uses `oklch(lightness chroma hue)`: lightness is `0`–`1` or `0%`–`100%`,
chroma is `0`–`0.5`, and hue is a number in degrees (an optional `deg` suffix is
accepted). Alpha values are not accepted for design tokens. Invalid or out-of-range
values fall back to the active palette instead of producing invalid CSS.

Published output emits the gamut-mapped sRGB hex declaration first and the equivalent
OKLCH declaration second. Older LMS browsers therefore keep the hex colour; current
browsers use OKLCH. Hex remains fully backward compatible.

`accentHue` remains the preset-selection input. There are no separate
`accentLightness` or `accentChroma` keys: use `colorAccent: oklch(...)` when all three
axes must be authored, avoiding two competing sources for the accent colour.

### Semantic colour token ownership

Learner-facing component CSS consumes `--praxity-color-{role}` or
`--praxity-color-{role}-{state}` custom properties. Concrete colours belong in the
root/theme token layer; component rules must not introduce a new literal when a
semantic role exists. Hex fallbacks are allowed only at token boundaries or for
isolated rendering. Intrinsic colours whose identity is the content (for example a
colour-vision-safe chart series) stay with that asset or renderer.

## Typography

These settings belong inside frontmatter `design:`. The example below shows the
`typography` object within that design mapping.

- `typography.pairing`: `sans | book | clear`. The id is persisted with course design.
- `typography.fontDisplay`: `auto | block | swap | fallback | optional`, default `swap`.

| Pairing | English label | French label | Body | Headings |
| --- | --- | --- | --- | --- |
| `sans` | Sans | Sans | Source Sans 3 | Source Sans 3 |
| `book` | Book | Livre | Source Sans 3 | Source Serif 4 |
| `clear` | Clear | Claire | Atkinson Hyperlegible Next | Atkinson Hyperlegible Next ExtraBold (800) |

Sans is the default for every palette except the Clear preset, which selects Clear.
A saved typography without an id resolves to Sans, including the old Source Serif 4
heading default. A legacy Atkinson Hyperlegible body resolves to Clear. An unknown
id resolves to Sans. Only an explicit `pairing: book` selects serif headings.

```yaml
design:
  typography:
    pairing: book
    fontDisplay: swap
```

Normalization stores the pairing and its resolved `body`, `headings` and `code`
roles. Body text uses weight 400. Sans and Book headings use 600; Clear headings
use 800. These roles default to normal style.
Code uses system monospace. Stored per-level font overrides and retired faces
resolve to the selected pairing; they do not create another font combination.
Inspect, export and Studio Check warn for each ignored font setting, naming its design path and the resolved pairing. Choose a different combination with `typography.pairing`; matching font settings do not warn.
Saved Clear roles using Atkinson Hyperlegible and weight 600 headings migrate to
Next and weight 800 silently. These settings preserve the author's Clear choice.
Exports package each selected font locally for offline use. Clear bundles Latin
and Latin extension WOFF2 subsets at 400, 600, 700 and 800 in normal and italic
styles. The extension subset covers French `Ÿ`, which the Latin subset omits.
Both ship with the SIL Open Font License. Clear uses real font files for prose
emphasis, controls and headings, without substituting the old Atkinson face.
Only the Latin body and heading faces are preloaded. Latin extension faces load
through their CSS `unicode-range` when the text needs them.

Published headings use one body-relative scale. `headingSize` raises that scale but
cannot make a heading smaller than body text:

| Level | Published ratio |
|---|---|
| h1 | `max(1.5, headingSize)` |
| h2 | `max(1.3, headingSize × 0.75)` |
| h3 | `max(1.15, headingSize × 0.6)` |
| h4 | `max(1.1, headingSize × 0.5)` |
| h5 | `max(1.05, headingSize × 0.42)` |
| h6 | `max(1, headingSize × 0.36)` |

The ratios use `rem`, so they remain constant when the learner changes the viewer's
text size. The same scale applies inside columns, notes, accordions, tab panels, and
assessment cards. `lineHeight` controls leading within prose; it does not replace the
published adjacency scale.

Studio's Design panel renders numeric settings within its control ranges:
`accentHue` 0 to 360, `headingSize` 1.6 to 3.2 rem, and `lineHeight` 1.2 to 2.
Finite saved values outside those ranges are clamped for display. Non-numeric
or non-finite saved values use the defaults: 2.375 rem for heading size, 1.55 for
line height, and the default palette's hue. The panel shows a diagnostic beside
the field. Opening the panel and editing another field preserve the saved value;
changing that field replaces it with the chosen value.

## Spacing and layout

Studio's colour fields and stored colour tokens use the same opaque colour parser.
Three-digit hex values such as `#abc` expand to `#aabbcc`. Six-digit hex and
numeric opaque `oklch()` values are supported. Alpha hex forms such as `#abcd`
and `#aabbccdd` are refused with a field message; the saved colour stays unchanged.

- `density`: `compact | comfortable | spacious`
- `blockSpacing`: `compact | default | spacious`
- `sectionGap` (number)
- `sectionRhythmMode`: `uniform | alternate | manual`
- `contentMaxWidth` (number)
- `borderRadius` (number, retired): retained in source but ignored. Export and Check
  report `ignored-radius-setting` once per authored course or lesson setting.
  Look v2 uses 16 px activity cards and dialogue bubbles, 10 px controls and frames,
  6 px letter keys and checkboxes, and 4 px marks. Images and attached edges stay square.

Published content uses five body-relative rhythm tokens: `tight` (`0.825rem`), `close`
(`1.2375rem`), `normal` (`1.65rem`), `section` (`2.475rem`), and `boundary` (`3.3rem`).
Unknown block pairs use `normal`, so future block types have a stable fallback.

| Adjacency | Gap |
|---|---|
| page edge → first block/title; last block → page navigation | boundary |
| page title → first content | normal |
| heading → heading | tight |
| non-heading → h1 / h2 / h3 / h4–h6 | boundary / section / normal / close |
| h1 / h2 / h3–h6 → non-heading | normal / close / tight |
| text ↔ text or checklist | close |
| text ↔ note or quote | normal |
| text ↔ heavy block | section |
| prose ↔ floated image | normal inline and block-end gutter while prose wraps |
| consecutive note/quote or heavy blocks | section |
| divider in either direction | section |
| text → button / button → text / button → button | close / normal / tight |

Heavy blocks are tables, images, videos, embeds, columns, accordions, tabs,
assessments, and assessment groups. Heading adjacency wins when a heading introduces a
heavy block. `density` continues to control component-owned internal spacing and does
not shrink touch targets or reading rhythm. `blockSpacing` scales the gaps while
preserving the differences between adjacency types: `compact` uses two-thirds of
the default spacing and `spacious` uses five-thirds. `sectionGap` controls
alternate/manual section-band separation: values up to `3` are proportional
multipliers; pixel-era values such as `48` are normalized against the former 48px
default and then applied to the body-relative `section` token.

## Navigation

Studio exposes Pages and Guided slides in Design → Presentation. Course format
is course-wide. Edit settings for selects Course defaults (saved in course.yaml)
or This module (saved as lesson-level overrides). Module overrides take precedence.
The source keys below remain supported for authored configurations. See
[Studio presentation metadata](module-deck.md#studio-presentation-metadata) for
the simplified panel's defaults and setting mappings.

- `navArchetype`: `sidebar | bottomBar | slides | scroll | minimal | embedded | none | custom`
- `navArchetypeBase`: same option set
- `navLayout`: `sidebar | bottomBar | none` (legacy)
- `navOutline` (boolean)
- `navOutlinePosition`: `left | right`
- `navPrevNext` (boolean)
- `navPrevNextPosition`: `bottom | top`
- `navProgressStyle`: `bar | dots | segments | none`
- `navBottomArrows`, `navTopBar`, `navHamburgerMenu` (boolean)
- `navReadingSupportPlacement`: `topBar | bottomBar | sidebar | none`
- `navFloatingToc`, `navScrollProgress`, `navEdgeArrows`, `navSlideCounter` (boolean)
- `navBreadcrumbs`, `navCourseTitle`, `navLessonTitles`, `navLessonTitleAsHeading` (boolean)
- `navReadingTime`, `navSwipeGestures`, `navKeyboardArrows` (boolean)

The `slides` preset keeps previous/next controls beside its progress dots and leaves
`navEdgeArrows` off by default. Set `navEdgeArrows: true` to opt into the additional decorative
edge arrows; swipe and keyboard paging remain independently configurable.

> **Arrow keys cannot be the last one off.** If a page ends up with no visible way to
> change page, with no outline, prev/next, edge arrows, hamburger or floating ToC, then
> `navKeyboardArrows: false` is ignored and arrow navigation stays on. Swipe is the only
> thing left otherwise, which no keyboard user and no mouse user can perform (2.1.1
> Keyboard; 2.5.7 Dragging Movements). Every other toggle is honoured as written, and the
> repair adds nothing visible.

- `showA11yPill` (boolean)
- `glossaryPage` (boolean, default `true`), publish the aggregated glossary page built from `[term]{definition}` tooltips

Published Reading settings contain Larger text and a Reading guide. Larger text is a convenience
for environments where browser zoom does not persist; it returns to the course default from the
same control. The Reading guide dims top-level content blocks, keeps compound blocks such as
columns and captioned images atomic, and groups a heading with the content it introduces. It is a
reading aid, not an accessibility remediation or efficacy claim. Contrast follows the learner's
platform through `prefers-contrast` and `forced-colors`; there is no course-level contrast toggle.

## Visual effects

- `shadowIntensity`: `flat | subtle | elevated`
- `dividerStyle`: `none | thin | gradient | ornamental | wave | angle | curve | squiggle | blend`
- `backgroundTexture`: `none | grain | paper | noise`
- `highlightStyle`: `none | marker | gradient | scribble`

`dividerStyle` inserts decorative separators before subsequent H2 sections within
a page, including pages with uniform colours. `none` removes them. With alternate
or explicitly assigned section palettes, separators mark the palette boundaries.
An explicit `{palette=warm}` on `---` starts a coloured band even with `uniform` rhythm.
In uniform rhythm, an unmarked opening section keeps the page background.
The setting applies in small previews and full preview. It does not change an
explicit `---` divider block.

## Image effects

`imageEffects` supports keyed effect objects. A key's presence enables the effect.

| Effect key | Values | Default intensity |
|---|---|---|
| `grayscale` | `intensity: 0–100` percent | `100` |
| `colorWash` | `intensity: 0–100` percent; `color`: CSS hex | `40`; color `#4269d0` |
| `accentLighting` | `intensity: 0–100` percent | `30` |
| `progressiveBlur` | `intensity: 0–24` px | `8` |
| `accentBlur` | `intensity: 0–16` px | `6` |
| `motionBlur` | `intensity: 0–30` px; `direction`: `0`, `45`, `90`, or `135` degrees | `10`; direction `0` |
| `grain` | `intensity: 0–100` percent | `25` |
| `halftone` | `intensity: 2–16` px | `6` |
| `dithering` | `intensity: 0–100` percent | `50` |

When multiple effects are present, the runtime composites them in this order: grayscale, color
wash, progressive blur, accent blur, motion blur, grain, halftone, dithering, then accent
lighting. If more than one blur is active, each blur is reduced to 60% intensity, except the exact
progressive-blur plus motion-blur pair, which stacks without attenuation. Only the first texture
in compositing order is kept: grain before halftone before dithering.

Also available:

- `imageEffectsAuto` (boolean)
- Legacy: `imageStyle`, `imageHoverEffect`

## Animation

- `motionEntrance`: `none | fade | slide | scale`
- `motionStagger`: `none | sequential`
- `slideTransition`: `none | fade | slide | zoom`, default transition for single-layout Card
  blocks whose own `transition` parameter is unset. A block-level value takes precedence.

Both entrance motion and Card transitions are disabled when the learner requests reduced motion.

## Branding

```yaml
design:
  brand:
    logoUrl: /assets/logo-light.svg
    logoDarkUrl: /assets/logo-dark.svg
    logoPlacement: header
```

Studio bundles logos from the project assets folder. The light and dark variants follow the
learner's selected appearance. Keep both files with the project.

- `logoPlacement`: `sidebar | header | hidden` (default: `header`). Studio labels these
  Sidebar, Header bar, and Hide in the **Show on** dropdown. The logo sits beside the course
  title in the selected navigation surface; it does not appear inside page content.
- The selected surface and course title must be enabled in navigation settings. Sidebar
  placement remains in the course menu when the sidebar becomes a drawer on smaller screens.
- Older `left` and `center` placements use the header bar. The old `logoScope` page filter is
  ignored because branding now belongs to course navigation.

## Custom code and defaults

- `customCss` (string), raw author CSS appended to published output. Praxity's contrast and
  reflow validation cannot vouch for styles introduced here; authors must validate that CSS.
- `componentDefaults` (object)

Component defaults apply to omitted block settings, including nested blocks.
An explicit setting on a block takes precedence, even when it selects the normal
unstyled/default value. Studio writes the appropriate keys when you use Design →
Block defaults; changing a default does not rewrite each block's source.

Component-default YAML keeps its existing keys: `card.layout: slides`,
`comparison.layout: slider` or `side-by-side`, and `image.size: small|medium|large`.
Block openers use grammar-4 braces, such as `::: cards {layout=slides}`.
Outer block width uses `width`; card surface treatment still uses `style`.

## Complete example

```yaml
---
title: Incident Response Essentials
lang: en
design:
  palette: waves
  colorMode: auto
  accentHue: 205
  typography:
    pairing: sans
    fontDisplay: swap
  headingSize: 1.1
  lineHeight: 1.6
  density: comfortable
  sectionGap: 1.1
  contentMaxWidth: 880
  borderRadius: 10
  navArchetype: sidebar
  navOutline: true
  navPrevNext: true
  navProgressStyle: segments
  shadowIntensity: subtle
  dividerStyle: thin
  backgroundTexture: grain
  highlightStyle: marker
  motionEntrance: fade
  motionStagger: sequential
  colorBackgroundLight: "#f8fafc"
  colorBackgroundDark: "#0f172a"
  colorText: "#0f172a"
  colorAccent: "oklch(54.6% 0.215 262.9)"
  colorButtonBackground: "#1d4ed8"
  colorButtonText: "#ffffff"
  colorSuccess: "#15803d"
  colorWarning: "#b45309"
  colorError: "#b91c1c"
  imageEffects:
    grain:
      intensity: 20
  imageEffectsAuto: true
  brand:
    logoUrl: /assets/logo-light.svg
    logoDarkUrl: /assets/logo-dark.svg
    logoPlacement: header
  componentDefaults:
    card:
      layout: slides
      width: narrow
    comparison:
      layout: side-by-side
    image:
      size: medium
---
```

## Narrated module decks

Course playback mode is `moduleDeck: true` in `course.yaml`. It is not a lesson
frontmatter key. Presentation and initial learner preferences use `design.deck`:

```yaml
design:
  deck:
    preset: transcript
    outline: true
    initialPanel: transcript
    slideCounter: true
    followNarration: true
    autoAdvance: false
  navFloatingToc: true
  navKeyboardArrows: true
```

See [module-deck.md](module-deck.md#studio-presentation-metadata) for values, defaults
and precedence, or [Studio Help](https://praxity.io/en/help/studio/design-your-theme/) for
the corresponding Design controls. These settings do not change assessment gates.
