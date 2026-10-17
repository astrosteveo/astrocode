// Images drawn in the transcript, in kitty. An image is sent to the terminal once, as a virtual
// placement, which draws nothing by itself. It's drawn wherever its placeholder cells are printed:
// U+10EEEE with the image's id as the foreground color, the first cell of each row marked with its
// row and column as diacritics. Ink lays those out as ordinary text, so a picture scrolls with the
// transcript and sits in <Static> and in full screen's lines alike.
import { dlopen, FFIType } from "bun:ffi";
import { Box, Text } from "ink";
import { useRef } from "react";
import type { ImageAttachment, SessionEvent } from "../src/events";
import type { Item } from "../src/view/state";

/** kitty draws images. Under tmux or screen each image would have to be wrapped to pass through, so not there. */
export const drawsImages = process.env.TERM === "xterm-kitty" && !process.env.TMUX && !process.env.STY;

/** A cell's size in pixels when the terminal doesn't say: about twice as tall as wide. */
const GUESS = { width: 10, height: 20 };
/** Images go to the terminal at most this many pixels on a side, since kitty keeps each one decoded. */
const MAX_PIXELS = 2048;
/** How long after a frame `afterFrame()` waits to have kitty look again, so it has drawn the frame first. */
const LOOK_AGAIN_MS = 100;

const PLACEHOLDER = "\u{10EEEE}";
/**
 * The diacritics that number a placeholder's row and column from 0, from kitty's
 * rowcolumn-diacritics.txt. Only a row's first cell needs them: kitty counts on from there.
 */
const DIACRITICS = [
  ..."\u0305\u030d\u030e\u0310\u0312\u033d\u033e\u033f\u0346\u034a\u034b\u034c\u0350\u0351\u0352\u0357\u035b\u0363\u0364\u0365\u0366\u0367\u0368\u0369\u036a\u036b\u036c\u036d\u036e\u036f\u0483\u0484\u0485\u0486\u0487\u0592\u0593\u0594\u0595\u0597\u0598\u0599\u059c\u059d\u059e\u059f\u05a0\u05a1\u05a8\u05a9\u05ab\u05ac\u05af\u05c4\u0610\u0611\u0612\u0613\u0614\u0615\u0616\u0617\u0657\u0658\u0659\u065a\u065b\u065d\u065e\u06d6\u06d7\u06d8\u06d9\u06da\u06db\u06dc\u06df\u06e0\u06e1\u06e2\u06e4\u06e7\u06e8\u06eb\u06ec\u0730\u0732\u0733\u0735\u0736\u073a\u073d\u073f\u0740\u0741\u0743\u0745\u0747\u0749\u074a\u07eb\u07ec\u07ed\u07ee\u07ef\u07f0\u07f1\u07f3\u0816\u0817\u0818\u0819\u081b\u081c\u081d\u081e\u081f\u0820\u0821\u0822\u0823\u0825\u0826\u0827\u0829\u082a\u082b\u082c\u082d\u0951\u0953\u0954\u0f82\u0f83\u0f86\u0f87\u135d\u135e\u135f\u17dd\u193a\u1a17\u1a75\u1a76\u1a77\u1a78\u1a79\u1a7a\u1a7b\u1a7c\u1b6b\u1b6d\u1b6e\u1b6f\u1b70\u1b71\u1b72\u1b73\u1cd0\u1cd1\u1cd2\u1cda\u1cdb\u1ce0\u1dc0\u1dc1\u1dc3\u1dc4\u1dc5\u1dc6\u1dc7\u1dc8\u1dc9\u1dcb\u1dcc\u1dd1\u1dd2\u1dd3\u1dd4\u1dd5\u1dd6\u1dd7\u1dd8\u1dd9\u1dda\u1ddb\u1ddc\u1ddd\u1dde\u1ddf\u1de0\u1de1\u1de2\u1de3\u1de4\u1de5\u1de6\u1dfe\u20d0\u20d1\u20d4\u20d5\u20d6\u20d7\u20db\u20dc\u20e1\u20e7\u20e9\u20f0\u2cef\u2cf0\u2cf1\u2de0\u2de1\u2de2\u2de3\u2de4\u2de5\u2de6\u2de7\u2de8\u2de9\u2dea\u2deb\u2dec\u2ded\u2dee\u2def\u2df0\u2df1\u2df2\u2df3\u2df4\u2df5\u2df6\u2df7\u2df8\u2df9\u2dfa\u2dfb\u2dfc\u2dfd\u2dfe\u2dff\ua66f\ua67c\ua67d\ua6f0\ua6f1\ua8e0\ua8e1\ua8e2\ua8e3\ua8e4\ua8e5\ua8e6\ua8e7\ua8e8\ua8e9\ua8ea\ua8eb\ua8ec\ua8ed\ua8ee\ua8ef\ua8f0\ua8f1\uaab0\uaab2\uaab3\uaab7\uaab8\uaabe\uaabf\uaac1\ufe20\ufe21\ufe22\ufe23\ufe24\ufe25\ufe26\u{10a0f}\u{10a38}\u{1d185}\u{1d186}\u{1d187}\u{1d188}\u{1d189}\u{1d1aa}\u{1d1ab}\u{1d1ac}\u{1d1ad}\u{1d242}\u{1d243}",
];

