// Full screen: the conversation in a viewport that scrolls, with the message box and status bar
// pinned under it. The wheel, PgUp and PgDn scroll, and the viewport follows the end until you
// scroll up. Dragging selects text and copies it; clicking a tool call's row opens its output.
import { Box, Text, useBoxMetrics, useInput, useStdout, type DOMElement } from "ink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { State } from "../src/view/state";
import { plural } from "../src/view/tools";
import { hit, relative, useHover, useMouse } from "./mouse";
import { band, cellsOn, highlight, selectedText, wordAt, type Cell } from "./selection";
import { PALETTE } from "./theme";
import { Welcome, WELCOME_HEIGHT, WELCOME_WIDTH } from "./mirror";
import { pictureRows, usePictureRows } from "./pictures";
import { useTranscript, type Transcript } from "./transcript";

const WHEEL_LINES = 3;
/** How often a drag held at the viewport's edge scrolls it another line. */
const EDGE_SCROLL_MS = 50;
/** How long after the window stops resizing the whole screen is drawn again. */
const REPAINT_MS = 150;

/**
 * A row by its entry, so what you're reading stays put when lines above it change, and the
 * viewport row it's held at (the top, unless a click pinned a row where it was).
 */
type Anchor = { key: string; line: number; y?: number };
type Point = Anchor & { col: number };
type Selection = { from: Point; to: Point };

type Props = {
  state: State;
  /** Counts resets, which start the view over at the end. */
  epoch: number;
  branch?: string;
  columns: number;
  rows: number;
  expanded: ReadonlySet<string>;
  waiting: ReadonlySet<string>;
  /** A tool call to scroll to, from the output browser. */
  reveal: { key: string } | null;
  /** Whether PgUp and PgDn scroll; a picker open below uses them for its list. */
  keys: boolean;
  onToggle: (key: string) => void;
  onCopy: (text: string) => void;
  /** What's pinned under the viewport. */
  children: ReactNode;
};

