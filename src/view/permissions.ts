// The words on a permission prompt, in `claude`'s own (Claude Code 2.1.318, read from its screen):
// a table per tool of the header, what it asks, and the rows, each with what picking it sends.
// "Don't ask again" rows say exactly what they add, from the change Claude Code suggests.
import type { PermissionMode, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { Decision, PermissionRequest } from "../events";
import type { TaskInfo } from "./state";
import { shortPath, toolLabel } from "./tools";

/**
 * One row of a prompt. `note`: words after the label, dim. `key`: the key `claude` names at the
 * row's end, which picks it. `amend`: Tab opens a comment on the row, with this placeholder, and
 * what you type goes to Claude as the reason for no.
 */
export type Row = { label: string; decision: Decision; note?: string; key?: string; amend?: string };

/**
 * A prompt: its header, the line under it (the file, the site, the tool), what it asks right above
 * the rows, and the rows. `field`: a row you type in after the others, with its placeholder, as the
 * plan's "Tell Claude what to change". `cancel`: whether the hint line says `Esc to cancel`.
 */
export type Ask = { header: string; subject?: string; question?: string; rows: Row[]; field?: string; cancel: boolean };

/** What a prompt needs besides the request: where you are, the mode you're in, and the modes it may offer. */
export type Where = { cwd: string; home: string; mode: PermissionMode; modes: { bypass: boolean; auto: boolean }; exists?: boolean };

const YES: Decision = { allow: true };
const NO: Row = { label: "No", decision: { allow: false }, amend: "and tell Claude what to do differently" };

/** A row that switches the session to `mode` as it says yes. */
const switching = (label: string, mode: PermissionMode, more: Partial<Row> = {}): Row => ({
  label,
  decision: { allow: true, updates: [{ type: "setMode", mode, destination: "session" }] },
  ...more,
});

/** A row as `claude` draws it: the label, its note, and its key in brackets. */
export function rowText(row: Row) {
  return [row.label, row.note, row.key && `(${row.key})`].filter(Boolean).join(" ");
}

/** The prompt for `request`, by its tool. */
export function askFor(request: PermissionRequest, where: Where): Ask {
  switch (request.toolName) {
    case "Bash":
      return bash(request, where);
    case "Edit":
    case "MultiEdit":
    case "Write":
      return file(request, where);
    case "WebFetch":
      return fetch(request);
    case "ExitPlanMode":
      return plan(request, where);
    default:
      return tool(request, where);
  }
}

function bash(request: PermissionRequest, where: Where): Ask {
  const auto = where.modes.auto && (where.mode === "default" || where.mode === "acceptEdits");
  return {
    header: "Bash command",
    question: "Do you want to proceed?",
    rows: [
      { label: "Yes", decision: YES },
      ...standing(request, commandsRow(request.alwaysAllow, where)),
      ...(auto ? [switching("Yes, and switch to auto mode", "auto", { note: "· auto mode handles these prompts for you" })] : []),
      NO,
    ],
    cancel: true,
  };
}

/** Bash's "don't ask again": for these commands, or with access to these folders, in this project. */
function commandsRow(updates: PermissionUpdate[] | undefined, where: Where) {
  const rules = (updates ?? []).flatMap((update) => (update.type === "addRules" ? update.rules : []));
  const commands = rules.filter((rule) => rule.toolName === "Bash" && rule.ruleContent).map((rule) => prefix(rule.ruleContent!));
  const reads = rules.filter((rule) => rule.toolName === "Read" && rule.ruleContent).map((rule) => readPath(rule.ruleContent!));
  const dirs = (updates ?? []).flatMap((update) => (update.type === "addDirectories" ? update.directories : []));
  if (commands.length) return `Yes, and don't ask again for ${list(commands)} commands in ${where.cwd}`;
  if (dirs.length) return `Yes, and always allow access to ${list(dirs)} from this project`;
  if (reads.length) return `Yes, allow reading from ${list(reads)} from this project`;
  return null;
}

function file(request: PermissionRequest, where: Where): Ask {
  const path = typeof request.input.file_path === "string" ? request.input.file_path : "";
  const name = path.split("/").at(-1) ?? path;
  const write = request.toolName === "Write";
  // Claude Code asks to create a file that isn't there, and to overwrite one that is.
  const [header, verb] = !write ? ["Edit file", "make this edit to"] : where.exists === false ? ["Create file", "create"] : where.exists ? ["Overwrite file", "overwrite"] : ["Write file", "write to"];
  return {
    header,
    subject: shortPath(path, where.cwd, where.home),
    question: `Do you want to ${verb} ${name}?`,
    rows: [{ label: "Yes", decision: YES }, ...standing(request, editsRow(request.alwaysAllow), "shift+tab"), NO],
    cancel: true,
  };
}

/** A file edit's "for this session": accept edits, or access to these folders. */
function editsRow(updates: PermissionUpdate[] | undefined) {
  const [first] = updates ?? [];
  if (first?.type === "setMode" && first.mode === "acceptEdits") return "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session";
  if (first?.type === "addDirectories") return `Yes, and always allow access to ${list(first.directories)} for this session`;
  return null;
}

function fetch(request: PermissionRequest): Ask {
  const url = typeof request.input.url === "string" ? request.input.url : "";
  const rules = (request.alwaysAllow ?? []).flatMap((update) => (update.type === "addRules" ? update.rules : []));
  const domains = rules.flatMap((rule) => (rule.ruleContent?.startsWith("domain:") ? [rule.ruleContent.slice("domain:".length)] : []));
  return {
    header: "Fetch",
    subject: `Claude wants to fetch content from ${hostOf(url)}`,
    question: "Do you want to allow Claude to fetch this content?",
    rows: [
      { label: "Yes", decision: YES },
      ...standing(request, domains.length ? `Yes, and don't ask again for ${list(domains)}` : null),
      // No hint line and no comment here: this row says no, and Claude waits for you to say what instead.
      { label: "No, and tell Claude what to do differently", decision: { allow: false }, key: "esc" },
    ],
    cancel: false,
  };
}

function plan(request: PermissionRequest, where: Where): Ask {
  if (typeof request.input.plan !== "string" || !request.input.plan.trim()) {
    return { header: "Exit plan mode?", subject: "Claude wants to exit plan mode", rows: [{ label: "Yes", decision: YES }, { label: "No", decision: { allow: false } }], cancel: false };
  }
  // Claude Code offers the first of these it can switch to.
  const first = where.modes.bypass
    ? switching("Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session", "bypassPermissions")
    : where.modes.auto
      ? switching("Yes, and use auto mode", "auto")
      : switching("Yes, auto-accept edits", "acceptEdits");
  return {
    header: "Ready to code?",
    subject: "Here is Claude's plan:",
    question: "Claude has written up a plan and is ready to execute. Would you like to proceed?",
    rows: [first, switching("Yes, manually approve edits", "default")],
    field: "Tell Claude what to change",
    cancel: false,
  };
}

/** Any other tool, an MCP server's among them, as `claude` asks for one: by its name, and its server's. */
function tool(request: PermissionRequest, where: Where): Ask {
  const name = request.server ? `${request.server} — ${request.displayName ?? toolLabel(request.toolName)}` : (request.displayName ?? toolLabel(request.toolName));
  const rules = (request.alwaysAllow ?? []).flatMap((update) => (update.type === "addRules" ? update.rules : []));
  return {
    header: "Tool use",
    subject: `${name} Tool:${request.server ? " (MCP)" : ""}`,
    question: "Do you want to proceed?",
    rows: [{ label: "Yes", decision: YES }, ...standing(request, rules.length ? `Yes, and don't ask again for ${name} commands in ${where.cwd}` : null), NO],
    cancel: true,
  };
}

/** The "don't ask again" row, which applies what Claude Code suggested, when it suggested anything `label` can say. */
function standing(request: PermissionRequest, label: string | null, key?: string): Row[] {
  if (!label || !request.alwaysAllow) return [];
  return [{ label, decision: { allow: true, updates: request.alwaysAllow }, key }];
}

/** `a`, `a and b`, `a, b, and c`, as `claude` lists them. */
function list(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** A command rule without its trailing wildcard: `npm run:*` reads as `npm run`. */
function prefix(rule: string) {
  return rule.endsWith(":*") || rule.endsWith(" *") ? rule.slice(0, -2) : rule;
}

/** A Read rule's path without its `/**`, as `claude` shows it. */
function readPath(rule: string) {
  return rule.replace(/\/\*\*$/, "").replace(/^\.\//, "").replace(/^\/\//, "/");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A sentence for a desktop notification: what Claude wants to do. */
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

/**
 * Claude Code's description, unless it only repeats the path, command or address the prompt
 * already shows, whole or cut short.
 */
export function permissionNote(request: PermissionRequest, cwd: string, home: string) {
  const description = request.description;
  if (!description) return undefined;
  const cut = description.replace(/(…|\.\.\.)$/, "");
  const shown = ["file_path", "command", "url"].map((key) => request.input[key]).filter((value) => typeof value === "string");
  return shown.some((value) => value === description || shortPath(value, cwd, home) === description || (cut !== description && value.startsWith(cut))) ? undefined : description;
}
