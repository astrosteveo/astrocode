// What Claude Code's own dialogs show: /permissions, /memory, /hooks, /skills, /status and /sandbox.
// The SDK asks for them in its code (`listPermissionRules()`, `getMemoryDialog()` and so on) but
// not in Query's type, so each answer is checked here. Names, rules, commands and descriptions are
// other people's text, so control characters are spelled out where they'd move the cursor.
import { field } from "./view/tools";

export type Behavior = "allow" | "ask" | "deny";

export const BEHAVIORS: readonly Behavior[] = ["allow", "ask", "deny"];

/** The settings files Claude Code's dialogs write to: yours here, the project's, and yours everywhere. */
export type SettingsFile = "localSettings" | "projectSettings" | "userSettings";

export type PermissionRule = {
  behavior: Behavior;
  /** Where Claude Code got it: a settings file, `session` for an answer given this session, `cliArg`, policy and so on. */
  source: string;
  /** As stored, which removing it must name exactly. */
  rule: string;
  /** Claude Code's reading of it, such as "Any Bash command starting with " and "npm test". */
  reading?: { prefix: string; emphasis: string; suffix: string };
  /** It's in a settings file and in effect, so it can be removed. */
  removable: boolean;
  /** Managed settings allow only their own rules, so the session ignores this one. */
  ignored: boolean;
};

export type PermissionRules = {
  rules: PermissionRule[];
  /** Folders Claude may work in besides the project, and where each came from. */
  directories: { path: string; source: string }[];
  /** Managed settings allow only their own rules. */
  managedOnly: boolean;
};

export function permissionRules(value: unknown): PermissionRules {
  const state = field(value, "state");
  const rules = list(field(state, "rules")).flatMap((entry): PermissionRule[] => {
    const behavior = BEHAVIORS.find((one) => one === field(entry, "behavior"));
    const rule = text(field(entry, "rule"));
    if (!behavior || !rule) return [];
    const reading = field(entry, "description");
    return [
      {
        behavior,
        source: text(field(entry, "source")),
        rule,
        // Its parts join as they are, spaces and all.
        reading: reading ? { prefix: part(field(reading, "prefix")), emphasis: part(field(reading, "emphasis")), suffix: part(field(reading, "suffix")) } : undefined,
        removable: field(entry, "editability") === "persistent",
        ignored: field(entry, "notInEffect") === true,
      },
    ];
  });
  const directories = list(field(state, "workspaceDirectories")).flatMap((entry) => {
    const path = text(field(entry, "path"));
    return path ? [{ path, source: text(field(entry, "source")) }] : [];
  });
  return { rules, directories, managedOnly: field(state, "managedOnly") === true };
}

/** A switch in the memory dialog: whether it's on, whether it can be changed, and Claude Code's words for its state. */
export type MemoryToggle = { on: boolean; toggleable: boolean; status: string; detail: string };

export type MemoryDialog = {
  /** The CLAUDE.md files Claude Code reads: yours, the project's and so on, made when first opened. */
  files: { path: string; label: string; description: string; exists: boolean }[];
  /** What auto-memory has saved for this project. */
  memories: { name: string; path: string; description: string; type: string; modified?: number }[];
  /** Where auto-memory keeps them. */
  folder?: string;
  autoMemory: MemoryToggle;
  /** Null where Claude Code doesn't offer it. */
  autoDream: MemoryToggle | null;
};

export function memoryDialog(value: unknown): MemoryDialog {
  const toggle = (entry: unknown): MemoryToggle => ({
    on: field(entry, "enabled") === true,
    toggleable: field(entry, "toggleable") !== false,
    status: line(field(entry, "status")),
    detail: line(field(entry, "detail")),
  });
  const dream = field(value, "auto_dream");
  return {
    files: list(field(value, "files")).flatMap((entry) => {
      const path = text(field(entry, "path"));
      return path ? [{ path, label: line(field(entry, "label")) || path, description: line(field(entry, "description")), exists: field(entry, "exists") === true }] : [];
    }),
    memories: list(field(value, "memories")).flatMap((entry) => {
      const path = text(field(entry, "path"));
      const modified = field(entry, "modified_ms");
      return path
        ? [{ name: line(field(entry, "name")) || path, path, description: line(field(entry, "description")), type: line(field(entry, "type")), modified: typeof modified === "number" ? modified : undefined }]
        : [];
    }),
    folder: list(field(value, "folders"))
      .map((entry) => text(field(entry, "path")))
      .find(Boolean),
    autoMemory: toggle(field(value, "auto_memory")),
    autoDream: field(dream, "shown") === true ? toggle(dream) : null,
  };
}

export type Hook = {
  event: string;
  /** Which tools or sources it runs for; empty for all of them. */
  matcher: string;
  /** Where it's set, in Claude Code's words, such as "User settings (~/.claude/settings.json)". */
  where: string;
  plugin: string;
  /** command, prompt, agent, http, mcp_tool and so on. */
  type: string;
  /** What it runs, and what Claude Code calls that, such as "Command". */
  text: string;
  label: string;
  timeout?: number;
};

export type HooksListing = { hooks: Hook[]; events: Record<string, string> };

