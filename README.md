# astrocode

Our own version of `claude`: Claude Code's engine with a terminal front end of our own, built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

The SDK runs the Claude Code binary, so astrocode uses the same login as `claude`, which is your Claude subscription. It also loads the same settings, CLAUDE.md files, skills, plugins, hooks and MCP servers. Only the interface is ours.

## Run it

```sh
cd ~/Projects/astrocode && bun install
alias astrocode='bun ~/Projects/astrocode/src/cli.ts'   # add to ~/.zshrc
```

Then, in any project folder:

```sh
astrocode                 # start a session here
astrocode -c              # continue the most recent session here, with its history on screen
astrocode -r <id>         # resume a session; astrocode prints the id when you exit
astrocode -m opus         # pick the model
astrocode -e high         # pick the effort
astrocode -f              # full screen, with the mouse
```

Sessions are saved where Claude Code saves its own, so `claude --resume <id>` opens an astrocode session too, and `/resume` in astrocode lists sessions from both.

## Keys

| Key | What it does |
| :-- | :-- |
| Enter | Send |
| Shift+Enter, Alt+Enter, Ctrl+J, or `\` then Enter | New line |
| `/` | Command menu: ↑↓ to choose, Tab to complete, Enter to run |
| `@` | File menu: type part of a path, then Tab or Enter to put it in your message. A folder opens on what's in it |
| Esc | Stop Claude. Twice on an empty box: rewind to an earlier message |
| Shift+Tab | Change the permission mode: ask first, accept edits, plan, auto, bypass permissions |
| Alt+P | Switch the model (↑↓) and its effort (←→) in one picker |
| Ctrl+S | Put the message aside. It stays stashed, whatever you send meanwhile, until Ctrl+S brings it back; with a message in the box, the two trade places |
| ↑ ↓ | Earlier messages, or move between lines |
| Ctrl+R | Search what you've sent: type to find, Ctrl+R for older matches, Enter keeps it, Esc cancels |
| Ctrl+_ | Undo, a word at a time |
| Ctrl+K, Ctrl+U, Ctrl+W, Alt+D, Ctrl+Y | Cut to the end of the line, to its start, the word before, the word after; put back what was cut |
| Alt+B, Alt+F | Move a word back or forward |
| Ctrl+L | Clear the box |
| Ctrl+G, or Ctrl+X Ctrl+E | Write the message in `$EDITOR` |
| Ctrl+V | Attach the clipboard's image |
| Ctrl+B, or Ctrl+X Ctrl+B | Move the command or subagent Claude is waiting on to the background |
| Ctrl+X Ctrl+K | Stop everything in the background |
| Ctrl+T | Show or hide the to-do list |
| Ctrl+O | Pick a tool call and print its whole output |
| Ctrl+C | Clear the box, stop Claude, or exit when pressed twice |

## Commands

| Command | What it does |
| :-- | :-- |
| `/resume` | Pick a saved session from this folder (type to filter); its conversation replays on screen |
| `/model` | Switch the model and its effort, as Alt+P does (or `/model sonnet`) |
| `/effort` | Set how hard Claude thinks (or `/effort high`) |
| `/clear` | Start a new session on a clean screen |
| `/output` | Same as Ctrl+O |
| `/plugins` | Manage plugins: turn them on or off, install, update and uninstall them, and add or remove marketplaces |
| `/config` | astrocode's settings: model, effort, permission mode and full screen. ↑↓ chooses, ←→ changes, Esc puts the changes into effect and saves them, Ctrl+C throws them away |
| `/fullscreen` | Switch to full screen, or back to the terminal's scrollback |
| `/help`, `/exit` | Keys and commands, quit |

Every other `/command` goes to Claude Code, and the menu lists them all: its built-ins, your skills, plugins and custom commands.

## Plugins

`/plugins` (or `/plugin`) has three lists; Tab or ← → moves between them, and typing filters the one you're on.

- **Installed.** Space turns a plugin on or off. Enter offers to update or uninstall it.
- **Discover.** Everything your marketplaces offer that isn't installed, most installed first. Enter installs it for you, for everyone on the project, or for you in this project only.
- **Marketplaces.** Enter shows a marketplace's plugins, updates its list, or removes it. Type `owner/repo`, a URL or a folder to add one.

The Agent SDK can't install or remove plugins, so each change runs Claude Code's own `claude plugin` command, and then the session reloads its plugins: new commands appear in the `/` menu straight away, with no restart.

## Files

Type `@` and part of a path to pick a file or folder from the project; Claude Code reads what you named when the message arrives. In a git repository the menu lists what git does, so ignored files stay out. A path with a space is written `@"like this"`.

## What you see

astrocode's look takes its colors from the Hubble palette, the gold and teal of narrowband space photographs. Gold is you: your messages, anything waiting on you, your cursor and your selection. Teal is Claude. Everything else stays quiet.

- **The rail.** Each turn is a path down the left edge. Your message starts it with a gold dot, every step Claude takes is a node on it (a teal diamond for a reply, `∴` for thinking, a hexagon for a tool call), and the turn's time and tokens close it with a curve. Scan the left edge to see what happened.
- **The mirror.** astrocode's mark is the James Webb Space Telescope's primary mirror: 18 gold hexagons, the center one missing. Full screen opens on it drawn large, its segments lighting up as astrocode starts.
- **Live replies.** Claude's replies stream in at the tip of the rail, where a dot circles while Claude works and light passes over what it's doing ("Thinking", "Writing", "Running Bash"), with the time so far and the tokens written. It turns gold and holds still when Claude is waiting on you.
- **Panels.** Prose sits on your terminal's background; code and anything a tool printed sit on a panel, a filled surface with soft edges and its language set into the top edge. Code is highlighted in the same palette, tables have no grid, and quotes and callouts hang off a hairline.
- **Tool calls.** A tool call's hexagon says how it went: filled teal once it's done, rose if it failed, an outline while it runs or after it was stopped or denied, gold while it waits for you. Its row names the tool and what it acts on, with the result against the right edge. A finished call keeps a command's output, an edit's diff (added lines tinted teal, removed ones rose), the to-do list, or your answers to Claude's questions.
- **Permission prompts.** They show the command, diff or file before you choose. "Always allow" applies only the narrowest rule Claude Code suggests, and the option names that rule. Enter, Space and number keys pressed in the first half-second after a prompt appears are ignored, so a key you meant for something else can't approve it.
- **Claude's questions.** When Claude asks a multiple-choice question, you pick from a list with descriptions and previews, check several options where that's allowed, or type your own answer. This works in every mode, bypass included.
- **Where your keys go.** The message box, a picker or a prompt that has your keys has a gold hairline along its top edge.
- **The status bar.** The permission mode as a solid chip, then the model and the effort you set, how full the context is, your plan's 5-hour and 7-day usage (with reset times once they get high), the git branch and changed files, and your plan.
- **Scrollback.** Finished output goes into your terminal's own scrollback, like `claude`.

## Full screen

`astrocode -f`, `ASTROCODE_FULLSCREEN=1` or `/fullscreen` gives astrocode the whole terminal, like vim or htop. It opens on the mirror; from your first message, the conversation scrolls in a viewport of its own, with the message box and status bar pinned under it, and the mouse works:

| Do this | And |
| :-- | :-- |
| Scroll the wheel, or PgUp and PgDn | The conversation scrolls. Scroll up and it stays put while Claude writes; the pill at the bottom says how much is below. Click it, or press Ctrl+End, to follow again. Ctrl+Home goes to the top |
| Drag | Selects text and copies it when you let go, through the terminal (OSC 52) and the desktop clipboard. It copies only content: not the rail, and on a panel only the code, without its padding or edges |
| Double-click, triple-click | Copies a word (or a path or URL), or a line |
| Click a tool call | Opens its whole output under its row; click again to close it. Ctrl+O opens one from a list and scrolls to it |
| Click an option | Chooses it, in permission prompts, Claude's questions, pickers, `/plugins`, and the `/` and `@` menus |
| Click the mode, the model or the effort | Changes the permission mode, or opens the model or effort picker |
| Click in the message box | Puts the cursor there |
| Drag the scrollbar | Scrolls |
| Hold Shift | Uses the terminal's own selection instead |

Full screen uses the terminal's alternate screen, so the conversation isn't in your scrollback when you leave. `/fullscreen` switches back and writes it there.

## Settings

`/config`, and the model, effort, mode and layout you pick anywhere else, are kept for next time in `~/.config/astrocode/settings.json` (under `$XDG_CONFIG_HOME` if it's set), not in Claude Code's settings, so `claude` keeps its own. Plan mode and max effort are for one session only, as in Claude Code.

| Variable | Default | What it does |
| :-- | :-- | :-- |
| `ASTROCODE_ACCENT` | gold | Your color, as a hex color such as `#F0B85A` |
| `ASTROCODE_MODEL` | Claude Code's default | The model, as with `-m` |
| `ASTROCODE_EFFORT` | Claude Code's default | The effort, as with `-e` |
| `ASTROCODE_FULLSCREEN` | off | `1` starts in full screen, as with `-f` |

