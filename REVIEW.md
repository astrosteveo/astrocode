---
# solo-review settings. Every key is optional; these are the defaults.
depth: auto            # auto | quick | standard | deep
security: auto         # auto | always | never
check: "bun run typecheck"  # the one command that builds and tests the project; init fills it in when it can tell
max_nits: 3
max_rounds: 3          # after this many rounds on one change, step back instead of re-reviewing
gate: push             # push | off: block Claude's `git push` while any finding is open
branch: require        # require | off: no file edits on the default branch
workflow: manual       # manual | auto: auto runs review and ship when a task is done; manual waits for you to ask
merge: rebase          # rebase | squash | merge: how /solo-review:ship lands a branch
sensitive:             # reviewed deep with a security pass, and you must read them before a merge. Added to the
                       # plugin's always-sensitive list (Claude config, CLAUDE.md, CI, git hooks, dependency
                       # manifests, secrets), which nothing here can remove. `ledger.py config` shows both.
  - "src/session.ts"
  - "src/claude.ts"
  - "src/edits.ts"
  - "src/shell.ts"
  - "src/settings.ts"
skip: []               # never reviewed, except files on the always-sensitive list (such as lockfiles), which
                       # skip never hides
---

# Review guide

Keep this short. The reviewer reads all of it on every run, and short guides get followed.

## What failure looks like here
- A tool call runs without the permission prompt it should get: `permissionMode` left implicit, or "Always allow" applying more than `narrowest()` (such as `setMode: acceptEdits`).
- Anything written to the terminal behind Ink's back, or a changing entry put in `<Static>`: ghost prompts, shifted layout, output that never redraws.
- astrocode writes Claude Code's settings files directly, handles API keys or reads credentials, or leaks a session-only pick (plan mode, max effort, ultracode, fast mode) into `settings.json`.
- `src/view/state.ts` stops being a pure reducer, so a replayed conversation draws differently from the live one.
- Keys lost or acted on twice: input read from React state instead of a ref, or a prompt answering Enter, Space or a digit inside `GRACE_MS`.

## Always check
<!-- Bug classes this project has shipped before. /solo-review:review-learn adds to this list. -->

## Don't flag
- Style, formatting, naming, or cleanup. Linters and /simplify handle those.
- Missing tests or docs, unless a line above asks for them.

## Intentional patterns
<!-- Deliberate choices the reviewer keeps flagging as bugs, each with the reason. -->

## Evidence
- Cite file:line and the input or path that triggers each finding. Do not guess from a name.
- Flag a bug class once and list every instance, rather than one finding per instance.
