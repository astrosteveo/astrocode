// What you've sent, kept with Claude Code's, so ↑ and Ctrl+R go through the same messages in
// `claude` and in astrocode. It's Claude Code's `history.jsonl`, in `$CLAUDE_CONFIG_DIR` or
// `~/.claude`, one line per message: `display`, the message as typed; `pastedContents`, the text
// each `[Pasted text #n]` in it stands for, inline or by hash in `paste-cache/`; `timestamp` in
// ms; `project`, the folder; and `sessionId`. astrocode puts what you paste in the message itself,
// so the lines it adds have no pastedContents.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** A message, with the text its placeholders stand for back in their place. */
type SavedPrompt = { text: string; timestamp: number; project: string; sessionId?: string };

/** How many of a folder's messages ↑ goes back through, as in Claude Code. */
const RECALL_LIMIT = 100;

/** Claude Code's placeholders for pasted text. `[Image #n]` stays as it is: its history keeps no images. */
const PLACEHOLDER = /\[(?:Pasted text|\.\.\.Truncated text|✦ Team setup guide) #(\d+)(?: \+\d+ lines)?\.*\]/g;

/** Claude Code's folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function historyFile() {
  return join(configDir(), "history.jsonl");
}

/**
 * The messages ↑ and Ctrl+R go through: Claude Code's file as last read, and what's been sent from
 * here, which stays even if it couldn't be written. One for all of astrocode's conversations, as
 * Claude Code has one for all its sessions.
 */
export class PromptHistory {
  private saved: SavedPrompt[] = [];
  private sent: SavedPrompt[] = [];
  private all: SavedPrompt[] = [];
  private texts: string[] = [];
  /** Lines are written one after another, so they land in the order the messages were sent. */
  private writing = Promise.resolve();

  /** Reads Claude Code's file again, with what's been sent in `claude` meanwhile. */
  async load() {
    this.saved = await readPrompts();
    this.merge();
  }

  /**
   * Keeps a message for ↑ and Ctrl+R, and adds it to Claude Code's file unless
   * CLAUDE_CODE_SKIP_PROMPT_HISTORY is set. As in Claude Code, the same message again straight
   * after itself in a session is kept once, and each one gets a time of its own.
   */
  add(text: string, project: string, sessionId?: string): Promise<void> {
    const last = this.sent.at(-1);
    if (last && last.text === text && last.project === project && last.sessionId === sessionId) return this.writing;
    const prompt = { text, timestamp: Math.max(Date.now(), (last?.timestamp ?? 0) + 1), project, sessionId };
    this.sent.push(prompt);
    this.merge();
    if (/^(1|true|yes|on)$/i.test(process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY?.trim() ?? "")) return this.writing;
    // Read again once it's written, which brings in what `claude` has added since.
    this.writing = this.writing
      .then(() => append(prompt))
      .then(() => this.load())
      .catch(() => {});
    return this.writing;
  }

  /** ↑'s messages in a folder, oldest first: its newest hundred, with this session's nearest, as in Claude Code. */
  recall(project: string, sessionId?: string): string[] {
    const here = this.all.filter((prompt) => prompt.project === project).slice(-RECALL_LIMIT);
    const current = (prompt: SavedPrompt) => sessionId !== undefined && prompt.sessionId === sessionId;
    return [...here.filter((prompt) => !current(prompt)), ...here.filter(current)].map((prompt) => prompt.text);
  }

  /** Ctrl+R's messages, oldest first: every folder's, as Claude Code searches them. */
  everything(): string[] {
    return this.texts;
  }

  /** The file's lines in its order, then what's been sent from here that isn't in it yet. */
  private merge() {
    const key = (prompt: SavedPrompt) => `${prompt.timestamp}\0${prompt.sessionId ?? ""}`;
    const written = new Set(this.saved.map(key));
    this.all = [...this.saved, ...this.sent.filter((prompt) => !written.has(key(prompt)))];
    this.texts = this.all.map((prompt) => prompt.text);
  }
}

/** Every message in Claude Code's file, oldest first. Lines not in its shape are skipped, as it skips them. */
async function readPrompts(): Promise<SavedPrompt[]> {
  let raw: string;
  try {
    raw = await readFile(historyFile(), "utf8");
  } catch {
    return [];
  }
  const prompts: SavedPrompt[] = [];
  for (const line of raw.split("\n")) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const { display, pastedContents, timestamp, project, sessionId } = entry ?? {};
    if (typeof display !== "string" || typeof timestamp !== "number" || typeof project !== "string") continue;
    const pasted = typeof pastedContents === "object" && pastedContents !== null ? (pastedContents as Record<string, unknown>) : {};
    prompts.push({ text: await expand(display, pasted), timestamp, project, sessionId: typeof sessionId === "string" ? sessionId : undefined });
  }
  return prompts;
}

/** The message with the text each placeholder stands for in its place, where that text can still be found. */
async function expand(display: string, pasted: Record<string, unknown>) {
  const texts = new Map<string, string>();
  for (const [, id] of display.matchAll(PLACEHOLDER)) {
    const text = await pastedText(pasted[id!]);
    if (text !== null) texts.set(id!, text);
  }
  return display.replace(PLACEHOLDER, (placeholder, id: string) => texts.get(id) ?? placeholder);
}

async function pastedText(record: unknown): Promise<string | null> {
  if (typeof record !== "object" || record === null) return null;
  const { type, content, contentHash } = record as Record<string, unknown>;
  if (type !== "text") return null;
  if (typeof content === "string") return content;
  // A long paste is kept in a file named by the start of its SHA-256. Only such a name is read,
  // so a line can't point anywhere else.
  if (typeof contentHash !== "string" || !/^[0-9a-f]{16}$/.test(contentHash)) return null;
  return readFile(join(configDir(), "paste-cache", `${contentHash}.txt`), "utf8").catch(() => null);
}

/** A line in Claude Code's file, with its fields in its order. Only you can read the file, as Claude Code makes it. */
async function append({ text, timestamp, project, sessionId }: SavedPrompt) {
  const file = historyFile();
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify({ display: text, pastedContents: {}, timestamp, project, sessionId })}\n`, { mode: 0o600 });
}