export function Screen({ state, epoch, branch, columns, rows: height, expanded, waiting, reveal, keys, onToggle, onCopy, children }: Props) {
  // A column for the scrollbar and one to keep it off the text.
  const width = Math.max(10, columns - 2);
  const viewport = useRef<DOMElement>(null);
  const pill = useRef<DOMElement>(null);
  const metrics = useBoxMetrics(viewport);
  const view = Math.max(1, metrics.hasMeasured ? metrics.height : height - 6);
  const transcript = useTranscript({ state, width, pictureRows: pictureRows(view), branch, expanded, waiting });
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [selection, setSelectionState] = useState<Selection | null>(null);
  /** The selection as of the last event, which may be newer than the last render. */
  const selected = useRef<Selection | null>(null);
  const drag = useRef<"select" | "scrollbar" | null>(null);
  /** Where the button went down to select, until a drag leaves that cell and starts the selection. */
  const pressed = useRef<Point | null>(null);
  const edge = useRef<{ timer: ReturnType<typeof setInterval>; step: number; x: number } | null>(null);

  const { rows } = transcript;
  const total = rows.length;
  const maxTop = Math.max(0, total - view);
  const anchored = anchor ? find(transcript, anchor) : null;
  // Where the anchored row would put the top of the viewport. Above the first row, that's room
  // left blank, so a row held where it was clicked doesn't move as its output opens below it.
  const wanted = anchored === null ? null : anchored - (anchor?.y ?? 0);
  const top = wanted === null ? maxTop : Math.max(0, Math.min(maxTop, wanted));
  // A conversation shorter than the screen sits at the bottom, next to the message box, so the
  // rail runs on into what Claude is doing now.
  const pad = wanted === null ? Math.max(0, view - total) : Math.max(0, -wanted);
  const below = Math.max(0, total - top - (view - pad));
  usePictureRows([...Array<string>(pad).fill(""), ...rows.slice(top, top + view - pad).map((row) => row.text)]);
  const scrollable = total > view;
  const thumb = scrollable ? Math.max(1, Math.round((view * view) / total)) : 0;
  const thumbTop = scrollable && maxTop > 0 ? Math.round(((view - thumb) * top) / maxTop) : 0;

  /** What handlers see: this render's numbers, moved along by events that haven't rendered yet. */
  const now = useRef({ transcript, top, maxTop, view, thumb, pad });
  now.current = { transcript, top, maxTop, view, thumb, pad };

  const setSelection = (next: Selection | null) => {
    selected.current = next;
    setSelectionState(next);
  };

  const scrollTo = (index: number) => {
    const { transcript, maxTop } = now.current;
    const next = Math.max(0, Math.min(maxTop, Math.round(index)));
    now.current = { ...now.current, top: next };
    const row = transcript.rows[next];
    setAnchor(next >= maxTop || !row ? null : { key: row.key, line: row.line });
  };
  const scrollBy = (lines: number) => scrollTo(now.current.top + lines);

  /** The transcript's cell under a viewport cell, kept inside the viewport. */
  const pointAt = (x: number, y: number): Point | null => {
    const { transcript, top, view, pad } = now.current;
    const index = Math.min(transcript.rows.length - 1, top + Math.max(0, Math.min(view - 1, y) - pad));
    const row = transcript.rows[index];
    return row ? { key: row.key, line: row.line, col: Math.max(0, Math.min(width - 1, x)) } : null;
  };

  /**
   * The selection, stretched to `point`. It starts once a drag leaves the cell the button went down
   * on, so a click highlights nothing.
   */
  const extendTo = (point: Point | null) => {
    if (!point) return;
    const current = selected.current;
    if (current) return setSelection({ ...current, to: point });
    const from = pressed.current;
    if (from && !samePoint(from, point)) setSelection({ from, to: point });
  };

  const stopEdge = () => {
    if (edge.current) clearInterval(edge.current.timer);
    edge.current = null;
  };

  /** Keeps scrolling while a drag is held at the top or bottom edge, as a terminal does. */
  const holdEdge = (step: number, x: number) => {
    if (edge.current?.step === step) {
      edge.current.x = x;
      return;
    }
    stopEdge();
    const timer = setInterval(() => {
      if (!edge.current) return;
      scrollBy(step);
      extendTo(pointAt(edge.current.x, step < 0 ? 0 : now.current.view - 1));
    }, EDGE_SCROLL_MS);
    edge.current = { timer, step, x };
  };

  useEffect(() => stopEdge, []);

  const thumbTo = (y: number) => {
    const { view, maxTop, thumb } = now.current;
    scrollTo(((y - thumb / 2) / Math.max(1, view - thumb)) * maxTop);
  };

  const copy = (selection: Selection) => {
    const { transcript } = now.current;
    const cells = span(transcript, selection);
    if (!cells) return;
    const [start, end] = cells;
    const text = selectedText(transcript.rows.slice(start.row, end.row + 1), start, end);
    if (text.trim()) onCopy(text);
  };

  useMouse(
    (event) => {
      if (event.type === "wheel") {
        if (!event.handled) scrollBy(event.wheel * WHEEL_LINES);
        return;
      }
      if (event.handled) return;
      const at = relative(viewport.current, event);
      if (!at) return;

      if (event.type === "press") {
        if (!at.inside || event.button !== "left") return;
        event.handled = true;
        if (hit(pill.current, event)) {
          setSelection(null);
          return setAnchor(null);
        }
        if (at.x > width && now.current.thumb > 0) {
          drag.current = "scrollbar";
          return thumbTo(at.y);
        }
        // The space above a short conversation holds nothing to select.
        if (at.y < now.current.pad) return;
        const point = pointAt(at.x, at.y);
        if (!point) return;
        if (event.clicks === 1) {
          drag.current = "select";
          pressed.current = point;
          return setSelection(null);
        }
        // A double click takes the word, a triple click the line, and both copy at once.
        const index = find(now.current.transcript, point);
        const text = index === null ? "" : (now.current.transcript.rows[index]?.text ?? "");
        const [from, to] = event.clicks === 2 ? wordAt(text, point.col) : [0, width - 1];
        const next = { from: { ...point, col: from }, to: { ...point, col: to } };
        setSelection(next);
        return copy(next);
      }

      if (event.type === "drag" && drag.current) {
        event.handled = true;
        if (drag.current === "scrollbar") return thumbTo(at.y);
        extendTo(pointAt(at.x, at.y));
        if (at.y <= 0 && now.current.top > 0) holdEdge(-1, at.x);
        else if (at.y >= now.current.view - 1 && now.current.top < now.current.maxTop) holdEdge(1, at.x);
        else stopEdge();
        return;
      }

      if (event.type === "release" && drag.current) {
        event.handled = true;
        const was = drag.current;
        drag.current = null;
        stopEdge();
        const current = selected.current;
        const point = pressed.current;
        pressed.current = null;
        if (was !== "select") return;
        // A drag that came back to where it started selects nothing.
        if (current && samePoint(current.from, current.to)) return setSelection(null);
        if (!current) {
          // A click, not a drag: it opens or closes the tool call whose row it's on. The view stays
          // where it is, so the row doesn't move out from under the pointer as its output appears.
          if (!point) return;
          const { transcript, top, pad } = now.current;
          const index = find(transcript, point);
          const row = index === null ? undefined : transcript.rows[index];
          if (index === null || !row?.head || !transcript.tools.has(row.key)) return;
          setAnchor({ key: row.key, line: row.line, y: index - top + pad });
          onToggle(row.key);
          return;
        }
        copy(current);
      }
    },
    { fallback: true },
  );

  useInput((_, key) => {
    if (key.eventType === "release") return;
    if (selected.current && !drag.current) setSelection(null);
    if (!keys) return;
    const page = Math.max(1, now.current.view - 2);
    if (key.pageUp) scrollBy(-page);
    else if (key.pageDown) scrollBy(page);
    else if (key.ctrl && key.home) scrollTo(0);
    else if (key.ctrl && key.end) setAnchor(null);
  });

  // A new or resumed session starts at the end; so does sending a message.
  const sent = state.items.reduce((count, item) => count + (item.kind === "prompt" ? 1 : 0), 0);
  useEffect(() => {
    setAnchor(null);
    setSelection(null);
  }, [epoch, sent]);

  useEffect(() => {
    if (reveal) setAnchor({ key: reveal.key, line: 0 });
  }, [reveal]);

  // A terminal can move or rewrap what's on screen as it resizes, which Ink's line-by-line updates
  // don't know about. Once it settles, the screen is cleared and Ink draws the whole frame again.
  const { write } = useStdout();
  const size = `${columns}x${height}`;
  const drawnSize = useRef(size);
  useEffect(() => {
    if (drawnSize.current === size) return;
    drawnSize.current = size;
    const timer = setTimeout(() => write("\x1b[2J\x1b[H"), REPAINT_MS);
    return () => clearTimeout(timer);
  }, [size]);

  const cells = selection ? span(transcript, selection) : null;
  // Before the first message, the mirror and how to start, where there's room for them.
  const welcome = state.items.length === 0 && !state.live && view >= WELCOME_HEIGHT && width >= WELCOME_WIDTH + 4;
  // A tool call's row and the scrollbar answer to a click; the rest of the transcript to a drag,
  // which selects. The row under the pointer gets a band, so it's plain what a click would open.
  const hovered = useHover(
    viewport,
    (x, y) => {
      const { transcript, top, pad, thumb } = now.current;
      if (x > width) return thumb > 0 ? { key: "scrollbar", shape: "pointer" } : null;
      const row = y < pad ? undefined : transcript.rows[top + y - pad];
      if (!row) return null;
      return row.head && transcript.tools.has(row.key) ? { key: row.key, shape: "pointer" } : { key: "", shape: "text" };
    },
    !welcome,
  );
  useHover(pill, () => ({ key: "pill", shape: "pointer" }), below > 0 && anchor !== null);
  return (
    <Box flexDirection="column" width={columns} height={height}>
      {welcome ? (
        <Box ref={viewport} flexGrow={1} flexShrink={1} overflow="hidden" justifyContent="center" alignItems="center">
          <Welcome cwd={state.cwd} home={state.home} branch={branch} width={width} />
        </Box>
      ) : (
        <Box ref={viewport} flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
          <Box flexDirection="column" width={width + 1} flexShrink={0}>
            {pad > 0 ? <Box height={pad} /> : null}
            {rows.slice(top, top + view - pad).map((row, i) => {
              const range = cells ? cellsOn(row.text, top + i, cells[0], cells[1], row.inset) : null;
              return (
                <Text key={i} wrap="truncate-end">
                  {range
                    ? highlight(row.text, range[0], range[1])
                    : row.head && hovered === row.key && !drag.current
                      ? band(row.text, row.inset, width, PALETTE.hover)
                      : row.text || " "}
                </Text>
              );
            })}
          </Box>
          <Box flexDirection="column" width={1} flexShrink={0}>
            {scrollable
              ? Array.from({ length: view }, (_, i) => (
                  <Text key={i} color={anchor || drag.current === "scrollbar" ? PALETTE.gold : PALETTE.dust}>
                    {i >= thumbTop && i < thumbTop + thumb ? "┃" : " "}
                  </Text>
                ))
              : null}
          </Box>
          {below > 0 && anchor ? (
            <Box ref={pill} position="absolute" bottom={0} right={3}>
              <Text>
                <Text color={PALETTE.gold}>▐</Text>
                <Text backgroundColor={PALETTE.gold} color={PALETTE.ink} bold>
                  {`↓ ${plural(below, "more line")}`}
                </Text>
                <Text color={PALETTE.gold}>▌</Text>
              </Text>
            </Box>
          ) : null}
        </Box>
      )}
      <Box flexDirection="column" flexShrink={0}>
        {children}
      </Box>
    </Box>
  );
}

function samePoint(a: Point, b: Point) {
  return a.key === b.key && a.line === b.line && a.col === b.col;
}

function find(transcript: Transcript, point: Anchor) {
  const start = transcript.starts.get(point.key);
  return start === undefined ? null : start + point.line;
}

/** The selection's two ends as transcript cells, first one first. */
function span(transcript: Transcript, selection: Selection): [Cell, Cell] | null {
  const a = find(transcript, selection.from);
  const b = find(transcript, selection.to);
  if (a === null || b === null) return null;
  const from = { row: a, col: selection.from.col };
  const to = { row: b, col: selection.to.col };
  return from.row < to.row || (from.row === to.row && from.col <= to.col) ? [from, to] : [to, from];
}
