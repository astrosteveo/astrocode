# Interaction map: every key, click, hover and wheel target

Read from the code at `39b480b`; `file:line` points at the handler (paths under `tui/` unless shown). These were also checked by running astrocode and `claude` side by side: Ctrl+O, Ctrl+L, `?`, `/diff`, the permission and question choices, the click on a turn's closing line, and Esc in `/config`. Ctrl+D, and Esc while Follow is paused, were checked in the code (`prompt.tsx:389`, `prompt.tsx:515`).

**Mode** column: **FS** = full screen (`-f`, `/fullscreen`), **SB** = scrollback layout, **both**. The mouse exists only in FS: `MouseContext` is null in SB (`main.tsx:151`, `mouse.ts:186`), so every click, hover and wheel row below is FS-only.

**Claude Code reference** (for the "differs from Claude Code" items): fetched https://code.claude.com/docs/en/keybindings, `/interactive-mode`, `/fullscreen`, `/agent-view` on 2026-11-02, plus the default-bindings table inside the installed binary `~/.local/share/claude/versions/2.1.316` (Claude Code 2.1.316) where the docs are silent.

---

## 1. Message box: keymap actions (`keys.ts` + `prompt.tsx` `perform()`)

Defaults are `keys.ts:44-73`; `~/.claude/keybindings.json` `Global`/`Chat` blocks override them (`keys.ts:108-144`). Dispatch: `prompt.tsx:504-508`, actions `prompt.tsx:384-443`. Active only while the box has the keys (`app.tsx:1579`: no question, MCP form, permission prompt, overlay, or focused inspector).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Enter (`chat:submit`) | box | Sends. With `\` before the cursor, inserts a newline instead. Empty box: nothing | both | prompt.tsx:410-413 |
| Ctrl+Enter, Ctrl+X Ctrl+S (`chat:sendNow`) | box | Sends now (queued messages first, this behind them); empty box sends only the queue | both | prompt.tsx:414-415, app.tsx:892-894 |
| Ctrl+X Enter (`chat:queueSubmit`) | box | Sends, marked to wait for the end of the turn | both | prompt.tsx:416-417 |
| Ctrl+J (`chat:newline`) | box | Newline | both | prompt.tsx:420-421, keys.ts:187 |
| Ctrl+C (`app:interrupt`) | box | Text: clears box. Empty + busy: interrupts. Empty + idle: arms exit (2 s), second press exits | both | prompt.tsx:387-388, app.tsx:1033-1037, 245-249 |
| Ctrl+D (`app:exit`) | box | Empty box: exits at once (no second press). Text: nothing | both | prompt.tsx:389-390, app.tsx:1592 |
| Ctrl+T (`app:toggleTodos`) | box | Pins/unpins the to-do list | both | prompt.tsx:391-392, app.tsx:1600 |
| Ctrl+O (`app:toggleTranscript`) | box | Opens the "Inspect a tool call" picker (last 50 calls and `!` commands). Not a toggle | both | prompt.tsx:393-394, app.tsx:1193-1207, 1771-1790 |
| Ctrl+R (`history:search`) | box | Enters history search (section 3) | both | prompt.tsx:395-397 |
| Ctrl+X Ctrl+K (`chat:killAgents`) | box | First press arms (status bar says so, 3 s); second stops all `!` commands and background tasks | both | prompt.tsx:398-399, app.tsx:463-470, 1637-1638 |
| Shift+Tab (`chat:cycleMode`) | box | Next permission mode | both | prompt.tsx:400-401, app.tsx:986-1000 |
| Alt+P (`chat:modelPicker`) | box | Model + effort picker (section 17) | both | prompt.tsx:402-403 |
| (unbound) `chat:increaseEffort` / `chat:decreaseEffort` | box | Steps effort; only reachable via keybindings.json | both | prompt.tsx:404-407, app.tsx:422-433 |
| Alt+T (`chat:thinkingToggle`) | box | Thinking on/off, or a notice that the model always thinks | both | prompt.tsx:408-409, app.tsx:448-457 |
| Alt+O (`chat:fastMode`) | box | Fast mode on/off | both | prompt.tsx:418-419, app.tsx:439-445 |
| Alt+W (`chat:workflowKeywordToggle`) | box | With `ultracode` in the text, toggles "ignore ultracode" | both | prompt.tsx:438-441 |
| Ctrl+_, Ctrl+-, Ctrl+Shift+- (`chat:undo`) | box | Undo (typing undoes a word at a time) | both | prompt.tsx:422-425 |
| Ctrl+G, Ctrl+X Ctrl+E (`chat:externalEditor`) | box | Message in `$EDITOR` | both | prompt.tsx:426-427, app.tsx:773-776 |
| Ctrl+S (`chat:stash`) | box | Stash / restore / swap | both | prompt.tsx:428-429, 186-198 |
| Ctrl+V (`chat:imagePaste`) | box | Attaches clipboard image | both | prompt.tsx:430-431, 342-350 |
| Ctrl+L (`chat:clearInput`) | box | Clears the box (undoable) | both | prompt.tsx:432-433 |
| Ctrl+B, Ctrl+X Ctrl+B (`task:background`) | box | Moves running call(s) to the background | both | prompt.tsx:434-435, app.tsx:1003-1009 |
| Alt+L (`chat:followClaude`, astrocode's own) | box | Follow Claude on/off; while paused on a call, resumes following | both | prompt.tsx:436-437, app.tsx:622-631 |
| Ctrl+X (prefix) | box | Waits 3 s for the chord's next key; the box's top edge lists what can follow | both | prompt.tsx:372-381, 474-485, keys.ts:225-228 |

## 1b. Message box: fixed keys (not in the keymap)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Shift+Enter, Alt+Enter | box | Newline | both | prompt.tsx:526-530 |
| Esc | box | Menu open: closes menu. Busy: interrupts. Text in box: nothing. Empty + idle: second Esc within 600 ms opens `/rewind` picker | both | prompt.tsx:495-498, 514-524, app.tsx:720-724 |
| Tab (no menu) | box | Nothing | both | prompt.tsx:525 |
| ← (empty box, no modifier) | box | Opens the agents view | both | prompt.tsx:546 |
| ← / → | box | Cursor by character; Ctrl or Alt: by word (whitespace-delimited) | both | prompt.tsx:547-548, 954-966 |
| Alt+B / Alt+F | box | Word back / forward (whitespace-delimited) | both | prompt.tsx:543-544 |
| Alt+D | box | Cut word after | both | prompt.tsx:545 |
| Alt+Backspace | box | Cut word before | both | prompt.tsx:531 |
| Ctrl+W / Ctrl+U / Ctrl+K | box | Cut word before / to line start / to line end | both | prompt.tsx:552-554 |
| Ctrl+Y | box | Puts back the last cut | both | prompt.tsx:513 |
| Home, Ctrl+A / End, Ctrl+E | box | Line start / end (not with Ctrl) | both | prompt.tsx:550-551 |
| Backspace / Delete | box | Delete grapheme before / after | both | prompt.tsx:532-542 |
| ↑ | box | Empty box with queued messages: takes them back to edit. Else line up, else older history | both | prompt.tsx:555-559, app.tsx:1015-1026 |
| ↓ | box | Line down, else newer history (back to the draft) | both | prompt.tsx:560-563 |
| Alt+↑ / Alt+↓ | box | FS: swallowed here, the transcript jumps (section 5). SB: same as ↑/↓ (history) | FS vs SB | prompt.tsx:512 |
| Ctrl+F | box | Opens the find bar | FS only | prompt.tsx:511, app.tsx:1609 |
| Ctrl+Z | box | Suspends to the shell (`fg` returns) | both | prompt.tsx:509, app.tsx:951-984 |
| `!` first char | box | Shell mode: Enter runs the command, output streams into a card | both | prompt.tsx:925-927, app.tsx:781, 682-698 |
| `#` first char | box | Memory mode: Enter opens "Add the note to" picker | both | app.tsx:782, 701-711 |
| `/` first char | box | Command menu (section 2); Enter on astrocode's commands runs them locally, others go to Claude Code | both | app.tsx:785-888 |
| Paste | box | Text inserted; a pasted/dropped image path attaches the image | both | prompt.tsx:353-369 |
| Click in text | box | Puts the cursor there | FS | prompt.tsx:587-594 |
| Hover over text | box | Pointer becomes a text beam | FS | prompt.tsx:601 |
| Click on the box/status bar while the inspector has the keys | pinned panel | Gives the keys back to the box; inspector stays open | FS | app.tsx:1471-1473 |

