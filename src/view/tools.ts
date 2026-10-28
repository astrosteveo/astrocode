// How each tool call reads in a single row: its name, what it acts on, and how it went.
import type { ToolCall } from "./state";

/** astrocode's own tool for showing you a picture (`src/show.ts`). */
export const SHOW_TOOL = "mcp__astrocode__show";

const NAMES: Record<string, string> = { AskUserQuestion: "Question", TodoWrite: "To-dos", [SHOW_TOOL]: "Show" };

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
    case SHOW_TOOL:
      return text("title");
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
      if (call.name === "Agent" || call.name === "Task") return [agentType(call), call.subagentCalls ? plural(call.subagentCalls, "tool call") : "running"].filter(Boolean).join(" · ");
      return "running";
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
      return [agentType(call), plural(subagentCallCount(call), "tool call")].filter(Boolean).join(" · ");
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
  const count = subagentCallCount(call);
  const calls = count ? ` · ${plural(count, "tool call")}` : "";
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

/** The kind of subagent an Agent call asked for, such as Explore, where it named one. */
function agentType(call: ToolCall) {
  return typeof call.input.subagent_type === "string" ? call.input.subagent_type : "";
}

/**
 * How many tool calls a subagent made: Claude Code's own count once it ends, else those seen as it
 * ran. A saved conversation keeps neither, only the usage at the end of the result's text.
 */
export function subagentCallCount(call: ToolCall) {
  const total = field(call.output, "totalToolUseCount");
  if (typeof total === "number") return total;
  const saved = /<usage>[\s\S]*?\btool_uses: (\d+)[\s\S]*?<\/usage>/.exec(call.result ?? "");
  return saved ? Math.max(Number(saved[1]), call.subagentCalls) : call.subagentCalls;
}

/**
 * A subagent's report, without what Claude Code adds for Claude: how to continue the agent, and its
 * usage. A report handed back with SubagentHandback is in the structured result; a saved
 * conversation keeps only Claude Code's note that it came as a message of its own.
 */
export function subagentReport(call: ToolCall) {
  const handedBack = field(field(call.output, "handbackReport"), "text");
  if (typeof handedBack === "string") return handedBack;
  const text = (call.result ?? "")
    .replace(/<usage>[\s\S]*?<\/usage>\s*$/, "")
    .replace(/^agentId: \S+ \(use SendMessage[^\n]*\)\s*$/m, "")
    .trim();
  if (/^This agent's report was delivered to you as a message/.test(text)) return "It handed its report back to Claude as a message of its own.";
  // Claude Code frames a report it hands back, with a note to Claude, and indents its lines.
  const framed = /^\[Subagent hand-back\][\s\S]*?The report follows:\n/.exec(text);
  return framed ? text.slice(framed[0].length).replace(/^ {2}/gm, "") : text;
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
