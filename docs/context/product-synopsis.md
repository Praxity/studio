# Praxity Studio product synopsis

Praxity Studio is the authoring and export engine moving into Rubato. Its standalone CLI and thin browser canvas let authors write grammar 4, preview locally, and export accessible eLearning without sending course or learner data to Praxity Studio.

## Current focus

The current quality bar is a local CLI and thin canvas, distributed through Rubato, that produce accessible SCORM and standalone HTML:

- responsive, slide-shaped pages from mobile Safari through desktop;
- keyboard and screen-reader operation;
- AODA-surpassing defaults for contrast, focus, touch targets, and reflow;
- per-slide MP3 narration with VTT captions and transcripts;
- narration-synced reveals that never gate access to content;
- multiple-choice knowledge checks, feedback, and light branching;
- client themes and reusable slide styles;
- SCORM 2004 3rd Edition packages that meet LMS constraints.

SCORM 1.2 and standalone HTML remain supported. xAPI code remains experimental and hidden. cmi5 is bookmarked for later.

## Product model

Under the September 29 decision, Studio 0.3.0 and later use the unmodified PolyForm Perimeter 1.0.1, without an Ethical Use Policy or Community Permission. Use at home and work is free; embedding or reselling the tool's function needs permission. See [LICENSING.md](../../LICENSING.md). Studio 0.2.0 keeps the terms it shipped with; Rubato host/UI remains MIT.

Projects stay on the author's machine as readable `.prax` files, course metadata, and assets. Authoring, preview, and export work offline. The canvas and published output use the same canonical compiler: server-rendered HTML with only the planned islands. Edit mode uses an inspection projection of that compiler output.

The default slide theme is part of the product: restrained typography, generous space, one accent colour, and pre-validated accessible states. Brand themes override tokens. Named slide styles compose controlled layout primitives instead of arbitrary CSS, so exports can keep checking contrast and reflow.

Praxity Studio is a general tool for instructional designers and small teams that need brandable, accessible SCORM without a cloud authoring platform. Client content and brand-pack application are consulting deliverables, not Studio roadmap work. Desktop IPC sharing is retired. Authoring stays local; learner tracking stays on the learner device or in the customer's LMS.

The slide runtime described above is implemented and shipped: slides layout, narration bar with captions/transcript and synced reveals, the clean default theme, declarative slide styles, SCORM 2004 / 1.2 / HTML export, and the review-share worker. It has been through a specialist accessibility audit and a published-output taste pass. Canvas accessibility requires acceptance in the actual T3 preview host; published output is tested separately in Safari with VoiceOver.

## V1 boundaries

Standalone CLI artifacts are platform-specific; release acceptance belongs to each supported artifact. It has no cloud editor, dashboard, real-time collaboration, social or payment blocks, SCORM import, or first-class xAPI/cmi5 release path. Studio offers an offline PDF workbook export through `format-renderers`, with optional answers and paper-size settings. PDF remains experimental and outside the v1 accessibility quality bar. Signed offline export and native PDF screen-reader checks remain separate release requirements. The sovereign adapter packages also remain outside that quality bar.

## Narrated module decks in development

An opt-in narrated module-deck setting combines each lesson into one document with active slides, continuous user-started audio, a complete reading script and author-selected attempt/pass knowledge-check gates. It preserves the default runtime. Studio settings persist the mode, authored stops and attempt/pass gates. The reading panel and shared narration player use the learner UI primitives. Broader block/branch compatibility and delivery validation remain open; this is not the default.
