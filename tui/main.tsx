import { render } from "ink";
import { homedir } from "node:os";
import { loadHistory, savedSessions, sessionTitle } from "../src/history";
import { AgentSession } from "../src/session";
import { App } from "./app";
import { gitInfo } from "./git";
import { Store } from "./store";

export type TerminalOptions = { cwd: string; model?: string; resume?: string; continue?: boolean };

export async function startTerminal(options: TerminalOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("astrocode needs an interactive terminal.");
    process.exit(1);
  }

  // Continuing means resuming the newest session here, found up front so its history can be shown.
  let resume = options.resume;
  let note: string | undefined;
  if (!resume && options.continue) {
    const [latest] = await savedSessions(options.cwd, 1).catch(() => []);
    if (latest) resume = latest.id;
    else note = "There's no earlier session in this folder, so this is a new one.";
  }

  const store = new Store(options.cwd, homedir());
  // Claude Code's own stderr would scribble over the screen; failures still arrive as notices.
  const session = new AgentSession({ cwd: options.cwd, model: options.model, resume, emit: store.emit, onStderr: () => {} });
  session.start();
  const git = await gitInfo(options.cwd);

  const app = render(<App store={store} session={session} branch={git?.branch} />, {
    exitOnCtrlC: false,
    kittyKeyboard: { mode: "auto" },
    incrementalRendering: true,
  });

  if (note) store.emit({ kind: "notice", tone: "info", text: note });
  if (resume) {
    const id = resume;
    Promise.all([loadHistory(id, options.cwd), sessionTitle(id, options.cwd)])
      .then(([events, title]) => store.emit({ kind: "history", events, title }))
      .catch((error: unknown) =>
        store.emit({ kind: "notice", tone: "error", text: `Couldn't load the earlier conversation: ${error instanceof Error ? error.message : String(error)}` }),
      );
  }

  await app.waitUntilExit();
  session.close();
  if (session.id) console.log(`\nResume this conversation with: astrocode --resume ${session.id}`);
  process.exit(0);
}
