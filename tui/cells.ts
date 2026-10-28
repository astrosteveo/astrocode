// The size of the terminal's character cells in pixels, which sets how large a picture is drawn.
import { dlopen, FFIType } from "bun:ffi";

/** A cell's size in pixels when the terminal doesn't say: about twice as tall as wide. */
const GUESS = { width: 10, height: 20 };

/**
 * A cell's size in pixels. It sets a picture's shape, and keeps a small image from being blown up.
 * kitty gives it in the window size the terminal reports (TIOCGWINSZ), pixels as well as rows and
 * columns, which a new font size changes along with the window. Asking with an escape sequence
 * instead would put the answer in stdin, which is Ink's. kitty fits an image into its cells without
 * stretching it, so a wrong size only leaves a margin.
 */
let cell: { width: number; height: number } | null = null;
process.stdout.on("resize", () => {
  cell = null;
});

export function cellSize() {
  cell ??= windowCell() ?? GUESS;
  return cell;
}

let ioctl: ((fd: number, request: number, size: Uint16Array) => number) | null = null;

function windowCell() {
  if (process.platform !== "linux") return null;
  try {
    ioctl ??= dlopen("libc.so.6", { ioctl: { args: [FFIType.i32, FFIType.u64, FFIType.ptr], returns: FFIType.i32 } }).symbols.ioctl;
    // TIOCGWINSZ fills rows, columns, then width and height in pixels.
    const size = new Uint16Array(4);
    const [rows = 0, cols = 0, width = 0, height = 0] = ioctl(1, 0x5413, size) === 0 ? size : [];
    return rows && cols && width && height ? { width: width / cols, height: height / rows } : null;
  } catch {
    return null;
  }
}

/**
 * The terminal's text size in CSS pixels, for words in a picture to match the words around it.
 * A monospace character is about 0.6 of the font size wide.
 */
export const fontPixels = () => Math.max(10, Math.min(40, Math.round(cellSize().width / 0.6)));
