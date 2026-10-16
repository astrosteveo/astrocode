// What the server and the page say to each other over the WebSocket.
// The page imports these as types only, so none of the SDK ends up in the browser bundle.
import type { PermissionMode, PermissionUpdate, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

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
  /** Exactly what "always allow" applies, so the button can say what it does. */
  alwaysAllow?: PermissionUpdate[];
  /** Claude Code asks that this prompt not default to approving. */
  defaultToNo?: boolean;
  fromSubagent: boolean;
};

export type Decision = "allow" | "always" | "deny";

/** The permission modes the page offers. */
export const MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const satisfies readonly PermissionMode[];
export type Mode = (typeof MODES)[number];

/** Everything the server logs and broadcasts. A page that connects later gets the whole log replayed. */
export type ServerEvent =
  | { kind: "hello"; cwd: string; home: string }
  | { kind: "account"; subscriptionType?: string; apiKeySource?: string; apiProvider?: string }
  | { kind: "prompt"; text: string }
  | { kind: "sdk"; message: SDKMessage }
  | { kind: "permission"; request: PermissionRequest }
  | { kind: "permission_resolved"; id: string; decision: Decision | "cancelled" }
  | { kind: "mode"; mode: PermissionMode }
  | { kind: "notice"; tone: "info" | "error"; text: string };

/** Frames that are sent but never logged. */
export type ServerFrame = ServerEvent | { kind: "replay"; events: ServerEvent[] } | { kind: "reset" };

export type ClientEvent =
  | { kind: "prompt"; text: string }
  | { kind: "decide"; id: string; decision: Decision }
  | { kind: "interrupt" }
  | { kind: "mode"; mode: Mode }
  | { kind: "new_session" };
