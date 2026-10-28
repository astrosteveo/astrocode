# astrocode

Our own version of `claude`: a terminal front end (Ink 8, React 19, Bun) for Claude Code, built on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The web front end was removed on 2026-10-15; it's in commit 623882d if it's ever needed. README.md describes what the app does for its user.

## Layout

- `src/`: the session (`session.ts`), its events (`events.ts`), saved sessions (`history.ts`), Claude Code's command line (`claude.ts`, `plugins.ts`, `edits.ts`), its dialogs' data (`dialogs.ts`), astrocode's settings and stash (`settings.ts`, `stash.ts`), `!` commands (`shell.ts`) and `#` notes (`memory.ts`).
- `src/view/`: the reducer (`state.ts`) and what it derives: to-dos, folds, runs, terminal text, permission wording.
- `tui/`: the Ink components. `app.tsx` lays out scrollback (the default) and `screen.tsx` full screen. `keys.ts` is the message box's keymap, `theme.ts` the palette, `transcript.tsx`, `mouse.ts` and `selection.ts` full screen's lines, mouse and copying, `window.ts` the terminal window (title, focus, notifications), `pictures.tsx` kitty images, `figure.tsx` pictures as figures (labels, captions, the files they open), `lightbox.tsx` /pictures, `diagrams.ts` Claude's diagram fences as pictures.
- `src/canvas.ts`: the headless Chromium that draws diagrams, charts, SVG and HTML as PNG. `src/show.ts`: Claude's `show` tool and what Claude is told about drawing.

## Commands

- `bun src/cli.ts [dir]`, or `bun src/cli.ts -f [dir]` for full screen. Use `ASTROCODE_MODEL=haiku` for cheap test runs.
- `bun run typecheck`

## Rules

### The SDK

- Take SDK types from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and `sdk-tools.d.ts`, and Ink's API from `node_modules/ink/readme.md`. Don't guess them.
- Much of what astrocode uses is in the SDK's code but not its types. Call such requests through `untyped()` in `src/session.ts` and check their answers in `src/dialogs.ts`; read such fields with `field()`. Among them: `current_permission_mode`, `rate_limit_info.unifiedWindows`, `supportsThinkingOff`, `getSettings().applied` (`effort`, `ultracode`, `ultracodeAvailable`), `command_lifecycle`, `system/bridge_state`, `workflow_progress`, the saved `timestamp`, `cancelAsyncMessage()`, `enableRemoteControl()`, `getTaskOutput()`, `getSubagentMessages()` and the dialog requests (`getMemoryDialog()`, `getStatus()`, `mcpAuthenticate()` and the like).
- Auth is the user's Claude Code login. Never add API-key handling or read credentials. `topLevelEnv()` removes only Claude Code's session markers from the environment.
- Keep `permissionMode` explicit in `src/session.ts`. Without it Claude Code starts in the user's own mode (`bypassPermissions` here) and no prompt ever shows. astrocode starts in the mode last picked, else `auto`.
- "Always allow" applies only `narrowest()` of Claude Code's suggestions, since the full list can include `setMode: acceptEdits`.
- AskUserQuestion arrives through `canUseTool`, even in bypass mode, and is answered with `updatedInput: { ...input, answers }`, keyed by question text, a multi-select's labels joined with ", ". For that reason the SDK's warning that canUseTool won't run in bypass mode is dropped.
- With visuals on, AskUserQuestion's previews are HTML (`toolConfig.askUserQuestion.previewFormat`). A `question` event waits in the `Store` until its previews are drawn; a preview that doesn't start with `<` is shown as text.
- The permission and question prompts ignore Enter, Space, digits and clicks for `GRACE_MS` after they appear. Don't remove that.
- Stamp every message `origin: { kind: "human" }`, or Claude Code ignores what only a person may ask for (the `ultracode` keyword, a skill named mid-message). Notes from `note()` aren't stamped. Messages and notes go through one chain, `post()`, to keep their order. Each message has its own `uuid`, which rewinding and the queue rely on. Never send `client_composed`: it turns off `@path` expansion.
- Claude Code sends `system/init` before every input, not once. Per-process state resets on `ready`.
- `perTaskStopAffordance` stays on, or every Esc stops all background agents and workflows.
- Claude Code leaves TaskCreate and its kin out unless `CLAUDE_CODE_ENABLE_TODO_TOOLS` is set. astrocode doesn't set it.
- Claude Code's interactive (`local-jsx`) commands don't run through the SDK, so astrocode draws its own /mcp, /permissions, /memory, /hooks, /skills, /sandbox, /status, /output-style, /export, /copy and /btw.
- Never write Claude Code's settings files. Change them with its hidden `edit-permission-rules`, `edit-skill-overrides`, `edit-memory-settings` and `edit-sandbox-settings` subcommands (`--json`, one edit on stdin; `src/edits.ts`), which refuse to run under `CLAUDE_CODE_CHILD_SESSION`. A session reads a changed file a second or so later, so a panel waits (`until()`) before reading again.
- Plugins install, uninstall, enable and disable through `claude plugin … --json` with `claudeBinary()`, then `reloadPlugins()`. `enable` and `disable` accept any id and write it into settings, so offer them only for installed plugins. Never pass `-y`.
- When Claude Code updates, check `DEFAULTS` in `tui/keys.ts` against the binary's keybinding table and `KNOWN` in `tui/arguments.ts` against its command completers. Only Claude Code's own action names may go in `keybindings.json`, or `claude` flags the file.

