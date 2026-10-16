import { render } from "ink";
import { homedir } from "node:os";
import { AgentSession } from "../src/session";
import { App } from "./app";
import { Store } from "./store";

export type TerminalOptions = { cwd: string; model?: string; resume?: string; continue?: boolean };

export async function startTerminal(options: TerminalOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("astrocode needs an interactive terminal. To use the browser instead, run: astrocode --web");
    process.exit(1);
  }

  const store = new Store(options.cwd, homedir());
  // Claude Code's own stderr would scribble over the screen; failures still arrive as notices.
  const session = new AgentSession({ ...options, emit: store.emit, onStderr: () => {} });
  session.start();

  const app = render(<App store={store} session={session} />, {
    exitOnCtrlC: false,
    kittyKeyboard: { mode: "auto" },
    incrementalRendering: true,
  });
  await app.waitUntilExit();

  session.close();
  if (session.id) console.log(`\nResume this conversation with: astrocode --resume ${session.id}`);
  process.exit(0);
}
