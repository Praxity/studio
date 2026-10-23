# Set presentation and media

Read [frontmatter design](../reference/frontmatter-design.md) for supported presentation keys. Course design applies to each lesson unless its frontmatter overrides it. [Course manifest](../reference/course-manifest.md) owns shared design and cast. [Module decks](../reference/module-deck.md) owns playback metadata.

Choose a palette value: ink, forest, plum, clay or clear. Retired values migrate on load. Keep learner text in source content. Theme colour and font values belong in YAML design.

Use named pageStyles for reusable page treatments and select them with `# Title {style=name}`. Use hideTitle to retain a page label without displaying an H1. See [page styles](../reference/document-structure.md#named-page-styles-and-corner-artwork).

Use [image settings](../reference/blocks-content.md#image) for size, alignment, ratio, fit and effects. Give meaningful images alt text. Decorative images use empty alt and decorative. Use figure for a caption and float for prose beside an image. Keep assets in the project so preview and export work offline.

For line drawings, use a transparent PNG or SVG without a white background rectangle. Check the drawing in both light and dark palettes, including its strokes and text. Published output preserves the authored image, so an opaque white background remains a white box on a dark page.

Apply [use decorative images sparingly](learners.md#use-decorative-images-sparingly) before adding images. Apply [add narration to graphics](learners.md#add-narration-to-graphics) when writing their spoken scripts.

Use [inline icons](../inline-icons.md) beside visible labels. Supply captions and transcripts for [video](../reference/blocks-content.md#video) and [audio](../reference/blocks-content.md#audio). Check contrast, keyboard use and narrow-screen reflow after presentation changes.
