// The terminal window astrocode runs in, as seen from outside: whether it has focus, its title,
// the progress its tab shows, and desktop notifications. Each is an escape code a terminal that
// doesn't know it ignores, and none draws anything, so they go to the terminal between Ink's
// frames, as the pointer's shape does.
import { appendFileSync } from "node:fs";
import type { NotifyMode } from "../src/settings";

/**
 * With ASTROCODE_TRACE set to a file, what the window hears and says is written to it, a line
 * each: focus reports and notifications, and the decisions behind them (`attention.ts`).
 */
const TRACE = process.env.ASTROCODE_TRACE;
export function trace(text: string) {
  if (!TRACE) return;
  try {
    appendFileSync(TRACE, `${new Date().toISOString()} ${text}\n`);
  } catch {}
}

/** Focus reports (1004): the terminal sends `ESC [ I` on gaining focus and `ESC [ O` on losing it. */
const FOCUS_ON = "\x1b[?1004h";
const FOCUS_OFF = "\x1b[?1004l";
const FOCUS_REPORT = /\x1b\[([IO])/g;
/** The terminal keeps the title it had, to put back on exit (XTWINOPS 22 and 23). */
const PUSH_TITLE = "\x1b[22;0t";
const POP_TITLE = "\x1b[23;0t";

/** How a desktop notification goes to this terminal, or `bell` where it has none astrocode knows. */
type Channel = "kitty" | "osc777" | "osc9" | "bell";

/** What the tab shows: nothing, work going on, work held up waiting on you, or work that ended in failure. */
export type Progress = "none" | "busy" | "waiting" | "error";

type Stdin = NodeJS.ReadStream;

/**
 * The terminal's own name for itself. Under tmux, TERM and TERM_PROGRAM are tmux's, but variables
 * the outer terminal set, such as KITTY_WINDOW_ID, usually carry through.
 */
function terminalName(env: NodeJS.ProcessEnv) {
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return "kitty";
  if (env.GHOSTTY_RESOURCES_DIR || env.TERM_PROGRAM === "ghostty") return "ghostty";
  if (env.WEZTERM_EXECUTABLE || env.TERM_PROGRAM === "WezTerm") return "wezterm";
  if (env.TERM_PROGRAM === "iTerm.app" || env.LC_TERMINAL === "iTerm2") return "iterm";
  if (env.WT_SESSION) return "windows-terminal";
  if (env.TERM?.startsWith("foot")) return "foot";
  return "other";
}

const CHANNELS: Record<ReturnType<typeof terminalName>, Channel> = {
  kitty: "kitty",
  ghostty: "osc777",
  wezterm: "osc777",
  foot: "osc777",
  iterm: "osc9",
  "windows-terminal": "osc9",
  other: "bell",
};

/**
 * Terminals that draw OSC 9;4 as progress. Others that know OSC 9 as a notification, such as an
 * older iTerm2, would show `4;3` as one, so they get none.
 */
const PROGRESS = new Set(["kitty", "ghostty", "wezterm", "windows-terminal"]);

/** Escape codes and control characters can't go inside another escape code. */
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").trim();

export class TerminalWindow {
  /** True or false once the terminal has reported focus; null in one that doesn't report it. */
  focused: boolean | null = null;
  private running = false;
  private titled = false;
  private title = "";
  private progress: Progress = "none";
  private readonly name: ReturnType<typeof terminalName>;
  private readonly tmux: boolean;
  private watchers = new Set<() => void>();
  /** Notifications sent so far, for each to have an id of its own. */
  private notified = 0;

  constructor(
    stdin: Stdin,
    private readonly stdout: NodeJS.WriteStream,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.name = terminalName(env);
    this.tmux = Boolean(env.TMUX);
    // Focus reports are lifted out of what Ink reads, as the mouse's are. This stays in place for
    // the whole run; the mouse wraps it, and puts it back, in full screen.
    const read = stdin.read;
    stdin.read = ((size?: number) => {
      const chunk: unknown = read.call(stdin, size);
      if (chunk === null || chunk === undefined) return chunk;
      return this.take(typeof chunk === "string" ? chunk : String(chunk));
    }) as Stdin["read"];
  }

  /** Turns focus reports on and keeps the terminal's own title. Again after the terminal was handed over. */
  start() {
    trace(`start running=${this.running} terminal=${this.name} tmux=${this.tmux}`);
    if (this.running) return;
    this.running = true;
    this.write(FOCUS_ON + PUSH_TITLE);
    this.titled = false;
    if (this.title) this.setTitle(this.title);
    if (this.progress !== "none") this.send(progressCode(this.progress));
    process.on("exit", this.stop);
  }

  /** Puts the terminal back as it was: no focus reports, its own title, no progress. Also on exit, crash included. */
  stop = () => {
    trace(`stop running=${this.running}`);
    if (!this.running) return;
    this.running = false;
    process.off("exit", this.stop);
    try {
      this.write(FOCUS_OFF + (this.progress !== "none" && PROGRESS.has(this.name) ? this.wrap(progressCode("none")) : "") + POP_TITLE);
    } catch {}
    // Whoever has the terminal now may never say, so focus is unknown until it reports again.
    this.focused = null;
  };

  /** Calls `update` whenever focus changes. */
  watch(update: () => void) {
    this.watchers.add(update);
    return () => {
      this.watchers.delete(update);
    };
  }

  setTitle(title: string) {
    const next = plain(title);
    if (next === this.title && this.titled) return;
    this.title = next;
    if (!this.running) return;
    this.titled = true;
    // OSC 2 goes to tmux itself, which keeps it as the pane's title.
    this.write(`\x1b]2;${next}\x07`);
  }

  setProgress(progress: Progress) {
    if (progress === this.progress) return;
    this.progress = progress;
    if (this.running && PROGRESS.has(this.name)) this.send(progressCode(progress));
  }

  /**
   * A desktop notification, or the bell where the terminal has none astrocode knows. kitty is
   * also told to show it only while its window is out of focus.
   */
  notify(mode: NotifyMode, title: string, body: string) {
    const channel = mode === "bell" ? "bell" : CHANNELS[this.name];
    trace(`notify ${JSON.stringify(title)} mode=${mode} running=${this.running} channel=${channel} terminal=${this.name}`);
    if (mode === "off" || !this.running) return;
    const [heading, text] = [plain(title), plain(body)];
    switch (channel) {
      case "kitty": {
        const base64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
        // Each notification gets an id of its own. kitty replaces the one before when an id comes
        // again, and KDE puts a replacement into its history without showing it.
        const id = `astrocode-${process.pid}-${++this.notified}`;
        return this.send(`\x1b]99;i=${id}:d=0:e=1:o=unfocused:p=title;${base64(heading)}\x1b\\\x1b]99;i=${id}:d=1:e=1:p=body;${base64(text)}\x1b\\`);
      }
      case "osc777":
        return this.send(`\x1b]777;notify;${heading.replaceAll(";", ",")};${text}\x1b\\`);
      case "osc9":
        return this.send(`\x1b]9;${heading}: ${text}\x1b\\`);
      case "bell":
        // The bell goes through tmux on its own, which passes it on as it's set to.
        return this.write("\x07");
    }
  }

  /** The chunk without its focus reports. */
  private take(chunk: string) {
    if (!chunk.includes("\x1b[")) return chunk;
    let changed = false;
    const rest = chunk.replace(FOCUS_REPORT, (_, which: string) => {
      const focused = which === "I";
      changed ||= focused !== this.focused;
      this.focused = focused;
      trace(`focus ${focused ? "in" : "out"}`);
      return "";
    });
    if (changed) queueMicrotask(() => this.watchers.forEach((update) => update()));
    return rest;
  }

  /** An escape code for the terminal around tmux, passed through it (tmux drops it unless `allow-passthrough` is on). */
  private send(code: string) {
    this.write(this.wrap(code));
  }

  private wrap(code: string) {
    return this.tmux ? `\x1bPtmux;${code.replaceAll("\x1b", "\x1b\x1b")}\x1b\\` : code;
  }

  private write(text: string) {
    this.stdout.write(text);
  }
}

/**
 * Where your messages start in scrollback, for the terminal's jump to the previous or next prompt
 * (kitty's scroll_to_prompt, Ghostty's jump_to_prompt, WezTerm's ScrollToPrompt, tmux's
 * next-prompt). Ink keeps no escape code in its output but OSC 8 links, so a message's dot is a
 * link to this address, and `markPrompts()` turns the link into OSC 133's marks on the way to the
 * terminal: A where the prompt starts, and C right after, so the terminal still takes astrocode for
 * a command that's running. The link's end stays, ending no link.
 */
export const PROMPT_LINK = "astrocode:prompt";
const PROMPT_START = `\x1b]8;;${PROMPT_LINK}\x07`;
const PROMPT_MARKS = "\x1b]133;A\x07\x1b]133;C\x07";

/** Turns the prompt links in what Ink writes into OSC 133 marks. */
export function markPrompts(stdout: NodeJS.WriteStream) {
  const write = stdout.write.bind(stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    write(typeof chunk === "string" && chunk.includes(PROMPT_START) ? chunk.replaceAll(PROMPT_START, PROMPT_MARKS) : chunk, ...rest)) as typeof stdout.write;
}

function progressCode(progress: Progress) {
  // A full bar for the states that have a color of their own: red for failure, yellow for paused.
  return `\x1b]9;4;${{ none: "0", busy: "3", waiting: "4;100", error: "2;100" }[progress]}\x07`;
}
