// Links in what astrocode draws. A link goes to the terminal as an OSC 8 hyperlink, so the
// terminal knows it too (in scrollback, a terminal that has them opens it on a click), and full
// screen's lines keep which cells belong to which address. In full screen the mouse is
// astrocode's, so a click on a link opens it here.
import { spawn } from "node:child_process";

/**
 * An address in running text: up to a space or a quote, ending before a full stop, comma or
 * closing bracket that ends the sentence around it. Brackets that open and close inside it are
 * its own, as in `wiki/Foo_(bar)`.
 */
export const BARE_URL = /(?<![\w/])https?:\/\/(?:\([^\s()<>"'`]*\)|[^\s()<>"'`])*(?:\([^\s()<>"'`]*\)|[^\s()<>"'`.,;:!?*~\]])/g;

/** Only web addresses become links: a click shouldn't run whatever handles some other scheme. */
export const isWebLink = (url: string) => /^https?:\/\/[^\s\x00-\x1f\x7f]+$/i.test(url);

/**
 * `text` as a link to `url`. The ends are BEL, not ESC \: Ink's wrapping carries a link over to
 * the next line only then.
 */
export const hyperlink = (url: string, text: string = url) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;

const SGR = /(\x1b\[[0-9;]*m)/;

/** What a tool or process printed, its web addresses made links. Color codes stay as they are. */
export function linked(text: string) {
  return text
    .split(SGR)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(BARE_URL, (url) => hyperlink(url))))
    .join("");
}

/** Opens a web address with the desktop's own opener. False when there's none to open it with. */
export function openLink(url: string): Promise<boolean> {
  const opener = process.platform === "darwin" ? "open" : process.env.WAYLAND_DISPLAY || process.env.DISPLAY ? "xdg-open" : null;
  if (!opener || !isWebLink(url)) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      // Its own session and no terminal, so a text-mode browser it falls back to can't draw over Ink.
      const child = spawn(opener, [url], { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
