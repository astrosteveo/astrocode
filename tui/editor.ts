// Your own editor, $VISUAL or $EDITOR, while Ink lends it the terminal: Ctrl+G for the message, and
// /memory for a CLAUDE.md or a saved memory.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The text after you save and quit the editor. The editor's command may carry its own options, such as `code --wait`. */
export async function editText(text: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "astrocode-"));
  const file = join(folder, "message.md");
  try {
    await writeFile(file, text);
    const { editor, code } = await runEditor(file);
    if (code !== 0) throw new Error(`${editor} exited with ${code ?? "a signal"}, so the message is as it was.`);
    // Editors end the file with a newline the message doesn't need.
    return (await readFile(file, "utf8")).replace(/\n+$/, "");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Opens a file in the editor, making its folder first if there isn't one. The editor makes the file when you save. */
export async function editFile(path: string) {
  await mkdir(dirname(path), { recursive: true });
  const { editor, code } = await runEditor(path);
  if (code !== 0) throw new Error(`${editor} exited with ${code ?? "a signal"}.`);
}

/**
 * Runs the editor in a terminal of its own (a pty), with your keys passed into it and what it
 * draws copied onto the screen as it is. It can't simply be handed this terminal: Bun goes on
 * reading stdin after Ink lets go of it, paused or not, so an editor waiting on the same terminal
 * gets about one key in ten. Only destroying the stream stops Bun, and Ink can't go on after that.
 */
async function runEditor(file: string) {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const { stdin, stdout } = process;
  const size = (): [number, number] => [stdout.columns || 80, stdout.rows || 24];
  let drained!: () => void;
  const closed = new Promise<void>((resolve) => (drained = resolve));
  // exec, so the editor is the process its terminal starts, and its state can be read by its pid.
  const proc = Bun.spawn(["/bin/sh", "-c", `exec ${editor} "$1"`, "sh", file], {
    terminal: { cols: size()[0], rows: size()[1], data: (_, data) => void stdout.write(data), exit: () => drained() },
  });
  const terminal = proc.terminal;
  const pass = () => {
    let chunk: unknown;
    while ((chunk = stdin.read()) !== null) terminal?.write(typeof chunk === "string" ? chunk : String(chunk));
  };
  const resize = () => terminal?.resize(...size());
  // Raw, so each key goes to the editor as it's pressed, and this terminal doesn't echo it.
  stdin.setRawMode(true);
  stdin.on("readable", pass);
  stdout.on("resize", resize);
  // An editor can stop itself, as Vim does on Ctrl+Z, and there's no shell in its terminal to bring
  // it back, so it's brought back at once.
  const watch = process.platform === "linux" ? setInterval(() => void wake(proc.pid), 300) : undefined;
  try {
    const code = await proc.exited;
    // What the editor drew last can still be on its way; it mustn't land after Ink draws again.
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 200))]);
    return { editor, code };
  } finally {
    clearInterval(watch);
    stdin.off("readable", pass);
    stdout.off("resize", resize);
    terminal?.close();
    stdin.setRawMode(false);
  }
}

/** Continues the editor if it has stopped itself. Linux says so in /proc. */
async function wake(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // The state comes after the command's name, which is in parentheses and may hold anything.
    if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("T")) process.kill(-pid, "SIGCONT");
  } catch {
    // It has ended.
  }
}
