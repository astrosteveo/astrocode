import { getSessionInfo, getSessionMessages, listSessions, type SDKMessage, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { imageBlocks, sdkEvent, type ImageAttachment, type SessionEvent } from "./events";

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

/** The end of a saved conversation, for a glance at it before resuming: your last message, Claude's last words, and how many messages you sent. */
export type SessionPreview = { prompts: number; lastPrompt?: string; lastReply?: string };

export async function sessionPreview(sessionId: string, cwd: string): Promise<SessionPreview> {
  const messages = await getSessionMessages(sessionId, { dir: cwd });
  const preview: SessionPreview = { prompts: 0 };
  for (const entry of messages) {
    if (entry.parent_tool_use_id) continue;
    const content = (entry.message as { content?: unknown } | undefined)?.content;
    const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.flatMap((block) => (block?.type === "text" && typeof block.text === "string" ? [block.text] : [])) : [];
    // Claude Code's own notes to Claude, such as a command's output or a reminder, are wrapped in tags.
    const text = texts.join("\n").trim();
    if (!text || (entry.type === "user" && text.startsWith("<"))) continue;
    if (entry.type === "user") {
      preview.prompts += 1;
      preview.lastPrompt = text;
    } else if (entry.type === "assistant") preview.lastReply = text;
  }
  return preview;
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
    const at = savedAt(saved);
    if (saved.type === "assistant") {
      events.push(sdkEvent({ type: "assistant", ...base } as SDKMessage, at));
    } else if (saved.type === "user") {
      const content = field(saved.message, "content");
      const shell = saved.parent_tool_use_id ? null : shellPart(content);
      if (shell?.command !== undefined) {
        events.push({ kind: "shell", id: saved.uuid, command: shell.command, at });
        continue;
      }
      if (shell?.stdout !== undefined) {
        // The output belongs to the command saved just before it. Its exit code isn't saved, and
        // stderr is no sign of failure (git prints its progress there), so only the "Command failed:"
        // Claude Code writes for a command that couldn't run counts as one. One you stopped says so.
        const started = events.findLast((event) => event.kind === "shell");
        const failed = shell.stderr?.startsWith("Command failed:") ?? false;
        const stopped = /^Stopped( by the user)?\.$/.test(shell.stderr?.trim() ?? "");
        const stdout = /^\(\w+ completed with no output\)$/.test(shell.stdout.trim()) ? "" : shell.stdout;
        if (started?.kind === "shell") events.push({ kind: "shell-done", id: started.id, stdout, stderr: stopped ? "" : (shell.stderr ?? ""), code: failed ? 1 : 0, stopped, at });
        continue;
      }
      const typed = saved.parent_tool_use_id ? null : promptText(content);
      events.push(
        typed !== null
          ? { kind: "prompt", text: typed, uuid: saved.uuid, images: promptImages(content, typed), at }
          : sdkEvent({ type: "user", ...base } as SDKMessage, at),
      );
    }
  }
  return events;
}

/** When Claude Code saved a message, in ms. `timestamp` is in what getSessionMessages() returns, but not in the SDK's types. */
function savedAt(saved: SessionMessage) {
  const stamp = field(saved, "timestamp");
  const ms = typeof stamp === "string" ? Date.parse(stamp) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * A command run with `!` is saved as two messages, as Claude Code saves its own: the command in
 * `<bash-input>`, then what it printed in `<bash-stdout>` and `<bash-stderr>`. A command that
 * couldn't run gets only `<bash-stderr>`.
 */
function shellPart(content: unknown) {
  if (typeof content !== "string") return null;
  const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(content)?.[1];
  const command = tag("bash-input");
  if (command !== undefined) return { command };
  const stdout = tag("bash-stdout");
  const stderr = tag("bash-stderr");
  return stdout !== undefined || stderr !== undefined ? { stdout: stdout ?? "", stderr } : null;
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

/**
 * The images a message carried, by the number of the `[Image #n]` each went with: the images in
 * the order they were sent, matched to the labels in the order they first appear, which is the
 * order astrocode sends them in.
 */
function promptImages(content: unknown, text: string): Record<number, ImageAttachment> | undefined {
  const images = imageBlocks(content);
  if (!images.length) return undefined;
  const labels = [...new Set([...text.matchAll(/\[Image #(\d+)\]/g)].map((match) => Number(match[1])))];
  return Object.fromEntries(labels.slice(0, images.length).map((n, i) => [n, images[i]!]));
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
