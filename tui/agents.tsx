// The agents view, as Claude Code's `claude agents` is: the conversations astrocode runs, and
// Claude Code's background sessions, opened with ← in an empty message box or with `astrocode
// agents`. astrocode's conversations head their projects' groups and carry on while you're here or
// in another one. Type a task and press Enter to start it in a new one, in the chosen row's
// project, and stay here to start more; Ctrl+Enter starts it and opens it. Enter or → on a row
// opens it, ↑↓ choose a row, or a project while a task is typed, Space shows more, Ctrl+X stops
// and then deletes, Esc goes back.
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { attaches, groupAgents, leftForAgentView, listAgents, prLabel, projectOf, removeAgent, STATE_LABELS, stopAgent, summary, type Agent, type AgentState, type SessionSettings } from "../src/agents";
import { installedBinary } from "../src/claude";
import { topLevelEnv } from "../src/session";
import { ago } from "../src/view/format";
import type { State } from "../src/view/state";
import { shortPath } from "../src/view/tools";
import { describe } from "./activity";
import { ChoiceRow } from "./choice";
import { lendTerminal } from "./editor";
import { firstPrompt, liveState, titleOf, type Conversation, type Fleet } from "./fleet";
import { cellWidth } from "./markdown";
import { fit } from "./markdown-view";
import { PALETTE } from "./theme";

/** How often the list is read again. */
const POLL_MS = 2000;
/** How long a first Ctrl+X, or Ctrl+C, waits for the second. */
const ARM_MS = 2000;
/** The widest the name column gets. */
const NAME_CELLS = 32;

/** The state a row shows for one of astrocode's conversations: its live state, or once it's idle, how its last turn ended. */
export function mineState(state: State, shells: number): AgentState | "idle" {
  const live = liveState(state, shells);
  if (live !== "idle") return live;
  const turn = state.items.findLast((item) => item.kind === "turn");
  if (turn?.kind !== "turn") return "idle";
  return turn.outcome === "finished" ? "done" : turn.outcome;
}

/** What its row says: what Claude is doing, what went wrong, or once it's done, the start of Claude's last reply. */
export function mineSummary(state: State, shells: number) {
  // "Working" says only what the row's state already does.
  if (liveState(state, shells) !== "idle") return describe(state).replace(/^Working$/, "");
  const turn = state.items.findLast((item) => item.kind === "turn");
  if (turn?.kind === "turn" && turn.outcome !== "finished" && turn.detail) return turn.detail;
  const reply = state.items.findLast((item) => item.kind === "text" && !item.command);
  return reply?.kind === "text" ? plainLine(reply.text) : "";
}

