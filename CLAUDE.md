# astrocode

A personal front end for Claude Code, built on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). It has a terminal app (Ink 8, the default) and a web page (`--web`, served by `Bun.serve` with no build step). Both use Bun and React 19.

## Layout

- `src/cli.ts`: the `astrocode` command
- `src/session.ts`: the Agent SDK session, shared by both front ends
- `src/protocol.ts`: the event types
- `src/server.ts`: the web server
- `src/view/`: UI-agnostic view logic shared by both front ends. That's the reducer (`state.ts`), tool summaries, permission wording and formatting.
- `tui/`: the terminal app
- `web/`: the browser page

## Commands

- `bun src/cli.ts [dir]` runs the terminal app. `--web` runs the browser version. `ASTROCODE_MODEL=haiku` keeps test runs cheap.
- `bun run typecheck`

## Rules

- Take SDK types from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, and Ink's API from `node_modules/ink/readme.md`. Don't guess either.
- `web/` imports the SDK with `import type` only (`verbatimModuleSyntax` enforces this). The browser bundle must not pull in the SDK.
- Keep `permissionMode` explicit in `src/session.ts`. Without it, Claude Code starts in the mode from the user's settings (`bypassPermissions` here), and no permission prompt ever shows.
- "Always allow" applies only `narrowest()` of Claude Code's suggestions. The full list can include `setMode: acceptEdits`, which silently turns off every later edit prompt. Both front ends take its label from `alwaysLabel()`.
- `src/view/state.ts` must stay a pure reducer. The web page rebuilds its view by replaying the server's event log.
- Terminal app:
  - Only finished entries go into Ink's `<Static>`, because Static never redraws. A tool row is finished once it isn't running and isn't waiting for permission (`settledCount`).
  - The message box keeps its text in a ref, because keys can arrive faster than React re-renders.
  - The permission prompt ignores Enter and digits for `GRACE_MS` after it appears. Don't remove that.
- `tui/markdown.ts` is a copy of nebula-ui's `hooks/markdown.ts` with one change: links keep their URL as a `url` span. Port fixes in either direction by hand.
- Don't remove the Origin and Host checks on `/ws`, and don't listen on anything but 127.0.0.1. Any website can open a WebSocket to localhost.
- Auth comes from the user's Claude Code login, which is their subscription. Never add API-key handling, and never read credentials in astrocode. `topLevelEnv()` removes only Claude Code's session markers from the environment; settings pass through.
- Testing spends the user's plan. Use `ASTROCODE_MODEL=haiku` and a throwaway project folder, never this repo or another real project.
  - Drive the terminal app in tmux on its own socket (`tmux -L <name>`, `send-keys`, `capture-pane -p`).
  - Take color screenshots with vhs: `Set Theme "Catppuccin Mocha"`, with relative paths that don't start with a digit.
  - Start with `env -i HOME=… PATH=…` so this session's own environment doesn't leak in.
