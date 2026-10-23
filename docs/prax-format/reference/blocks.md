# Block index

Grammar 4 uses explicit blocks and Markdown content. [blocks.json](blocks.json) is generated from the grammar-4 schema. It includes types, settings, parts, body constraints, templates and conversion declarations. Never edit the JSON by hand. Regenerate it from Studio's repository:

```sh
node docs/prax-format/scripts/generate-block-index.mjs
```

| Topic | Reference |
|---|---|
| Content and media | [Content blocks](blocks-content.md) |
| Items and back faces | [Item containers](blocks-containers.md) |
| Questions and groups | [Questions and groups](blocks-assessments.md) |
| Tasks, retrieval sheets, highlight practice, write-distractors, signatures and rules | [Interactive blocks](blocks-interactive.md) |

## Shared block settings

These settings apply to blocks, images, headings, dividers, items and back faces when their reference section links here. Page and rule settings are listed separately. Keys are case-sensitive. Boolean keys can stand alone for true.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `width` | `narrow`, `wide`, `full`, `breakout` | Omitted | Outer block width. |
| `name` | name | Omitted | Human logic name. Start with an ASCII letter; continue with letters, digits or hyphens. Case-sensitive. |
| `hide` | `true`, `false` | Omitted | Hide the block initially. |
| `visible` | string | Omitted | Visibility condition. Quote expressions containing spaces. |
| `entrance` | `none`, `fade`, `slide`, `scale` | `none` | Entrance animation. |
| `level` | integer, at least 1, at most 6 | Omitted | Heading level override. |

## Shared question settings and parts

These settings and parts apply to choice, match, order, categorize, fill-blank, free-response, rating, matrix and hotspot. A group's settings are listed separately.

| Setting | Values | Default | Purpose |
|---|---|---|---|
| `points` | number, at least 0 | Omitted | Question score weight. |
| `required` | `true`, `false` | Omitted | Require completion. |
| `attempts` | integer, at least 0 | Omitted | Attempt limit. Zero allows unlimited attempts. |
| `shuffle` | `true`, `false` | Omitted | Shuffle response entries or items. |
| `scored` | `true`, `false` | Omitted | Include checked answers in scoring. A choice with no correct option remains ungraded. |
| `feedbackMode` | `retry`, `reveal` | Omitted | Retry keeps answers hidden; reveal can show them. |
| `display` | `standard`, `scenario` | Omitted | Question presentation. |
| `deckGate` | `attempt`, `pass` | Omitted | Guided-slide release rule. A pass gate requires an automatically checked answer. |

| Part | Learner text |
|---|---|
| `correct:` | Feedback after a correct answer. |
| `incorrect:` | Feedback after an incorrect answer. |
| `feedback:` | General question feedback when no result-specific or option feedback applies. |

Question parts precede response entries. See [choice feedback](blocks-assessments.md#choice) for option feedback and precedence. Omitted booleans without a schema default retain the renderer's default; omission does not always mean false.

For choice, an invalid `attempts` setting, including `2.5` or the string `'2'`,
produces the located source diagnostic `choice-invalid-attempts`. Publication,
including native PDF, refuses this source before producing output. Studio still
opens the project and shows this error in place of the preview until the author
fixes the setting. Outside edits retain the last good preview, and invalid
drafts return a refusal. The numeric value `2` remains valid. Other grammar
diagnostics keep their existing admission policy.

After an individual Check, the feedback describes the focused Try again or
Continue action. Once the feedback reveal finishes, the feedback and focused
action scroll into view using the nearest edge, clear of sticky navigation bars.
Choice feedback beside selected options starts with the first selected option.
If the feedback and action cannot fit together, the focused action takes priority.
The action's focus ring stays fully visible. The scroll is always instant.
