# Inventory: everything astrocode draws

One row per element. For each:

- **Question:** what it answers for you.
- **How often:** how often you need that answer. *Glance* means many times a turn, *turn* once a turn, *session* a few times a session, *rare* less.
- **Cost:** the rows it holds on screen, the color it spends, and any motion.
- **Verdict:** **keep**, **cut**, **merge** (with what), or **on demand** (shown only when asked for, or when it matters).

The verdicts are the audit's, not the design's. Phase 2 can overturn any of them with a reason.

## Transcript

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Start mark at the top of every transcript (5-row mirror, "astrocode", folder, branch) | Where am I? | Once | 6 rows in every session's first screen, gold | **Cut.** The folder and branch belong in the status bar or title; the mark repeats the start screen |
| Rail: the vertical line down the left edge | Which turn does this belong to? | Rare: turns are already bounded by your message and the closing line | 2 columns always; ~7 rows a turn that hold only the line | **Merge** into one gutter column of state marks; drop rows that exist only to carry the line |
| Your message, gold dot, bold | What did I ask? | Turn | Its rows; gold | **Keep.** It's what Alt+↑↓ and scanning look for |
| Inline code chips (filled, padded) in your message and replies | "This is code" | Glance | 2 cells and a fill each; teal on every identifier, up to 26 in a reply | **Cut** the fill and padding; color the text, as `claude` does |
| Step name, Claude's sentence (bold) | What was Claude trying to do? | Glance | 1 row a step | **Keep**: astrocode's best line |
| Step name made from the calls (italic) | Nothing the lines don't say | — | 1 row a step, often a wrapped command | **Cut**; let the activity lines stand alone |
| Step mark (✓ teal, ● running, gold waiting, ✕ rose) | Did this step work? | Glance | 1 cell | **Keep**, and fold into the gutter |
| Step duration, right edge | Was this slow? | Rare | ~6 cells | **On demand**: show when slow, or in the inspector |
| Activity line: verb, target, result | What did it do, to what, how did it go? | Glance | 1 row a call (6 at most a step) | **Keep.** Fix the tense, denied-as-done and false test counts |
| Activity result "✓ 105 lines" for commands | Not much: line counts say little | — | ~12 cells, teal check on each | **Cut** for commands where only a count is known; keep exit codes, test counts and diff sizes |
| Per-line duration "· 0.2s" | Was this call slow? | Rare | ~6 cells a line | **On demand**: only past a threshold |
| `›` at the end of every activity line | "This opens" | Rare once learned | 1 cell a line, ~20 a screen | **Cut**; hover and the focus model say it |
| Repeated verb written once | Same | — | Saves columns | **Keep** |
| `… N more` line in a long step | There's more here | Turn | 1 row | **Keep**; give it a key |
| Failure line under a failed call (rose) | Why did it fail? | Turn, when failing | 1 row | **Keep**, show the error, not a source line |
| Subagent: kind, call count, its latest call under it | What's the subagent doing? | Glance while one runs | 2 rows | **Keep** |
| Diff meter `■■■■□` beside `+9 −4` | How big? | — | 5 cells, teal and rose | **Cut**; the numbers say it |
| Opened step: every line plus Claude's thinking | What was Claude thinking? | Session | Many rows, on demand | **Keep, on demand**, with a key; consider a one-line thinking summary inline |
| Reply prose, teal diamond | What did Claude say? | Turn | Its rows | **Keep**; cap the line length on wide screens |
| Panels: code and output, language set in the top edge | Where code starts and ends | Turn | 2 edge rows a block, fill | **Keep** |
| `▶ run` and `copy` on code blocks | Can I run or copy this? | Rare | ~10 cells per block | **On demand**: on hover or focus |
| Tables without grid, quotes and callouts on a hairline | Structure | Turn | Low | **Keep** |
| Pictures from `show`, with a caption line (`enlarge`, `open`, `browser`) | What does it look like? | Session | Many rows, only in kitty | **Keep** |
| Diagrams and charts drawn from fences | Same | Rare | Same | **Keep** |
| Tool row on its own (hexagon, filled or outline) for Question, plan, `show`, mods | What tool and how it went | Session | 1 row | **Merge** with the activity line's form, so one glyph set means one thing |
| Answered question, question printed twice | What did I answer? | Rare | 2–3 rows | **Merge** into one line: question → answer |
| Plan entry (ExitPlanMode row, file path) | Which plan, and was it approved? | Rare | 1–2 rows | **Keep** |
| Notices "○ Background command finished: …" | Did background work end? | Session | 1 row + spacer | **Keep**, quieter, no spacer |
| Closing line `╰── 1m 39s  2.8k tokens  3 files changed · 2 commands` | How long, how much, what changed? | Turn | 1 row | **Keep and fix**: the change count becomes the way into the turn's diff, with a key |
| The list behind the closing line (click) | Which files and commands? | Turn, before "merge" | Opens in place | **Merge** into a turn review with sizes and diffs |
| Scroll pill `↓ 49 more lines` (gold) | Am I following the end? | Session | Covers the last row's right end | **Keep**, not gold, not over text |
| Scrollbar, right edge | Where am I in the session? | Session | 1 column | **Keep** |
| Hover: gold text and pointer shape | What would a click do? | Glance, with the mouse | None at rest | **Keep** |
| Inspected line, marked gold | Which call is the inspector on? | While inspecting | 1 cell | **Keep** |
| Selection (gold) and copy | Copy text | Session | None at rest | **Keep** |
| `!` command card, output streaming, "/tasks to stop it" | What's my command printing? | Session (60 `!` commands in your history) | Up to ~8 rows while running | **Keep** |
| Queued messages above the box, "↑ edits", "after this turn" | What have I queued? | Session | 1 row each | **Keep** |
| "Resumed '<title>' above." | Where the old session ends | Once | 1 row | **Keep** |
| Retry and compaction notices above the box | Why is it slow? | Rare | 1 row | **Keep** (not seen live) |