/** The first line of Markdown with something in it, without the marks that would only be noise on a row. */
function plainLine(markdown: string) {
  const line = markdown.split("\n").find((one) => one.trim()) ?? "";
  return line.replace(/^\s*(?:#+|>|[-*]|\d+\.)\s+/, "").replace(/\*\*|`/g, "").trim();
}

/**
 * Whether the view would list a conversation besides the one whose session is `except`: one of
 * Claude Code's background sessions, which the message box mentions ← for until the view has been
 * opened once. A `claude` that can't list them has nothing to show there.
 */
export async function othersListed(except: string | undefined) {
  const agents = await listAgents().catch(() => []);
  return agents.some((agent) => !agent.sessionId || agent.sessionId !== except);
}

const LOOK: Record<AgentState | "idle", { glyph: string; color: string; label: string }> = {
  working: { glyph: "◌", color: PALETTE.teal, label: STATE_LABELS.working },
  blocked: { glyph: "●", color: PALETTE.gold, label: STATE_LABELS.blocked },
  done: { glyph: "✓", color: PALETTE.teal, label: STATE_LABELS.done },
  failed: { glyph: "✕", color: PALETTE.rose, label: STATE_LABELS.failed },
  stopped: { glyph: "■", color: PALETTE.ember, label: STATE_LABELS.stopped },
  idle: { glyph: "◇", color: PALETTE.haze, label: "Idle" },
};

/** One line of the list: a project's heading, one of astrocode's conversations, a background session, or the gap between projects. */
type Line = { kind: "folder"; folder: string } | { kind: "mine"; key: string; folder: string } | { kind: "agent"; agent: Agent } | { kind: "gap" };

/**
 * The rows of the list in order, and the lines that draw them: by project, `cwd`'s first, with
 * astrocode's conversations first in each, in the order they started.
 */
export function listLines(agents: Agent[], mine: readonly { key: string; cwd: string }[], cwd: string) {
  const lines: Line[] = [];
  for (const group of groupAgents(agents, cwd, mine.map((one) => projectOf(one.cwd)))) {
    if (lines.length) lines.push({ kind: "gap" });
    lines.push({ kind: "folder", folder: group.folder });
    for (const one of mine) if (projectOf(one.cwd) === group.folder) lines.push({ kind: "mine", key: one.key, folder: group.folder });
    for (const agent of group.agents) lines.push({ kind: "agent", agent });
  }
  return lines;
}

/**
 * Where a new session starts with `line` chosen: in its project, as Claude Code's agent view does
 * when grouped by directory. In the project astrocode runs in, that's `cwd` itself, which may be a
 * subfolder or worktree of it.
 */
export function startFolder(line: Line | undefined, cwd: string) {
  const folder = line?.kind === "agent" ? line.agent.folder : line?.kind === "mine" ? line.folder : undefined;
  return !folder || folder === projectOf(cwd) ? cwd : folder;
}

const keyOf = (line: Line) => (line.kind === "mine" ? line.key : line.kind === "agent" ? line.agent.id : undefined);

/**
 * The row ↑ or ↓ chooses from `current`: the session before or after it, or by project, the first
 * row of the project before or after its own. Neither goes past the ends.
 */
export function moveTo(lines: Line[], current: string | undefined, step: -1 | 1, byProject: boolean) {
  const groups: string[][] = [];
  for (const line of lines) {
    if (line.kind === "folder") groups.push([]);
    const key = keyOf(line);
    if (key) groups.at(-1)?.push(key);
  }
  const within = (at: number, length: number) => Math.max(0, Math.min(length - 1, at));
  if (!byProject) {
    const keys = groups.flat();
    return keys[within(keys.indexOf(current ?? "") + step, keys.length)];
  }
  const at = groups.findIndex((group) => group.includes(current ?? ""));
  return groups[within(at + step, groups.length)]?.[0];
}

/** Where the highlight is drawn: on the chosen row, or while a task is typed, on its project's heading. */
export function chosenLine(lines: Line[], current: string | undefined, typing: boolean) {
  const at = lines.findIndex((line) => keyOf(line) === current);
  return typing && at >= 0 ? lines.slice(0, at).findLastIndex((line) => line.kind === "folder") : at;
}

type Props = {
  /** The conversations astrocode runs. */
  fleet: Fleet;
  /** The one the view was opened from, which Esc goes back to. */
  here?: string;
  /** Where a new session starts in this project. Another project's row starts it in that project. */
  cwd: string;
  home: string;
  /** What a new session runs with. */
  settings: SessionSettings;
  /** Said on the note line as the view opens, such as why astrocode didn't quit. */
  notice?: string;
  /** Shows one of astrocode's conversations. */
  onShow: (key: string) => void;
  /** Moves a background session into astrocode and shows it. Rejects with what went wrong. */
  onOpen: (agent: Agent) => Promise<void>;
  /** Starts a conversation in astrocode, in `cwd`, with `task` as its first message, and gives its key. Rejects with what went wrong. */
  onStart: (task: string, cwd: string) => Promise<string>;
  /** Stops one of astrocode's conversations. It's saved, so /resume can pick it up again. */
  onStop: (key: string) => void;
  /** Quits astrocode. Rejects with what went wrong, such as a conversation still working. */
  onExit: () => Promise<void>;
};

export function AgentsView({ fleet, here, cwd, home, settings, notice, onShow, onOpen, onStart, onStop, onExit }: Props) {
  const { columns, rows } = useWindowSize();
  const width = Math.max(40, columns);
  const { suspendTerminal } = useApp();
  const mine = useFleet(fleet);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(notice ? { text: notice, tone: "error" } : null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | undefined>(here);
  const [peek, setPeek] = useState(false);
  /** What a first Ctrl+X or Ctrl+C readied, until it's pressed again or the moment passes. */
  const [armed, setArmed] = useState<{ action: "delete"; id: string } | { action: "exit" } | null>(null);
  /** Something under way, such as opening a session, which keys wait for. */
  const [busy, setBusy] = useState(false);
  const attaching = useRef(false);

  const refresh = () =>
    Promise.all([
      listAgents().then(
        (list) => {
          setAgents(list);
          setError(null);
        },
        (failure: unknown) => setError(messageOf(failure)),
      ),
      Promise.all(fleet.getSnapshot().map(async (one) => [one.key, await titleOf(one)] as const)).then((named) => setTitles(Object.fromEntries(named))),
    ]);

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

  // A conversation in astrocode that ran in the background before is still listed there, stopped:
  // its row here stands for it, named as it was there.
  const ids = new Map(mine.flatMap((one) => (one.session.knownId ? [[one.session.knownId, one.key] as const] : [])));
  const others = (agents ?? []).filter((agent) => !agent.sessionId || !ids.has(agent.sessionId));
  const nameOf = (one: Conversation) =>
    titles[one.key] ?? agents?.find((agent) => agent.sessionId && ids.get(agent.sessionId) === one.key)?.name ?? firstPrompt(one.store.getSnapshot()) ?? "New conversation";
  const lines = listLines(others, mine, fleet.get(here)?.cwd ?? cwd);
  const keys = lines.flatMap((line) => keyOf(line) ?? []);
  const index = Math.max(0, keys.indexOf(selected ?? ""));
  const current = keys[index];
  const focused = lines.find((line) => keyOf(line) === current);
  const focusedMine = focused?.kind === "mine" ? fleet.get(focused.key) : undefined;
  const target = startFolder(focused, cwd);
  const back = fleet.get(here);

  const say = (text: string, tone: "info" | "error" = "info") => setNote({ text, tone });
  /** Runs an action, saying what went wrong if it fails. */
  const act = (work: () => Promise<void>) => {
    setBusy(true);
    work()
      .catch((failure: unknown) => say(messageOf(failure), "error"))
      .finally(() => setBusy(false));
  };

  /**
   * Enter: start it in a new conversation in astrocode, which carries on while you stay here to
   * start more, as a dispatched session does in Claude Code's agent view. Ctrl+Enter opens it too.
   */
  const start = (task: string, open: boolean) =>
    act(async () => {
      const where = shortPath(target, "", home);
      say(`Starting in ${where}…`);
      const key = await onStart(task, target);
      if (open) return onShow(key);
      setText("");
      setSelected(key);
      say(`Started “${fit(task, 40, false)}” in ${where}.`);
    });

  /**
   * `claude attach`, in Claude Code's own screen, with the terminal lent to it until you leave it,
   * or press ← in it, which would put Claude Code's agent view in place of this one.
   */
  const attach = (agent: Agent) =>
    act(async () => {
      attaching.current = true;
      const suspension = await suspendTerminal();
      try {
        await lendTerminal([installedBinary(), "attach", agent.id], topLevelEnv(), leftForAgentView);
      } finally {
        await suspension.resume();
        attaching.current = false;
      }
      setNote(null);
      await refresh();
    });

  const open = () => {
    if (!focused || focused.kind === "folder" || focused.kind === "gap") return;
    if (focused.kind === "mine") return onShow(focused.key);
    const agent = focused.agent;
    if (attaches(agent)) return attach(agent);
    act(async () => {
      say(`Opening ${agent.name}…`);
      await onOpen(agent);
    });
  };

  const stopOrDelete = () => {
    if (focusedMine) {
      onStop(focusedMine.key);
      return say(`Stopped ${nameOf(focusedMine)}. /resume picks it up again.`);
    }
    if (!focused || focused.kind !== "agent") return;
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
      return back ? onShow(back.key) : quit();
    }
    if (key.ctrl && input === "c") {
      if (text) return setText("");
      if (armed?.action === "exit") return quit();
      setArmed({ action: "exit" });
      return say("Ctrl+C again to quit.");
    }
    // With a task typed, the choice that matters is the project it starts in.
    if (key.upArrow || key.downArrow) return setSelected(moveTo(lines, current, key.upArrow ? -1 : 1, Boolean(text)));
    if (key.return && text.trim()) return start(text.trim(), key.ctrl);
    if (key.return || (key.rightArrow && !text)) return open();
    if (key.ctrl && input === "x") return stopOrDelete();
    if (key.ctrl && input === "u") return setText("");
    if (key.backspace || key.delete) return setText((typed) => [...typed].slice(0, -1).join(""));
    if (input === " " && !text) return setPeek((open) => !open);
    if (key.ctrl || key.meta || key.tab || !input) return;
    // A paste can bring line breaks; a task is one line.
    setText((typed) => typed + input.replace(/[\r\n]+/g, " "));
  });

  /** A row's name, look and what it says, for one of astrocode's conversations or a background session. */
  const rowOf = (line: Extract<Line, { kind: "mine" | "agent" }>) => {
    if (line.kind === "agent") {
      const { agent } = line;
      return { key: agent.id, name: agent.name, state: agent.state, said: summary(agent), prs: prLabel(agent), age: ago(agent.updatedAt) };
    }
    const one = fleet.get(line.key);
    const state = one?.store.getSnapshot();
    const shells = one?.store.shells.size ?? 0;
    return {
      key: line.key,
      name: one ? nameOf(one) : "",
      state: state ? mineState(state, shells) : ("idle" as const),
      said: state ? mineSummary(state, shells) : "",
      prs: "",
      age: "",
    };
  };
  const rowLines = lines.filter((line): line is Extract<Line, { kind: "mine" | "agent" }> => line.kind === "mine" || line.kind === "agent");
  const shownRows = rowLines.map(rowOf);

  const inner = width - 2;
  const nameCells = Math.min(NAME_CELLS, Math.floor(inner * 0.3), Math.max(8, ...shownRows.map((row) => cellWidth(row.name))));
  const ageCells = Math.max(0, ...shownRows.map((row) => row.age.length));
  const prCells = Math.max(0, ...shownRows.map((row) => row.prs.length));

  const counts = { blocked: 0, working: 0, done: 0 };
  for (const row of shownRows) if (row.state in counts) counts[row.state as keyof typeof counts] += 1;
  const tally = [`${counts.blocked} need${counts.blocked === 1 ? "s" : ""} input`, `${counts.working} working`, `${counts.done} done`].join(" · ");
  const newSessions = [settings.model, settings.effort && `${settings.effort} effort`, settings.mode].filter(Boolean).join(" · ");

  const peekLines = peek && focused ? peekOf(focused, focusedMine && { name: nameOf(focusedMine), state: focusedMine.store.getSnapshot(), shells: focusedMine.store.shells.size, cwd: focusedMine.cwd }, home) : [];
  const peekRows = peekLines.reduce((sum, line) => sum + Math.max(1, Math.ceil(cellWidth(line.text) / Math.max(1, inner - 10))), 0) + (peekLines.length ? 1 : 0);
  // Less the header and the gap under it, the message box with its edges and the gap over it,
  // the keys' line, the note, and a spare row so the screen never scrolls.
  const room = Math.max(3, rows - 10 - peekRows);
  const at = Math.max(0, lines.findIndex((line) => keyOf(line) === current));
  const chosen = chosenLine(lines, current, Boolean(text));
  const first = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, lines.length - room));
  const shown = lines.slice(first, first + room);

  const enter = !focused || focused.kind === "folder" || focused.kind === "gap" ? "" : focused.kind === "mine" ? "enter open" : attaches(focused.agent) ? "enter attach" : "enter open here";
  const stop = focusedMine ? "ctrl+x stop" : focused?.kind === "agent" ? (focused.agent.alive ? "ctrl+x stop" : "ctrl+x delete") : "";
  const hints = text ? ["enter start", "ctrl+enter start and open", "↑↓ project", "esc clear"] : [enter, "space peek", stop, back ? "esc back" : "esc quit"].filter(Boolean);

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      <Text>
        <Text bold color={PALETTE.star}>
          Agents
        </Text>
        <Text color={PALETTE.dust}>{"  New sessions in "}</Text>
        <Text color={PALETTE.star}>{shortPath(target, "", home)}</Text>
        <Text color={PALETTE.dust}>{newSessions ? `: ${newSessions}` : ""}</Text>
      </Text>
      <Text color={PALETTE.haze}>{agents ? tally : "Reading Claude Code's background sessions…"}</Text>
      <Box flexDirection="column" marginTop={1} height={room} overflow="hidden">
        {error ? <Text color={PALETTE.rose}>{error}</Text> : null}
        {agents && !lines.length ? <Text color={PALETTE.haze}>No sessions yet. Describe a task below to start one.</Text> : null}
        {shown.map((line, i) => {
          if (line.kind === "gap") return <Text key={`gap-${first + i}`}> </Text>;
          if (line.kind === "folder") {
            // Raised in place rather than marked with ›, which would push the heading out of line.
            const raised = first + i === chosen;
            return (
              <Box key={`folder-${line.folder}`} width={inner} backgroundColor={raised ? PALETTE.raised : undefined}>
                <Text color={raised ? PALETTE.gold : PALETTE.haze}>{fit(shortPath(line.folder, "", home), inner, true)}</Text>
              </Box>
            );
          }
          const row = rowOf(line);
          const look = LOOK[row.state];
          const tail = (prCells ? 2 + prCells : 0) + (ageCells ? 2 + ageCells : 0);
          const middle = Math.max(0, inner - 2 - 2 - nameCells - 2 - tail);
          const state = `${look.label}${row.said ? " · " : ""}`;
          return (
            <ChoiceRow key={row.key} selected={first + i === chosen} width={inner}>
              <Text wrap="truncate">
                <Text color={look.color}>{`${look.glyph} `}</Text>
                {/* The one the view was opened from stays bold, as in Claude Code's agent view. */}
                <Text color={PALETTE.star} bold={row.key === here}>
                  {pad(fit(row.name, nameCells, false), nameCells)}
                </Text>
                {"  "}
                <Text color={look.color}>{fit(state, middle, false)}</Text>
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

/** astrocode's conversations, drawn again as any of them changes, so each row says what Claude is doing in it. */
function useFleet(fleet: Fleet) {
  const mine = useSyncExternalStore(fleet.subscribe, fleet.getSnapshot);
  const [, redraw] = useState(0);
  useEffect(() => fleet.watch(() => redraw((n) => n + 1)), [fleet]);
  return mine;
}

/** What Space shows about a row: what it was asked, what it says now, its result, pull requests and folder. */
function peekOf(line: Line, mine: { name: string; state: State; shells: number; cwd: string } | undefined, home: string) {
  const rows: { label: string; text: string }[] = [];
  const add = (label: string, text: string | undefined) => {
    if (text) rows.push({ label, text });
  };
  if (line.kind === "mine" && mine) {
    const live = liveState(mine.state, mine.shells) !== "idle";
    add("Session", `${mine.name} · ${LOOK[mineState(mine.state, mine.shells)].label}, in astrocode`);
    add("Asked", firstPrompt(mine.state));
    add(live ? "Now" : "Result", mineSummary(mine.state, mine.shells));
    add("Folder", shortPath(mine.cwd, "", home));
    add("Enter", "opens it");
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
  add("Enter", attaches(agent) ? "joins it where it runs, in Claude Code's own screen, until ← or Ctrl+Z" : "moves it into astrocode");
  return rows;
}

function pad(text: string, cells: number) {
  return text + " ".repeat(Math.max(0, cells - cellWidth(text)));
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
