// The project's files and folders, for `@` mentions in the message box. Claude Code attaches
// whatever `@path` names when the message arrives; this only helps write the path.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Folders a walk outside git skips: they're big, and rarely what's meant. */
const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target", ".next", ".cache"]);

/** Where a walk stops, so a mention typed in a huge folder such as ~ still answers quickly. */
const MOST = 20_000;

/**
 * Paths relative to `cwd`, folders ending in `/`. In a git repository, the files git knows about,
 * tracked or not, leaving out what it ignores. Elsewhere, a walk that skips `SKIP` and hidden folders.
 */
export async function projectFiles(cwd: string): Promise<string[]> {
  const files = (await gitFiles(cwd)) ?? (await walk(cwd));
  const folders = new Set<string>();
  for (const file of files) {
    for (let at = file.indexOf("/"); at !== -1; at = file.indexOf("/", at + 1)) folders.add(file.slice(0, at + 1));
  }
  return [...folders, ...files];
}

/**
 * What a partial path could mean, best first. Nothing typed, or a folder typed through its `/`,
 * lists that folder. Otherwise names that start with it come first, then paths that do, then
 * names and paths that contain it, then paths that have its letters in order.
 */
export function fileMatches(paths: string[], typed: string, limit = 50): string[] {
  const query = typed.toLowerCase();
  if (query === "" || query.endsWith("/")) {
    return paths
      .filter((path) => path.toLowerCase().startsWith(query) && path.length > query.length && !path.slice(query.length, -1).includes("/"))
      .sort((a, b) => Number(!a.endsWith("/")) - Number(!b.endsWith("/")) || a.localeCompare(b))
      .slice(0, limit);
  }
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const name = baseName(lower);
    const score = name.startsWith(query)
      ? 0
      : lower.startsWith(query)
        ? 1
        : name.includes(query)
          ? 2
          : lower.includes(query)
            ? 3
            : inOrder(lower, query)
              ? 4
              : -1;
    if (score >= 0) scored.push({ path, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || depth(a.path) - depth(b.path) || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => entry.path);
}

/** The last part of a path, a folder's without its `/`. */
export function baseName(path: string) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function depth(path: string) {
  return path.split("/").length - (path.endsWith("/") ? 1 : 0);
}

/** Whether `query`'s characters all appear in `text`, in order. */
function inOrder(text: string, query: string) {
  let at = 0;
  for (const character of query) {
    at = text.indexOf(character, at) + 1;
    if (at === 0) return false;
  }
  return true;
}

async function gitFiles(cwd: string) {
  try {
    const child = Bun.spawn(["git", "-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) return null;
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function walk(cwd: string) {
  const found: string[] = [];
  const folders = [""];
  while (folders.length > 0 && found.length < MOST) {
    const folder = folders.shift()!;
    const entries = await readdir(join(cwd, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = folder + entry.name;
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) folders.push(`${path}/`);
      } else {
        found.push(path);
      }
    }
  }
  return found.slice(0, MOST);
}
