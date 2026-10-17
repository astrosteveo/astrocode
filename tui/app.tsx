// The terminal front end, in one of two layouts. By default finished entries are written once into
// the terminal's own scrollback (Ink's <Static>), like `claude` does, and only the live part below
// them is redrawn. In full screen the conversation scrolls in a viewport of its own, with the mouse.
import type { EffortLevel, PermissionMode, RewindFilesResult } from "@anthropic-ai/claude-agent-sdk";
import { Box, Static, useApp, useStdout, useWindowSize } from "ink";
import { randomUUID } from "node:crypto";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EFFORTS, isEffort, MODES, type CommandInfo } from "../src/events";
import { historyEvents, loadHistory, savedSessions, shellMessages, type SavedSession } from "../src/history";
import { addMemory, memoryFiles, type MemoryFile } from "../src/memory";
import type { AgentSession } from "../src/session";
import { remember, settingsPath, type Remembered, type TodoMode } from "../src/settings";
import { runShell } from "../src/shell";
import { saveStash } from "../src/stash";
import { ago, canStopThinking, currentModel } from "../src/view/format";
import type { Item } from "../src/view/state";
import { todoList } from "../src/view/todos";
import { plural, shortPath, toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { Activity } from "./activity";
import { Banner } from "./banner";
import { copy } from "./clipboard";
import { ConfigMenu, type ConfigValues } from "./config";
import { DecisionPrompt } from "./decision";
import { EFFORT_NOTES, effortsOf } from "./effort";
import { editText } from "./editor";
import { ItemView, LiveView } from "./entries";
import { gitInfo, type GitInfo } from "./git";
import { mentionedImages } from "./images";
import { ANSI } from "./markdown";
import { fit } from "./markdown-view";
import { ModelPicker } from "./model-picker";
import { MouseContext } from "./mouse";
import { Picker, type PickerItem } from "./picker";
import { pictureRows, resendPictures, withPictures } from "./pictures";
import { PluginManager } from "./plugins";
import { Prompt } from "./prompt";
import { QuestionPrompt } from "./question";
import { rails } from "./rail";
import { Screen } from "./screen";
import { StatusBar } from "./status";
import type { Store } from "./store";
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
  | { kind: "tasks" }
  /** Where a note written with `#` goes. */
  | { kind: "memory"; note: string; files: MemoryFile[] | null }
  | null;

/** Kinds of background work, by Claude Code's task types. */
const TASK_KINDS: Record<string, string> = { local_bash: "command", local_agent: "subagent", local_workflow: "workflow", monitor: "monitor" };

/** How long the status bar says what was copied. */
const TOAST_MS = 2000;

const HELP = [
  "Enter sends. Shift+Enter, Alt+Enter, Ctrl+J, or \\ then Enter starts a new line. Type / for commands; partway through a message, choosing one writes it in.",
  "Esc stops Claude. Esc twice on an empty box rewinds to an earlier message (/rewind).",
  "Shift+Tab changes the permission mode. Alt+P switches the model and its effort, Alt+T turns thinking off and on. ↑ and ↓ recall earlier messages; Ctrl+R searches them.",
  "Ctrl+S puts the message aside, and it stays there until Ctrl+S brings it back. Pressed with a message in the box, the two trade places.",
  "Ctrl+_ undoes. Ctrl+K, Ctrl+U, Ctrl+W and Alt+D cut, Ctrl+Y puts back what they cut. Alt+B and Alt+F move by words. Ctrl+L clears the box.",
  "! runs a command in your shell and shows it to Claude. # adds a note to a CLAUDE.md.",
  "Ctrl+V attaches the clipboard's image; a pasted or dropped image file attaches too. Ctrl+G or Ctrl+X Ctrl+E edits the message in $EDITOR.",
  "Ctrl+B moves a command or subagent Claude is waiting on to the background (/tasks); Ctrl+X Ctrl+K stops everything there. Ctrl+T shows or hides the to-dos.",
  "Ctrl+Enter or Ctrl+X Ctrl+S sends now, stopping what Claude is doing. Ctrl+Z suspends astrocode until the shell's fg.",
  "Ctrl+O opens a tool call's whole output. Ctrl+C clears the box, stops Claude, or exits when pressed twice.",
  "/clear starts over, /resume picks up a saved session, /model switches models, /effort sets how hard Claude thinks, /exit quits.",
  "/plugins installs, turns on or off, and removes plugins. @ followed by a path attaches a file or folder.",
  "/config changes the model, effort, thinking, mode, to-do list and full screen, and keeps them for next time, except plan mode and max effort. /fullscreen switches layouts.",
].join("\n");

const FULLSCREEN_HELP = [
  "Full screen: the wheel, PgUp and PgDn scroll; Ctrl+Home and Ctrl+End go to the top and the end.",
  "Drag to copy, double-click to copy a word, triple-click to copy a line.",
  "Click a tool call to open it, an option to choose it, the mode, the model or the effort to change it.",
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
  const git = useGit(state.cwd, state.items.filter((item) => item.kind === "turn").length);
  // Full screen's own: tool calls opened to their whole output, one to scroll to, and what was copied.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ key: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Text for the message box, such as a rewound message or one edited in $EDITOR. */
  const [prefill, setPrefill] = useState<{ text: string } | null>(null);
  /** The pinned to-dos: shown while some are left (auto), or as Ctrl+T or /config last set. */
  const [todoMode, setTodoState] = useState(store.todos);
  const setTodoMode = (mode: TodoMode) => {
    store.todos = mode;
    setTodoState(mode);
  };
  /** The message put aside with Ctrl+S, kept in the store so it outlives a switch of layouts. */
  const [stash, setStash] = useState(store.stash);
  /** Commands run with `!` that haven't finished, to stop with Esc. */
  const shells = useRef(new Map<string, AbortController>());
  const editing = useRef(false);

  useEffect(() => {
    if (!exitArmed) return;
    const timer = setTimeout(() => setExitArmed(false), 2000);
    return () => clearTimeout(timer);
  }, [exitArmed]);

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

  const waiting = new Set([...state.pending.map((request) => request.id), ...state.questions.map((request) => request.id)]);
  const question = state.questions[0];
  const request = state.pending[0];
  // In scrollback, what's above the message box and status bar, which take about six rows.
  const view = { cwd: state.cwd, home: state.home, width, pictureRows: pictureRows(rows - 6) };

  const report = (error: unknown) =>
    store.emit({ kind: "notice", tone: "error", text: error instanceof Error ? error.message : String(error) });
  const notice = (tone: "info" | "error", text: string) => store.emit({ kind: "notice", tone, text });

  const shellRunning = state.items.some((item) => item.kind === "shell" && item.status === "running");
  const todos = todoList(state.items);
  const todosLeft = todos?.some((todo) => todo.status !== "completed") ?? false;
  const showTodos = Boolean(todos?.length) && (todoMode === "on" || (todoMode === "auto" && todosLeft));

  /** The model, effort, mode and layout you pick carry over to your next session. */
  const keep = (choice: Remembered) =>
    void remember(choice).catch((error: unknown) =>
      report(`Couldn't remember that for next time: ${error instanceof Error ? error.message : String(error)}`),
    );
  const pickModel = (model: string) => void session.setModel(model).then(() => keep({ model }), report);
  const pickEffort = (effort: EffortLevel) => void session.setEffort(effort).then(() => keep({ effort }), report);
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
    const { model, effort, thinking, mode, todos, fullscreen: layout } = changes;
    if (model) await attempt(() => session.setModel(model), () => (kept.model = model));
    if (effort) await attempt(() => session.setEffort(effort), () => (kept.effort = effort));
    if (thinking !== undefined) await attempt(() => session.setThinking(thinking), () => (kept.thinking = thinking));
    if (mode) await attempt(() => session.setMode(mode), () => (kept.mode = mode));
    if (todos) {
      setTodoMode(todos);
      kept.todos = todos;
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

  const stopAllTasks = () => {
    if (!state.tasks.length) return notice("info", "Nothing runs in the background.");
    void Promise.all(state.tasks.map((task) => session.stopTask(task.id))).then(
      () => notice("info", `Stopped ${plural(state.tasks.length, "background task")}.`),
      report,
    );
  };

  /** Full screen or scrollback, kept for next time even when it's the layout already showing. */
  const pickLayout = (next: boolean) => {
    keep({ fullscreen: next });
    if (next !== fullscreen) onToggleFullscreen();
  };

  /** A new screen for a new or resumed session, scrollback included, as `claude` does. Full screen has no scrollback to clear. */
  const startOver = () => {
    if (!fullscreen) write("\x1b[2J\x1b[3J\x1b[H");
    store.reset();
  };

  const resumeSession = (id: string, title?: string) => {
    startOver();
    session.resume(id);
    loadHistory(id, state.cwd)
      .then(withPictures)
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

  /** Full screen opens a tool call's output under its row and scrolls there; scrollback prints it at the end. */
  const showOutput = (id: string) => {
    const index = state.tools[id];
    const item = index === undefined ? undefined : state.items[index];
    if (!fullscreen || !item) return store.emit({ kind: "output", id });
    setExpanded((open) => new Set(open).add(item.key));
    setReveal({ key: item.key });
  };

  const toggleTool = (key: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const copySelection = (text: string) => {
    copy(text);
    const lines = text.split("\n").length;
    setToast(lines > 1 ? `Copied ${plural(lines, "line")}` : `Copied ${plural([...text].length, "character")}`);
  };

  /** A message, with the images it still mentions. */
  const send = (text: string) => session.send(text, store.images);

  /** Runs a command with `!`, then adds it and what it printed to the conversation, as Claude Code does. */
  const runCommand = (command: string) => {
    if (!command) return;
    const id = randomUUID();
    const controller = new AbortController();
    shells.current.set(id, controller);
    store.emit({ kind: "shell", id, command });
    void runShell(command, state.cwd, controller.signal).then((result) => {
      shells.current.delete(id);
      store.emit({ kind: "shell-done", id, ...result });
      const stdout = result.stdout.replace(ANSI, "");
      const stderr = result.stderr.replace(ANSI, "");
      for (const message of shellMessages(command, stdout || stderr ? stdout : "(Bash completed with no output)", stderr)) session.note(message);
    });
  };

  const stopShells = () => {
    for (const controller of shells.current.values()) controller.abort();
  };

  /** Asks where a note written with `#` goes. */
  const openMemory = (note: string) => {
    if (!note) return;
    setOverlay({ kind: "memory", note, files: null });
    memoryFiles(state.cwd).then(
      (files) => setOverlay((open) => (open?.kind === "memory" ? { ...open, files } : open)),
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
      const events = await withPictures(historyEvents(await session.rewindConversation(uuid)));
      startOver();
      store.emit({ kind: "history", events, notice: "Went back to before your message, which is in the box to change or send again." });
      setPrefill({ text });
    }
    if (how !== "conversation") {
      const files = preview.filesChanged?.length ?? 0;
      notice("info", `Put ${plural(files, "file")} back as ${files === 1 ? "it was" : "they were"}.`);
    }
  };

  /** Your message in $EDITOR, with the terminal handed over to it until it quits. */
  const openEditor = (text: string) => {
    if (editing.current) return;
    editing.current = true;
    void (async () => {
      let edited: string | undefined;
      let failure: unknown;
      mouse?.stop();
      const suspension = await suspendTerminal();
      try {
        edited = await editText(text);
      } catch (error) {
        failure = error;
      } finally {
        await suspension.resume();
        mouse?.start();
        if (fullscreen) resendPictures();
        editing.current = false;
      }
      if (failure !== undefined) report(failure);
      else if (edited !== undefined) setPrefill({ text: edited });
    })().catch(report);
  };

  const submit = (text: string, now = false) => {
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
        if (!isEffort(argument)) return store.emit({ kind: "notice", tone: "error", text: `Effort is one of ${EFFORTS.join(", ")}.` });
        return pickEffort(argument);
      case "/output":
        return setOverlay({ kind: "output" });
      case "/plugins":
      case "/plugin":
        return setOverlay({ kind: "plugins" });
      case "/fullscreen":
        return pickLayout(!fullscreen);
      case "/rewind":
        return openRewind();
      case "/tasks":
        return setOverlay({ kind: "tasks" });
      case "/config": {
        if (!rest.length) {
          return setOverlay({
            kind: "config",
            initial: { model: state.model, effort: state.effort, thinking: state.thinking ?? true, mode: wanted.current ?? state.mode, todos: todoMode, fullscreen },
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
      default:
        // Sent now, Claude stops what it's doing and takes this instead of finishing first.
        // It waits for the stopped turn to close, so the turn's last words don't land after it.
        if (now && state.busy) return void session.interrupt().then(idle).then(() => send(text), report);
        send(text);
    }
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

  const interrupt = () => {
    stopShells();
    if (state.busy) void session.interrupt().catch(report);
  };

  const onCtrlC = () => {
    if (shellRunning) return stopShells();
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
    { name: "effort", description: "Set how hard Claude thinks", argumentHint: "[low|medium|high|xhigh|max]" },
    { name: "output", description: "Open a tool call's whole output (Ctrl+O)", argumentHint: "" },
    { name: "rewind", description: "Go back to an earlier message, its files, or both (Esc Esc)", argumentHint: "" },
    { name: "tasks", description: "What runs in the background, to stop (Ctrl+B moves work there)", argumentHint: "" },
    { name: "plugins", description: "Install, turn on or off, and remove plugins", argumentHint: "" },
    { name: "config", description: "astrocode's settings: model, effort, thinking, mode, to-dos and full screen", argumentHint: "" },
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
      case "model":
        return (
          <ModelPicker
            models={state.models}
            model={state.model}
            effort={state.effort}
            width={width}
            rows={listRows}
            onCancel={close}
            onPick={({ model, effort }) => {
              close();
              // The model first: the effort levels it takes depend on it.
              void (async () => {
                if (model) await session.setModel(model).then(() => keep({ model }));
                if (effort) await session.setEffort(effort).then(() => keep({ effort }));
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
            items={levels.map((level) => ({ key: level, label: level, note: EFFORT_NOTES[level], current: level === state.effort }))}
            empty="This model doesn't take an effort level."
            onCancel={close}
            onPick={(item) => {
              close();
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
            title="Background tasks · enter stops one"
            width={width}
            rows={listRows}
            items={state.tasks.map((task) => ({ key: task.id, label: task.description, note: TASK_KINDS[task.type] ?? task.type }))}
            empty="Nothing runs in the background. Ctrl+B moves a command or subagent Claude is waiting on there."
            onCancel={close}
            onPick={(item) => {
              close();
              session.stopTask(item.key).catch(report);
            }}
          />
        );
      case "memory":
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
      default:
        return null;
    }
  };

  const above = question ? (
    <QuestionPrompt key={question.id} request={question} width={width} onAnswer={(answers) => session.answer(question.id, answers)} />
  ) : request ? (
    <DecisionPrompt key={request.id} request={request} {...view} onDecide={(decision) => session.decide(request.id, decision)} />
  ) : (
    picker()
  );
  const pinned = showTodos && todos ? <PinnedTodos todos={todos} rows={Math.max(3, Math.min(8, rows - 20))} /> : null;
  const panel = (
    <>
      <Activity state={state} width={width} />
      {/* The message box's own top edge sets it apart; what sits above it needs a row. */}
      <Box marginTop={above || pinned ? 1 : 0} flexDirection="column">
        {pinned}
        {above}
        <Prompt
          active={!question && !request && !overlay}
          fullscreen={fullscreen}
          busy={state.busy}
          running={shellRunning}
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
          onStopTasks={stopAllTasks}
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
          exitArmed={exitArmed}
          toast={toast}
          onMode={cycleMode}
          onModel={() => setOverlay({ kind: "model" })}
          onEffort={() => setOverlay({ kind: "effort" })}
          onThinking={toggleThinking}
          onTasks={() => setOverlay({ kind: "tasks" })}
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
      >
        {panel}
      </Screen>
    );
  }

  const settled = settledCount(state.items, waiting);
  const placed = rails(state.items);
  const entries = [{ kind: "banner" as const, key: "banner" }, ...state.items.slice(0, settled).map((item, i) => ({ item, rail: placed[i]!, key: item.key }))];
  return (
    <>
      <Static key={store.epoch} items={entries}>
        {(entry) => (
          <Box key={entry.key} flexDirection="column">
            {"item" in entry ? (
              <ItemView item={entry.item} rail={entry.rail} detailed {...view} />
            ) : (
              <Banner cwd={state.cwd} home={state.home} branch={branch} width={width} />
            )}
          </Box>
        )}
      </Static>
      <Box flexDirection="column">
        {state.items.slice(settled).map((item, i) => (
          <ItemView
            key={item.key}
            item={item}
            rail={placed[settled + i]!}
            waiting={item.kind === "tool" && waiting.has(item.call.id)}
            {...view}
          />
        ))}
        <LiveView live={state.live} width={width} room={Math.max(4, rows - 16)} />
        {panel}
      </Box>
    </>
  );
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

/** This session's tool calls for the output browser, newest first. */
function toolCalls(items: Item[], { cwd, home, width }: { cwd: string; home: string; width: number }): PickerItem[] {
  return items
    .flatMap((item) => (item.kind === "tool" ? [item.call] : []))
    .reverse()
    .slice(0, 50)
    .map((call) => ({
      key: call.id,
      label: `${STATUS[call.status].glyph} ${toolLabel(call.name)}  ${fit(toolTarget(call, cwd, home), width - 40, true)}`,
      note: toolSummary(call, false),
    }));
}

/** How many leading items are finished, so they can go into scrollback for good. */
function settledCount(items: Item[], waiting: Set<string>) {
  const index = items.findIndex(
    (item) =>
      (item.kind === "tool" && (item.call.status === "running" || waiting.has(item.call.id))) || (item.kind === "shell" && item.status === "running"),
  );
  return index === -1 ? items.length : index;
}
