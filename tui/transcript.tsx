// Full screen's transcript as lines of styled text. Each entry is drawn once with Ink's
// renderToString and kept until it changes, so scrolling, the spinner and the message box only
// redraw the rows on screen, and a selection knows exactly what text it covers.
import { renderToString } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { folds } from "../src/view/folds";
import type { Item, State } from "../src/view/state";
import { Banner } from "./banner";
import { FoldView, ItemView, LiveView, opensByDefault, turnWork } from "./entries";
import { imagesOf, wantPictures } from "./pictures";
import { GUTTER, rails } from "./rail";

/** A line of the transcript: its text with color codes, and the entry it belongs to. */
export type Row = {
  text: string;
  /** The entry's key: an item's key, "banner" or "live". */
  key: string;
  /** Which of the entry's lines this is, counting the row that sets it apart from the one before. */
  line: number;
  /** The entry's first line of content, which for a tool call is its row. */
  head: boolean;
  /** A click here opens or closes the entry: any row of a tool call, a `!` command, a fold of calls, or a turn's closer that did work. */
  hot: boolean;
  /** The entry is open, with its whole output under its first row. */
  open: boolean;
  /** Cells the rail takes at the start of the row, which a selection leaves out. */
  inset: number;
};

export type Transcript = {
  rows: Row[];
  /** Where each entry starts in `rows`. */
  starts: Map<string, number>;
};

export type TranscriptInput = {
  state: State;
  width: number;
  /** How tall a picture in an entry may be. */
  pictureRows: number;
  branch?: string;
  /** Entries opened or closed by a click, away from how they start (`opensByDefault()`), by item key, and folds opened, by fold key. */
  expanded: ReadonlySet<string>;
  /** Tool calls waiting on a permission prompt or a question, by call id. */
  waiting: ReadonlySet<string>;
};

const EMPTY: Transcript = { rows: [], starts: new Map() };

/** How long the width has to hold still before the transcript is drawn again for it. */
const RESIZE_SETTLE_MS = 80;

/** Each entry's lines, kept with what they were drawn for. Items are replaced, not changed, when they change. */
const drawn = new WeakMap<object, { drawnFor: string; lines: string[] }>();
const BANNER = {};
/** A fold's row is kept by its first call, under an owner of its own, since the call has lines of its own too. */
const foldRows = new WeakMap<Item, object>();
const foldOwner = (first: Item) => foldRows.get(first) ?? foldRows.set(first, {}).get(first)!;

function draw(owner: object, drawnFor: string, width: number, element: () => ReactNode) {
  const kept = drawn.get(owner);
  if (kept?.drawnFor === drawnFor) return kept.lines;
  const text = renderToString(element(), { columns: width });
  const lines = text === "" ? [] : text.split("\n");
  drawn.set(owner, { drawnFor, lines });
  return lines;
}

/** The whole transcript. Must run outside React's render, since renderToString renders with the same reconciler. */
export function layout({ state, width, pictureRows, branch, expanded, waiting }: TranscriptInput): Transcript {
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
  const placed = rails(state.items);
  const folded = folds(state.items);
  /** Where the closed fold being passed over ends. Its calls have no rows, so they have no start either. */
  let skipUntil = -1;
  state.items.forEach((item, i) => {
    if (i < skipUntil) return;
    let rail = placed[i]!;
    const fold = folded.get(i);
    if (fold) {
      const open = expanded.has(fold.key);
      const lines = draw(foldOwner(item), `${width}|${open}|${fold.calls.length}|${rail.spaced}${rail.joined}${rail.through}`, width, () => (
        <FoldView fold={fold} rail={rail} open={open} cwd={state.cwd} home={state.home} width={width} />
      ));
      add(fold.key, lines, rail.spaced ? 1 : 0, GUTTER, true, open);
      if (!open) {
        skipUntil = i + fold.calls.length;
        return;
      }
      // Open, the first call stacks under the fold's row as calls stack under each other.
      rail = { ...rail, spaced: isCard(item) };
    }
    const isWaiting = item.kind === "tool" && waiting.has(item.call.id);
    // A turn that changed files or ran commands opens to list them.
    const opens = item.kind === "tool" || item.kind === "shell" || (item.kind === "turn" && turnWork(item) !== "");
    const isOpen = opens && opensByDefault(item) !== expanded.has(item.key);
    const pictures = imagesOf(item).length ? pictureRows : "";
    const lines = draw(item, `${width}|${pictures}|${isWaiting}|${isOpen}|${rail.spaced}${rail.joined}${rail.through}`, width, () => (
      <ItemView item={item} rail={rail} detailed waiting={isWaiting} expanded={isOpen} copyable {...view} />
    ));
    const head = rail.spaced ? 1 : 0;
    add(item.key, lines, head, GUTTER, opens, isOpen);
  });
  const live = state.live;
  if (live) add("live", draw(live, `${width}`, width, () => <LiveView live={live} width={width} />), 1, GUTTER);
  return { rows, starts };
}

const isCard = (item: Item) => item.kind === "tool" && item.call.name === "Bash";

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
  }, [input.state.items, input.state.live, input.state.cwd, input.width, input.pictureRows, input.branch, input.expanded, waiting]);

  useEffect(
    () => () => {
      if (settling.current) clearTimeout(settling.current.timer);
    },
    [],
  );
  return transcript;
}
