// Full screen's transcript as lines of styled text. Each entry is drawn once with Ink's
// renderToString and kept until it changes, so scrolling, the spinner and the message box only
// redraw the rows on screen, and a selection knows exactly what text it covers.
import { renderToString } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Item, State, ToolCall } from "../src/view/state";
import { arrange } from "./arrange";
import { callTarget, GUTTER, ItemView, leavesOut, LiveView, opensByDefault, stepPieces, type Piece, type StepRow } from "./entries";
import { placeOf } from "./inspector";
import { commandRows, fileTarget, ledgerPieces, moreTarget, opensLedger, type LedgerPiece, type TurnItem } from "./ledger";
import { OPEN_INSET, openedRows, type Opened, type OpenedRows, type Spot } from "./opened";
import { imagesOf, isReady, wantPictures } from "./pictures";
import { diffKey, listedIn, NO_REVIEW, scopeOf, type Review } from "./review";
import { StartScreen, type Start } from "./start";

/** A line of the transcript: its text with color codes, and the entry it belongs to. */
export type Row = {
  text: string;
  /** The entry's key: an item's key, "banner" for the start screen, or "live". */
  key: string;
  /** Which of the entry's lines this is, counting the row that sets it apart from the one before. */
  line: number;
  /** The entry's first line of content, which for a tool call is its row. */
  head: boolean;
  /** A click here acts on the entry, or on its `target`: a tool call, a `!` command, a step's lines, or a turn's ledger and its files. */
  hot: boolean;
  /** What a click on the row acts on, where it isn't the entry: a call a step's line stands for, or the step. */
  target?: string;
  /** Cells that a click acts on in a way of their own, such as an opened call's tabs. */
  spots?: Spot[];
  /** The entry is open, with its whole output under its first row. */
  open: boolean;
  /** Cells the gutter takes at the start of the row, which a selection leaves out. */
  inset: number;
};

export type Transcript = {
  rows: Row[];
  /** Where each entry starts in `rows`, and each tool call's line in a step, by its item's key. */
  starts: Map<string, number>;
  /** The call opened under its line: its tabs, the one shown, and that tab's text. */
  opened?: { id: string; tabs: OpenedRows["tabs"]; tab: OpenedRows["tab"]; copy: string };
};

export type TranscriptInput = {
  state: State;
  width: number;
  /** How tall a picture in an entry may be. */
  pictureRows: number;
  /** What the start screen says. */
  start: Start;
  /** Entries and steps opened or closed by a click, away from how they start (`opensByDefault()`; steps start closed), by key. */
  expanded: ReadonlySet<string>;
  /** Tool calls waiting on a permission prompt or a question, by call id. */
  waiting: ReadonlySet<string>;
  /** The call opened under its line, whose line is marked. */
  opened?: Opened;
  /** What the opened ledgers list, and the diffs read for them. */
  review?: Review;
};

const EMPTY: Transcript = { rows: [], starts: new Map() };

/** How long the width has to hold still before the transcript is drawn again for it. */
const RESIZE_SETTLE_MS = 80;

/** Each entry's lines, kept with what they were drawn for. Items are replaced, not changed, when they change. */
const drawn = new WeakMap<object, { drawnFor: string; lines: string[] }>();
const START = {};
/** A step's lines are kept by its first item, under an owner of their own, since the item has lines of its own too. */
const stepRows = new WeakMap<Item, object>();
const stepOwner = (first: Item) => stepRows.get(first) ?? stepRows.set(first, {}).get(first)!;
const drawnSteps = new WeakMap<object, { drawnFor: string; lines: string[]; targets: (string | undefined)[]; pieces: string[]; heads: boolean[]; spots: (Spot[] | undefined)[] }>();
/** An opened ledger's lines are kept by its turn's item, under an owner of their own, as a step's are. */
const ledgerRows = new WeakMap<Item, object>();
const ledgerOwner = (turn: Item) => ledgerRows.get(turn) ?? ledgerRows.set(turn, {}).get(turn)!;

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

/**
 * A step's or an opened ledger's lines, each piece drawn on its own so each line knows what a click
 * on it acts on. Of a piece that answers a click in places of its own, only its first line does.
 */
