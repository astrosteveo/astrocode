// Selecting text in full screen's transcript, which is lines of styled text. A selection runs from
// one cell to another like a terminal's, but only over content: it leaves out the rail and its
// gutter, a panel's padding and edges, and the hairline before a quote, so copying code brings
// only the code. What's highlighted is what's copied.
import { cellWidth } from "./markdown";
import { PALETTE, rgb, sgr, TINT } from "./theme";

/** A cell in the transcript: a row, and a column in cells. */
export type Cell = { row: number; col: number };

const SGR = /(\x1b\[[0-9;]*m)/;
const SGR_ALL = /\x1b\[[0-9;]*m/g;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A panel's soft top or bottom edge, with any label set into it. */
const PANEL_EDGE = /^[▄▀]/;
/** The hairline before a quote or a callout. */
const HAIRLINE = /^▏ /;
/** What a double click selects: a word, a path, a URL or a number. */
const WORD = /[\p{L}\p{N}_\-./~:@#%+=?&$]/u;

/** The backgrounds a panel's rows are drawn on, as red, green and blue. */
const PANELS = [PALETTE.surface, TINT.added, TINT.removed].map((hex) => rgb(hex).join(";"));

/** Gold, your color, with the text dark on it. */
const SELECTED = `\x1b[48;2;${rgb(PALETTE.gold).join(";")}m\x1b[38;2;${rgb(PALETTE.ink).join(";")}m`;
const RESET = "\x1b[0m";

export const plain = (line: string) => line.replace(SGR_ALL, "");

/** The background of the cell at `col`, as red, green and blue joined with `;`, or null for the terminal's own. */
function backgroundAt(line: string, col: number) {
  let background: string | null = null;
  let at = 0;
  for (const part of line.split(SGR)) {
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
  for (const part of line.split(SGR)) {
    if (SGR.test(part)) {
      styles = part === "\x1b[0m" || part === "\x1b[m" ? "" : styles + part;
      if (!selecting) out += part;
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
 * the band behind a row the pointer is over. The background goes back on after each of the line's
 * own color codes, since a reset among them would end it.
 */
export function band(line: string, from: number, to: number, background: string) {
  const on = sgr(background, true);
  const off = "\x1b[49m";
  let out = "";
  let col = 0;
  let inside = false;
  for (const part of line.split(SGR)) {
    if (SGR.test(part)) {
      out += part + (inside ? on : "");
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (!inside && col >= from && col < to) {
        out += on;
        inside = true;
      } else if (inside && col >= to) {
        out += off;
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
 * The cells of a row that a selection from `start` to `end` covers, or null for none. `end` is
 * included. `inset` is how many cells the rail takes at the start of the row. The selection
 * starts after decoration and stops where the row's text does, since the spaces after it aren't
 * copied.
 */
export function cellsOn(line: string, row: number, start: Cell, end: Cell, inset = 0): [number, number] | null {
  if (row < start.row || row > end.row) return null;
  let from = Math.max(inset, row === start.row ? start.col : 0);
  let to = row === end.row ? end.col + 1 : Infinity;
  const text = plain(line);
  const body = sliceCells(text, inset, Infinity);
  if (PANEL_EDGE.test(body)) {
    if (start.row !== end.row) return null;
  } else if (PANELS.includes(backgroundAt(line, inset) ?? "")) {
    // A panel's first cell is padding.
    from = Math.max(from, inset + 1);
  } else if (HAIRLINE.test(body)) {
    from = Math.max(from, inset + 2);
  }
  to = Math.min(to, cellWidth(text.trimEnd()));
  return from < to ? [from, to] : null;
}

/** The selected text, a line per row, without trailing spaces. `rows` are the rows the selection spans. */
export function selectedText(rows: { text: string; inset: number }[], start: Cell, end: Cell) {
  const out: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const { text: line, inset } = rows[row - start.row] ?? { text: "", inset: 0 };
    if (start.row !== end.row && PANEL_EDGE.test(sliceCells(plain(line), inset, Infinity))) continue;
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
