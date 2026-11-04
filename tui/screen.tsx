// Full screen: the conversation in a viewport that scrolls, with the message box and status bar
// pinned under it. The wheel, PgUp and PgDn scroll, and the viewport follows the end until you
// scroll up. Ctrl+O, or a click on a line, gives the transcript your keys: a gold `›` marks the line
// the cursor is on, ↑ and ↓ move it, and Enter does what a click on the line does. A step's line
// opens its call under the line, at every width, a command opens, and what's open closes. Esc, q
// or Ctrl+O gives your keys back to the box. Dragging selects text and copies it, a click on a
// link opens it, and on a picture enlarges it. Ctrl+F finds text in it, and Alt+↑ and Alt+↓ jump
// between your messages, with Shift between tool calls and commands.
import { Box, Text, useBoxMetrics, useInput, useStdout, type DOMElement, type Key } from "ink";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ImageAttachment } from "../src/events";
import type { State } from "../src/view/state";
import { plural } from "../src/view/tools";
import { callTarget } from "./entries";
import { hit, MULTI_CLICK_MS, relative, useHover, useMouse } from "./mouse";
import type { Find } from "./find";
import { strokeOf, type Keymap } from "./keys";
import { cellWidth } from "./markdown";
import { cellsOn, cursorOn, findIn, hasContent, highlight, isTextAt, linkAt, lit, litLink, markMatches, selectedText, wordAt, type Cell } from "./selection";
import { PALETTE } from "./theme";
import { Welcome, WELCOME_HEIGHT, WELCOME_WIDTH } from "./mirror";
import { moveTarget, tabTarget, WHOLE, type Opened } from "./opened";
import { imageAt, pictureRows, usePictureRows } from "./pictures";
import { useTranscript, type Row, type Transcript } from "./transcript";

const WHEEL_LINES = 3;
/**
 * A drag held at the viewport's edge scrolls it this many lines a second at first, and faster the
 * longer it's held, up to the top speed after the ramp. It's checked each frame, so the lines come
 * at even intervals.
 */
const EDGE_LINES_START = 20;
const EDGE_LINES_TOP = 60;
const EDGE_RAMP_MS = 1500;
const EDGE_TICK_MS = 1000 / 60;
/** How long after the window stops resizing the whole screen is drawn again. */
const REPAINT_MS = 150;
/** Between an entry's key and an address in the key of a link under the pointer. */
const LINK_KEY = "\n";

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
  /** The call opened under its line, which is scrolled into view as it opens. */
  opened?: Opened;
  /** Whether PgUp and PgDn scroll; a picker open below uses them for its list. */
  keys: boolean;
  /** The transcript has your keys: its cursor shows, and moves with ↑ and ↓. */
  focused: boolean;
  /** What keys do, for the one that toggles the transcript (Ctrl+O). */
  keymap: Keymap;
  /** A click on a line, which gives the transcript your keys. */
  onFocus: () => void;
  /** Esc, q or Ctrl+O, which give your keys back to the box. */
  onLeave: () => void;
  /**
   * A click on an entry, or on what a line of it stands for, such as a step's line for a call. True
   * when it opened or closed in place, false when it opened something else.
   */
  onToggle: (key: string) => boolean;
  onCopy: (text: string) => void;
  /** `e` in an opened call: its tab in $EDITOR. */
  onEdit: (text: string) => void;
  /** A click on a link. */
  onOpen: (url: string) => void;
  /** A click on a picture. */
  onPicture: (image: ImageAttachment) => void;
  /** What Ctrl+F is finding, while its bar is open. */
  find: Find | null;
  /** How many matches the transcript has for it. */
  onMatches: (count: number) => void;
  /** What's pinned under the viewport. */
  children: ReactNode;
};

