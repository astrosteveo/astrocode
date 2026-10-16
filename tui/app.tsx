// The terminal front end. Finished entries are written once into the terminal's own scrollback
// (Ink's <Static>), like `claude` does; only the live part below them is redrawn.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Static, Text, useApp, useStdout, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MODES, type CommandInfo, type ModelChoice } from "../src/events";
import { loadHistory, savedSessions, type SavedSession } from "../src/history";
import type { AgentSession } from "../src/session";
import { ago, compact, duration, modelLabel } from "../src/view/format";
import type { Item, Live } from "../src/view/state";
import { toolLabel, toolSummary, toolTarget } from "../src/view/tools";
import { Activity } from "./activity";
import { Banner } from "./banner";
import { DecisionPrompt } from "./decision";
import { gitInfo, type GitInfo } from "./git";
import { cellWidth, wrapText } from "./markdown";
import { fit, Markdown } from "./markdown-view";
import { FullOutput } from "./output";
import { Picker, type PickerItem } from "./picker";
import { Prompt } from "./prompt";
import { QuestionPrompt } from "./question";
import { StatusBar } from "./status";
import type { Store } from "./store";
import { ACCENT, COLOR } from "./theme";
import { DraftRow, STATUS, ToolRow } from "./tool-row";

type Entry = Item | { kind: "banner"; key: string };

type Overlay = { kind: "model" } | { kind: "resume"; sessions: SavedSession[] | null } | { kind: "output" } | null;

/** astrocode's own commands. Claude Code's come after them in the menu. */
const COMMANDS: CommandInfo[] = [
  { name: "clear", description: "Start a new session on a clean screen", argumentHint: "" },
  { name: "resume", description: "Pick up a saved session from this folder", argumentHint: "" },
  { name: "model", description: "Switch the model", argumentHint: "" },
  { name: "output", description: "Print a tool call's whole output (Ctrl+O)", argumentHint: "" },
  { name: "help", description: "Keys and commands", argumentHint: "" },
  { name: "exit", description: "Quit astrocode", argumentHint: "" },
];

const HELP = [
  "Enter sends. Shift+Enter, Alt+Enter, or \\ then Enter starts a new line. Type / for commands.",
  "Esc stops Claude. Shift+Tab changes the permission mode. ↑ and ↓ recall earlier messages.",
  "Ctrl+O opens a tool call's whole output. Ctrl+C clears the box, stops Claude, or exits when pressed twice.",
  "/clear starts over, /resume picks up a saved session, /model switches models, /exit quits.",
].join("\n");

