// Full screen's transcript as lines of styled text. Each entry is drawn once with Ink's
// renderToString and kept until it changes, so scrolling, the spinner and the message box only
// redraw the rows on screen, and a selection knows exactly what text it covers.
import { renderToString } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isCurrent, stepSpan, stepStatus, steps, stepSummary, stepTitle, restOf, type Step } from "../src/view/steps";
import type { Item, State } from "../src/view/state";
import { Banner } from "./banner";
import { ItemView, LiveView, opensByDefault, StepView, turnWork, type StepRow } from "./entries";
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
  /** Entries and steps opened or closed by a click, away from how they start (`opensByDefault()`, `stepOpens()`), by key. */
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
/** A step's row is kept by its first item, under an owner of its own, since the item has lines of its own too. */
const stepRows = new WeakMap<Item, object>();
const stepOwner = (first: Item) => stepRows.get(first) ?? stepRows.set(first, {}).get(first)!;

/** A step's row as it's drawn, from the step and how its calls went. */
function stepRow(step: Step, state: State, waiting: ReadonlySet<string>): StepRow {
  const title = stepTitle(step, state.cwd, state.home);
  const more = step.title ? restOf(step.title.text) || undefined : undefined;
  return { title: title.text, made: title.made, more, summary: stepSummary(step, state.cwd, state.home), status: stepStatus(step, waiting), span: stepSpan(step) };
}

/** Whether a step starts open: the one Claude is working in, one waiting for you, and one whose last call failed. */
export function stepOpens(state: State, start: number, step: Step, waiting: ReadonlySet<string>) {
  const status = stepStatus(step, waiting);
  return isCurrent(state.items, start, step, state.busy) || status === "waiting" || status === "failed";
}

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
  const found = steps(state.items);
  /** Where the step being passed over ends, closed, or its title, open. Skipped items have no rows, so they have no start either. */
  let skipUntil = -1;
  /** The first item under an open step's row, which stacks under it as calls stack under each other. */
  let under = -1;
  /** Whether the last entry drawn was a closed step, which the next step's row stacks under. */
  let afterStep = false;
  state.items.forEach((item, i) => {
    if (i < skipUntil) return;
    let rail = placed[i]!;
    const step = found.get(i);
    if (step) {
      const row = stepRow(step, state, waiting);
      const open = stepOpens(state, i, step, waiting) !== expanded.has(step.key);
      if (afterStep) rail = { ...rail, spaced: false };
      const summary = row.summary.map((group) => group.map((part) => part.text).join("")).join("|");
      const drawnFor = `${width}|${open}|${row.status}|${row.title}|${summary}|${row.span}|${rail.spaced}${rail.joined}${rail.through}`;
      const lines = draw(stepOwner(item), drawnFor, width, () => <StepView step={row} rail={rail} open={open} width={width} />);
      add(step.key, lines, rail.spaced ? 1 : 0, GUTTER, true, open);
      afterStep = !open;
      if (!open) {
        skipUntil = i + (step.title ? 1 : 0) + step.members.length;
        return;
      }
      // Open, the title is the row, and the calls follow it.
      under = step.title ? i + 1 : i;
      if (step.title) {
        skipUntil = i + 1;
        return;
      }
    } else afterStep = false;
    if (i === under) rail = { ...rail, spaced: isCard(item) };
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
