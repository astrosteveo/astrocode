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
  fromSubagent: boolean;
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

/** A message from Claude Code as an event, with the images its tool results carried. */
export function sdkEvent(message: SDKMessage): SessionEvent {
  if (message.type !== "user" || message.parent_tool_use_id || typeof message.message.content === "string") return { kind: "sdk", message };
  const found = message.message.content.flatMap((block) => {
    if (block.type !== "tool_result") return [];
    const images = imageBlocks(block.content);
    return images.length ? [[block.tool_use_id, images] as const] : [];
  });
  return found.length ? { kind: "sdk", message, images: Object.fromEntries(found) } : { kind: "sdk", message };
}

export type CommandInfo = { name: string; description: string; argumentHint: string };

export type SessionEvent =
  /** Claude Code started: the account, and the models and slash commands it offers. */
  | { kind: "ready"; plan?: string; models: ModelChoice[]; commands: CommandInfo[] }
  /** The slash commands changed, after plugins were reloaded. */
  | { kind: "commands"; commands: CommandInfo[] }
  /**
   * A message you sent. `uuid` is its id in the transcript, which rewinding goes back to. `images`
   * are the images it carried, by the number of the `[Image #n]` each went with.
   */
  | { kind: "prompt"; text: string; uuid?: string; images?: Record<number, ImageAttachment> }
  /** A command you ran with `!`, before and after it finishes. */
  | { kind: "shell"; id: string; command: string }
  | { kind: "shell-done"; id: string; stdout: string; stderr: string; code: number | null }
  /**
   * A message from Claude Code. `images` are what its tool results carried, by tool call id, such
   * as a picture Claude read. The interface keeps a picture per image object, so they're read out
   * of the message once, by `sdkEvent()`, before the event goes anywhere.
   */
  | { kind: "sdk"; message: SDKMessage; images?: Record<string, ImageAttachment[]> }
  | { kind: "permission"; request: PermissionRequest }
  | { kind: "question"; request: QuestionRequest }
  | { kind: "resolved"; id: string; outcome: Decision | "answered" | "cancelled" }
  | { kind: "mode"; mode: PermissionMode }
  | { kind: "model"; model: string }
  | { kind: "effort"; effort: EffortLevel }
  /** Thinking turned on or off. Only reported once astrocode has set it. */
  | { kind: "thinking"; on: boolean }
  | { kind: "context"; percentage: number; tokens: number; max: number }
  | { kind: "notice"; tone: "info" | "error"; text: string };
