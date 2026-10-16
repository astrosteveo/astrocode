import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { render } from "ink";
import { homedir } from "node:os";
import { loadHistory, savedSessions, sessionTitle } from "../src/history";
import { AgentSession } from "../src/session";
import { App } from "./app";
import { gitInfo } from "./git";
import { Mouse, MouseContext } from "./mouse";
import { Store } from "./store";

export type TerminalOptions = { cwd: string; model?: string; effort?: EffortLevel; resume?: string; continue?: boolean; fullscreen?: boolean };

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
  const session = new AgentSession({ cwd: options.cwd, model: options.model, effort: options.effort, resume, emit: store.emit, onStderr: () => {} });
  // So would process warnings, which print straight to stderr. The SDK warns on every start in
  // bypass mode that canUseTool won't run, but Claude's questions still come through it.
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if ((warning as { code?: string }).code === "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED") return;
    store.emit({ kind: "notice", tone: "info", text: `Warning: ${warning.message}` });
  });
  session.start();
  const git = await gitInfo(options.cwd);

  if (note) store.emit({ kind: "notice", tone: "info", text: note });
  if (resume) {
    const id = resume;
    Promise.all([loadHistory(id, options.cwd), sessionTitle(id, options.cwd)])
      .then(([events, title]) => store.emit({ kind: "history", events, title }))
      .catch((error: unknown) =>
        store.emit({ kind: "notice", tone: "error", text: `Couldn't load the earlier conversation: ${error instanceof Error ? error.message : String(error)}` }),
      );
  }

  // /fullscreen switches by starting the interface again in the other layout. The store and the
  // session carry on, so the conversation does too.
  let fullscreen = Boolean(options.fullscreen);
  for (;;) {
    let switching = false;
    // Ink asks the terminal about the kitty keyboard protocol as it starts, before its input hooks
    // turn raw mode on. With the terminal still echoing, the answer would land on screen as
    // `^[[?0u`. In raw mode it waits in stdin, unechoed, for Ink to read.
    process.stdin.setRawMode(true);
    const mouse = fullscreen ? new Mouse(process.stdin, process.stdout) : null;
    const app = render(
      <MouseContext value={mouse}>
        <App
          store={store}
          session={session}
          branch={git?.branch}
          fullscreen={fullscreen}
          onToggleFullscreen={() => {
            switching = true;
            // Leave nothing of the scrollback layout's live part behind.
            app.clear();
            app.unmount();
          }}
        />
      </MouseContext>,
      {
        exitOnCtrlC: false,
        kittyKeyboard: { mode: "auto" },
        incrementalRendering: true,
        alternateScreen: fullscreen,
      },
    );
    mouse?.start();
    await app.waitUntilExit();
    mouse?.stop();
    if (!switching) break;
    fullscreen = !fullscreen;
    // Back in scrollback, the whole conversation is written again on a clean screen.
    if (!fullscreen) {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      store.redraw();
    }
  }

  session.close();
  if (session.id) console.log(`\nResume this conversation with: astrocode --resume ${session.id}`);
  process.exit(0);
}
