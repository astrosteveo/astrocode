// The agents view: Claude Code's background sessions, as `claude agents` lists them, opened with ←
// in an empty message box or with `astrocode agents`. The session open in astrocode heads its
// project's group. Type a task and press Enter to start a background session on it; Enter on a
// row opens it, ↑↓ choose, Space shows more, Ctrl+X stops and then deletes, Esc goes back.
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { attaches, dispatch, groupAgents, listAgents, prLabel, projectOf, removeAgent, STATE_LABELS, stopAgent, summary, type Agent, type AgentState, type SessionSettings } from "../src/agents";
import { installedBinary } from "../src/claude";
import { topLevelEnv } from "../src/session";
import { ago } from "../src/view/format";
import type { State } from "../src/view/state";
import { shortPath } from "../src/view/tools";
import { ChoiceRow } from "./choice";
import { lendTerminal } from "./editor";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import type { Store } from "./store";
import { PALETTE } from "./theme";

/** How often the list is read again. */
const POLL_MS = 2000;
/** How long a first Ctrl+X, or Ctrl+C, waits for the second. */
const ARM_MS = 2000;
/** The widest the name column gets. */
const NAME_CELLS = 32;

/** The session open in astrocode, as the view shows it: whether Claude works in it or waits on you. */
export type HereState = "working" | "blocked" | "idle";

/** Where the session open in astrocode is: working, waiting on you, or idle and free to move to the background. */
export function hereState(state: State, shells: number): HereState {
  if (state.pending.length || state.questions.length || state.elicitations.length) return "blocked";
  // What runs in the background, Claude's or yours, would stop with this Claude Code.
  if (state.busy || state.tasks.length || shells) return "working";
  return "idle";
}

const LOOK: Record<AgentState | "idle", { glyph: string; color: string; label: string }> = {
  working: { glyph: "◌", color: PALETTE.teal, label: STATE_LABELS.working },
  blocked: { glyph: "●", color: PALETTE.gold, label: STATE_LABELS.blocked },
  done: { glyph: "✓", color: PALETTE.teal, label: STATE_LABELS.done },
  failed: { glyph: "✕", color: PALETTE.rose, label: STATE_LABELS.failed },
  stopped: { glyph: "■", color: PALETTE.ember, label: STATE_LABELS.stopped },
  idle: { glyph: "◇", color: PALETTE.haze, label: "Idle" },
};

/** One line of the list: a project's heading, a session, or the gap between projects. */
type Line = { kind: "folder"; folder: string } | { kind: "here" } | { kind: "agent"; agent: Agent } | { kind: "gap" };

/** The rows of the list in order, the session open here first under its project, and the lines that draw them. */
export function listLines(agents: Agent[], here: { cwd: string; folder: string } | null, cwd: string) {
  const groups = groupAgents(agents, here?.cwd ?? cwd);
  if (here && !groups.some((group) => group.folder === here.folder)) groups.unshift({ folder: here.folder, agents: [] });
  const lines: Line[] = [];
  for (const group of groups) {
    if (lines.length) lines.push({ kind: "gap" });
    lines.push({ kind: "folder", folder: group.folder });
    if (here && group.folder === here.folder) lines.push({ kind: "here" });
    for (const agent of group.agents) lines.push({ kind: "agent", agent });
  }
  return lines;
}

const keyOf = (line: Line) => (line.kind === "here" ? "here" : line.kind === "agent" ? line.agent.id : undefined);

type Props = {
  /** The session open in astrocode, if there is one: Esc goes back to it. */
  here: { store: Store; sessionId?: string; title?: string } | null;
  /** Where a new session starts. */
  cwd: string;
  home: string;
  /** What a new session runs with. */
  settings: SessionSettings;
  onBack: () => void;
  /** Moves a background session into astrocode. Rejects with what went wrong. */
  onOpen: (agent: Agent) => Promise<void>;
  /** Quits astrocode. Rejects with what went wrong, such as the open session still working. */
  onExit: () => Promise<void>;
};

