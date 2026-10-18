// Changes made in /permissions, /skills, /memory and /sandbox, written by the subcommands Claude
// Code's own dialogs use (`claude edit-permission-rules --json` and the like, each taking one edit
// as JSON on stdin), so they land in the same settings files with the same checks. A running
// session reads its settings files again by itself once they change.
import { claude } from "./claude";
import type { Behavior, SandboxMode, SettingsFile, Skill, SkillState } from "./dialogs";
import { field } from "./view/tools";

/** How an edit went, in Claude Code's words when it refused. */
export type EditResult = { ok: boolean; message: string; warnings?: string[] };

/** Adds a rule to one of the settings files. Claude Code checks the rule's form, and says if it's there already. */
export const addRule = (cwd: string, rule: string, behavior: Behavior, destination: SettingsFile) =>
  edit(cwd, "edit-permission-rules", { op: "add", rules: [rule], behavior, destination });

/** Removes a rule from the settings file it's in, by the exact text Claude Code listed it with. */
export const removeRule = (cwd: string, rule: string, behavior: Behavior, source: string) =>
  edit(cwd, "edit-permission-rules", { op: "remove", rule, behavior, source });

/** A skill's state, kept in the project's .claude/settings.local.json, as Claude Code's /skills keeps it. */
export const setSkillState = (cwd: string, skill: Skill, state: SkillState) =>
  edit(cwd, "edit-skill-overrides", { name: skill.name, state, ...(skill.handles !== undefined ? { handles: skill.handles } : {}) });

/** Auto-memory and auto-dream, on or off for all your sessions, in your own settings. */
export const setMemorySettings = (cwd: string, change: { autoMemoryEnabled?: boolean; autoDreamEnabled?: boolean }) =>
  edit(cwd, "edit-memory-settings", change);

/**
 * The sandbox's mode, whether a command that fails in it may run again outside it, or a command
 * pattern that always runs outside it. Kept in the project's .claude/settings.local.json.
 */
export const setSandbox = (cwd: string, change: { mode?: SandboxMode; allowUnsandboxedCommands?: boolean; excludeCommand?: string }) =>
  edit(cwd, "edit-sandbox-settings", change);

/** Runs `claude <command> --json` with the edit on stdin. It answers JSON when it took the edit, and a sentence when it didn't. */
async function edit(cwd: string, command: string, change: Record<string, unknown>): Promise<EditResult> {
  const { out, err, code } = await claude(cwd, [command, "--json"], JSON.stringify(change));
  if (code === 0) {
    try {
      const warnings = field(JSON.parse(out), "warnings");
      return { ok: true, message: "", warnings: Array.isArray(warnings) ? warnings.filter((one): one is string => typeof one === "string") : undefined };
    } catch {
      return { ok: true, message: "" };
    }
  }
  return { ok: false, message: (err.trim() || out.trim() || `claude ${command} failed.`).replace(/^Error:\s*/, "") };
}
