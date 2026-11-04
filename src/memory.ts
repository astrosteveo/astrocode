// Notes you add with `#`: a line in one of the CLAUDE.md files Claude Code reads at the start of
// every session, in this project or for all of yours.
import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configDir } from "./claude-dir";

export type MemoryFile = { label: string; note: string; path: string };

/** Where a note can go: the project's CLAUDE.md, where it already keeps one, and yours. */
export async function memoryFiles(cwd: string): Promise<MemoryFile[]> {
  const nested = join(cwd, ".claude", "CLAUDE.md");
  const project = (await exists(join(cwd, "CLAUDE.md"))) || !(await exists(nested)) ? join(cwd, "CLAUDE.md") : nested;
  return [
    { label: "Project memory", note: "Shared with everyone working in this project", path: project },
    { label: "User memory", note: "For you, in every project", path: join(configDir(), "CLAUDE.md") },
  ];
}

/** Adds the note to the end of the file as a list item, making the file if there isn't one. */
export async function addMemory(path: string, note: string) {
  const before = await readFile(path, "utf8").catch(() => "");
  const gap = before === "" || before.endsWith("\n") ? "" : "\n";
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${gap}- ${note.replace(/\s*\n\s*/g, " ")}\n`);
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}
