// The terminal front end, in one of two layouts. By default finished entries are written once into
// the terminal's own scrollback (Ink's <Static>), like `claude` does, and only the live part below
// them is redrawn. In full screen the conversation scrolls in a viewport of its own, with the mouse.
import type { EffortLevel, PermissionMode, RewindFilesResult } from "@anthropic-ai/claude-agent-sdk";
import { Box, Static, useApp, useInput, useStdout, useWindowSize, type DOMElement } from "ink";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { useContext, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { EFFORTS, isEffort, MODES, type CommandInfo, type ImageAttachment } from "../src/events";
import { historyEvents, loadHistory, savedSessions, sessionTitle, shellMessages, type SavedSession } from "../src/history";
import { addMemory, memoryFiles, type MemoryFile } from "../src/memory";
import type { AgentSession, Sending } from "../src/session";
import { remember, settingsPath, type NotifyMode, type Remembered, type TodoMode, type UsageMode } from "../src/settings";
import { runShell } from "../src/shell";
import { saveStash } from "../src/stash";
import { ago, canStopThinking, currentModel } from "../src/view/format";
import { isCurrent, steps, titleWorthy } from "../src/view/steps";
import { askedBy } from "../src/view/permissions";
import { findRunning, runningKeyOf, runningList, runningTaskOf, type Running } from "../src/view/runs";
import type { Item, State, ToolItem } from "../src/view/state";
import { todoList } from "../src/view/todos";
import { plural, shortPath } from "../src/view/tools";
import { Activity } from "./activity";
import { AsidePanel } from "./aside";
import { useAttention } from "./attention";
import { useKeepWarm } from "./cache";
import { StatusPanel } from "./claude-status";
import { copy } from "./clipboard";
import { ConfigMenu, type ConfigValues } from "./config";
import { DecisionPrompt } from "./decision";
import { ElicitationPrompt } from "./elicitation";
import { EFFORT_NOTES, effortStep, effortsOf, ULTRACODE_NOTE } from "./effort";
import { editFile, editText, readInEditor } from "./editor";
import { FindBar, type Find } from "./find";
import { useNeedsYou, type Background, type Fleet } from "./fleet";
import { focusOf } from "./focus";
import { HooksPanel } from "./hooks";
import { ItemView, LiveView, StepView, targetCall } from "./entries";
import { fileTarget, ledgerTarget } from "./ledger";
import { gitInfo, type GitInfo } from "./git";
import { mentionedImages } from "./images";
import { DEFAULT_KEYMAP, keyFor, keyLabel, strokeOf } from "./keys";
import { galleryOf, linkedBy, pageFile } from "./figure";
import { Lightbox } from "./lightbox";
import { copiedBy, openFile, openLink, ranBy } from "./links";
import { runnableCommands } from "./runnable";
import type { Outcome } from "./manager";
import { ANSI } from "./markdown";
import { fit } from "./markdown-view";
import { McpPanel } from "./mcp";
import { MemoryPanel } from "./memory";
import { ModelPicker } from "./model-picker";
import type { TabId } from "./inspector";
import { targetMove, targetTab, WHOLE } from "./opened";
import { listedIn, scopeOf, useReview } from "./review";
import { hit, MouseContext, useMouse } from "./mouse";
import { Picker } from "./picker";
import { drawsImages, pictureRows, resendPictures } from "./pictures";
import { PermissionsPanel } from "./permissions";
import { PluginManager } from "./plugins";
import { Prompt } from "./prompt";
import { QuestionPrompt } from "./question";
import { QueuedMessages } from "./queued";
import { RemotePanel } from "./remote";
import { GUTTER } from "./rail";
import { SandboxPanel } from "./sandbox";
import { Screen, transcriptHint } from "./screen";
import { KeySheet, sheetOf, type Place, type Prompted } from "./sheet";
import { arrange, type Entry } from "./arrange";
import { SessionPreview } from "./session-preview";
import { SkillsPanel } from "./skills";
import { RECENT, StartScreen, startOf, startReady } from "./start";
import { ModBand } from "./mod-band";
import { useModCards } from "./mod-cards";
import { ModStatus, StatusBar } from "./status";
import type { Store } from "./store";
import { RUNNING_STATUS, TaskView, useTaskOutput } from "./tasks";
import { PinnedTodos } from "./tool-row";
import { useViewer } from "./viewer";

type Overlay =
  /** The model and its effort, as Alt+P opens it. */
  | { kind: "model" }
  | { kind: "effort" }
  /** astrocode's settings, as they were when /config opened. */
  | { kind: "config"; initial: ConfigValues }
  | { kind: "resume"; sessions: SavedSession[] | null }
  /** The commands in Claude's code blocks, to run one. */
  | { kind: "play" }
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
  /** Finding text in the transcript; `/` there gives what its Esc does, as `claude`'s cancels. */
  | { kind: "find"; cancel?: () => void }
  /** The conversation's pictures, as large as they go, opened on one of them. */
  | { kind: "picture"; image: ImageAttachment }
  /** Every key, for what had your keys when `?` or /help opened it: a decision by its request's id, with the keys it takes. */
  | { kind: "keys"; place: Place; request?: string; prompt?: Prompted }
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
/** Tools whose work in a task opens under the call's line, live: a command, and a subagent. */
const IN_PLACE = new Set(["Bash", "Agent", "Task"]);

type Props = {
  store: Store;
  session: AgentSession;
  branch?: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** ← in an empty message box: the agents view, with this conversation kept open behind it. */
  onAgents: () => void;
  /** The conversations astrocode runs, this one among them. */
  fleet: Fleet;
  /** Claude Code's background sessions, which the status bar counts too when they wait on you. */
  backgroundSessions: Background;
  /** Whether the empty box mentions ←, once that's known. */
  agentsHint: Promise<boolean>;
};

export function App({ store, session, branch, fullscreen, onToggleFullscreen, onAgents, fleet, backgroundSessions, agentsHint }: Props) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const othersWaiting = useNeedsYou(fleet, backgroundSessions, store);
  const [hintAgents, setHintAgents] = useState(false);
  /** Whether the message box is empty: a click on `← N needs you` leaves only then, as ← does, so nothing typed is lost. */
  const [boxEmpty, setBoxEmpty] = useState(true);
  useEffect(() => void agentsHint.then(setHintAgents), [agentsHint]);
  useModCards(session, state, store.emit);
  const { exit } = useApp();
  const mouse = useContext(MouseContext);
  const viewer = useViewer(mouse);
  // main.tsx stops this app for the agents view and the other layout. From the viewer that goes by
  // the scrollback, as Ink lets go of kitty's keyboard mode on the screen it's on as it stops.
  const toAgents = () => void viewer.show(false).then(onAgents);
  const toOtherLayout = () => void viewer.show(false).then(onToggleFullscreen);
  const { write } = useStdout();
  const { columns, rows } = useWindowSize();
  const width = Math.max(24, columns);
  /** What pressing a key in the message box again soon would do, for the status bar: `Press Ctrl+D again to exit`. */
  const [armed, setArmed] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // The mode last asked for, until Claude Code confirms it, so quick Shift+Tabs keep stepping.
  const [modeWanted, setModeWanted] = useState<PermissionMode | null>(null);
  const wanted = useRef<PermissionMode | null>(null);
  const turns = state.items.filter((item) => item.kind === "turn").length;
  const git = useGit(state.cwd, turns);
  // Entries a click or Enter opened or closed, away from how they start, whether full screen's
  // transcript has your keys (scrollback's has them while its viewer is open), and what was copied.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [transcriptKeys, setTranscriptKeys] = useState(false);
  /** The ledgers' scopes and the diffs read for their files, which `expanded` opens by `fileTarget()`. */
  const { review, setScope } = useReview(session, state.items, expanded, git !== null, store.resets);
  /** /diff's ledger, for the cursor to go to once it's drawn open. */
  const [reveal, setReveal] = useState<{ key: string } | undefined>(undefined);
  /** The transcript's cursor is in an opened ledger, whose keys the hint then names. */
  const [inLedger, setInLedger] = useState(false);
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
  const start = startOf(state, branch, store.keymap);
  useAttention({ state, window: store.window, notify: notifyMode, title, git });
  /** The message put aside with Ctrl+S, kept in the store so it outlives a switch of layouts. */
  const [stash, setStash] = useState(store.stash);
  /** Ctrl+X Ctrl+K pressed once: pressed again soon, it stops everything running. */
  const [stopArmed, setStopArmed] = useState(false);
  const editing = useRef(false);
  /** For a redraw of the scrollback, whose new epoch only a render of its own puts on screen. */
  const [, repaint] = useReducer((n: number) => n + 1, 0);
  /** What's pinned under the transcript: the message box, the status bar and what opens above them. */
  const panelBox = useRef<DOMElement>(null);

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

  /**
   * Why a key did nothing, for a moment where the mode shows, as `claude` says it. Pressed again,
   * the same words stay up longer rather than stacking.
   */
  const [hint, setHint] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  // A mod's toast shows for as long as the mod asked, and a newer one takes its place.
  const [modToast, setModToast] = useState<{ plugin: string; text: string } | null>(null);
  useEffect(() => {
    const latest = state.modToast;
    if (!latest) return setModToast(null);
    setModToast({ plugin: latest.plugin, text: latest.text });
    const timer = setTimeout(() => setModToast(null), latest.ms);
    return () => clearTimeout(timer);
  }, [state.modToast?.count]);

  useEffect(() => {
    if (wanted.current === state.mode) {
      wanted.current = null;
      setModeWanted(null);
    }
  }, [state.mode]);

  /**
   * The tool call opened under its line, with the tab it shows and whether that's whole. `follow`:
   * it was the call Claude is on when it opened, so each call Claude starts opens in its place, until
   * you move the cursor.
   */
  const [inspect, setInspect] = useState<{ id: string; tab?: TabId; whole?: boolean; follow?: boolean } | null>(null);

  useEffect(() => {
    setExpanded(new Set());
    toTranscript(false);
    setInspect(null);
  }, [store.resets]);

  /** The call Claude started last, which it's on while that runs or waits for you. */
  const newest = state.items.findLast((item): item is ToolItem => item.kind === "tool")?.call;
  useEffect(() => {
    if (newest) setInspect((open) => (open?.follow && open.id !== newest.id ? { id: newest.id, follow: true } : open));
  }, [newest?.id]);

  // The sessions saved here, for each new or resumed conversation's start screen. The one on screen
  // isn't one of them. A redraw keeps the list it has.
  useEffect(() => {
    let alive = true;
    void savedSessions(state.cwd, RECENT + 1)
      .catch(() => [])
      .then((sessions) => {
        if (alive) store.emit({ kind: "recent", sessions: sessions.filter((one) => one.id !== session.knownId).slice(0, RECENT) });
      });
    return () => {
      alive = false;
    };
  }, [store.resets]);

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
    if (layout !== undefined && layout !== fullscreen) toOtherLayout();
  };

  /**
   * Shift+↑ and Shift+↓ (chat:increaseEffort and chat:decreaseEffort): the next level up or down
   * that the model takes, for this session only, as `claude` steps it.
   */
  const stepEffort = (by: -1 | 1) => {
    const levels = effortsOf(currentModel(state));
    if (!levels.length) return notice("info", "This model doesn't take an effort level.");
    const next = effortStep(levels, state.effort, by);
    if (next) return void session.setEffort(next).then(() => setToast(`${next} effort`), report);
    if (by === 1 && state.effort !== "max" && levels.includes("max")) {
      setHint({ text: `${keyLabel(keyFor(store.keymap, "chat:increaseEffort") ?? "shift+up")} stops below max · /effort max to set it` });
    }
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

  /**
   * `x` on a line of the transcript: stops the subagent or command it stands for while that runs, a
   * command of yours too. Another call stops only with Claude.
   */
  const stopLine = (key: string) => {
    const id = targetCall(key);
    const index = id === undefined ? state.items.findIndex((one) => one.key === key) : state.tools[id];
    const item = index === undefined ? undefined : state.items[index];
    if (item?.kind === "shell" && item.status === "running") return store.shells.get(item.id)?.abort();
    if (item?.kind !== "tool") return;
    const task = runningTaskOf(item.call, state);
    if (task) return void session.stopTask(task.id).catch(report);
    if (item.call.status === "running") setHint({ text: `Only a command or a subagent stops on its own · ${keyLabel(keyFor(store.keymap, "app:interrupt") ?? "ctrl+c")} stops Claude` });
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
    if (next !== fullscreen) toOtherLayout();
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

  /**
   * Ctrl+L: the screen drawn again from nothing, for one a program or the terminal left garbled, as
   * `claude` does. Full screen draws its frame again; scrollback writes the conversation out again,
   * as coming back from full screen does.
   */
  const redrawScreen = () => {
    // The viewer is drawn as full screen is; writing scrollback out again would clear it, under the viewer.
    if (fullscreen || viewer.open) return write("\x1b[2J\x1b[H");
    store.redraw(write);
    repaint();
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
   * Your keys to the transcript, or back to the box. In scrollback that opens or closes the viewer,
   * and a call left open there closes with it, as nothing would show it.
   */
  const toTranscript = (on: boolean) => {
    if (fullscreen) return setTranscriptKeys(on);
    if (!on) {
      setInspect(null);
      // The viewer draws the transcript afresh each time it opens, and would go to /diff's ledger again.
      setReveal(undefined);
    }
    void viewer.show(on);
  };

  /**
   * Ctrl+O and /output: your keys go to the transcript, whose cursor opens any line in place. With
   * no line for the cursor, scrollback's viewer would only flash open and shut.
   */
  const openTranscript = () => {
    if (fullscreen || state.items.length || state.live) toTranscript(true);
  };

  /** Ctrl+F: a line to type what to find in the transcript. */
  const openFind = () => setOverlay({ kind: "find" });

  /**
   * `/` in the transcript: the same line, empty, as `claude`'s. Esc puts back the view and what was
   * found before, for `n` and `N`.
   */
  const slashFind = (restore: () => void) => {
    const before = find;
    setFind({ query: "", back: 0 });
    setOverlay({
      kind: "find",
      cancel: () => {
        setFind(before);
        restore();
      },
    });
  };

  /**
   * Opens a call under its line, with your keys in the transcript. A subagent or a command in the
   * background opens there too, live; /tasks is the view of it that fills the screen. A workflow or a
   * Monitor opens its task view, which alone shows its phases or its output as they come.
   */
  const inspectCall = (id: string) => {
    const index = state.tools[id];
    const item = index === undefined ? undefined : state.items[index];
    const task = item?.kind === "tool" && !IN_PLACE.has(item.call.name) ? runningKeyOf(item, state) : undefined;
    if (task) {
      setOverlay({ kind: "task", key: task });
      return false;
    }
    // A call Claude is on, as it runs or waits for you, follows Claude.
    setInspect({ id, follow: item?.kind === "tool" && item.call.status === "running" });
    toTranscript(true);
    return true;
  };

  /** A call's line clicked: it opens under the line, or closes if it's the one open. */
  const toggleCall = (id: string) => {
    if (inspect?.id !== id) return inspectCall(id);
    setInspect(null);
    return true;
  };

  /**
   * A click on an entry in full screen: a step's line opens its call under it, as does a call drawn
   * on its own, such as a picture or a plan, and a click on what opened closes it, shows another of
   * its tabs, the whole tab, or the call before or after. Steps, commands of yours and a turn's
   * closer open or close in place. A command of yours still running opens its view instead.
   */
  const toggleTool = (key: string) => {
    const ledger = ledgerTarget(key);
    if (ledger && "scope" in ledger) {
      setScope(ledger.turn, ledger.scope);
      return true;
    }
    if (ledger && "all" in ledger) {
      openAllFiles(ledger.turn);
      return true;
    }
    const tab = targetTab(key);
    if (key === WHOLE || tab) {
      setInspect((open) => open && (tab ? { ...open, tab, whole: false } : { ...open, whole: true }));
      return true;
    }
    const by = targetMove(key);
    if (by) {
      moveOpened(by);
      return false;
    }
    const call = targetCall(key);
    if (call !== undefined) return toggleCall(call);
    const item = state.items.find((one) => one.key === key);
    if (item?.kind === "tool") return toggleCall(item.call.id);
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

  /** `a` in an opened ledger: every file's diff opens, or with all of them open, closes. */
  const openAllFiles = (key: string) => {
    const turn = state.items.find((item) => item.key === key);
    const listed = turn?.kind === "turn" ? listedIn(review, turn, scopeOf(review, key)) : undefined;
    if (typeof listed !== "object") return;
    const files = listed.files.map((file) => fileTarget(key, file.path));
    setExpanded((open) => {
      const all = files.every((file) => open.has(file));
      const next = new Set(open);
      for (const file of files) {
        if (all) next.delete(file);
        else next.add(file);
      }
      return next;
    });
  };

  /**
   * /diff: the latest turn's ledger, opened, with your keys and the cursor on it, in full screen's
   * transcript or scrollback's viewer.
   */
  const openDiff = () => {
    const turn = state.items.findLast((item) => item.kind === "turn");
    if (turn?.kind !== "turn") return notice("info", "No turn has ended yet. /diff opens the latest turn's ledger: what it changed, ran and committed.");
    setExpanded((open) => (open.has(turn.key) ? open : new Set(open).add(turn.key)));
    toTranscript(true);
    setReveal({ key: turn.key });
  };

  /** The conversation's tool calls in order, which ← and → in an opened call move through. */
  const allCalls = state.items.flatMap((item) => (item.kind === "tool" ? [item.call] : []));
  /** ← or → in an opened call, from it to the call before or after. */
  const moveFrom = (id: string, by: -1 | 1) => {
    const next = allCalls[allCalls.findIndex((call) => call.id === id) + by];
    if (next) setInspect({ id: next.id });
  };
  const moveOpened = (by: -1 | 1) => {
    if (inspect) moveFrom(inspect.id, by);
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
    const command = ranBy(url);
    if (command !== undefined) {
      runCommand(command);
      return setToast(`Running ${fit(command.split("\n")[0] ?? "", 40, false)}`);
    }
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
    const resets = store.resets;
    store.shells.set(id, controller);
    store.emit({ kind: "shell", id, command, at: Date.now() });
    const onOutput = (output: string) => store.emit({ kind: "shell-output", id, output, at: Date.now() });
    void runShell(command, { cwd: state.cwd, cols: width - GUTTER - 2, signal: controller.signal, onOutput }).then((result) => {
      store.shells.delete(id);
      // After /clear or a resume, the conversation it belonged to is gone.
      if (store.resets !== resets) return;
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
    // Full screen and scrollback's viewer are on the alternate screen, where the mouse reports, and
    // whose pictures kitty drops while another program has it.
    const alternate = fullscreen || viewer.open;
    mouse?.stop();
    store.window?.stop();
    const suspension = await viewer.suspend();
    try {
      return await edit();
    } finally {
      await suspension.resume();
      store.window?.start();
      if (alternate) {
        mouse?.start();
        resendPictures();
      }
      editing.current = false;
    }
  };

  /** Your message in $EDITOR. */
  const openEditor = (text: string) => {
    if (editing.current) return;
    handOver(() => editText(text)).then((edited) => setPrefill({ text: edited }), report);
  };

  const sent = store.prompts.forConversation(state.cwd, session.knownId);
  const submit = (text: string, how: { now?: boolean; later?: boolean; ignoreUltracode?: boolean } = {}) => {
    const { now = false } = how;
    const [command = "", ...rest] = text.trim().split(/\s+/);
    // Sending uses up Claude Code's suggestion, as in `claude`, but for /diff: it only takes you to
    // the ledger, and the spec has the suggestion in the box when Esc gives it back.
    if (command !== "/diff") store.emit({ kind: "sent" });
    void sent.add(text);
    if (text.startsWith("!")) return runCommand(text.slice(1).trim());
    if (text.startsWith("#")) return openMemory(text.slice(1).trim());
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
        return setOverlay({ kind: "keys", place: "box" });
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
        return openTranscript();
      case "/diff":
        return openDiff();
      case "/pictures":
        return openPictures();
      case "/play":
        if (!runnableCommands(state.items).length) return notice("info", "Claude hasn't written a shell code block in this session yet.");
        return setOverlay({ kind: "play" });
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
    send(text, { ignoreUltracode: how.ignoreUltracode, later: how.later && state.busy ? true : undefined, now: now && state.busy ? true : undefined });
  };

  /** Ctrl+Enter in an empty box: the messages queued while Claude works go now. */
  const sendQueuedNow = () => {
    if (state.busy && state.queue.length) void session.sendQueuedNow().catch(report);
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

  /** Ctrl+Z, as in a shell: astrocode stops, and the shell's `fg` brings it back. */
  const suspend = () => {
    if (editing.current) return;
    editing.current = true;
    const alternate = fullscreen || viewer.open;
    void (async () => {
      mouse?.stop();
      store.window?.stop();
      const suspension = await viewer.suspend();
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
        if (alternate) {
          mouse?.start();
          resendPictures();
        }
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
    {
      name: "output",
      description: "Move through the transcript and open any line in place: a tool call's command or input, its whole output, what Claude got back (Ctrl+O)",
      argumentHint: "",
    },
    {
      name: "diff",
      description: "Review the latest turn's changes: each file's diff, the commands it ran and its commits; [ and ] switch to what isn't committed, or the branch",
      argumentHint: "",
    },
    { name: "play", description: "Run a command from one of Claude's shell code blocks, as with !", argumentHint: "" },
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
    { name: "help", description: "Every key, as you've bound them (? in an empty box)", argumentHint: "" },
    { name: "exit", description: "Quit astrocode", argumentHint: "" },
  ];

  const picker = () => {
    switch (overlay?.kind) {
      case "keys":
        return <KeySheet sections={sheetOf(overlay.place, store.keymap, fullscreen || viewer.open, { prompt: overlay.prompt, scopes: review.git })} custom={store.keymap !== DEFAULT_KEYMAP} width={width} rows={Math.max(3, rows - 13)} onClose={close} />;
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
      case "play":
        return (
          <Picker
            title="Run a command from Claude's code blocks"
            width={width}
            rows={listRows}
            items={runnableCommands(state.items).map((command) => ({
              key: command,
              label: `! ${fit(command.split("\n")[0] ?? "", width - 12, false)}`,
              note: command.includes("\n") ? plural(command.split("\n").length, "line") : undefined,
              detail: command.includes("\n") ? command : undefined,
            }))}
            empty="Claude hasn't written a shell code block in this session yet."
            onCancel={close}
            onPick={(item) => {
              close();
              runCommand(item.key);
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
            log={entry?.toolUseId ? state.agentLogs[entry.toolUseId] : undefined}
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
      case "find": {
        const { cancel } = overlay;
        const onCancel = cancel
          ? () => {
              close();
              cancel();
            }
          : undefined;
        return <FindBar find={find} count={matchCount} width={width} onChange={setFind} onClose={close} onCancel={onCancel} />;
      }
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

  // The call opened, while that's still in the conversation.
  const inspectedAt = inspect ? state.tools[inspect.id] : undefined;
  const inspectedItem = inspectedAt === undefined ? undefined : state.items[inspectedAt];
  const inspected = inspectedItem?.kind === "tool" ? inspectedItem.call : undefined;
  // An opened command that Claude Code runs as a task, in the background or while Claude waits on it,
  // shows what that has printed, as it prints.
  const printing = inspected?.name === "Bash" ? (runningTaskOf(inspected, state) ?? (inspected.taskId ? state.taskInfo[inspected.taskId] : undefined)) : undefined;
  const printed = useTaskOutput(session, printing?.id, printing?.status === "running");
  // The key sheet a decision's `?` opened, which stands in the decision's place until it closes, or
  // until the decision is answered elsewhere or withdrawn.
  const sheet = overlay?.kind === "keys" && overlay.place === "decision";
  const sheetGone = sheet && overlay.request !== request?.id;
  useEffect(() => {
    if (sheetGone) setOverlay(null);
  }, [sheetGone]);
  // Your keys are in one place: a decision, else an overlay, else the transcript once it's been given
  // them, else the box.
  const focus = focusOf({
    decision: Boolean(question || elicitation || request) && !sheet,
    overlay: Boolean(overlay),
    transcript: fullscreen ? transcriptKeys : viewer.open,
  });
  // A click on the message box, or under it, gives it back your keys from the transcript.
  useMouse((event) => {
    if (event.type === "press" && event.button === "left" && !event.handled && focus === "transcript" && hit(panelBox.current, event)) toTranscript(false);
  });
  const boxKeys = focus === "box";
  // `?` lists the keys where yours are: the box and a permission prompt read their own, and an
  // overlay's filter, a question's answer or a form's field take it as typed.
  const keysHere: Place | null = focus === "transcript" ? (inLedger ? "ledger" : inspected ? "opened" : "transcript") : null;
  // Ctrl+L redraws wherever the keys are, the transcript too, as a garbled screen can't wait for an
  // overlay to close. The message box reads its own, chords and all.
  useInput(
    (input, key) => {
      if (key.eventType === "release") return;
      if (store.keymap.get(strokeOf(input, key) ?? "") === "chat:clearInput") redrawScreen();
      else if (input === "?" && !key.ctrl && !key.meta && keysHere) setOverlay({ kind: "keys", place: keysHere });
    },
    { isActive: !boxKeys },
  );
  const overlaid = picker();
  // A decision takes the box's place until you answer it.
  const decision = question ? (
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
    // The key sheet its `?` opened stands in its place, and the decision stays under it, hidden, as you left it.
    <>
      {sheet ? overlaid : null}
      <Box display={sheet ? "none" : "flex"} flexDirection="column">
        <DecisionPrompt
          key={request.id}
          request={request}
          agent={askedBy(request, state.taskInfo)}
          {...view}
          rows={rows}
          mode={state.mode}
          modes={state.modesAvailable}
          active={!sheet}
          onDecide={(answer) => session.decide(request.id, answer)}
          onEdit={(path) => handOver(() => editFile(path)).catch(report)}
          // A decision that took an overlay's place, such as the box's sheet, leaves it to come back once answered.
          onKeys={overlay ? undefined : (prompt) => setOverlay({ kind: "keys", place: "decision", request: request.id, prompt })}
        />
      </Box>
    </>
  ) : null;
  const above = decision ? null : overlaid;
  const pinned = showTodos && todos ? <PinnedTodos todos={todos} rows={Math.max(3, Math.min(8, rows - 20))} /> : null;
  const panel = (
    <Box ref={panelBox} flexDirection="column" flexShrink={0}>
      {/* In the transcript Esc leaves it, and Ctrl+C, which works anywhere, stops Claude. */}
      <Activity state={state} width={width} stop={focus === "transcript" ? (keyFor(store.keymap, "app:interrupt") ?? undefined) : undefined} />
      {/* The message box's own top edge sets it apart; what sits above it needs a row. */}
      <Box marginTop={above || pinned || state.queue.length ? 1 : 0} flexDirection="column">
        {pinned}
        {above ?? (decision ? null : <ModBand session={session} width={width} rows={rows} working={state.busy} />)}
        <QueuedMessages queue={state.queue} width={width} />
        {decision}
        <Prompt
          active={boxKeys}
          anywhere={focus === "transcript"}
          // As much of it as fits in the edge with a cell of it at each end.
          hint={focus === "transcript" ? transcriptHint(inLedger ? "ledger" : inspected ? "call" : undefined, width - 5, review.git) : undefined}
          fullscreen={fullscreen}
          busy={state.busy}
          hidden={Boolean(decision)}
          suggestion={state.nextPrompt}
          width={width}
          cwd={state.cwd}
          history={sent.history}
          everywhere={sent.everywhere}
          commands={[...commands, ...state.commands.filter((command) => !commands.some((own) => own.name === command.name))]}
          onSubmit={submit}
          onSendQueuedNow={sendQueuedNow}
          onInterrupt={interrupt}
          onCycleMode={cycleMode}
          onArmed={setArmed}
          // Exiting from scrollback's viewer goes back to the scrollback first, to write there what waited.
          onExit={() => void viewer.show(false).then(() => exit())}
          onRedraw={redrawScreen}
          onOpenOutput={openTranscript}
          prefill={prefill}
          onEditQueued={editQueued}
          onAttach={(image) => store.attach(image)}
          onNotice={notice}
          onEdit={openEditor}
          onBackground={background}
          onToggleTodos={() => setTodoMode(showTodos ? "off" : "on")}
          onRewind={openRewind}
          onClearIntoHistory={(text) => void sent.add(text)}
          onSuspend={suspend}
          onToggleThinking={toggleThinking}
          keymap={store.keymap}
          onStepEffort={stepEffort}
          onModelPicker={() => setOverlay({ kind: "model" })}
          onFastMode={toggleFast}
          onStopTasks={stopAllTasks}
          onFind={fullscreen || viewer.open ? openFind : undefined}
          onAgents={toAgents}
          onKeys={() => setOverlay({ kind: "keys", place: "box" })}
          hintAgents={hintAgents}
          onEmpty={setBoxEmpty}
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
        <ModStatus lines={state.modStatus} width={width} />
        <StatusBar
          state={state}
          mode={modeWanted ?? state.mode}
          git={git}
          width={width}
          armed={
            armed ??
            hint?.text ??
            (stopArmed ? `Press ${keyLabel(keyFor(store.keymap, "chat:killAgents") ?? "ctrl+x ctrl+k")} again to stop what's running (${runningNow})` : null)
          }
          running={runningNow}
          toast={toast}
          modToast={modToast}
          keepWarm={keepWarm}
          usageMode={usageMode}
          needsYou={othersWaiting}
          // As a click moves your keys where it lands, it leaves the transcript too; never a decision or an overlay.
          onNeedsYou={(boxKeys || focus === "transcript") && boxEmpty ? toAgents : undefined}
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
    </Box>
  );

  // Full screen's layout, and scrollback's transcript viewer, which draws the same on the alternate
  // screen and leaves the message box where scrollback has it, so nothing typed there is lost.
  const screen = (
    <Screen
      state={state}
      epoch={store.epoch}
      start={start}
      columns={width}
      rows={rows}
      expanded={expanded}
      waiting={waiting}
      opened={inspected ? { id: inspected.id, tab: inspect?.tab, whole: inspect?.whole, follow: inspect?.follow, output: printed } : undefined}
      reveal={reveal}
      review={review}
      keys={!overlay}
      focused={focus === "transcript"}
      keymap={store.keymap}
      onFocus={() => toTranscript(true)}
      onLedger={setInLedger}
      onLeave={() => toTranscript(false)}
      onCursor={() => setInspect((open) => (open?.follow ? { ...open, follow: false } : open))}
      onStop={stopLine}
      onToggle={toggleTool}
      onCopy={copySelection}
      onEdit={(text) => void handOver(() => readInEditor(text)).catch(report)}
      onOpen={openAddress}
      onPicture={openPictures}
      find={find}
      finding={overlay?.kind === "find"}
      onFind={slashFind}
      onMatches={setMatchCount}
    >
      {fullscreen ? panel : null}
    </Screen>
  );
  if (fullscreen) return screen;

  // The scrollback can't take back the start screen, so it's written there once it has all it will
  // say, a moment after Claude Code starts. Until then nothing above the box is drawn, a resumed
  // conversation's history included: drawn live, it could fill a short terminal, which then writes
  // a copy of it to the scrollback on every frame.
  const started = startReady(state);
  const settled = started ? settledSteps(state, settledCount(state.items, waiting)) : 0;
  // What's written for good is arranged on its own, as of a turn that's over, so it can't change later.
  const written = arrange({ ...state, items: state.items.slice(0, settled), busy: false }, waiting, NONE);
  const entries: ({ kind: "banner"; key: string } | Entry)[] = started ? [{ kind: "banner", key: "banner" }, ...written] : [];
  const unsettled = started ? arrange(state, waiting, NONE).filter((entry) => entry.index >= settled) : [];
  return (
    <>
      <Static key={store.epoch} items={viewer.hold(entries)}>
        {(entry) => (
          <Box key={entry.kind === "item" ? entry.item.key : entry.key} flexDirection="column">
            {entry.kind === "item" ? (
              <ItemView item={entry.item} rail={entry.rail} detailed scrollback {...view} />
            ) : entry.kind === "step" ? (
              <StepView step={entry.row} rail={entry.rail} open={entry.open} width={width} pictureRows={view.pictureRows} links="scrollback" cwd={state.cwd} home={state.home} clickable={false} />
            ) : (
              <StartScreen start={start} width={width} />
            )}
          </Box>
        )}
      </Static>
      <Box flexDirection="column" height={viewer.open ? rows : undefined}>
        {viewer.open ? (
          screen
        ) : (
          <>
            {unsettled.map((entry) =>
              entry.kind === "step" ? (
                <StepView key={entry.key} step={entry.row} rail={entry.rail} open={entry.open} width={width} pictureRows={view.pictureRows} cwd={state.cwd} home={state.home} clickable={false} />
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
          </>
        )}
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
