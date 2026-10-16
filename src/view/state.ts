// Folds the session's events into what the terminal shows. A pure reducer: replaying a saved
// conversation's events draws it the same way it was drawn live.
import type {
  EffortLevel,
  PermissionMode,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CommandInfo, ModelChoice, PermissionRequest, QuestionRequest, SessionEvent } from "../events";

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
  /** `uuid` is the message's id in the transcript, where rewinding goes back to. */
  | { kind: "prompt"; key: string; text: string; uuid?: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool"; key: string; call: ToolCall }
  | {
      kind: "turn";
      key: string;
      outcome: "finished" | "stopped" | "failed";
      durationMs: number;
      tokens: number;
      detail?: string;
      /** The end of a turn from a saved conversation, which doesn't record how long it took. */
      replayed?: boolean;
    }
  | { kind: "notice"; key: string; tone: "info" | "error"; text: string }
  /** A command you ran with `!`. */
  | { kind: "shell"; key: string; id: string; command: string; status: "running" | "done" | "error"; stdout: string; stderr: string }
  /** A tool call's whole output, printed on request. */
  | { kind: "output"; key: string; call: ToolCall };

type NewItem = Item extends infer I ? (I extends Item ? Omit<I, "key"> : never) : never;

/** A block of the message Claude is writing right now, built from stream deltas. */
export type LiveBlock = { kind: "text" | "thinking" | "tool" | "other"; text: string; name?: string };

/** Blocks before `finalized` have arrived as complete messages and are shown from `items` instead. */
export type Live = { messageId: string; blocks: LiveBlock[]; finalized: number };

/** Work Claude Code runs in the background, such as a command or a subagent moved there with Ctrl+B. */
export type BackgroundTask = { id: string; description: string; type: string };

/** A plan usage window, from Claude Code's rate-limit events. `utilization` is 0 to 1. */
export type UsageWindow = { utilization: number; resetsAt: number };

export type State = {
  cwd: string;
  home: string;
  model?: string;
  effort?: EffortLevel;
  /** False once thinking is turned off; unknown means Claude Code's default, which thinks. */
  thinking?: boolean;
  plan?: string;
  models: ModelChoice[];
  commands: CommandInfo[];
  mode: PermissionMode;
  context?: { percentage: number; tokens: number; max: number };
  limits: { fiveHour?: UsageWindow; sevenDay?: UsageWindow };
  /** What runs in the background right now. */
  tasks: BackgroundTask[];
  items: Item[];
  /** Tool call id to its index in `items`. */
  tools: Record<string, number>;
  live: Live | null;
  pending: PermissionRequest[];
  questions: QuestionRequest[];
  busy: boolean;
  /** Output tokens of this turn's finished messages. */
  turnTokens: number;
  seq: number;
};

/** Events the terminal adds of its own, beside the session's. */
export type ViewEvent =
  | SessionEvent
  /** A saved conversation, replayed when resuming it. */
  | { kind: "history"; events: SessionEvent[]; title?: string; notice?: string }
  /** Print a tool call's whole output into the transcript. */
  | { kind: "output"; id: string };

export function initialState(cwd: string, home: string): State {
  return {
    cwd,
    home,
    models: [],
    commands: [],
    mode: "default",
    limits: {},
    tasks: [],
    items: [],
    tools: {},
    live: null,
    pending: [],
    questions: [],
    busy: false,
    turnTokens: 0,
    seq: 0,
  };
}

export function reduce(state: State, event: ViewEvent): State {
  switch (event.kind) {
    case "ready":
      // A new Claude Code process, with nothing in the background yet.
      return { ...state, plan: event.plan, models: event.models, commands: event.commands, tasks: [] };
    case "commands":
      return { ...state, commands: event.commands };
    case "prompt":
      return { ...add(state, { kind: "prompt", text: event.text, uuid: event.uuid }), busy: true };
    case "shell":
      return add(state, { kind: "shell", id: event.id, command: event.command, status: "running", stdout: "", stderr: "" });
    case "shell-done": {
      const index = state.items.findIndex((item) => item.kind === "shell" && item.id === event.id);
      const item = state.items[index];
      if (item?.kind !== "shell") return state;
      const items = state.items.slice();
      items[index] = { ...item, status: event.code === 0 ? "done" : "error", stdout: event.stdout, stderr: event.stderr };
      return { ...state, items };
    }
    case "sdk":
      return applySdk(state, event.message);
    case "permission":
      return { ...state, pending: [...state.pending.filter((p) => p.id !== event.request.id), event.request] };
    case "question":
      return { ...state, questions: [...state.questions.filter((q) => q.id !== event.request.id), event.request] };
    case "resolved": {
      const next = {
        ...state,
        pending: state.pending.filter((p) => p.id !== event.id),
        questions: state.questions.filter((q) => q.id !== event.id),
      };
      if (event.outcome === "deny") return updateTool(next, event.id, () => ({ status: "denied" }));
      if (event.outcome === "cancelled") return updateTool(next, event.id, () => ({ status: "stopped" }));
      return next;
    }
    case "mode":
      return { ...state, mode: event.mode };
    case "model":
      return { ...state, model: event.model };
    case "effort":
      return { ...state, effort: event.effort };
    case "thinking":
      return { ...state, thinking: event.on };
    case "context":
      return { ...state, context: { percentage: event.percentage, tokens: event.tokens, max: event.max } };
    case "notice":
      return add(state, { kind: "notice", tone: event.tone, text: event.text });
    case "history": {
      const replayed = closeTurns(event.events.reduce(reduce, state), state.items.length);
      const settled = { ...stopRunningTools(replayed), busy: false, live: null, turnTokens: 0 };
      const count = settled.items.length - state.items.length;
      if (event.notice) return add(settled, { kind: "notice", tone: "info", text: event.notice });
      if (count === 0) return add(settled, { kind: "notice", tone: "info", text: "Resumed a session with nothing to show yet." });
      return add(settled, { kind: "notice", tone: "info", text: `Resumed ${event.title ? `“${event.title}”` : "the session"} above.` });
    }
    case "output": {
      const index = state.tools[event.id];
      const item = index === undefined ? undefined : state.items[index];
      return item?.kind === "tool" ? add(state, { kind: "output", call: item.call }) : state;
    }
  }
}

function applySdk(state: State, message: SDKMessage): State {
  switch (message.type) {
    case "system":
      switch (message.subtype) {
        case "init":
          return { ...state, model: state.model ?? message.model, mode: message.permissionMode };
        case "background_tasks_changed":
          return {
            ...state,
            tasks: message.tasks
              .filter((task) => !task.ambient)
              .map((task) => ({ id: task.task_id, description: task.description, type: task.task_type })),
          };
        case "task_notification": {
          // Only work that ran in the background: a subagent Claude waited on reports back as its tool call.
          const task = state.tasks.find((one) => one.id === message.task_id);
          if (!task || message.skip_transcript) return state;
          const how = { completed: "finished", failed: "failed", stopped: "stopped" }[message.status];
          return add(state, { kind: "notice", tone: message.status === "failed" ? "error" : "info", text: `Background task ${how}: ${task.description}` });
        }
        case "status":
          return message.permissionMode ? { ...state, mode: message.permissionMode } : state;
        case "compact_boundary":
          return add(state, { kind: "notice", tone: "info", text: "Claude compacted the earlier conversation to free up context." });
        case "local_command_output":
          return add(state, { kind: "notice", tone: "info", text: message.content });
        default:
          return state;
      }
    case "rate_limit_event":
      return { ...state, limits: usageWindows(message.rate_limit_info, state.limits) };
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

/** Claude Code's plan windows. `unifiedWindows` isn't in the SDK's types yet, so it's read with care. */
function usageWindows(info: unknown, previous: State["limits"]): State["limits"] {
  const windows = field(info, "unifiedWindows");
  const read = (key: string): UsageWindow | undefined => {
    const window = field(windows, key);
    const utilization = field(window, "utilization");
    const resetsAt = field(window, "resetsAt");
    return typeof utilization === "number" && typeof resetsAt === "number" ? { utilization, resetsAt } : undefined;
  };
  return { fiveHour: read("five_hour") ?? previous.fiveHour, sevenDay: read("seven_day") ?? previous.sevenDay };
}

function applyStream(state: State, event: StreamEvent): State {
  switch (event.type) {
    case "message_start":
      return { ...state, live: { messageId: event.message.id, blocks: [], finalized: 0 } };
    case "message_delta":
      return { ...state, turnTokens: state.turnTokens + (event.usage.output_tokens ?? 0) };
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
    // A saved conversation has no record of the prompt, only Claude Code's note that it was refused.
    const refused = block.is_error === true && result.startsWith("The user doesn't want to proceed with this tool use");
    next = updateTool(next, block.tool_use_id, (call) => ({
      result,
      output,
      status: call.status === "denied" || call.status === "stopped" ? call.status : refused ? "denied" : block.is_error ? "error" : "done",
    }));
  }
  return next;
}

function applyResult(state: State, message: SDKResultMessage): State {
  // Claude Code answers a message that doesn't start a turn, such as a `!` command's, with a result of no turns.
  if (!state.busy && message.num_turns === 0) return state;
  const settled = { ...stopRunningTools(state), busy: false, live: null, turnTokens: 0 };
  const turn = { kind: "turn" as const, durationMs: message.duration_ms, tokens: state.turnTokens };
  // Stop, Esc and Deny all end the turn early. The SDK reports that as an error, but it isn't one.
  if (message.terminal_reason === "aborted_streaming" || message.terminal_reason === "aborted_tools") {
    return add(settled, { ...turn, outcome: "stopped" });
  }
  if (message.subtype === "success") {
    return add(settled, { ...turn, outcome: message.is_error ? "failed" : "finished", detail: message.is_error ? message.result : undefined });
  }
  return add(settled, {
    ...turn,
    outcome: "failed",
    detail: message.errors.filter((error) => !error.startsWith("[ede_diagnostic]")).join("\n") || undefined,
  });
}

/**
 * A saved conversation doesn't record where its turns ended, so each replayed turn ends where the
 * next prompt starts, and the last one at the end. Items from `from` on are the replayed ones.
 */
function closeTurns(state: State, from: number): State {
  let seq = state.seq;
  const items = state.items.slice(0, from);
  let open = false;
  const close = () => {
    if (open) items.push({ kind: "turn", key: `i${seq++}`, outcome: "finished", durationMs: 0, tokens: 0, replayed: true });
    open = false;
  };
  for (const item of state.items.slice(from)) {
    if (item.kind === "prompt") {
      close();
      open = true;
    } else if (item.kind === "turn") open = false;
    items.push(item);
  }
  close();
  const tools: Record<string, number> = {};
  items.forEach((item, index) => {
    if (item.kind === "tool") tools[item.call.id] = index;
  });
  return { ...state, items, tools, seq };
}

/** Whatever was still running when a turn ended won't report back. */
function stopRunningTools(state: State): State {
  const items = state.items.map((item) =>
    item.kind === "tool" && item.call.status === "running" ? { ...item, call: { ...item.call, status: "stopped" as const } } : item,
  );
  return { ...state, items };
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

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
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
