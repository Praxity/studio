# Context Recovery (Post-Compaction)

When context has been compressed (you'll notice missing details about earlier conversation), follow these steps:

1. **Re-read `CLAUDE.md`** — it routes you to the right context files
2. **Re-read the task plan** — if a plan or task contract exists for the current work, re-read it before continuing
3. **Re-read relevant context files** — only the ones needed for the current task (see routing in CLAUDE.md)
4. **Check active task state**: review the task contract, branch diff and pull-request checks for completed work and remaining checks.
5. **Do NOT assume** — if you're unsure what was discussed or decided, verify by reading files or asking the user. Never guess at prior decisions.

## Common mistakes after compaction
- Repeating work that was already completed (check git status / task list first)
- Losing track of which approach was chosen (re-read the plan)
- Forgetting constraints that were discussed (re-read CLAUDE.md non-negotiables)
- Making assumptions about file contents instead of reading them
