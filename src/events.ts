// What the session tells the interface, and the requests that wait on the user.
import type { EffortLevel, PermissionMode, PermissionUpdate, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { field } from "./view/tools";

/** A tool call waiting for the user to allow or deny it. */
export type PermissionRequest = {
  /** The tool call's id, the same as the matching `tool_use` block's id. */
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** A full sentence from Claude Code, such as "Claude wants to read foo.txt". */
  title?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  /** Exactly what "always allow" applies, so the prompt can say what it does. */
  alwaysAllow?: PermissionUpdate[];
  /** Claude Code asks that this prompt not default to approving. */
  defaultToNo?: boolean;
  /** The subagent that asks, by its agent id, which is also its task id. Absent when Claude asks. */
  agentId?: string;
};

export type Decision = "allow" | "always" | "deny";

/** One of Claude's multiple-choice questions, from the AskUserQuestion tool. */
export type Question = {
  question: string;
  /** A short chip, such as "Library". */
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string; preview?: string }[];
};

/** Claude's questions, waiting for answers. */
export type QuestionRequest = { id: string; questions: Question[] };

/** Answers keyed by question text. A multi-select answer is its labels joined with ", ". */
export type Answers = Record<string, string>;

/**
 * One field of an MCP server's form, from its JSON Schema: text, a number, yes or no, one of a list
 * or several of it (`options`, each value with its label). `min` and `max` bound a number, the
 * length of text, or how many are picked; `pattern` and `format` (email, uri, date, date-time)
 * check text.
 */
export type ElicitationField = {
  name: string;
  label: string;
  description?: string;
  type: "string" | "number" | "integer" | "boolean" | "enum" | "multi";
  required: boolean;
  options?: { value: string; label: string }[];
  default?: string | number | boolean | string[];
  min?: number;
  max?: number;
  pattern?: string;
  format?: string;
};

/**
 * An MCP server asking you for something: to fill in a form, or to open an address in the browser,
 * as signing in does.
 */
export type ElicitationRequest = { id: string; server: string; message: string; title?: string; mode: "form" | "url"; url?: string; fields: ElicitationField[] };

/** What you said to an MCP server's request: the form's values when you accept it. */
export type ElicitationAnswer = { action: "accept" | "decline" | "cancel"; content?: Record<string, string | number | boolean | string[]> };

/** The permission modes Shift+Tab steps through, in order. */
export const MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const satisfies readonly PermissionMode[];

/** `efforts` lists the effort levels the model takes, if it takes any. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly EffortLevel[];

export function isEffort(value: string): value is EffortLevel {
  return (EFFORTS as readonly string[]).includes(value);
}

/** `thinkingOff`: thinking can be turned off. Current models always think, and effort sets how much. */
export type ModelChoice = { value: string; name: string; description: string; efforts?: EffortLevel[]; thinkingOff?: boolean };

/** An image going with a message, as an image block takes it. */
export type ImageAttachment = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };

const MEDIA_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"] satisfies ImageAttachment["mediaType"][];

/** The images among a message's or a tool result's content blocks, in order. */
export function imageBlocks(content: unknown): ImageAttachment[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): ImageAttachment[] => {
    const source = field(block, "source");
    const mediaType = field(source, "media_type");
    const data = field(source, "data");
    if (field(block, "type") !== "image" || field(source, "type") !== "base64" || typeof data !== "string") return [];
    return typeof mediaType === "string" && MEDIA_TYPES.includes(mediaType) ? [{ mediaType: mediaType as ImageAttachment["mediaType"], data }] : [];
  });
}

/** A message from Claude Code as an event, with the images its tool results carried. `at` is when it came. */
export function sdkEvent(message: SDKMessage, at?: number): SessionEvent {
  if (message.type !== "user" || message.parent_tool_use_id || typeof message.message.content === "string") return { kind: "sdk", message, at };
  const found = message.message.content.flatMap((block) => {
    if (block.type !== "tool_result") return [];
    const images = imageBlocks(block.content);
    return images.length ? [[block.tool_use_id, images] as const] : [];
  });
  return found.length ? { kind: "sdk", message, at, images: Object.fromEntries(found) } : { kind: "sdk", message, at };
}

export type CommandInfo = { name: string; description: string; argumentHint: string };

/**
 * A file a turn changed, by absolute path, with the lines it added and removed: none for a binary
 * file, or one too big to read (`big`). `status`: it's new, or deleted. `from`: where a file
 * renamed was.
 */
export type FileChange = { path: string; added: number; removed: number; status?: "new" | "deleted"; from?: string; binary?: boolean; big?: boolean };

/** What a diff runs between: two trees, or commits, by id. */
export type Trees = { from: string; to: string };

