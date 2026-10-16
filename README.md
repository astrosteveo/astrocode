# astrocode

A personal front end for Claude, built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). It runs in the terminal by default, or in the browser with `--web`.

The SDK runs the Claude Code binary, so astrocode uses the same login as `claude`, which is your Claude subscription. It also loads the same settings, CLAUDE.md files, skills, plugins, hooks and MCP servers. astrocode only replaces the interface.

## Run it

```sh
cd ~/Projects/astrocode && bun install
alias astrocode='bun ~/Projects/astrocode/src/cli.ts'   # add to ~/.zshrc
```

Then, in any project folder:

```sh
astrocode                 # start a session here
astrocode -c              # continue the most recent session here
astrocode -r <id>         # resume a session; astrocode prints the id when you exit
astrocode -m opus         # pick the model
astrocode --web           # the browser front end, at http://127.0.0.1:4317
```

Sessions are saved where Claude Code saves its own, so `claude --resume <id>` opens an astrocode session too, and the reverse also works.

### In the terminal

| Key | What it does |
| :-- | :-- |
| Enter | Send |
| Shift+Enter, Alt+Enter, or `\` then Enter | New line |
| Esc | Stop Claude |
| Shift+Tab | Change the permission mode: ask first, accept edits, plan, auto, bypass permissions |
| ↑ ↓ | Earlier messages, or move between lines |
| Ctrl+C | Clear the box, stop Claude, or exit when pressed twice |
| `/clear` | Start a new session on a clean screen |
| `/help`, `/exit` | Keys and commands, quit |

Any other `/command` goes to Claude Code. When Claude asks permission, choose with ↑ ↓ and Enter or press a number. Esc denies. Enter and number keys pressed in the first half-second after a prompt appears are ignored, so an Enter you meant for your message can't approve it.

### Settings

| Variable | Default | What it does |
| :-- | :-- | :-- |
| `ASTROCODE_ACCENT` | `nebula` | The terminal accent: `nebula`, `ember`, `mint`, `rose`, `gold`, a hex color or a terminal color name |
| `ASTROCODE_MODEL` | Claude Code's default | The model, as with `-m` |
| `ASTROCODE_PORT` | `4317` | The port for `--web`. The server only listens on 127.0.0.1. |

### Signing in

astrocode uses whatever Claude Code is signed in with. The footer (or the top bar on the web) shows the account, for example "Claude Max". Keep `ANTHROPIC_API_KEY` unset. If it's set, Claude Code uses the key, and that usage is billed to the key instead of your subscription.

Keep it for your own use. Anthropic's [terms for Claude Code](https://code.claude.com/docs/en/legal-and-compliance) don't allow offering subscription sign-in in an app other people use.

## What you see

- Claude's replies stream as they're written. Markdown is drawn with framed, highlighted code, box-drawn tables, glyph headings and callouts. The terminal drawing comes from nebula-ui.
- Each tool call is one row with a status, the tool, what it acts on, and a word on how it went. In the terminal, a finished row also keeps a command's output, an edit's diff, or the to-do list.
- Permission prompts show the command, diff or file first. "Always allow" applies only the narrowest rule Claude Code suggests, and its label names that rule.
- In the terminal, finished output goes into your terminal's own scrollback, like `claude`.

## How it fits together

```
tui/ (Ink) ─┐
            ├─ src/session.ts (Agent SDK) ⇄ Claude Code ⇄ Claude
web/ ───────┘  via src/server.ts and a WebSocket
```

- `src/cli.ts` reads the arguments and starts the terminal app or the web server.
- `src/session.ts` runs one Claude Code session in streaming-input mode and turns permission checks into prompts.
- `src/view/` is shared by both front ends: the reducer that turns session events into what's on screen, plus tool summaries and permission wording.
- `tui/` is the terminal app. `tui/markdown.ts` is copied from nebula-ui.
- `web/` is the browser page, and `src/server.ts` serves it.

## Security

The web server listens on 127.0.0.1 only. It accepts WebSocket connections only from its own page, by checking the Origin and Host headers. Any website you visit can open a WebSocket to localhost, and this one can run commands. Claude's Markdown is rendered without raw HTML.

## Not built yet

- Claude's multiple-choice questions. AskUserQuestion is turned off, so Claude asks in plain text instead.
- A session picker. Resume by id or with `-c` for now.
- A model picker, a `/` command menu and image input
- Opening a finished tool row in the terminal to see all of its output
- Subagent transcripts. Only the number of tool calls a subagent made is shown.
