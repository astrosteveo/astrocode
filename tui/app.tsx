// The terminal front end. Finished entries are written once into the terminal's own scrollback
// (Ink's <Static>), like `claude` does; only the live part below them is redrawn.
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { Box, Static, Text, useAnimation, useApp, useStdout, useWindowSize } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MODES } from "../src/protocol";
import type { AgentSession } from "../src/session";
import { duration, modelLabel } from "../src/view/format";
import type { Item, Live, State } from "../src/view/state";
import { shortPath, toolLabel } from "../src/view/tools";
import { DecisionPrompt } from "./decision";
import { cellWidth, wrapText } from "./markdown";
import { Markdown } from "./markdown-view";
import { Prompt } from "./prompt";
import type { Store } from "./store";
import { ACCENT, COLOR } from "./theme";
import { DraftRow, ToolRow } from "./tool-row";

type Entry = Item | { kind: "banner"; key: string };

const MODE_CHIPS: Record<PermissionMode, { label: string; color: string }> = {
  default: { label: "◉ ask first", color: COLOR.muted },
  acceptEdits: { label: "⏵⏵ accept edits", color: ACCENT },
  plan: { label: "⏸ plan", color: COLOR.info },
  auto: { label: "◎ auto", color: COLOR.warning },
  bypassPermissions: { label: "⚠ bypass permissions", color: COLOR.error },
  dontAsk: { label: "◌ don't ask", color: COLOR.warning },
};

