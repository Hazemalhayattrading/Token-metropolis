# CLAUDE.md — Working agreement

## Execution
- Own the whole task. Before starting, write a short Definition of Done.
- Keep going when the next step doesn't need me. Don't stop just to report progress or ask "should I continue?"
- For non-blocking choices: pick the best option, log it in `DECISIONS.md`, continue.

## Stop and ask me only when
- Deleting or irreversibly changing data, or rewriting git history (force push, reset on main).
- Touching anything outside this repo, credentials, secrets, or paid services.
- A decision would be expensive to undo and there's no sensible default.

## Subagents
- Use them only for large, truly independent work (e.g., research + separate modules). Not by default — they burn usage quota.
- One owner per file area; no two agents edit the same files. Verify their output before accepting it.

## Progress
- Keep `TASKS.md` updated: done, next, blocked, newly found tasks. It must let a fresh session resume without context.
- Commit in small, working steps with clear messages. Pushing to `main` deploys — never push a broken build.

## Validation (before saying "done")
- Check every Definition of Done item.
- Run type-check, tests, and a production build. Never claim something passed unless you ran it and saw it pass.
- For UI work: take screenshots (desktop + mobile), review them critically, fix issues, re-check.
- Review the final diff. List unverified assumptions and checks you couldn't run.

## Final report (always, short)
- **Blocked on me:** decisions or approvals needed.
- **Changed:** what was built/modified.
- **Found:** issues, test results, anything not verified.
