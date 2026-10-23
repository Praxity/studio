# Inline icons

Use `@icon{mail}` in formatted learner text. Keep a visible label beside the icon.

```prax
# Contact support

Contact support @icon{mail} or use @icon{IconMail}.
Use @icon{IconMailFilled} for the filled variant.
```

Names accept kebab-case Tabler names such as mail, arrow-right and mail-filled, or export names such as IconMail and IconArrowRight. Unknown names remain literal text. Code spans keep the syntax literal.

Icons are decorative, hidden from assistive technology, and inherit the text colour at 1em. They work in [formatted learner fields](reference/inline-formatting.md#where-formatting-works), including link labels and doodles. They cannot supply an accessible name alone.

Published output embeds validated SVG path data for the icons used by the course. It needs no icon CDN. A [note's icon setting](reference/blocks-content.md#note) uses a lowercase Tabler name; omission uses the tone's default, and icon=none hides it.
