// The terminal front end, in one of two layouts. By default finished entries are written once into
// the terminal's own scrollback (Ink's <Static>), like `claude` does, and only the live part below
// them is redrawn. In full screen the conversation scrolls in a viewport of its own, with the mouse.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Static, useApp, useStdout, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EFFORTS, isEffort, MODES, type CommandInfo, type ModelChoice } from "../src/events";
import { loadHistory, savedSessions, type SavedSession } from "../src/history";
import type { AgentSession } from "../src/session";
import { ago, modelLabel } from "../src/view/format";
import type { Item } from "../src/view/state";
import { plural, toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { Activity } from "./activity";
import { Banner } from "./banner";
import { copy } from "./clipboard";
import { DecisionPrompt } from "./decision";
import { ItemView, LiveView } from "./entries";
import { gitInfo, type GitInfo } from "./git";
import { fit } from "./markdown-view";
import { Picker, type PickerItem } from "./picker";
import { PluginManager } from "./plugins";
import { Prompt } from "./prompt";
import { QuestionPrompt } from "./question";
import { rails } from "./rail";
import { Screen } from "./screen";
import { StatusBar } from "./status";
import type { Store } from "./store";
import { STATUS } from "./tool-row";

type Overlay =
  | { kind: "model" }
  | { kind: "effort" }
  | { kind: "resume"; sessions: SavedSession[] | null }
  | { kind: "output" }
  | { kind: "plugins" }
  | null;

const EFFORT_NOTES: Record<(typeof EFFORTS)[number], string> = {
  low: "Quick answers, least thinking",
  medium: "Balanced",
  high: "Thinks things through",
  xhigh: "Thinks harder still",
  max: "As much as it takes, for this session only",
};

/** How long the status bar says what was copied. */
const TOAST_MS = 2000;

const HELP = [
  "Enter sends. Shift+Enter, Alt+Enter, or \\ then Enter starts a new line. Type / for commands.",
  "Esc stops Claude. Shift+Tab changes the permission mode. ↑ and ↓ recall earlier messages.",
  "Ctrl+O opens a tool call's whole output. Ctrl+C clears the box, stops Claude, or exits when pressed twice.",
  "/clear starts over, /resume picks up a saved session, /model switches models, /effort sets how hard Claude thinks, /exit quits.",
  "/plugins installs, turns on or off, and removes plugins. @ followed by a path attaches a file or folder.",
  "/fullscreen, or /config fullscreen=true|false, switches to full screen and back.",
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
  const { exit } = useApp();
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
  const view = { cwd: state.cwd, home: state.home, width };

  const report = (error: unknown) =>
    store.emit({ kind: "notice", tone: "error", text: error instanceof Error ? error.message : String(error) });

  /** A new screen for a new or resumed session, scrollback included, as `claude` does. Full screen has no scrollback to clear. */
  const startOver = () => {
    if (!fullscreen) write("\x1b[2J\x1b[3J\x1b[H");
    store.reset();
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

  const submit = (text: string) => {
    store.sent.push(text);
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
        if (argument) return void session.setModel(argument).catch(report);
        return setOverlay({ kind: "model" });
      case "/effort":
        if (!argument) return setOverlay({ kind: "effort" });
        if (!isEffort(argument)) return store.emit({ kind: "notice", tone: "error", text: `Effort is one of ${EFFORTS.join(", ")}.` });
        return void session.setEffort(argument).catch(report);
      case "/output":
        return setOverlay({ kind: "output" });
      case "/plugins":
      case "/plugin":
        return setOverlay({ kind: "plugins" });
      case "/fullscreen":
        return onToggleFullscreen();
      case "/config": {
        // fullscreen= is astrocode's own key; Claude Code gets the rest.
        const ours = rest.filter((pair) => /^fullscreen=/i.test(pair));
        const theirs = rest.filter((pair) => !ours.includes(pair));
        if (!rest.length) {
          store.emit({ kind: "notice", tone: "info", text: `astrocode: fullscreen=true|false (now ${fullscreen}), or /fullscreen` });
        }
        if (!ours.length || theirs.length) session.send(["/config", ...theirs].join(" "));
        const value = ours.at(-1)?.split("=")[1]?.toLowerCase();
        if (value === undefined) return;
        if (value !== "true" && value !== "false") {
          return store.emit({ kind: "notice", tone: "error", text: "fullscreen is true or false." });
        }
        if ((value === "true") !== fullscreen) onToggleFullscreen();
        return;
      }
      default:
        session.send(text);
    }
  };

  const cycleMode = () => {
    const current = wanted.current ?? state.mode;
    const at = MODES.findIndex((mode) => mode === current);
    const nextMode = MODES[(at + 1) % MODES.length] ?? "default";
    wanted.current = nextMode;
    setModeWanted(nextMode);
    session.setMode(nextMode).catch((error: unknown) => {
      wanted.current = null;
      setModeWanted(null);
      report(error);
    });
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
    { name: "model", description: "Switch the model", argumentHint: "" },
    { name: "effort", description: "Set how hard Claude thinks", argumentHint: "[low|medium|high|xhigh|max]" },
    { name: "output", description: "Open a tool call's whole output (Ctrl+O)", argumentHint: "" },
    { name: "plugins", description: "Install, turn on or off, and remove plugins", argumentHint: "" },
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
          <Picker
            title="Switch model"
            width={width}
            rows={listRows}
            items={state.models.map((model) => ({
              key: model.value,
              label: model.name,
              note: model.description,
              current: isCurrentModel(state.model, model),
            }))}
            empty="Claude Code hasn't listed its models yet. Try again in a moment."
            onCancel={close}
            onPick={(item) => {
              close();
              session.setModel(item.key).catch(report);
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
              if (isEffort(item.key)) session.setEffort(item.key).catch(report);
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

  const panel = (
    <>
      <Activity state={state} width={width} />
      <Box marginTop={1} flexDirection="column">
        {question ? (
          <QuestionPrompt key={question.id} request={question} width={width} onAnswer={(answers) => session.answer(question.id, answers)} />
        ) : request ? (
          <DecisionPrompt key={request.id} request={request} {...view} onDecide={(decision) => session.decide(request.id, decision)} />
        ) : (
          picker()
        )}
        <Prompt
          active={!question && !request && !overlay}
          busy={state.busy}
          width={width}
          cwd={state.cwd}
          history={store.sent}
          commands={[...commands, ...state.commands.filter((command) => !commands.some((own) => own.name === command.name))]}
          onSubmit={submit}
          onInterrupt={() => void session.interrupt().catch(report)}
          onCycleMode={cycleMode}
          onCtrlC={onCtrlC}
          onExit={exit}
          onOpenOutput={() => setOverlay({ kind: "output" })}
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

function currentModel(state: { model?: string; models: ModelChoice[] }) {
  return state.models.find((model) => isCurrentModel(state.model, model));
}

function isCurrentModel(current: string | undefined, choice: ModelChoice) {
  return current !== undefined && (current === choice.value || modelLabel(current) === choice.name);
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
  const index = items.findIndex((item) => item.kind === "tool" && (item.call.status === "running" || waiting.has(item.call.id)));
  return index === -1 ? items.length : index;
}
