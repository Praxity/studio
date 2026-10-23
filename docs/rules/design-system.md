# Design System Rules

## Token reference

Thin-canvas controls are owned by `apps/desktop/src/shared/canvas-styles.ts`.
They serialize the retained contrast-corrected default themes from
`apps/desktop/src/renderer/themes/`. The native textarea and reference-owned
controls live in protected shadow roots. The React App, theme hook and desktop
token stylesheet are retired.

The component and panel guidance below applies only to retained editor-core
components, not to the shipped thin canvas. Do not rebuild retired panels.

Learner themes are resolved separately by
`packages/shared-blocks/src/themes/resolve-design-tokens.ts`. Keep editor
appearance independent of course branding.

### Colors

| Context | Tokens | Purpose |
|---|---|---|
| Desktop surfaces | `--bg-primary`, `--bg-secondary`, `--bg-panel` | Canvas and chrome |
| Desktop text | `--text-primary`, `--text-secondary`, `--text-muted` | Body, secondary text and placeholders |
| Desktop actions | `--accent`, `--accent-on-surface`, `--accent-text` | Fills, text/icons on surfaces and text on fills |
| Desktop controls | `--control-bg`, `--control-border`, `--selected-bg`, `--selected-text` | Inputs and selected rows |
| Mantine components | `--mantine-*` | Bridge to active desktop role tokens |
| Learner output | `--praxity-*` | Course theme and layout |

Use `--accent-on-surface` for action text and icons. Use `--accent` for fills;
contrast depends on the active theme and surface. Decorative dividers use
`--border` or `--border-subtle`; meaningful control boundaries use
`--control-border`.

### Text contrast

Readable text must meet 4.5:1 against its surface, or 3:1 for large text.
Meaningful icons and control boundaries need 3:1. Check both appearances and
actual rendered surfaces; a fixed gray shade does not establish contrast.

Use `c="dimmed"` for secondary Mantine text. Retained components must provide their own theme mapping for
`--mantine-color-dimmed` and `--mantine-color-placeholder`. The theme factory corrects
role colors before serializing them as OKLCH; retain its contrast tests.
Badge text and meaningful badge boundaries need separate contrast checks.

### Spacing, shadows and radii

Use Mantine spacing, shadow and radius props for Mantine components. Reuse
existing desktop styles and panel tokens for native chrome. Put new desktop
color roles in the theme factory, token types, application hook and CSS defaults.

### Typography

Desktop chrome uses the system sans-serif stack. The source editor uses
`"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, monospace`.
Learner fonts and heading sizes come from the course design and shared resolver.

| Desktop size | Pixels at the default root size |
|---|---|
| `xs` | 12 |
| `sm` | 13 |
| `md` | 14 |
| `lg` | 16 |
| `xl` | 18 |

Use semantic heading levels with a visual size override where needed.
Do not derive content hierarchy from chrome font sizes.

## Rules

### Do

- Use Mantine component props for all styling: `p`, `m`, `gap`, `radius`, `shadow`, `color`, `size`
- Use `Stack` and `Group` for layout (not raw flexbox divs)
- Use `Paper` or `Card` for surface containers (shadows/radius come from theme defaults)
- Reference desktop role tokens in chrome CSS and `--praxity-*` in learner CSS
- Reference `--mantine-*` vars in CSS files for component-level tokens

### Don't

- Don't use `style={{ }}` for spacing, colors, typography, or radii — use Mantine props
- Don't hard-code hex colors — use Mantine color references or CSS variables
- Don't hard-code px values for spacing — use Mantine spacing tokens
- Don't add shadows manually — use the `shadow` prop
- Add new desktop color roles to the theme factory and token bridge together
- Use the current desktop and learner token names

### Exceptions (inline styles are OK for)

- Dynamic calculated values (e.g., `style={{ width: computedWidth }}`)
- One-off positioning (e.g., `position: absolute` with specific offsets)
- Canvas/diagram rendering with programmatic coordinates
- Animation keyframe targets

