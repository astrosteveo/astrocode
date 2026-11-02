// A mockup is a grid of terminal cells, each one character with a foreground, a background and
// the attributes Ink can set (bold, italic, dim, underline). Mockups are built on the grid and
// printed as true-color ANSI, so what the screenshot shows is cells Ink can draw.

export type Style = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  dim?: boolean;
  underline?: boolean;
};

type Cell = { ch: string } & Style;

/** A run of text and its style, for writing several styles on one line. */
export type Span = [text: string, style?: Style];

export class Frame {
  readonly cells: Cell[][];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly page: string,
    readonly ink: string,
  ) {
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: " ", fg: ink, bg: page })));
  }

  /** Writes text from column x on row y. Text that would run past the edge is a mistake in the mockup, so it throws. */
  put(x: number, y: number, text: string, style: Style = {}) {
    const chars = Array.from(text);
    if (y < 0 || y >= this.height) throw new Error(`row ${y} is off the ${this.height}-row frame: ${text}`);
    if (x < 0 || x + chars.length > this.width) throw new Error(`"${text}" at column ${x} runs past ${this.width} columns`);
    chars.forEach((ch, i) => {
      const cell = this.cells[y]![x + i]!;
      this.cells[y]![x + i] = { ...cell, ...style, ch, bg: style.bg ?? cell.bg, fg: style.fg ?? this.ink };
    });
    return x + chars.length;
  }

  /** Writes spans one after another from column x; returns the column after the last. */
  spans(x: number, y: number, spans: Span[]) {
    return spans.reduce((at, [text, style]) => this.put(at, y, text, style), x);
  }

  /** Writes text so that its last character sits in column `end - 1`. */
  right(end: number, y: number, text: string, style: Style = {}) {
    return this.put(end - Array.from(text).length, y, text, style);
  }

  /** Writes spans so that the last one ends at column `end - 1`. */
  rightSpans(end: number, y: number, spans: Span[]) {
    const length = spans.reduce((n, [text]) => n + Array.from(text).length, 0);
    return this.spans(end - length, y, spans);
  }

  /** Paints a rectangle's background, keeping what's written there. */
  fill(x: number, y: number, w: number, h: number, bg: string) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        const cell = this.cells[row]?.[col];
        if (!cell) throw new Error(`fill ${x},${y} ${w}x${h} runs off the frame`);
        cell.bg = bg;
      }
    }
  }

  /** A row of one character. */
  line(x: number, y: number, w: number, ch: string, style: Style = {}) {
    this.put(x, y, ch.repeat(w), style);
  }

  /** The frame as true-color ANSI, one string per row, with no trailing newline on the last. */
  ansi() {
    const sgr = (hex: string, layer: 38 | 48) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return `\x1b[${layer};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
    };
    return this.cells
      .map((row) =>
        row
          .map((cell) => {
            const attrs = [cell.bold && "1", cell.dim && "2", cell.italic && "3", cell.underline && "4"].filter(Boolean).join(";");
            return `\x1b[0m${attrs ? `\x1b[${attrs}m` : ""}${sgr(cell.fg ?? this.ink, 38)}${sgr(cell.bg ?? this.page, 48)}${cell.ch}`;
          })
          .join("") + "\x1b[0m",
      )
      .join("\n");
  }

  /** The frame's characters only, for checking a mockup's text. */
  text() {
    return this.cells.map((row) => row.map((cell) => cell.ch).join(""));
  }
}
