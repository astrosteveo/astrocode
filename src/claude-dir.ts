import { homedir } from "node:os";
import { join } from "node:path";

/** Claude Code's folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}