## Component defaults

Retained editor-core components use their own Mantine props and defaults. The
thin canvas uses native controls and the sizes in `canvas-styles.ts`; it has no
Mantine provider or App component.

## Panel Styling Standard

All editor right-sidebar panels follow this pattern:

| Element | Size | Weight | Example |
|---------|------|--------|---------|
| Panel header (no heading) | sm (13px) | 600 | `<Text fw={600} size="sm">Narration</Text>` |
| Panel header (with heading) | sm (13px) | 600 | `<Title order={5} size="sm" fw={600}>Theme</Title>` |
| Section subheader | xs (12px) | 600, uppercase, dimmed | `<Text size="xs" fw={600} tt="uppercase" c="dimmed">` |
| Row labels/body | xs (12px) | 400-500 | `<Text size="xs">` |
| Metadata/hints | xs (12px) | 400, dimmed | `<Text size="xs" c="dimmed">` |
| Container padding | sm (12px) | — | `p="sm"` on outer Stack/Group |
| Row vertical padding | xs (10px) | — | `py="xs"` on each interactive row |
| List item gap | xs (10px) | — | `gap="xs"` on Stack/list containers |
| Section dividers | Divider | — | `<Divider />` between sections |

**Form controls in panels** use `size="xs"` (Select, TextInput, Checkbox) to match panel density — consistent with the desktop defaults for Select and TextInput. Exception: primary editing surfaces (e.g., translation Textarea) may keep `size="sm"` for usability.

**ARIA rule:** If a panel header is a landmark for screen reader navigation, use `Title` (renders `<h5>`/`<h6>`) with a visual `size` override — never replace `Title` with `Text`.

### Content Density Standard

Panels display per-block items (narration scripts, annotations, translations, etc.). Each item has a **collapsed** state optimized for scanning and an optional **expanded** state for detail. Collapsed items should be compact enough that 10+ items fit on screen without scrolling.

**Principle:** Show just enough to identify which block is referenced. Clicking an item scrolls the canvas to that block.

| Panel | Collapsed | Expanded | Actions |
|-------|-----------|----------|---------|
| **Annotations** | Severity icon + 1-line message (`lineClamp={1}`) + rule badge. ~28px | Full message + block reference + dismiss action | Resolve toggle |
| **Narration** | Status icon + type icon + 50-char preview. ~32px | Full source text (no truncation) + inline audio player (▶ + duration) + ActionIcon generate. ~60–80px | ActionIcon generate/regen |
| **Translation** | Type + 60-char preview + status badge. ~40px | Full source text (untruncated, dimmed) + target textarea + inline action icons. ~150px | Icon buttons inline with target label |
| **Glossary** | Term name + 1-line definition (`lineClamp={1}`). ~36px | — | Navigate to first mention |
| **Resources** | Block name + checkbox. ~20px | — | Toggle inclusion |
| **Logic** | Variable name + value. ~24px | — | Read-only |

**Rules:**
- Expanded state must show **full text** — never apply `lineClamp` when expanded (that defeats the purpose of expanding).
- Per-item action buttons use `ActionIcon size="xs"` inline at end of row, not full-width buttons that consume a separate row.
- Text-style buttons must look interactive; use `variant="subtle"` with the active theme's action color, not zero-outline bold text.

## Settings Page Patterns

### Toggle placement

Toggles (`Switch`) go to the **right** of their label row. Use `Group justify="space-between"` with label text on the left and `Switch` on the right. This mirrors iOS/Android conventions and the Clerk/Tally reference products.

```tsx
<Group justify="space-between">
  <div>
    <Text size="sm">Collect learner name</Text>
    <Text size="xs" c="dimmed">Optional description</Text>
  </div>
  <Switch aria-labelledby="setting-title-id" />
</Group>
```

