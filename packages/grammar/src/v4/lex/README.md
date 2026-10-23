# Grammar 4 lexical contract

Import `tokenizeLesson`, `toUtf8Offset`, `toUtf16Offset`, `lineColumn` and their types
from this directory's `index.ts`. Grammar 3 does not import this module.

`tokenizeLesson(text)` returns `{source, tokens, lines}`. Offsets are half-open
UTF-16 ranges in the original decoded string. Nonempty token ranges partition that
string exactly. Tokens retain raw BOM, tabs, spaces, CRLF, LF and lone CR. A final
terminator belongs to its preceding line. There is no synthetic EOF token or line.
Each line records its kind, source range, `contentEnd` before its terminator, and
half-open `tokenStart`/`tokenEnd` indexes.

Structural lines start at column zero. Code, math, frontmatter and quotes shield
their contents from structural recognition. Code fences open at column zero or
the current list item's content column. Blank lines preserve the list context.
Numbered markers include their whole width, so `10. ` has content column four.
A fence on the item's first line keeps the `list-item` line kind and emits a second
marker token for the code fence. Closers must use the opening character, at least
its length, and the same indentation. Four-space code without a list context is
prose. Math fences use `$$` at column zero. Setext headings remain prose.

Headers split marker, block type, subject, whitespace and settings. Subjects decode
escaped ASCII punctuation only after boundaries are identified. Image lines split
alt and source ranges and accept settings immediately after `)`. Image labels and
destinations support escaped delimiters and balanced brackets or parentheses.
The inline tokenizer remains responsible for rendering those fields.

Settings split braces, keys, equals signs, values, flags and whitespace. Keys use
ASCII letters followed by letters or digits. Keys are case sensitive. Space and
tab separate entries; neither may surround `=`. Flags have value `true`. Explicit
values stay strings for schema validation. Quoted values include their quotes in
the raw range; decoding removes quotes and interprets `\"` and `\\` only. Unknown
escapes and unquoted paths retain backslashes. Braces inside quotes are ordinary
characters. Empty quoted strings and empty groups are permitted lexically.

Invalid reserved suffixes produce diagnostic tokens with language-neutral codes,
never title text. Non-final or repeated suffix groups produce a diagnostic for the
whole suffix. Within a group, recovery retains the rest of a malformed entry as a
diagnostic. A duplicate key replaces that key's token with a diagnostic containing
its name and `firstStart`; it does not emit another usable key or flag. Ignore its
following equals/value tokens when resolving settings, and keep the first entry.

`name: text` is a lexical part candidate. The tree uses its enclosing schema to
recognize a part or keep the line as prose. Unknown names never discard content.
An optional `isSettingName(name, lineStart)` dependency identifies misplaced setting
lines, including aliases or suggested spellings. Tree/schema supplies that policy;
G1 contains no setting-name table. Without it, named body settings remain part
candidates. Standalone brace groups containing `=` are diagnostic without a schema;
bare flags need the classifier, so literal `{pressure}` and `{{score}}` stay prose.
Spaces including U+202F before a part colon stay prose for the validator to warn.
Space, tab, NBSP and U+202F after the colon belong to the separator, outside its value.

Offset functions take `(text, offset)`. Byte conversion rejects noninteger,
out-of-range and split-scalar offsets. Isolated surrogates use UTF-8 replacement
encoding. `lineColumn` returns one-based line and UTF-16 column numbers, counts the
BOM and tabs literally, and permits any UTF-16 position. A position between CR and
LF stays on the preceding line; the next line starts after LF.

Tree nesting, semantic spans, schema validation, translated messages, fence closure
errors and inline tokens belong to later tasks. This module invents no closers and
never normalizes, drops or rewrites source.
