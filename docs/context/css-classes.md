# CSS Classes & Variables Reference

Reference for all `praxity-` CSS classes and `--praxity-` CSS custom properties used in published output. Use this when writing Custom CSS, targeting specific blocks, or adding new blocks/variables.

---

## 1. Block Classes

Every block in published output receives two or three classes on its wrapper element:

- `.praxity-block` — on every block (use for global block overrides)
- `.praxity-block-{type}` — per-block-type class (use for targeting a block type)
- `.praxity-block-{blockId}` — per-instance class (use for targeting a single block)

### Block type classes

```
.praxity-block-text
.praxity-block-heading
.praxity-block-image
.praxity-block-video
.praxity-block-audio
.praxity-block-document
.praxity-block-quote
.praxity-block-divider
.praxity-block-embed
.praxity-block-image-comparison
.praxity-block-chart
.praxity-block-table
.praxity-block-button
.praxity-block-signature
.praxity-block-note
.praxity-block-code
.praxity-block-tabs
.praxity-block-accordion
.praxity-block-card
.praxity-block-sequence
.praxity-block-labeled-graphic
.praxity-block-columns
.praxity-block-assessment
.praxity-block-rating
.praxity-block-checklist
.praxity-block-page-break
```

`.praxity-block-card` covers `grid`, `masonry`, `rows`, and `slides` presentations. The runtime stores `slides` as `single`; persisted `single` remains a legacy layout value.

> Note: `.praxity-block-variable` and `.praxity-block-logic` exist in the DOM but are hidden (`display: none`) in published output — they are authoring-only blocks.

---

## 2. Structural Classes

Shell and layout elements that wrap page content.

| Class | Element | Purpose |
|---|---|---|
| `.praxity-page-content` | `<main>` | Centered content column (max-width constrained) |
| `.praxity-page-title` | `<h1>` | Page title heading at top of each page |
| `.praxity-page-nav` | `<nav>` | Previous/Next page navigation buttons |
| `.praxity-course-menu` | `<div>` | Sticky wrapper around the course menu/top bar |
| `.praxity-top-bar` | `<header>` | Top bar containing menu toggle and course title |
| `.praxity-skip-link` | `<a>` | Accessible skip-to-content link (visible on focus) |
| `.praxity-badge` | `<a>` | "Built with Praxity" fixed bottom-right badge |
| `.praxity-progress` | `<div>` | Course progress indicator (fragment/standalone output) |

---

## 3. Semantic Element Classes

Classes on specific elements within blocks, used for consistent styling across block types.

| Class | Purpose |
|---|---|
| `.praxity-block-title` | Block-level heading/title (used in RatingBlock, TableBlock, etc.) |
| `.praxity-assessment-stem` | Assessment question paragraph, styled bold at the established question size |
| `.praxity-assessment-feedback` | Feedback text shown after an assessment answer |
| `.praxity-assessment-badge` | Correct/incorrect badge on assessment results |
| `.praxity-required-indicator` | Absolute-positioned badge on blocks marked required |
| `.praxity-required-message` | Validation message shown below incomplete required blocks |
| `.praxity-nav-button` | Individual Previous/Next navigation button |
| `.praxity-nav-visited` | Applied to nav items/dots for already-visited pages |
| `.praxity-chart-container` | Wrapper around chart canvas elements |
| `.praxity-menu-toggle` | Hamburger/toggle button inside `.praxity-top-bar` |

---

## 4. Theme State Classes

Applied to the `<html>` element to reflect the current color mode. Toggled at runtime by a `prefers-color-scheme` media query listener.

| Class | When applied |
|---|---|
| `.praxity-theme-light` | OS/browser is in light mode |
| `.praxity-theme-dark` | OS/browser is in dark mode |

Use these for explicit dark-mode overrides in Custom CSS:

```css
.praxity-theme-dark .praxity-block-heading {
  color: lightblue;
}
```

---

## 5. Per-Block Targeting

Every block also receives `.praxity-block-{blockId}` where `blockId` is the block's unique ID from the course data. This enables pinpoint Custom CSS targeting of a single block instance.

Example: a block with ID `abc123` receives:
```
class="praxity-block praxity-block-text praxity-block-abc123"
```

---

## 6. CSS Variables — Tier 1 (User-facing)

### Configurable (5 user-settable colors)

These are the only variables users set directly (via the Customize panel or `CustomThemeOverrides`):

| Variable | Description | Default (Minimal light) |
|---|---|---|
| `--praxity-color-background` | Page/body background | `#ffffff` |
| `--praxity-color-text` | Body text color | `#1a1a1a` |
| `--praxity-color-accent` | Links, active states, focus | `#1a1a1a` |
| `--praxity-color-button-background` | Button fill color | `#1a1a1a` |
| `--praxity-color-button-text` | Text on filled buttons | `#ffffff` |

### Derived theme tokens

The learner resolver computes these from the active design and preset, then corrects text tokens to at least 4.5:1 against learner surfaces. See `packages/shared-blocks/src/themes/resolve-design-tokens.ts`.

