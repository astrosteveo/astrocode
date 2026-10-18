// How each tool call reads in a single row: its name, what it acts on, and how it went.
import type { ToolCall } from "./state";

const NAMES: Record<string, string> = { AskUserQuestion: "Question", TodoWrite: "To-dos" };

/** `mcp__server__tool` reads as `tool (server)`. */
export function toolLabel(name: string) {
  if (NAMES[name]) return NAMES[name];
  if (!name.startsWith("mcp__")) return name;
  const [, server = "", ...rest] = name.split("__");
  return `${rest.join("__")} (${server})`;
}

/** What the call acts on, in one line: Bash's command, Read's path, a search's pattern. */
export function toolTarget(call: ToolCall, cwd: string, home: string) {
  const text = (key: string) => {
    const value = call.input[key];
    return typeof value === "string" ? value : "";
  };
  const path = (key: string) => shortPath(text(key), cwd, home);
  switch (call.name) {
    case "Bash":
      return withoutPreamble(firstLine(text("command")));
    case "Read":
    case "Write":
    case "Edit":
      return path("file_path");
    case "NotebookEdit":
      return path("notebook_path");
    case "Glob":
    case "Grep":
      return text("path") ? `${text("pattern")} in ${path("path")}` : text("pattern");
    case "WebFetch":
      return text("url");
    case "WebSearch":
      return text("query");
    case "Agent":
    case "Task":
      return text("description") || text("subagent_type");
    case "ExitPlanMode":
      return path("planFilePath") || firstLine(text("plan"));
    case "Monitor":
    case "Workflow":
      return text("description") || firstLine(text("command")) || text("name");
    case "Skill":
      return text("skill");
    case "TodoWrite":
      return Array.isArray(call.input.todos) ? plural(call.input.todos.length, "to-do") : "";
    case "AskUserQuestion": {
      const [first] = Array.isArray(call.input.questions) ? call.input.questions : [];
      const question = field(first, "question");
      return typeof question === "string" ? question : "";
    }
    default: {
      const first = Object.values(call.input).find((value) => typeof value === "string");
      return typeof first === "string" ? firstLine(first) : "";
    }
  }
}

/** A word or two on how the call went: what it returned, at a glance. */
export function toolSummary(call: ToolCall, waiting: boolean) {
  if (waiting) return "waiting for you";
  switch (call.status) {
    case "running":
      return call.subagentCalls ? plural(call.subagentCalls, "tool call") : "running";
    case "denied":
      return call.deniedBy ? `denied by ${call.deniedBy}` : "denied";
    case "stopped":
      return "stopped";
    case "error":
      return "failed";
    case "done":
      return doneSummary(call);
  }
}

function doneSummary(call: ToolCall) {
  const output = call.output;
  // A subagent, Monitor or workflow that went to the background answered at once; it says how it
  // went when it ends. Bash's card says so itself.
  if (call.background && call.name !== "Bash") return backgroundSummary(call);
  switch (call.name) {
    case "Edit":
      return editSummary(call.input);
    case "Write":
      return typeof call.input.content === "string" ? `+${lineCount(call.input.content)}` : "done";
    case "Agent":
    case "Task":
      return plural(call.subagentCalls, "tool call");
    case "AskUserQuestion":
      return "answered";
    case "Read": {
      const lines = field(field(output, "file"), "numLines");
      if (typeof lines === "number") return plural(lines, "line");
      break;
    }
    case "Bash": {
      // Moved to the background with Ctrl+B, or started there: it reports back when it ends.
      if (typeof field(output, "backgroundTaskId") === "string") return "in the background";
      const out = bashOutput(output);
      if (out !== null) return out.stdout + out.stderr === "" ? "no output" : plural(lineCount(out.stdout + out.stderr), "line");
      break;
    }
    case "Grep":
    case "Glob": {
      const lines = field(output, "numLines");
      const files = field(output, "numFiles");
      if (typeof lines === "number" && lines > 0) return plural(lines, "line");
      if (typeof files === "number") return plural(files, "file");
      break;
    }
    case "WebFetch": {
      const code = field(output, "code");
      if (typeof code === "number") return `${code} ${String(field(output, "codeText") ?? "")}`.trim();
      break;
    }
  }
  if (call.images?.length) return plural(call.images.length, "image");
  const result = call.result?.trimEnd() ?? "";
  if (!result || /^\(\w+ completed with no output\)$/.test(result)) return "no output";
  return plural(lineCount(result), "line");
}

/** How work that went to the background is going, or how it ended. */
function backgroundSummary(call: ToolCall) {
  const calls = call.subagentCalls ? ` · ${plural(call.subagentCalls, "tool call")}` : "";
  switch (call.background) {
    case "running":
      return `in the background${calls}`;
    case "completed":
      return `finished in the background${calls}`;
    case "failed":
      return "failed in the background";
    case "stopped":
      return "stopped";
    default:
      return "went to the background";
  }
}

/** What a Bash call printed, from Claude Code's structured output, without its notes about itself. */
export function bashOutput(output: unknown): { stdout: string; stderr: string } | null {
  const stdout = field(output, "stdout");
  const stderr = field(output, "stderr");
  if (typeof stdout !== "string" && typeof stderr !== "string") return null;
  return {
    stdout: typeof stdout === "string" ? stdout.replace(/\n+$/, "") : "",
    stderr: typeof stderr === "string" ? stderr.replace(/^Shell cwd was reset to .*$/gm, "").trim() : "",
  };
}

export function shortPath(path: string, cwd: string, home: string) {
  if (!path) return "";
  if (cwd && path === cwd) return ".";
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function editSummary(input: Record<string, unknown>) {
  const count = (key: string) => (typeof input[key] === "string" && input[key] ? lineCount(input[key] as string) : 0);
  return `+${count("new_string")} −${count("old_string")}`;
}

function lineCount(text: string) {
  return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

function firstLine(text: string) {
  const [first = ""] = text.split("\n");
  return text.includes("\n") ? `${first} …` : first;
}

/** Leading `cd dir &&` and `NAME=value;` steps say where a command runs, not what it does. */
function withoutPreamble(command: string) {
  return command.replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s*;\s*)+/, "") || command;
}
