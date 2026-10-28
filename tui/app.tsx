// The terminal front end, in one of two layouts. By default finished entries are written once into
// the terminal's own scrollback (Ink's <Static>), like `claude` does, and only the live part below
// them is redrawn. In full screen the conversation scrolls in a viewport of its own, with the mouse.
import type { EffortLevel, PermissionMode, RewindFilesResult } from "@anthropic-ai/claude-agent-sdk";
import { Box, Static, useApp, useStdout, useWindowSize } from "ink";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EFFORTS, isEffort, MODES, type CommandInfo, type ImageAttachment } from "../src/events";
import { historyEvents, loadHistory, savedSessions, sessionTitle, shellMessages, type SavedSession } from "../src/history";
import { addMemory, memoryFiles, type MemoryFile } from "../src/memory";
import type { AgentSession, Sending } from "../src/session";
import { remember, settingsPath, type NotifyMode, type Remembered, type TodoMode, type UsageMode } from "../src/settings";
import { runShell } from "../src/shell";
import { saveStash } from "../src/stash";
import { ago, canStopThinking, currentModel, duration } from "../src/view/format";
import { isCurrent, steps, titleWorthy } from "../src/view/steps";
import { askedBy } from "../src/view/permissions";
import { findRunning, runningKeyOf, runningList, type Running } from "../src/view/runs";
import type { Item, State } from "../src/view/state";
import { todoList } from "../src/view/todos";
import { plural, shortPath, toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { Activity } from "./activity";
import { AsidePanel } from "./aside";
import { useAttention } from "./attention";
import { useKeepWarm } from "./cache";
import { Banner } from "./banner";
import { StatusPanel } from "./claude-status";
import { copy } from "./clipboard";
import { ConfigMenu, type ConfigValues } from "./config";
import { DecisionPrompt } from "./decision";
import { ElicitationPrompt } from "./elicitation";
import { EFFORT_NOTES, effortsOf, ULTRACODE_NOTE } from "./effort";
import { editFile, editText } from "./editor";
import { FindBar, type Find } from "./find";
import { HooksPanel } from "./hooks";
import { ItemView, LiveView, opensByDefault, StepView } from "./entries";
import { gitInfo, type GitInfo } from "./git";
import { mentionedImages } from "./images";
import { keyFor, keyLabel } from "./keys";
import { galleryOf, linkedBy, pageFile } from "./figure";
import { Lightbox } from "./lightbox";
import { copiedBy, openFile, openLink } from "./links";
import type { Outcome } from "./manager";
import { ANSI } from "./markdown";
import { fit } from "./markdown-view";
import { McpPanel } from "./mcp";
import { MemoryPanel } from "./memory";
import { ModelPicker } from "./model-picker";
import { MouseContext } from "./mouse";
import { Picker, type PickerItem } from "./picker";
import { drawsImages, pictureRows, resendPictures } from "./pictures";
import { PermissionsPanel } from "./permissions";
import { PluginManager } from "./plugins";
import { Prompt } from "./prompt";
import { QuestionPrompt } from "./question";
import { QueuedMessages } from "./queued";
import { RemotePanel } from "./remote";
import { GUTTER } from "./rail";
import { SandboxPanel } from "./sandbox";
import { Screen } from "./screen";
import { arrange, stepOpens, type Entry } from "./arrange";
import { SessionPreview } from "./session-preview";
import { SkillsPanel } from "./skills";
import { StatusBar } from "./status";
import type { Store } from "./store";
import { RUNNING_STATUS, TaskView } from "./tasks";
import { PinnedTodos, STATUS } from "./tool-row";

type Overlay =
  /** The model and its effort, as Alt+P opens it. */
  | { kind: "model" }
  | { kind: "effort" }
  /** astrocode's settings, as they were when /config opened. */
  | { kind: "config"; initial: ConfigValues }
  | { kind: "resume"; sessions: SavedSession[] | null }
  | { kind: "output" }
  | { kind: "plugins" }
  /** Your earlier messages, to go back to. */
  | { kind: "rewind" }
  /** What to put back for the message picked, once Claude Code has said what the files would change. */
  | { kind: "rewind-how"; uuid: string; text: string; files: RewindFilesResult | null }
  /** What runs alongside the conversation, and one of them opened, by its key in `runningList()`. */
  | { kind: "tasks" }
  | { kind: "task"; key: string }
  /** Where a note written with `#` goes. */
  | { kind: "note"; note: string; files: MemoryFile[] | null }
  /** Claude Code's own dialogs, drawn here. */
  | { kind: "mcp" }
  | { kind: "permissions" }
  | { kind: "memory" }
  | { kind: "hooks" }
  | { kind: "skills" }
  | { kind: "status" }
  | { kind: "sandbox" }
  /** The conversation as text, once Claude Code has sent it, to save or copy. */
  | { kind: "export"; conversation: { text: string; filename: string } | null }
  | { kind: "output-style"; styles: { styles: string[]; current: string } | null }
  /** A question on the side, asked with /btw. */
  | { kind: "btw"; question: string }
  /** Remote Control's link, its QR code and how it's doing. */
  | { kind: "remote" }
  /** Finding text in full screen's transcript. */
  | { kind: "find" }
  /** The conversation's pictures, as large as they go, opened on one of them. */
  | { kind: "picture"; image: ImageAttachment }
  | null;

/** Why fast mode can't be on, by Claude Code's reason. */
const FAST_BLOCKED: Partial<Record<NonNullable<NonNullable<State["fast"]>["reason"]>, string>> = {
  free: "it needs a paid plan.",
  preference: "it's turned off in your Claude Code settings.",
  extra_usage_disabled: "it runs on extra usage, which is off for this account.",
  network_error: "Claude Code couldn't check whether it's available. Try again in a moment.",
  not_first_party: "it needs Anthropic's API directly, not a cloud provider.",
  disabled_by_env: "CLAUDE_CODE_DISABLE_FAST_MODE is set.",
  model_not_allowed: "your organization doesn't allow its model.",
  unknown: "Claude Code didn't say why.",
};

const ULTRACODE_UNAVAILABLE = "Ultracode isn't available here: it needs dynamic workflows turned on in Claude Code (/config there) and a model that takes xhigh effort.";

/** How long the status bar says what was copied. */
const TOAST_MS = 2000;
/** As much of a `!` command's output as goes to Claude, its end, as Claude Code cuts its own shell output. */
const MAX_SHELL_OUTPUT = 30_000;

const HELP = [
  "Enter sends. Shift+Enter, Alt+Enter, Ctrl+J, or \\ then Enter starts a new line. Type / for commands; partway through a message, choosing one writes it in.",
  "Esc stops Claude. Esc twice on an empty box rewinds to an earlier message (/rewind).",
  "A message sent while Claude works waits above the box until Claude takes it; until then, ↑ in an empty box takes it back to edit.",
  "Shift+Tab changes the permission mode. Alt+P switches the model and its effort, Alt+T turns thinking off and on, Alt+O turns fast mode on and off. ↑ and ↓ recall earlier messages; Ctrl+R searches them.",
  "ultrathink in a message asks for deeper reasoning that turn, and ultracode for a workflow of agents; Alt+W keeps the message's ultracode from starting one. /effort ultracode has Claude run a workflow on every task, for this session.",
  "Ctrl+S puts the message aside, and it stays there until Ctrl+S brings it back. Pressed with a message in the box, the two trade places.",
  "Ctrl+_ undoes. Ctrl+K, Ctrl+U, Ctrl+W and Alt+D cut, Ctrl+Y puts back what they cut. Alt+B and Alt+F move by words. Ctrl+L clears the box.",
  "! runs a command in your shell. Its output streams in as it runs, you can keep talking meanwhile, and Claude sees it once it ends. # adds a note to a CLAUDE.md.",
  "Ctrl+V attaches the clipboard's image; a pasted or dropped image file attaches too. Ctrl+G or Ctrl+X Ctrl+E edits the message in $EDITOR.",
  "Ctrl+B moves a command or subagent Claude is waiting on to the background. /tasks lists what runs there and your ! commands: open one to watch it (a subagent shows its transcript, a workflow its phases), and x stops it. Esc stops Claude's turn but not what runs in the background; Ctrl+X Ctrl+K twice stops it all. Ctrl+T shows or hides the to-dos.",
  "Ctrl+Enter or Ctrl+X Ctrl+S sends now, stopping what Claude is doing; Ctrl+X Enter sends it to wait for the end of Claude's turn. Ctrl+Z suspends astrocode until the shell's fg.",
  "Ctrl+O opens a tool call's whole output. Ctrl+C clears the box, stops Claude, or exits when pressed twice.",
  "/clear starts over, /resume picks up a saved session, /model switches models, /effort sets how hard Claude thinks, /exit quits.",
  "/plugins installs, turns on or off, and removes plugins. @ followed by a path attaches a file or folder.",
  "/mcp, /permissions, /memory, /skills, /hooks, /sandbox and /status show Claude Code's MCP servers, permission rules, memory, skills, hooks, sandbox and status, and change what can be changed.",
  "/btw asks a question on the side while Claude works. /copy copies Claude's last reply, /export saves or copies the conversation, and /output-style picks how Claude writes.",
  "/pictures shows the conversation's pictures as large as they go: ← and → flip through them, o opens one in your image viewer, b opens a mockup in your browser.",
  "/remote-control (or /rc) lets you carry on with this session from claude.ai or the Claude app: it shows the session's link and a QR code to scan with your phone. ⇄ remote in the status bar says it's on, and /remote-control off turns it off.",
  "/config changes the model, effort, thinking, mode, to-do list, full screen, notifications, when plan usage shows, keeping the cache warm, agent progress and Remote Control, and keeps them for next time, except plan mode, max effort and ultracode. /fullscreen switches layouts.",
  "The status bar's cache says how long the prompt cache stays warm; past that, your next message re-caches the conversation. With keep warm on (/config, or click it in full screen) it shows ↻, and astrocode refreshes the cache before it expires while you're away, for up to 8 hours.",
].join("\n");

const FULLSCREEN_HELP = [
  "Full screen: the wheel, PgUp and PgDn scroll; Ctrl+Home and Ctrl+End go to the top and the end.",
  "Ctrl+F finds text in the conversation: Enter or ↑ goes to the match before, ↓ to the one after. Alt+↑ and Alt+↓ jump between your messages, Alt+Shift+↑ and Alt+Shift+↓ between tool calls and commands.",
  "Drag to copy, double-click to copy a word, triple-click to copy a line.",
  "Click a tool call or a command to open it (a running one shows its live output), a step to open its tool calls, an option to choose it, the mode, the model or the effort to change it.",
  "Click copy on a code block to copy it, and a turn's closing line to list the files it changed and the commands it ran.",
  "Click a picture to enlarge it, with ← and → to flip through the others.",
  "Hold Shift to select with the terminal's own selection instead.",
].join("\n");

type Props = {
  store: Store;
  session: AgentSession;
  branch?: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

export function App({ store, session, branch, fullscreen, onToggleFullscreen }: Props) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { exit, suspendTerminal } = useApp();
  const mouse = useContext(MouseContext);
  const { write } = useStdout();
  const { columns, rows } = useWindowSize();
  const width = Math.max(24, columns);
  const [exitArmed, setExitArmed] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // The mode last asked for, until Claude Code confirms it, so quick Shift+Tabs keep stepping.
  const [modeWanted, setModeWanted] = useState<PermissionMode | null>(null);
  const wanted = useRef<PermissionMode | null>(null);
  const turns = state.items.filter((item) => item.kind === "turn").length;
  const git = useGit(state.cwd, turns);
  // Full screen's own: entries a click opened or closed, away from how they start, one to scroll to, and what was copied.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ key: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** What Ctrl+F finds, kept when its bar closes so it opens again on the same words, and how many matches there are. */
  const [find, setFind] = useState<Find>({ query: "", back: 0 });
  const [matchCount, setMatchCount] = useState(0);
  /** Text for the message box, such as a rewound message or one edited in $EDITOR. */
  const [prefill, setPrefill] = useState<{ text: string } | null>(null);
  /** The pinned to-dos: shown while some are left (auto), or as Ctrl+T or /config last set. */
  const [todoMode, setTodoState] = useState(store.todos);
  const setTodoMode = (mode: TodoMode) => {
    store.todos = mode;
    setTodoState(mode);
  };
  /** How a turn's end or a prompt is announced while you're elsewhere, as /config set it. */
  const [notifyMode, setNotifyState] = useState(store.notifyMode);
  const setNotifyMode = (mode: NotifyMode) => {
    store.notifyMode = mode;
    setNotifyState(mode);
  };
  /** When the status bar shows the plan's usage, as /config set it. */
  const [usageMode, setUsageState] = useState(store.usageMode);
  const setUsageMode = (mode: UsageMode) => {
    store.usageMode = mode;
    setUsageState(mode);
  };
  /** Whether the prompt cache is kept warm while you're away, as /config or a click on the status bar set it. */
  const [keepWarm, setKeepWarmState] = useState(store.keepWarm);
  const setKeepWarm = (on: boolean) => {
    store.keepWarm = on;
    setKeepWarmState(on);
  };
  const title = useSessionTitle(session.knownId, state.cwd, turns, store.epoch);
  useAttention({ state, window: store.window, notify: notifyMode, title, git });
  /** The message put aside with Ctrl+S, kept in the store so it outlives a switch of layouts. */
  const [stash, setStash] = useState(store.stash);
  /** Ctrl+X Ctrl+K pressed once: pressed again soon, it stops everything running. */
  const [stopArmed, setStopArmed] = useState(false);
  const editing = useRef(false);

  useEffect(() => {
    if (!exitArmed) return;
    const timer = setTimeout(() => setExitArmed(false), 2000);
    return () => clearTimeout(timer);
  }, [exitArmed]);

  useEffect(() => {
    if (!stopArmed) return;
    const timer = setTimeout(() => setStopArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [stopArmed]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (wanted.current === state.mode) {
      wanted.current = null;
      setModeWanted(null);
    }
  }, [state.mode]);

  useEffect(() => {
    setExpanded(new Set());
    setReveal(null);
  }, [store.epoch]);

  // An Agent call waits for you while its subagent, or one under it, does.
  const waiting = new Set([
    ...state.pending.map((request) => request.id),
    ...state.questions.map((request) => request.id),
    ...state.items.flatMap((item) => (item.kind === "tool" && item.call.subagent?.waitingOn ? [item.call.id] : [])),
  ]);
  const question = state.questions[0];
  const elicitation = state.elicitations[0];
  const request = state.pending[0];
  // In scrollback, what's above the message box and status bar, which take about six rows.
  const view = { cwd: state.cwd, home: state.home, width, pictureRows: pictureRows(rows - 6) };

  const report = (error: unknown) =>
    store.emit({ kind: "notice", tone: "error", text: error instanceof Error ? error.message : String(error) });
  const notice = (tone: "info" | "error", text: string) => store.emit({ kind: "notice", tone, text });

  const running = runningList(state);
  const runningNow = running.filter((one) => one.status === "running").length;
  const todos = todoList(state.items);
  const todosLeft = todos?.some((todo) => todo.status !== "completed") ?? false;
  const showTodos = Boolean(todos?.length) && (todoMode === "on" || (todoMode === "auto" && todosLeft));

  useKeepWarm({
    on: keepWarm,
    state,
    session,
    emit: store.emit,
    notice,
    turnOff: () => {
      setKeepWarm(false);
      keep({ keepWarm: false });
    },
  });

  /** A click on the cache in the status bar. */
  const toggleKeepWarm = () => {
    const on = !keepWarm;
    setKeepWarm(on);
    keep({ keepWarm: on });
    setToast(on ? "Keeping the cache warm" : "Not keeping the cache warm");
  };

  /** The model, effort, mode and layout you pick carry over to your next session. */
  const keep = (choice: Remembered) =>
    void remember(choice).catch((error: unknown) =>
      report(`Couldn't remember that for next time: ${error instanceof Error ? error.message : String(error)}`),
    );
  const pickModel = (model: string) => void session.setModel(model).then(() => keep({ model }), report);
  const pickEffort = (effort: EffortLevel) => void session.setEffort(effort).then(() => keep({ effort }), report);
  /** Ultracode, for this session only: it isn't remembered, as Claude Code never keeps it either. */
  const pickUltracode = (on: boolean) => {
    if (on && state.ultracodeAvailable === false) return notice("info", ULTRACODE_UNAVAILABLE);
    session.setUltracode(on).then((active) => {
      if (on && !active) notice("info", ULTRACODE_UNAVAILABLE);
      else setToast(active ? "Ultracode on" : "Ultracode off");
    }, report);
  };
  /**
   * What /config changed, put into effect and then written to the settings file in one save. The
   * model goes first, since the effort levels it takes depend on it, and the layout last, since
   * switching starts the interface over.
   */
  const applyConfig = async (changes: Partial<ConfigValues>) => {
    const kept: Remembered = {};
    const attempt = async (change: () => Promise<void>, onDone: () => void) => {
      try {
        await change();
        onDone();
      } catch (error) {
        report(error);
      }
    };
    const { model, effort, ultracode, thinking, mode, todos, notify, usage, keepWarm: warm, agentSummaries, remoteControl, fullscreen: layout } = changes;
    if (model) await attempt(() => session.setModel(model), () => (kept.model = model));
    if (effort) await attempt(() => session.setEffort(effort), () => (kept.effort = effort));
    // After the effort, since a level of its own turns ultracode off. For this session only.
    if (ultracode !== undefined) {
      await attempt(
        async () => {
          const on = await session.setUltracode(ultracode);
          if (ultracode && !on) notice("info", ULTRACODE_UNAVAILABLE);
        },
        () => {},
      );
    }
    if (thinking !== undefined) await attempt(() => session.setThinking(thinking), () => (kept.thinking = thinking));
    if (mode) await attempt(() => session.setMode(mode), () => (kept.mode = mode));
    if (todos) {
      setTodoMode(todos);
      kept.todos = todos;
    }
    if (notify) {
      setNotifyMode(notify);
      kept.notify = notify;
    }
    if (usage) {
      setUsageMode(usage);
      kept.usage = usage;
    }
    if (warm !== undefined) {
      setKeepWarm(warm);
      kept.keepWarm = warm;
    }
    if (agentSummaries !== undefined) {
      store.agentSummaries = agentSummaries;
      session.setAgentSummaries(agentSummaries);
      kept.agentSummaries = agentSummaries;
    }
    // Remembered for every session, and put into effect for this one.
    if (remoteControl !== undefined) {
      store.remoteControl = remoteControl;
      kept.remoteControl = remoteControl;
      if (remoteControl !== Boolean(state.remote)) await attempt(() => session.setRemoteControl(remoteControl), () => {});
    }
    if (layout !== undefined) kept.fullscreen = layout;
    if (!Object.keys(kept).length) return;
    try {
      await remember(kept);
      const lasting = Object.keys(kept).some((key) => !(key === "effort" && kept.effort === "max") && !(key === "mode" && kept.mode === "plan"));
      if (lasting) notice("info", `Saved to ${shortPath(settingsPath(), state.cwd, state.home)}.`);
    } catch (error) {
      report(`Couldn't save the settings: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (layout !== undefined && layout !== fullscreen) onToggleFullscreen();
  };

  /** chat:increaseEffort and chat:decreaseEffort: the next level up or down that the model takes. */
  const stepEffort = (by: -1 | 1) => {
    const levels = effortsOf(currentModel(state));
    if (!levels.length) return notice("info", "This model doesn't take an effort level.");
    // With no level set, Claude Code's default is taken as high, the usual default.
    const at = state.effort ? levels.indexOf(state.effort) : levels.indexOf("high");
    const next = levels[Math.max(0, Math.min(levels.length - 1, (at === -1 ? Math.floor(levels.length / 2) : at) + by))];
    if (!next || next === state.effort) return;
    session.setEffort(next).then(() => {
      setToast(`${next} effort`);
      keep({ effort: next });
    }, report);
  };

  /**
   * chat:fastMode, Alt+O: Opus with faster output, for this session, as `/fast` does. Claude Code
   * says what keeps it off, if anything; an SDK host's first request is what opts it in.
   */
  const toggleFast = () => {
    const fast = state.fast;
    const on = fast?.state === "on" || fast?.state === "cooldown";
    const blocked = !on && fast?.reason && fast.reason !== "sdk_opt_in_required" && fast.reason !== "pending" ? FAST_BLOCKED[fast.reason] : undefined;
    if (blocked) return notice("info", `Fast mode isn't available: ${blocked}`);
    session.setFastMode(!on).then(() => setToast(on ? "Fast mode off" : "Fast mode on, with Opus"), report);
  };

  /** Alt+T. Remembered like the model and effort, and shown in the status bar while it's off. */
  const toggleThinking = () => {
    if (!canStopThinking(state)) {
      return notice("info", `${currentModel(state)?.name ?? "This model"} always thinks, and effort sets how much (Alt+P). Older models can turn thinking off.`);
    }
    const on = state.thinking === false;
    session.setThinking(on).then(() => {
      setToast(on ? "Thinking on" : "Thinking off");
      keep({ thinking: on });
    }, report);
  };

  /**
   * chat:killAgents. Pressed once it asks, as in Claude Code; pressed again, it stops everything
   * running. Each says how it ended: your commands on their cards, Claude Code's tasks in notices.
   */
  const stopAllTasks = () => {
    if (!runningNow) return notice("info", "Nothing is running alongside the conversation.");
    if (!stopArmed) return setStopArmed(true);
    setStopArmed(false);
    store.stopShells();
    const tasks = running.flatMap((one) => (one.status === "running" && one.taskId ? [one.taskId] : []));
    void Promise.all(tasks.map((id) => session.stopTask(id))).catch(report);
  };

  /** /tasks and the status bar: what's running, or the one thing running, opened. */
  const openTasks = () => {
    const now = running.filter((one) => one.status === "running");
    setOverlay(now.length === 1 && now[0] ? { kind: "task", key: now[0].key } : { kind: "tasks" });
  };

  /** Stops one thing running, from its view: a command of yours, or a task of Claude Code's. */
  const stopRunning = (entry: Running) => {
    if (entry.shellId) store.shells.get(entry.shellId)?.abort();
    else if (entry.taskId) session.stopTask(entry.taskId).catch(report);
  };

  /** Moves a subagent Claude waits on to the background, from its view, as Ctrl+B does for them all. */
  const backgroundRunning = (entry: Running) => {
    if (!entry.foreground) return;
    session
      .background([entry.foreground])
      .then((moved) => {
        if (!moved) notice("info", "That subagent can't go to the background now.");
      })
      .catch(report);
  };

  /**
   * Remote Control, for this session: on, it opens its panel, with the link to the session and a
   * QR code of it. /config's switch is the one remembered for every session.
   */
  const setRemote = (on: boolean) => {
    if (on) setOverlay({ kind: "remote" });
    session.setRemoteControl(on).then(() => {
      if (!on) setToast("Remote Control off");
    }, report);
  };

  /** /remote-control: on or off as asked; with nothing asked, on if it's off, and its panel either way. */
  const openRemote = (argument: string) => {
    const asked = argument.toLowerCase();
    if (asked === "off") return state.remote ? setRemote(false) : notice("info", "Remote Control is off already.");
    if (asked && asked !== "on") return notice("error", "/remote-control takes on or off.");
    if (state.remote) return setOverlay({ kind: "remote" });
    setRemote(true);
  };

  /** Full screen or scrollback, kept for next time even when it's the layout already showing. */
  const pickLayout = (next: boolean) => {
    keep({ fullscreen: next });
    if (next !== fullscreen) onToggleFullscreen();
  };

  /**
   * A new screen for a new or resumed session, scrollback included, as `claude` does. Full screen
   * has no scrollback to clear. Commands of yours still running belong to the conversation left,
   * and stop with it, as Claude Code's background tasks do.
   */
  const startOver = () => {
    if (!fullscreen) write("\x1b[2J\x1b[3J\x1b[H");
    const stopped = store.stopShells();
    store.reset();
    if (stopped) notice("info", `Stopped ${stopped === 1 ? "a command of yours that was" : `${stopped} commands of yours that were`} still running.`);
  };

  const resumeSession = (id: string, title?: string) => {
    startOver();
    session.resume(id);
    loadHistory(id, state.cwd)
      .then((events) => store.emit({ kind: "history", events, title }))
      .catch(report);
  };

  const openResume = () => {
    setOverlay({ kind: "resume", sessions: null });
    savedSessions(state.cwd)
      .then((sessions) =>
        setOverlay((open) => (open?.kind === "resume" ? { kind: "resume", sessions: sessions.filter((one) => one.id !== session.id) } : open)),
      )
      .catch((error: unknown) => {
        setOverlay(null);
        report(error);
      });
  };

  /**
   * Full screen opens a tool call's or a command's output under its row and scrolls there;
   * scrollback prints it at the end.
   */
  const showOutput = (id: string) => {
    const index = state.tools[id];
    const item = index === undefined ? state.items.find((one) => one.kind === "shell" && one.id === id) : state.items[index];
    if (!fullscreen || !item) return store.emit({ kind: "output", id });
    // Open it, whichever way it starts, and the step it's in.
    const step = [...steps(state.items).values()].find((one) => one.members.includes(item));
    setExpanded((open) => {
      const next = new Set(open);
      if (opensByDefault(item)) next.delete(item.key);
      else next.add(item.key);
      if (step) {
        if (stepOpens(state, step, waiting)) next.delete(step.key);
        else next.add(step.key);
      }
      return next;
    });
    setReveal({ key: item.key });
  };

  /**
   * A click on an entry in full screen opens or closes it in place. Something still running, or
   * that ran in the background, opens its view instead.
   */
  const toggleTool = (key: string) => {
    const item = state.items.find((one) => one.key === key);
    const task = item ? runningKeyOf(item, state) : undefined;
    if (task) {
      setOverlay({ kind: "task", key: task });
      return false;
    }
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
    return true;
  };

  const copySelection = (text: string) => {
    copy(text);
    const lines = text.split("\n").length;
    setToast(lines > 1 ? `Copied ${plural(lines, "line")}` : `Copied ${plural([...text].length, "character")}`);
  };

  /** A file astrocode wrote, such as a picture or a mockup, opened in the desktop's viewer or browser. */
  const openWritten = (path: string) =>
    void openFile(path).then((opened) => {
      if (opened) setToast(path.endsWith(".html") ? "Opening the page in your browser" : "Opening the picture");
      else notice("error", `Couldn't open ${path}: there's no xdg-open here, or no desktop for it to open on.`);
    });

  /** The lightbox, on `image`, or on the newest picture. */
  const openPictures = (image?: ImageAttachment) => {
    if (!drawsImages) return notice("info", "astrocode draws pictures only in kitty, outside tmux and screen.");
    const newest = image ?? galleryOf(state.items).at(-1)?.image;
    if (!newest) return notice("info", "There are no pictures in this conversation yet.");
    setOverlay({ kind: "picture", image: newest });
  };

  /** A link clicked in full screen, opened in the desktop's browser, a code block's `copy`, or a figure's link. */
  const openAddress = (url: string) => {
    const figure = linkedBy(url);
    if (figure) return "image" in figure ? openPictures(figure.image) : openWritten(pageFile(figure.html));
    const code = copiedBy(url);
    if (code !== undefined) {
      copy(code);
      const lines = code.split("\n").length;
      return setToast(`Copied ${plural(lines, "line")} of code`);
    }
    void openLink(url).then((opened) => {
      if (opened) setToast(`Opening ${url.replace(/^https?:\/\/([^/?#]+).*$/is, "$1")}`);
      else notice("error", `Couldn't open ${url}: there's no xdg-open here, or no desktop for it to open on.`);
    });
  };

  /** A message, with the images it still mentions. */
  const send = (text: string, how: Sending = {}) => session.send(text, store.images, how);

  /**
   * Runs a command with `!`. Its output streams into its card while you carry on, and once it ends
   * it goes into the conversation with what it printed, as Claude Code adds its own.
   */
  const runCommand = (command: string) => {
    if (!command) return;
    const id = randomUUID();
    const controller = new AbortController();
    const epoch = store.epoch;
    store.shells.set(id, controller);
    store.emit({ kind: "shell", id, command, at: Date.now() });
    const onOutput = (output: string) => store.emit({ kind: "shell-output", id, output, at: Date.now() });
    void runShell(command, { cwd: state.cwd, cols: width - GUTTER - 2, signal: controller.signal, onOutput }).then((result) => {
      store.shells.delete(id);
      // After /clear or a resume, the conversation it belonged to is gone.
      if (store.epoch !== epoch) return;
      store.emit({ kind: "shell-done", id, stdout: result.output, stderr: "", code: result.code, stopped: result.stopped, at: Date.now() });
      const said = result.output.replace(ANSI, "").slice(-MAX_SHELL_OUTPUT);
      for (const message of shellMessages(command, said || "(Bash completed with no output)", result.stopped ? "Stopped by the user." : "")) session.note(message);
    });
  };

  /** Asks where a note written with `#` goes. */
  const openMemory = (note: string) => {
    if (!note) return;
    setOverlay({ kind: "note", note, files: null });
    memoryFiles(state.cwd).then(
      (files) => setOverlay((open) => (open?.kind === "note" ? { ...open, files } : open)),
      (error: unknown) => {
        setOverlay(null);
        report(error);
      },
    );
  };

  const saveMemory = (path: string, note: string) =>
    void addMemory(path, note).then(() => {
      notice("info", `Added to ${shortPath(path, state.cwd, state.home)}.`);
      // Claude Code reads CLAUDE.md as a session starts, so this session hears of it from here.
      session.note(`<user-memory-input>${note}</user-memory-input>`);
    }, report);

  const openRewind = () => {
    if (state.busy) return notice("info", "Claude is working. Press Esc to stop it, then rewind.");
    if (!state.items.some((item) => item.kind === "prompt" && item.uuid)) return notice("info", "There's no earlier message to go back to yet.");
    setOverlay({ kind: "rewind" });
  };

  /** Asks Claude Code what putting the files back would change, before asking what to put back. */
  const pickRewind = (uuid: string, text: string) => {
    setOverlay({ kind: "rewind-how", uuid, text, files: null });
    const show = (files: RewindFilesResult) => setOverlay((open) => (open?.kind === "rewind-how" && open.uuid === uuid ? { ...open, files } : open));
    session.rewindFiles(uuid, true).then(show, (error: unknown) => show({ canRewind: false, error: error instanceof Error ? error.message : String(error) }));
  };

  /**
   * Puts back the files, the conversation, or both, as they were when `uuid` was sent. `preview` is
   * the dry run's answer: only a dry run lists the files.
   */
  const rewind = async (uuid: string, text: string, how: "code" | "conversation" | "both", preview: RewindFilesResult) => {
    if (how !== "conversation") {
      const restored = await session.rewindFiles(uuid, false);
      if (!restored.canRewind) throw new Error(restored.error ?? "Claude Code couldn't put the files back.");
    }
    if (how !== "code") {
      const events = historyEvents(await session.rewindConversation(uuid));
      startOver();
      store.emit({ kind: "history", events, notice: "Went back to before your message, which is in the box to change or send again." });
      setPrefill({ text });
    }
    if (how !== "conversation") {
      const files = preview.filesChanged?.length ?? 0;
      notice("info", `Put ${plural(files, "file")} back as ${files === 1 ? "it was" : "they were"}.`);
    }
  };

  /** The terminal handed over to your editor until it quits. One editor at a time. */
  const handOver = async <T,>(edit: () => Promise<T>): Promise<T> => {
    if (editing.current) throw new Error("An editor is open already.");
    editing.current = true;
    mouse?.stop();
    store.window?.stop();
    const suspension = await suspendTerminal();
    try {
      return await edit();
    } finally {
      await suspension.resume();
      store.window?.start();
      mouse?.start();
      if (fullscreen) resendPictures();
      editing.current = false;
    }
  };

  /** Your message in $EDITOR. */
  const openEditor = (text: string) => {
    if (editing.current) return;
    handOver(() => editText(text)).then((edited) => setPrefill({ text: edited }), report);
  };

  const submit = (text: string, how: { now?: boolean; later?: boolean; ignoreUltracode?: boolean } = {}) => {
    const { now = false } = how;
    store.sent.push(text);
    if (text.startsWith("!")) return runCommand(text.slice(1).trim());
    if (text.startsWith("#")) return openMemory(text.slice(1).trim());
    const [command = "", ...rest] = text.trim().split(/\s+/);
    const argument = rest.join(" ");
    switch (command) {
      case "/exit":
      case "/quit":
        return exit();
      case "/clear":
      case "/new":
        startOver();
        session.reset();
        session.start();
        return;
      case "/help":
        return store.emit({ kind: "notice", tone: "info", text: fullscreen ? `${HELP}\n${FULLSCREEN_HELP}` : HELP });
      case "/resume":
        return argument ? resumeSession(argument) : openResume();
      case "/model":
        if (argument) return pickModel(argument);
        return setOverlay({ kind: "model" });
      case "/effort":
        if (!argument) return setOverlay({ kind: "effort" });
        if (argument === "ultracode") return pickUltracode(true);
        if (!isEffort(argument)) return store.emit({ kind: "notice", tone: "error", text: `Effort is one of ${EFFORTS.join(", ")}, or ultracode.` });
        return pickEffort(argument);
      case "/output":
        return setOverlay({ kind: "output" });
      case "/pictures":
        return openPictures();
      case "/plugins":
      case "/plugin":
        return setOverlay({ kind: "plugins" });
      case "/fullscreen":
        return pickLayout(!fullscreen);
      case "/rewind":
        return openRewind();
      case "/tasks":
        return openTasks();
      case "/config": {
        if (!rest.length) {
          return setOverlay({
            kind: "config",
            initial: {
              model: state.model,
              effort: state.effort,
              ultracode: state.ultracode,
              thinking: state.thinking ?? true,
              mode: wanted.current ?? state.mode,
              todos: todoMode,
              fullscreen,
              notify: notifyMode,
              usage: usageMode,
              keepWarm,
              agentSummaries: store.agentSummaries,
              remoteControl: store.remoteControl,
            },
          });
        }
        // fullscreen= is astrocode's own key; Claude Code gets the rest.
        const ours = rest.filter((pair) => /^fullscreen=/i.test(pair));
        const theirs = rest.filter((pair) => !ours.includes(pair));
        if (theirs.length) session.send(["/config", ...theirs].join(" "));
        const value = ours.at(-1)?.split("=")[1]?.toLowerCase();
        if (value === undefined) return;
        if (value !== "true" && value !== "false") {
          return store.emit({ kind: "notice", tone: "error", text: "fullscreen is true or false." });
        }
        return pickLayout(value === "true");
      }
      // Claude Code's dialogs, drawn here. With arguments, /mcp and /output-style go to Claude Code.
      case "/mcp":
        if (argument) break;
        return setOverlay({ kind: "mcp" });
      case "/permissions":
      case "/allowed-tools":
        return setOverlay({ kind: "permissions" });
      case "/memory":
        return setOverlay({ kind: "memory" });
      case "/hooks":
        return setOverlay({ kind: "hooks" });
      case "/skills":
        return setOverlay({ kind: "skills" });
      case "/status":
        return setOverlay({ kind: "status" });
      case "/sandbox":
        return setOverlay({ kind: "sandbox" });
      case "/output-style":
        if (argument) break;
        return openOutputStyles();
      case "/export":
        return openExport(argument);
      case "/copy":
        return copyReply(argument);
      case "/remote-control":
      case "/rc":
        return openRemote(argument);
      case "/btw":
        if (!argument) return notice("info", "Ask with /btw and your question. Claude answers on the side, without stopping or adding to the conversation.");
        return setOverlay({ kind: "btw", question: argument });
      default:
        break;
    }
    // Sent now, Claude stops what it's doing and takes this instead of finishing first.
    // It waits for the stopped turn to close, so the turn's last words don't land after it.
    const sending: Sending = { ignoreUltracode: how.ignoreUltracode, later: how.later && state.busy ? true : undefined };
    if (now && state.busy) return void session.interrupt().then(idle).then(() => send(text, sending), report);
    send(text, sending);
  };

  const openOutputStyles = () => {
    setOverlay({ kind: "output-style", styles: null });
    session.outputStyles().then(
      (styles) => setOverlay((open) => (open?.kind === "output-style" ? { ...open, styles } : open)),
      (error: unknown) => {
        setOverlay(null);
        report(error);
      },
    );
  };

  /** /export: the conversation saved under `name`, or, with no name, a choice of saving it or copying it. */
  const openExport = (name: string) => {
    if (!state.items.some((item) => item.kind === "prompt")) return notice("info", "There's nothing to export yet.");
    if (!name) setOverlay({ kind: "export", conversation: null });
    session.exportConversation().then(
      (conversation) => {
        if (name) return saveExport(conversation.text, name);
        setOverlay((open) => (open?.kind === "export" ? { ...open, conversation } : open));
      },
      (error: unknown) => {
        if (!name) setOverlay(null);
        report(error);
      },
    );
  };

  /** Writes the conversation into a new file, `.txt` unless the name has its own ending. A file already there stays as it is. */
  const saveExport = (text: string, name: string) => {
    const path = resolve(state.cwd, /\.[^/.]+$/.test(name) ? name : `${name}.txt`);
    writeFile(path, text, { flag: "wx" }).then(
      () => notice("info", `Saved the conversation to ${shortPath(path, state.cwd, state.home)}.`),
      (error: unknown) =>
        notice(
          "error",
          (error as NodeJS.ErrnoException).code === "EEXIST"
            ? `${shortPath(path, state.cwd, state.home)} is there already. /export with another name saves it under that.`
            : `Couldn't save the conversation: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  };

  /** /copy: Claude's last reply, or with a number, the one that many back. */
  const copyReply = (argument: string) => {
    const back = argument ? Number(argument) : 1;
    if (!Number.isInteger(back) || back < 1) return notice("error", "/copy takes how far back to go: /copy 1 is Claude's last reply, /copy 2 the one before it.");
    const replies = state.items.filter((item) => item.kind === "text");
    const reply = replies[replies.length - back];
    if (!reply) return notice("info", replies.length ? `Claude has written ${replies.length === 1 ? "1 reply" : `${replies.length} replies`} so far.` : "Claude hasn't replied yet.");
    copy(reply.text);
    const lines = reply.text.split("\n").length;
    setToast(`Copied ${back === 1 ? "Claude's last reply" : `the reply ${back} back`}, ${plural(lines, "line")}`);
  };

  /** Resolves once Claude isn't working, or after a few seconds if Claude Code never says so. */
  const idle = () =>
    new Promise<void>((resolve) => {
      if (!store.getSnapshot().busy) return resolve();
      const done = () => {
        off();
        clearTimeout(timer);
        resolve();
      };
      const off = store.subscribe(() => {
        if (!store.getSnapshot().busy) done();
      });
      const timer = setTimeout(done, 5000);
    });

  /** Ctrl+Z, as in a shell: astrocode stops, and the shell's `fg` brings it back. */
  const suspend = () => {
    if (editing.current) return;
    editing.current = true;
    void (async () => {
      mouse?.stop();
      store.window?.stop();
      const suspension = await suspendTerminal();
      const started = Date.now();
      let resumed = false;
      try {
        await new Promise<void>((resolve) => {
          const done = () => {
            resumed = true;
            resolve();
          };
          process.once("SIGCONT", done);
          // A shell without job control can't bring astrocode back, so the kernel drops the
          // signal; then nothing stops and astrocode carries on after a moment.
          setTimeout(() => {
            process.off("SIGCONT", done);
            resolve();
          }, 500);
          process.kill(process.pid, "SIGTSTP");
        });
      } finally {
        await suspension.resume();
        store.window?.start();
        mouse?.start();
        if (fullscreen) resendPictures();
        editing.current = false;
      }
      if (!resumed && Date.now() - started < 1000) notice("info", "Ctrl+Z needs a shell with job control to come back to, and this terminal has none.");
    })().catch(report);
  };

  const cycleMode = () => {
    const current = wanted.current ?? state.mode;
    const at = MODES.findIndex((mode) => mode === current);
    const nextMode = MODES[(at + 1) % MODES.length] ?? "default";
    wanted.current = nextMode;
    setModeWanted(nextMode);
    session.setMode(nextMode).then(
      () => keep({ mode: nextMode }),
      (error: unknown) => {
        wanted.current = null;
        setModeWanted(null);
        report(error);
      },
    );
  };

  /** Ctrl+B. A command becomes movable only once it has run for a moment, so it may need asking again. */
  const background = () => {
    const running = state.items.flatMap((item) => (item.kind === "tool" && item.call.status === "running" ? [item.call.id] : []));
    if (!running.length) return;
    session.background(running).then((moved) => {
      if (!moved) notice("info", "Nothing Claude is waiting on can move to the background yet. Try Ctrl+B again in a moment.");
    }, report);
  };

  /**
   * ↑ in an empty box: the messages queued while Claude works come back into the box, joined, for
   * you to change and send again. One Claude has already started on stays where it is.
   */
  const editQueued = () => {
    const queued = state.queue;
    if (!queued.length) return false;
    void Promise.all(queued.map((one) => session.unqueue(one.uuid))).then((taken) => {
      const back = queued.filter((_, i) => taken[i]);
      if (back.length) setPrefill({ text: back.map((one) => one.text).join("\n\n") });
      if (back.length < queued.length) {
        notice("info", back.length ? "Claude had already started on some of them, so only the rest came back to edit." : "Claude has already started on that message, so it can't be edited now.");
      }
    }, report);
    return true;
  };

  /** Esc stops Claude. Your commands run on until you stop them yourself, from /tasks. */
  const interrupt = () => {
    if (state.busy) void session.interrupt().catch(report);
  };

  const onCtrlC = () => {
    if (state.busy) return void session.interrupt().catch(report);
    if (exitArmed) return exit();
    setExitArmed(true);
  };

  const close = () => setOverlay(null);
  // A picker's list gets shorter in a short terminal, so the message box and status bar still fit.
  const listRows = Math.max(3, Math.min(8, rows - 16));

  /** astrocode's own commands. Claude Code's come after them in the menu. */
  const commands: CommandInfo[] = [
    { name: "clear", description: "Start a new session on a clean screen", argumentHint: "" },
    { name: "resume", description: "Pick up a saved session from this folder", argumentHint: "" },
    { name: "model", description: "Switch the model and its effort (Alt+P)", argumentHint: "" },
    {
      name: "effort",
      description: "Set how hard Claude thinks, or turn on ultracode",
      argumentHint: state.ultracodeAvailable ? "[low|medium|high|xhigh|max|ultracode]" : "[low|medium|high|xhigh|max]",
    },
    { name: "output", description: "Open a tool call's whole output (Ctrl+O)", argumentHint: "" },
    { name: "pictures", description: "The conversation's pictures as large as they go, to flip through or open", argumentHint: "" },
    { name: "rewind", description: "Go back to an earlier message, its files, or both (Esc Esc)", argumentHint: "" },
    { name: "tasks", description: "What runs in the background and your ! commands, to watch or stop", argumentHint: "" },
    { name: "plugins", description: "Install, turn on or off, and remove plugins", argumentHint: "" },
    {
      name: "mcp",
      description: "MCP servers: how each is doing and its tools; reconnect, turn off or on, sign in or out",
      argumentHint: state.commands.find((command) => command.name === "mcp")?.argumentHint ?? "",
    },
    { name: "permissions", description: "What Claude may do without asking, must ask about, or may never do", argumentHint: "" },
    { name: "memory", description: "Open a CLAUDE.md or a saved memory in your editor; turn auto-memory on or off", argumentHint: "" },
    { name: "skills", description: "How much of each skill Claude sees, and what each costs in the system prompt", argumentHint: "" },
    { name: "hooks", description: "What runs when Claude Code does something, such as before a tool call", argumentHint: "" },
    { name: "sandbox", description: "Whether Claude's commands run fenced in, and how", argumentHint: "" },
    { name: "status", description: "Claude Code's version, session, account and model", argumentHint: "" },
    { name: "output-style", description: "Pick how Claude writes its replies", argumentHint: "[style]" },
    { name: "btw", description: "Ask a question on the side, without stopping Claude or adding it to the conversation", argumentHint: "<question>" },
    {
      name: "remote-control",
      description: state.remote ? "Remote Control's link and QR code, or turn it off" : "Continue this session from claude.ai or the Claude app on your phone",
      argumentHint: "[on|off]",
    },
    // In the menu too, so Enter on /rc runs it rather than a command with "rc" inside its name.
    { name: "rc", description: "Remote Control, as /remote-control", argumentHint: "[on|off]" },
    { name: "copy", description: "Copy Claude's last reply, or with a number, the one that many back", argumentHint: "[n]" },
    { name: "export", description: "Save the conversation to a file, or copy it", argumentHint: "[file]" },
    {
      name: "config",
      description: "astrocode's settings: model, effort, thinking, mode, to-dos, full screen, notifications, plan usage, keeping the cache warm, agent progress and Remote Control",
      argumentHint: "",
    },
    {
      name: "fullscreen",
      description: fullscreen ? "Go back to the terminal's own scrollback" : "Use the whole terminal, with the mouse",
      argumentHint: "",
    },
    { name: "help", description: "Keys and commands", argumentHint: "" },
    { name: "exit", description: "Quit astrocode", argumentHint: "" },
  ];

  const picker = () => {
    switch (overlay?.kind) {
      case "picture":
        return (
          <Lightbox
            gallery={galleryOf(state.items)}
            start={overlay.image}
            width={width}
            rows={rows}
            onClose={close}
            onOpen={openWritten}
            onCopy={(text) => {
              copy(text);
              setToast(`Copied ${plural(text.split("\n").length, "line")} of source`);
            }}
          />
        );
      case "model":
        return (
          <ModelPicker
            models={state.models}
            model={state.model}
            effort={state.effort}
            ultracode={state.ultracode}
            ultracodeAvailable={state.ultracodeAvailable === true}
            width={width}
            rows={listRows}
            onCancel={close}
            onPick={({ model, effort, ultracode }) => {
              close();
              // The model first: the effort levels it takes depend on it. Then the effort, which
              // turns ultracode off on its own.
              void (async () => {
                if (model) await session.setModel(model).then(() => keep({ model }));
                if (effort) await session.setEffort(effort).then(() => keep({ effort }));
                if (ultracode !== undefined && (ultracode || !effort)) await session.setUltracode(ultracode);
              })().catch(report);
            }}
          />
        );
      case "config":
        return (
          <ConfigMenu
            models={state.models}
            initial={overlay.initial}
            path={shortPath(settingsPath(), state.cwd, state.home)}
            ultracodeAvailable={state.ultracodeAvailable === true}
            width={width}
            onClose={(changes) => {
              close();
              if (changes) void applyConfig(changes);
            }}
          />
        );
      case "effort": {
        const levels = currentModel(state)?.efforts ?? EFFORTS;
        return (
          <Picker
            title="Set effort"
            width={width}
            rows={listRows}
            items={[
              ...levels.map((level) => ({ key: level, label: level, note: EFFORT_NOTES[level], current: !state.ultracode && level === state.effort })),
              ...(state.ultracodeAvailable ? [{ key: "ultracode", label: "ultracode", note: ULTRACODE_NOTE, current: state.ultracode }] : []),
            ]}
            empty="This model doesn't take an effort level."
            onCancel={close}
            onPick={(item) => {
              close();
              if (item.key === "ultracode") return pickUltracode(true);
              if (isEffort(item.key)) pickEffort(item.key);
            }}
          />
        );
      }
      case "resume":
        return (
          <Picker
            title="Resume a session"
            width={width}
            rows={listRows}
            items={
              overlay.sessions?.map((saved) => ({
                key: saved.id,
                label: saved.title,
                note: `${ago(saved.modified)}${saved.branch && saved.branch !== "HEAD" ? ` · ⎇ ${saved.branch}` : ""}`,
                detail: saved.firstPrompt,
              })) ?? null
            }
            empty="There are no saved sessions in this folder yet."
            preview={(item) => <SessionPreview id={item.key} cwd={state.cwd} width={width - 4} />}
            onCancel={close}
            onPick={(item) => {
              close();
              resumeSession(item.key, item.label);
            }}
          />
        );
      case "output":
        return (
          <Picker
            title="Tool output"
            width={width}
            rows={listRows}
            items={toolCalls(state.items, view)}
            empty="Claude hasn't used any tools in this session yet."
            onCancel={close}
            onPick={(item) => {
              close();
              showOutput(item.key);
            }}
          />
        );
      case "rewind":
        return (
          <Picker
            title="Rewind to before"
            width={width}
            rows={listRows}
            items={state.items
              .flatMap((item) =>
                item.kind === "prompt" && item.uuid
                  ? [{ key: item.uuid, label: item.text.split("\n")[0] ?? "", detail: item.text.includes("\n") ? item.text : undefined }]
                  : [],
              )
              .reverse()}
            empty="There's no earlier message to go back to yet."
            onCancel={close}
            // A message longer than its first line has the whole of it as its detail.
            onPick={(item) => pickRewind(item.key, item.detail ?? item.label)}
          />
        );
      case "rewind-how": {
        const { files, uuid, text } = overlay;
        const changed = files?.canRewind ? (files.filesChanged?.length ?? 0) : 0;
        const changes = changed ? `${plural(changed, "file")}  +${files?.insertions ?? 0} −${files?.deletions ?? 0}` : undefined;
        const why = files && !files.canRewind && files.error ? `The files can't be put back: ${files.error}` : undefined;
        const items = [
          ...(changes ? [{ key: "both", label: "Restore code and conversation", note: changes }] : []),
          { key: "conversation", label: "Restore conversation", note: changes ? "Files stay as they are" : "No files to put back", detail: why },
          ...(changes ? [{ key: "code", label: "Restore code", note: changes, detail: "The conversation stays as it is" }] : []),
          { key: "cancel", label: "Never mind" },
        ];
        return (
          <Picker
            title={`Rewind to before “${fit(text.split("\n")[0] ?? "", width - 30, false)}”`}
            width={width}
            rows={listRows}
            items={files ? items : null}
            onCancel={close}
            onPick={(item) => {
              close();
              if (files && (item.key === "code" || item.key === "conversation" || item.key === "both")) rewind(uuid, text, item.key, files).catch(report);
            }}
          />
        );
      }
      case "tasks":
        return (
          <Picker
            title="Running · enter opens one"
            width={width}
            rows={listRows}
            items={running.map((one) => ({
              key: one.key,
              label: `${RUNNING_STATUS[one.status].glyph} ${one.title}`,
              note: [one.kind, one.status === "running" ? "running" : one.status === "completed" ? "finished" : one.status, one.startedAt ? ago(one.startedAt) : ""]
                .filter(Boolean)
                .join(" · "),
              detail: one.command && one.command !== one.title ? `$ ${one.command.split("\n")[0]}` : undefined,
            }))}
            empty="Nothing runs alongside the conversation. Ctrl+B moves a command or subagent Claude is waiting on to the background, and ! runs a command of yours."
            onCancel={close}
            onPick={(item) => setOverlay({ kind: "task", key: item.key })}
          />
        );
      case "task": {
        const entry = findRunning(state, overlay.key);
        const shell = entry?.shellId ? state.items.find((item) => item.kind === "shell" && item.id === entry.shellId) : undefined;
        return (
          <TaskView
            entry={entry}
            shellOutput={shell?.kind === "shell" ? shell.stdout : undefined}
            session={session}
            width={width}
            rows={Math.max(4, Math.min(14, rows - 18))}
            onStop={stopRunning}
            onBackground={backgroundRunning}
            onBack={() => setOverlay({ kind: "tasks" })}
            onClose={close}
          />
        );
      }
      case "note":
        return (
          <Picker
            title="Add the note to"
            width={width}
            rows={listRows}
            items={
              overlay.files?.map((file) => ({ key: file.path, label: file.label, note: shortPath(file.path, state.cwd, state.home), detail: file.note })) ??
              null
            }
            onCancel={close}
            onPick={(item) => {
              close();
              saveMemory(item.key, overlay.note);
            }}
          />
        );
      case "find":
        return <FindBar find={find} count={matchCount} width={width} onChange={setFind} onClose={close} />;
      case "plugins":
        return (
          <PluginManager
            cwd={state.cwd}
            width={width}
            rows={listRows}
            onClose={close}
            onResult={(result) => {
              store.emit({ kind: "notice", tone: result.ok ? "info" : "error", text: result.message });
              if (result.ok) session.reloadPlugins().catch(report);
            }}
          />
        );
      case "mcp":
        return <McpPanel session={session} cwd={state.cwd} home={state.home} width={width} rows={listRows} onOpen={openLink} onOutcome={outcome} onClose={close} />;
      case "permissions":
        return <PermissionsPanel session={session} cwd={state.cwd} home={state.home} width={width} rows={listRows} onOutcome={outcome} onClose={close} />;
      case "memory":
        return (
          <MemoryPanel
            session={session}
            cwd={state.cwd}
            home={state.home}
            width={width}
            rows={listRows}
            onEdit={(path) => handOver(() => editFile(path))}
            onOutcome={outcome}
            onClose={close}
          />
        );
      case "hooks":
        return <HooksPanel session={session} width={width} rows={listRows} onOutcome={outcome} onClose={close} />;
      case "skills":
        return <SkillsPanel session={session} cwd={state.cwd} width={width} rows={listRows} onOutcome={outcome} onClose={close} />;
      case "sandbox":
        return <SandboxPanel session={session} cwd={state.cwd} width={width} rows={listRows} onOutcome={outcome} onClose={close} />;
      case "status":
        return (
          <StatusPanel
            session={session}
            own={{
              title: "astrocode",
              rows: [
                { label: "Settings", value: shortPath(settingsPath(), state.cwd, state.home) },
                { label: "Layout", value: fullscreen ? "full screen" : "scrollback" },
                { label: "Remote Control", value: state.remote ? (state.remote.url ?? state.remote.status) : "off" },
              ],
            }}
            width={width}
            onClose={close}
          />
        );
      case "output-style":
        return (
          <Picker
            title="Output style"
            width={width}
            rows={listRows}
            items={overlay.styles?.styles.map((style) => ({ key: style, label: style, current: style === overlay.styles?.current })) ?? null}
            empty="Claude Code has no output styles."
            onCancel={close}
            onPick={(item) => {
              close();
              // Claude Code's own command keeps it for you in this project, as `claude` does.
              if (!item.current) send(`/output-style ${item.key}`);
            }}
          />
        );
      case "export": {
        const conversation = overlay.conversation;
        return (
          <Picker
            title="Export the conversation"
            width={width}
            rows={listRows}
            items={
              conversation
                ? [
                    { key: "file", label: "Save to a file", note: conversation.filename, detail: "In this folder. /export and a name saves it under that name." },
                    { key: "copy", label: "Copy to the clipboard", note: plural(conversation.text.split("\n").length, "line") },
                  ]
                : null
            }
            onCancel={close}
            onPick={(item) => {
              close();
              if (!conversation) return;
              if (item.key === "file") return saveExport(conversation.text, conversation.filename);
              copy(conversation.text);
              setToast("Copied the conversation");
            }}
          />
        );
      }
      case "remote":
        return (
          <RemotePanel
            remote={state.remote}
            width={width}
            rows={Math.max(0, rows - 16)}
            onRetry={() => setRemote(true)}
            onTurnOff={() => {
              close();
              setRemote(false);
            }}
            onCopy={(url) => {
              copy(url);
              setToast("Copied the link");
            }}
            onOpen={openAddress}
            onClose={close}
          />
        );
      case "btw":
        return (
          <AsidePanel
            key={overlay.question}
            session={session}
            question={overlay.question}
            earlier={store.asides}
            width={width}
            rows={Math.max(4, rows - 18)}
            onAnswered={(aside) => store.asides.push(aside)}
            onClose={close}
          />
        );
      default:
        return null;
    }
  };

  /** What a change in one of Claude Code's dialogs said, in the transcript. */
  const outcome = ({ ok, message }: Outcome) => {
    if (message) notice(ok ? "info" : "error", message);
  };

  const above = question ? (
    <QuestionPrompt key={question.id} request={question} width={width} rows={rows} onAnswer={(answers) => session.answer(question.id, answers)} />
  ) : elicitation ? (
    <ElicitationPrompt
      key={elicitation.id}
      request={elicitation}
      width={width}
      onOpen={(url) =>
        void openLink(url).then((opened) => {
          if (!opened) notice("error", `Couldn't open ${url}: there's no xdg-open here, or no desktop for it to open on. Open it yourself to go on.`);
        })
      }
      onAnswer={(answer) => session.answerElicitation(elicitation.id, answer)}
    />
  ) : request ? (
    <DecisionPrompt key={request.id} request={request} agent={askedBy(request, state.taskInfo)} {...view} onDecide={(decision) => session.decide(request.id, decision)} />
  ) : (
    picker()
  );
  const pinned = showTodos && todos ? <PinnedTodos todos={todos} rows={Math.max(3, Math.min(8, rows - 20))} /> : null;
  const panel = (
    <>
      <Activity state={state} width={width} />
      {/* The message box's own top edge sets it apart; what sits above it needs a row. */}
      <Box marginTop={above || pinned || state.queue.length ? 1 : 0} flexDirection="column">
        {pinned}
        {above}
        <QueuedMessages queue={state.queue} width={width} />
        <Prompt
          active={!question && !elicitation && !request && !overlay}
          fullscreen={fullscreen}
          busy={state.busy}
          waitingOn={question || elicitation ? "question" : request ? "permission" : undefined}
          width={width}
          cwd={state.cwd}
          history={store.sent}
          commands={[...commands, ...state.commands.filter((command) => !commands.some((own) => own.name === command.name))]}
          onSubmit={submit}
          onInterrupt={interrupt}
          onCycleMode={cycleMode}
          onCtrlC={onCtrlC}
          onExit={exit}
          onOpenOutput={() => setOverlay({ kind: "output" })}
          prefill={prefill}
          onEditQueued={editQueued}
          onAttach={(image) => store.attach(image)}
          onNotice={notice}
          onEdit={openEditor}
          onBackground={background}
          onToggleTodos={() => setTodoMode(showTodos ? "off" : "on")}
          onRewind={openRewind}
          onSuspend={suspend}
          onToggleThinking={toggleThinking}
          keymap={store.keymap}
          onStepEffort={stepEffort}
          onModelPicker={() => setOverlay({ kind: "model" })}
          onFastMode={toggleFast}
          onStopTasks={stopAllTasks}
          onFind={fullscreen ? () => setOverlay({ kind: "find" }) : undefined}
          workflows={state.ultracodeAvailable !== false}
          stash={stash}
          onStash={(text) => {
            store.stash = text;
            setStash(text);
            const images = Object.fromEntries(
              mentionedImages(text ?? "").flatMap((n) => {
                const image = store.images.get(n);
                return image ? [[n, image] as const] : [];
              }),
            );
            saveStash(state.cwd, text ? { text, images } : null).catch((error: unknown) =>
              report(`Couldn't keep the stash for next time: ${error instanceof Error ? error.message : String(error)}`),
            );
          }}
        />
        <StatusBar
          state={state}
          mode={modeWanted ?? state.mode}
          git={git}
          width={width}
          armed={
            exitArmed
              ? "Press Ctrl+C again to exit"
              : stopArmed
                ? `Press ${keyLabel(keyFor(store.keymap, "chat:killAgents") ?? "ctrl+x ctrl+k")} again to stop what's running (${runningNow})`
                : null
          }
          running={runningNow}
          toast={toast}
          keepWarm={keepWarm}
          usageMode={usageMode}
          onCache={toggleKeepWarm}
          onMode={cycleMode}
          onModel={() => setOverlay({ kind: "model" })}
          onEffort={() => setOverlay({ kind: "effort" })}
          onThinking={toggleThinking}
          onFast={toggleFast}
          onTasks={openTasks}
          onRemote={() => setOverlay({ kind: "remote" })}
        />
      </Box>
    </>
  );

  if (fullscreen) {
    return (
      <Screen
        state={state}
        epoch={store.epoch}
        branch={branch}
        columns={width}
        rows={rows}
        expanded={expanded}
        waiting={waiting}
        reveal={reveal}
        keys={!overlay}
        onToggle={toggleTool}
        onCopy={copySelection}
        onOpen={openAddress}
        onPicture={openPictures}
        find={overlay?.kind === "find" ? find : null}
        onMatches={setMatchCount}
      >
        {panel}
      </Screen>
    );
  }

  const settled = settledSteps(state, settledCount(state.items, waiting));
  // What's written for good is arranged on its own, as of a turn that's over, so it can't change later.
  const written = arrange({ ...state, items: state.items.slice(0, settled), busy: false }, waiting, NONE);
  const entries: ({ kind: "banner"; key: string } | Entry)[] = [{ kind: "banner", key: "banner" }, ...written];
  const unsettled = arrange(state, waiting, NONE).filter((entry) => entry.index >= settled);
  return (
    <>
      <Static key={store.epoch} items={entries}>
        {(entry) => (
          <Box key={entry.kind === "item" ? entry.item.key : entry.key} flexDirection="column">
            {entry.kind === "item" ? (
              <ItemView item={entry.item} rail={entry.rail} detailed scrollback {...view} />
            ) : entry.kind === "step" ? (
              <StepView step={entry.row} rail={entry.rail} open={entry.open} width={width} />
            ) : (
              <Banner cwd={state.cwd} home={state.home} branch={branch} width={width} />
            )}
          </Box>
        )}
      </Static>
      <Box flexDirection="column">
        {unsettled.map((entry) =>
          entry.kind === "step" ? (
            <StepView key={entry.key} step={entry.row} rail={entry.rail} open={entry.open} width={width} />
          ) : (
            <ItemView
              key={entry.item.key}
              item={entry.item}
              rail={entry.rail}
              waiting={entry.item.kind === "tool" && waiting.has(entry.item.call.id)}
              {...view}
            />
          ),
        )}
        <LiveView live={state.live} width={width} room={Math.max(4, rows - 16)} />
        {panel}
      </Box>
    </>
  );
}

/**
 * The session's title as Claude Code keeps it: yours from /rename, else the one it made up, else
 * your first message. Read again as each turn ends, and for a new or resumed session.
 */
function useSessionTitle(id: string | undefined, cwd: string, turns: number, epoch: number) {
  const [title, setTitle] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!id) return setTitle(undefined);
    let alive = true;
    void sessionTitle(id, cwd)
      .catch(() => undefined)
      .then((next) => {
        if (alive) setTitle(next);
      });
    return () => {
      alive = false;
    };
  }, [id, cwd, turns, epoch]);
  return title;
}

function useGit(cwd: string, refresh: number) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void gitInfo(cwd).then((next) => {
      if (alive) setInfo(next);
    });
    return () => {
      alive = false;
    };
  }, [cwd, refresh]);
  return info;
}

