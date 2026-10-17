// Edits as diffs on a panel: added lines tinted teal, removed ones rose, the rest quiet, all in the
// file's syntax colors. A removed line and the added line that replaced it are compared word by
// word, and the words that changed get a stronger tint. Where the panel is wide enough, the old
// lines go on the left and the new on the right, each with its line number when Claude Code's
// patch gives them, so a changed line sits beside what it replaced. Long lines wrap.
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { ToolCall } from "../src/view/state";
import { field, plural } from "../src/view/tools";
import { highlightCode } from "./highlight";
import { cellWidth, printable } from "./markdown";
import { Panel } from "./markdown-view";
import { PALETTE, rgb, TINT } from "./theme";

/** A line of a diff, with its numbers in the old and new file where they're known. */
export type DiffLine = { kind: "context" | "removed" | "added"; text: string; old?: number; new?: number };

/** A panel this wide or wider shows the two sides next to each other. */
export const SPLIT_WIDTH = 140;
/** Past this many lines a side, lines are compared in one block instead of matched up, which would be slow. */
const MATCH_LIMIT = 1000;
/** Past this many words a line, a changed line is tinted whole rather than compared word by word. */
const WORD_LIMIT = 400;
/** A pair of lines sharing less than this share of their text changed too much for word tints to help. */
const SHARED_ENOUGH = 0.35;

/** An edit's lines: Claude Code's patch when it sent one, with context and numbers, else a diff of the text it replaced. */
export function editLines(call: ToolCall): DiffLine[] {
  const hunks = field(call.output, "structuredPatch");
  if (Array.isArray(hunks) && hunks.length) {
    return hunks.flatMap((hunk) => {
      let old = Number(field(hunk, "oldStart")) || undefined;
      let next = Number(field(hunk, "newStart")) || undefined;
      const lines = field(hunk, "lines");
      return (Array.isArray(lines) ? lines.map(String) : []).map((line): DiffLine => {
        const kind = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "context";
        const numbered: DiffLine = { kind, text: line.slice(1), old: kind === "added" ? undefined : old, new: kind === "removed" ? undefined : next };
        if (kind !== "added" && old !== undefined) old++;
        if (kind !== "removed" && next !== undefined) next++;
        return numbered;
      });
    });
  }
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  return diffLines(text("old_string"), text("new_string"));
}

/** The lines that changed between two texts, with the lines they share as context. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > MATCH_LIMIT || b.length > MATCH_LIMIT) {
    return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  }
  // The longest run of lines the two share, from the end, so the walk below can go from the start.
  const longest = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i++]! });
      j++;
    } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) {
      // On a tie the removed line goes first, so lines replaced read old, then new.
      out.push({ kind: "removed", text: a[i++]! });
    } else {
      out.push({ kind: "added", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++]! });
  while (j < b.length) out.push({ kind: "added", text: b[j++]! });
  return out;
}

/** How each kind of line looks: the color of text the highlighter left plain, its tint, and the tint of changed words. */
const LOOKS = {
  context: { color: PALETTE.haze, background: PALETTE.surface, changed: PALETTE.surface, sign: " " },
  removed: { color: PALETTE.rose, background: TINT.removed, changed: TINT.removedWords, sign: "-" },
  added: { color: PALETTE.teal, background: TINT.added, changed: TINT.addedWords, sign: "+" },
} as const;

/** A character cell of a line, with the syntax style it was given and whether it's in a word that changed. */
type Cell = { text: string; width: number; fg?: string; bold: boolean; italic: boolean; changed: boolean };

/** A line ready to draw: its cells and how it looks. */
type Drawn = { line: DiffLine; cells: Cell[] };

/**
 * A diff on a panel, its first `limit` lines, side by side when `width` allows, in the syntax
 * colors of `path`'s language. `framed={false}` leaves out the panel, for a diff inside one
 * already, such as a permission prompt.
 */
