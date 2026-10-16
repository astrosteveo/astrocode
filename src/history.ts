import { getSessionInfo, getSessionMessages, listSessions, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
  const messages = await getSessionMessages(sessionId, { dir: cwd });
  const events: SessionEvent[] = [];
  for (const saved of messages) {
    const base = { message: saved.message, parent_tool_use_id: saved.parent_tool_use_id, uuid: saved.uuid, session_id: saved.session_id };
    if (saved.type === "assistant") {
      events.push({ kind: "sdk", message: { type: "assistant", ...base } as SDKMessage });
    } else if (saved.type === "user") {
      const typed = saved.parent_tool_use_id ? null : promptText(field(saved.message, "content"));
      events.push(typed !== null ? { kind: "prompt", text: typed } : { kind: "sdk", message: { type: "user", ...base } as SDKMessage });
    }
  }
  return events;
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