### Session settings

- astrocode remembers the model, effort, mode, layout, notifications, plan-usage display and keep-warm in `$XDG_CONFIG_HOME/astrocode/settings.json`, never in Claude Code's settings. Plan mode, `max` effort, ultracode, fast mode, `-m`, `-e`, `-f` and their env vars last one session. A mode Claude Code switches to by itself isn't a pick. `tui/main.tsx` waits for pending saves before exiting.
- Effort is `applyFlagSettings({ effortLevel })` mid-session and the `effort` option at start. The status bar shows only a level astrocode set.
- Ultracode is `applyFlagSettings({ ultracode })`, passed again in `settings` when Claude Code restarts. Claude Code accepts it silently even where it can't be on, so read `getSettings().applied` after every change and model switch. A level picked while it's on is sent with `ultracode: false`.
- Alt+W sets `workflowKeywordTriggerEnabled: false` before its message goes and clears it once that message is `completed` or `cancelled`.
- Fast mode is `applyFlagSettings({ fastMode: true, model: "opus" })`, and `{ fastMode: null }` to turn it off. It's in `shared()`.
- Thinking is off with `setMaxThinkingTokens(0)` (or `thinking: { type: "disabled" }` at start) and on with null. Models with `supportsThinkingOff: false` think regardless, and the interface says so.
- In kitty with a browser, `shared()` adds the `show` tool's server (made anew per Claude Code), its instructions (`systemPrompt.append`) and the preview format. A keep-warm request must match them.
- Keep-warm forks the conversation with `persistSession: false` and the session's own options (`shared()`). Any difference in model, effort, thinking, tools or system prompt misses the cache and writes the whole conversation. A warm request that read less than it wrote turns keep-warm off.

### Messages and turns

- A message sent while Claude works goes to Claude Code at once and waits in `state.queue` until `command_lifecycle` says `started` (into the transcript) or `cancelled`. Ctrl+X Enter sends with `priority: "later"`.
- Send now interrupts and waits for the stopped turn to close before sending, or the old turn's last words land after the new message.
- `!` commands and `#` notes go through `note()` with `shouldQuery: false`. A `!` command is saved as `<bash-input>` and `<bash-stdout>`/`<bash-stderr>`, without an exit code. stderr isn't failure; only a non-zero exit is.
- With Remote Control, `--replay-user-messages` echoes every message. Ours are dropped by uuid (`sent`); a stranger's is the phone's.
- Rewinding is `rewindFiles(uuid)` for files (Edit and Write only) and a restart with `resumeSessionAt` for the conversation. Only a dry run lists the files.
- Saved transcripts lack permission prompts, exit codes, structured results and which messages came from the phone. A refused tool is known by "The user doesn't want to proceed"; a backgrounded command by "Command running in background with ID:".

### Drawing

