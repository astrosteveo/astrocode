// What a command printed to a terminal, as the lines a terminal would end up showing. Carriage
// returns, erasing and cursor moves rewrite earlier text in place, as progress bars and spinners
// do, and colors stay as color codes. Anything else a terminal would act on, such as a title or a
// mode, is dropped.

/** An escape sequence, or a control character that moves the cursor. */
const SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r\n|[\r\n\b\t]/g;
/** The start of a sequence cut off at the end of a chunk; the rest comes with the next one. */
const PARTIAL = /\x1b(?:\[[0-9;?]*[ -/]*)?$|\x1b\][^\x07\x1b]*\x1b?$/;
/** Rows kept, the newest. A server can print for hours. */
const MAX_ROWS = 5000;

type Cell = { char: string; style: string };

export class TerminalText {
  private rows: Cell[][] = [[]];
  /** Each row drawn as text, until it changes. */
  private drawn: (string | undefined)[] = [];
  private row = 0;
  private col = 0;
  /** The color codes in effect since the last reset. */
  private style = "";
  private carry = "";
  /** Rows dropped from the top to keep within `MAX_ROWS`. */
  dropped = 0;

  /** `height` is the terminal's, which places the rows a program moves the cursor to by number. */
  constructor(private readonly height = 24) {}

  write(chunk: string) {
    let text = this.carry + chunk;
    this.carry = "";
    const partial = PARTIAL.exec(text);
    if (partial) {
      this.carry = partial[0];
      text = text.slice(0, partial.index);
    }
    let from = 0;
    for (const match of text.matchAll(SEQUENCE)) {
      if (match.index > from) this.print(text.slice(from, match.index));
      this.control(match[0]);
      from = match.index + match[0].length;
    }
    if (from < text.length) this.print(text.slice(from));
    if (this.rows.length > MAX_ROWS) {
      const drop = this.rows.length - MAX_ROWS;
      this.rows.splice(0, drop);
      this.drawn.splice(0, drop);
      this.row = Math.max(0, this.row - drop);
      this.dropped += drop;
    }
    return this;
  }

  /** The rows as text with color codes, without the blank rows at the end. */
  text() {
    let end = this.rows.length;
    while (end > 0 && this.rows[end - 1]!.every((cell) => cell.char === " ")) end--;
    const lines: string[] = [];
    for (let i = 0; i < end; i++) {
      this.drawn[i] ??= draw(this.rows[i]!);
      lines.push(this.drawn[i]!);
    }
    return lines.join("\n");
  }

  private print(text: string) {
    const row = this.current();
    for (const char of text) {
      while (row.length < this.col) row.push({ char: " ", style: "" });
      row[this.col] = { char, style: this.style };
      this.col += 1;
    }
  }

  /** The row under the cursor, marked as changed. */
  private current() {
    while (this.rows.length <= this.row) this.rows.push([]);
    this.drawn[this.row] = undefined;
    return this.rows[this.row]!;
  }

  /** Where the screen a program can address starts: the last `height` rows. */
  private get top() {
    return Math.max(0, this.rows.length - this.height);
  }

  private control(sequence: string) {
    switch (sequence) {
      case "\r\n":
      case "\n":
        this.row += 1;
        this.col = 0;
        this.current();
        return;
      case "\r":
        this.col = 0;
        return;
      case "\b":
        this.col = Math.max(0, this.col - 1);
        return;
      case "\t":
        this.col = (Math.floor(this.col / 8) + 1) * 8;
        return;
    }
    if (!sequence.startsWith("\x1b[")) return;
    const final = sequence.at(-1);
    const params = sequence.slice(2, -1);
    const n = Math.max(1, Number.parseInt(params, 10) || 1);
    switch (final) {
      case "m":
        this.style = params === "" || params === "0" ? "" : `${this.style}${sequence}`;
        return;
      case "K": {
        const row = this.current();
        if (params === "" || params === "0") row.length = Math.min(row.length, this.col);
        else if (params === "1") for (let i = 0; i <= this.col && i < row.length; i++) row[i] = { char: " ", style: "" };
        else if (params === "2") row.length = 0;
        return;
      }
      case "J":
        if (params === "2" || params === "3") {
          this.rows = [[]];
          this.drawn = [];
          this.row = 0;
          this.col = 0;
        } else if (params === "" || params === "0") {
          this.current().length = this.col;
          this.rows.length = this.row + 1;
          this.drawn.length = Math.min(this.drawn.length, this.row + 1);
        }
        return;
      case "A":
        this.row = Math.max(this.top, this.row - n);
        return;
      case "B":
        this.row += n;
        return;
      case "C":
        this.col += n;
        return;
      case "D":
        this.col = Math.max(0, this.col - n);
        return;
      case "E":
        this.row += n;
        this.col = 0;
        return;
      case "F":
        this.row = Math.max(this.top, this.row - n);
        this.col = 0;
        return;
      case "G":
        this.col = n - 1;
        return;
      case "d":
        this.row = this.top + n - 1;
        return;
      case "H":
      case "f": {
        const [row = "1", col = "1"] = params.split(";");
        this.row = this.top + Math.max(1, Number(row) || 1) - 1;
        this.col = Math.max(1, Number(col) || 1) - 1;
        return;
      }
    }
  }
}

/** A row as text with color codes, without the blank cells at its end. */
function draw(row: Cell[]) {
  let end = row.length;
  while (end > 0 && row[end - 1]!.char === " " && !row[end - 1]!.style) end--;
  let out = "";
  let style = "";
  for (const cell of row.slice(0, end)) {
    if (cell.style !== style) {
      out += `\x1b[0m${cell.style}`;
      style = cell.style;
    }
    out += cell.char;
  }
  return style ? `${out}\x1b[0m` : out;
}

/** Text a terminal program printed, as its terminal would show it. */
export function settle(text: string) {
  return new TerminalText().write(text).text();
}
