# Course manifest

Use course.yaml to order lessons and share metadata, design and dialogue speakers. Each lesson's pages start with # headings. Keep media in an assets folder beside the manifest.

```yaml
title: Workplace safety
description: Prepare for a safe shift
locale: en
moduleDeck: false
narrationEnabled: true
cast:
  alex:
    name: Alex
    avatar: assets/alex.png
    voice: v1
    side: start
  sam:
    name: Sam
    side: end
lessons:
  - intro.prax
  - hazards.prax
design:
  palette: standard
  navArchetype: sidebar
```

| Field | Type | Meaning |
|---|---|---|
| title | string | Course title |
| description | string | Optional course description |
| locale | string | Default language, such as en or fr |
| courseHomeUrl | string | HTML export destination for glossary and Pages/Guided course-return actions. Defaults to `index.html`. Accepts a relative URL or an absolute HTTPS URL. |
| theme | string | Optional shared or built-in theme name |
| moduleDeck | boolean | Guided-slide playback. Omitted means false. See [module decks](module-deck.md). |
| narrationEnabled | boolean | Enable narration unless a lesson overrides it in the narration sidecar |
| cast | mapping | Shared speakers keyed by identifier |
| lessons | string array | Lesson filenames in course order. Omitted or empty discovers files alphabetically. |
| design | mapping | [Presentation overrides](frontmatter-design.md) shared by lessons |

Identity is stored in [.praxity/identity/](content-identity.md), outside authored YAML and .prax source. Preserve the sidecars when editing or backing up a course.

## Lesson order and navigation

List each .prax lesson filename in lessons. HTML and SCORM exports follow that order. Lesson links use frontmatter title and open the lesson's first page. Previous and Next cross lesson boundaries. SCORM exports remain one package with one SCO and one course completion record.

The glossary collects terms across listed lessons. It opens separately and contributes no progress or completion. See [inline formatting](inline-formatting.md).

Set `courseHomeUrl: ../overview/` or `courseHomeUrl: https://example.org/courses/safety/`
to return learners to your site's course page from the glossary's "Back to the course"
link and the Pages and Guided "Back to course" actions. Relative URLs resolve from
the exported HTML document. Root-relative paths,
queries and fragments are allowed. Empty values, protocol-relative URLs such as
`//example.org/`, backslashes, control characters and schemes other than HTTPS
are refused with a message naming `courseHomeUrl`. SCORM, xAPI and PDF ignore the
destination. Validation applies whenever the manifest is read: an invalid value
prevents the course from loading in Studio or CLI commands, including non-HTML
exports. Correct or remove the field in `course.yaml` to load it again. CLI refusal
messages use `--lang`, independently of the course's `locale`. Omit the field to keep
the existing `index.html` links.

## Course cast

Cast keys start with a letter and use letters, digits, underscores or hyphens. Each entry needs a nonempty name. Avatar, voice and side are optional. Avatar points to a project asset; remote URLs warn. Side is start or end. Invalid sides warn and are ignored. Without a side, the first speaker appears at start and other speakers at end.

Dialogue turns use these keys and match them without regard to case. Local speaker declarations are not supported. The [example manifest](../examples/patterns/course.yaml) supplies cast for both dialogue patterns. See [dialogue](blocks-content.md#dialogue), the [dialogue pattern](../examples/patterns/dialogue.prax) and the [CLI cast example](../cli.md#course-cast).

## Settings inheritance

Lesson lang overrides course locale, then workspace defaultLocale. The fallback is en. Each published lesson uses its resolved language for learner controls.

`praxity inspect <course> --schema 1` preserves this distinction in its
[language provenance](../cli.md#language-provenance). `course.locale` retains its
`en` fallback for compatibility; `course.language.declared` is `null` and its
`source` is `default` when the manifest omits `locale`. Each lesson's `language`
reports its resolved `value` and whether it came from `lesson`, `course` or
`default`. Inspect does not load workspace defaults and explicitly reports
`course.language.workspaceContext: "unavailable"`; it never claims a workspace
source. These fields are additive within inspect projection 2. They record
declarations, not language detection.

Lesson frontmatter design overrides course design, then workspace defaults. Nested deck settings merge per key. See [frontmatter](document-structure.md#frontmatter) and [frontmatter design](frontmatter-design.md).

Scripts, narration anchors and audio assets are linked through narration.yaml. They do not belong in .prax blocks. Keep the whole project folder for preview and export.
