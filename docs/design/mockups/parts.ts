// Drawing pieces the directions share: prose with code spans, and diff rows.
import type { Frame, Style } from "./frame";
import type { DiffRow } from "./scenario";

/** One line of prose whose `code` spans get `code` style; returns the column after it. */
export function prose(f: Frame, x: number, y: number, line: string, style: Style, code: Style) {
  return line.split("`").reduce((at, part, i) => (part ? f.put(at, y, part, i % 2 ? code : style) : at), x);
}

/** Lines of prose from row y; returns the row after the last. */
export function paragraph(f: Frame, x: number, y: number, lines: string[], style: Style, code: Style) {
  lines.forEach((line, i) => prose(f, x, y + i, line, style, code));
  return y + lines.length;
}

export type DiffColors = { page: string; added: string; removed: string; number: string; text: string; sign: { "+": string; "-": string }; gap: string };

/**
 * Diff rows in a box `width` wide from column x: line number, sign, text, each row tinted to the
 * box's edge. Text longer than the box ends in "…". Returns the row after the last.
 */
export function diff(f: Frame, x: number, y: number, width: number, rows: DiffRow[], c: DiffColors) {
  rows.forEach((row, i) => {
    const at = y + i;
    if (row.kind === "…") {
      f.fill(x, at, width, 1, c.page);
      f.put(x + 1, at, `  ⋯ ${row.text}`, { fg: c.gap, bg: c.page });
      return;
    }
    const bg = row.kind === "+" ? c.added : row.kind === "-" ? c.removed : c.page;
    f.fill(x, at, width, 1, bg);
    f.put(x, at, String(row.n ?? "").padStart(3), { fg: c.number, bg });
    if (row.kind !== " ") f.put(x + 4, at, row.kind, { fg: c.sign[row.kind], bg, bold: true });
    const room = width - 7;
    const chars = Array.from(row.text);
    const shown = chars.length > room ? `${chars.slice(0, room - 1).join("")}…` : row.text;
    f.put(x + 6, at, shown, { fg: c.text, bg });
  });
  return y + rows.length;
}

/** Text cut to `width` columns with "…" when it doesn't fit. */
export function fit(text: string, width: number) {
  const chars = Array.from(text);
  return chars.length > width ? `${chars.slice(0, width - 1).join("")}…` : text;
}
