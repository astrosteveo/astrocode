// The Ledger's drawing rules, at any size. Every spec mockup and direction A's frames draw with
// these, so a rule changed here changes every picture that follows it.
//
// Columns: the gutter mark at 0, text from 2, activity verbs at 4, targets at VERB_END, results
// ending at `edge`. Rows from the bottom: the status bar, the box (a hairline and a row), and while
// Claude works the now line over the box.
import { Frame, type Span, type Style } from "./frame";
import { P } from "./palette";
import { diff as drawDiff, paragraph } from "./parts";
import { status as reading, wrap, type DiffRow } from "./scenario";

/** Text never runs wider than this, however wide the terminal: past it, lines get hard to read. */
export const MEASURE = 110;
/** From this width an opened line stands beside the transcript instead of under its line. */
export const WIDE = 160;
/** Under this width results that don't fit move under their line, and the status bar sheds readings. */
export const NARROW = 100;

export const code: Style = { fg: P.code };
export const sep: Span = [" · ", { fg: P.dust }];
export const plus = (n: number): Span => [`+${n}`, { fg: P.teal }];
export const minus = (n: number): Span => [`−${n}`, { fg: P.rose }];
export const size = (added: number, removed?: number, isNew = false): Span[] =>
  isNew ? [["new  ", { fg: P.haze }], plus(added)] : removed ? [plus(added), [" ", {}], minus(removed)] : [plus(added)];
export const haze = (text: string): Span => [text, { fg: P.haze }];
/** Spans drawn on a background, such as a panel's. */
export const on = (spans: Span[], bg: string): Span[] => spans.map(([t, s]) => [t, { ...(s ?? {}), bg }]);
export const dust = (text: string): Span => [text, { fg: P.dust }];

/** Marks in the gutter, one per state. */
export const MARK = {
  you: { ch: "❯", fg: P.gold },
  thinking: { ch: "∴", fg: P.dust },
  reply: { ch: "◆", fg: P.teal },
  running: { ch: "◐", fg: P.teal },
  done: { ch: "✓", fg: P.teal },
  waiting: { ch: "◇", fg: P.gold },
  failed: { ch: "✕", fg: P.rose },
  stopped: { ch: "■", fg: P.ember },
  background: { ch: "◌", fg: P.teal },
  notice: { ch: "○", fg: P.dust },
  ledger: { ch: "╰", fg: P.dust },
} as const;
export type Mark = keyof typeof MARK;

/**
 * A screen whose transcript is drawn by `draw`, which returns the row after its last line. The
 * transcript sits above `chrome` rows: from the top while it fits, and showing its end once it
 * doesn't, since the view follows Claude. With `bottom`, its end sits right above the chrome even
 * when it fits, as it does while a decision is open, so the line asking stays next to the answer.
 */
export function screen(W: number, H: number, chrome: number, draw: (l: Ledger) => number, bottom = false) {
  const tall = new Ledger(W, 400);
  const end = draw(tall);
  const room = H - chrome;
  const l = new Ledger(W, H);
  const from = Math.max(0, end - room);
  const shown = Math.min(room, end);
  const at = bottom ? room - shown : 0;
  for (let r = 0; r < shown; r++) l.f.cells[at + r] = tall.f.cells[from + r]!.map((cell) => ({ ...cell }));
  return l;
}

export class Ledger {
  readonly f: Frame;
  /** The column after the last result. */
  readonly edge: number;
  /** Columns prose wraps at. */
  readonly text: number;
  readonly narrow: boolean;
  readonly wide: boolean;
  /** Where something opened beside the transcript starts, on a wide screen. */
  readonly beside: number;

  constructor(
    readonly W: number,
    readonly H: number,
  ) {
    this.f = new Frame(W, H, P.page, P.text);
    this.narrow = W < NARROW;
    this.wide = W >= WIDE;
    this.edge = Math.min(W - 2, MEASURE + 2);
    this.text = this.edge - 2;
    this.beside = this.edge + 2;
  }

  /** Your message. */
  you(y: number, text: string) {
    this.mark(y, "you");
    return paragraph(this.f, 2, y, wrap(text, this.text), { fg: P.bright, bold: true }, { fg: P.code, bold: true });
  }

  thinking(y: number, text: string) {
    this.mark(y, "thinking");
    const style = { fg: P.haze, italic: true };
    return paragraph(this.f, 2, y, wrap(text, this.text), style, style);
  }

  /** A step of a finished turn, folded to Claude's sentence. */
  fold(y: number, said: string, took: string, mark: Mark = "done") {
    this.mark(y, mark);
    this.f.put(2, y, this.cut(said, this.edge - took.length - 4), { fg: P.haze });
    this.f.right(this.edge, y, took, { fg: P.dust });
    return y + 1;
  }