## Claude working

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Live line: braille spinner, "Working" / "Running Bash" with light passing over it, time, tokens, `esc to stop` | Is Claude working, on what, for how long? | Glance | 1 row; teal; two animations | **Keep** one motion that means "alive"; name the target, not only the tool |
| Row above the live line with a falling braille dot | Nothing the live line doesn't say | — | 1 row, motion | **Cut** |
| "Getting Bash ready" on the live line and `⬡ Bash  getting ready` as a row | Claude is writing a long tool input | Rare | 2 rows | **Merge** into the live line |
| `◆ Waiting for your OK` (gold, still) | Claude waits on me | Glance | 1 row | **Keep** one waiting signal; cut the others (step mark, line text, box placeholder) |
| Box placeholder "Claude is waiting for your OK above" | Same | — | Box can't take input meanwhile | **Cut**: say it once |
| Running line in a step (teal) | Which call is running? | Glance | Color only | **Keep** |
| To-do list pinned above the box (Ctrl+T) | What's left of Claude's plan? | Glance during long tasks | 1 row a to-do | **Keep** (not seen live) |
| Follow Claude: panel at ≥140 columns, dock above the box below that | What is the current call doing, in full? | Glance when on | 90 columns, or a dock of rows | **Keep** as an option; never show the same diff as a prompt below it |

## Message box and menus

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Box: filled panel with soft half-block edges | Where do I type? | Glance | 3 rows for one line: 2 edges, 1 text | **Keep the fill, cut one edge row** |
| Gold hairline on whatever has the keys | Where do my keys go? | Glance | 1 row's edge | **Keep**: one focus mark everywhere |
| Prompt glyph `❯` and cursor (gold) | Same | Glance | — | **Keep** |
| Placeholder ("Claude is working. Type to queue a message") | What will Enter do now? | Turn | None | **Keep** |
| Keyword paint (`ultrathink`, `ultracode`) and the box saying what each does | Will this word change the turn? | Rare | Color on two words | **Keep** |
| Stash (Ctrl+S) | Did I put a message aside? | Rare | — | **Keep** |
| `/` menu: 6 rows, name and description, `99 commands` notch, hint line | Which command? | Session (your most used input after text) | 8 rows while open | **Keep**; use the free rows above it; add `esc closes` to its hint |
| `@` menu: paths, folder first | Which file? | Rare (18 times) | Up to 6 rows | **Keep** |
| History search (Ctrl+R) | What did I type before? | Rare | 1–2 rows | **Keep**; read and write `~/.claude/history.jsonl` |
| Ctrl+X chord hint on the box's top edge | What can follow Ctrl+X? | Rare | Edge text | **Keep** |

## Status bar

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Mode chip (solid; rose words for bypass) | What will Claude do without asking? | Glance | ~12 cells, colored fill | **Keep**; `auto` shouldn't be gold |
| `shift+tab` beside the chip | How do I change the mode? | Rare once learned | 9 cells always, hard-coded key | **On demand**: first sessions, or in `?` |
| `context ────── 3%` | How full is the context? | Turn | 10-cell gauge + % | **Keep**; the gauge can go below 120 columns |
| `cache 59m` / `cache cold` / `↻` | Will my next message re-cache? | Rare | ~10 cells, teal | **On demand**: when under ~10 minutes, or cold |
| `◉ following` / `following paused` | Is Follow on? | When on | ~12 cells | **Keep** while on |
| Model and effort (`Sonnet 5.5`, `ultracode`) | Which model? | Session | ~12 cells | **Keep** |
| `↯ fast`, `thinking off` | Are those on? | When on | ~8 cells | **Keep** when on |
| `◌ 2 running` | Is something running in the background? | Glance while there is | ~10 cells | **Keep** |
| `7d 24%`, 5-hour window once high, reset times | How much plan is left? | Session | ~8 cells each; dropped at 80 columns | **Keep**; never drop it before the branch |
| `⎇ main ±3` | Which branch, how many changed files? | Session | ~12 cells | **Keep** |
| `Claude Ultra` (the plan) | Which account? | Once | ~12 cells | **Cut**, or into `/status` |
| `⇄ remote` | Is Remote Control on? | When on | ~9 cells | **Keep** when on |
| Mod status lines above the bar, mod toasts | What does my mod say? | Mod-dependent | 1 row each | **Keep** (not seen live) |

