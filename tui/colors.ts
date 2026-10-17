// The terminal's own background and text colors, asked for once as astrocode starts, before the
// interface loads, so the palette (`theme.ts`) can be made of shades of whatever theme the
// terminal has. Terminals answer OSC 11 and OSC 10 with the colors; the device attributes asked
// for after them (DA1) come back last from every terminal, so a terminal that doesn't know the
// color questions costs no wait.

export type TerminalColors = { background?: string; foreground?: string };

/** What the terminal said, as hex colors. Empty when it didn't answer, or before `askColors()`. */
export const terminalColors: TerminalColors = {};

const QUESTIONS = "\x1b]11;?\x1b\\\x1b]10;?\x1b\\\x1b[c";
/** `ESC ] 11 ; rgb:RRRR/GGGG/BBBB` ended by BEL or ST, with one to four hex digits a channel. */
const COLOR = /\x1b\](1[01]);rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})(?:\/[0-9a-f]{1,4})?(?:\x07|\x1b\\)/gi;
const ATTRIBUTES = /\x1b\[\?[\d;]*c/;
/** How long to wait for a terminal that doesn't answer DA1 either, which few don't. */
const WAIT_MS = 1000;

export async function askColors(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
  if (!stdin.isTTY || !stdout.isTTY) return;
  // Raw, so the answers wait in stdin instead of being echoed onto the screen.
  stdin.setRawMode(true);
  let heard = "";
  await new Promise<void>((resolve) => {
    const take = (chunk: Buffer | string) => {
      heard += chunk.toString();
      if (ATTRIBUTES.test(heard)) done();
    };
    const done = () => {
      clearTimeout(timer);
      stdin.off("data", take);
      stdin.pause();
      resolve();
    };
    const timer = setTimeout(done, WAIT_MS);
    stdin.on("data", take);
    stdout.write(QUESTIONS);
  });
  for (const [, which, ...channels] of heard.matchAll(COLOR)) {
    const hex = `#${channels.map((digits = "0") => Math.round((Number.parseInt(digits, 16) / (16 ** digits.length - 1)) * 255).toString(16).padStart(2, "0")).join("")}`;
    if (which === "11") terminalColors.background = hex;
    else terminalColors.foreground = hex;
  }
  // Whatever was typed meanwhile goes back, for the interface to read.
  const typed = heard.replace(COLOR, "").replace(ATTRIBUTES, "");
  if (typed) stdin.unshift(Buffer.from(typed));
}