export function Diff({ lines, width, limit, path = "", framed = true }: { lines: DiffLine[]; width: number; limit: number; path?: string; framed?: boolean }) {
  const Frame = framed ? Panel : Bare;
  const shown = lines.slice(0, limit);
  const drawn = draw(shown, path.includes(".") ? (path.split(".").pop() ?? "") : "");
  const more = lines.length > shown.length ? <Text color={PALETTE.haze}>{` ${plural(lines.length - shown.length, "more line")}`}</Text> : null;
  if (width < SPLIT_WIDTH) {
    // A space, the sign and a space before the text.
    const room = Math.max(1, width - 3);
    return (
      <Frame width={width} paddingX={0}>
        {drawn.flatMap(({ line, cells }, i) =>
          wrap(cells, room).map((chunk, row) => (
            <Box key={`${i}.${row}`} backgroundColor={LOOKS[line.kind].background} width={width}>
              <Text>
                <Text color={LOOKS[line.kind].color}>{row === 0 ? ` ${LOOKS[line.kind].sign} ` : "   "}</Text>
                {paint(chunk, line.kind)}
              </Text>
            </Box>
          )),
        )}
        {more}
      </Frame>
    );
  }
  const digits = String(Math.max(0, ...shown.map((line) => Math.max(line.old ?? 0, line.new ?? 0)))).length;
  const numbered = shown.some((line) => line.old !== undefined || line.new !== undefined);
  const gutter = numbered ? digits + 2 : 1;
  // Each side gets half, less the rule between them.
  const left = Math.floor((width - 1) / 2);
  const right = width - left - 1;
  return (
    <Frame width={width} paddingX={0}>
      {pairs(drawn).flatMap(([old, next], i) => {
        const a = old ? wrap(old.cells, Math.max(1, left - gutter - 1)) : [];
        const b = next ? wrap(next.cells, Math.max(1, right - gutter - 1)) : [];
        return Array.from({ length: Math.max(a.length, b.length) }, (_, row) => (
          <Box key={`${i}.${row}`} width={width}>
            <Half drawn={old} chunk={a[row]} number={row === 0 ? old?.line.old : undefined} width={left} gutter={gutter} digits={numbered ? digits : 0} />
            <Text color={PALETTE.dust}>│</Text>
            <Half drawn={next} chunk={b[row]} number={row === 0 ? next?.line.new : undefined} width={right} gutter={gutter} digits={numbered ? digits : 0} />
          </Box>
        ));
      })}
      {more}
    </Frame>
  );
}

function Bare({ children }: { width: number; paddingX: number; children: ReactNode }) {
  return <Box flexDirection="column">{children}</Box>;
}

/**
 * One side of a row: the line number in quiet gray, then a piece of the line. A wrapped line's
 * later rows keep its tint, and a side with no line here is the panel.
 */
function Half({ drawn, chunk, number, width, gutter, digits }: { drawn?: Drawn; chunk?: Cell[]; number?: number; width: number; gutter: number; digits: number }) {
  if (!drawn) return <Box width={width} />;
  return (
    <Box width={width} backgroundColor={LOOKS[drawn.line.kind].background}>
      <Text>
        <Text color={PALETTE.dust}>{` ${digits && number !== undefined ? String(number).padStart(digits) : " ".repeat(digits)}${digits ? " " : ""}`.slice(0, gutter)}</Text>
        {chunk ? paint(chunk, drawn.line.kind) : ""}
      </Text>
    </Box>
  );
}

/**
 * The lines as cells: each side of the diff highlighted as one text, so a string or comment that
 * spans lines keeps its color, and each removed line compared with the added line paired with it.
 */
function draw(lines: DiffLine[], language: string): Drawn[] {
  const clean = (text: string) => printable(text).replace(/\t/g, "  ");
  const oldSide = lines.filter((line) => line.kind !== "added");
  const newSide = lines.filter((line) => line.kind !== "removed");
  const oldCells = sideCells(oldSide.map((line) => clean(line.text)), language);
  const newCells = sideCells(newSide.map((line) => clean(line.text)), language);
  const cellsOf = new Map<DiffLine, Cell[]>();
  oldSide.forEach((line, i) => cellsOf.set(line, oldCells[i] ?? []));
  // A context line is the same on both sides; the new side's colors stand for it.
  newSide.forEach((line, i) => cellsOf.set(line, newCells[i] ?? []));
  const drawn = lines.map((line) => ({ line, cells: cellsOf.get(line) ?? [] }));
  for (const [old, next] of pairs(drawn)) {
    if (old && next && old !== next) markChanges(old.cells, next.cells);
  }
  return drawn;
}

/** Lines of code as cells in the language's syntax colors, a line apart; plain where the language isn't known. */
function sideCells(texts: string[], language: string): Cell[][] {
  const source = texts.join("\n");
  const colored = language ? highlightCode(source, language) : source;
  const lines = cellsOf(colored);
  // A highlighter that changed the line count can't be matched up with the lines; plain text can.
  return lines.length === texts.length ? lines : cellsOf(source);
}

