---
name: desktop-polish
description: Studio thin canvas UI baseline. Use when building or reviewing canvas controls, styling, layout, or interactions.
---

# Desktop polish

An opinionated UI baseline for Studio's browser thin canvas. Read `docs/context/browser-editor.md` and the canvas trust checklist in `CODING_STANDARDS.md` before changing controls. The native canvas controls and protected shadow roots own author interaction; the Mantine guidance below applies only to retained learner islands.

Adapted from [ibelick/ui-skills/baseline-ui](https://github.com/ibelick/ui-skills) under MIT.

## How to use

- `/desktop-polish`: apply these constraints to all desktop UI work in this conversation.
- `/desktop-polish <file>`: review the file against every constraint. For each violation, output:
  - **Violation**: quote the exact line or snippet
  - **Why it matters**: one short sentence
  - **Fix**: a code-level suggestion

A review is done when every item in the review checklist at the end has an answer for the file.

## Stack

- **Components**: native buttons and textareas in `apps/desktop/src/renderer/browser/canvas.ts` and `canvas-text.ts`. Learner islands use Mantine v9.
- **Styling**: protected author CSS in `apps/desktop/src/shared/canvas-styles.ts`.
- **Tokens**: `packages/editor-core/src/styles/editor-tokens.css` defines editor chrome tokens. `apps/desktop/src/shared/canvas-styles.ts` emits protected canvas tokens from `apps/desktop/src/renderer/themes/`. Check light and dark mode.
- **Icons**: `@tabler/icons-react` at `size={20}` and `stroke={1.5}` for toolbar icons.
- **Fonts**: system font stack (`system-ui, -apple-system, sans-serif`). No web fonts.
- **No Tailwind, no CSS-in-JS, no styled-components.**

## Canvas design contract

- MUST reuse the canvas text and focus owners. The canvas has one native field, no sidebar or structural editor.
- Read mode uses the compiled learner page. Edit mode adds protected text controls and strips course scripts through the existing author projection. Follow `docs/context/architecture.md`.
- MUST resolve learner theming through the canonical compiler for preview and export.
- Fix preview/export divergence in the shared compiler or viewer/runtime owner.
- Learner styles live under `.praxity-viewer-shell`. Author controls retain reference-owned shadow roots and top-layer placement, protected from hostile course CSS.

## Components

- MUST use Mantine components for anything with keyboard or focus behavior (Button, ActionIcon, Modal, Select, TextInput, Menu, Tooltip).
- MUST use the project's existing component patterns before introducing new ones.
- NEVER mix Mantine components with hand-rolled equivalents in the same surface.
- MUST add `aria-label` to icon-only `ActionIcon` components.
- NEVER rebuild keyboard, focus, or dropdown behavior by hand. Mantine handles it.
- Mantine component defaults: `size="xs"` for form controls, `size="sm"` for ActionIcon.

## CSS conventions

- MUST use CSS custom properties from `packages/editor-core/src/styles/editor-tokens.css` for editor chrome and `apps/desktop/src/shared/canvas-styles.ts` for canvas controls. Never hardcode hex values in component CSS.
- MUST use BEM-style class naming (`.block__element--modifier`). Match existing patterns in the file.
- MUST scope styles to the component. No global selectors that leak.
- SHOULD use `var(--*)` for dynamic values (colors, borders, surfaces). Use inline `style` only for truly dynamic values (grid columns, computed dimensions).
- Preserve important host geometry required by the canvas trust checklist. Document other important overrides.
- MUST use the existing spacing scale: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40px. If a value isn't in the scale, use the nearest one; never introduce arbitrary spacing values.

## Animation

- MUST use CSS transitions for all interactive state changes (hover, focus, active).
- Standard transition durations: `120ms ease` for press/hover, `150ms ease` for state changes.
- MUST name transition properties explicitly. NEVER use `transition: all`.
- MUST animate only compositor properties (`transform`, `opacity`) unless the surface is small and isolated.
- NEVER exceed 200ms for interaction feedback.
- MUST respect `prefers-reduced-motion: reduce`: wrap motion in a media query or use existing patterns from `editor.css`.
- NEVER add entrance animations unless explicitly requested.
- NEVER use CSS `@keyframes` for interactive state changes; they can't be interrupted.

```css
/* Standard interactive transition */
.element {
  transition: background 120ms ease, color 120ms ease;
}

/* Respecting reduced motion */
@media (prefers-reduced-motion: reduce) {
  .element { transition: none; }
}
```

## Typography

- MUST use `text-wrap: balance` only for short page, section, card and scene titles of one or two lines. Use `text-wrap: pretty` for sentences: paragraphs, list items, captions, labels, feedback, and question stems or prompts, even when styled as headings. Learner wrapping is owned by `packages/shared-blocks/src/reading-rhythm.css`.
- MUST use `font-variant-numeric: tabular-nums` for dynamic numbers (counters, file sizes, progress).
- Font size scale: 10px (tiny), 11px, 12px (small/default), 13px (mono), 14px (body), 15px, 18px, 22px, 24px, 28px. NEVER introduce font sizes outside this scale.
- Font weights: 400 (normal), 500 (medium), 600 (semibold), 700 (bold).
- `-webkit-font-smoothing: antialiased` is already set globally. Leave it as is.
- NEVER modify `letter-spacing` unless explicitly requested.

## Layout

- MUST use a consistent `z-index` scale. Check existing values in `packages/editor-core/src/styles/editor-tokens.css` and neighboring files before adding new ones. Preserve the protected placement in `apps/desktop/src/shared/canvas-styles.ts`. Never use arbitrary `z-index: 9999`.
- MUST use `dvh` units instead of `vh` for viewport height.
- Activity/ribbon surfaces use the dedicated `--activity-bar-*` variables emitted by `apps/desktop/src/shared/canvas-styles.ts` from the theme definitions. They are not fixed dark; the current baseline follows the panel-gray theme.
- Panel borders use `var(--border-primary)`. Never hardcode border colors.

## Interaction

- MUST use Mantine `Modal` (with the `AlertDialog` pattern) for destructive or irreversible actions.
- SHOULD use skeleton loading states over spinners.
- MUST show errors in context, next to where the action happened, not in a global toast.
- NEVER block paste in input or textarea elements.
- Interactive elements need at least **44x44px** hit areas. If the visible element is smaller, extend it with a pseudo-element.

## Color and theme

- All colors MUST use the CSS variables owned by `packages/editor-core/src/styles/editor-tokens.css` for editor chrome or emitted by `apps/desktop/src/shared/canvas-styles.ts` for canvas controls.
- MUST work in both `data-theme="light"` and `data-theme="dark"`.
- Accent color: `var(--accent)` (blue). SHOULD limit accent usage to one per view: primary action, active state, or focus ring. Not decorative.
- NEVER use gradients unless explicitly requested.
- NEVER use glow effects as primary affordances.
- Borders: use `var(--border-primary)` or `var(--border-subtle)`. For images, use a 1px outline at low opacity:

```css
.image { outline: 1px solid rgba(0, 0, 0, 0.06); outline-offset: -1px; }
[data-theme="dark"] .image { outline-color: rgba(255, 255, 255, 0.08); }
```

Literal colors are allowed only in `packages/editor-core/src/styles/editor-tokens.css`, theme registry data, tests/fixtures, generated placeholder SVG assets, and brand/logo assets. `apps/desktop/src/shared/canvas-styles.ts` derives canvas tokens from theme data. Component CSS still uses tokens.

## Icons

- MUST use `@tabler/icons-react` for all icons.
- Toolbar/action icons: `size={20}` and `stroke={1.5}`.
- Small inline icons: `size={16}` and `stroke={1.5}`.
- NEVER mix icon libraries: no Lucide, no Heroicons, no inline SVGs for standard actions.
- Icon color via `color="var(--text-secondary)"` or `currentColor`.

## Browser canvas

- Test narrow viewports, zoom and embedded preview pane resizing.
- Preserve native selection, paste, undo and composition. Enter and blur save once; Escape cancels.
- Keep refused or unconfirmed text and recovery controls reachable without taking moved focus.
- Run affected specs with `pnpm --filter @praxity/desktop e2e:browser-editor` in Chromium, Firefox and WebKit. Real screen-reader evidence follows `/a11y`.

## Design anti-patterns

Never ship these:

- Purple or multicolor gradients
- Animated backgrounds or decorative motion
- Rounded corners larger than 8px on panels or cards (keep to the Mantine `sm` default)
- Drop shadows deeper than 2 layers
- Colored borders (use neutral `var(--border-*)` tokens)
- Placeholder content ("Lorem ipsum", "Coming soon") in committed code
- Generic "AI slop" aesthetics: glass morphism, neon accents, excessive blur

## Review checklist

When building or reviewing desktop UI, answer each:

1. **Tokens**: all colors from `packages/editor-core/src/styles/editor-tokens.css` for editor chrome or `apps/desktop/src/shared/canvas-styles.ts` for canvas controls? Works in both themes?
2. **Spacing**: using the 8px-based scale? No arbitrary values?
3. **Components**: using Mantine where it provides keyboard/focus behavior?
4. **Transitions**: 120ms ease for hover/press? Properties named? Reduced motion respected?
5. **Typography**: in the font size scale? `text-wrap` on headings? `tabular-nums` on numbers?
6. **Icons**: Tabler only? Correct size/stroke? `aria-label` on icon-only buttons?
7. **Hit areas**: 44x44px minimum for interactive elements?
8. **z-index**: using the existing scale? No arbitrary values?
9. **BEM naming**: matching existing patterns in the file?
10. **Theme**: light and dark both work? Activity/ribbon surfaces use the current dedicated tokens?
11. **Preview alignment**: static previews omit nav/a11y/badge while matching C/D theme and layout; interactive preview and export use shared runtime behavior?