export function hooksListing(value: unknown): HooksListing {
  const events: Record<string, string> = {};
  for (const entry of [...list(field(value, "eventCatalog")), ...list(field(value, "events"))]) {
    const name = text(field(entry, "name"));
    if (name) events[name] = line(field(entry, "summary"));
  }
  const hooks = list(field(value, "hooks")).flatMap((entry): Hook[] => {
    const event = text(field(entry, "event"));
    if (!event) return [];
    const timeout = field(entry, "timeout");
    return [
      {
        event: line(event),
        matcher: line(field(entry, "matcher")),
        where: line(field(entry, "sourceLabel")) || line(field(entry, "source")),
        plugin: line(field(entry, "pluginName")),
        type: line(field(entry, "type")),
        text: line(field(entry, "commandText")) || line(field(entry, "displayText")),
        label: line(field(entry, "contentLabel")) || "Runs",
        timeout: typeof timeout === "number" ? timeout : undefined,
      },
    ];
  });
  return { hooks, events };
}

/** How much of a skill Claude sees: all of it, its name only, only your /command, or nothing. */
export type SkillState = "on" | "name-only" | "user-invocable-only" | "off";

export const SKILL_STATES: readonly SkillState[] = ["on", "name-only", "user-invocable-only", "off"];

export type Skill = {
  /** The settings key, `server:skill` for an MCP server's. */
  name: string;
  /** As the menu shows it. */
  title: string;
  description: string;
  /** user, project, a plugin's name, built-in and so on. */
  source: string;
  /** About how many tokens its listing takes in the system prompt. */
  tokens: number;
  state: SkillState;
  /** Why its state can't be changed here: author, plugin, policy, flag or reserved-name. */
  lockedBy?: string;
  /** The other names its state may be stored under, which an edit sends back as they came. */
  handles?: unknown;
};

export function skillsDialog(value: unknown): Skill[] {
  return list(field(value, "skills")).flatMap((entry): Skill[] => {
    const name = text(field(entry, "name"));
    if (!name) return [];
    const tokens = field(entry, "tokens");
    return [
      {
        name,
        title: line(field(entry, "display_name")) || line(name),
        description: line(field(entry, "description")),
        source: line(field(entry, "source")),
        tokens: typeof tokens === "number" ? tokens : 0,
        state: SKILL_STATES.find((one) => one === field(entry, "state")) ?? "on",
        lockedBy: text(field(entry, "locked_by")) || undefined,
        handles: field(entry, "handles"),
      },
    ];
  });
}

/** /status: titled sections of labels and values. */
export type StatusSection = { title: string; rows: { label: string; value: string }[] };

export function statusDialog(value: unknown): StatusSection[] {
  return list(field(value, "sections")).map((section) => ({
    title: line(field(section, "title")),
    rows: list(field(section, "rows")).map((row) => ({ label: line(field(row, "label")), value: line(field(row, "value")) })),
  }));
}

/** Sandboxed with its commands allowed without asking, sandboxed with the usual permissions, or no sandbox. */
export type SandboxMode = "auto-allow" | "regular" | "disabled";

export type SandboxDialog = {
  /** Sandboxing can be set up on this platform. */
  supported: boolean;
  /** Higher-priority settings set the mode. */
  locked: boolean;
  /** Whether a command that fails in the sandbox may run again outside it, and whether that can be changed here. */
  fallback: boolean;
  fallbackLocked: boolean;
  /** Running in this session. */
  running: boolean;
  mode: SandboxMode;
  autoAllowAvailable: boolean;
  /** Missing dependencies: with any of `errors` it can't run; `warnings` isolate less. */
  errors: string[];
  warnings: string[];
  /** Command patterns that always run outside it. */
  excluded: string[];
  /** What it lets through, by Claude Code's setting names: paths, domains and sockets. */
  restrictions: { name: string; values: string[] }[];
};

export function sandboxDialog(value: unknown): SandboxDialog {
  const dependencies = field(value, "dependencies");
  const restrictions = field(value, "restrictions");
  const mode = field(value, "mode");
  return {
    supported: field(value, "supported") === true,
    locked: field(value, "locked") === true,
    fallback: field(value, "unsandboxed_fallback") === true,
    fallbackLocked: field(value, "overrides_locked") === true,
    running: field(value, "enabled") === true,
    mode: mode === "auto-allow" || mode === "regular" ? mode : "disabled",
    autoAllowAvailable: field(value, "auto_allow_available") === true,
    errors: list(field(dependencies, "errors")).map(line).filter(Boolean),
    warnings: list(field(dependencies, "warnings")).map(line).filter(Boolean),
    excluded: list(field(value, "excluded_commands")).map(line).filter(Boolean),
    restrictions:
      typeof restrictions === "object" && restrictions !== null
        ? Object.entries(restrictions).flatMap(([name, values]) => (Array.isArray(values) && values.length ? [{ name, values: values.map(line) }] : []))
        : [],
  };
}

/**
 * Someone else's text on one line: runs of whitespace become a space, and control characters,
 * which could move the cursor or reverse the text, are spelled out as `\u001b` and the like.
 */
export function line(value: unknown) {
  return part(value).trim();
}

/** Like `line`, for a piece of a line, whose spaces at either end are kept. */
function part(value: unknown) {
  return text(value)
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