/** This session's tool calls and your commands for the output browser, newest first. */
function toolCalls(items: Item[], { cwd, home, width }: { cwd: string; home: string; width: number }): PickerItem[] {
  return items
    .flatMap((item): PickerItem[] => {
      if (item.kind === "shell") {
        const took = item.startedAt !== undefined && item.endedAt !== undefined ? duration(item.endedAt - item.startedAt) : "";
        return [{ key: item.id, label: `! ${fit(item.command.split("\n")[0] ?? "", width - 30, false)}`, note: [item.status === "done" ? "finished" : item.status, took].filter(Boolean).join(" · ") }];
      }
      if (item.kind !== "tool") return [];
      const { call } = item;
      const description = call.name === "Bash" && typeof call.input.description === "string" ? call.input.description : "";
      return [
        {
          key: call.id,
          label: `${STATUS[call.status].glyph} ${toolLabel(call.name)}  ${fit(description || toolTarget(call, cwd, home), width - 40, !description)}`,
          note: toolSummary(call, false),
        },
      ];
    })
    .reverse()
    .slice(0, 50);
}

/** How many leading items are finished, so they can go into scrollback for good. */
const NONE: ReadonlySet<string> = new Set();

/**
 * How many items scrollback may write for good, held back so a step goes whole: not one Claude is
 * still working in, nor thinking or a sentence that may yet start one.
 */
function settledSteps(state: State, settled: number) {
  for (const [start, step] of steps(state.items)) {
    if (start >= settled) break;
    if (step.end > settled || isCurrent(state.items, step, state.busy)) return start;
  }
  if (!state.busy) return settled;
  let held = settled;
  for (let item = state.items[held - 1]; item && (item.kind === "thinking" || (item.kind === "text" && titleWorthy(item.text))); item = state.items[held - 1]) held -= 1;
  return held;
}

function settledCount(items: Item[], waiting: Set<string>) {
  const index = items.findIndex(
    (item) =>
      (item.kind === "tool" && (item.call.status === "running" || waiting.has(item.call.id))) ||
      // A command of yours stays live while it's the newest thing; after that its card is drawn for good.
      (item.kind === "shell" && item.status === "running" && !item.background),
  );
  return index === -1 ? items.length : index;
}
