import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { render } from "ink";
import { homedir } from "node:os";
import { loadHistory, savedSessions, sessionTitle } from "../src/history";
import { AgentSession } from "../src/session";
import { loadSettings, saved as settingsSaved } from "../src/settings";
import { loadStash, stashSaved } from "../src/stash";
import { App } from "./app";
import { gitInfo } from "./git";
import { loadKeymap } from "./keys";
import { Mouse, MouseContext } from "./mouse";
import { afterFrame, forgetSent } from "./pictures";
import { Store } from "./store";
import { markPrompts, TerminalWindow } from "./window";

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
  // The model, effort, mode and layout you last picked, unless this run's options say otherwise.
  const saved = await loadSettings();
  const stash = await loadStash(options.cwd);
  if (stash) store.unstash(stash);
  if (saved.todos) store.todos = saved.todos;
  if (saved.notify) store.notifyMode = saved.notify;
  if (saved.usage) store.usageMode = saved.usage;
  if (saved.keepWarm !== undefined) store.keepWarm = saved.keepWarm;
  if (saved.agentSummaries !== undefined) store.agentSummaries = saved.agentSummaries;
  if (saved.remoteControl !== undefined) store.remoteControl = saved.remoteControl;
  // Focus reports, the title and the tab's progress, for both layouts and every switch between them.
  store.window = new TerminalWindow(process.stdin, process.stdout);
  store.window.start();
  markPrompts(process.stdout);
  // Claude Code's keybindings.json, so keys you've changed in `claude` change here too.
  const { keymap, problems } = await loadKeymap();
  store.keymap = keymap;
  // Claude Code's own stderr would scribble over the screen; failures still arrive as notices.
  const session = new AgentSession({
    cwd: options.cwd,
    model: options.model ?? saved.model,
    effort: options.effort ?? saved.effort,
    thinking: saved.thinking,
    mode: saved.mode,
    resume,
    agentSummaries: saved.agentSummaries,
    remoteControl: saved.remoteControl,
    emit: store.emit,
    onStderr: () => {},
  });
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
  for (const problem of problems) store.emit({ kind: "notice", ...problem });
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
  let fullscreen = options.fullscreen ?? saved.fullscreen ?? false;
  for (;;) {
    let switching = false;
    // Ink asks the terminal about the kitty keyboard protocol as it starts, before its input hooks
    // turn raw mode on. With the terminal still echoing, the answer would land on screen as
    // `^[[?0u`. In raw mode it waits in stdin, unechoed, for Ink to read.
    process.stdin.setRawMode(true);
    // Each layout gets its own screen, which needs kitty's images sent again.
    forgetSent();
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
        onRender: afterFrame,
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
  store.window.stop();
  await Promise.all([settingsSaved(), stashSaved()]);
  if (session.id) console.log(`\nResume this conversation with: astrocode --resume ${session.id}`);
  process.exit(0);
}
