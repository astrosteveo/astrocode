// Your own editor, $VISUAL or $EDITOR, while Ink lends it the terminal: Ctrl+G for the message, and
// /memory for a CLAUDE.md or a saved memory.
import { spawn } from "node:child_process";
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

async function runEditor(file: string) {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const code = await new Promise<number | null>((done, fail) => {
    const child = spawn("/bin/sh", ["-c", `${editor} "$1"`, "sh", file], { stdio: "inherit" });
    child.on("error", fail);
    child.on("close", done);
  });
  return { editor, code };
}
