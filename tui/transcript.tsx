// Full screen's transcript as lines of styled text. Each entry is drawn once with Ink's
// renderToString and kept until it changes, so scrolling, the spinner and the message box only
// redraw the rows on screen, and a selection knows exactly what text it covers.
import { renderToString } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Item, State, ToolCall } from "../src/view/state";
import { Banner } from "./banner";
import { arrange } from "./arrange";
import { ItemView, LiveView, opensByDefault, stepPieces, turnWork, type Piece, type StepRow } from "./entries";
import { imagesOf, isReady, wantPictures } from "./pictures";
import { GUTTER } from "./rail";

/** A line of the transcript: its text with color codes, and the entry it belongs to. */
export type Row = {
  text: string;
  /** The entry's key: an item's key, "banner" or "live". */
  key: string;
  /** Which of the entry's lines this is, counting the row that sets it apart from the one before. */
  line: number;
  /** The entry's first line of content, which for a tool call is its row. */
  head: boolean;
  /** A click here acts on the entry, or on its `target`: a tool call, a `!` command, a step's lines, or a turn's closer that did work. */
  hot: boolean;
  /** What a click on the row acts on, where it isn't the entry: a call a step's line stands for, or the step. */
  target?: string;
  /** The entry is open, with its whole output under its first row. */
  open: boolean;
  /** Cells the rail takes at the start of the row, which a selection leaves out. */
  inset: number;
};

export type Transcript = {
  rows: Row[];
  /** Where each entry starts in `rows`, and each tool call's line in a step, by its item's key. */
  starts: Map<string, number>;
};

export type TranscriptInput = {
  state: State;
  width: number;
  /** How tall a picture in an entry may be. */
  pictureRows: number;
  branch?: string;
  /** Entries and steps opened or closed by a click, away from how they start (`opensByDefault()`; steps start closed), by key. */
  expanded: ReadonlySet<string>;
  /** Tool calls waiting on a permission prompt or a question, by call id. */
  waiting: ReadonlySet<string>;
  /** The call the inspector shows, whose line is marked. */
  picked?: string;
};

const EMPTY: Transcript = { rows: [], starts: new Map() };

/** How long the width has to hold still before the transcript is drawn again for it. */
const RESIZE_SETTLE_MS = 80;

/** Each entry's lines, kept with what they were drawn for. Items are replaced, not changed, when they change. */
const drawn = new WeakMap<object, { drawnFor: string; lines: string[] }>();
const BANNER = {};
/** A step's lines are kept by its first item, under an owner of their own, since the item has lines of its own too. */
const stepRows = new WeakMap<Item, object>();
const stepOwner = (first: Item) => stepRows.get(first) ?? stepRows.set(first, {}).get(first)!;
const drawnSteps = new WeakMap<object, { drawnFor: string; lines: string[]; targets: (string | undefined)[]; pieces: string[] }>();

function draw(owner: object, drawnFor: string, width: number, element: () => ReactNode) {
  const kept = drawn.get(owner);
  if (kept?.drawnFor === drawnFor) return kept.lines;
  const lines = linesOf(element(), width);
  drawn.set(owner, { drawnFor, lines });
  return lines;
}

function linesOf(element: ReactNode, width: number) {
  const text = renderToString(element, { columns: width });
  return text === "" ? [] : text.split("\n");
}

/** A step's lines, each piece drawn on its own so each line knows what a click on it acts on. */
function drawStep(owner: object, drawnFor: string, width: number, pieces: () => Piece[]) {
  const kept = drawnSteps.get(owner);
  if (kept?.drawnFor === drawnFor) return kept;
  const lines: string[] = [];
  const targets: (string | undefined)[] = [];
  const keys: string[] = [];
  for (const piece of pieces()) {
    const drawn = linesOf(piece.node, width);
    lines.push(...drawn);
    targets.push(...drawn.map(() => piece.target));
    keys.push(...drawn.map(() => piece.key));
  }
  const result = { drawnFor, lines, targets, pieces: keys };
  drawnSteps.set(owner, result);
  return result;
}

