import { getSessionInfo, getSessionMessages, listSessions, type SDKMessage, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent } from "./events";

export type SavedSession = { id: string; title: string; firstPrompt?: string; modified: number; branch?: string };

/** Sessions saved for this folder, newest first. astrocode's sessions are SDK sessions, so those count too. */
export async function savedSessions(cwd: string, limit = 50): Promise<SavedSession[]> {
  const sessions = await listSessions({ dir: cwd, limit, includeProgrammatic: true });
  return sessions.map((session) => ({
    id: session.sessionId,
    title: session.customTitle ?? session.summary,
    firstPrompt: session.firstPrompt,
    modified: session.lastModified,
    branch: session.gitBranch,
  }));
}

export async function sessionTitle(sessionId: string, cwd: string) {
  const info = await getSessionInfo(sessionId, { dir: cwd }).catch(() => undefined);
  return info ? (info.customTitle ?? info.summary) : undefined;
}

/**
 * A saved conversation as the events that would have drawn it, so a resumed session shows what
 * came before: what you typed becomes prompts, and Claude's messages and tool results replay
 * through the same reducer as live ones.
 */
export async function loadHistory(sessionId: string, cwd: string): Promise<SessionEvent[]> {
  return historyEvents(await getSessionMessages(sessionId, { dir: cwd }));
}

/** Saved messages as the events that would have drawn them. */
export function historyEvents(messages: SessionMessage[]): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (const saved of messages) {
    const base = { message: saved.message, parent_tool_use_id: saved.parent_tool_use_id, uuid: saved.uuid, session_id: saved.session_id };
    if (saved.type === "assistant") {
      events.push({ kind: "sdk", message: { type: "assistant", ...base } as SDKMessage });
    } else if (saved.type === "user") {
      const content = field(saved.message, "content");
      const shell = saved.parent_tool_use_id ? null : shellPart(content);
      if (shell?.command !== undefined) {
        events.push({ kind: "shell", id: saved.uuid, command: shell.command });
        continue;
      }
      if (shell?.stdout !== undefined) {
        // The output belongs to the command saved just before it.
        const started = events.findLast((event) => event.kind === "shell");
        if (started?.kind === "shell") events.push({ kind: "shell-done", id: started.id, stdout: shell.stdout, stderr: shell.stderr ?? "", code: shell.stderr ? 1 : 0 });
        continue;
      }
      const typed = saved.parent_tool_use_id ? null : promptText(content);
      events.push(typed !== null ? { kind: "prompt", text: typed, uuid: saved.uuid } : { kind: "sdk", message: { type: "user", ...base } as SDKMessage });
    }
  }
  return events;
}

/**
 * A command run with `!` is saved as two messages, as Claude Code saves its own: the command in
 * `<bash-input>`, then what it printed in `<bash-stdout>` and `<bash-stderr>`.
 */
function shellPart(content: unknown) {
  if (typeof content !== "string") return null;
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(content)?.[1];
  const command = tag("bash-input");
  if (command !== undefined) return { command };
  const stdout = tag("bash-stdout");
  return stdout !== undefined ? { stdout, stderr: tag("bash-stderr") } : null;
}

/** How a command run with `!` goes into the conversation, the same way Claude Code's does. */
export function shellMessages(command: string, stdout: string, stderr: string) {
  return [`<bash-input>${command}</bash-input>`, `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${stderr}</bash-stderr>`];
}

/** What you typed: a string, or text blocks with no tool results. */
function promptText(content: unknown): string | null {
  if (typeof content === "string") return typedByYou(content);
  if (!Array.isArray(content) || content.some((block) => field(block, "type") === "tool_result")) return null;
  const text = content
    .map((block) => field(block, "text"))
    .filter((text) => typeof text === "string")
    .join("\n");
  return typedByYou(text);
}

/** Claude Code also saves command echoes, reminders and interruptions as user messages. */
function typedByYou(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<") || trimmed.startsWith("[Request interrupted")) return null;
  return text;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
