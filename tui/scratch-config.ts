import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saved } from "../src/settings";

const NAMES = ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "CLAUDE_CONFIG_DIR"] as const;

/**
 * For tests that render the app or save settings: `start()` points astrocode's and Claude Code's
 * folders at a new scratch folder, so nothing a test does lands in yours, and `stop()` puts them back
 * and removes it.
 */
export function scratchConfig() {
  let before: Partial<Record<(typeof NAMES)[number], string>> = {};
  let folder = "";
  return {
    /** The scratch folder `XDG_CONFIG_HOME` points at while a test runs. */
    folder: () => folder,
    start() {
      before = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
      folder = mkdtempSync(join(tmpdir(), "astrocode-config-"));
      process.env.XDG_CONFIG_HOME = folder;
      process.env.XDG_STATE_HOME = join(folder, "state");
      process.env.CLAUDE_CONFIG_DIR = join(folder, "claude");
    },
    async stop() {
      // A save finds its file only when it runs, so one still queued would land in yours once these are put back.
      await saved();
      for (const name of NAMES) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
