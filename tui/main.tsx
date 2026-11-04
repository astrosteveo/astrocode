import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { render } from "ink";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { checkFolder, moveToBackground, stopAgent, type SessionSettings } from "../src/agents";
import { loadHistory, savedSessions, sessionTitle } from "../src/history";
import { PromptHistory } from "../src/prompt-history";
import { AgentSession } from "../src/session";
import { showServer, visualInstructions } from "../src/show";
import { loadSettings, remember, saved as settingsSaved } from "../src/settings";
import { loadStash, stashSaved } from "../src/stash";
import { AgentsView, othersListed } from "./agents";
import { App } from "./app";
import { CANVAS_COLORS, canvas } from "./diagrams";
import { Background, Fleet, liveState, moveAll, titleOf, type Conversation } from "./fleet";
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

/** A conversation astrocode runs: what's on screen for it, and the Claude Code it runs in. */
type Held = Conversation & { session: AgentSession };

/** What the agents view was left for: one of astrocode's conversations, or out of astrocode. */
type Leaving = { kind: "show"; key: string } | { kind: "exit" };

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
  // says is wrong with the file waits for the first conversation to show it. Its prompt history,
  // so ↑ goes back through what you sent there too.
  const prompts = new PromptHistory();
  const [{ keymap, problems }] = await Promise.all([loadKeymap(), prompts.load()]);
  let unsaid = problems;
  const fleet = new Fleet<Held>();
  const background = new Background();
  /** The conversation on screen, or the one the agents view was opened from. */
  let shown: Held | null = null;
  let started = 0;
  // Process warnings print straight to stderr, over the screen. The SDK warns on every start in
  // bypass mode that canUseTool won't run, but Claude's questions still come through it.
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if ((warning as { code?: string }).code === "CLAUDE_SDK_CAN_USE_TOOL_SHADOWED") return;
    shown?.store.emit({ kind: "notice", tone: "info", text: `Warning: ${warning.message}` });
  });

  /** Starts a conversation in `cwd`, a new one or `resume`d with its history on screen, with what you last picked. */
  const open = async (cwd: string, resume?: string, note?: string): Promise<Held> => {
    const store = new Store(cwd, homedir());
    const saved = await loadSettings();
    // The stash is the folder's, and one conversation holds it, so it can't come back twice.
    const stash = fleet.getSnapshot().some((one) => one.cwd === cwd) ? null : await loadStash(cwd);
    if (stash) store.unstash(stash);
    if (saved.todos) store.todos = saved.todos;
    if (saved.notify) store.notifyMode = saved.notify;
    if (saved.usage) store.usageMode = saved.usage;
    if (saved.keepWarm !== undefined) store.keepWarm = saved.keepWarm;
    if (saved.agentSummaries !== undefined) store.agentSummaries = saved.agentSummaries;
    if (saved.remoteControl !== undefined) store.remoteControl = saved.remoteControl;
    if (saved.follow !== undefined) store.follow = saved.follow;
    store.window = window;
    store.keymap = keymap;
    store.prompts = prompts;
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
    started += 1;
    return fleet.add({ key: `astrocode-${started}`, store, session, cwd });
  };

  /** What a session started from the agents view runs with: what a new conversation here would. */
  const newSettings = async (): Promise<SessionSettings> => {
    const saved = await loadSettings();
    return { model: options.model ?? saved.model, effort: options.effort ?? saved.effort, mode: saved.mode };
  };

  let fullscreen = options.fullscreen ?? (await loadSettings()).fullscreen ?? false;
  /** Whether you've ever opened the agents view: until you have, the message box mentions ←. */
  let viewed = (await loadSettings()).agentsViewed ?? false;

  /**
   * The conversation on screen until it's left for the agents view or astrocode quits. /fullscreen
   * switches by starting the interface again in the other layout. The store and the session carry
   * on, so the conversation does too.
   */
  const showSession = async ({ store, session, cwd }: Held) => {
    const git = await gitInfo(cwd);
    // Read while the conversation draws: `claude agents` takes longer than the first frame should wait.
    const agentsHint = viewed ? Promise.resolve(false) : othersListed(session.knownId);
    for (;;) {
      let leaving = null as "layout" | "agents" | null;
      // Ink asks the terminal about the kitty keyboard protocol as it starts, before its input hooks
      // turn raw mode on. With the terminal still echoing, the answer would land on screen as
      // `^[[?0u`. In raw mode it waits in stdin, unechoed, for Ink to read.
      process.stdin.setRawMode(true);
      // Each layout gets its own screen, which needs kitty's images sent again.
      forgetSent();
      // In scrollback the mouse stays the terminal's, but for the transcript viewer, which turns it on.
      const mouse = new Mouse(process.stdin, process.stdout);
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
            fleet={fleet}
            backgroundSessions={background}
            agentsHint={agentsHint}
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
      if (fullscreen) mouse.start();
      await app.waitUntilExit();
      mouse.stop();
      if (leaving !== "layout") return leaving ?? "exit";
      fullscreen = !fullscreen;
      if (!fullscreen) redrawScrollback(store);
    }
  };

  /**
   * Moves a conversation to Claude Code's background service, which carries it on where `claude
   * agents` lists it, and gives its id there. Its Claude Code here stops, so only while it's idle.
   */
  const handOff = async (conversation: Held) => {
    const { store, session, cwd } = conversation;
    const state = store.getSnapshot();
    const id = session.knownId;
    session.close();
    fleet.remove(conversation);
    // A conversation with nothing said in it yet has nothing to carry on.
    if (!id || !state.items.some((item) => item.kind === "prompt")) return undefined;
    return moveToBackground(id, cwd, { model: state.model, effort: state.effort, mode: state.mode });
  };

  /**
   * As astrocode quits, moves its conversations but `except` to Claude Code's background service,
   * so they carry on as sessions `claude agents` dispatched would, and says where they went. Fails,
   * moving none, while one is working or waiting on you, which quitting would cut off.
   */
  const leaveAll = async (except?: Held) => {
    const leaving = fleet.getSnapshot().filter((one) => one !== except);
    const busy = leaving.filter((one) => liveState(one.store.getSnapshot(), one.store.shells.size) !== "idle");
    if (busy.length) {
      const names = (await Promise.all(busy.map(titleOf))).map((name) => `“${name}”`).join(", ");
      // The note line is one row, so what matters comes first.
      throw new Error(`Can't quit while Claude works or waits on you in ${names}. Ctrl+X stops one.`);
    }
    return (await moveAll(leaving, handOff)).join("\n") || undefined;
  };

  /** Stops one of astrocode's conversations. It's saved, so /resume picks it up again. */
  const stop = (conversation: Held) => {
    conversation.store.stopShells();
    conversation.session.close();
    fleet.remove(conversation);
    if (shown === conversation) shown = null;
  };

  let farewell: string | undefined;

  /** The agents view, until it's left for one of astrocode's conversations or out of astrocode. */
  const showAgents = async (notice?: string): Promise<Leaving> => {
    const settings = await newSettings();
    const git = shown ? await gitInfo(shown.cwd) : null;
    if (!viewed) {
      viewed = true;
      // Should it not save, the hint only shows again next time.
      remember({ agentsViewed: true }).catch(() => {});
    }
    let leaving: Leaving = { kind: "exit" };
    process.stdin.setRawMode(true);
    const app = render(
      <AgentsView
        fleet={fleet}
        here={shown?.key}
        cwd={shown?.cwd ?? options.cwd}
        home={homedir()}
        settings={settings}
        notice={notice}
        git={git}
        onShow={(key) => leave({ kind: "show", key })}
        onOpen={async (agent) => {
          if (!agent.sessionId) throw new Error(`Claude Code hasn't said which conversation ${agent.name} is.`);
          if (!existsSync(agent.cwd)) throw new Error(`${agent.name}'s folder, ${agent.cwd}, is gone.`);
          // Its Claude Code holds the conversation while it runs, even idle; stopped, it can be resumed here.
          if (agent.alive) await stopAgent(agent.id);
          leave({ kind: "show", key: (await open(agent.cwd, agent.sessionId)).key });
        }}
        onStart={async (task, cwd) => {
          checkFolder(cwd);
          const conversation = await open(cwd);
          void prompts.add(task, cwd, conversation.session.knownId);
          conversation.session.send(task);
          return conversation.key;
        }}
        onStop={(key) => {
          const conversation = fleet.get(key);
          if (conversation) stop(conversation);
        }}
        onExit={async () => {
          farewell = await leaveAll();
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

  if (!options.agents) shown = await open(options.cwd, resume, note);
  let screen: "session" | "agents" = shown ? "session" : "agents";
  /** Why astrocode didn't quit, for the agents view to say. */
  let notice: string | undefined;
  for (;;) {
    if (screen === "session" && shown) {
      if ((await showSession(shown)) === "exit") {
        // The conversation astrocode quits from ends with it, as `claude` does; the rest carry on.
        try {
          farewell = await leaveAll(shown);
          break;
        } catch (error) {
          notice = error instanceof Error ? error.message : String(error);
        }
      }
      screen = "agents";
      continue;
    }
    const leaving = await showAgents(notice);
    notice = undefined;
    if (leaving.kind === "exit") break;
    shown = fleet.get(leaving.key) ?? null;
    // The agents view had its own screen. Scrollback is written again, the conversation and all, on a clean one.
    if (shown && !fullscreen) redrawScrollback(shown.store);
    screen = "session";
  }

  // What's still running here is the conversation astrocode quit from, if any.
  const last = fleet.getSnapshot().at(0);
  for (const one of fleet.getSnapshot()) one.session.close();
  window.stop();
  await Promise.all([settingsSaved(), stashSaved(), prompts.written(), canvas.close()]);
  if (farewell) console.log(`\n${farewell}`);
  if (last?.session.id) console.log(`\nResume this conversation with: astrocode --resume ${last.session.id}`);
  process.exit(0);
}

/** Starts the scrollback over on a clean screen, for the conversation to be written into it again. */
function redrawScrollback(store: Store) {
  store.redraw((data) => process.stdout.write(data));
}