export function Screen({ state, epoch, branch, columns, rows: height, expanded, waiting, opened, keys, focused, keymap, onFocus, onLeave, onToggle, onCopy, onEdit, onOpen, onPicture, find: search, onMatches, children }: Props) {
  // A column for the scrollbar and one to keep it off the text.
  const width = Math.max(10, columns - 2);
  const viewport = useRef<DOMElement>(null);
  const pill = useRef<DOMElement>(null);
  const metrics = useBoxMetrics(viewport);
  const view = Math.max(1, metrics.hasMeasured ? metrics.height : height - 6);
  const transcript = useTranscript({ state, width, pictureRows: pictureRows(view), branch, expanded, waiting, opened });
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /** The row the cursor is on, kept while your keys are elsewhere. */
  const [cursor, setCursor] = useState<Anchor | null>(null);
  const [selection, setSelectionState] = useState<Selection | null>(null);
  /** The selection as of the last event, which may be newer than the last render. */
  const selected = useRef<Selection | null>(null);
  const drag = useRef<"select" | "scrollbar" | null>(null);
  /** Where the button went down to select, until a drag leaves that cell and starts the selection. */
  const pressed = useRef<Point | null>(null);
  /** A drag held at an edge: its direction, its column, when it started, and the lines it has built up toward the next. */
  const edge = useRef<{ timer: ReturnType<typeof setInterval>; step: number; x: number; since: number; last: number; owed: number } | null>(null);
  /**
   * What a click on a link or inside an opened entry does, held until it's plain the click isn't
   * the first of a double or triple click, which copy a word or a line instead.
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { rows } = transcript;
  const total = rows.length;

  // Search's matches, top to bottom, and the one it's on, counted back from the newest.
  const query = search?.query ?? "";
  const matches = useMemo(
    () => (query ? rows.flatMap((row, index) => findIn(row.text, query).map(([from, to]) => ({ index, from, to }))) : []),
    [rows, query],
  );
  const current = matches.length ? matches.length - 1 - ((search?.back ?? 0) % matches.length) : -1;
  const marks = useMemo(() => {
    const byRow = new Map<number, { ranges: [number, number][]; current: number }>();
    matches.forEach((match, i) => {
      const row = byRow.get(match.index) ?? { ranges: [], current: -1 };
      if (i === current) row.current = row.ranges.length;
      row.ranges.push([match.from, match.to]);
      byRow.set(match.index, row);
    });
    return byRow;
  }, [matches, current]);
  useEffect(() => onMatches(matches.length), [matches.length]);
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
  const at = cursor ? cursorAt(transcript, cursor) : null;

  /** What handlers see: this render's numbers, moved along by events that haven't rendered yet. */
  const now = useRef({ transcript, top, maxTop, view, thumb, pad, following: anchor === null, at });
  now.current = { transcript, top, maxTop, view, thumb, pad, following: anchor === null, at };

  const setSelection = (next: Selection | null) => {
    selected.current = next;
    setSelectionState(next);
  };

  const scrollTo = (index: number) => {
    const { transcript, maxTop } = now.current;
    const next = Math.max(0, Math.min(maxTop, Math.round(index)));
    const row = transcript.rows[next];
    const held = next >= maxTop || !row ? null : { key: row.key, line: row.line };
    now.current = { ...now.current, top: next, following: held === null };
    setAnchor(held);
  };
  const scrollBy = (lines: number) => scrollTo(now.current.top + lines);

  /** Scrolls the row at `index` into view, and the rows down to `end` as far as they fit with it. */
  const show = (index: number, end = index) => {
    const { top, view, pad } = now.current;
    const shown = view - pad;
    if (index < top) scrollTo(index);
    else if (end >= top + shown) scrollTo(Math.min(index, end - shown + 1));
  };

  /** The cursor onto the row at `index`. */
  const place = (index: number) => {
    const row = now.current.transcript.rows[index];
    if (!row) return;
    now.current = { ...now.current, at: index };
    setCursor({ key: row.key, line: row.line });
  };

  /** The last line in view the cursor can be on, or the transcript's last when none is. */
  const lastShown = () => {
    const { transcript, top, view, pad } = now.current;
    const { rows } = transcript;
    for (let i = Math.min(rows.length, top + view - pad) - 1; i >= top; i--) if (isStop(rows[i])) return i;
    return rows.findLastIndex(isStop);
  };

  /** The first line in view the cursor can be on, or as lastShown when none is. */
  const firstShown = () => {
    const { transcript, top, view, pad } = now.current;
    const { rows } = transcript;
    for (let i = top; i < Math.min(rows.length, top + view - pad); i++) if (isStop(rows[i])) return i;
    return lastShown();
  };

  /**
   * ↑ or ↓: the cursor to the line before or after, with the view following it; `lines` on, for
   * PgUp and PgDn, which go as far as there are lines.
   */
  const moveCursor = (by: -1 | 1, lines = 1) => {
    const { transcript, at } = now.current;
    const { rows } = transcript;
    let index = Math.max(0, Math.min(rows.length - 1, (at ?? lastShown()) + by * lines));
    while (rows[index] && !isStop(rows[index])) index += by;
    if (!rows[index] && lines > 1) index = by < 0 ? rows.findIndex(isStop) : rows.findLastIndex(isStop);
    if (!rows[index]) return;
    place(index);
    show(index);
  };

  /** PgUp or PgDn: the cursor and the view half a screen up or down, as `claude` pages. */
  const pageCursor = (by: -1 | 1) => {
    const { view, pad } = now.current;
    const half = Math.max(1, Math.floor((view - pad) / 2));
    scrollBy(by * half);
    moveCursor(by, half);
  };

  /** Home or End: the cursor to the first line or the last, and the view to the top or the end, which it then follows. */
  const endCursor = (by: -1 | 1) => {
    const { rows } = now.current.transcript;
    const index = by < 0 ? rows.findIndex(isStop) : rows.findLastIndex(isStop);
    if (index === -1) return;
    place(index);
    scrollTo(by < 0 ? 0 : now.current.maxTop);
  };

  /**
   * Enter: what a click on the cursor's line does. The line stays where it is on screen, even in a
   * view that follows the end, so what opens under it can't push the cursor out of view; what closes
   * leaves the cursor on its first line, in the same place.
   */
  const enter = () => {
    const { transcript, at, top, pad, view } = now.current;
    const row = at === null ? undefined : transcript.rows[at];
    if (at === null || !row?.hot) return;
    const head = closes(row) ? headOf(transcript, at) : undefined;
    if (!onToggle(row.target ?? row.key)) return;
    const held = head ?? row;
    if (head) setCursor({ key: head.key, line: head.line });
    setAnchor({ key: held.key, line: held.line, y: Math.max(0, Math.min(at - top + pad, view - 4)) });
  };

  /**
   * The transcript's own keys, while it has yours. True for one of them. The keys that work anywhere,
   * Ctrl+C and Shift+Tab among them, are the box's, which still gets them.
   */
  const transcriptKey = (input: string, key: Key) => {
    const open = now.current.transcript.opened;
    // A letter with Ctrl or Alt held is another key: Ctrl+C isn't `c`.
    const letter = key.ctrl || key.meta ? "" : input;
    if ((key.upArrow || key.downArrow) && !key.meta && !key.shift) moveCursor(key.upArrow ? -1 : 1);
    else if (key.pageUp || key.pageDown) pageCursor(key.pageUp ? -1 : 1);
    else if (key.home || key.end) endCursor(key.home ? -1 : 1);
    else if (key.meta && (key.upArrow || key.downArrow)) jumpCursor(key.upArrow ? -1 : 1, key.shift);
    else if (letter === "{" || letter === "}") jumpCursor(letter === "{" ? -1 : 1, false);
    else if (key.return) enter();
    // Esc backs out one level: what's open closes first.
    else if (key.escape && open) onToggle(callTarget(open.id));
    else if (key.escape || letter === "q" || keymap.get(strokeOf(input, key) ?? "") === "app:toggleTranscript") onLeave();
    else if (!open) return false;
    else if (key.leftArrow || key.rightArrow) onToggle(moveTarget(key.leftArrow ? -1 : 1));
    else if (key.tab && !key.shift) onToggle(tabTarget(open.tabs[(open.tabs.indexOf(open.tab) + 1) % open.tabs.length]!));
    else if (letter === "c" || letter === "e") {
      if (open.copy) (letter === "c" ? onCopy : onEdit)(open.copy);
    } else return false;
    return true;
  };

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
    if (current && samePoint(current.to, point)) return;
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
      const held = edge.current;
      if (!held) return;
      const time = performance.now();
      const ramp = Math.min(1, (time - held.since) / EDGE_RAMP_MS);
      const rate = EDGE_LINES_START + (EDGE_LINES_TOP - EDGE_LINES_START) * ramp;
      held.owed += (rate * (time - held.last)) / 1000;
      held.last = time;
      const lines = Math.floor(held.owed);
      if (lines < 1) return;
      held.owed -= lines;
      scrollBy(step * lines);
      extendTo(pointAt(held.x, step < 0 ? 0 : now.current.view - 1));
    }, EDGE_TICK_MS);
    const time = performance.now();
    edge.current = { timer, step, x, since: time, last: time, owed: 0 };
  };

  const cancelPending = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
  };

  const later = (action: () => void) => {
    cancelPending();
    pending.current = setTimeout(() => {
      pending.current = null;
      action();
    }, MULTI_CLICK_MS);
  };

  useEffect(
    () => () => {
      stopEdge();
      cancelPending();
    },
    [],
  );

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
        cancelPending();
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
          // A click, not a drag: it opens the link it's on, else opens or closes the tool call or
          // command it's on. The view stays where it is, so the row doesn't move out from under the
          // pointer as it opens; but a view following the end goes on following, so new entries
          // stay in view.
          if (!point) return;
          const { transcript, top, pad, following } = now.current;
          const index = find(transcript, point);
          const row = index === null ? undefined : transcript.rows[index];
          if (index === null || !row) return;
          const url = linkAt(row.text, point.col);
          if (url) return later(() => onOpen(url));
          const image = imageAt(row.text, point.col);
          if (image) return onPicture(image);
          // A click puts the cursor on its line, with your keys, and does there what Enter does.
          if (isStop(row)) {
            place(index);
            onFocus();
          }
          if (!row.hot) return;
          const spot = spotAt(row, point.col);
          if (spot) return onToggle(spot);
          const y = index - top + pad;
          if (!closes(row)) {
            if (onToggle(row.target ?? row.key) && !following) setAnchor({ key: row.key, line: row.line, y });
            return;
          }
          // Inside what's open, a click closes it. The entry's first row, or the line an opened call
          // is under, then takes the place of the row clicked, so it's where you were reading, not
          // wherever its top had been. On text it waits out a double click, which copies a word or a
          // line; on blank cells there's nothing to copy, so it closes at once.
          const { key } = row;
          const close = () => {
            const { transcript, view, following } = now.current;
            const head = headOf(transcript, index);
            if (onToggle(row.target ?? key) && !following && head) setAnchor({ key, line: head.line, y: Math.max(0, Math.min(y, view - 4)) });
          };
          if (isTextAt(row.text, point.col, row.inset)) later(close);
          else close();
          return;
        }
        copy(current);
      }
    },
    { fallback: true },
  );

  useInput((input, key) => {
    if (key.eventType === "release") return;
    if (selected.current && !drag.current) setSelection(null);
    if (focused && transcriptKey(input, key)) return;
    if (!keys) return;
    const page = Math.max(1, now.current.view - 2);
    if (key.meta && (key.upArrow || key.downArrow)) return jump(key.upArrow ? -1 : 1, key.shift);
    if (key.pageUp) scrollBy(-page);
    else if (key.pageDown) scrollBy(page);
    else if (key.ctrl && key.home) scrollTo(0);
    else if (key.ctrl && key.end) setAnchor(null);
  });

  /**
   * Alt+↑ and Alt+↓: the viewport's top goes to your message before or after the one there, or
   * with Shift to a tool call or command. Past the last one, it goes back to following the end.
   */
  const jump = (by: -1 | 1, tools: boolean) => {
    const { top } = now.current;
    const starts = startsOf(tools);
    const next = by < 0 ? starts.findLast((start) => start < top) : starts.find((start) => start > top);
    if (next === undefined) return by > 0 ? setAnchor(null) : undefined;
    scrollTo(next);
  };

  /**
   * `{` and `}`, Alt+↑ and Alt+↓ while the transcript has your keys: the cursor to your message
   * before or after it, or with Shift to a tool call or command, at the top of the view as `jump`
   * puts it. Past the last one, it goes to the end.
   */
  const jumpCursor = (by: -1 | 1, tools: boolean) => {
    const { transcript, at } = now.current;
    const from = at ?? lastShown();
    const lines = startsOf(tools).flatMap((start) => {
      const line = transcript.rows.findIndex((row, i) => i >= start && isStop(row));
      return line === -1 ? [] : [{ start, line }];
    });
    const next = by < 0 ? lines.findLast(({ line }) => line < from) : lines.find(({ line }) => line > from);
    if (!next) return by > 0 ? endCursor(1) : undefined;
    place(next.line);
    scrollTo(next.start);
  };

  /** Where each of your messages starts in the transcript, or with `tools` each tool call and command. */
  const startsOf = (tools: boolean) => {
    const { transcript } = now.current;
    return state.items.flatMap((item) => {
      const wanted = tools ? item.kind === "tool" || item.kind === "shell" : item.kind === "prompt";
      const start = wanted ? transcript.starts.get(item.key) : undefined;
      return start === undefined ? [] : [start];
    });
  };

  // A new or resumed session starts at the end; so does sending a message.
  const sent = state.items.reduce((count, item) => count + (item.kind === "prompt" ? 1 : 0), 0);
  useEffect(() => {
    setAnchor(null);
    setSelection(null);
  }, [epoch, sent]);

  // Once a call that opens or closes is drawn so, as from ← and → or Esc, the cursor goes to its
  // line, which is scrolled into view with as much of what opened under it as fits.
  const keep = opened?.id;
  const keeping = useRef<string | undefined>(undefined);
  const kept = useRef<string | undefined>(undefined);
  useEffect(() => {
    keeping.current = keep ?? kept.current;
    kept.current = keep;
  }, [keep]);
  useEffect(() => {
    const id = keeping.current;
    if (id === undefined || transcript.opened?.id !== keep) return;
    const at = state.tools[id];
    const item = at === undefined ? undefined : state.items[at];
    const index = item ? transcript.starts.get(item.key) : undefined;
    keeping.current = undefined;
    if (index === undefined) return;
    if (focused) place(index);
    show(index, keep === undefined ? index : openedEnd(transcript, index));
  }, [keep, transcript]);

  // While the transcript has your keys its cursor is in view, so the gold mark shows. Your keys
  // coming to it put the cursor on the last line in view, unless it's in view already. After that,
  // the view moving away from it (the wheel, or the end it follows growing) brings it to the nearest
  // line in view, as does its line going, as a streamed reply's does once it's written for good.
  // With no line at all to be on, your keys go back to the box.
  const hadKeys = useRef(false);
  useEffect(() => {
    const arriving = focused && !hadKeys.current;
    hadKeys.current = focused;
    if (!focused) return;
    const { at, top, view, pad } = now.current;
    if (at !== null && at >= top && at < top + view - pad) return;
    const index = !arriving && at !== null && at < top ? firstShown() : lastShown();
    if (index === -1) return onLeave();
    place(index);
    show(index);
  }, [focused, transcript, top, view]);

  // The match search is on stays in view, a third of the way down when it has to move.
  const target = matches[current]?.index;
  useEffect(() => {
    if (target === undefined) return;
    const { top, view, pad } = now.current;
    if (target >= top && target < top + view - pad) return;
    scrollTo(target - Math.floor(view / 3));
  }, [target, query, search?.back]);

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
  // Links, tool calls, commands and the scrollbar answer to a click, and the pointer is a hand over
  // them; over a picture, which a click enlarges, it's a magnifying glass. What a click would open
  // lights up at its first row, a step's line or a card's title, its words in gold, so it's plain
  // what it is. Elsewhere, over text too, the pointer is the terminal's own arrow, as over the rest
  // of an app; a drag still selects.
  const hovered = useHover(
    viewport,
    (x, y) => {
      const { transcript, top, pad, thumb } = now.current;
      if (x > width + 1) return null;
      if (x > width) return thumb > 0 ? { key: "scrollbar", shape: "pointer" } : null;
      // A drag that selects lights nothing up as it passes.
      if (drag.current === "select" && selected.current) return null;
      const row = y < pad ? undefined : transcript.rows[top + y - pad];
      if (!row) return null;
      const url = linkAt(row.text, x);
      if (url) return { key: `${row.key}${LINK_KEY}${url}`, shape: "pointer" };
      // A picture doesn't light up, which would change which image it shows.
      if (imageAt(row.text, x)) return { key: "", shape: "zoom-in" };
      const spot = spotAt(row, x);
      if (spot) return { key: spot, shape: "pointer" };
      // What's open is for reading and selecting, so only its first row is what a click acts on, and
      // an opened call's `⋯ N lines`.
      if (row.hot && !closes(row)) return { key: row.target ?? row.key, shape: "pointer" };
      return null;
    },
    !welcome,
  );
  const [linkEntry, linkUrl] = hovered?.includes(LINK_KEY) ? hovered.split(LINK_KEY) : [];
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
              const found = marks.get(top + i);
              return (
                <Text key={i} wrap="truncate-end">
                  {range
                    ? highlight(row.text, range[0], range[1])
                    : found
                      ? markMatches(row.text, found.ranges, found.current)
                      : drag.current
                      ? row.text || " "
                      : focused && top + i === at
                        ? cursorOn(row.text, row.inset - 1, width)
                      : linkUrl && row.key === linkEntry
                        ? litLink(row.text, linkUrl)
                        : row.hot && (row.head || row.target === WHOLE) && hovered === (row.target ?? row.key)
                          ? lit(row.text, row.inset)
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

/**
 * The transcript's keys while it has yours, as many as fit in `room` cells, for the box's top edge.
 * It's drawn there rather than on a row of its own, so the transcript doesn't move as it takes them.
 */
export function transcriptHint(opened: boolean, room: number) {
  // Four to six keys, as every hint line has; the rest are for the key sheet.
  const pairs = opened
    ? ["↑↓ move", "←→ calls", "tab views", "c copy", "enter open or close", "esc close"]
    : ["↑↓ move", "enter open or close", "{ } messages", "esc back to the box"];
  let hint = "";
  for (const pair of pairs) {
    const next = hint ? `${hint}   ${pair}` : pair;
    if (cellWidth(next) > room) break;
    hint = next;
  }
  return hint;
}

/** A line the cursor stops on: one with something past the rail. */
function isStop(row: Row | undefined) {
  return row !== undefined && row.inset > 0 && hasContent(row.text, row.inset);
}

/** Where the cursor is: its row, or the last of its entry's rows when the entry has fewer now, as when what was open closed. */
function cursorAt(transcript: Transcript, cursor: Anchor) {
  const start = transcript.starts.get(cursor.key);
  if (start === undefined) return null;
  let index = Math.min(start + cursor.line, transcript.rows.length - 1);
  while (index > start && transcript.rows[index]?.key !== cursor.key) index--;
  return index;
}

function samePoint(a: Point, b: Point) {
  return a.key === b.key && a.line === b.line && a.col === b.col;
}

/**
 * The row an open row belongs to: an open entry's first line of content, or the line an opened call
 * is under.
 */
function headOf(transcript: Transcript, index: number) {
  let i = index;
  while (i > 0 && transcript.rows[i]?.open && !transcript.rows[i]?.head && transcript.rows[i - 1]?.key === transcript.rows[index]?.key) i--;
  return transcript.rows[i];
}

/** The last row of what's opened under the line at `index`, past what's drawn under the line, such as why it failed. */
function openedEnd(transcript: Transcript, index: number) {
  const { rows } = transcript;
  let end = index;
  for (let i = index + 1; rows[i]?.key === rows[index]?.key; i++) {
    if (rows[i]!.open && !rows[i]!.head) end = i;
    else if (end > index) break;
  }
  return end;
}

/** Whether Enter or a click on a row closes what it's in: any row of what's open but its first, and an opened call's `⋯ N lines`, which opens more. */
function closes(row: Row) {
  return row.open && !row.head && row.target !== WHOLE;
}

/** What a click at `col` on a row acts on in a way of its own, such as an opened call's tab. */
function spotAt(row: Row, col: number) {
  return row.spots?.find((spot) => col >= spot.from && col < spot.to)?.target;
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