  /** A step's heading: its mark and Claude's sentence. */
  step(y: number, mark: Mark, said: string, took?: string) {
    this.mark(y, mark);
    const room = this.edge - 2 - (took ? took.length + 2 : 0);
    const lines = wrap(said, room);
    lines.forEach((line, i) => this.f.put(2, y + i, line, { fg: P.bright }));
    if (took) this.f.right(this.edge, y, took, { fg: P.dust });
    return y + lines.length;
  }

  /** One call: verb, target, result at the edge. A result that doesn't fit goes under the line. */
  act(y: number, verb: string, target: Span[], result: Span[] = [], verbColor = P.haze, bg?: string) {
    const at = this.narrow ? 14 : 16;
    if (bg) this.f.fill(2, y, this.edge - 2, 1, bg);
    this.f.put(4, y, verb, { fg: verbColor, bg });
    const end = this.f.spans(at, y, target.map(([t, s]) => [t, { fg: P.text, bg, ...s }]));
    const width = result.reduce((n, [t]) => n + Array.from(t).length, 0);
    if (!result.length) return y + 1;
    if (end + 2 + width <= this.edge) {
      this.f.rightSpans(this.edge, y, result.map(([t, s]) => [t, { bg, ...s }]));
      return y + 1;
    }
    this.f.spans(at, y + 1, result);
    return y + 2;
  }

  /** The line under a call for what's inside it: a subagent's latest call, or why it failed. */
  under(y: number, spans: Span[]) {
    const at = this.narrow ? 14 : 16;
    this.f.spans(at, y, [["└ ", { fg: P.dust }], ...spans]);
    return y + 1;
  }

  reply(y: number, text: string) {
    this.mark(y, "reply");
    return paragraph(this.f, 2, y, wrap(text, this.text), { fg: P.text }, code);
  }

  /** The turn's ledger line. */
  ledger(y: number, spans: Span[]) {
    this.mark(y, "ledger");
    this.f.spans(2, y, spans);
    return y + 1;
  }

  notice(y: number, spans: Span[]) {
    this.mark(y, "notice");
    this.f.spans(2, y, spans.map(([t, s]) => [t, { fg: P.haze, ...s }]));
    return y + 1;
  }

  mark(y: number, mark: Mark) {
    const { ch, fg } = MARK[mark];
    this.f.put(0, y, ch, { fg, bold: mark === "you" });
  }

  /** A row of the opened-in-place kind: the cursor's row, raised, with its gold mark. */
  cursor(y: number, x = 2, to = this.edge) {
    this.f.fill(x, y, to - x, 1, P.raised);
    this.f.put(x, y, "›", { fg: P.gold, bg: P.raised, bold: true });
  }

  /** A row of an opened list, such as the ledger's files: a name at column 4, its result at the edge. */
  entry(y: number, name: Span[], result: Span[] = [], cursor = false) {
    const bg = cursor ? P.raised : undefined;
    if (cursor) this.cursor(y);
    this.f.spans(4, y, name.map(([t, s]) => [t, { fg: cursor ? P.bright : P.text, bold: cursor, bg, ...s }]));
    if (result.length) this.f.rightSpans(this.edge, y, result.map(([t, s]) => [t, { bg, ...s }]));
    return y + 1;
  }

  /** A surface panel from row y0 to y1 (exclusive), with a gold hairline above when it has your keys. */
  panel(y0: number, y1: number, keys: boolean, x0 = 2, x1 = this.W) {
    if (keys) this.f.line(x0, y0 - 1, x1 - x0, "▁", { fg: P.gold });
    this.f.fill(x0, y0, x1 - x0, y1 - y0, P.surface);
  }

  diff(x: number, y: number, w: number, rows: DiffRow[], bg = P.surface) {
    this.f.fill(x, y, w, rows.length, bg);
    return drawDiff(this.f, x, y, w, rows, {
      page: bg,
      added: P.added,
      removed: P.removed,
      number: P.dust,
      text: P.text,
      sign: { "+": P.teal, "-": P.rose },
      gap: P.dust,
    });
  }

  /** Numbered options, the chosen one raised. */
  options(y: number, x: number, x1: number, items: [label: string, key?: string][], chosen = 0) {
    items.forEach(([label, key], i) => {
      const row = y + i;
      const bg = i === chosen ? P.raised : P.surface;
      this.f.fill(x, row, x1 - x, 1, bg);
      this.f.put(x, row, i === chosen ? "›" : " ", { fg: P.gold, bg, bold: true });
      this.f.put(x + 2, row, String(i + 1), { fg: P.haze, bg });
      this.f.put(x + 5, row, this.cut(label, x1 - x - 6 - (key ? key.length + 2 : 0)), { fg: i === chosen ? P.bright : P.text, bg, bold: i === chosen });
      if (key) this.f.right(x1 - 1, row, key, { fg: P.dust, bg });
    });
    return y + items.length;
  }

