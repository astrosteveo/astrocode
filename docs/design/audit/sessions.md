# What you do in a session

From your session history: `~/.claude/projects/*/*.jsonl` and `~/.claude/history.jsonl`, read-only, 2026-10-23 to 2026-11-02.

## Data

- **Sessions.** 200 sessions in your real projects where you did something: 175 in `claude`, 24 in astrocode, 1 that moved from one to the other. The `entrypoint` field tells them apart (`cli` or `sdk-ts`).
- **Left out.** `-tmp*` and job folders, `claude -p` runs, and 45 sessions where Claude drove a test session over tmux.
- **Labels.** Each prompt has one label from ordered word-pattern rules. Spot checks put the error at 10–20% per label.
- **Slash commands** come from `history.jsonl`, which only `claude` writes.

## The shape of a session

A typical session is task-sized:

- **Short.** Median 4 prompts over 30 minutes. First prompts run 13 words, later ones 5, and 47% of prompts are five words or fewer.
- **Shaped the same way.** It starts with a task or a pasted handoff, gets a few short steering or approval replies, and ends with "merge": 37% of sessions end on a merge request.
- **Permissions are rare.** Bypass mode was on for 1,160 of 1,189 prompts. You answered 29 permission prompts in total, 27 of them in astrocode, and denied 3 things.
- **Subagents are common.** Claude used them in 22.5% of sessions, a median of 5 calls when used.
- **Some are picked up again.** 19% of sessions have a gap of an hour or more between prompts. `/resume` was never typed; resumes start from the command line.
- **The rest is rare.** No session changed model partway. 6% changed permission mode, mostly into plan. Interrupts: 24 in total, in 8% of sessions.

## Top ten, and the keys each takes

"Keys" counts keystrokes beyond the words you type. They're the same in both unless the row says otherwise.

| # | What you do | How often | astrocode today | claude |
| --: | :-- | :-- | :-- | :-- |
| 1 | Type a follow-up instruction | 224 times, 44% of sessions | Text, Enter | Same |
| 2 | Run a slash command (`/clear`, `/plugins`, `/review-gate`, `/ship`…) | 205, 56% | `/` + 2–3 letters + Enter runs the top match | Same |
| 3 | `/reload-plugins` (138 in astro-plugins) | 193, 34% | `/rel` Enter: 5 keys, handed to Claude Code | Same |
| 4 | Start a session with a task | 180, 90% | `astrocode` Enter, box ready in ~1.5 s, text, Enter | Same |
| 5 | Approve, "go", "continue" ("yes" 46 times) | 141, 37% | `yes` Enter: 4 keys | 2 keys when a suggestion shows (Tab or →, Enter) |
| 6 | Ask to merge or ship | 128, 46% | `merge` Enter: 6 keys | 2 with a suggestion ("merge it" was offered in this audit's run) |
| 7 | Ask a question or for status | 122, 30% | Text, Enter | Same |
| 8 | Answer Claude's question (59 in the picker, 52 typed) | 111, 26% | A digit, or ↓ and Enter: 1–2 keys | Same, plus `n` for notes |
| 9 | Push back or correct | 98, 12% | Often Esc to stop first, then text, Enter | Same |
| 10 | Send a message while Claude works | 85, 18% | Text, Enter joins between tool calls; Ctrl+X Enter waits for the turn's end | Same |

What isn't in the counts but sits between #5 and #6: checking what changed before saying "merge".

- **astrocode:** scroll to the turn's closing line, click it (no key), read the names. Then Ctrl+O, find each edit, Enter, and ←/→ through calls.
- **claude:** `/diff`, Enter.

Runners-up: accepting `claude`'s suggested next prompt (67 times, 24% of sessions), `!` commands (60), reporting a step done outside Claude ("reloaded", 54), asking to commit/push/open a PR (38), images (24), interrupts (24), `@` mentions (18).

## astrocode against claude, same dates

Oct 28 to Nov 2. astrocode's sample is small and mostly sessions on astrocode itself.

| | astrocode | claude |
| :-- | --: | --: |
| Sessions / prompts | 25 / 118 | 68 / 274 |
| Median words per prompt | 3.5 | 5 |
| Prompts of 5 words or fewer | 61% | 52% |
| Merge or ship share of prompts | 23% | 17% |
| Permission prompts you approved | 27 | 2 |

astrocode leaves no record of its own commands and keys (`/model`, `/resume`, Alt+P, the agents view), so how often you use them can't be counted.
