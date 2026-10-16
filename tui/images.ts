// Images for a message: from the clipboard with Ctrl+V, or from a file whose path is pasted or
// dropped on the terminal. Claude takes PNG, JPEG, GIF and WebP.
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ImageAttachment } from "../src/events";

/** The API's limit is 5 MB of base64, which is this much of the image itself. */
const MAX_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);

const EXTENSION = /\.(png|jpe?g|gif|webp)$/i;

/** An image's type from its first bytes, which a file's name or the clipboard's label can get wrong. */
function sniff(bytes: Buffer): ImageAttachment["mediaType"] | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** The image in `bytes`, or why it can't go with a message. */
export function toAttachment(bytes: Buffer): ImageAttachment | string {
  const mediaType = sniff(bytes);
  if (!mediaType) return "That isn't a PNG, JPEG, GIF or WebP image.";
  if (bytes.length > MAX_BYTES) return `That image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; Claude takes up to ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB.`;
  return { mediaType, data: bytes.toString("base64") };
}

/** The clipboard's image, null when it holds none, or why it couldn't be read. */
export async function clipboardImage(): Promise<ImageAttachment | string | null> {
  const reader = clipboardReader();
  if (!reader) return "astrocode can read images from the clipboard with wl-paste or xclip, on Linux.";
  const types = await output(reader.types).catch(() => null);
  if (types === null) return `Couldn't read the clipboard with ${reader.types[0]}. Is it installed?`;
  const type = types.toString("utf8").split("\n").map((line) => line.trim()).find((line) => /^image\/(png|jpeg|gif|webp)$/.test(line));
  if (!type) return null;
  const bytes = await output(reader.read(type)).catch(() => null);
  return bytes?.length ? toAttachment(bytes) : null;
}

function clipboardReader() {
  if (process.env.WAYLAND_DISPLAY) return { types: ["wl-paste", "--list-types"], read: (type: string) => ["wl-paste", "--type", type] };
  if (process.env.DISPLAY) {
    return {
      types: ["xclip", "-selection", "clipboard", "-t", "TARGETS", "-o"],
      read: (type: string) => ["xclip", "-selection", "clipboard", "-t", type, "-o"],
    };
  }
  return null;
}

function output([name = "", ...args]: string[]) {
  return new Promise<Buffer>((done, fail) => {
    const child = spawn(name, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(Buffer.concat(chunks)) : fail(new Error(`${name} exited with ${code}`))));
  });
}

/**
 * The image file a paste names, when the paste is nothing but its path, as when a file is dropped
 * on the terminal. Terminals quote such a path, escape its spaces, or send it as a file:// URL.
 */
export async function pastedImageFile(pasted: string, cwd: string): Promise<{ path: string; image: ImageAttachment | string } | null> {
  let path = pasted.trim();
  if (!path || path.includes("\n")) return null;
  if (/^(['"]).*\1$/.test(path)) path = path.slice(1, -1);
  else path = path.replace(/\\(.)/g, "$1");
  if (path.startsWith("file://")) {
    try {
      path = decodeURIComponent(new URL(path).pathname);
    } catch {
      return null;
    }
  }
  if (path.startsWith("~/")) path = homedir() + path.slice(1);
  if (!EXTENSION.test(path)) return null;
  const full = resolve(cwd, path);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) return null;
  if (info.size > MAX_BYTES) return { path: full, image: `That image is ${(info.size / 1024 / 1024).toFixed(1)} MB; Claude takes up to ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB.` };
  return { path: full, image: toAttachment(await readFile(full)) };
}

/** `[Image #2]`, as the message box shows an attached image. */
export const imageLabel = (n: number) => `[Image #${n}]`;

/** The numbers of the images a message still mentions. */
export function mentionedImages(text: string) {
  return [...text.matchAll(/\[Image #(\d+)\]/g)].map((match) => Number(match[1]));
}
