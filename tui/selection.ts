// Selecting text in full screen's transcript, which is lines of styled text. A selection runs from
// one cell to another like a terminal's, but only over content: it leaves out the rail and its
// gutter, a panel's padding and edges, the hairline before a quote, and pictures, so copying code
// brings only the code. What's highlighted is what's copied. It's also where the pointer's shape
// comes from: what's text, and what's a link.
import { cellWidth } from "./markdown";
import { PALETTE, rgb, sgr, TINT } from "./theme";

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
/** A row of a picture's placeholder cells (`pictures.tsx`). Coloring them would change which image they show. */
const PICTURE = /^\u{10EEEE}/u;
/** What a double click selects: a word, a path, a URL or a number. */
const WORD = /[\p{L}\p{N}_\-./~:@#%+=?&$]/u;

/** The backgrounds a panel's rows are drawn on, as red, green and blue. */
const PANELS = [PALETTE.surface, TINT.added, TINT.removed].map((hex) => rgb(hex).join(";"));

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
      at += cellWidth(segment);
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
    col += cellWidth(segment);
  }
  return out;
}

/** `line` with the cells from `from` up to `to` drawn as selected, plain, and its own styles after. */
export function highlight(line: string, from: number, to: number) {
  let out = "";
  let col = 0;
  let selecting = false;
  /** The styles set so far, to pick back up after the selection. */
  let styles = "";
  for (const part of line.split(CODE)) {
    if (CODE.test(part)) {
      // A link goes on through the selection, so the terminal still knows it.
      if (LINK.test(part)) out += part;
      else {
        styles = part === "\x1b[0m" || part === "\x1b[m" ? "" : styles + part;
        if (!selecting) out += part;
      }
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (!selecting && col >= from && col < to) {
        out += RESET + SELECTED;
        selecting = true;
      } else if (selecting && col >= to) {
        out += RESET + styles;
        selecting = false;
      }
      out += segment;
      col += cellWidth(segment);
    }
  }
  return selecting ? out + RESET : out;
}

/**
 * `line` on `background` from cell `from` up to `to`, padded out to `to`, with its own colors kept:
 * the band behind what the pointer is over. The background goes back on after each of the line's
 * own color codes, since a reset among them would end it, and after the band the line's own
 * styles come back, so a panel's background carries on past a link.
 */
export function band(line: string, from: number, to: number, background: string) {
  const on = sgr(background, true);
  const off = "\x1b[49m";
  let out = "";
  let col = 0;
  let inside = false;
  /** The line's styles so far, to pick back up after the band. */
  let styles = "";
  for (const part of line.split(CODE)) {
    if (CODE.test(part)) {
      if (!LINK.test(part)) styles = part === "\x1b[0m" || part === "\x1b[m" ? "" : styles + part;
      out += part + (inside ? on : "");
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (!inside && col >= from && col < to) {
        out += on;
        inside = true;
      } else if (inside && col >= to) {
        out += off + styles;
        inside = false;
      }
      out += segment;
      col += cellWidth(segment);
    }
  }
  if (col < to) {
    const gap = Math.max(0, from - col);
    out += " ".repeat(gap) + (inside ? "" : on) + " ".repeat(to - col - gap);
  }
  return out + off;
}

/**
 * A row under the pointer, on a band from `from` to `to`. A row on a panel is raised a step
 * instead, so the panel still shows, and a diff's tinted rows keep their tint.
 */
export function hoverBand(line: string, from: number, to: number) {
  const under = backgroundAt(line, from);
  if (under === PANELS[0]) return band(line, from, to, PALETTE.raised);
  if (under && PANELS.includes(under)) return line;
  return band(line, from, to, PALETTE.hover);
}

/** A link the pointer is over, each run of it on the row banded as `hoverBand` bands a row. */
export function linkBand(line: string, href: string) {
  return linkRuns(line, href).reduce((out, [from, to]) => hoverBand(out, from, to), line);
}

/**
 * Where a row's content starts, past `inset` cells of rail, a panel's padding and a quote's
 * hairline, and whether the row is a panel's edge. Null for a picture's row, which has none.
 */
function margin(line: string, inset: number) {
  const body = sliceCells(plain(line), inset, Infinity);
  if (PICTURE.test(body)) return null;
  if (PANEL_EDGE.test(body)) return { from: inset, edge: true };
  // A panel's first cell is padding.
  if (PANELS.includes(backgroundAt(line, inset) ?? "")) return { from: inset + 1, edge: false };
  if (HAIRLINE.test(body)) return { from: inset + 2, edge: false };
  return { from: inset, edge: false };
}

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
  const to = Math.min(row === end.row ? end.col + 1 : Infinity, cellWidth(plain(line).trimEnd()));
  return from < to ? [from, to] : null;
}

/** Spaces this many or fewer between two words are part of the text; a wider gap, like a table's between columns, isn't. */
const WORD_GAP = 2;

/**
 * Whether the cell at `col` is text, where the pointer is a text beam: the row's words and the
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
    const width = cellWidth(segment);
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

/** A line's cells in order, each with the address of the link it's part of, or null. */
function* linkCells(line: string) {
  let href: string | null = null;
  let at = 0;
  for (const part of line.split(CODE)) {
    const link = LINK.exec(part);
    if (link) href = link[1] || null;
    if (CODE.test(part)) continue;
    for (const { segment } of graphemes.segment(part)) {
      const width = cellWidth(segment);
      yield { at, width, href };
      at += width;
    }
  }
}

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
    at += cellWidth(segment);
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
  return [cells[first]!.at, cells[last]!.at + cellWidth(cells[last]!.text) - 1];
}
