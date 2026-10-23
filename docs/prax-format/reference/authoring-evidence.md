# LLM authoring evidence

The October 4, 2026 experiments compared authoring and editing formats on 23 tasks, three runs per task and configuration. Models received a format reference, a task and an input file. The proposed format used a scratch parser, not Studio's production grammar-4 reader. These scores measure the test tasks, not human authoring or production reliability.

Full fidelity requires a clean parse, the requested change and preservation of untouched structure, settings, inline markup and learner text. Structure-only scoring normalizes no-break spaces and curly apostrophes to plain characters. It is a separate score, not full fidelity.

Round 2 used Haiku and Luna at low effort, 69 runs per model and arm, 552 runs total. Values below are clean and correct.

| Model | Arm | Full fidelity | Structure only |
|---|---|---|---|
| Haiku | A, grammar 3 | 50/69, 72% | 54/69, 78% |
| Haiku | B, braces | 61/69, 88% | 67/69, 97% |
| Haiku | C, settings lines | 61/69, 88% | 67/69, 97% |
| Haiku | D, LESSON.md | 56/69, 81% | 62/69, 90% |
| Luna low | A, grammar 3 | 59/69, 86% | 59/69, 86% |
| Luna low | B, braces | 64/69, 93% | 64/69, 93% |
| Luna low | C, settings lines | 67/69, 97% | 67/69, 97% |
| Luna low | D, LESSON.md | 62/69, 90% | 62/69, 90% |
| Both | A, grammar 3 | 109/138, 79% | 113/138, 82% |
| Both | B, braces | 125/138, 91% | 131/138, 95% |
| Both | C, settings lines | 128/138, 93% | 134/138, 97% |
| Both | D, LESSON.md | 118/138, 86% | 124/138, 90% |

Round 3 used Sol 6.1 at high, medium and low effort, and Luna at max effort. It ran 69 trials per configuration and arm, 828 total. Full-fidelity and structure-only scores were equal in every cell.

| Configuration | A, grammar 3 | B, braces | C, settings lines |
|---|---|---|---|
| Sol high | 65/69, 94% | 69/69, 100% | 69/69, 100% |
| Sol medium | 66/69, 96% | 69/69, 100% | 68/69, 99% |
| Sol low | 66/69, 96% | 68/69, 99% | 69/69, 100% |
| Luna max | 62/69, 90% | 69/69, 100% | 69/69, 100% |
| All four | 259/276, 94% | 275/276, 99.6% | 275/276, 99.6% |

Round 2's braces arm had five silent structure failures and two syntax failures. Grammar 3 had 25 silent failures and no syntax failures. Round 3's braces arm had one silent failure and no syntax failures. Braces and settings lines were close enough that these runs do not establish a preference between them. Grammar 4 uses braces only; the settings-lines arm was experimental.

Source records are summary2.txt and summary3.txt from the format-next experiment. The task author also wrote the checks. Logic, charts, human authors and the full production lexer were outside the study. Scores include the summaries' final extraction and list-handling corrections.
