// The words on a permission prompt, including exactly what "always allow" does.
import type { PermissionMode, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest } from "../events";
import type { TaskInfo } from "./state";
import { shortPath, toolLabel } from "./tools";

const TITLES: Record<string, string> = {
  Bash: "Claude wants to run a command",
  Edit: "Claude wants to edit a file",
  Write: "Claude wants to write a file",
  NotebookEdit: "Claude wants to edit a notebook",
  WebFetch: "Claude wants to fetch a page",
  WebSearch: "Claude wants to search the web",
  ExitPlanMode: "Claude's plan is ready",
};

export function permissionTitle(request: PermissionRequest) {
  return request.title ?? TITLES[request.toolName] ?? `Claude wants to use ${toolLabel(request.toolName)}`;
}

/**
 * The subagent that asks, by what Claude asked it to do: empty for one Claude Code no longer
 * tracks, as inside a workflow. Undefined when Claude asks.
 */
export function askedBy(request: PermissionRequest, tasks: Record<string, TaskInfo>) {
  if (request.agentId === undefined) return undefined;
  return tasks[request.agentId]?.description ?? "";
}

/** Claude Code's description, unless it only repeats the path or command the prompt already shows. */
export function permissionNote(request: PermissionRequest, cwd: string, home: string) {
  const description = request.description;
  if (!description) return undefined;
  const shown = ["file_path", "command", "url"].map((key) => request.input[key]).filter((value) => typeof value === "string");
  return shown.some((value) => value === description || shortPath(value, cwd, home) === description) ? undefined : description;
}

const SCOPES: Record<PermissionUpdate["destination"], string> = {
  session: "for this session",
  cliArg: "for this session",
  localSettings: "in this project",
  projectSettings: "in this project, for everyone",
  userSettings: "in every project",
};

const MODE_PHRASES: Partial<Record<PermissionMode, string>> = {
  acceptEdits: "accept edits for the rest of this session",
  default: "ask before acting",
};

/** Says exactly what "always allow" changes. The server sends one kind of change at most. */
export function alwaysLabel(updates: PermissionUpdate[] | undefined, home: string) {
  const [first] = updates ?? [];
  if (!updates || !first) return null;
  const scope = SCOPES[first.destination];
  switch (first.type) {
    case "addRules": {
      const rules = updates.flatMap((u) => (u.type === "addRules" ? u.rules : []));
      return `Always allow ${rules.map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(", ")} ${scope}`;
    }
    case "addDirectories": {
      const dirs = updates.flatMap((u) => (u.type === "addDirectories" ? u.directories : []));
      return `Allow, and give access to ${dirs.map((d) => shortPath(d, "", home) || d).join(", ")} ${scope}`;
    }
    case "setMode":
      return `Allow, and ${MODE_PHRASES[first.mode] ?? `switch to ${first.mode}`}`;
    default:
      return null;
  }
}