export function AgentsView({ here, cwd, home, settings, onBack, onOpen, onExit }: Props) {
  const { columns, rows } = useWindowSize();
  const width = Math.max(40, columns);
  const { suspendTerminal } = useApp();
  const live = useHere(here?.store);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | undefined>(here ? "here" : undefined);
  const [peek, setPeek] = useState(false);
  /** What a first Ctrl+X or Ctrl+C readied, until it's pressed again or the moment passes. */
  const [armed, setArmed] = useState<{ action: "delete"; id: string } | { action: "exit" } | null>(null);
  /** Something under way, such as opening a session, which keys wait for. */
  const [busy, setBusy] = useState(false);
  const attaching = useRef(false);

  const refresh = () =>
    listAgents().then(
      (list) => {
        setAgents(list);
        setError(null);
      },
      (failure: unknown) => setError(messageOf(failure)),
    );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!attaching.current) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  // A conversation open here that ran in the background before is still listed there, stopped:
  // its row here stands for it, named as it was there.
  const others = (agents ?? []).filter((agent) => !here?.sessionId || agent.sessionId !== here.sessionId);
  const title = here?.title ?? agents?.find((agent) => here?.sessionId && agent.sessionId === here.sessionId)?.name;
  const hereRow = here && live ? { cwd: live.cwd, folder: projectOf(live.cwd) } : null;
  const lines = listLines(others, hereRow, cwd);
  const keys = lines.flatMap((line) => keyOf(line) ?? []);
  const index = Math.max(0, keys.indexOf(selected ?? ""));
  const current = keys[index];
  const focused = lines.find((line) => keyOf(line) === current);
  const hereLook = live ? hereState(live, here?.store.shells.size ?? 0) : "idle";

  const say = (text: string, tone: "info" | "error" = "info") => setNote({ text, tone });
  /** Runs an action, saying what went wrong if it fails. */
  const act = (work: () => Promise<void>) => {
    setBusy(true);
    work()
      .catch((failure: unknown) => say(messageOf(failure), "error"))
      .finally(() => setBusy(false));
  };

  const start = (task: string) =>
    act(async () => {
      say("Starting a background session…");
      const id = await dispatch(task, cwd, settings);
      setText("");
      await refresh();
      setSelected(id);
      say(`Started ${id} in ${shortPath(cwd, "", home)}.`);
    });

  /** `claude attach`, in Claude Code's own screen, with the terminal lent to it until you leave. */
  const attach = (agent: Agent) =>
    act(async () => {
      attaching.current = true;
      const suspension = await suspendTerminal();
      try {
        await lendTerminal([installedBinary(), "attach", agent.id], topLevelEnv());
      } finally {
        await suspension.resume();
        attaching.current = false;
      }
      setNote(null);
      await refresh();
    });

  const open = () => {
    if (!focused || focused.kind === "folder" || focused.kind === "gap") return;
    if (focused.kind === "here") return onBack();
    const agent = focused.agent;
    if (attaches(agent)) return attach(agent);
    act(async () => {
      say(`Opening ${agent.name}…`);
      await onOpen(agent);
    });
  };

  const stopOrDelete = () => {
    if (!focused || focused.kind !== "agent") {
      if (focused?.kind === "here") say("This session is open in astrocode. Enter goes back to it.");
      return;
    }
    const agent = focused.agent;
    if (armed?.action === "delete" && armed.id === agent.id) {
      setArmed(null);
      return act(async () => {
        await removeAgent(agent.id);
        await refresh();
        say(`Deleted ${agent.name}.`);
      });
    }
    if (!agent.alive) {
      setArmed({ action: "delete", id: agent.id });
      return say(`Ctrl+X again to delete ${agent.name}.`);
    }
    act(async () => {
      await stopAgent(agent.id);
      await refresh();
      setArmed({ action: "delete", id: agent.id });
      say(`Stopped ${agent.name}. Ctrl+X again to delete it.`);
    });
  };

  const quit = () => act(onExit);

  useInput((input, key) => {
    if (key.eventType === "release" || busy) return;
    if (key.escape) {
      if (peek) return setPeek(false);
      if (text) return setText("");
      return here ? onBack() : quit();
    }
    if (key.ctrl && input === "c") {
      if (text) return setText("");
      if (armed?.action === "exit") return quit();
      setArmed({ action: "exit" });
      return say("Ctrl+C again to quit.");
    }
    if (key.upArrow || key.downArrow) {
      const next = keys[Math.max(0, Math.min(keys.length - 1, index + (key.upArrow ? -1 : 1)))];
      return setSelected(next);
    }
    if (key.return) return text.trim() ? start(text.trim()) : open();
    if (key.ctrl && input === "x") return stopOrDelete();
    if (key.ctrl && input === "u") return setText("");
    if (key.backspace || key.delete) return setText((typed) => [...typed].slice(0, -1).join(""));
    if (input === " " && !text) return setPeek((open) => !open);
    if (key.ctrl || key.meta || key.tab || !input) return;
    // A paste can bring line breaks; a task is one line.
    setText((typed) => typed + input.replace(/[\r\n]+/g, " "));
  });

  const inner = width - 2;
  const nameCells = Math.min(
    NAME_CELLS,
    Math.floor(inner * 0.3),
    Math.max(8, ...others.map((agent) => cellWidth(agent.name)), here ? cellWidth(hereName(title)) : 0),
  );
  const ageCells = Math.max(0, ...others.map((agent) => ago(agent.updatedAt).length));
  const prCells = Math.max(0, ...others.map((agent) => prLabel(agent).length));

  const counts = { blocked: 0, working: 0, done: 0 };
  for (const agent of others) if (agent.state in counts) counts[agent.state as keyof typeof counts] += 1;
  const tally = [`${counts.blocked} need${counts.blocked === 1 ? "s" : ""} input`, `${counts.working} working`, `${counts.done} done`].join(" · ");
  const newSessions = [settings.model, settings.effort && `${settings.effort} effort`, settings.mode, shortPath(cwd, "", home)].filter(Boolean).join(" · ");

  const peekLines = peek && focused ? peekOf(focused, title, hereLook, live?.cwd, home) : [];
  const peekRows = peekLines.reduce((sum, line) => sum + Math.max(1, Math.ceil(cellWidth(line.text) / Math.max(1, inner - 10))), 0) + (peekLines.length ? 1 : 0);
  // Less the header and the gap under it, the message box with its edges and the gap over it,
  // the keys' line, the note, and a spare row so the screen never scrolls.
  const room = Math.max(3, rows - 10 - peekRows);
  const at = Math.max(0, lines.findIndex((line) => keyOf(line) === current));
  const first = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, lines.length - room));
  const shown = lines.slice(first, first + room);

  const enter = !focused || focused.kind === "folder" || focused.kind === "gap" ? "" : focused.kind === "here" ? "enter back to it" : attaches(focused.agent) ? "enter attach" : "enter open here";
  const stop = focused?.kind === "agent" ? (focused.agent.alive ? "ctrl+x stop" : "ctrl+x delete") : "";
  const hints = text ? ["enter start", "esc clear"] : [enter, "space peek", stop, here ? "esc back" : "esc quit"].filter(Boolean);

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Text>
        <Text bold color={PALETTE.star}>
          Agents
        </Text>
        <Text color={PALETTE.dust}>{`  New sessions: ${newSessions}`}</Text>
      </Text>
      <Text color={PALETTE.haze}>{agents ? tally : "Reading Claude Code's background sessions…"}</Text>
      <Box flexDirection="column" marginTop={1} height={room} overflow="hidden">
        {error ? <Text color={PALETTE.rose}>{error}</Text> : null}
        {agents && !lines.length ? <Text color={PALETTE.haze}>No background sessions yet. Describe a task below to start one.</Text> : null}
        {shown.map((line, i) => {
          if (line.kind === "gap") return <Text key={`gap-${first + i}`}> </Text>;
          if (line.kind === "folder")
            return (
              <Text key={`folder-${line.folder}`} color={PALETTE.haze}>
                {fit(shortPath(line.folder, "", home), inner, true)}
              </Text>
            );
          const row =
            line.kind === "here"
              ? { key: "here", name: hereName(title), look: LOOK[hereLook], said: "open in astrocode", prs: "", age: "" }
              : { key: line.agent.id, name: line.agent.name, look: LOOK[line.agent.state], said: summary(line.agent), prs: prLabel(line.agent), age: ago(line.agent.updatedAt) };
          const tail = (prCells ? 2 + prCells : 0) + (ageCells ? 2 + ageCells : 0);
          const middle = Math.max(0, inner - 2 - 2 - nameCells - 2 - tail);
          const state = `${row.look.label}${row.said ? " · " : ""}`;
          return (
            <ChoiceRow key={row.key} selected={row.key === current} width={inner}>
              <Text wrap="truncate">
                <Text color={row.look.color}>{`${row.look.glyph} `}</Text>
                <Text color={PALETTE.star}>{pad(fit(row.name, nameCells, false), nameCells)}</Text>
                {"  "}
                <Text color={row.look.color}>{fit(state, middle, false)}</Text>
                <Text color={PALETTE.haze}>{pad(fit(row.said, Math.max(0, middle - cellWidth(state)), false), Math.max(0, middle - cellWidth(state)))}</Text>
                <Text color={PALETTE.dust}>{prCells ? `  ${row.prs.padStart(prCells)}` : ""}</Text>
                <Text color={PALETTE.dust}>{ageCells ? `  ${row.age.padStart(ageCells)}` : ""}</Text>
              </Text>
            </ChoiceRow>
          );
        })}
      </Box>
      {peekLines.length ? (
        <Box flexDirection="column" marginTop={1}>
          {peekLines.map((line) => (
            <Box key={line.label}>
              <Box width={10} flexShrink={0}>
                <Text color={PALETTE.dust}>{line.label}</Text>
              </Box>
              <Text color={PALETTE.star}>{line.text}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        <Text color={PALETTE.gold}>{"─".repeat(inner)}</Text>
        <Text>
          <Text color={PALETTE.gold}>{"❯ "}</Text>
          {text ? <Text color={PALETTE.star}>{fit(text, inner - 3, true)}</Text> : <Text color={PALETTE.dust}>describe a task for a new session</Text>}
          <Text inverse> </Text>
        </Text>
        <Text color={PALETTE.dust}>{"─".repeat(inner)}</Text>
      </Box>
      <Text color={PALETTE.dust}>{`  ${hints.join(" · ")}`}</Text>
      <Text color={note?.tone === "error" ? PALETTE.rose : PALETTE.haze} wrap="truncate">
        {note ? `  ${note.text}` : " "}
      </Text>
    </Box>
  );
}

/** The open session's state as it changes, so its row says whether Claude is still working. */
function useHere(store: Store | undefined) {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIPTION, store?.getSnapshot ?? NO_STATE);
}

const NO_SUBSCRIPTION = () => () => {};
const NO_STATE = () => undefined;

function hereName(title?: string) {
  return title ?? "this session";
}

/** What Space shows about a row: what it was asked, what it says now, its result, pull requests and folder. */
function peekOf(line: Line, title: string | undefined, state: HereState, cwd: string | undefined, home: string) {
  const rows: { label: string; text: string }[] = [];
  const add = (label: string, text: string | undefined) => {
    if (text) rows.push({ label, text });
  };
  if (line.kind === "here") {
    add("Session", `${hereName(title)} · ${LOOK[state].label}, open in astrocode`);
    add("Folder", cwd && shortPath(cwd, "", home));
    return rows;
  }
  if (line.kind !== "agent") return rows;
  const agent = line.agent;
  add("Session", `${agent.name} · ${agent.id} · ${STATE_LABELS[agent.state]}${agent.waitingFor ? `, waiting on a ${agent.waitingFor}` : ""}`);
  add("Asked", agent.intent);
  add("Now", agent.state === "done" ? undefined : agent.detail);
  add("Result", agent.result);
  add("PRs", agent.prs.map((pr) => pr.href).join("  "));
  add("Folder", shortPath(agent.cwd, "", home));
  add("Enter", attaches(agent) ? "joins it where it runs, in Claude Code's own screen" : "moves it into astrocode");
  return rows;
}

function pad(text: string, cells: number) {
  return text + " ".repeat(Math.max(0, cells - cellWidth(text)));
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