  /** The keys of whatever has focus: key in haze, what it does in dust. */
  hints(y: number, x: number, pairs: [key: string, does: string][], bg?: string, x1 = this.W) {
    const spans = pairs.flatMap(([key, does], i): Span[] => [
      [key, { fg: P.haze, bg }],
      [` ${does}${i < pairs.length - 1 ? "   " : ""}`, { fg: P.dust, bg }],
    ]);
    // On a narrow screen, keys that don't fit are left for `?`.
    while (spans.length > 2 && x + spans.reduce((n, [t]) => n + Array.from(t).length, 0) > x1) spans.splice(-2, 2);
    return this.f.spans(x, y, spans);
  }

  /** What Claude is doing now, over the box: the one thing on screen that moves. */
  now(spans: Span[], right: [key: string, does: string][] = [["esc", "stop"]]) {
    const y = this.H - 4;
    this.f.spans(0, y, spans);
    const keys = right.flatMap(([key, does], i): Span[] => [haze(key), dust(` ${does}${i < right.length - 1 ? "   " : ""}`)]);
    if (!this.narrow) this.f.rightSpans(this.W - 1, y, keys);
  }

  /** The box: a hairline, gold when it has your keys, and the row you type in. */
  box(focused: boolean, placeholder: string, hint: Span[] = [], typed = false) {
    this.f.line(0, this.H - 3, this.W, "▁", { fg: focused ? P.gold : P.surface });
    this.f.fill(0, this.H - 2, this.W, 1, P.surface);
    this.f.put(0, this.H - 2, "❯", { fg: focused ? P.gold : P.dust, bg: P.surface, bold: true });
    this.f.put(2, this.H - 2, placeholder, { fg: typed ? P.bright : P.dust, bg: P.surface, italic: hint.length > 0 });
    if (typed && focused) this.f.put(2 + Array.from(placeholder).length, this.H - 2, "▏", { fg: P.gold, bg: P.surface });
    if (hint.length) this.f.rightSpans(this.W - 1, this.H - 2, hint.map(([t, s]) => [t, { ...s, bg: P.surface }]));
  }

  /**
   * The status bar: the mode, who needs you, then readings by priority, as many as fit. Narrow
   * screens keep the context and the plan's weekly usage; the branch and model go first.
   */
  status(o: { mode?: string; modeColor?: string; needsYou?: number; running?: number } = {}) {
    const y = this.H - 1;
    const mode = o.mode ?? reading.mode;
    let x = this.f.put(0, y, ` ${mode} `, { fg: o.modeColor ?? P.text, bg: P.raised });
    if (o.needsYou) x = this.f.spans(x + 2, y, [[`← ${o.needsYou} needs you`, { fg: P.gold }]]);
    // In the order they're drawn; `rank` is the order they're kept in when room runs out.
    const readings: { rank: number; spans: Span[] }[] = [
      ...(o.running ? [{ rank: 3, spans: [[`◌ ${o.running} running`, { fg: P.teal }]] as Span[] }] : []),
      { rank: 1, spans: [haze("context "), [reading.context, { fg: P.bright }]] },
      { rank: 4, spans: [haze("5h "), [reading.fiveHour, { fg: P.bright }]] },
      { rank: 2, spans: [haze("7d "), [reading.sevenDay, { fg: P.bright }]] },
      { rank: 5, spans: [[reading.model, { fg: P.bright }], haze(` ${reading.effort}`)] },
      { rank: 6, spans: [haze(`${reading.branch} ${reading.changed}`)] },
    ];
    const width = (spans: Span[]) => spans.reduce((n, [t]) => n + Array.from(t).length, 0) + 3;
    let room = this.W - x - 3;
    const kept = new Set<number>();
    for (const r of [...readings].sort((a, b) => a.rank - b.rank)) {
      if (width(r.spans) > room) break;
      kept.add(r.rank);
      room -= width(r.spans);
    }
    const spans = readings.filter((r) => kept.has(r.rank)).flatMap((r, n) => [...(n ? [dust("   ")] : []), ...r.spans]);
    this.f.rightSpans(this.W - 1, y, spans);
  }

  /** Text cut to `width` with "…". */
  cut(text: string, width: number) {
    const chars = Array.from(text);
    return chars.length > width ? `${chars.slice(0, width - 1).join("")}…` : text;
  }
}