Never place a `Switch` to the left of its label. Always connect the `Switch` to its visible label via `aria-labelledby` (pointing to the label element's `id`), not a standalone `aria-label`.

### Floating save bar

Settings tabs that have saveable fields use a **sticky save bar** at the bottom of the viewport. The bar is hidden by default and slides up when any setting changes (dirty state).

- Position: `position: sticky; bottom: 0` with a subtle top border or background to separate from content
- Contains: "Save changes" button (`variant="filled"`) + "Discard" text button (`variant="subtle"`)
- Disappears after save or discard
- Do NOT use per-section Save/Cancel buttons — the floating bar replaces them
- Applies to settings surfaces with fields that require explicit save
- Does NOT apply to: auto-saving editor surfaces

### SettingsRow headings

When a `SettingsRow` title serves as a section landmark, pass `headingLevel` to render as a `<Title>` (e.g., `<h3>`) instead of `<Text>`. This preserves screen reader heading navigation while keeping the same visual styling (`size="sm" fw={600}`).

## Context Menu & Picker Patterns

### Context menus (Mantine `Menu`)

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| Action items | `sm` (13px) | 400 | Same as "Body text / menu buttons" |
| Section labels | `xs` (12px) | 600, uppercase, dimmed | Same as "Section subheader" |
| Shortcut hints | `xs` (12px) | 400, dimmed | Right-aligned, `aria-hidden="true"` |
| Helper/warning text | `xs` (12px) | 400, dimmed | Below item label for secondary info |
| Icons | 16px (actions), 14px (navigation) | — | Consistent with gutter icons |
| Minimum width | 220px | — | |

Keyboard shortcuts on menu items use `aria-keyshortcuts` with [UI Events key values](https://www.w3.org/TR/uievents-key/). Visual shortcut text is hidden from screen readers via `aria-hidden="true"`.

### Floating pickers (Pattern A)

When a menu item opens a secondary selection (e.g., "Turn into..."), use the close-then-picker pattern:

1. Menu closes on click.
2. Picker `Popover` opens at the same position (focus retry, up to 3 rAF attempts).
3. Picker uses `role="menu"` with `role="menuitem"` children.
4. Focus moves to first option on open; Escape and Tab both return focus to the original trigger.
5. Category groups use `role="group"` with `aria-label`.
6. Do NOT use `trapFocus` — pickers are menus, not dialogs.

| Element | Style |
|---------|-------|
| Category headers | `Text size="xs" fw={600} c="dimmed" tt="uppercase"` |
| Options | Icon (16px) + label (`size="sm"`) |
| Selection highlight | `--selected-bg` with `--selected-text` |
| Width | Match the triggering menu width (~200-220px) |

### Focus management rules

- Tab closes the picker and returns focus to the trigger (not a focus trap).
- Escape closes the picker and returns focus to the trigger.
- On successful action (Enter), focus moves to the affected element.
- On menu close, use the stored grip handle ref — never rely on Mantine's invisible target div.

### State toggle items

Menu items that toggle state (Hide/Show) use EITHER a label change OR a stable label + ARIA state (`aria-expanded`, `aria-checked`). Never both — dual signaling causes confusing double announcements.

### Lossy action warnings

- Show `⚠` icon + dimmed helper text with a **specific** warning per conversion type.
- Use `aria-describedby` pointing to the warning text (unique `id` per option).
- After the action: update `#praxity-live-region` for screen reader announcement, show toast with "Undo" button (6-second persist).
- Dimmed text must still meet 4.5:1 contrast ratio (WCAG 1.4.3).

## Reference Products (design inspiration)

When building new surfaces or redesigning existing ones, use these as visual references:

| Surface | Reference | What to study |
|---------|-----------|---------------|
| Editor/canvas | Tally | Compact inline editors, content-first, minimal chrome |
| Dashboard/lists | Linear | Dense list views, filter bars, sidebar nav |
| Settings pages | Clerk | Toggle rows, form sections, clean hierarchy |
| Course detail | Vercel dashboard | Project detail views, tabs, settings within projects |
| Published output | Stripe docs | Clean reading, progressive disclosure, typography |
