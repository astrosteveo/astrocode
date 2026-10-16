# astrocode

Our own version of `claude`: a terminal front end (Ink 8, React 19, Bun) for Claude Code, built on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The web front end was removed on 2026-10-15; it's in commit 623882d if it's ever needed.

## Layout

- `src/cli.ts`: the `astrocode` command
- `src/session.ts`: the Agent SDK session
- `src/events.ts`: what the session tells the interface
- `src/history.ts`: saved sessions and replayed conversations
- `src/view/`: the reducer (`state.ts`), tool summaries, permission wording and formatting
- `tui/`: the Ink components

## Commands

- `bun src/cli.ts [dir]`. Use `ASTROCODE_MODEL=haiku` for cheap test runs.
- `bun run typecheck`

## Rules

- Take SDK types from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and `sdk-tools.d.ts` (tool inputs and outputs), and Ink's API from `node_modules/ink/readme.md`. Don't guess them.
- Keep `permissionMode` explicit in `src/session.ts`. Without it, Claude Code starts in the mode from the user's settings (`bypassPermissions` here), and no permission prompt ever shows.
- "Always allow" applies only `narrowest()` of Claude Code's suggestions. The full list can include `setMode: acceptEdits`, which silently turns off every later edit prompt. The option's label comes from `alwaysLabel()`.
- AskUserQuestion arrives through `canUseTool`, even in bypass mode, and is answered with `updatedInput: { ...input, answers }`. Answers are keyed by question text, and a multi-select answer joins its labels with ", ".
- `src/view/state.ts` must stay a pure reducer. A resumed conversation is replayed through it as one `history` event.
- Saved transcripts have no record of permission prompts, so a refused tool is recognized by Claude Code's "The user doesn't want to proceed" result.
- Rate-limit windows come from `rate_limit_info.unifiedWindows`, which isn't in the SDK's types. Read it with `field()`.
- Only finished entries go into Ink's `<Static>`, because Static never redraws. A tool row is finished once it isn't running and isn't waiting on the user (`settledCount`). `/clear` and `/resume` clear the screen and bump the store's epoch to start Static over.
- The message box keeps its text in a ref, because keys can arrive faster than React re-renders.
- The permission and question prompts ignore Enter, Space and digits for `GRACE_MS` after they appear. Don't remove that. Scripted tests must wait longer than that before pressing keys.
- `tui/markdown.ts` is a copy of nebula-ui's `hooks/markdown.ts` with one change: links keep their URL as a `url` span. Port fixes in either direction by hand.
- Auth comes from the user's Claude Code login, which is their subscription. Never add API-key handling, and never read credentials in astrocode. `topLevelEnv()` removes only Claude Code's session markers from the environment; settings pass through.
- Testing spends the user's plan. Use `ASTROCODE_MODEL=haiku` and a throwaway project folder, never this repo or another real project.
  - Drive the app in tmux on its own socket (`tmux -L <name>`, `send-keys`, `capture-pane -p`).
  - Take color screenshots with vhs: `Set Theme "Catppuccin Mocha"`, relative screenshot paths that don't start with a digit, and `/clear` between scenes, since vhs reads the top of the buffer.
  - Start with `env -i HOME=… PATH=…` so this session's own environment doesn't leak in.
