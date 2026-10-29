// Selecting text in full screen's transcript, which is lines of styled text. A selection runs from
// one cell to another like a terminal's, but only over content: it leaves out the rail and its
// gutter, a panel's padding and edges, the hairline before a quote, and pictures, so copying code
// brings only the code. What's highlighted is what's copied. It also finds a row's links, and
// lights up the words of what the pointer is over.
import { cellsOf, cellWidth } from "./markdown";
import { BODY, PALETTE, rgb, TINT } from "./theme";

/** A cell in the transcript: a row, and a column in cells. */
export type Cell = { row: number; col: number };

/** A color code, or a link's start or end (OSC 8): what a line carries between its cells. */
const CODE = /(\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\))/;
const CODE_ALL = new RegExp(CODE.source, "g");
/** A link's start, with its address; an empty address ends it. */
const LINK = /^\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)/;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A panel's soft top or bottom edge, with any label set into it. */
const PANEL_EDGE = /^[▄▀]/;
/** The hairline before a quote or a callout. */
const HAIRLINE = /^▏ /;
/**
 * A row of a picture's placeholder cells (`pictures.tsx`), after the indent of a list item it
 * belongs to. Coloring them would change which image they show.
 */
const PICTURE = /^ *\u{10EEEE}/u;
/** What a double click selects: a word, a path, a URL or a number. */
const WORD = /[\p{L}\p{N}_\-./~:@#%+=?&$]/u;

/** The backgrounds a panel's rows are drawn on, as red, green and blue. */
const PANELS = [PALETTE.surface, TINT.added, TINT.removed, TINT.addedWords, TINT.removedWords].map((hex) => rgb(hex).join(";"));

/** Gold, your color, with the text dark on it. */
const SELECTED = `\x1b[48;2;${rgb(PALETTE.gold).join(";")}m\x1b[38;2;${rgb(PALETTE.ink).join(";")}m`;
const RESET = "\x1b[0m";

export const plain = (line: string) => line.replace(CODE_ALL, "");

/** The background of the cell at `col`, as red, green and blue joined with `;`, or null for the terminal's own. */
function backgroundAt(line: string, col: number) {
  let background: string | null = null;
  let at = 0;
  for (const part of line.split(CODE)) {
    if (LINK.test(part)) continue;
    const codes = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (codes) {
      const list = (codes[1] || "0").split(";").map(Number);
      for (let i = 0; i < list.length; i++) {
        const code = list[i];
        if (code === 0 || code === 49) background = null;
        else if (code === 48 && list[i + 1] === 2) {
          background = list.slice(i + 2, i + 5).join(";");
          i += 4;
        } else if (code === 38) i += list[i + 1] === 5 ? 2 : 4;
      }
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (at >= col) return background;
      at += cellsOf(segment);
    }
  }
  return background;
}

/** The cells of `text` from `from` up to `to`. A wide character is in if it starts inside. */
export function sliceCells(text: string, from: number, to: number) {
  let out = "";
  let col = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (col >= to) break;
    if (col >= from) out += segment;
    col += cellsOf(segment);
  }
  return out;
}

/**
 * What `work` gives for a key, worked out once. A drag draws the same rows with the same ranges
 * frame after frame, so each is painted and measured once. It starts over past `size` keys.
 */
function cached<T>(size: number, work: (key: string) => T) {
  const known = new Map<string, T>();
  return (key: string) => {
    if (known.has(key)) return known.get(key)!;
    const value = work(key);
    if (known.size >= size) known.clear();
    known.set(key, value);
    return value;
  };
}

/** Between the parts of a key: a row's text never holds it. */
const PART = "\u0000";

const highlighted = cached(1000, (key) => {
  const [from, to, line] = key.split(PART);
  return paint(line!, [{ from: Number(from), to: Number(to), style: SELECTED }]);
});

/** `line` with the cells from `from` up to `to` drawn as selected, plain, and its own styles after. */
export function highlight(line: string, from: number, to: number) {
  return highlighted(`${from}${PART}${to}${PART}${line}`);
}