/** The whole transcript. Must run outside React's render, since renderToString renders with the same reconciler. */
export function layout({ state, width, pictureRows, branch, expanded, waiting, picked }: TranscriptInput): Transcript {
  const rows: Row[] = [];
  const starts = new Map<string, number>();
  const view = { cwd: state.cwd, home: state.home, width, pictureRows };
  wantPictures(state.items, width - GUTTER, pictureRows);

  /**
   * An entry's lines; `head` is where its content starts, after the row that sets it apart, and
   * `hot` whether a click from there on opens or closes it.
   */
  const add = (key: string, lines: string[], head: number, inset: number, hot = false, open = false) => {
    starts.set(key, rows.length);
    lines.forEach((text, line) => rows.push({ text, key, line, head: line === head, hot: hot && line >= head, open, inset }));
  };

  add(
    "banner",
    draw(BANNER, `${width}|${state.cwd}|${branch}`, width, () => <Banner cwd={state.cwd} home={state.home} branch={branch} width={width} />),
    0,
    0,
  );
  for (const entry of arrange(state, waiting, expanded)) {
    const { rail } = entry;
    const railed = `${rail.spaced}${rail.joined}${rail.through}`;
    if (entry.kind === "step") {
      const { row, open } = entry;
      const calls = row.flow.flatMap((one) => (one.kind === "row" ? one.row.calls : []));
      const mine = picked !== undefined && calls.some((call) => call.id === picked) ? picked : undefined;
      const drawn = drawStep(stepOwner(entry.first), `${width}|${pictureRows}|${open}|${mine}|${railed}|${signature(row)}`, width, () =>
        stepPieces({ step: row, rail, open, width, picked: mine, pictureRows, links: "screen", cwd: state.cwd, home: state.home }),
      );
      const start = rows.length;
      starts.set(entry.key, start);
      drawn.lines.forEach((text, line) => {
        // The row that sets the step apart from the entry before isn't part of what a click acts on.
        const target = rail.spaced && line === 0 ? undefined : drawn.targets[line];
        rows.push({ text, key: entry.key, line, head: target !== undefined, hot: target !== undefined, open: false, inset: GUTTER, target });
      });
      // Each call's line, for scrolling to a call and for Alt+Shift+↑ and ↓. A call a closed step
      // leaves out is at the step's row.
      for (const one of row.flow) {
        if (one.kind !== "row") continue;
        const at = drawn.pieces.indexOf(`row:${one.row.calls[0]!.id}`);
        for (const call of one.row.calls) {
          const index = state.tools[call.id];
          const item = index === undefined ? undefined : state.items[index];
          if (item) starts.set(item.key, at === -1 ? start : start + at);
        }
      }
      continue;
    }
    const { item } = entry;
    const isWaiting = item.kind === "tool" && waiting.has(item.call.id);
    // A turn that changed files or ran commands opens to list them.
    const opens = item.kind === "tool" || item.kind === "shell" || (item.kind === "turn" && turnWork(item) !== "");
    const isOpen = opens && opensByDefault(item) !== expanded.has(item.key);
    const pictures = imagesOf(item).length ? pictureRows : "";
    const lines = draw(item, `${width}|${pictures}|${isWaiting}|${isOpen}|${railed}`, width, () => (
      <ItemView item={item} rail={rail} detailed waiting={isWaiting} expanded={isOpen} copyable {...view} />
    ));
    add(item.key, lines, rail.spaced ? 1 : 0, GUTTER, opens, isOpen);
  }
  const live = state.live;
  if (live) add("live", draw(live, `${width}`, width, () => <LiveView live={live} width={width} />), 1, GUTTER);
  return { rows, starts };
}

/** What a step's lines are drawn from, so they're drawn again only when that changes. */
function signature(row: StepRow) {
  return JSON.stringify(row, (key, value: unknown) => {
    if (key !== "calls" || !Array.isArray(value)) return value;
    // A call shows its pictures once they're ready, and a running subagent its latest calls.
    return (value as ToolCall[]).map((call) => [call.id, call.subagent ?? null, (call.images ?? []).map(isReady)]);
  });
}

/**
 * The transcript for what's on screen now. It's drawn just after React commits, since Ink can't
 * render to a string in the middle of rendering, and drawn again whenever what it shows changes.
 * A new width redraws every entry, so that waits for the window to stop resizing.
 */
export function useTranscript(input: TranscriptInput) {
  const [transcript, setTranscript] = useState<Transcript>(EMPTY);
  const latest = useRef(input);
  latest.current = input;
  const drawn = useRef<number | null>(null);
  /** The wait for a new width, and the width it's for; only the width moving again starts it over. */
  const settling = useRef<{ timer: ReturnType<typeof setTimeout>; width: number } | null>(null);
  const waiting = [...input.waiting].join(" ");

  useEffect(() => {
    const draw = () => {
      drawn.current = latest.current.width;
      setTranscript(layout(latest.current));
    };
    if (drawn.current !== null && drawn.current !== input.width) {
      if (settling.current?.width !== input.width) {
        if (settling.current) clearTimeout(settling.current.timer);
        const timer = setTimeout(() => {
          settling.current = null;
          draw();
        }, RESIZE_SETTLE_MS);
        settling.current = { timer, width: input.width };
      }
      return;
    }
    let stale = false;
    queueMicrotask(() => {
      if (!stale) draw();
    });
    return () => {
      stale = true;
    };
  }, [input.state.items, input.state.live, input.state.cwd, input.width, input.pictureRows, input.branch, input.expanded, input.picked, waiting]);

  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current.timer);
    },
    [],
  );
  return transcript;
}
