// Turns the server's event log into what the page shows. It's a pure reducer, so a page
// that reconnects gets the same view by replaying the log from the start.
import type {
  PermissionMode,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest, ServerEvent } from "../protocol";

type StreamEvent = SDKPartialAssistantMessage["event"];
type AssistantBlock = SDKAssistantMessage["message"]["content"][number];
type UserMessage = Extract<SDKMessage, { type: "user" }>;

export type ToolStatus = "running" | "done" | "error" | "denied" | "stopped";

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: ToolStatus;
  result?: string;
  /** Claude Code's structured result (`tool_use_result`), such as Bash's stdout or Read's line count. */
  output?: unknown;
  /** Tool calls a subagent made under this call. */
  subagentCalls: number;
};

export type Item =
  | { kind: "prompt"; key: string; text: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; call: ToolCall }
  | { kind: "turn"; key: string; outcome: "finished" | "stopped" | "failed"; durationMs: number; detail?: string }
  | { kind: "notice"; key: string; tone: "info" | "error"; text: string };

type NewItem = Item extends infer I ? (I extends Item ? Omit<I, "key"> : never) : never;

/** A block of the message Claude is writing right now, built from stream deltas. */
export type LiveBlock = { kind: "text" | "thinking" | "tool" | "other"; text: string; name?: string };

/** Blocks before `finalized` have arrived as complete messages and are shown from `items` instead. */
export type Live = { messageId: string; blocks: LiveBlock[]; finalized: number };

export type State = {
  connected: boolean;
  cwd: string;
  home: string;
  model?: string;
  plan?: string;
  mode: PermissionMode;
  items: Item[];
  /** Tool call id to its index in `items`. */
  tools: Record<string, number>;
  live: Live | null;
  pending: PermissionRequest[];
  busy: boolean;
  seq: number;
};

export const initialState: State = {
  connected: false,
  cwd: "",
  home: "",
  mode: "default",
  items: [],
  tools: {},
  live: null,
  pending: [],
  busy: false,
  seq: 0,
};

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "replay"; events: ServerEvent[] }
  | { type: "reset" }
  | { type: "event"; event: ServerEvent };

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "connected":
      return { ...state, connected: action.connected };
    case "replay":
      return action.events.reduce(apply, { ...initialState, connected: state.connected });
    case "reset":
      return { ...initialState, connected: state.connected };
    case "event":
      return apply(state, action.event);
  }
}

function apply(state: State, event: ServerEvent): State {
  switch (event.kind) {
    case "hello":
      return { ...state, cwd: event.cwd, home: event.home };
    case "account":
      return { ...state, plan: planLabel(event) };
    case "prompt":
      return { ...add(state, { kind: "prompt", text: event.text }), busy: true };
    case "sdk":
      return applySdk(state, event.message);
    case "permission":
      return { ...state, pending: [...state.pending.filter((p) => p.id !== event.request.id), event.request] };
    case "permission_resolved": {
      const next = { ...state, pending: state.pending.filter((p) => p.id !== event.id) };
      if (event.decision === "deny") return updateTool(next, event.id, () => ({ status: "denied" }));
      if (event.decision === "cancelled") return updateTool(next, event.id, () => ({ status: "stopped" }));
      return next;
    }
    case "mode":
      return { ...state, mode: event.mode };
    case "notice":
      return add(state, { kind: "notice", tone: event.tone, text: event.text });
  }
}

function applySdk(state: State, message: SDKMessage): State {
  switch (message.type) {
    case "system":
      switch (message.subtype) {
        case "init":
          return { ...state, model: message.model, mode: message.permissionMode };
        case "status":
          return message.permissionMode ? { ...state, mode: message.permissionMode } : state;
        case "compact_boundary":
          return add(state, { kind: "notice", tone: "info", text: "Claude compacted the earlier conversation to free up context." });
        case "local_command_output":
          return add(state, { kind: "notice", tone: "info", text: message.content });
        default:
          return state;
      }
    case "stream_event":
      return message.parent_tool_use_id ? state : applyStream({ ...state, busy: true }, message.event);
    case "assistant":
      return applyAssistant({ ...state, busy: true }, message);
    case "user":
      return applyUser(state, message);
    case "result":
      return applyResult(state, message);
    default:
      return state;
  }
}

function applyStream(state: State, event: StreamEvent): State {
  switch (event.type) {
    case "message_start":
      return { ...state, live: { messageId: event.message.id, blocks: [], finalized: 0 } };
    case "content_block_start": {
      if (!state.live) return state;
      const block = event.content_block;
      const blocks = state.live.blocks.slice();
      blocks[event.index] =
        block.type === "text"
          ? { kind: "text", text: block.text }
          : block.type === "thinking"
            ? { kind: "thinking", text: block.thinking }
            : block.type === "tool_use"
              ? { kind: "tool", text: "", name: block.name }
              : { kind: "other", text: "" };
      return { ...state, live: { ...state.live, blocks } };
    }
    case "content_block_delta": {
      const current = state.live?.blocks[event.index];
      if (!state.live || !current) return state;
      const delta = event.delta;
      const text =
        delta.type === "text_delta"
          ? delta.text
          : delta.type === "thinking_delta"
            ? delta.thinking
            : delta.type === "input_json_delta"
              ? delta.partial_json
              : "";
      if (!text) return state;
      const blocks = state.live.blocks.slice();
      blocks[event.index] = { ...current, text: current.text + text };
      return { ...state, live: { ...state.live, blocks } };
    }
    default:
      return state;
  }
}