/** A run of cells drawn in a style of its own, over the line's: a selection, or a search's match. */
type Paint = { from: number; to: number; style: string };

/** `line` with each run drawn in its style, plain, and the line's own styles after it. Runs go in order and don't overlap. */
function paint(line: string, runs: Paint[]) {
  let out = "";
  let col = 0;
  let current: Paint | null = null;
  let next = 0;
  /** The styles set so far, to pick back up after a run. */
  let styles = "";
  for (const part of line.split(CODE)) {
    if (CODE.test(part)) {
      // A link goes on through a run, so the terminal still knows it.
      if (LINK.test(part)) out += part;
      else {
        styles = part === "\x1b[0m" || part === "\x1b[m" ? "" : styles + part;
        if (!current) out += part;
      }
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (current && col >= current.to) {
        out += RESET + styles;
        current = null;
      }
      while (runs[next] && runs[next]!.to <= col) next++;
      const run = runs[next];
      if (!current && run && col >= run.from && col < run.to) {
        out += RESET + run.style;
        current = run;
        next++;
      }
      out += segment;
      col += cellsOf(segment);
    }
  }
  return current ? out + RESET : out;
}

/** A match that isn't the one search is on: a deeper gold. */
const MATCH = `\x1b[48;2;${rgb(PALETTE.goldDeep).join(";")}m\x1b[38;2;${rgb(PALETTE.ink).join(";")}m`;

/**
 * Where `query` is in a row, as runs of cells. Smart case, as in a pager: lowercase matches either
 * case, and a capital letter makes it exact. A picture's row has no text to find.
 */
export function findIn(line: string, query: string): [number, number][] {
  if (!query) return [];
  const text = plain(line);
  if (PICTURE.test(text.trimStart().replace(/^[│ ]+/, ""))) return [];
  const exact = query !== query.toLowerCase();
  const haystack = exact ? text : text.toLowerCase();
  const needle = exact ? query : query.toLowerCase();
  const found: [number, number][] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    const from = cellWidth(text.slice(0, at));
    found.push([from, from + cellWidth(text.slice(at, at + needle.length))]);
  }
  return found;
}

/** A row with search's matches drawn on it; `current` is the one search is on, by its place in `matches`. */
export function markMatches(line: string, matches: [number, number][], current: number) {
  return paint(
    line,
    matches.map(([from, to], i) => ({ from, to, style: i === current ? SELECTED : MATCH })),
  );
}

/** A picture's placeholder cell (`pictures.tsx`), whose color says which image it shows. */
const PLACEHOLDER = "\u{10EEEE}";
/** Box drawing: the rail's lines and the like, which aren't words. */
const LINE_DRAWING = /^[\u2500-\u257F]/;
/** A foreground as the parameters of its color code, such as `38;2;240;184;90`. */
const foregroundOf = (hex: string) => `38;2;${rgb(hex).join(";")}`;
/** The foregrounds the pointer lights: the quiet colors, code and links. The terminal's own text color is lit too. */
const QUIET = new Set([PALETTE.star, BODY, PALETTE.haze, PALETTE.dust, PALETTE.tealLight, PALETTE.sky].map(foregroundOf));
const GOLD = foregroundOf(PALETTE.gold);

/**
 * The foreground after a color code, as the code's parameters, such as `38;2;240;184;90` or `31`,
 * or null for the terminal's own, and whether the code set it.
 */