const HELP = [
  "Enter sends. Shift+Enter, Alt+Enter, or \\ then Enter starts a new line.",
  "Esc stops Claude. Shift+Tab changes the permission mode. ↑ and ↓ recall earlier messages.",
  "Ctrl+C clears the box, stops Claude, or exits when pressed twice.",
  "/clear starts a new session, /exit quits, and other /commands go to Claude Code.",
].join("\n");

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function App({ store, session }: { store: Store; session: AgentSession }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { exit } = useApp();
  const { write } = useStdout();
  const { columns, rows } = useWindowSize();
  const width = Math.max(24, columns);
  const history = useRef<string[]>([]);
  const [exitArmed, setExitArmed] = useState(false);
  // The mode last asked for, until Claude Code confirms it, so quick Shift+Tabs keep stepping.
  const [modeWanted, setModeWanted] = useState<PermissionMode | null>(null);
  const wanted = useRef<PermissionMode | null>(null);

  useEffect(() => {
    if (wanted.current === state.mode) {
      wanted.current = null;
      setModeWanted(null);
    }
  }, [state.mode]);

  useEffect(() => {
    if (!exitArmed) return;
    const timer = setTimeout(() => setExitArmed(false), 2000);
    return () => clearTimeout(timer);
  }, [exitArmed]);

  const waiting = new Set(state.pending.map((request) => request.id));
  const settled = settledCount(state.items, waiting);
  const entries: Entry[] = [{ kind: "banner", key: "banner" }, ...state.items.slice(0, settled)];
  const request = state.pending[0];

  const report = (error: unknown) =>
    store.emit({ kind: "notice", tone: "error", text: error instanceof Error ? error.message : String(error) });

  const submit = (text: string) => {
    history.current.push(text);
    switch (text.trim()) {
      case "/exit":
      case "/quit":
        return exit();
      case "/clear":
      case "/new":
        // A new session starts on a clean screen, scrollback included, as `claude` does.
        write("\x1b[2J\x1b[3J\x1b[H");
        session.reset();
        store.reset();
        session.start();
        return;
      case "/help":
        return store.emit({ kind: "notice", tone: "info", text: HELP });
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

  const view = { cwd: state.cwd, home: state.home, width };

  return (
    <>
      <Static key={store.epoch} items={entries}>
        {(entry, index) => (
          <Box key={entry.key} marginTop={gap(entries[index - 1], entry)} flexDirection="column">
            {entry.kind === "banner" ? <Banner cwd={state.cwd} home={state.home} /> : <ItemView item={entry} detailed {...view} />}
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
          {request ? (
            <DecisionPrompt
              key={request.id}
              request={request}
              {...view}
              onDecide={(decision) => session.decide(request.id, decision)}
            />
          ) : null}
          <Prompt
            active={!request}
            busy={state.busy}
            width={width}
            history={history.current}
            onSubmit={submit}
            onInterrupt={() => void session.interrupt().catch(report)}
            onCycleMode={cycleMode}
            onCtrlC={onCtrlC}
            onExit={exit}
          />
          <Footer state={state} mode={modeWanted ?? state.mode} exitArmed={exitArmed} width={width} />
        </Box>
      </Box>
    </>
  );
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

function Banner({ cwd, home }: { cwd: string; home: string }) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color={ACCENT}>
          ✦ astrocode
        </Text>
        <Text color={COLOR.muted}>{`  ${shortPath(cwd, "", home)}`}</Text>
      </Text>
      <Text dimColor>/help for keys and commands</Text>
    </Box>
  );
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

/** `─── ✦ Worked for 42s ─────`, after nebula-ui's turn divider. */
function TurnEnd({ item, width }: { item: Extract<Item, { kind: "turn" }>; width: number }) {
  const { label, color } = {
    finished: { label: `✦ Worked for ${duration(item.durationMs)}`, color: ACCENT },
    stopped: { label: `⊘ Stopped after ${duration(item.durationMs)}`, color: COLOR.warning },
    failed: { label: `✗ Failed after ${duration(item.durationMs)}`, color: COLOR.error },
  }[item.outcome];
  const words = ` ${label} `;
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
      {text ? <Markdown text={tail(text, width, Math.max(4, rows - 14))} width={width} /> : null}
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

/** A pill saying what the turn is doing, after nebula-ui's spinner, then the time it's taken. */
function Activity({ state }: { state: State }) {
  const active = state.busy || state.pending.length > 0;
  const { frame, time } = useAnimation({ interval: 100, isActive: active });
  if (!active) return null;
  const mode = activity(state);
  return (
    <Box marginTop={1}>
      <Text>
        <Text inverse bold color={mode.color}>
          {` ${mode.glyph} ${mode.label} `}
        </Text>
        <Text color={COLOR.muted}>{` ${SPINNER[frame % SPINNER.length]} ${duration(time)} · esc to stop`}</Text>
      </Text>
    </Box>
  );
}

function activity(state: State) {
  if (state.pending.length > 0) return { glyph: "◆", label: "waiting for you", color: ACCENT };
  const live = state.live;
  const block = live?.blocks.slice(live.finalized).findLast((b) => b !== undefined);
  if (block?.kind === "thinking") return { glyph: "✦", label: "thinking", color: ACCENT };
  if (block?.kind === "text") return { glyph: "✎", label: "writing", color: COLOR.success };
  if (block?.kind === "tool") return { glyph: "⋯", label: "preparing", color: COLOR.info };
  const running = state.items.findLast((item) => item.kind === "tool" && item.call.status === "running");
  if (running?.kind === "tool") return { glyph: "⚙", label: `running ${toolLabel(running.call.name)}`, color: COLOR.info };
  return { glyph: "⇅", label: "working", color: COLOR.muted };
}

function Footer({ state, mode, exitArmed, width }: { state: State; mode: PermissionMode; exitArmed: boolean; width: number }) {
  const chip = MODE_CHIPS[mode];
  const about = [state.model ? modelLabel(state.model) : "", state.plan ?? ""].filter(Boolean).join(" · ");
  return (
    <Box width={width} paddingX={1} justifyContent="space-between">
      {exitArmed ? (
        <Text color={COLOR.warning}>Press Ctrl+C again to exit</Text>
      ) : (
        <Text>
          <Text color={chip.color}>{chip.label}</Text>
          <Text dimColor> · shift+tab to change</Text>
        </Text>
      )}
      <Text dimColor>{about}</Text>
    </Box>
  );
}
