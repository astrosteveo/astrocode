import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { render } from "ink";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { moveToBackground, stopAgent, type SessionSettings } from "../src/agents";
import { loadHistory, savedSessions, sessionTitle } from "../src/history";
import { AgentSession } from "../src/session";
import { showServer, visualInstructions } from "../src/show";
import { loadSettings, saved as settingsSaved } from "../src/settings";
import { loadStash, stashSaved } from "../src/stash";
import { AgentsView, hereState } from "./agents";
import { App } from "./app";
import { CANVAS_COLORS, canvas } from "./diagrams";
import { gitInfo } from "./git";
import { loadKeymap } from "./keys";
import { Mouse, MouseContext } from "./mouse";
import { afterFrame, drawsImages, forgetSent } from "./pictures";
import { Store } from "./store";
import { markPrompts, TerminalWindow } from "./window";

/** How often a second the screen may be drawn again. */
const MAX_FPS = 120;

export type TerminalOptions = {
  cwd: string;
  model?: string;
  effort?: EffortLevel;
  resume?: string;
  continue?: boolean;
  fullscreen?: boolean;
  /** Open on the agents view, with no conversation, as `astrocode agents` does. */
  agents?: boolean;
};

/** A conversation open in astrocode: what's on screen, and the Claude Code it runs in. */
type Held = { store: Store; session: AgentSession; cwd: string };