const SGR = /(\x1b\[[0-9;]*m)/;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Colored text as lines of cells, each cell with the foreground, bold and italic in effect where it is. */
function cellsOf(colored: string): Cell[][] {
  const lines: Cell[][] = [[]];
  let fg: string | undefined;
  let bold = false;
  let italic = false;
  for (const part of colored.split(SGR)) {
    const codes = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (codes) {
      const list = (codes[1] || "0").split(";");
      for (let i = 0; i < list.length; i++) {
        const code = Number(list[i]);
        if (code === 0) [fg, bold, italic] = [undefined, false, false];
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if (code === 3) italic = true;
        else if (code === 23) italic = false;
        else if (code === 39) fg = undefined;
        else if (code === 38 || code === 48) {
          const span = list[i + 1] === "5" ? 3 : 5;
          if (code === 38) fg = list.slice(i, i + span).join(";");
          i += span - 1;
        }
      }
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      if (segment === "\n") lines.push([]);
      else lines.at(-1)!.push({ text: segment, width: cellWidth(segment), fg, bold, italic, changed: false });
    }
  }
  return lines;
}

/**
 * Marks the words that differ between a removed line and the added line that replaced it, by the
 * longest run of words they share. Lines that share too little are left unmarked: their tint
 * already says the whole line changed.
 */
function markChanges(old: Cell[], next: Cell[]) {
  const words = (cells: Cell[]) => cells.map((cell) => cell.text).join("").match(/\w+|\s+|[^\w\s]/gu) ?? [];
  const a = words(old);
  const b = words(next);
  if (!a.length || !b.length || a.length > WORD_LIMIT || b.length > WORD_LIMIT) return;
  const longest = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const keptA = new Array<boolean>(a.length).fill(false);
  const keptB = new Array<boolean>(b.length).fill(false);
  let shared = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      keptA[i] = keptB[j] = true;
      shared += a[i]!.length;
      i++;
      j++;
    } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) i++;
    else j++;
  }
  const length = Math.max(a.join("").length, b.join("").length);
  if (shared === length || shared / length < SHARED_ENOUGH) return;
  mark(old, a, keptA);
  mark(next, b, keptB);
}

/** Sets `changed` on the cells of the words not kept, matching cells to words by where their text starts. */
function mark(cells: Cell[], words: string[], kept: boolean[]) {
  const space = (i: number) => /^\s+$/.test(words[i] ?? "");
  // A space between two changed words is part of the change, so a changed phrase is one run of tint.
  // A space matched to one on the other line still counts, since spaces match anywhere.
  const isChanged = (i: number) => (space(i) ? i > 0 && i < words.length - 1 && !kept[i - 1] && !kept[i + 1] : !kept[i]);
  const changed: boolean[] = [];
  words.forEach((word, i) => {
    for (let k = 0; k < word.length; k++) changed.push(isChanged(i));
  });
  let at = 0;
  for (const cell of cells) {
    cell.changed = changed[at] ?? false;
    at += cell.text.length;
  }
}

/**
 * Cells cut into rows of at most `width` cells, after a space where there's one in the row's
 * second half, else wherever the row is full. Later rows start as indented as the line's text,
 * past a comment's leader, up to half the row, so a wrapped line reads as one. An empty line is
 * one empty row.
 */