function applyAssistant(state: State, message: SDKAssistantMessage): State {
  const content = message.message.content;
  if (message.parent_tool_use_id) {
    const calls = content.filter((block) => block.type === "tool_use").length;
    return calls ? updateTool(state, message.parent_tool_use_id, (call) => ({ subagentCalls: call.subagentCalls + calls })) : state;
  }
  let next = state;
  if (message.error && !content.some((block) => block.type === "text")) {
    next = add(next, { kind: "notice", tone: "error", text: errorText(message.error) });
  }
  for (const block of content) {
    next = finalizeLive(next, message.message.id, block);
    if (block.type === "text" && block.text.trim()) {
      next = add(next, { kind: "text", text: block.text });
    } else if (block.type === "thinking" && block.thinking.trim()) {
      next = add(next, { kind: "thinking", text: block.thinking });
    } else if (block.type === "tool_use") {
      next = addTool(next, { id: block.id, name: block.name, input: asRecord(block.input), status: "running", subagentCalls: 0 });
    }
  }
  return next;
}

/** Marks the live block that `block` completes, so it isn't drawn twice. */
function finalizeLive(state: State, messageId: string, block: AssistantBlock): State {
  const live = state.live;
  if (!live) return state;
  if (live.messageId !== messageId) return { ...state, live: null };
  const kind = block.type === "text" ? "text" : block.type === "thinking" ? "thinking" : block.type === "tool_use" ? "tool" : "other";
  let finalized = live.finalized;
  while (finalized < live.blocks.length) {
    const candidate = live.blocks[finalized];
    finalized += 1;
    if (candidate?.kind === kind) break;
  }
  return { ...state, live: { ...live, finalized } };
}

function applyUser(state: State, message: UserMessage): State {
  const content = message.message.content;
  if (message.parent_tool_use_id || typeof content === "string") return state;
  const results = content.filter((block) => block.type === "tool_result");
  // The structured output belongs to the message's tool result, so it's only clear when there's one.
  const output = results.length === 1 && "tool_use_result" in message ? message.tool_use_result : undefined;
  let next = state;
  for (const block of results) {
    const result = resultText(block.content);
    next = updateTool(next, block.tool_use_id, (call) => ({
      result,
      output,
      status: call.status === "denied" || call.status === "stopped" ? call.status : block.is_error ? "error" : "done",
    }));
  }
  return next;
}

function applyResult(state: State, message: SDKResultMessage): State {
  // Whatever was still running when the turn ended won't report back.
  const items = state.items.map((item) =>
    item.kind === "tool" && item.call.status === "running" ? { ...item, call: { ...item.call, status: "stopped" as const } } : item,
  );
  const settled = { ...state, items, busy: false, live: null };
  // Stop, Esc and Deny all end the turn early. The SDK reports that as an error, but it isn't one.
  if (message.terminal_reason === "aborted_streaming" || message.terminal_reason === "aborted_tools") {
    return add(settled, { kind: "turn", outcome: "stopped", durationMs: message.duration_ms });
  }
  if (message.subtype === "success") {
    return add(settled, {
      kind: "turn",
      outcome: message.is_error ? "failed" : "finished",
      durationMs: message.duration_ms,
      detail: message.is_error ? message.result : undefined,
    });
  }
  return add(settled, {
    kind: "turn",
    outcome: "failed",
    durationMs: message.duration_ms,
    detail: message.errors.filter((error) => !error.startsWith("[ede_diagnostic]")).join("\n") || undefined,
  });
}

function add(state: State, item: NewItem): State {
  return { ...state, seq: state.seq + 1, items: [...state.items, { ...item, key: `i${state.seq}` } as Item] };
}

function addTool(state: State, call: ToolCall): State {
  const next = add(state, { kind: "tool", call });
  return { ...next, tools: { ...next.tools, [call.id]: next.items.length - 1 } };
}

function updateTool(state: State, id: string, patch: (call: ToolCall) => Partial<ToolCall>): State {
  const index = state.tools[id];
  const item = index === undefined ? undefined : state.items[index];
  if (index === undefined || item?.kind !== "tool") return state;
  const items = state.items.slice();
  items[index] = { ...item, call: { ...item.call, ...patch(item.call) } };
  return { ...state, items };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = asRecord(part);
      if (typeof block.text === "string") return block.text;
      return block.type === "image" ? "[image]" : "";
    })
    .filter(Boolean)
    .join("\n");
}

function planLabel(account: Extract<ServerEvent, { kind: "account" }>) {
  if (account.apiProvider && account.apiProvider !== "firstParty") return account.apiProvider;
  if (account.apiKeySource && account.apiKeySource !== "none") return "API key";
  // Claude Code reports this as a display name already, such as "Claude Max".
  return account.subscriptionType;
}

const ERRORS: Record<string, string> = {
  authentication_failed: "Claude Code isn't signed in. Run claude and use /login, then start a new session.",
  rate_limit: "You've hit your plan's usage limit for now.",
  overloaded: "Claude is overloaded right now. Try again in a moment.",
  billing_error: "There's a billing problem with this account.",
  model_not_found: "That model isn't available to this account.",
};

function errorText(code: string) {
  return ERRORS[code] ?? `Claude Code reported an error: ${code}.`;
}