/** An image as kitty takes it, PNG, with the id its placeholders carry and its size in pixels. */
type Picture = { id: number; png: string; width: number; height: number };
/** A picture's size in cells. */
export type Size = { cols: number; rows: number };

const pictures = new WeakMap<ImageAttachment, Picture>();
const preparing = new WeakMap<ImageAttachment, Promise<void>>();

/**
 * Gets an image ready to draw. Scrollback draws a message once, so its images must be ready before
 * it's sent or replayed. An image that can't be read stays an `[Image #n]`.
 */
export function prepare(image: ImageAttachment): Promise<void> {
  if (!drawsImages) return Promise.resolve();
  let pending = preparing.get(image);
  if (!pending) {
    pending = toPicture(image).then(
      (picture) => void pictures.set(image, picture),
      () => {},
    );
    preparing.set(image, pending);
  }
  return pending;
}

/** A replay's events, once the images of its messages are ready to draw. */
export async function withPictures(events: SessionEvent[]) {
  await Promise.all(events.flatMap((event) => (event.kind === "prompt" ? Object.values(event.images ?? {}).map(prepare) : [])));
  return events;
}

async function toPicture(image: ImageAttachment): Promise<Picture> {
  // kitty reads only PNG; Bun.Image reads JPEG, GIF and WebP too.
  const png = new Bun.Image(Buffer.from(image.data, "base64")).resize(MAX_PIXELS, MAX_PIXELS, { fit: "inside", withoutEnlargement: true }).png();
  const data = await png.toBase64();
  return { id: 1 + Math.floor(Math.random() * 0xfffffe), png: data, width: png.width, height: png.height };
}

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