astrocode is designed for a dark theme with true color, such as kitty. Its colors are its own, so it looks the same whatever theme your terminal uses.

## Signing in

astrocode uses whatever Claude Code is signed in with; the status bar shows the account, for example "Claude Max". Keep `ANTHROPIC_API_KEY` unset. If it's set, Claude Code uses the key, and that usage is billed to the key instead of your subscription.

Keep it for your own use. Anthropic's [terms for Claude Code](https://code.claude.com/docs/en/legal-and-compliance) don't allow offering subscription sign-in in an app other people use.

## How it fits together

- `src/cli.ts` is the `astrocode` command.
- `src/session.ts` runs one Claude Code session through the Agent SDK in streaming-input mode. It turns permission checks and Claude's questions into prompts, and reports the account, the models, the commands and context usage.
- `src/events.ts` defines what the session tells the interface.
- `src/history.ts` lists saved sessions and loads a saved conversation.
- `src/plugins.ts` lists and changes plugins and marketplaces through `claude plugin`, with the Claude Code binary the SDK ships.
- `src/view/` holds the reducer that turns events into what's on screen (live and replayed alike), plus tool summaries, permission wording and formatting.
- `tui/` is the Ink front end. `tui/theme.ts` holds the palette, `tui/rail.tsx` the rail, and `tui/markdown-view.tsx` the panels and Markdown drawing; `tui/markdown.ts`, the Markdown parser, is copied from nebula-ui. `tui/plugins.tsx` is `/plugins`, and `tui/files.ts` finds files for `@`. `tui/screen.tsx` is full screen: `tui/transcript.tsx` draws the conversation as lines, `tui/mouse.ts` reads the mouse, and `tui/selection.ts` and `tui/clipboard.ts` copy.

## Not built yet

- Subagent transcripts. Only the number of tool calls a subagent made is shown.
