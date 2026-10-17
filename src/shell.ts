// Commands you run with `!`: run here, in the project, in a terminal of their own (a pty), so they
// color their output and draw progress bars as they would in your shell. What they print streams
// into the transcript while they run. They get no input: what reads from the terminal reads its
// end at once, so a prompt fails rather than waiting forever.
import { topLevelEnv } from "./session";
import { TerminalText } from "./view/terminal";

/** How often what's printed is passed on while it streams. Each pass redraws the command's card. */
const STREAM_MS = 100;
/** How often a command that prints nothing reports anyway, so its card's clock moves. */
const HEARTBEAT_MS = 1000;
/** The terminal's height, for programs that ask how much room they have. */
const ROWS = 24;
/** How long a command gets to stop after each signal, before the next, harder one. */
const STOP_STEP_MS = 1500;

/** `output` is what the terminal shows, with color codes. */
export type ShellResult = { output: string; code: number | null; stopped: boolean };

type Options = {
  cwd: string;
  /** The terminal's width, which programs lay their output out to. */
  cols: number;
  /** Stops the command and everything it started. */
  signal: AbortSignal;
  /** What the terminal shows so far, while it runs. */
  onOutput: (output: string) => void;
};

/** Process groups still running, stopped as astrocode exits so none outlives it. */
const groups = new Set<number>();
process.on("exit", () => {
  for (const pid of groups) signalGroup(pid, "SIGTERM");
});

export function runShell(command: string, { cwd, cols, signal, onOutput }: Options): Promise<ShellResult> {
  const screen = new TerminalText(ROWS);
  const decoder = new TextDecoder();
  const shown = () => (screen.dropped ? `(${screen.dropped} earlier lines not kept)\n${screen.text()}` : screen.text());
  let pending: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    pending = null;
    onOutput(shown());
  };

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([process.env.SHELL || "/bin/sh", "-c", command], {
      cwd,
      env: { ...topLevelEnv(), TERM: "xterm-256color" },
      terminal: {
        cols: Math.max(20, cols),
        rows: ROWS,
        data: (_, data) => {
          screen.write(decoder.decode(data, { stream: true }));
          pending ??= setTimeout(flush, STREAM_MS);
        },
      },
    });
  } catch (error) {
    return Promise.resolve({ output: error instanceof Error ? error.message : String(error), code: null, stopped: false });
  }
  const terminal = proc.terminal;
  terminal?.write("\x04");
  groups.add(proc.pid);
  const heartbeat = setInterval(() => (pending ? undefined : flush()), HEARTBEAT_MS);

  // Ctrl+C's signal first, as a terminal sends it, so a server can shut down cleanly; then harder.
  let stopping: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    const steps = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
    const next = (step: number) => {
      const name = steps[step];
      if (!name || !groups.has(proc.pid)) return;
      signalGroup(proc.pid, name);
      stopping = setTimeout(() => next(step + 1), STOP_STEP_MS);
    };
    next(0);
  };
  signal.addEventListener("abort", stop, { once: true });

  return proc.exited.then(async (code) => {
    groups.delete(proc.pid);
    signal.removeEventListener("abort", stop);
    clearInterval(heartbeat);
    if (stopping) clearTimeout(stopping);
    // What the command printed just before it ended can still be on its way.
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (pending) clearTimeout(pending);
    terminal?.close();
    screen.write(decoder.decode());
    return { output: shown(), code: signal.aborted ? null : code, stopped: signal.aborted };
  });
}

/** The command's whole process group, so what it started stops too. */
function signalGroup(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(-pid, name);
  } catch {}
}