export function App({ store, session, branch }: { store: Store; session: AgentSession; branch?: string }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { exit } = useApp();
  const { write } = useStdout();
  const { columns, rows } = useWindowSize();
  const width = Math.max(24, columns);
  const history = useRef<string[]>([]);
  const [exitArmed, setExitArmed] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  // The mode last asked for, until Claude Code confirms it, so quick Shift+Tabs keep stepping.
  const [modeWanted, setModeWanted] = useState<PermissionMode | null>(null);
  const wanted = useRef<PermissionMode | null>(null);
  const git = useGit(state.cwd, state.items.filter((item) => item.kind === "turn").length);

  useEffect(() => {
    if (!exitArmed) return;
    const timer = setTimeout(() => setExitArmed(false), 2000);
    return () => clearTimeout(timer);
  }, [exitArmed]);

  useEffect(() => {
    if (wanted.current === state.mode) {
      wanted.current = null;
      setModeWanted(null);
    }
  }, [state.mode]);

  const waiting = new Set([...state.pending.map((request) => request.id), ...state.questions.map((request) => request.id)]);
  const settled = settledCount(state.items, waiting);
  const entries: Entry[] = [{ kind: "banner", key: "banner" }, ...state.items.slice(0, settled)];
  const question = state.questions[0];
  const request = state.pending[0];
  const view = { cwd: state.cwd, home: state.home, width };

  const report = (error: unknown) =>
    store.emit({ kind: "notice", tone: "error", text: error instanceof Error ? error.message : String(error) });

  /** A new screen for a new or resumed session, scrollback included, as `claude` does. */
  const startOver = () => {
    write("\x1b[2J\x1b[3J\x1b[H");
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

  const submit = (text: string) => {
    history.current.push(text);
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
        return store.emit({ kind: "notice", tone: "info", text: HELP });
      case "/resume":
        return argument ? resumeSession(argument) : openResume();
      case "/model":
        if (argument) return void session.setModel(argument).catch(report);
        return setOverlay({ kind: "model" });
      case "/output":
        return setOverlay({ kind: "output" });
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

  const picker = () => {
    switch (overlay?.kind) {
      case "model":
        return (
          <Picker
            title="Switch model"
            width={width}
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
      case "resume":
        return (
          <Picker
            title="Resume a session"
            width={width}
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
            items={toolCalls(state.items, view)}
            empty="Claude hasn't used any tools in this session yet."
            onCancel={close}
            onPick={(item) => {
              close();
              store.emit({ kind: "output", id: item.key });
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Static key={store.epoch} items={entries}>
        {(entry, index) => (
          <Box key={entry.key} marginTop={gap(entries[index - 1], entry)} flexDirection="column">
            {entry.kind === "banner" ? (
              <Banner cwd={state.cwd} home={state.home} branch={branch} width={width} />
            ) : (
              <ItemView item={entry} detailed {...view} />
            )}
          </Box>
        )}
      </Static>
      <Box flexDirection="column">
        {state.items.slice(settled).map((item, i) => (
          <Box key={item.key} marginTop={gap(state.items[settled + i - 1], item)} flexDirection="column">
            <ItemView item={item} waiting={item.kind === "tool" && waiting.has(item.call.id)} {...view} />
          </Box>
        ))}
        <LiveView live={state.live} width={width} rows={rows} />
        <Activity state={state} />
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
            history={history.current}
            commands={[...COMMANDS, ...state.commands.filter((command) => !COMMANDS.some((own) => own.name === command.name))]}
            onSubmit={submit}
            onInterrupt={() => void session.interrupt().catch(report)}
            onCycleMode={cycleMode}
            onCtrlC={onCtrlC}
            onExit={exit}
            onOpenOutput={() => setOverlay({ kind: "output" })}
          />
          <StatusBar state={state} mode={modeWanted ?? state.mode} git={git} width={width} exitArmed={exitArmed} />
        </Box>
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

/** A blank line between entries, except between tool rows, which read as one list. */
function gap(before: Entry | undefined, entry: Entry) {
  if (!before) return 0;
  return before.kind === "tool" && entry.kind === "tool" ? 0 : 1;
}

type ViewProps = { cwd: string; home: string; width: number };

function ItemView({ item, detailed = false, waiting = false, ...view }: { item: Item; detailed?: boolean; waiting?: boolean } & ViewProps) {
  switch (item.kind) {
    case "prompt":
      return (
        <Box flexDirection="column">
          {wrapText(item.text, view.width - 2, true).map((row, i) => (
            <Text key={i}>
              <Text color={ACCENT}>▌ </Text>
              <Text bold>{row.map((run) => run.text).join("")}</Text>
            </Text>
          ))}
        </Box>
      );
    case "text":
      return <Markdown text={item.text} width={view.width} />;
    case "thinking":
      return (
        <Text dimColor italic>
          {`✻ ${item.text}`}
        </Text>
      );
    case "tool":
      return <ToolRow call={item.call} waiting={waiting} detailed={detailed} {...view} />;
    case "output":
      return <FullOutput call={item.call} {...view} />;
    case "turn":
      return <TurnEnd item={item} width={view.width} />;
    case "notice":
      return (
        <Box>
          <Box flexShrink={0} width={2}>
            <Text color={item.tone === "error" ? COLOR.error : COLOR.info}>{item.tone === "error" ? "✗" : "ℹ"}</Text>
          </Box>
          <Text color={item.tone === "error" ? COLOR.error : undefined} dimColor={item.tone !== "error"}>
            {item.text}
          </Text>
        </Box>
      );
  }
}

/** `─── ✦ Worked for 42s · ↓ 1.2k tokens ─────`, after nebula-ui's turn divider. */
function TurnEnd({ item, width }: { item: Extract<Item, { kind: "turn" }>; width: number }) {
  const { label, color } = {
    finished: { label: `✦ Worked for ${duration(item.durationMs)}`, color: ACCENT },
    stopped: { label: `⊘ Stopped after ${duration(item.durationMs)}`, color: COLOR.warning },
    failed: { label: `✗ Failed after ${duration(item.durationMs)}`, color: COLOR.error },
  }[item.outcome];
  const words = ` ${label}${item.tokens > 0 ? ` · ↓ ${compact(item.tokens)} tokens` : ""} `;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLOR.muted}>───</Text>
        <Text color={color}>{words}</Text>
        <Text color={COLOR.muted}>{"─".repeat(Math.max(0, width - 3 - cellWidth(words)))}</Text>
      </Text>
      {item.detail ? <Text color={COLOR.error}>{item.detail}</Text> : null}
    </Box>
  );
}

/** What Claude is writing right now. Only the end fits on screen; the whole reply lands in scrollback when it's done. */
function LiveView({ live, width, rows }: { live: Live | null; width: number; rows: number }) {
  if (!live) return null;
  const blocks = live.blocks.slice(live.finalized);
  const text = blocks
    .filter((block) => block?.kind === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  const tool = blocks.findLast((block) => block?.kind === "tool");
  if (!text && !tool?.name) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      {text ? <Markdown text={tail(text, width, Math.max(4, rows - 16))} width={width} /> : null}
      {tool?.name ? <DraftRow name={tool.name} /> : null}
    </Box>
  );
}

/** The last lines of `text` that fill about `room` rows at this width. */
function tail(text: string, width: number, room: number) {
  const lines = text.split("\n");
  let used = 0;
  let start = lines.length;
  while (start > 0) {
    const height = Math.max(1, Math.ceil(cellWidth(lines[start - 1] ?? "") / width));
    if (used + height > room) break;
    used += height;
    start -= 1;
  }
  return lines.slice(start).join("\n");
}
