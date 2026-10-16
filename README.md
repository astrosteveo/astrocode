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
```

Sessions are saved where Claude Code saves its own, so `claude --resume <id>` opens an astrocode session too, and `/resume` in astrocode lists sessions from both.

## Keys

| Key | What it does |
| :-- | :-- |
| Enter | Send |
| Shift+Enter, Alt+Enter, or `\` then Enter | New line |
| `/` | Command menu: ↑↓ to choose, Tab to complete, Enter to run |
| Esc | Stop Claude |
| Shift+Tab | Change the permission mode: ask first, accept edits, plan, auto, bypass permissions |
| Ctrl+O | Pick a tool call and print its whole output |
| ↑ ↓ | Earlier messages, or move between lines |
| Ctrl+C | Clear the box, stop Claude, or exit when pressed twice |

## Commands

| Command | What it does |
| :-- | :-- |
| `/resume` | Pick a saved session from this folder (type to filter); its conversation replays on screen |
| `/model` | Switch the model (or `/model sonnet`) |
| `/clear` | Start a new session on a clean screen |
| `/output` | Same as Ctrl+O |
| `/help`, `/exit` | Keys and commands, quit |

Every other `/command` goes to Claude Code, and the menu lists them all: its built-ins, your skills, plugins and custom commands.

## What you see

- **The wordmark.** It shows when you start, in a gradient of Catppuccin Mocha pastels (lavender, mauve, pink, peach).
- **Live replies.** Claude's replies stream in as they're written, with a moving shimmer on what it's doing ("Thinking…", "Writing…", "Running Bash…"), the time so far and the tokens written. Markdown is drawn with framed, highlighted code, box-drawn tables, glyph headings and callouts. The drawing comes from nebula-ui.
- **Tool rows.** Each tool call is one row: a status, the tool as a pill, what it acts on and how it went. A finished row also keeps a command's output, an edit's diff, the to-do list, or your answers to Claude's questions.
- **Permission prompts.** They show the command, diff or file before you choose. "Always allow" applies only the narrowest rule Claude Code suggests, and the option names that rule. Enter, Space and number keys pressed in the first half-second after a prompt appears are ignored, so a key you meant for something else can't approve it.
- **Claude's questions.** When Claude asks a multiple-choice question, you pick from a list with descriptions and previews, check several options where that's allowed, or type your own answer. This works in every mode, bypass included.
- **The status bar.** It shows the permission mode, the model, how full the context is, your plan's 5-hour and 7-day usage (with reset times once they get high), the git branch and changed files, and your plan.
- **Scrollback.** Finished output goes into your terminal's own scrollback, like `claude`.

## Settings

| Variable | Default | What it does |
| :-- | :-- | :-- |
| `ASTROCODE_ACCENT` | `nebula` | The accent color: `nebula`, `ember`, `mint`, `rose`, `gold`, a hex color or a terminal color name |
| `ASTROCODE_MODEL` | Claude Code's default | The model, as with `-m` |

astrocode is designed for a dark theme with true color, such as kitty with Catppuccin Mocha.

## Signing in

astrocode uses whatever Claude Code is signed in with; the status bar shows the account, for example "Claude Max". Keep `ANTHROPIC_API_KEY` unset. If it's set, Claude Code uses the key, and that usage is billed to the key instead of your subscription.

Keep it for your own use. Anthropic's [terms for Claude Code](https://code.claude.com/docs/en/legal-and-compliance) don't allow offering subscription sign-in in an app other people use.

## How it fits together

- `src/cli.ts` is the `astrocode` command.
- `src/session.ts` runs one Claude Code session through the Agent SDK in streaming-input mode. It turns permission checks and Claude's questions into prompts, and reports the account, the models, the commands and context usage.
- `src/events.ts` defines what the session tells the interface.
- `src/history.ts` lists saved sessions and loads a saved conversation.
- `src/view/` holds the reducer that turns events into what's on screen (live and replayed alike), plus tool summaries, permission wording and formatting.
- `tui/` is the Ink front end. `tui/markdown.ts` is copied from nebula-ui.

## Not built yet

- Subagent transcripts. Only the number of tool calls a subagent made is shown.
- Image input
- Controls for background tasks