function foregroundAfter(code: string, fg: string | null) {
  const codes = /^\x1b\[([0-9;]*)m$/.exec(code);
  let sets = false;
  if (!codes) return { fg, sets };
  const list = (codes[1] || "0").split(";").map(Number);
  for (let i = 0; i < list.length; i++) {
    const code = list[i]!;
    if (code === 0 || code === 39) {
      fg = null;
      sets = true;
    } else if (code === 38 || code === 48) {
      const length = list[i + 1] === 2 ? 4 : 2;
      if (code === 38) {
        fg = list.slice(i, i + length + 1).join(";");
        sets = true;
      }
      i += length;
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      fg = String(code);
      sets = true;
    }
  }
  return { fg, sets };
}

/**
 * A row under the pointer, which a click acts on, with its words lit in gold from cell `from` on.
 * The terminal's own text and the quiet colors turn gold, and the accents that say how something
 * went (teal, rose, ember) keep theirs. Nothing behind the words changes, so it reads as part of
 * the app rather than a selection. Lines such as the rail's stay as they are, and so do a picture's
 * cells, whose color says which image they show.
 */
export function lit(line: string, from: number) {
  return light(line, [[from, Infinity]]);
}

/** A link under the pointer, its words lit as `lit` lights a row's. */
export function litLink(line: string, href: string) {
  return light(line, linkRuns(line, href));
}

/** `line` with its words lit over `runs` of cells, each from one cell up to another, as `lit` says. */
function light(line: string, runs: [number, number][]) {
  let out = "";
  let col = 0;
  /** The line's own foreground so far, and the one the terminal has now: gold over a lit word. */
  let fg: string | null = null;
  let shown: string | null = null;
  const foreground = (color: string | null) => `\x1b[${color ?? "39"}m`;
  for (const part of line.split(CODE)) {
    if (CODE.test(part)) {
      out += part;
      if (LINK.test(part)) continue;
      const after = foregroundAfter(part, fg);
      fg = after.fg;
      if (after.sets) shown = fg;
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const inside = runs.some(([from, to]) => col >= from && col < to);
      const quiet = fg === null || QUIET.has(fg);
      const wanted = inside && quiet && !segment.startsWith(PLACEHOLDER) && !LINE_DRAWING.test(segment) ? GOLD : fg;
      // A space shows no color, so it doesn't need one.
      if (wanted !== shown && segment !== " ") {
        out += foreground(wanted);
        shown = wanted;
      }
      out += segment;
      col += cellsOf(segment);
    }
  }
  return shown === fg ? out : out + foreground(fg);
}

/**
 * Where a row's content starts, past `inset` cells of rail, a panel's padding and a quote's
 * hairline, where its text ends, and whether the row is a panel's edge. Null for a picture's row,
 * which has none.
 */
function margin(line: string, inset: number) {
  return margins(`${inset}${PART}${line}`);
}

const margins = cached(1000, (key) => {
  const [count, line] = key.split(PART) as [string, string];
  const inset = Number(count);
  const body = sliceCells(plain(line), inset, Infinity);
  // Where the row's text ends, since the spaces after it aren't selected.
  const end = cellWidth(plain(line).trimEnd());
  if (PICTURE.test(body)) return null;
  if (PANEL_EDGE.test(body)) return { from: inset, edge: true, end };
  // A panel's first cell is padding.
  if (PANELS.includes(backgroundAt(line, inset) ?? "")) return { from: inset + 1, edge: false, end };
  if (HAIRLINE.test(body)) return { from: inset + 2, edge: false, end };
  return { from: inset, edge: false, end };
});

/**
 * The cells of a row that a selection from `start` to `end` covers, or null for none. `end` is
 * included. `inset` is how many cells the rail takes at the start of the row. The selection
 * starts after decoration and stops where the row's text does, since the spaces after it aren't
 * copied.
 */
export function cellsOn(line: string, row: number, start: Cell, end: Cell, inset = 0): [number, number] | null {
  if (row < start.row || row > end.row) return null;
  const content = margin(line, inset);
  if (!content || (content.edge && start.row !== end.row)) return null;
  const from = Math.max(content.from, row === start.row ? start.col : 0);
  const to = Math.min(row === end.row ? end.col + 1 : Infinity, content.end);
  return from < to ? [from, to] : null;
}

/** Spaces this many or fewer between two words are part of the text; a wider gap, like a table's between columns, isn't. */
const WORD_GAP = 2;

/**
 * Whether the cell at `col` is text, which a double click would copy: the row's words and the
 * spaces between them, where a selection would take them, so not the rail, a panel's padding or
 * edges, or a quote's hairline. Indentation, the cells after the text and a wide gap are empty.
 */
export function isTextAt(line: string, col: number, inset = 0) {
  const content = margin(line, inset);
  if (!content || col < content.from) return false;
  // On a panel's edge, only the label set into it is text.
  const blank = content.edge ? /^[\s▄▀]$/u : /^\s$/u;
  const cells: { at: number; width: number; blank: boolean }[] = [];
  let at = 0;
  for (const { segment } of graphemes.segment(plain(line))) {
    const width = cellsOf(segment);
    if (at >= content.from) cells.push({ at, width, blank: blank.test(segment) });
    at += width;
  }
  const index = cells.findIndex((cell) => col < cell.at + Math.max(1, cell.width));
  const here = cells[index];
  if (!here || here.at > col) return false;
  if (!here.blank) return true;
  let before = index;
  while (before >= 0 && cells[before]!.blank) before--;
  let after = index;
  while (after < cells.length && cells[after]!.blank) after++;
  const left = cells[before];
  const right = cells[after];
  return left !== undefined && right !== undefined && right.at - (left.at + left.width) <= WORD_GAP;
}

/** A line's cells in order, each with the address of the link it's part of, or null. Asked again on every move of the pointer. */
const linkCells = cached(1000, (line) => {
  const cells: { at: number; width: number; href: string | null }[] = [];
  let href: string | null = null;
  let at = 0;
  for (const part of line.split(CODE)) {
    const link = LINK.exec(part);
    if (link) href = link[1] || null;
    if (CODE.test(part)) continue;
    for (const { segment } of graphemes.segment(part)) {
      const width = cellsOf(segment);
      cells.push({ at, width, href });
      at += width;
    }
  }
  return cells;
});

/** The address of the link the cell at `col` is part of, or null. */
export function linkAt(line: string, col: number) {
  for (const cell of linkCells(line)) {
    if (cell.at > col) break;
    if (col < cell.at + cell.width) return cell.href;
  }
  return null;
}

/** The cells of a line that are a link to `href`, as runs from one cell up to the next. */
function linkRuns(line: string, href: string) {
  const runs: [number, number][] = [];
  for (const cell of linkCells(line)) {
    if (cell.href !== href) continue;
    const last = runs.at(-1);
    if (last?.[1] === cell.at) last[1] += cell.width;
    else runs.push([cell.at, cell.at + cell.width]);
  }
  return runs;
}

/** The selected text, a line per row, without trailing spaces. `rows` are the rows the selection spans. */
export function selectedText(rows: { text: string; inset: number }[], start: Cell, end: Cell) {
  const out: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const { text: line, inset } = rows[row - start.row] ?? { text: "", inset: 0 };
    const body = sliceCells(plain(line), inset, Infinity);
    if (PICTURE.test(body) || (start.row !== end.row && PANEL_EDGE.test(body))) continue;
    const cells = cellsOn(line, row, start, end, inset);
    out.push(cells ? sliceCells(plain(line), cells[0], cells[1]).trimEnd() : "");
  }
  while (out.length > 1 && out.at(-1) === "") out.pop();
  while (out.length > 1 && out[0] === "") out.shift();
  return out.join("\n");
}

/** The cells of the word at `col`: a run of word characters, or the single character there. */
export function wordAt(line: string, col: number): [number, number] {
  const cells: { text: string; at: number }[] = [];
  let at = 0;
  for (const { segment } of graphemes.segment(plain(line))) {
    cells.push({ text: segment, at });
    at += cellsOf(segment);
  }
  const index = cells.findIndex((cell, i) => cell.at <= col && (cells[i + 1]?.at ?? Infinity) > col);
  if (index === -1) return [col, col];
  const isWord = (i: number) => WORD.test(cells[i]?.text ?? "");
  if (!isWord(index)) return [cells[index]!.at, cells[index]!.at];
  let first = index;
  let last = index;
  while (first > 0 && isWord(first - 1)) first--;
  while (last < cells.length - 1 && isWord(last + 1)) last++;
  // The full stop or comma after a word ends the sentence, not the word.
  while (last > first && /[.,:?]/.test(cells[last]?.text ?? "")) last--;
  return [cells[first]!.at, cells[last]!.at + cellsOf(cells[last]!.text) - 1];
}