/**
 * What a turn changed in a git repository: the files that differ between the working tree at its
 * start and at its end, and the commits made on HEAD since it started, oldest first. `unseen`: the
 * files the edit tools changed that git can't see, being ignored or outside the repository.
 * `trees`: the working tree at the turn's edges, which each file's diff runs between.
 */
export type Ledger = { files: FileChange[]; commits: string[]; unseen: string[]; trees?: Trees };

/**
 * Remote Control: the session reachable from claude.ai/code and the Claude app. `url` is the link to
 * it, once Claude Code has said; `detail` says why it failed, or what it's waiting on.
 */
export type RemoteControl = { status: "connecting" | "connected" | "failed"; url?: string; detail?: string };

/**
 * What a Claude Code process runs with: its version, and how many CLAUDE.md files, plugins, MCP
 * servers and skills it loaded. Each is left out when Claude Code can't say.
 */
export type Loaded = { version?: string; claudeMd?: number; plugins?: number; mcpServers?: number; skills?: number };

export type SessionEvent =
  /** Claude Code started: the account, and the models and slash commands it offers. */
  | { kind: "ready"; plan?: string; models: ModelChoice[]; commands: CommandInfo[] }
  /** The slash commands changed, after plugins were reloaded. */
  | { kind: "commands"; commands: CommandInfo[] }
  /** What Claude Code loaded, once it has said. */
  | { kind: "loaded"; loaded: Loaded }
  /**
   * A message you sent. `uuid` is its id in the transcript, which rewinding goes back to. `images`
   * are the images it carried, by the number of the `[Image #n]` each went with. `at` is when it
   * was sent, known for a replayed one. `later`: sent while Claude works, to wait for the turn's end.
   * `remote`: sent from claude.ai or the Claude app over Remote Control, as Claude starts on it.
   * `starts`: it starts a turn, as no turn was under way when it was sent; one sent mid-turn joins it.
   */
  | { kind: "prompt"; text: string; uuid?: string; images?: Record<number, ImageAttachment>; at?: number; later?: boolean; remote?: boolean; starts?: boolean }
  /**
   * A command you ran with `!`: as it starts, what its terminal shows as it runs, and how it ended.
   * `at` is when each happened, from Claude Code's timestamps in a replayed conversation.
   */
  | { kind: "shell"; id: string; command: string; at?: number }
  | { kind: "shell-output"; id: string; output: string; at: number }
  | { kind: "shell-done"; id: string; stdout: string; stderr: string; code: number | null; stopped?: boolean; at?: number }
  /**
   * A message from Claude Code. `images` are what its tool results carried, by tool call id, such
   * as a picture Claude read. The interface keeps a picture per image object, so they're read out
   * of the message once, by `sdkEvent()`, before the event goes anywhere. `at` is when it came,
   * which times tool calls, live or replayed.
   */
  | { kind: "sdk"; message: SDKMessage; images?: Record<string, ImageAttachment[]>; at?: number }
  /** What the turn now ending changed, from git. Sent just before the turn's result, and only in a git repository. */
  | ({ kind: "ledger" } & Ledger)
  | { kind: "permission"; request: PermissionRequest }
  | { kind: "question"; request: QuestionRequest }
  | { kind: "elicitation"; request: ElicitationRequest }
  /** `withdrawn`: Claude Code took it back, as after an interrupt or an answer given over Remote Control. */
  | { kind: "resolved"; id: string; outcome: Decision | "answered" | "cancelled" | "withdrawn" }
  | { kind: "mode"; mode: PermissionMode }
  | { kind: "model"; model: string }
  | { kind: "effort"; effort: EffortLevel }
  /** Thinking turned on or off. Only reported once astrocode has set it. */
  | { kind: "thinking"; on: boolean }
  /** Ultracode turned on or off for the session, by astrocode or by an effort change that ends it. */
  | { kind: "ultracode"; on: boolean }
  /** Fast mode turned on or off by astrocode, until Claude Code next reports it. */
  | { kind: "fast"; on: boolean }
  /** Whether ultracode can be turned on: dynamic workflows are on and the model takes it. Unknown until Claude Code says. */
  | { kind: "ultracode-available"; available: boolean }
  | { kind: "context"; percentage: number; tokens: number; max: number }
  /** A keep-warm request read the conversation's prompt cache at `at`, so it's warm for its TTL from then. */
  | { kind: "cache-warmed"; at: number }
  /** Remote Control as it is now, or null once it's off. */
  | { kind: "remote"; remote: RemoteControl | null }
  | { kind: "notice"; tone: NoticeTone; text: string };

/** How a notice reads: by the way, a warning (ember), or a failure (rose). */
export type NoticeTone = "info" | "warning" | "error";