## Inspector

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Header: what the call did, `✓ exit 0` chip, duration | Which call, how did it go? | Every open | 1 row | **Keep** |
| Second header row: tool, `step 2 of 2`, time of day, `‹ 9 of 10 ›` | Where is it in the turn? | Rare | 1 row | **Merge** into one header row; drop the time of day |
| Tabs (Output, Command, Sent to Claude, Input; Diff, Content…) | Which view of the call? | Every open | 1 row + rule | **Keep** |
| Body with line numbers | The call itself | Every open | The rest | **Keep** |
| Footer hints (`←→ calls  tab view  ↑↓ scroll  c copy  esc close`) | Which keys work here? | Rare once learned | 1 row | **Keep**, short |
| Ctrl+O picker "Inspect a tool call" | Which call? | Session | Up to 10 rows | **Merge** into moving through the transcript by key; give Ctrl+O back to the transcript viewer |

## Prompts

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Permission card: title, description, command, diff, options, hint | May Claude do this? | Rare for you (bypass); common for others | 8–20 rows | **Keep**; print the command once; add claude's choices |
| Half-second guard | — | Every prompt | None | **Keep** |
| Subagent's name above its prompt | Who's asking? | Rare | 1 row | **Keep** |
| Diff in the card, tinted; side by side at wide widths | What will change? | Every edit prompt | Rows | **Keep**; add line numbers |
| Question: options, descriptions, preview beside or under, `Other…` | What does Claude need from me? | Session (111 answers) | Up to the whole screen at 80×24 | **Keep**; add notes |
| MCP form (text, numbers, yes/no, choices) | What does the server need? | Rare | Rows | **Keep** (not seen live) |
| Plan approval: plan rendered, file path, two options | Should Claude start? | Rare (9 plans) | Up to the whole screen | **Keep**; match claude's choices |

## Overlays

All of them sit above the box, with a gold hairline and a hint line.

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| `/tasks`: list, then a live view of one | What runs in the background? Stop it | Session | 6–25 rows | **Keep** |
| `/config`: rows of ◄ value ►, description | Change a setting | Rare | ~16 rows | **Keep**; Esc should close as everywhere else |
| `/plugins`: Installed / Discover / Marketplaces | Manage plugins | Session (44 times) | ~14 rows | **Keep** |
| `/resume`: sessions from both apps, filter | Pick up an old session | Rare | ~10 rows | **Keep** |
| Model and effort picker (Alt+P), `4 of 13` notch | Which model, how hard? | Rare (no mid-session switches) | ~14 rows | **Keep**; the notch counts rows you can't see, which confuses |
| `/pictures` lightbox, `32 of 32`, ←→, `o`, `b` | See a picture large | Rare | Most of the screen | **Keep** |
| `/help`: 35 lines of prose | Which keys exist? | Rare, but the only way in | Scrolls off | **Cut**; replace with a `?` sheet as claude has |
| Find bar (Ctrl+F) | Where did it say X? | Rare | 2 rows | **Keep**; scrollback has none |
| `/mcp`, `/permissions`, `/memory`, `/skills`, `/hooks`, `/sandbox` panels | Inspect Claude Code's setup | Rare | ~14 rows | **Keep** |
| Notch labels on panel edges (`99 commands`, `esc saves`, `32 of 32`) | Counts and the panel's exit key | Rare | Edge text | **Keep** where they count; drop where they repeat the hint line |
| Rewind picker (Esc Esc) | Go back to an earlier message | Rare (never typed) | ~10 rows | **Keep** |

## Agents view

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Header: where a new session starts, model, mode | What will Enter start? | Every visit | 1 row | **Keep** |
| Counts: `1 needs input · 4 working · 3 done` | Does anything need me? | Every visit | 1 row | **Keep**, and show it inside conversations too |
| Groups by project, your folder first | Where is each? | Every visit | 1 row a group | **Keep** |
| Row: mark, name, state, summary, PRs, age | What's it doing, what did it do? | Every visit | 1 row each | **Keep**; clean Markdown out of summaries |
| Input "describe a task for a new session", hint line | Start one | Session | 3 rows | **Keep** |
| Peek (Space) | More about one | Rare | Rows | **Keep** |

## Mods

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| Band above the box (`AbovePrompt`) | Whatever the mod shows | Mod-dependent | Up to half the screen | **Keep**: Claude Code parity. Needs keys (Ctrl+X Tab in claude) |
| Cards in the transcript (`ToolResult`, `CommandOutput`) | Same | Mod-dependent | Rows | **Keep**; make their buttons work |

## Start screen

| Element | Question | How often | Cost | Verdict |
| :-- | :-- | :-- | :-- | :-- |
| JWST mirror drawn large, segments lighting up | Is astrocode ready? | Once a session | ~20 rows; gold; animation | **Cut** to a small mark. Use the room for what you'd do next: resume, recent sessions, the keys |
| "astrocode", folder, branch | Where am I? | Once | 2 rows | **Keep**, smaller |
| Window title saying when Claude needs you | Should I switch back? | Session | None | **Keep** |
