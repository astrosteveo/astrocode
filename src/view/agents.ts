// A subagent's transcript as the task view shows it: the brief it was given, what it wrote, and each
// tool it used. Built from Claude Code's stream as the subagent works, or from the file Claude Code
// keeps for it.
import { field, toolLabel } from "./tools";

/** A line of a subagent's transcript: its brief, what it said, or a tool it used. Not yet made printable. */
export type AgentLine = { text: string; kind: "prompt" | "text" | "tool" };

/** The most lines kept of one subagent's transcript from the stream; the task view shows the end. */
export const AGENT_LINES = 2000;

/** One message of a subagent's, `user` or `assistant`, as lines: its brief, its words, and its tool calls. */
export function agentLines(type: string, message: unknown): AgentLine[] {
  const content = field(message, "content");
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  return blocks.flatMap((block): AgentLine[] => {
    const text = field(block, "text");
    if (field(block, "type") === "text" && typeof text === "string" && text.trim()) {
      // Tool results come back as user messages too; only the words that start it are its brief.
      if (type === "user") return text.trim().startsWith("<") ? [] : [{ text: `❯ ${firstLine(text)}`, kind: "prompt" }];
      return text
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => ({ text: line, kind: "text" as const }));
    }
    if (field(block, "type") === "tool_use") {
      const input = field(block, "input");
      // Its report to Claude, word for word.
      const report = field(input, "message");
      if (field(block, "name") === "SubagentHandback" && typeof report === "string") {
        return [{ text: "⬢ handed back its report", kind: "tool" as const }, ...report.trim().split("\n").map((line) => ({ text: line, kind: "text" as const }))];
      }
      const about = ["description", "file_path", "command", "pattern", "url", "query", "prompt"]
        .map((key) => field(input, key))
        .find((value): value is string => typeof value === "string" && value.trim() !== "");
      return [{ text: `⬢ ${toolLabel(String(field(block, "name") ?? "tool"))}${about ? `  ${firstLine(about)}` : ""}`, kind: "tool" }];
    }
    return [];
  });
}

function firstLine(text: string) {
  const [first = ""] = text.trim().split("\n");
  return first;
}