function drawStep(owner: object, drawnFor: string, width: number, pieces: () => (Piece | LedgerPiece)[]) {
  const kept = drawnSteps.get(owner);
  if (kept?.drawnFor === drawnFor) return kept;
  const lines: string[] = [];
  const targets: (string | undefined)[] = [];
  const keys: string[] = [];
  const heads: boolean[] = [];
  const spots: (Spot[] | undefined)[] = [];
  for (const piece of pieces()) {
    const drawn = linesOf(piece.node, width);
    lines.push(...drawn);
    targets.push(...drawn.map(() => piece.target));
    keys.push(...drawn.map(() => piece.key));
    heads.push(...drawn.map((_, i) => i === 0 && "head" in piece && piece.head === true));
    spots.push(...drawn.map((_, i) => (i === 0 && "spots" in piece ? piece.spots : undefined)));
  }
  const result = { drawnFor, lines, targets, pieces: keys, heads, spots };
  drawnSteps.set(owner, result);
  return result;
}

/** The whole transcript. Must run outside React's render, since renderToString renders with the same reconciler. */
export function layout({ state, width, pictureRows, start, expanded, waiting, opened, review = NO_REVIEW }: TranscriptInput): Transcript {
  const rows: Row[] = [];
  const starts = new Map<string, number>();
  const view = { cwd: state.cwd, home: state.home, width, pictureRows };
  wantPictures(state.items, width - GUTTER, pictureRows);
  let shown: Transcript["opened"];

  /** The opened call's rows, under the line `call` stands for in the entry `key`, numbered on from `line`. */
  const openUnder = (key: string, call: ToolCall, line: number) => {
    const drawn = openedRows({
      call,
      opened: opened!,
      place: placeOf(state, call.id),
      waiting: waiting.has(call.id),
      log: state.agentLogs[call.id],
      width,
      cwd: state.cwd,
      home: state.home,
    });
    shown = { id: call.id, tabs: drawn.tabs, tab: drawn.tab, copy: drawn.copy };
    return drawn.lines.map((text, i): Row => ({ text, key, line: line + i, head: false, hot: true, open: true, inset: OPEN_INSET, target: drawn.targets[i], spots: drawn.spots[i] }));
  };

  /**
   * An opened ledger's rows, under the turn's closing line, numbered on from `line`: its files are
   * heads, which Enter opens, and the rest closes what it's in, a file's diff or the ledger.
   */
  const ledgerUnder = (turn: TurnItem, index: number, line: number): Row[] => {
    const scope = scopeOf(review, turn.key);
    const listed = listedIn(review, turn, scope);
    const isOpen = (path: string) => expanded.has(fileTarget(turn.key, path));
    const isWhole = (path: string) => expanded.has(moreTarget(turn.key, path));
    const files = typeof listed === "object" ? listed.files : [];
    const commands = commandRows(state.items, index, state.cwd, state.home);
    const opened = files.filter((file) => isOpen(file.path)).map((file) => `${file.path}${isWhole(file.path) ? "\n" : ""}`);
    const drawnFor = `${width}|${review.git}|${scope}|${review.version}|${opened.join("\0")}|${JSON.stringify(commands)}`;
    const drawn = drawStep(ledgerOwner(turn), drawnFor, width, () =>
      ledgerPieces({
        turn,
        scope: review.git ? scope : undefined,
        listed,
        open: (file) => isOpen(file.path),
        whole: (file) => isWhole(file.path),
        diff: (file) => review.diffs.get(diffKey(scope, turn.key, file.path)),
        commands,
        width,
        cwd: state.cwd,
        home: state.home,
      }),
    );
    return drawn.lines.map((text, i) => ({ text, key: turn.key, line: line + i, head: drawn.heads[i]!, hot: true, open: true, inset: OPEN_INSET, target: drawn.targets[i], spots: drawn.spots[i] }));
  };

  /**
   * An entry's lines; `head` is where its content starts, after the row that sets it apart, and
   * `hot` whether a click from there on opens or closes it.
   */
  const add = (key: string, lines: string[], head: number, inset: number, hot = false, open = false) => {
    starts.set(key, rows.length);
    lines.forEach((text, line) => rows.push({ text, key, line, head: line === head, hot: hot && line >= head, open, inset }));
  };

  // The start screen heads the transcript until the conversation starts, with notices under it,
  // such as why Claude Code didn't start; then the conversation has its rows.
  if (state.items.every((item) => item.kind === "notice")) {
    add("banner", draw(START, `${width}|${JSON.stringify(start)}`, width, () => <StartScreen start={start} width={width} />), 0, 0);
  }
  for (const entry of arrange(state, waiting, expanded)) {
    const { spaced } = entry;
    if (entry.kind === "step") {
      const { row } = entry;
      // The line of the opened call, if it's in this step, which opens the step if a closed one leaves it out.
      const found = opened === undefined ? undefined : row.flow.find((one) => one.kind === "row" && one.row.calls.some((call) => call.id === opened.id));
      const mine = found?.kind === "row" ? found.row : undefined;
      const open = entry.open || (mine !== undefined && leavesOut(row, mine));
      const picked = mine && opened?.id;
      const drawn = drawStep(stepOwner(entry.first), `${width}|${pictureRows}|${open}|${picked}|${signature(row)}`, width, () =>
        stepPieces({ step: row, open, width, picked, pictureRows, links: "screen", cwd: state.cwd, home: state.home }),
      );
      // The opened call goes under its line and what's drawn under that: why it failed, a subagent's calls, pictures.
      const under = mine ? new Set([`row:${mine.calls[0]!.id}`, `why:${mine.calls[0]!.id}`, `agent:${mine.calls[0]!.id}`, ...mine.calls.map((call) => `pictures:${call.id}`)]) : null;
      const after = under ? drawn.pieces.findLastIndex((piece) => under.has(piece)) + 1 : drawn.lines.length;
      // The row that sets the step apart from the entry before, which a click doesn't act on.
      const gap = spaced ? 1 : 0;
      const call = mine?.calls.find((one) => one.id === opened?.id);
      const added = call ? openUnder(entry.key, call, gap + after) : [];
      const start = rows.length;
      starts.set(entry.key, start);
      if (spaced) rows.push({ text: "", key: entry.key, line: 0, head: false, hot: false, open: false, inset: GUTTER });
      // A line for several calls stands for the one it opens, or for the one of them that's open, which a click on it closes.
      const standsFor = mine && callTarget(mine.opens);
      drawn.lines.forEach((text, i) => {
        const drawnTarget = drawn.targets[i];
        const target = call && drawnTarget === standsFor ? callTarget(call.id) : drawnTarget;
        if (i === after) rows.push(...added);
        const line = gap + (i < after ? i : i + added.length);
        rows.push({ text, key: entry.key, line, head: target !== undefined, hot: target !== undefined, open: false, inset: GUTTER, target });
      });
      if (after === drawn.lines.length) rows.push(...added);
      // Each call's line, for scrolling to a call and for Alt+Shift+↑ and ↓. A call a closed step
      // leaves out is at the step's row.
      for (const one of row.flow) {
        if (one.kind !== "row") continue;
        const at = drawn.pieces.indexOf(`row:${one.row.calls[0]!.id}`);
        for (const call of one.row.calls) {
          const index = state.tools[call.id];
          const item = index === undefined ? undefined : state.items[index];
          if (item) starts.set(item.key, at === -1 ? start : start + gap + (at < after ? at : at + added.length));
        }
      }
      continue;
    }
    const { item } = entry;
    const isWaiting = item.kind === "tool" && waiting.has(item.call.id);
    // A turn's ledger opens to list what it did, and in git what else changed.
    const opens = item.kind === "tool" || item.kind === "shell" || (item.kind === "turn" && opensLedger(item, review.git));
    const isOpen = opens && opensByDefault(item) !== expanded.has(item.key);
    const pictures = imagesOf(item).length ? pictureRows : "";
    const lines = draw(item, `${width}|${pictures}|${isWaiting}|${isOpen}|${spaced}`, width, () => (
      <ItemView item={item} spaced={spaced} detailed waiting={isWaiting} expanded={isOpen} copyable {...view} />
    ));
    add(item.key, lines, spaced ? 1 : 0, GUTTER, opens, isOpen);
    if (item.kind === "tool" && item.call.id === opened?.id) rows.push(...openUnder(item.key, item.call, lines.length));
    if (item.kind === "turn" && isOpen) rows.push(...ledgerUnder(item, entry.index, lines.length));
  }
  const live = state.live;
  if (live) add("live", draw(live, `${width}`, width, () => <LiveView live={live} width={width} />), 1, GUTTER);
  return { rows, starts, opened: shown };
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
  const { opened } = input;
  // A subagent's transcript grows while its call stays the same.
  const log = opened ? input.state.agentLogs[opened.id] : undefined;
  const start = JSON.stringify(input.start);

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
  }, [input.state.items, input.state.live, input.state.cwd, input.width, input.pictureRows, start, input.expanded, opened?.id, opened?.tab, opened?.whole, opened?.output?.text, log, waiting, input.review?.version, input.review?.git]);

  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current.timer);
    },
    [],
  );
  return transcript;
}