| Variable | Derivation |
|---|---|
| `--praxity-color-background-alt` | Background shifted ±5% in lightness |
| `--praxity-color-surface` | Same as `--praxity-color-background` |
| `--praxity-color-text-light` | Preset text opacity 0.92 in light mode, 0.94 in dark; custom text opacity 0.68, then contrast correction |
| `--praxity-color-text-muted` | Preset text opacity 0.88; custom text opacity 0.56, then contrast correction |
| `--praxity-color-text-inverted` | Set to background color |
| `--praxity-color-border` | Text blended 20% into background |
| `--praxity-color-focus` | Accent adjusted to at least 3:1 against learner surfaces and their tints |
| `--praxity-color-accent-hover` | Accent mixed 85% with black |
| `--praxity-color-accent-light` | Accent at 12% opacity over background |
| `--praxity-color-button-outline` | Button text (light bg) or button background (dark bg) |

### Semantic colors (auto-derived, background-luminance-aware)

| Variable | Light default | Dark default |
|---|---|---|
| `--praxity-color-success` | `#2b8a3e` | `#6bc77a` |
| `--praxity-color-success-light` | success × 10% over background | — |
| `--praxity-color-warning` | `#e67700` | `#ffa94d` |
| `--praxity-color-warning-dark` | `#B45309` | `#D97706` |
| `--praxity-color-warning-light` | warning × 10% over background | — |
| `--praxity-color-error` | `#c53030` | `#f56565` |
| `--praxity-color-error-light` | error × 10% over background | — |

### Layout & spacing

| Variable | Description | Default |
|---|---|---|
| `--praxity-font-family` | Body font stack | `"Inter", -apple-system, ...` |
| `--praxity-font-size-base` | Base font size | `16px` |
| `--praxity-line-height-base` | Base line height | `1.6` |
| `--praxity-block-spacing` | Margin-top between content blocks | `32px` |
| `--praxity-text-spacing` | Margin-bottom on text/quote/divider blocks | `12px` |
| `--praxity-border-radius` | Rounded corner radius across components | `4px` |
| `--praxity-max-width` | Maximum content column width | `720px` |

---

## 7. CSS Variables — Tier 2 (Internal)

These are set by `MantineIslandProvider` to bridge Praxity theme tokens into Mantine's design system. Do not override these in Custom CSS — override the Tier 1 `--praxity-*` variables instead.

| Variable | Maps to |
|---|---|
| `--mantine-color-body` | `--praxity-color-background` |
| `--mantine-color-text` | `--praxity-color-text` |
| `--mantine-color-anchor` | `--praxity-color-accent` |
| `--mantine-color-dimmed` | `--praxity-color-text-light` |
| `--mantine-color-error` | `--praxity-color-error` |
| `--mantine-primary-color-filled` | `--praxity-color-accent` |
| `--mantine-primary-color-filled-hover` | `--praxity-color-accent-hover` |
| `--mantine-primary-color-light` | `--praxity-color-accent-light` |
| `--mantine-color-default` | `--praxity-color-surface` |
| `--mantine-color-default-border` | `--praxity-color-border` |
| `--mantine-color-default-hover` | `--praxity-color-background-alt` |
| `--mantine-color-gray-0/1` | `--praxity-color-background-alt` |

Nav-level fragment variables (used by `render-fragment.ts` standalone output):

| Variable | Purpose |
|---|---|
| `--praxity-color-border` | Border on nav bar and nav buttons |
| `--praxity-color-background` | Nav button background |
| `--praxity-color-text` | Nav button text |
| `--praxity-color-text-light` | Page counter text |
| `--praxity-border-radius` | Nav button border-radius |

---

## 8. Chart Variables

CVD-safe (color-vision-deficiency safe) palette based on Observable 10. Used by ChartBlock for series coloring.

| Variable | Hex | Usage |
|---|---|---|
| `--praxity-chart-1` | `#4269d0` | Series 1 (blue) |
| `--praxity-chart-2` | `#efb118` | Series 2 (amber) |
| `--praxity-chart-3` | `#ff725c` | Series 3 (coral) |
| `--praxity-chart-4` | `#6cc5b0` | Series 4 (teal) |
| `--praxity-chart-5` | `#a463f2` | Series 5 (purple) |
| `--praxity-chart-6` | `#3ca951` | Series 6 (green) |

Chart variables are defined at `:root` and are not theme-derived — they remain constant across light/dark modes.

---

## 9. Naming Rules

When adding new blocks or variables, follow these conventions:

**Block classes:**
- Pattern: `.praxity-block-{kebab-case-type}`
- Example: a new `hotSpot` block type → `.praxity-block-hot-spot`

**CSS variables:**
- Color tokens: `--praxity-color-{purpose}` (e.g. `--praxity-color-highlight`)
- Layout/spacing tokens: `--praxity-{property}` (e.g. `--praxity-sidebar-width`)
- Chart series: `--praxity-chart-N` (increment N, currently 1–6)

**Do not:**
- Use the `--rs-` prefix (legacy, renamed to `--praxity-`)
- Add Mantine-internal variable overrides in Custom CSS
- Create block-type class names in PascalCase or camelCase

---

## 10. Custom CSS Examples

```css
/* Change heading color for all headings */
.praxity-block-heading { color: navy; }

/* Style all Note blocks */
.praxity-block-note { border-left: 4px solid var(--praxity-color-accent); }

/* Target a specific block by ID */
.praxity-block-abc123 { background: lightyellow; }

/* Dark mode override */
.praxity-theme-dark .praxity-block-heading { color: lightblue; }

/* Override accent color via CSS variable */
:root { --praxity-color-accent: #e63946; }

/* Increase content width */
:root { --praxity-max-width: 900px; }

/* Tighter block spacing */
:root { --praxity-block-spacing: 12px; }
```