function wrap(cells: Cell[], width: number): Cell[][] {
  // A comment's leader, such as ` * ` or `// `, counts as indentation, so its text lines up.
  const lead = /^\s*(?:(?:\*|\/\/|#|--|;+)\s+)?/.exec(cells.map((cell) => cell.text).join(""))![0].length;
  const indent = Math.min(lead, Math.floor(width / 2));
  const pad = (): Cell[] => Array.from({ length: indent }, () => ({ text: " ", width: 1, bold: false, italic: false, changed: false }));
  const rows: Cell[][] = [[]];
  let used = 0;
  for (const cell of cells) {
    const row = rows.at(-1)!;
    if (used + cell.width > width && row.length > (rows.length > 1 ? indent : 0)) {
      const space = row.findLastIndex((one) => one.text === " ");
      const carried = space >= row.length / 2 ? row.splice(space + 1) : [];
      // The space a row breaks at isn't part of a change on either row.
      if (carried.length || row.at(-1)?.text === " ") row[row.length - 1] = { ...row.at(-1)!, changed: row.at(-1)!.text === " " ? false : row.at(-1)!.changed };
      rows.push([...pad(), ...carried]);
      used = rows.at(-1)!.reduce((sum, one) => sum + one.width, 0);
    }
    rows.at(-1)!.push(cell);
    used += cell.width;
  }
  return rows;
}

const code = (hex: string, background = false) => `${background ? 48 : 38};2;${rgb(hex).join(";")}`;

/**
 * Cells as text with every cell's whole style spelled out, background included, so nothing in it
 * leans on the row's background: a changed word's tint ends by going back to the line's.
 */
function paint(cells: Cell[], kind: DiffLine["kind"]) {
  const look = LOOKS[kind];
  let out = "";
  let last = "";
  for (const cell of cells) {
    const style = `\x1b[0;${cell.fg ?? code(look.color)}${cell.bold ? ";1" : ""}${cell.italic ? ";3" : ""};${code(cell.changed ? look.changed : look.background, true)}m`;
    if (style !== last) out += style;
    last = style;
    out += cell.text;
  }
  return out ? `${out}\x1b[0;${code(look.color)};${code(look.background, true)}m` : "";
}

/**
 * The diff as rows of two sides. A line both sides share goes on both; a run of removed lines and
 * the added lines after it go side by side, each removed line beside the added line most like it
 * (`align()`), and a line with none beside blank space.
 */
function pairs<T extends { line: DiffLine }>(lines: T[]): [T | undefined, T | undefined][] {
  const rows: [T | undefined, T | undefined][] = [];
  let i = 0;
  while (i < lines.length) {
    const one = lines[i]!;
    if (one.line.kind === "context") {
      rows.push([one, one]);
      i++;
      continue;
    }
    const removed: T[] = [];
    const added: T[] = [];
    while (lines[i]?.line.kind === "removed") removed.push(lines[i++]!);
    while (lines[i]?.line.kind === "added") added.push(lines[i++]!);
    rows.push(...align(removed, added));
  }
  return rows;
}

/** Past this many lines in a run, removed and added lines are paired in order instead, which is quicker. */
const ALIGN_LIMIT = 80;
/** Lines less alike than this aren't paired; each goes beside blank space. */
const ALIKE_ENOUGH = 0.4;

/**
 * Removed lines paired with the added lines that replaced them, in order, so the pairs are as
 * alike as they can be in total. Lines left over go beside blank space where they fall, removed
 * before added.
 */
function align<T extends { line: DiffLine }>(removed: T[], added: T[]): [T | undefined, T | undefined][] {
  if (removed.length > ALIGN_LIMIT || added.length > ALIGN_LIMIT || !removed.length || !added.length) {
    return Array.from({ length: Math.max(removed.length, added.length) }, (_, k) => [removed[k], added[k]]);
  }
  const score = removed.map((a) => added.map((b) => alike(a.line.text, b.line.text)));
  // best[i][j]: the most likeness pairing lines from removed[i] and added[j] on can reach.
  const best = Array.from({ length: removed.length + 1 }, () => new Float64Array(added.length + 1));
  for (let i = removed.length - 1; i >= 0; i--) {
    for (let j = added.length - 1; j >= 0; j--) {
      const pair = score[i]![j]! >= ALIKE_ENOUGH ? score[i]![j]! + best[i + 1]![j + 1]! : -1;
      best[i]![j] = Math.max(pair, best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const rows: [T | undefined, T | undefined][] = [];
  let i = 0;
  let j = 0;
  const waiting: T[] = [];
  const flush = () => rows.push(...waiting.splice(0).map((one): [T | undefined, T | undefined] => (one.line.kind === "removed" ? [one, undefined] : [undefined, one])));
  while (i < removed.length && j < added.length) {
    const here = score[i]![j]!;
    if (here >= ALIKE_ENOUGH && best[i]![j] === here + best[i + 1]![j + 1]!) {
      // Removed lines left over come before added ones, as they would in a unified diff.
      waiting.sort((a, b) => (a.line.kind === b.line.kind ? 0 : a.line.kind === "removed" ? -1 : 1));
      flush();
      rows.push([removed[i++], added[j++]]);
    } else if (best[i]![j] === best[i + 1]![j]) waiting.push(removed[i++]!);
    else waiting.push(added[j++]!);
  }
  waiting.push(...removed.slice(i), ...added.slice(j));
  waiting.sort((a, b) => (a.line.kind === b.line.kind ? 0 : a.line.kind === "removed" ? -1 : 1));
  flush();
  return rows;
}

/** How alike two lines are, from 0 to 1: the share of their pairs of characters they have in common, spaces aside. */
function alike(a: string, b: string) {
  const pairsOf = (text: string) => {
    const squeezed = text.replace(/\s+/g, " ").trim();
    const counts = new Map<string, number>();
    for (let k = 0; k < squeezed.length - 1; k++) counts.set(squeezed.slice(k, k + 2), (counts.get(squeezed.slice(k, k + 2)) ?? 0) + 1);
    return { counts, total: Math.max(0, squeezed.length - 1) };
  };
  const x = pairsOf(a);
  const y = pairsOf(b);
  if (!x.total || !y.total) return a.trim() === b.trim() ? 1 : 0;
  let shared = 0;
  for (const [pair, count] of x.counts) shared += Math.min(count, y.counts.get(pair) ?? 0);
  return (2 * shared) / (x.total + y.total);
}