/** What the agents view was left for. */
type Leaving = { kind: "back" } | { kind: "open"; cwd: string; sessionId: string } | { kind: "exit" };

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

  // Focus reports, the title and the tab's progress, for both layouts, every switch between them,
  // and every conversation opened.
  const window = new TerminalWindow(process.stdin, process.stdout);
  window.start();
  markPrompts(process.stdout);
  // Claude Code's keybindings.json, so keys you've changed in `claude` change here too. What it
  // says is wrong with the file waits for the first conversation to show it.
  const { keymap, problems } = await loadKeymap();
  let unsaid = problems;
  let held: Held | null = null;
  // Process warnings print straight to stderr, over the screen. The SDK warns on every start in
  // bypass mode that canUseTool won't run, but Claude's questions still come through it.
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if ((warning as { code?: string }).code === "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED") return;
    held?.store.emit({ kind: "notice", tone: "info", text: `Warning: ${warning.message}` });
  });

  /** Starts a conversation in `cwd`, a new one or `resume`d with its history on screen, with what you last picked. */
  const open = async (cwd: string, resume?: string, note?: string): Promise<Held> => {
    const store = new Store(cwd, homedir());
    const saved = await loadSettings();
    const stash = await loadStash(cwd);
    if (stash) store.unstash(stash);
    if (saved.todos) store.todos = saved.todos;
    if (saved.notify) store.notifyMode = saved.notify;
    if (saved.usage) store.usageMode = saved.usage;
    if (saved.keepWarm !== undefined) store.keepWarm = saved.keepWarm;
    if (saved.agentSummaries !== undefined) store.agentSummaries = saved.agentSummaries;
    if (saved.remoteControl !== undefined) store.remoteControl = saved.remoteControl;
    store.window = window;
    store.keymap = keymap;
    // Claude Code's own stderr would scribble over the screen; failures still arrive as notices.
    const session = new AgentSession({
      cwd,
      model: options.model ?? saved.model,
      effort: options.effort ?? saved.effort,
      thinking: saved.thinking,
      mode: saved.mode,
      resume,
      agentSummaries: saved.agentSummaries,
      remoteControl: saved.remoteControl,
      // Claude draws only where the pictures can be seen.
      visuals:
        drawsImages && canvas.available
          ? { server: () => showServer(canvas, cwd), instructions: visualInstructions(CANVAS_COLORS, true), htmlPreviews: true }
          : undefined,
      emit: store.emit,
      onStderr: () => {},
    });
    session.start();
    if (note) store.emit({ kind: "notice", tone: "info", text: note });
    for (const problem of unsaid) store.emit({ kind: "notice", ...problem });
    unsaid = [];
    if (resume) {
      const id = resume;
      Promise.all([loadHistory(id, cwd), sessionTitle(id, cwd)])
        .then(([events, title]) => store.emit({ kind: "history", events, title }))
        .catch((error: unknown) =>
          store.emit({ kind: "notice", tone: "error", text: `Couldn't load the earlier conversation: ${error instanceof Error ? error.message : String(error)}` }),
        );
    }
    return { store, session, cwd };
  };

  /** What a session started from the agents view runs with: what a new conversation here would. */
  const newSettings = async (): Promise<SessionSettings> => {
    const saved = await loadSettings();
    return { model: options.model ?? saved.model, effort: options.effort ?? saved.effort, mode: saved.mode };
  };

  let fullscreen = options.fullscreen ?? (await loadSettings()).fullscreen ?? false;

  /**
   * The conversation on screen until it's left for the agents view or astrocode quits. /fullscreen
   * switches by starting the interface again in the other layout. The store and the session carry
   * on, so the conversation does too.
   */
  const showSession = async ({ store, session, cwd }: Held) => {
    const git = await gitInfo(cwd);
    for (;;) {
      let leaving = null as "layout" | "agents" | null;
      // Ink asks the terminal about the kitty keyboard protocol as it starts, before its input hooks
      // turn raw mode on. With the terminal still echoing, the answer would land on screen as
      // `^[[?0u`. In raw mode it waits in stdin, unechoed, for Ink to read.
      process.stdin.setRawMode(true);
      // Each layout gets its own screen, which needs kitty's images sent again.
      forgetSent();
      const mouse = fullscreen ? new Mouse(process.stdin, process.stdout) : null;
      const leave = (to: "layout" | "agents") => {
        leaving = to;
        // Leave nothing of the scrollback layout's live part behind.
        app.clear();
        app.unmount();
      };
      const app = render(
        <MouseContext value={mouse}>
          <App
            store={store}
            session={session}
            branch={git?.branch}
            fullscreen={fullscreen}
            onToggleFullscreen={() => leave("layout")}
            onAgents={() => leave("agents")}
          />
        </MouseContext>,
        {
          exitOnCtrlC: false,
          kittyKeyboard: { mode: "auto" },
          incrementalRendering: true,
          // At Ink's 30, a drag's selection trails the pointer. Frames still come only when something changes.
          maxFps: MAX_FPS,
          alternateScreen: fullscreen,
          onRender: afterFrame,
        },
      );
      mouse?.start();
      await app.waitUntilExit();
      mouse?.stop();
      if (leaving !== "layout") return leaving ?? "exit";
      fullscreen = !fullscreen;
      if (!fullscreen) redrawScrollback(store);
    }
  };

  /**
   * Moves the conversation open here to Claude Code's background service, which carries it on where
   * `claude agents` lists it, and gives its id there. Only while Claude is idle: its Claude Code here
   * stops, and whatever it was doing would stop with it.
   */
  const handOff = async () => {
    if (!held) return undefined;
    const { store, session, cwd } = held;
    const state = store.getSnapshot();
    if (hereState(state, store.shells.size) !== "idle") throw new Error("Claude is still working in this session, or waiting on you. Esc goes back to it.");
    const id = session.knownId;
    session.close();
    held = null;
    // A conversation with nothing said in it yet has nothing to carry on.
    if (!id || !state.items.some((item) => item.kind === "prompt")) return undefined;
    try {
      return await moveToBackground(id, cwd, { model: state.model, effort: state.effort, mode: state.mode });
    } catch (error) {
      session.start();
      held = { store, session, cwd };
      throw error;
    }
  };

  let farewell: string | undefined;

  /** The agents view, until it's left: back to the conversation open here, into another one, or out of astrocode. */
  const showAgents = async (): Promise<Leaving> => {
    const settings = await newSettings();
    const sessionId = held?.session.knownId;
    const title = held && sessionId ? await sessionTitle(sessionId, held.cwd).catch(() => undefined) : undefined;
    let leaving: Leaving = { kind: "exit" };
    process.stdin.setRawMode(true);
    const app = render(
      <AgentsView
        here={held ? { store: held.store, sessionId, title } : null}
        cwd={held?.cwd ?? options.cwd}
        home={homedir()}
        settings={settings}
        onBack={() => leave({ kind: "back" })}
        onOpen={async (agent) => {
          if (agent.sessionId && agent.sessionId === held?.session.knownId) return leave({ kind: "back" });
          if (!agent.sessionId) throw new Error(`Claude Code hasn't said which conversation ${agent.name} is.`);
          if (!existsSync(agent.cwd)) throw new Error(`${agent.name}'s folder, ${agent.cwd}, is gone.`);
          if (held && hereState(held.store.getSnapshot(), held.store.shells.size) !== "idle")
            throw new Error("Claude is still working in this session, or waiting on you. Esc goes back to it.");
          // Its Claude Code holds the conversation while it runs, even idle; stopped, it can be resumed here.
          if (agent.alive) await stopAgent(agent.id);
          await handOff();
          leave({ kind: "open", cwd: agent.cwd, sessionId: agent.sessionId });
        }}
        onExit={async () => {
          const job = await handOff();
          if (job) farewell = `${title ?? "This conversation"} carries on in the background as ${job}: claude attach ${job}, or astrocode agents.`;
          leave({ kind: "exit" });
        }}
      />,
      { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" }, incrementalRendering: true, maxFps: MAX_FPS, alternateScreen: true },
    );
    function leave(next: Leaving) {
      leaving = next;
      app.unmount();
    }
    await app.waitUntilExit();
    return leaving;
  };

  if (!options.agents) held = await open(options.cwd, resume, note);
  let screen: "session" | "agents" = held ? "session" : "agents";
  for (;;) {
    if (screen === "session" && held) {
      if ((await showSession(held)) === "exit") break;
      screen = "agents";
      continue;
    }
    const leaving = await showAgents();
    if (leaving.kind === "exit") break;
    if (leaving.kind === "open") held = await open(leaving.cwd, leaving.sessionId);
    // The agents view had its own screen. Scrollback is written again, the conversation and all, on a clean one.
    if (held && !fullscreen) redrawScrollback(held.store);
    screen = "session";
  }

  const last = held as Held | null;
  last?.session.close();
  window.stop();
  await Promise.all([settingsSaved(), stashSaved(), canvas.close()]);
  if (farewell) console.log(`\n${farewell}`);
  else if (last?.session.id) console.log(`\nResume this conversation with: astrocode --resume ${last.session.id}`);
  process.exit(0);
}

/** Starts the scrollback over on a clean screen, for the conversation to be written into it again. */
function redrawScrollback(store: Store) {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  store.redraw();
}