## 2. `/` command menu, argument menu, `@` file menu, mid-message `/command`

Built in `prompt.tsx:219-224`; keys `prompt.tsx:487-502`; drawn `prompt.tsx:765-822`.

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑ / ↓ | any menu | Moves highlight, wraps | both | prompt.tsx:489-494 |
| Tab | `/` menu | Completes `/name ` (doesn't run) | both | prompt.tsx:501, 305-307 |
| Enter | `/` menu | Runs the command; a command with an argument hint is completed instead | both | prompt.tsx:501, 305-308 |
| Enter right after `/name ` | argument menu | Sends the bare command unless you moved to a choice | both | prompt.tsx:499-501 |
| Tab / Enter | argument menu | Completes / runs `/name value` | both | prompt.tsx:310-313 |
| Tab or Enter | `@` menu | Writes `@path` (quoted if it has spaces); a folder keeps the menu open on its contents | both | prompt.tsx:314-321 |
| Tab or Enter | mid-message `/word` | Writes `/command` in place (doesn't send) | both | prompt.tsx:296-304 |
| Esc | any menu | Closes the menu for the text as it is | both | prompt.tsx:495-498 |
| Wheel over menu | menu | Moves highlight by one | FS | prompt.tsx:574-579 |
| Click a row | menu | Same as Enter (runs, completes, attaches) | FS | prompt.tsx:581-585 |
| Hover a row | menu | Row gets `›` and hover background, pointer hand | FS | prompt.tsx:600, choice.tsx:8-11 |
| Hint line | menu | Files: "tab or enter attaches esc closes"; inline: "tab or enter writes it in esc closes"; args: "tab completes enter runs esc closes"; commands: "tab completes enter runs" (no Esc) | both | prompt.tsx:772-778, 819 |

## 3. History search (Ctrl+R)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Type | search panel | Filters sent messages (newest first) | both | prompt.tsx:466-469 |
| Ctrl+R (whatever `history:search` is bound to) | search | Next older match | both | prompt.tsx:452-455 |
| Backspace | search | Deletes from query | both | prompt.tsx:460-464 |
| Enter, Tab, ←, →, ↑, ↓ | search | Keeps the match in the box (does not send) and ends search | both | prompt.tsx:465 |
| Esc, Ctrl+C, Ctrl+G | search | Cancels, restores the box | both | prompt.tsx:456-459 |
| Mouse | search | Ignored | FS | prompt.tsx:572 |
| Hint | search | "ctrl+r older enter keeps it esc cancels" (hard-coded "ctrl+r") | both | prompt.tsx:657 |

## 4. Slash commands astrocode handles itself

Menu entries `app.tsx:1044-1093`; dispatch `app.tsx:785-888`. Everything else goes to Claude Code.

| Command | Opens / does | Surface | file:line |
|:--|:--|:--|:--|
| `/clear`, `/new` | New session | – | app.tsx:789-794 |
| `/resume [id]` | Picker of saved sessions with preview / resumes id | Picker (16) | app.tsx:797-798, 1170-1192 |
| `/model [name]` | Model+effort picker / sets model | ModelPicker (17) | app.tsx:799-801 |
| `/effort [level\|ultracode]` | Effort list picker / sets level | Picker (16) | app.tsx:802-806, 1149-1168 |
| `/output` | Same as Ctrl+O | Picker (16) | app.tsx:807-808 |
| `/play` | Picker of commands from Claude's shell blocks | Picker (16) | app.tsx:811-813, 1208-1227 |
| `/pictures` | Lightbox on newest picture | Lightbox (20) | app.tsx:809-810, 647-652 |
| `/plugins`, `/plugin` | Plugin manager | (15) | app.tsx:814-816 |
| `/fullscreen` | Switch layout | – | app.tsx:817-818 |
| `/rewind` | Rewind picker, then "how" picker | Picker (16) | app.tsx:819-820, 1228-1270 |
| `/tasks` | Running list, or the one running thing's view | Picker / TaskView (19) | app.tsx:821-822, 473-476 |
| `/config` (`fullscreen=` arg) | Settings | ConfigMenu (18) | app.tsx:823-854 |
| `/mcp` `/permissions` `/allowed-tools` `/memory` `/hooks` `/skills` `/sandbox` | Manager panels | (14) | app.tsx:856-871 |
| `/status` | Status panel | (22) | app.tsx:868-869 |
| `/output-style` | Picker | (16) | app.tsx:872-874 |
| `/export [file]` | Picker save/copy, or saves | (16) | app.tsx:875-876 |
| `/copy [n]` | Copies a reply | toast | app.tsx:877-878 |
| `/remote-control`, `/rc` | Remote panel | (22) | app.tsx:879-881 |
| `/btw <q>` | Side answer panel | (22) | app.tsx:882-884 |
| `/help` | Prints HELP (+ FULLSCREEN_HELP in FS) as a notice | transcript | app.tsx:795-796, 136-169 |
| `/exit`, `/quit` | Exits | – | app.tsx:786-788 |

## 5. Transcript in full screen (`screen.tsx`, `transcript.tsx`, `mouse.ts`, `selection.ts`)

The transcript's mouse listener is a fallback: it sees only what menus, pickers, the inspector, buttons and the status bar didn't handle (`screen.tsx:345`, `mouse.ts:181-184`).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Wheel | anywhere not handled (incl. over message box, status bar, /config, prompts) | Scrolls 3 lines; scrolling up stops following | FS | screen.tsx:248-251, 20 |
| PgUp / PgDn | when no overlay or focused inspector | Scrolls (view − 2 lines) | FS | screen.tsx:352-355 |
| Ctrl+Home / Ctrl+End | same | Top / follow the end | FS | screen.tsx:356-357 |
| Alt+↑ / Alt+↓ | same | Viewport top to previous/next message of yours; past the last, follows the end | FS | screen.tsx:353, 364-374 |
| Alt+Shift+↑ / ↓ | same | Same, between tool calls and `!` commands | FS | screen.tsx:353, 367 |
| Any key | transcript | Clears the selection | FS | screen.tsx:350 |
| Press-drag | text | Selects (only content: not rail, not panel padding); copies on release (OSC 52 + desktop) | FS | screen.tsx:273-277, 288-296, 342, app.tsx:633-637 |
| Drag held at top/bottom edge | text | Auto-scrolls 20→60 lines/s | FS | screen.tsx:292-294, 187-209 |
| Double-click | text | Selects and copies the word/path/URL/number | FS | screen.tsx:278-285, selection.ts:28 |
| Triple-click | text | Selects and copies the line | FS | screen.tsx:282-285 |
| Shift+drag | text | Terminal's own selection (mouse reporting bypassed by terminal) | FS | app.tsx:168 (help text only) |
| Click `↓ N more lines` pill | bottom-right | Follows the end again | FS | screen.tsx:261-264, 504-514 |
| Click / drag scrollbar | right column | Jumps / drags | FS | screen.tsx:265-268, 290 |
| Click a link (OSC 8) | any text | Opens it after 300 ms (waits out a double-click). Web links via xdg-open; astrocode's own `copy`, `▶ run`, `enlarge`, `browser` links act (section 7) | FS | screen.tsx:319-320, app.tsx:655-673 |
| Click a picture | picture cells | Opens the lightbox on it | FS | screen.tsx:321-322, app.tsx:1685 |
| Click a "hot" row (head of an entry, or a step line with a target) | transcript | Acts at once: see section 7 | FS | screen.tsx:323-327, transcript.tsx:107-110, 133, 151-157 |
| Click anywhere inside an opened entry (`!` card, turn closer) | transcript | Closes it (on text, after 300 ms) | FS | screen.tsx:329-340 |
| Click your own message, a reply, thinking, notices | transcript | Nothing (not hot) | FS | transcript.tsx:151 |
| Hover a hot row | transcript | Its words turn gold (`lit`), pointer hand | FS | screen.tsx:449, 481-482, selection.ts:272 |
| Hover a link | transcript | Link words gold, pointer hand | FS | screen.tsx:444-445, 479-480 |
| Hover a picture | transcript | Pointer magnifying glass (zoom-in), no highlight | FS | screen.tsx:447 |
| Hover scrollbar / pill | right edge / pill | Pointer hand | FS | screen.tsx:439, 455 |
| Hover anything else | transcript | Default arrow, no highlight | FS | screen.tsx:450 |

## 6. Transcript in scrollback

Output goes to the terminal's own scrollback through Ink `<Static>` (`app.tsx:1694-1731`); the terminal owns the mouse.

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Terminal's own scroll/select/search | scrollback | Native | SB | – |
| Terminal "jump to previous/next prompt" (kitty etc.) | your messages | Each message emits OSC 133 prompt marks | SB | entries.tsx:55, window.ts:212-219 |
| Terminal link click (OSC 8) | file path on a standalone tool row | Opens the file (terminal decides gesture) | SB | entries.tsx:96, tool-row.tsx:62 |
| Terminal link click | figure caption `open`, `browser` | Opens the picture / mockup page file | SB | figure.tsx:105-108 |
| Terminal link click | Markdown links, bare URLs | Terminal opens | both | markdown-view.tsx:184, links.ts:64-69 |
| `▸ / ▾` on a shell card | `!` card / Bash card | Drawn, but nothing can click it in SB | SB | shell-card.tsx:150 |
| Steps | – | Always closed, no `▸`/`›` marks (clickable=false); Ctrl+O is the only way into a call | SB | app.tsx:1707, 1717, entries.tsx:246-247, 404 |

## 7. Click targets inside entries (steps, tool rows, shell cards, turn closers, code blocks, figures)

All FS; dispatch `app.tsx:589-605` (`toggleTool`), `571-581` (`inspectCall`), `557-568` (`showOutput`).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Click step name (only when the step has more to show) | step title, marked `▸`/`▾` | Opens/closes the step (all lines + thinking) | FS | entries.tsx:246-247, 260-274, app.tsx:599-604 |
| Click `… N more` line | closed step | Opens the step (no mark) | FS | entries.tsx:311-324 |
| Click an activity line (`›` at right) | step | Opens the inspector on that call; a running subagent/background call opens its task view instead | FS | entries.tsx:326, 404, app.tsx:590-591, 571-581 |
| Click the failure line under an activity line | step | Same as the line above it (no mark) | FS | entries.tsx:329-339 |
| Click a running subagent's nested lines | step | Same as its line (task view while running) | FS | entries.tsx:340-351 |
| Click a step's thinking / notice lines | open step | Nothing | FS | entries.tsx:291-306 |
| Click a standalone tool row (show, plan, question, mod-drawn) | tool entry | Opens the inspector (Bash card included, despite its `▸`) | FS | app.tsx:593, entries.tsx:84-107, src/view/steps.ts:10, 24-25 |
| Click a `!` command card | shell entry | Running: task view. Finished: opens/closes its full output in place | FS | app.tsx:594-604, entries.tsx:468-470 |
| Click a turn closer `╰─ … 2 files changed · 3 commands` | turn end | Opens/closes the list of files changed and commands run (no mark) | FS | transcript.tsx:151, entries.tsx:512-549 |
| Click `▶ run` | shell code block | Runs it as a `!` command, toast | FS | markdown-view.tsx:89-90, app.tsx:658-661 |
| Click `copy` | code block | Copies the block, toast | FS | markdown-view.tsx:90, app.tsx:663-667 |
| Click `enlarge` | figure caption | Lightbox | FS | figure.tsx:98-100, app.tsx:656-657 |
| Click `browser` | figure caption (HTML mockup) | Opens the page in the browser | FS | figure.tsx:101, app.tsx:657 |
| Click `copy` | diagram caption | Copies the diagram source | FS | figure.tsx:102 |
| Mod-drawn `[ label ]` buttons, Input, Select | tool result / command output card | Drawn, do nothing (`onPress={() => {}}`; Input/Select are static text) | both | entries.tsx:71, 102, mod-tree.tsx:169-179 |

## 8. Inspector (`inspector.tsx`)

Opens from a step line (FS), a standalone row (FS), the Follow dock (FS), or the Ctrl+O picker (both). FS ≥140 cols: beside the transcript; narrower: replaces it; SB: above the box (`app.tsx:1534, 1554-1556, 1663-1679`). Keys only while focused (`app.tsx:1469`).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Esc, Ctrl+C | focused | Closes (FS narrow: back to the transcript) | both | inspector.tsx:160 |
| Alt+L (`chat:followClaude`) | focused | Follow toggle (resumes following if on) | both | inspector.tsx:161 |
| ← / → | focused | Previous / next tool call in the conversation (not `!` commands) | both | inspector.tsx:162-163, app.tsx:608-616 |
| Tab / Shift+Tab | focused | Next / previous tab | both | inspector.tsx:164 |
| 1–9 | focused | Jumps to that tab | both | inspector.tsx:172-173 |
| ↑ / ↓ | focused | Scroll 1 line | both | inspector.tsx:165-166 |
| PgUp / PgDn, Space | focused | Scroll a page | both | inspector.tsx:167-168 |
| Home / End | focused | Top / bottom | both | inspector.tsx:169-170 |
| c | focused | Copies what the tab shows | both | inspector.tsx:171 |
| Wheel | inspector | Scrolls 3 lines; on the Follow panel, also pauses following on that call (without the keys) | FS | inspector.tsx:182-185, app.tsx:1527 |
| Click anywhere | inspector | Takes the keys | FS | inspector.tsx:187, app.tsx:1503, 1526 |
| Click a tab | header | Shows it | FS | inspector.tsx:188-189 |
| Click `‹` / `›` | header | Previous / next call | FS | inspector.tsx:190-191 |
| Click `esc close` / `stop` | footer | Closes; on the Follow panel, `stop` turns following off | FS | inspector.tsx:192, 316-320, app.tsx:1525 |
| Drag in body | inspector | Nothing (no selection inside the inspector) | FS | screen.tsx:257 |
| Hover tab / `‹` / `›` / close | inspector | Text brightens, pointer hand | FS | inspector.tsx:194-201, 242-246, 254, 318-319 |
| Footer hints | inspector | Focused: "←→ calls tab view ↑↓ scroll c copy"; following: "alt+l stop following click look back"; unfocused: "Click here for the keys" | both | inspector.tsx:302-315 |

## 9. Follow Claude (`follow.tsx`, `app.tsx:1474-1531`, `1557-1568`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Alt+L | box or focused inspector | On/off; paused → follow again | both | app.tsx:622-631 |
| `/config` → Follow Claude | config | On/off, remembered | both | config.tsx:155-162 |
| Click | wide FS: follow panel (inspector) | Takes the keys and holds the panel on that call | FS | app.tsx:1526 |
| Wheel | wide FS: follow panel | Scrolls and holds the panel, keys stay with the box | FS | inspector.tsx:183, app.tsx:1527 |
| Click | dock above the box (narrow FS) | Opens that call in the inspector | FS | follow.tsx:80-84 |
| Wheel | dock | Scrolls the transcript (dock ignores the wheel) | FS | follow.tsx:80-84, screen.tsx:248-251 |
| Hover | dock | Nothing (no highlight, no pointer) | FS | follow.tsx (no useHover) |
| Click `◉ following` | status bar | On: turns off. Paused: follows again | FS | status.tsx:110-113, app.tsx:1647 |
| Esc | while paused | Focused hold: closes inspector → follows again. Wheel hold (unfocused): Esc goes to the box and interrupts Claude | both | inspector.tsx:160, prompt.tsx:515 |

## 10. Permission prompts and plan approval (`decision.tsx`)

Options: Allow / (always-allow rule) / Deny; for ExitPlanMode "Start on the plan" / "Keep planning…" (`decision.tsx:31-36`). Grace 500 ms (`decision.tsx:16`).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑ | prompt | Previous option, wraps | both | decision.tsx:59 |
| ↓, Tab | prompt | Next option, wraps | both | decision.tsx:60 |
| Shift+Tab | prompt | Nothing | both | decision.tsx:60 |
| Esc, Ctrl+C | prompt | Deny (even in grace) | both | decision.tsx:61 |
| Enter | prompt | Confirms highlighted (ignored in first 500 ms) | both | decision.tsx:62-63 |
| 1–9 | prompt | Chooses that option (ignored in grace) | both | decision.tsx:64-67 |
| Space | prompt | Nothing | both | decision.tsx:57-68 |
| Click option | prompt | Highlights; decides if past grace | FS | decision.tsx:43-51 |
| Hover option | prompt | `›` + hover background | FS | decision.tsx:52-55 |
| Hint | prompt | "↑↓ to choose enter to confirm esc to deny" | both | decision.tsx:103 |

## 11. `/permissions` panel (`permissions.tsx` on `Manager`)

Lists Allow / Ask / Deny / Folders. Typing filters or offers "Add <rule>"; Enter on a rule opens its page with "Remove" (`permissions.tsx:74-131`). Keys as section 14.

## 12. Claude's questions (`question.tsx`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑ | options | Previous, wraps | both | question.tsx:90 |
| ↓, Tab | options | Next, wraps | both | question.tsx:91 |
| ← | options | Previous question (multi-question) | both | question.tsx:92 |
| → | options | Nothing | both | – |
| Space | multi-select | Checks/unchecks (after grace) | both | question.tsx:94 |
| Enter | options | Single: answers. Multi: finishes with checked (or highlighted). On "Other…": opens the text field | both | question.tsx:95-99 |
| 1–9 | options | Picks that option | both | question.tsx:100-103 |
| Esc, Ctrl+C | options | Dismisses the question | both | question.tsx:89 |
| Type / Backspace / paste | "Other" field | Edits answer | both | question.tsx:75, 85-87 |
| Enter | "Other" field | Answers (with checked options in multi) | both | question.tsx:81-84 |
| Esc | "Other" field | Back to the options | both | question.tsx:80 |
| Ctrl+C | "Other" field | Nothing (swallowed) | both | question.tsx:86 |
| Click option | options | Picks / toggles / opens Other (after grace) | FS | question.tsx:60-69 |
| Hover option | options | Highlight, and the preview pane shows the hovered option's preview | FS | question.tsx:70-73, 119 |

## 13. MCP requests (`elicitation.tsx`; `/mcp` is section 14)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑, Shift+Tab / ↓, Tab | form | Previous / next row (fields, then Send/Decline), wraps | both | elicitation.tsx:125-126 |
| ← / → | enum, yes/no, multi field | Steps value / moves among options | both | elicitation.tsx:127-128, 69-84 |
| Space | yes/no / multi | Flips / checks | both | elicitation.tsx:140-141 |
| Type, Backspace, paste | text/number field | Edits (no cursor movement) | both | elicitation.tsx:97-101, 118, 130-133, 143 |
| Enter | field / action | On a field: next row. On Send/Open/Decline: does it (after grace) | both | elicitation.tsx:136-139 |
| Esc | form | Decline | both | elicitation.tsx:123 |
| Ctrl+C | form | Cancel (a different MCP outcome) | both | elicitation.tsx:122 |
| Click a row | form | Selects; on an action row, acts (after grace) | FS | elicitation.tsx:103-111 |
| Click `◀` / `▶` | selected dial field | Steps the value | FS | elicitation.tsx:215-218, effort.tsx:55-62 |
| Click a multi option | multi field | Nothing (only the row is selected) | FS | elicitation.tsx:220-234 |
| Hover row | form | Highlight | FS | elicitation.tsx:112-115 |

## 14. Manager panels: `/mcp`, `/permissions`, `/memory`, `/skills`, `/hooks`, `/sandbox` (`manager.tsx`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Ctrl+C | anywhere in panel | Closes the panel (even from a row's page) | both | manager.tsx:195 |
| Esc | list / page | List: closes. Page: back to list | both | manager.tsx:198, 211 |
| ← | page (field empty) | Back to list | both | manager.tsx:198 |
| Tab, Shift+Tab, ←, → | list (>1 list) | Switch list; clears the filter | both | manager.tsx:212-215 |
| ↑ / ↓, PgUp / PgDn | list | Move row (clamped) | both | manager.tsx:216-217 |
| ↑ / ↓ | page | Move action | both | manager.tsx:200 |
| Enter | list | Opens row's page, or does its action at once | both | manager.tsx:218-221, 166-173 |
| Enter | page | Submits field text, else runs focused action | both | manager.tsx:201-206 |
| Space | list, empty filter, row has a Space action | Runs it (skills on/off, memory auto-memory, sandbox fallback); otherwise types a space into the filter | both | manager.tsx:222-225, skills.tsx:78, memory.tsx:76-77, sandbox.tsx:108-109 |
| Type / Backspace / paste | list / page field | Filter (or "Add …" row) / field text | both | manager.tsx:187-191, 207-209, 226-231 |
| Wheel | panel | Moves row/action selection by one | FS | manager.tsx:236 |
| Click tab | header | Switch list | FS | manager.tsx:245-246 |
| Click row | list | Selects and opens/acts at once (memory files open `$EDITOR`, sandbox modes apply) | FS | manager.tsx:247-250, memory.tsx:89, 99, sandbox.tsx:76-80 |
| Click action | page | Runs it | FS | manager.tsx:240-243 |
| Hover tab / row / action | panel | Hover background, pointer | FS | manager.tsx:252-260, 375 |
| Hints | list / page | List: "↑↓ to choose · space to … · enter for more · tab for the next list · esc to close"; page: "… esc to go back" | both | manager.tsx:334-339, 350-356 |

## 15. `/plugins` (`plugins.tsx`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Ctrl+C | anywhere | Closes | both | plugins.tsx:178 |
| Esc / ← | action page | Back to list | both | plugins.tsx:181 |
| Esc | list | Closes | both | plugins.tsx:188 |
| Tab, Shift+Tab, ←, → | list | Switch Installed/Discover/Marketplaces; keeps the filter | both | plugins.tsx:189-192 |
| ↑↓, PgUp/PgDn | list / page | Move (clamped) | both | plugins.tsx:182, 193-194 |
| Enter | list | Action page; "add marketplace" row adds at once | both | plugins.tsx:195-198, 160-163 |
| Enter | page | Runs action | both | plugins.tsx:183-184 |
| Space | Installed row | Enable/disable; elsewhere types a space | both | plugins.tsx:200-203 |
| Type / Backspace | list | Filter (Marketplaces: owner/repo to add) | both | plugins.tsx:204-206, 304 |
| Wheel | panel | Moves selection | FS | plugins.tsx:212 |
| Click tab / row / action | panel | Switch / open (or add) / run | FS | plugins.tsx:209-226 |
| Hover | panel | Background highlight, pointer | FS | plugins.tsx:228-237, 323 |

## 16. Generic Picker (`picker.tsx`)

Used by `/effort`, `/resume`, Ctrl+O / `/output`, `/play`, `/rewind`, rewind "how", `/tasks` list, `#` note target, `/output-style`, `/export` (`app.tsx:1149-1421`).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑ / ↓ | list | Move (clamped, no wrap) | both | picker.tsx:51-52 |
| PgUp / PgDn | list | Move a page | both | picker.tsx:53-54 |
| Enter | list | Picks | both | picker.tsx:55-59 |
| Esc, Ctrl+C | list | Cancel | both | picker.tsx:50 |
| Type, Space, Backspace | list | Filter (Space and letters such as `x` type into it) | both | picker.tsx:60-66 |
| Tab, Home, End | list | Nothing | both | picker.tsx:64 |
| Wheel | panel | Moves selection | FS | picker.tsx:75-78 |
| Click item | list | Picks at once | FS | picker.tsx:79-86 |
| Hover item | list | Highlight | FS | picker.tsx:87 |

## 17. Model + effort picker (`model-picker.tsx`, `effort.tsx` Dial)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑ / ↓ | list | Model (clamped) | both | model-picker.tsx:63-64 |
| ← / → | list | Effort down/up (ultracode past max) | both | model-picker.tsx:65-66 |
| Enter | list | Switches model and effort | both | model-picker.tsx:67 |
| Esc, Ctrl+C | list | Cancel | both | model-picker.tsx:62 |
| Typing, PgUp/PgDn | list | Nothing | both | – |
| Wheel | panel | Moves model | FS | model-picker.tsx:75-78 |
| Click model | list | Switches at once (with dial's effort) | FS | model-picker.tsx:79-86 |
| Click `◀` / `▶` | effort dial | Steps effort | FS | effort.tsx:55-62 |
| Hover | model row / dial arrow | Highlight / arrow gold bold | FS | model-picker.tsx:87, effort.tsx:64-68 |

## 18. `/config` (`config.tsx`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑ / ↓ | rows | Move (clamped) | both | config.tsx:227-228 |
| ← | row | Steps value back | both | config.tsx:230 |
| →, Enter, Space | row | Steps value forward | both | config.tsx:231 |
| Esc | panel | Applies and saves all changes, closes | both | config.tsx:226, 204-221 |
| Ctrl+C | panel | Discards changes, closes | both | config.tsx:225 |
| Click row | panel | Selects only | FS | config.tsx:235-242 |
| Click `◀` / `▶` | dial | Steps value | FS | effort.tsx:55-62 |
| Wheel | panel | Not handled; scrolls the transcript behind | FS | config.tsx:235-242, screen.tsx:248-251 |
| Hover | row / arrow | Highlight / arrow gold | FS | config.tsx:243 |
| Hint | panel | "↑↓ to choose ←→ to change esc saves and closes ctrl+c discards"; top edge "esc saves" | both | config.tsx:277, 249 |

## 19. `/tasks` task view (`tasks.tsx`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Esc, Ctrl+C | view | Close | both | tasks.tsx:70 |
| ←, Backspace | view | Back to the `/tasks` list | both | tasks.tsx:71 |
| x | view | Stops it at once (no confirm) | both | tasks.tsx:72, 60-64 |
| b | view (subagent Claude waits on) | Moves it to the background | both | tasks.tsx:73 |
| Click `■ stop x` | footer | Stop | FS | tasks.tsx:78-81, 262-270 |
| Click `← back to the list` | footer | Back | FS | tasks.tsx:82-85, 272-274 |
| Wheel | view | Not handled; scrolls the transcript (output shows only its last rows) | FS | tasks.tsx:76-87 |
| Hover stop / back | footer | Brightens, pointer | FS | tasks.tsx:88-89 |

## 20. Lightbox (`/pictures`, picture click) (`lightbox.tsx`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ← / → | lightbox | Previous / next picture (clamped) | both | lightbox.tsx:44-45 |
| o | lightbox | Opens in the image viewer | both | lightbox.tsx:47-49 |
| b | lightbox (mockup) | Opens in the browser | both | lightbox.tsx:50 |
| c | lightbox (diagram) | Copies source | both | lightbox.tsx:51 |
| Esc, q, Ctrl+C | lightbox | Close | both | lightbox.tsx:43 |
| Click picture / `esc close` | lightbox | Close | FS | lightbox.tsx:58-63 |
| Hover picture / close | lightbox | Zoom-out pointer / close brightens | FS | lightbox.tsx:64-65 |

## 21. Find bar (Ctrl+F) (`find.tsx`), FS only

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Type / Backspace / Ctrl+U | bar | Query (smart case) / delete / clear | FS | find.tsx:41-44, selection.ts:156-160 |
| Enter, ↑ | bar | Older match | FS | find.tsx:38 |
| Shift+Enter, ↓ | bar | Newer match | FS | find.tsx:39 |
| Esc, Ctrl+C, Ctrl+F, Ctrl+G | bar | Close (query kept for next time) | FS | find.tsx:37 |
| PgUp/PgDn, Alt+↑↓ | while bar open | Nothing (transcript keys off while an overlay is open) | FS | app.tsx:1681 |

## 22. Small panels

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ↑↓ / PgUp PgDn | `/btw` | Scroll answer | both | aside.tsx:56-57 |
| Wheel | `/btw` | Scroll answer | FS | aside.tsx:60-64 |
| Esc, Enter, Ctrl+C | `/btw` | Close | both | aside.tsx:55 |
| Esc, Enter, Ctrl+C | `/status` | Close | both | claude-status.tsx:27-30 |
| Enter | `/remote-control` | Failed/off: retry. Else: close | both | remote.tsx:35 |
| x / c / o | `/remote-control` | Turn off (no confirm) / copy link / open link | both | remote.tsx:36-38 |
| Esc, Ctrl+C | `/remote-control` | Close | both | remote.tsx:34 |
| Click the URL | `/remote-control` | No handler in FS (OSC 8 link only reaches the terminal in SB) | both | remote.tsx:52-54 |

## 23. Agents view (`agents.tsx`; no mouse handlers at all)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| ← in an empty message box | box | Opens the view | both | prompt.tsx:546 |
| ↑ / ↓ | list | Row; with text typed, moves a project at a time | both | agents.tsx:310 |
| Type, Backspace/Delete, Ctrl+U | task input | Edits / clears (paste newlines become spaces) | both | agents.tsx:314-319 |
| Enter (text) | input | Starts a conversation in the chosen project, stays in view | both | agents.tsx:311, 227-236 |
| Ctrl+Enter (text) | input | Starts and opens it (kitty protocol) | both | agents.tsx:311 |
| Enter, → (no text) | row | Opens: astrocode conversation / moves finished background session in / `claude attach` | both | agents.tsx:312, 256-265 |
| Space (no text) | row | Peek panel on/off | both | agents.tsx:316 |
| Ctrl+X | row | astrocode conversation: stops at once. Background session: stops, then Ctrl+X within 2 s deletes | both | agents.tsx:313, 267-292, 27 |
| Esc | view | Closes peek → clears text → back to the conversation, or quits astrocode if there's none | both | agents.tsx:298-302 |
| Ctrl+C | view | Clears text, else arms quit; second quits | both | agents.tsx:303-308 |
| ←, Tab, PgUp/PgDn, Home/End, Ctrl+G | view | Nothing | both | agents.tsx:317 |
| Click / wheel / hover | view | Nothing | FS | agents.tsx (no useMouse/useHover) |
| Hints | view | "enter open · space peek · ctrl+x stop · esc back/quit" or, typing, "enter start · ctrl+enter start and open · ↑↓ project · esc clear" | both | agents.tsx:363-365 |

## 24. Mods: band above the box and cards (`mod-band.tsx`, `mod-tree.tsx`, `mod-cards.ts`)

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Click `[ label ]` | band above the box | Presses the mod's button (`ui_press`) | FS | mod-band.tsx:27, mod-tree.tsx:195-199 |
| Hover button | band | Glint color, pointer | FS | mod-tree.tsx:200-204 |
| Any key | band | Nothing: no focus into the band, no Tab/Enter press | both | mod-band.tsx (no useInput) |
| Input / Select elements | band, cards | Drawn as static text, not editable | both | mod-tree.tsx:169-179 |
| Buttons in cards | transcript (tool result, command output) | Drawn, no-op | both | entries.tsx:71, 102 |

## 25. Status bar (`status.tsx`)

Hit-testing `status.tsx:174-194`; hover `195-199`. While a toast or an armed message shows, the readings/chip are replaced and not clickable (`status.tsx:163-166`, `176`).

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Click mode chip | left | Cycles mode (= Shift+Tab) | FS | status.tsx:176, 192, app.tsx:1649 |
| Click `◉ following` | readings | Follow off / resume | FS | status.tsx:110-113 |
| Click `cache …` | readings | Keep-warm on/off (toast) | FS | status.tsx:114-128, app.tsx:325-330 |
| Click `⇄ remote…` | readings | Remote Control panel | FS | status.tsx:129-132 |
| Click model name | readings | Model+effort picker (= Alt+P) | FS | status.tsx:134 |
| Click `<level> effort` / `ultracode` | readings | Effort **list** picker (= `/effort`, not the Alt+P dial) | FS | status.tsx:136-141, app.tsx:1651 |
| Click `↯ fast` / `↯ fast paused` | readings | Fast mode toggle | FS | status.tsx:143-144 |
| Click `thinking off` | readings | Thinking toggle | FS | status.tsx:146 |
| Click `◌ N running` | readings | `/tasks` | FS | status.tsx:147-150 |
| Click context gauge, 5h/7d usage, `⎇ branch`, plan | readings | Nothing | FS | status.tsx:94-109, 151-161 |
| Hover clickable segment / chip | bar | Hover background, pointer | FS | status.tsx:195-199, 207, 227 |
| Static hint `shift+tab` | after chip | Hard-coded text | both | status.tsx:220 |

## 26. Start screen and banner

| Input | Where | Does | Mode | file:line |
|:--|:--|:--|:--|:--|
| Click a mirror segment | FS welcome (before first message) | Ripple + a JWST fact; all 18 clicked → "first light" bloom | FS | mirror.tsx:161-178 |
| Click the empty center | welcome | Ripple + center fact | FS | mirror.tsx:166-168 |
| Hover segment | welcome | Segment glows, pointer hand | FS | mirror.tsx:181-187 |
| Transcript hover/click | welcome | Off while the welcome shows | FS | screen.tsx:428, 452 |
| Banner | SB, FS transcript top | No interaction | both | banner.tsx |

## 27. Hover effects, consolidated

`ChoiceRow` (`›` + hover background) in menus, pickers, prompts, panels (`choice.tsx:8-11`); gold words on hot transcript rows and links (`screen.tsx:479-482`); zoom-in/zoom-out pointer over pictures (`screen.tsx:447`, `lightbox.tsx:64`); text beam over the message box (`prompt.tsx:601`); status segment background (`status.tsx:199`); inspector tab/arrow/close brighten (`inspector.tsx:242-319`); dial arrows gold+bold (`effort.tsx:64-68`); task stop/back brighten (`tasks.tsx:264-273`); mod button glint (`mod-tree.tsx:204`); mirror glow (`mirror.tsx:187`); question preview follows the hovered option (`question.tsx:119`). Pointer shapes use OSC 22, honored by kitty/foot/Ghostty/xterm (`mouse.ts:31-39`). **No hover:** Follow dock, agents view, task view body, find bar, config wheel area.

---

# Inconsistencies

Numbered for reference only. "CC" = Claude Code.

## A. One gesture, different actions

**A1. Esc** ranges from "cancel" to "save" to "quit" to "interrupt Claude":
- Message box: interrupts if busy, else nothing with text, rewind on double-press (prompt.tsx:514-524).
- Most overlays (Picker, model picker, lightbox, find, /status, /btw, remote, task view): close/cancel (picker.tsx:50, model-picker.tsx:62, lightbox.tsx:43, find.tsx:37, claude-status.tsx:29, aside.tsx:55, remote.tsx:34, tasks.tsx:70).
- `/config`: **applies and saves** (config.tsx:226) while Ctrl+C discards (config.tsx:225).
- Manager/Plugins: back one level from a page, close from the list (manager.tsx:198, 211; plugins.tsx:181, 188).
- Permission prompt: **deny** (decision.tsx:61). MCP form: **decline** (elicitation.tsx:123). Question: dismiss, or back to options from "Other" (question.tsx:80, 89).
- Agents view: clears, then returns, then **quits astrocode** when opened with `astrocode agents` (agents.tsx:298-302).
- Follow panel paused by the wheel: Esc reaches the box and **interrupts Claude** instead of resuming following, contrary to README:130 "Esc or Alt+L follows Claude again" (app.tsx:1527 sets focus:false; prompt.tsx:515).

**A2. Enter**: sends (prompt.tsx:410); keeps a history match *without* sending (prompt.tsx:465); writes a mid-message `/command` in instead of sending (prompt.tsx:296-304, 501); confirms/picks in prompts and pickers; **steps a value forward** in `/config` (config.tsx:231); moves to the next field in MCP forms (elicitation.tsx:138); *older match* in find (find.tsx:38); closes `/btw` and `/status` (aside.tsx:55, claude-status.tsx:29); retry-or-close in remote (remote.tsx:35); does nothing in the inspector, lightbox and task view.

**A3. Space**: types a space in the box, pickers' filters and Manager filters (picker.tsx:65, manager.tsx:228); pages down in the inspector (inspector.tsx:168); steps a value in `/config` (config.tsx:231); toggles in plugins/skills/memory/sandbox only when the filter is empty (plugins.tsx:200, manager.tsx:222); checks in multi-select questions and MCP forms (question.tsx:94, elicitation.tsx:140-141); peeks in the agents view (agents.tsx:316); **does nothing in permission prompts** (decision.tsx:57-68), though README:132 lists Space among keys ignored there.

**A4. ← / →**:
- Box: cursor; **← on an empty box leaves for the agents view** (prompt.tsx:546). One stray ← after sending switches screens.
- Inspector: previous/next tool call (inspector.tsx:162-163). Lightbox: previous/next picture (lightbox.tsx:44-45). Model picker: effort (model-picker.tsx:65-66). Config: value (config.tsx:230-231). MCP form: value (elicitation.tsx:127-128).
- Manager/Plugins list: **switch tab**; Manager also **clears the filter** (manager.tsx:212-214), Plugins keeps it (plugins.tsx:189-191). In `/permissions`, ← to fix a typo in a rule you're typing throws the rule away.
- Pages (Manager/Plugins) and task view: ← = back (manager.tsx:198, plugins.tsx:181, tasks.tsx:71). Question: ← = previous question, → = nothing (question.tsx:92). Agents view: → opens, ← nothing (agents.tsx:312). History search: ←/→ end the search (prompt.tsx:465).

**A5. Tab / Shift+Tab**: box: menu completion / **mode cycle** (prompt.tsx:501, keys.ts:52); inspector: tabs (inspector.tsx:164); Manager/Plugins: lists (manager.tsx:212, plugins.tsx:189); permission prompt and question: next option, Shift+Tab does nothing (decision.tsx:60, question.tsx:91); MCP form: next/previous field (elicitation.tsx:125-126); picker and model picker: nothing (picker.tsx:64); history search: keep match (prompt.tsx:465).

**A6. Ctrl+C**: box clear/interrupt/exit (prompt.tsx:388, app.tsx:1033); permission prompt **deny** (decision.tsx:61); MCP form **cancel** (≠ Esc's decline, elicitation.tsx:122-123); `/config` **discard** (config.tsx:225); Manager/Plugins close the whole panel even from a page where Esc only goes back (manager.tsx:195, plugins.tsx:178); question "Other" field: **ignored** (question.tsx:86); inspector/pickers/lightbox close.

**A7. Ctrl+X**: chord prefix in the box (Ctrl+X Ctrl+K needs two presses within 3 s, app.tsx:463-466); **single press stops an astrocode conversation** in the agents view with no confirmation (agents.tsx:268-271). Task view `x` and remote `x` also stop/turn off with one press (tasks.tsx:72, remote.tsx:36).

**A8. Ctrl+O / Alt+P aren't toggles**, while Ctrl+F, Ctrl+T, Alt+L are: the picker/model picker ignore Ctrl/Alt keys (picker.tsx:64, model-picker.tsx:60-68) vs find closes on Ctrl+F (find.tsx:37).

**A9. Letter keys change meaning per surface**: `c` copy (inspector.tsx:171, lightbox.tsx:51, remote.tsx:37); `o` open (lightbox.tsx:47, remote.tsx:38); `b` browser (lightbox.tsx:50) vs background (tasks.tsx:73); `x` stop (tasks.tsx:72) vs turn off (remote.tsx:36), but in the `/tasks` **list** `x` types into the filter (picker.tsx:65); `q` closes only the lightbox (lightbox.tsx:43).

**A10. Click on an option**: picks immediately in pickers, the `/` menu, model picker, Manager rows, permission prompts and questions (picker.tsx:85, prompt.tsx:584, model-picker.tsx:85, manager.tsx:250, decision.tsx:50, question.tsx:68), but **only selects** in `/config` (config.tsx:241) and in MCP field rows (elicitation.tsx:108-110). Manager rows with an `act` run it on one click (memory file → `$EDITOR`, sandbox mode applied: memory.tsx:89, sandbox.tsx:76-80).

**A11. Click on a transcript entry**: step line → inspector; step name → expand in place; standalone tool row (including a Bash card showing `▸`) → inspector; `!` card → expand in place, or task view while running; turn closer → expand in place (app.tsx:589-605). The same `▸`/`▾` glyph (shell-card.tsx:150) means "expands" on `!` cards but "opens the inspector" on Bash cards.

**A12. Click timing**: links and clicks inside opened entries wait 300 ms for a possible double-click; head rows and pictures act on the first release (screen.tsx:319-327 vs 338). Double-clicking a word on a step line to copy it also opens the inspector.

**A13. Wheel**: scrolls 3 lines in the transcript and inspector (screen.tsx:249, inspector.tsx:184) and 1 line in `/btw` (aside.tsx:63); **moves the selection** in menus, pickers, model picker, Manager, Plugins (prompt.tsx:576, picker.tsx:77, manager.tsx:236); and over `/config`, permission prompts, questions, MCP forms, task view, lightbox, Follow dock, status bar and message box it **scrolls the transcript behind** (screen.tsx:248-251 with no hit test). Over the beside Follow panel it also silently pauses following (inspector.tsx:183).

**A14. ↑/↓ wrap vs clamp**: wraps in the `/` menu, permission prompt, question, MCP form (prompt.tsx:491, decision.tsx:59-60, question.tsx:90-91, elicitation.tsx:53); clamps in pickers, model picker, config, Manager, Plugins (picker.tsx:51-52, model-picker.tsx:63-64, config.tsx:227-228, manager.tsx:177).

**A15. Effort control differs by entry point**: Alt+P and `/model` show a dial in the model picker (model-picker.tsx:120-126); `/effort` and a click on the status bar's effort show a list picker (app.tsx:1149-1168, 1651); `chat:increaseEffort/decreaseEffort` exist but have no key (keys.ts:20-21, prompt.tsx:71).

**A16. Alt+↑ / Alt+↓**: FS jumps between your messages (screen.tsx:353); SB recalls history like ↑/↓ (prompt.tsx:512 only swallows it in FS).

## B. Clickable with no visible affordance (FS)

- B1. Clicking **anywhere inside an opened `!` card or turn list closes it**; only the first row lights on hover (screen.tsx:329-340, 449).
- B2. **Turn closer** `╰─ 42s · 2 files changed · 3 commands` opens a file/command list; no `▸`, only hover gold (transcript.tsx:151, entries.tsx:512-528).
- B3. **`… N more`** line opens the step; no mark (entries.tsx:311-324).
- B4. **Failure line and subagent sub-lines** inspect their call; no `›` (entries.tsx:329-351).
- B5. **Follow dock** opens the call in the inspector on click; no hover, no pointer change, no hint (follow.tsx:78-84).
- B6. **Status bar readings** (model, effort, cache, fast, thinking, running, remote, following) look the same as non-clickable ones (context, git, plan, usage); hover background is the only cue (status.tsx:94-161, 199).
- B7. **Mirror segments** on the start screen (mirror.tsx:161-187); the code comment says the glow is "the only hint there is".
- B8. **Anywhere in the inspector** takes the keys; the "Click here for the keys" hint only shows when it's unfocused (inspector.tsx:187, 312-314).
- B9. Reverse case, affordance without action: mod `[ buttons ]`, Input and Select in cards and the band don't respond to keys (entries.tsx:71, 102; mod-tree.tsx:169-179); `▸`/`▾` on shell cards in SB (shell-card.tsx:150); remote URL in FS (remote.tsx:52-54).

## C. Mouse actions with no keyboard equivalent

- C1. **Open/close a step** (all lines + thinking): FS click only (app.tsx:599-604). SB never shows a step open.
- C2. **Turn closer's file/command list**: click only (entries.tsx:530-546).
- C3. **Select arbitrary text / copy a word or line** in FS: drag, double- and triple-click only; no Shift+arrow selection or copy key (screen.tsx:273-296). Inspector text can't be selected at all (screen.tsx:257); `c` copies the whole tab.
- C4. **Copy a single code block**: `copy` link only (markdown-view.tsx:90). `/copy` copies the whole reply.
- C5. **Mod band buttons**: click only, so unusable in SB (mod-tree.tsx:195-199; no useInput in mod-band.tsx). CC focuses the band with Ctrl+X Tab.
- C6. **Keep-warm toggle**: status click or `/config` only (status.tsx:126).
- C7. **Return the keys from the inspector to the box** (and back): click only (app.tsx:1471-1473, inspector.tsx:187). Once the box has them, nothing on the keyboard closes the still-open inspector (Esc interrupts Claude; Alt+L closes it but turns following on as a side effect, app.tsx:627-629).
- C8. **Jump in the transcript by dragging the scrollbar** has PgUp/PgDn/Ctrl+Home/End; OK. **Clicking the pill** = Ctrl+End; OK. **Clicking a picture** = `/pictures` then ←/→ (only from the newest); partial.
- C9. **Mirror easter egg**: mouse only (mirror.tsx:161).
- C10. **Toggle a multi-choice option in an MCP form by mouse** is missing (opposite case: keyboard only, elicitation.tsx:220-234).

## D. Keys that only work in one layout

- D1. FS only: Ctrl+F find (prompt.tsx:511, app.tsx:1609); PgUp/PgDn/Ctrl+Home/Ctrl+End transcript scroll (screen.tsx:354-357); Alt+↑↓ and Alt+Shift+↑↓ jumps (screen.tsx:353); every click/hover/wheel (main.tsx:151); code-block `copy`/`▶ run` links (transcript.tsx:155 passes `copyable`; scrollback ItemView doesn't); inspector beside the transcript (app.tsx:1534).
- D2. SB only: OSC 133 prompt marks for the terminal's jump-to-prompt (entries.tsx:55, window.ts:212-219); OSC 8 file links on tool rows (entries.tsx:96); figure `open` links (figure.tsx:105-108).
- D3. Different per layout: Alt+↑↓ (A16); Follow Claude is a keyless dock in SB and narrow FS but a clickable, scrollable inspector in wide FS (app.tsx:1557-1568, 1673-1679); the README says "a click on it opens the call" for the dock "in scrollback" too (README:130), but SB has no mouse.

## E. Keys that differ from Claude Code's defaults

| Key | Claude Code | astrocode | Evidence |
|:--|:--|:--|:--|
| Ctrl+L | `chat:clearInput` = redraw the screen, **keeping** input (keybindings doc; fullscreen doc "Clear the conversation") | Clears the box | prompt.tsx:432-433, README:52 |
| Ctrl+O | Toggles the transcript viewer (q/Esc/Ctrl+O exit, `/` search, `{` `}` prompts, `[` to scrollback, `v` editor) | Opens a tool-call picker; not a toggle | prompt.tsx:393-394, app.tsx:1193 |
| Ctrl+D | Exit after a second press within 800 ms; with text, deletes the character after the cursor | Exits on the **first** press on an empty box; with text does nothing | prompt.tsx:389-390, app.tsx:1592 |
| Esc Esc with text | Clears the draft (saved to history) | Nothing (Esc with text is ignored) | prompt.tsx:516 |
| Alt+B / Alt+F / Alt+D | Word = run of letters/digits; punctuation separates (`src/utils/foo.ts` is 4 words) | Word = non-whitespace (whole path is one word) | prompt.tsx:954-966 |
| Shift+↑ / Shift+↓ | `chat:increaseEffort` / `chat:decreaseEffort` (default table in the 2.1.316 binary; not in the docs page) | No default; Shift+↑ recalls history | keys.ts:44-73, prompt.tsx:71 |
| Alt+↑ / Alt+↓ | Global `app:diffFileListUp/Down` (binary 2.1.316, docs Diff panel) | FS: jump between your messages | screen.tsx:353 |
| Mid-message `/com` + Enter | Enter sends the prompt as typed (FS: no row highlighted; classic: ghost text, Tab inserts) | Enter writes the top match in | prompt.tsx:225, 501, 296-304 |
| Ctrl+R search | FS: dialog with ↑↓ through matches, Ctrl+S scope, Enter/Tab place, Esc cancel. Classic: Ctrl+R older, Esc/Tab accept, Enter executes | Ctrl+R older; ↑↓/←→/Tab/Enter keep and leave search; Esc/Ctrl+C/Ctrl+G cancel; no scope | prompt.tsx:450-470 |
| `?` on empty input | Toggles shortcut help | Types `?`; no in-app key overlay | prompt.tsx:564-565 |
| PgUp / PgDn (FS) | Half a viewport | View − 2 lines | screen.tsx:352 |
| Plain click on a URL (FS) | Doesn't open; Ctrl+click on Linux | Opens | screen.tsx:319-320 |
| Click a tool result (FS) | Expands it in place | Opens the inspector (steps) | app.tsx:589-593 |
| Esc / other keys with a selection (FS) | Esc, PgUp/PgDn, Shift/Alt+arrows keep it; Ctrl+C copies; Shift+arrows extend | Any key clears it; no keyboard extend/copy | screen.tsx:350 |
| Permission prompt Tab / Shift+Tab / Space | Tab: comment field; Shift+Tab: allow for the session; Space: `confirm:toggle` | Tab: next option; Shift+Tab and Space: nothing | decision.tsx:57-68 |
| `/config` | Enter/Space change, wheel scrolls the list, click a value changes it, Esc closes (changes already applied) | Enter/Space/→ step; click selects only; wheel scrolls the transcript; Esc applies, Ctrl+C discards | config.tsx:224-242 |
| Model picker `s` | This session only | Missing | model-picker.tsx:60-68 |
| Agents view | PgUp/PgDn, Home/End, Shift+Enter/Ctrl+J, Tab, Ctrl+G, Ctrl+S/T/F/R, Alt+↑↓, Alt+1-9, Shift+↑↓, `?`, `/exit` | None of these; adds Ctrl+U | agents.tsx:296-320 |
| ← on empty prompt | Asks to confirm if you just cleared or browsed history; "← for agents" footer hint for 10 s | Immediate, no hint | prompt.tsx:546 |
| Above-prompt band | Ctrl+X Tab focuses it, Ctrl+X Ctrl+A collapses, Tab/Enter press | Mouse only | mod-band.tsx |
| Hints that ignore keybindings.json | – | Hard-coded: `shift+tab` (status.tsx:220), `ctrl+r older` (prompt.tsx:657), "Press Ctrl+C again to exit" (app.tsx:1636), HELP text (app.tsx:136-169), "(Alt+P)", "(Ctrl+O)", "(Esc Esc)" in menu descriptions (app.tsx:1047, 1053, 1056), "Try Ctrl+B again" (app.tsx:1007). Only stash, chord, ultracode, kill and follow hints read the keymap (prompt.tsx:190, 636-638; app.tsx:1638; inspector.tsx:309) | – |
| Global actions outside the box | Global context works everywhere | Keymap actions only run while the box has the keys; with the inspector focused, Ctrl+T, Ctrl+B, Shift+Tab, Alt+P do nothing and Ctrl+C closes the inspector | app.tsx:1579, inspector.tsx:157-176 |

Matches CC (no action needed): Ctrl+X Ctrl+K double press, Ctrl+S stash, Ctrl+G / Ctrl+X Ctrl+E, Ctrl+X Enter, Ctrl+Enter / Ctrl+X Ctrl+S, Alt+P/T/O/W, Ctrl+B, Ctrl+T, Esc interrupt, Esc Esc rewind on empty box, Ctrl+Home/End, agents-view Enter/→/Space/Ctrl+X/Esc/Ctrl+C.

## F. Discoverability

**Only in README (not in `/help`, hints or menu text):**
- keybindings.json support and which actions exist (README:62; keys.ts only reports problems if the file exists, keys.ts:108-143).
- Permission-prompt half-second grace (README:132; decision.tsx:16).
- Inspector Space, PgUp/PgDn, Home/End and digit-to-tab keys (README:129; footer lists only ←→ tab ↑↓ c, inspector.tsx:305).
- Clicking the Follow dock to inspect, wheel-to-hold, and clicking `◉ following` (README:130; HELP line app.tsx:149 omits them).
- Clicking a picture flips with ←/→ after enlarging; status-bar click on mode/model/effort is also in FULLSCREEN_HELP (app.tsx:165), so not README-only.
- CLI flags and `ASTROCODE_*` variables (README run/settings sections).
- Agents view's per-row behaviors (moves finished sessions into astrocode, attach vs open), partly hinted by "enter attach / enter open here" (agents.tsx:363).

**In neither README nor in-app text:**
- Ctrl+D exits immediately (keys.ts:46).
- Lightbox `q` (lightbox.tsx:43); task view Backspace = back (tasks.tsx:71); find Shift+Enter, Ctrl+U, Ctrl+G (find.tsx:37-43); search Ctrl+G (prompt.tsx:456); picker/Manager PgUp/PgDn; MCP Shift+Tab; Tab in permission prompts/questions; Alt+Backspace, Delete, Ctrl/Alt+←→.
- Clicks: inside an opened entry closes it; `… N more` opens a step; failure/subagent sub-lines; `↯ fast`, `thinking off`, `◌ N running`, `⇄ remote` status segments (only cache is in HELP, app.tsx:158).
- Mirror click facts (mirror.tsx:161-178).
- OSC 133 prompt marks for terminal jump-to-prompt in SB (window.ts:212-219).

**Only in `/help` (not README):** Ctrl+F find, Alt+↑↓, Alt+Shift+↑↓, clicking a turn's closing line (app.tsx:162-166); FULLSCREEN_HELP prints only when `/help` runs in FS (app.tsx:796).

**Missing hints in place:** command menu hint omits "esc closes" (prompt.tsx:778); nothing in the box hints at ← for agents (CC shows a hint); no in-app key overlay like CC's `?`.

## G. Other defects found while mapping (worth a failing test each)

- G1. Esc while Follow is paused by the wheel interrupts Claude (A1; app.tsx:1527, prompt.tsx:515).
- G2. An unfocused inspector can't be closed from the keyboard without turning Follow on (C7; app.tsx:622-631).
- G3. Ctrl+C is swallowed in a question's "Other" field (question.tsx:86).
- G4. Wheel over overlays that don't handle it scrolls the transcript behind them (screen.tsx:248-251 has no hit test).
- G5. ← in a Manager list wipes a typed rule/filter (manager.tsx:212-214).
- G6. README claims that don't match code: Space ignored-in-grace in permission prompts (README:132 vs decision.tsx), "← or →… holds the panel" while following (README:130; ←/→ reach the box, not the panel, until it has the keys), dock click "in scrollback" (README:130).
