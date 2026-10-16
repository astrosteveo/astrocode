// What astrocode remembers between sessions: the model, effort and permission mode you last picked.
// They live in astrocode's own file, not Claude Code's settings, so `claude` keeps its own.
import type { EffortLevel, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isEffort, MODES } from "./events";

export type Remembered = { model?: string; effort?: EffortLevel; mode?: PermissionMode };

/** `$XDG_CONFIG_HOME/astrocode/settings.json`, which is `~/.config/astrocode/settings.json` unless set. */
export function settingsPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "astrocode", "settings.json");
}

/** What was remembered, leaving out anything missing or not understood. */
export async function loadSettings(): Promise<Remembered> {
  const { model, effort, mode } = await readSaved();
  return lasting({
    model: typeof model === "string" && model ? model : undefined,
    effort: typeof effort === "string" && isEffort(effort) ? effort : undefined,
    mode: MODES.find((one) => one === mode),
  });
}

let saving = Promise.resolve();

/** Remembers a choice for the next session. Saves run one after another, so quick Shift+Tabs end on the last mode. */
export function remember(choice: Remembered) {
  const kept = Object.fromEntries(Object.entries(lasting(choice)).filter(([, value]) => value !== undefined));
  if (!Object.keys(kept).length) return saving;
  const save = saving.then(async () => {
    const path = settingsPath();
    const next = `${JSON.stringify({ ...(await readSaved()), ...kept }, null, 2)}\n`;
    await mkdir(dirname(path), { recursive: true });
    // Written whole and then moved into place, so a crash can't leave half a file.
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, next);
    await rename(temporary, path);
  });
  // A failed save is the caller's to report; the next one still runs.
  saving = save.catch(() => {});
  return save;
}

/** Plan mode and max effort are for one session only, as in Claude Code, so they aren't remembered. */
function lasting({ model, effort, mode }: Remembered): Remembered {
  return { model, effort: effort === "max" ? undefined : effort, mode: mode === "plan" ? undefined : mode };
}

async function readSaved(): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(settingsPath(), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // No file yet, or one that can't be read: start from nothing.
    return {};
  }
}
