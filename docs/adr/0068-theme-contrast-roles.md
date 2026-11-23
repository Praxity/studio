# 0068: Theme contrast roles

## Status

Accepted. Records existing behaviour; no rendering change.

## Context

A foreground can pass contrast on the main background and fail on a panel,
card or selected row. Theme correction must account for the surfaces on which
each token is actually used.

## Decision

In `apps/desktop/src/renderer/themes/theme-factory.ts`:

- `readableOn` tries multiple foreground candidates before lightness correction.
  Lightening white cannot improve its contrast on a light badge. Including black
  lets the function choose the better extreme; black or white provides at least
  4.58:1 against any background.
- `CATEGORY_SEEDS` preserves distinct hues for engage, explain, practice, assess
  and structure, while recalculating lightness and chroma for the theme.
  `COMPOSITION_TINT_SEEDS` instead follows the five logomark colours in order.
  A background wash must retain the recognised hue; yellow corrected as 4.5:1
  text becomes brown and is unsuitable as that wash.
- `buildThemeColors` corrects secondary and muted text against every surface it
  can occupy, including `bgTertiary`, `bgCard` and `selectedBg`. Correcting only
  against `bgPrimary` left text passing on white and failing on panels: the
  recorded `#777676` example gives 4.5:1 on `#ffffff` and 4.19:1 on `#f5f6f8`.
- Parameter values use their composited tint as the contrast background. Small
  divider and gutter labels are text, so decorative-grey contrast is insufficient.
- `accent` remains a brand fill; `accentOnSurface` supplies readable foreground
  icons and text. `accentText` must contrast with both accent and ribbon fills.
  Numbered badges also need text contrast. Control surfaces use the main
  background to remain distinct from panels.
- The two-tone focus indicator needs contrast between its strokes. A fixed white
  inner stroke disappears in light themes.
- Composition-preview marks contrast against both `bgCard` and the category
  tint, because the gradient ends at a 35% dilution of the tint. Dark themes use
  roughly half the light-theme alpha to avoid overly bright washes. Non-text
  marks need 3:1 against all five washes under WCAG 1.4.11; category-coloured
  editor keywords also require checking `bgEditor`.
- Toggle tracks need contrast on both primary and panel surfaces. The historical
  borderless Mantine defaults measured about 1.1:1 against the panel. Track tokens
  therefore use the harder surface, while the thumb chooses between white and
  near-black rather than inheriting `accentText`.

In `apps/desktop/src/renderer/themes/types.ts`, `controlBorder` is an interactive
boundary held to 3:1. `border` and `borderSubtle` describe decorative dividers.
`controlBg`, `accentOnSurface` and `focusRingInner` retain the separate roles
specified above.

In `apps/desktop/src/renderer/themes/registry.ts`, `familyOrder` places the app's
own theme first. Sorting it below other families made the default appear missing.

In `apps/desktop/src/renderer/themes/__tests__/theme-contrast.test.ts`, `PAIRS`
covered the combinations rendered by the retired `apps/desktop/src/shared/canvas-styles.ts`. The browser canvas controls were removed on 2026-11-22; retain these contrast roles for surviving theme consumers.
Text uses 4.5:1 under WCAG 1.4.3; control boundaries and focus indicators use 3:1
under WCAG 1.4.11.

Sources: the named symbols, their comments and theme contrast tests at commit
`bed54f6109aa4ae868c981f53233a5ee9c5afdd7`. The historical measurements explain
existing token choices; they are not a new audit of the current UI.

## Consequences

A new surface requires checking every foreground drawn on it. Preserve the
difference between text, non-text controls, decorative borders and brand fills
when changing correction rules or token consumers.
