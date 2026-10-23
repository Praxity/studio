# Validate authored source

Run `praxity inspect <course> --schema 1` on the whole course. Fix every diagnostic at its lesson file and line. An HTML export then applies course, accessibility and asset checks ([CLI validation](../cli.md#validate-authored-lessons)). Report the commands and their results. A clean parse checks syntax only; it doesn't prove the edit kept the content or that the lesson teaches the task.

Then check what the parser can't:

- Every opener has a closer and every page begins with a title. Items sit inside item containers; close nested blocks before the next item. Settings stay in braces. Part names match exactly, with two-space continuation indentation.
- Required titles, response counts and numeric bounds match the [block reference](../reference/blocks.md). Stats and card grids take 2 to 4 columns. Comparison needs exactly two items. Choice needs at least two options and one marker kind; zero correct options means ungraded. Question feedback goes before the first option, and option feedback directly after its option with no blank line.
- Images have alt text or `{decorative}`. Media has captions and transcripts. Speaker keys exist in the course cast, page styles in `pageStyles`, and [logic](../reference/logic.md) names in defined names and variables. Each glossary term has one definition across the course.
- Untouched text, URLs, markup and Unicode spacing are unchanged. Headings and content order still read correctly after nesting changes.
- The [authoring for learners](learners.md#authoring-for-learners) rules hold in preview. They need a content review even when the parse is clean.

[Document errors](../reference/document-structure.md#errors) and [content identity](../reference/content-identity.md) explain recovery.