- `src/view/state.ts` must stay a pure reducer. It replaces items rather than changing them, since full screen caches lines per item object. A resumed conversation is replayed through it as one `history` event.
- Only finished entries go into Ink's `<Static>`, which never redraws. `/clear` and `/resume` bump the store's epoch to start it over.
- Nothing may write to the terminal behind Ink's back. Claude Code's stderr is dropped and process warnings become notices. Escape codes Ink doesn't draw (mouse modes, OSC 22 pointer shapes, kitty image commands) go between frames, in `afterFrame()`.
- Raw mode goes on before each `render()`, or a still-echoing terminal prints Ink's kitty-protocol answer as `^[[?0u`. tmux doesn't answer that query, so only kitty shows the bug.
- Whatever must survive `/fullscreen`, which unmounts Ink, lives in the `Store`. The message box, `/plugins` and MCP forms keep their state in refs, since keys arrive faster than React renders.
- Full screen draws with `renderToString`, which shares Ink's reconciler and so can't run during a render or commit: `useTranscript` draws in a microtask after the commit, and nothing drawn there may use hooks.
- Colors come only from `PALETTE` in `tui/theme.ts`. Gold is the user and only the user, teal is Claude, rose failure, ember stopped or denied. `cli.ts` asks the terminal for its colors before importing the interface, since the palette is built once at load.
- Code and tool output go on a `Panel`; prose doesn't. Colored text goes through `onPanel()` first. A new panel background must be added to `PANELS` in `selection.ts`.
- Every entry draws its piece of the rail through `Railed`. Space entries with the rail's gap rows, never margins.
- OSC 8 links end with BEL, or Ink's wrapping drops them. `astrocode:copy:` links go only in full screen, `file://` links and the prompt mark's link only in scrollback.
- The mouse is on only in full screen, so scrollback keeps the terminal's wheel.
- Claude's diagram fences are drawn before their reply enters the `Store` (`whenReady()`), like images, and drawn in `PALETTE` colors without gold. The canvas blocks every request but `data:`, `about:` and `blob:`; keep it that way, since the pages hold what Claude wrote.
- kitty pictures use Unicode placeholders. Ink garbles underline colors, so no placement id goes in the cells. An image must be ready (`prepare()`) before its label enters scrollback. An image has one placement, so placing it at a second size resizes it everywhere: draw a `copyOf()` it instead, as the lightbox does.
- A figure's `open` and `browser` are files astrocode writes to `$XDG_RUNTIME_DIR/astrocode` (else `/tmp/astrocode-<uid>`). A page written there keeps a Content-Security-Policy that blocks the network, as the canvas does.
- Ctrl+G runs the editor in a pty of its own, since Bun keeps reading stdin after Ink lets go and steals keys.

## Testing

Testing spends the user's plan. Use `ASTROCODE_MODEL=haiku` and a throwaway project folder, never this repo or another real project.

- Start with `env -i HOME=… PATH=…`, and with `XDG_CONFIG_HOME` and `XDG_STATE_HOME` in throwaway folders.
- Drive the app in tmux on its own socket (`tmux -L <name>`). Send text and Enter in separate `send-keys` calls with a pause between, or Ink reads the Enter as text. Wait longer than `GRACE_MS` before answering a prompt.
- Mouse: send SGR reports with `send-keys -H` (`ESC [ < button ; x ; y M`, `m` to release; +32 drag, 64/65 wheel; 1-based). `tmux display -p '#{mouse_sgr_flag} #{alternate_on}'` shows the modes. With `set -g set-clipboard on`, a copy lands in `tmux show-buffer`.
- Focus: a detached tmux sends none; fake it with `send-keys -H 1b 5b 4f` and read `#{window_bell_flag}`. `ASTROCODE_TRACE=<file>` logs focus, turn ends and notifications.
- Screenshots: vhs with `Set Theme "Catppuccin Mocha"`, relative paths not starting with a digit, and `/clear` between scenes. vhs can't send mouse events; attach it to the tmux session and drive the app from a script.
- kitty pictures: run kitty hidden on Xvfb (`DISPLAY=:97 KITTY_DISABLE_WAYLAND=1 kitty --config NONE -o allow_remote_control=yes --listen-on unix:<sock> env -i … TERM=xterm-kitty bun src/cli.ts`), type with `kitten @ send-text`, screenshot with `import -window root`.
- Before Ctrl+D, empty the box with Ctrl+C, and check the shell prompt is back before typing at it.
- Use fakes early in `PATH`: `xdg-open` (with `DISPLAY` set) for links and sign-ins, `wl-paste` (with `WAYLAND_DISPLAY` set) for the clipboard. For the editor, use `nvim --clean` or a stand-in that waits with `select()`.
- Set `CLAUDE_CONFIG_DIR` to a throwaway folder to test keybindings, /memory's switches, /mcp (give it a `.claude.json` with `mcpServers`) and plugins (with a local marketplace). Test /permissions, /skills and /sandbox in a throwaway project.
- Test MCP sign-in against a local OAuth server of your own, never a real service.
- Test Remote Control in a throwaway folder with a person on claude.ai.
