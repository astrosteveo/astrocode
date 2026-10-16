// The message put aside with Ctrl+S, kept on disk per project so it outlives quitting astrocode.
// It lives in `$XDG_STATE_HOME/astrocode/stash/` (`~/.local/state/…`), one file per project, with
// the images the message mentions, since their numbers mean nothing to the next run.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ImageAttachment } from "./events";

/** The text as it was in the box, and its images by the number its `[Image #n]` labels use. */
export type Stash = { text: string; images: Record<number, ImageAttachment> };

function stashPath(cwd: string) {
  const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(state, "astrocode", "stash", `${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}.json`);
}

/** This project's stash, or null when there's none or it can't be read. */
export async function loadStash(cwd: string): Promise<Stash | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stashPath(cwd), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { text, images } = parsed as Record<string, unknown>;
    if (typeof text !== "string" || !text) return null;
    return { text, images: typeof images === "object" && images !== null ? (images as Stash["images"]) : {} };
  } catch {
    return null;
  }
}

let saving = Promise.resolve();

/** Keeps the stash for the next run, or forgets it. Saves run one after another, so the last one wins. */
export function saveStash(cwd: string, stash: Stash | null) {
  const save = saving.then(async () => {
    const path = stashPath(cwd);
    if (!stash) return rm(path, { force: true });
    await mkdir(dirname(path), { recursive: true });
    // Written whole and then moved into place, so a crash can't leave half a file.
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ cwd, ...stash }), { mode: 0o600 });
    await rename(temporary, path);
  });
  saving = save.catch(() => {});
  return save;
}

/** Waits for the saves already asked for, so quitting right after Ctrl+S doesn't lose it. */
export function stashSaved() {
  return saving;
}