function cellSize() {
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

/** Whether `image` is ready to draw. */
export const isReady = (image: ImageAttachment) => pictures.has(image);

/** How tall a picture may be with `visible` rows of transcript on screen: half, so the other half still shows the conversation. */
export const pictureRows = (visible: number) => Math.max(2, Math.floor(visible / 2));

/**
 * The size `picture` is drawn at in a box `width` columns wide and `rows` rows tall: as large as
 * fits, keeping its shape, but no larger than the image itself.
 */
function sizeOf(picture: Picture, width: number, rows: number): Size {
  const most = { cols: Math.min(width, DIACRITICS.length), rows: Math.min(rows, DIACRITICS.length) };
  const cell = cellSize();
  const shape = (picture.width * cell.height) / (picture.height * cell.width);
  let height = Math.max(1, Math.min(most.rows, Math.ceil(picture.height / cell.height)));
  let cols = Math.round(height * shape);
  if (cols > most.cols) {
    cols = most.cols;
    height = Math.max(1, Math.round(cols / shape));
  }
  return { cols: Math.max(1, cols), rows: height };
}

/**
 * The pictures the terminal has for the screen in use, and the size each is placed at. kitty keeps
 * the alternate screen's images apart and drops them when it's entered, so each layout starts over
 * (`forgetSent()`), and full screen sends them again after an editor or a suspend.
 */
let placed = new Map<Picture, Size>();
/** Pictures drawn in this frame that the terminal doesn't have at that size yet. */
const wanted = new Map<Picture, Size>();
/** Pictures were drawn in new places, and kitty should look for them again after the frame. */
let rescan = false;
let looking: ReturnType<typeof setTimeout> | null = null;

export function forgetSent() {
  placed = new Map();
}

/** Notes that `picture` is drawn at `size` in this frame, for `afterFrame()` to send. */
function want(picture: Picture, size: Size) {
  const now = placed.get(picture);
  if (now?.cols === size.cols && now.rows === size.rows) return;
  wanted.set(picture, size);
  rescan = true;
}

/**
 * Full screen's pictures, at the size its transcript draws them, since a line drawn earlier is
 * reused without drawing its pictures again. Scrollback never redraws a message, so only drawing
 * one wants its pictures there.
 */
export function wantPictures(items: readonly Item[], width: number, rows: number) {
  for (const item of items) {
    if (item.kind !== "prompt" || !item.images) continue;
    for (const image of Object.values(item.images)) {
      const picture = pictures.get(image);
      if (picture) want(picture, sizeOf(picture, width, rows));
    }
  }
}

/** Sends every picture placed on this screen again, for a screen that has lost them. */
export function resendPictures() {
  for (const [picture, size] of placed) process.stdout.write(transmission(picture, size));
  rescan = true;
  lookAgain();
}

/**
 * kitty's command to keep `picture` as a virtual placement at `size`, its base64 in chunks of 4096.
 * The placement has an id of its own, so placing it again at another size replaces it.
 */
function transmission({ id, png }: Picture, { cols, rows }: Size) {
  let out = "";
  for (let at = 0; at < png.length; at += 4096) {
    const more = at + 4096 < png.length ? 1 : 0;
    const keys = at === 0 ? `a=T,f=100,U=1,C=1,q=2,i=${id},p=1,c=${cols},r=${rows},m=${more}` : `q=2,m=${more}`;
    out += `\x1b_G${keys};${png.slice(at, at + 4096)}\x1b\\`;
  }
  return out;
}

const placement = ({ id }: Picture, { cols, rows }: Size) => `\x1b_Ga=p,U=1,C=1,q=2,i=${id},p=1,c=${cols},r=${rows}\x1b\\`;

/**
 * Runs after each of Ink's frames, Ink's `onRender`. It sends the pictures the frame drew that the
 * terminal doesn't have at that size; none of it draws anything or, with `q=2`, gets an answer that
 * would land in Ink's input. A picture printed before its image arrives shows up when it does.
 */
export function afterFrame() {
  for (const [picture, size] of wanted) {
    process.stdout.write(placed.has(picture) ? placement(picture, size) : transmission(picture, size));
    placed.set(picture, size);
  }
  wanted.clear();
  if (rescan) lookAgain();
}

/**
 * kitty can leave pictures blank when it draws placeholders for images it already has, as on
 * switching to full screen, until its next redraw. With the cursor hidden, as Ink keeps it, nothing
 * may redraw for a long while. Placing an image again makes kitty look at every placeholder on
 * screen and redraw, so that's done a moment after a frame that drew pictures in new places; sent
 * along with the frame, it doesn't help.
 */
function lookAgain() {
  if (looking) return;
  rescan = false;
  looking = setTimeout(() => {
    looking = null;
    const last = [...placed].at(-1);
    if (last) process.stdout.write(placement(...last));
  }, LOOK_AGAIN_MS);
  looking.unref();
}

/** Full screen's rows on screen: a picture among them in a new place asks for `afterFrame()`'s look. */
export function usePictureRows(rows: readonly string[]) {
  const shown = useRef("");
  const now = rows.map((text, i) => (text.includes(PLACEHOLDER) ? `${i}\u0000${text}` : "")).join("\u0001");
  if (now !== shown.current) {
    shown.current = now;
    if (now.includes(PLACEHOLDER)) rescan = true;
  }
}

/** An image as its placeholder cells, as large as fits in `width` columns and `rows` rows, once it's ready. */
export function ImageView({ image, width, rows }: { image: ImageAttachment; width: number; rows: number }) {
  const picture = pictures.get(image);
  if (!picture) return null;
  const size = sizeOf(picture, width, rows);
  want(picture, size);
  rescan = true;
  const { id } = picture;
  const color = `\x1b[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;
  const rest = PLACEHOLDER.repeat(size.cols - 1);
  return (
    <Box flexDirection="column">
      {DIACRITICS.slice(0, size.rows).map((row, i) => (
        <Text key={i}>{color + PLACEHOLDER + row + DIACRITICS[0] + rest + "\x1b[39m"}</Text>
      ))}
    </Box>
  );
}
