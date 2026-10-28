// Folds the session's events into what the terminal shows. A pure reducer: replaying a saved
// conversation's events draws it the same way it was drawn live.
import type {
  EffortLevel,
  FastModeDisabledReason,
  FastModeState,
  PermissionMode,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CommandInfo, ElicitationRequest, ImageAttachment, ModelChoice, NoticeTone, PermissionRequest, QuestionRequest, RemoteControl, SessionEvent } from "../events";
import { compact, duration } from "./format";

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
  /** The images the result carried, such as a picture Claude read. */
  images?: ImageAttachment[];
  /** Tool calls a subagent made under this call. */
  subagentCalls: number;
  /** For an Agent call: what its subagent is doing as it runs, and the subagents it started. */
  subagent?: Subagent;
  /** When the call came and when its result did, in ms. A saved conversation doesn't say. */
  startedAt?: number;
  endedAt?: number;
  /** Seconds it has run, as Claude Code reports while it runs. */
  elapsed?: number;
  /**
   * Work running in the background, started there or moved there with Ctrl+B, and how it ended: a
   * command, a subagent, a Monitor or a workflow. A saved conversation doesn't say how it went,
   * only that it went there: `unknown`.
   */
  background?: "running" | "completed" | "failed" | "stopped" | "unknown";
  /** The task the call started in the background, to open in the task view. */
  taskId?: string;
  /** Who said no without asking you, such as auto mode's classifier or a rule. */
  deniedBy?: string;
};

/** A tool call a subagent made, the latest of its calls Claude Code has reported. */
export type SubagentCall = { id: string; name: string; input: Record<string, unknown> };

/**
 * A subagent started by another subagent, at any depth under an Agent call of Claude's: `depth` 1
 * for one the call's own subagent started. Kept on that call, after the agent that started it.
 */
export type NestedAgent = {
  /** The Agent call that started it. */
  id: string;
  depth: number;
  description: string;
  type?: string;
  calls: number;
  /**
   * Claude Code forwards only the calls of the subagent Claude started, so for one nested deeper
   * there's only the name of its latest tool, from its task's progress.
   */
  last?: SubagentCall;
  lastTool?: string;
  status: "running" | "done" | "error";
};

/**
 * What an Agent call's subagent is doing: its latest call, the subagents it started, and the call
 * of any of them that waits on a permission prompt.
 */
export type Subagent = { last?: SubagentCall; nested: NestedAgent[]; waitingOn?: string };

/**
 * A command you ran with `!`. `stdout` is what its terminal shows, as it runs and once it's done.
 * The times are when it started, last reported and ended, where known. `background`: something
 * came after it while it ran, so its card stopped being the newest thing in the transcript.
 */
export type ShellItem = {
  kind: "shell";
  key: string;
  id: string;
  command: string;
  status: "running" | "done" | "error" | "stopped";
  stdout: string;
  stderr: string;
  code?: number | null;
  startedAt?: number;
  at?: number;
  endedAt?: number;
  background?: boolean;
};

export type Item =
  /**
   * `uuid` is the message's id in the transcript, where rewinding goes back to. `images` go by their
   * `[Image #n]`. `at` is when it was sent or written, where known, which times a replayed turn.
   */
  | { kind: "prompt"; key: string; text: string; uuid?: string; images?: Record<number, ImageAttachment>; at?: number; remote?: boolean }
  | { kind: "text"; key: string; text: string; at?: number }
  | { kind: "thinking"; key: string; text: string; at?: number }
  | { kind: "tool"; key: string; call: ToolCall }
  | {
      kind: "turn";
      key: string;
      outcome: "finished" | "stopped" | "failed";
      durationMs: number;
      tokens: number;
      detail?: string;
      /**
       * The end of a turn from a saved conversation, which records when its messages were saved but
       * not the turn's tokens. `durationMs` is from your message to the last thing saved in the turn.
       */
      replayed?: boolean;
      /** The files the turn's edits and writes changed, and the commands Claude ran, in order. */
      files?: string[];
      commands?: string[];
    }
  /**
   * `of`: the tool call a line of progress is about, which the next line for it replaces.
   * `explains`: it says why Claude may start a turn by itself next, as a background task's end does.
   */
  | { kind: "notice"; key: string; tone: NoticeTone; text: string; of?: string; explains?: boolean }
  | ShellItem
  /** A tool call's or a `!` command's whole output, printed on request. */
  | { kind: "output"; key: string; of: ToolItem | ShellItem };

export type ToolItem = Extract<Item, { kind: "tool" }>;

/** A message sent while Claude works, waiting in Claude Code's queue until Claude takes it. `later`: after the turn ends. */
export type Queued = { text: string; uuid: string; images?: Record<number, ImageAttachment>; at?: number; later?: boolean };

type NewItem = Item extends infer I ? (I extends Item ? Omit<I, "key"> : never) : never;

/** A block of the message Claude is writing right now, built from stream deltas. */
export type LiveBlock = { kind: "text" | "thinking" | "tool" | "other"; text: string; name?: string };

/** Blocks before `finalized` have arrived as complete messages and are shown from `items` instead. */
export type Live = { messageId: string; blocks: LiveBlock[]; finalized: number };

/** Work Claude Code runs in the background, such as a command or a subagent moved there with Ctrl+B. */
export type BackgroundTask = { id: string; description: string; type: string };

/**
 * What's known about a task of Claude Code's, running or ended: the tool call that started it, its
 * progress and how it ended. `background`: it ran in the background, not as a call Claude waited on.
 * A subagent's task id is its agent id, which names its transcript.
 */
export type TaskInfo = {
  id: string;
  description: string;
  type: string;
  toolUseId?: string;
  background: boolean;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt?: number;
  endedAt?: number;
  /** A line on what it's doing, or what it did once it ended. */
  summary?: string;
  lastTool?: string;
  tokens?: number;
  toolUses?: number;
  /** A workflow's name, from its script. */
  workflowName?: string;
  /** A workflow's phases and agents, as its last progress report had them. */
  workflow?: WorkflowPhase[];
};

/** One phase of a workflow and the agents it ran or is running. */
export type WorkflowPhase = { title: string; agents: WorkflowAgent[] };

/** `state`: queued, running, done or failed, as Claude Code says it. */
export type WorkflowAgent = { label: string; state: string; lastTool?: string; tokens?: number; toolCalls?: number; error?: string };

/** An API request that failed and will be tried again: which attempt is next, and when. */
export type Retry = { attempt: number; max: number; at: number; delayMs: number; status: number | null; error: string };

/** A plan usage window, from Claude Code's rate-limit events. `utilization` is 0 to 1. */
export type UsageWindow = { utilization: number; resetsAt: number };

/**
 * The conversation's prompt cache: when a request last read or wrote it, which keeps it for `ttl`
 * ms from then, and when Claude last answered you, as opposed to a keep-warm request.
 */
export type Cache = { at: number; ttl: number; workedAt: number };

/** Claude Code's cache TTL on a subscription within its limits, until a response says otherwise. */
const CACHE_TTL = 60 * 60_000;

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
  /** Unknown until Claude answers, live or in a replay. */
  cache?: Cache;
  /** What runs in the background right now. */
  tasks: BackgroundTask[];
  /** This Claude Code process's tasks, running or ended, by id. */
  taskInfo: Record<string, TaskInfo>;
  items: Item[];
  /**
   * Messages sent while Claude works that it hasn't taken yet, oldest first. Each goes into `items`
   * when Claude Code says it started on it, which is where Claude read it, and leaves when it's
   * taken back to edit.
   */
  queue: Queued[];
  /** Tool call id to its index in `items`. */
  tools: Record<string, number>;
  live: Live | null;
  pending: PermissionRequest[];
  questions: QuestionRequest[];
  /** MCP servers' requests for a form or a visit to an address, waiting on you. */
  elicitations: ElicitationRequest[];
  /** Ultracode is on for the session. */
  ultracode: boolean;
  /** Whether it can be turned on, once Claude Code has said. */
  ultracodeAvailable?: boolean;
  /** A request being tried again, until the next response or the turn's end. */
  retry?: Retry;
  /** Claude Code is compacting the conversation. */
  compacting: boolean;
  /** The background task's notice that last accounted for a turn Claude started by itself, by key. */
  explained?: string;
  /** Fast mode, as Claude Code last reported it, and what keeps it off, if anything. */
  fast?: { state: FastModeState; reason?: FastModeDisabledReason };
  /** Remote Control, while it's on. */
  remote?: RemoteControl;
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
  /** Print a tool call's or a `!` command's whole output into the transcript. */
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
    taskInfo: {},
    items: [],
    queue: [],
    tools: {},
    live: null,
    pending: [],
    questions: [],
    elicitations: [],
    ultracode: false,
    compacting: false,
    busy: false,
    turnTokens: 0,
    seq: 0,
  };
}

export function reduce(state: State, event: ViewEvent): State {
  switch (event.kind) {
    case "ready":
      // A new Claude Code process, with nothing in the background yet.
      return { ...state, plan: event.plan, models: event.models, commands: event.commands, tasks: [], taskInfo: {} };
    case "commands":
      return { ...state, commands: event.commands };
    case "prompt":
      // Claude Code echoes a message sent over Remote Control as it starts on it, so it never waits here.
      if (event.remote) return { ...add(state, { kind: "prompt", text: event.text, uuid: event.uuid, images: event.images, at: event.at, remote: true }), busy: true };
      if (state.busy && event.uuid) {
        return { ...state, queue: [...state.queue, { text: event.text, uuid: event.uuid, images: event.images, at: event.at, later: event.later }] };
      }
      return { ...add(state, { kind: "prompt", text: event.text, uuid: event.uuid, images: event.images, at: event.at }), busy: true };
    case "shell":
      return add(state, { kind: "shell", id: event.id, command: event.command, status: "running", stdout: "", stderr: "", startedAt: event.at, at: event.at });
    case "shell-output":
      return updateShell(state, event.id, (item) => (item.status === "running" ? { stdout: event.output, at: event.at } : {}));
    case "shell-done": {
      const item = state.items.find((one): one is ShellItem => one.kind === "shell" && one.id === event.id);
      if (!item) return state;
      const status = event.stopped ? "stopped" : event.code === 0 ? "done" : "error";
      const next = updateShell(state, event.id, () => ({ status, stdout: event.stdout, stderr: event.stderr, code: event.code, at: event.at, endedAt: event.at }));
      // Its card was drawn for good while it ran, so how it ended goes at the end of the transcript.
      if (!item.background) return next;
      const took = event.at !== undefined && item.startedAt !== undefined ? ` after ${duration(event.at - item.startedAt)}` : "";
      const how = status === "stopped" ? "stopped" : status === "error" ? (event.code === null ? "failed" : `exited with ${event.code}`) : "finished";
      return add(next, { kind: "notice", tone: status === "error" ? "error" : "info", text: `! ${firstLine(item.command)} ${how}${took}.` });
    }
    case "sdk":
      return applySdk(state, event.message, event.images, event.at);
    case "permission": {
      const next = { ...state, pending: [...state.pending.filter((p) => p.id !== event.request.id), event.request] };
      // A subagent's prompt marks its call on the Agent call it runs under. A nested subagent's calls
      // never arrive, so the prompt's is its latest.
      const { agentId, id, toolName, input } = event.request;
      const started = agentId === undefined ? undefined : state.taskInfo[agentId]?.toolUseId;
      const owner = agentId === undefined ? undefined : agentCallOf(state, agentId);
      if (!owner) return next;
      return updateTool(next, owner, (call) => {
        const subagent = call.subagent ?? { nested: [] };
        const nested = subagent.nested.map((one) => (one.id === started ? { ...one, last: { id, name: toolName, input } } : one));
        return { subagent: { ...subagent, nested, waitingOn: id } };
      });
    }
    case "question":
      return { ...state, questions: [...state.questions.filter((q) => q.id !== event.request.id), event.request] };
    case "elicitation":
      return { ...state, elicitations: [...state.elicitations.filter((e) => e.id !== event.request.id), event.request] };
    case "resolved": {
      const next = {
        ...state,
        pending: state.pending.filter((p) => p.id !== event.id),
        questions: state.questions.filter((q) => q.id !== event.id),
        elicitations: state.elicitations.filter((e) => e.id !== event.id),
      };
      const owner = state.items.find((item): item is ToolItem => item.kind === "tool" && item.call.subagent?.waitingOn === event.id);
      if (owner) return updateTool(next, owner.call.id, (call) => ({ subagent: { nested: [], ...call.subagent, waitingOn: undefined } }));
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
    case "ultracode":
      return { ...state, ultracode: event.on };
    case "ultracode-available":
      return { ...state, ultracodeAvailable: event.available };
    case "fast":
      return { ...state, fast: { state: event.on ? "on" : "off" } };
    case "context":
      return { ...state, context: { percentage: event.percentage, tokens: event.tokens, max: event.max } };
    case "cache-warmed":
      return state.cache ? { ...state, cache: { ...state.cache, at: event.at } } : state;
    case "remote":
      return { ...state, remote: event.remote ?? undefined };
    case "notice":
      return add(state, { kind: "notice", tone: event.tone, text: event.text });
    case "history": {
      // A saved conversation has no results to end its turns, so every message in it was taken: none waits in the queue.
      const replay = (now: State, one: ViewEvent) => reduce(one.kind === "prompt" ? { ...now, busy: false } : now, one);
      const replayed = closeTurns(event.events.reduce(replay, state), state.items.length);
      const settled = { ...stopRunningTools(replayed), busy: false, live: null, turnTokens: 0 };
      const count = settled.items.length - state.items.length;
      if (event.notice) return add(settled, { kind: "notice", tone: "info", text: event.notice });
      if (count === 0) return add(settled, { kind: "notice", tone: "info", text: "Resumed a session with nothing to show yet." });
      return add(settled, { kind: "notice", tone: "info", text: `Resumed ${event.title ? `“${event.title}”` : "the session"} above.` });
    }
    case "output": {
      const index = state.tools[event.id];
      const item = index === undefined ? state.items.find((one) => one.kind === "shell" && one.id === event.id) : state.items[index];
      return item?.kind === "tool" || item?.kind === "shell" ? add(state, { kind: "output", of: item }) : state;
    }
  }
}

function applySdk(state: State, message: SDKMessage, images: Record<string, ImageAttachment[]> = {}, at?: number): State {
  // Not in the SDK's types: where each message you sent is in Claude Code's queue.
  if (field(message, "type") === "command_lifecycle") return applyLifecycle(state, field(message, "command_uuid"), field(message, "state"));
  switch (message.type) {
    case "system":
      switch (message.subtype) {
        case "init":
          return { ...state, model: state.model ?? message.model, mode: message.permissionMode, fast: fastOf(message) ?? state.fast };
        case "background_tasks_changed": {
          const tasks = message.tasks
            .filter((task) => !task.ambient)
            .map((task) => ({ id: task.task_id, description: task.description, type: task.task_type }));
          const taskInfo = { ...state.taskInfo };
          for (const task of tasks) {
            const known = taskInfo[task.id];
            taskInfo[task.id] = known ? { ...known, background: true } : { ...task, background: true, status: "running", startedAt: at };
          }
          return { ...state, tasks, taskInfo };
        }
        case "task_started": {
          if (message.skip_transcript || message.ambient) return state;
          const known = state.taskInfo[message.task_id];
          const task: TaskInfo = {
            id: message.task_id,
            description: message.description,
            type: message.task_type ?? known?.type ?? "",
            toolUseId: message.tool_use_id,
            background: known?.background || message.is_backgrounded === true,
            status: "running",
            startedAt: known?.startedAt ?? at,
            workflowName: message.workflow_name,
          };
          return { ...state, taskInfo: { ...state.taskInfo, [task.id]: task } };
        }
        case "task_progress": {
          const next = updateTask(state, message.task_id, (task) => ({
            summary: message.summary ?? task.summary,
            lastTool: message.last_tool_name ?? task.lastTool,
            tokens: message.usage.total_tokens,
            toolUses: message.usage.tool_uses,
            // Not in the SDK's types: a workflow's phases and agents.
            workflow: workflowOf(field(message, "workflow_progress")) ?? task.workflow,
          }));
          // A nested subagent's progress is all there is of its calls.
          const started = state.taskInfo[message.task_id]?.toolUseId;
          const owner = started === undefined || state.tools[started] !== undefined ? undefined : nestedOwner(state, started);
          if (!owner) return next;
          return updateTool(next, owner, (call) => {
            const subagent = call.subagent ?? { nested: [] };
            const nested = subagent.nested.map((one) =>
              one.id === started
                ? {
                    ...one,
                    calls: Math.max(one.calls, message.usage.tool_uses),
                    // Newer than a prompt it answered, but not than one it waits on.
                    last: one.last && one.last.id === subagent.waitingOn ? one.last : undefined,
                    lastTool: message.last_tool_name ?? one.lastTool,
                  }
                : one,
            );
            return { subagent: { ...subagent, nested } };
          });
        }
        case "task_updated":
          return message.patch.is_backgrounded ? updateTask(state, message.task_id, () => ({ background: true })) : state;
        case "task_notification": {
          let next = updateTask(state, message.task_id, (task) => ({ status: message.status, endedAt: at, summary: endSummary(message) ?? task.summary }));
          // A command that ran in the background: its card says how it ended.
          if (message.tool_use_id) next = updateTool(next, message.tool_use_id, (call) => (call.background ? { background: message.status } : {}));
          // Only work that ran in the background: a subagent Claude waited on reports back as its
          // tool call. The background set may already have let it go, so what's known of it decides.
          const task = state.taskInfo[message.task_id];
          if (!task?.background || message.skip_transcript) return next;
          const how = { completed: "finished", failed: "failed", stopped: "stopped" }[message.status];
          return add(next, { kind: "notice", tone: message.status === "failed" ? "error" : "info", text: `Background ${taskKind(state, task)} ${how}: ${task.description}`, explains: true });
        }
        case "status": {
          let next: State = { ...state, compacting: message.status === "compacting" };
          if (message.permissionMode) next = { ...next, mode: message.permissionMode };
          if (message.compact_result === "failed") {
            next = add(next, { kind: "notice", tone: "error", text: `Compacting failed${message.compact_error ? `: ${message.compact_error}` : "."}` });
          }
          return next;
        }
        case "compact_boundary":
          return add({ ...state, compacting: false }, { kind: "notice", tone: "info", text: compactedText(message.compact_metadata) });
        case "local_command_output":
          return add(state, { kind: "notice", tone: "info", text: message.content });
        case "api_retry":
          return {
            ...state,
            retry: { attempt: message.attempt, max: message.max_retries, at: at ?? 0, delayMs: message.retry_delay_ms, status: message.error_status, error: message.error },
          };
        case "informational": {
          // `info` is for Claude Code's transcript view only. A hook's reason for blocking your
          // message, or for stopping Claude, comes as a notice or a warning.
          if (message.level === "info" || !message.content.trim()) return state;
          const tone = message.level === "warning" ? "warning" : "info";
          const of = message.tool_use_id;
          const index = of ? state.items.findLastIndex((item) => item.kind === "notice" && item.of === of) : -1;
          const old = state.items[index];
          if (old?.kind !== "notice") return add(state, { kind: "notice", tone, text: message.content.trim(), of });
          const items = state.items.slice();
          items[index] = { ...old, tone, text: message.content.trim() };
          return { ...state, items };
        }
        case "elicitation_complete":
          return add(state, { kind: "notice", tone: "info", text: `${message.mcp_server_name} confirmed the step in the browser.` });
        case "permission_denied":
          return updateTool(state, message.tool_use_id, () => ({ status: "denied", deniedBy: deniedBy(message.decision_reason_type) }));
        default:
          return state;
      }
    case "rate_limit_event":
      return { ...state, limits: usageWindows(message.rate_limit_info, state.limits) };
    case "tool_progress":
      return message.parent_tool_use_id ? state : updateTool(state, message.tool_use_id, (call) => (call.status === "running" ? { elapsed: message.elapsed_time_seconds } : {}));
    case "stream_event":
      return message.parent_tool_use_id ? state : applyStream({ ...woken(state), busy: true, retry: undefined }, message.event);
    case "assistant":
      if (message.parent_tool_use_id) return applyAssistant({ ...state, cache: cacheAfter(state.cache, message, at) }, message, at);
      return applyAssistant({ ...woken(state), busy: true, retry: undefined, cache: cacheAfter(state.cache, message, at) }, message, at);
    case "user":
      return applyUser(state, message, images, at);
    case "result":
      return applyResult(state, message);
    default:
      return state;
  }
}

/**
 * Claude starting a turn while not working, with no message of yours to start it: a background
 * task reported back, a Monitor saw something, or a scheduled task came due. Claude Code doesn't
 * say which on the stream. A background task's end since your last message that hasn't accounted
 * for a turn yet is the cause, even when it came during the turn before, and says so already;
 * otherwise a Monitor still running is.
 */
function woken(state: State): State {
  if (state.busy) return state;
  const since = state.items.slice(state.items.findLastIndex((item) => item.kind === "turn") + 1);
  if (since.some((item) => item.kind === "prompt")) return state;
  const sincePrompt = state.items.slice(state.items.findLastIndex((item) => item.kind === "prompt") + 1);
  const ended = sincePrompt.findLast((item) => item.kind === "notice" && item.explains);
  if (ended && ended.key !== state.explained) return { ...state, explained: ended.key };
  const monitor = Object.values(state.taskInfo).find((task) => {
    const index = task.status === "running" && task.toolUseId ? state.tools[task.toolUseId] : undefined;
    const item = index === undefined ? undefined : state.items[index];
    return item?.kind === "tool" && item.call.name === "Monitor";
  });
  const text = monitor ? `Claude picked up an event from Monitor “${monitor.description}”.` : "Claude started a turn on its own.";
  return add(state, { kind: "notice", tone: "info", text });
}

/**
 * A queued message Claude started on goes into the transcript, at the end, where Claude read it; one
 * that's done or was taken back leaves the queue. Messages that never waited aren't in it.
 */
function applyLifecycle(state: State, uuid: unknown, stage: unknown): State {
  const queued = state.queue.find((one) => one.uuid === uuid);
  if (!queued) return state;
  const queue = state.queue.filter((one) => one !== queued);
  if (stage === "started") return { ...add({ ...state, queue }, { kind: "prompt", text: queued.text, uuid: queued.uuid, images: queued.images, at: queued.at }), busy: true };
  if (stage === "cancelled" || stage === "completed") return { ...state, queue };
  return state;
}

/**
 * The cache after one of Claude's main-thread messages: refreshed when it came, for as long as its
 * usage says it wrote for. A message that wrote nothing keeps the TTL known before. A subagent's
 * messages have a cache of their own, and an error Claude Code made up made no request.
 */
function cacheAfter(cache: Cache | undefined, message: SDKAssistantMessage, at: number | undefined): Cache | undefined {
  if (at === undefined || message.parent_tool_use_id || message.message.model === "<synthetic>") return cache;
  const written = message.message.usage?.cache_creation;
  const ttl = written?.ephemeral_1h_input_tokens ? 60 * 60_000 : written?.ephemeral_5m_input_tokens ? 5 * 60_000 : (cache?.ttl ?? CACHE_TTL);
  return { at, ttl, workedAt: at };
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

function applyAssistant(state: State, message: SDKAssistantMessage, at?: number): State {
  const content = message.message.content;
  if (message.parent_tool_use_id) {
    const calls = content.flatMap((block): SubagentCall[] => (block.type === "tool_use" ? [{ id: block.id, name: block.name, input: asRecord(block.input) }] : []));
    return calls.length ? applySubagentCalls(state, message.parent_tool_use_id, calls) : state;
  }
  let next = state;
  if (message.error && !content.some((block) => block.type === "text")) {
    next = add(next, { kind: "notice", tone: "error", text: errorText(message.error) });
  }
  for (const block of content) {
    next = finalizeLive(next, message.message.id, block);
    if (block.type === "text" && block.text.trim()) {
      next = add(next, { kind: "text", text: block.text, at });
    } else if (block.type === "thinking" && block.thinking.trim()) {
      next = add(next, { kind: "thinking", text: block.thinking, at });
    } else if (block.type === "tool_use") {
      next = addTool(next, { id: block.id, name: block.name, input: asRecord(block.input), status: "running", subagentCalls: 0, startedAt: at });
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

/**
 * Calls a subagent made, under the Agent call that started it: Claude's own, or one a subagent made
 * under it. Agent calls among them start subagents of their own, kept after the one that started them.
 */
function applySubagentCalls(state: State, parent: string, calls: SubagentCall[]): State {
  const last = calls[calls.length - 1];
  const started = (depth: number) =>
    calls.filter((call) => call.name === "Agent" || call.name === "Task").map((call): NestedAgent => {
      const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : undefined);
      return { id: call.id, depth, description: text("description") ?? "", type: text("subagent_type"), calls: 0, status: "running" };
    });
  if (state.tools[parent] !== undefined) {
    return updateTool(state, parent, (call) => {
      const subagent = call.subagent ?? { nested: [] };
      return { subagentCalls: call.subagentCalls + calls.length, subagent: { ...subagent, last, nested: [...subagent.nested, ...started(1)] } };
    });
  }
  const owner = nestedOwner(state, parent);
  if (!owner) return state;
  return updateTool(state, owner, (call) => {
    const subagent = call.subagent ?? { nested: [] };
    const nested = subagent.nested.slice();
    const at = nested.findIndex((one) => one.id === parent);
    const agent = nested[at];
    if (!agent) return {};
    nested[at] = { ...agent, calls: agent.calls + calls.length, last };
    // After the agents it already started, and theirs.
    let end = at + 1;
    while (end < nested.length && (nested[end]?.depth ?? 0) > agent.depth) end += 1;
    nested.splice(end, 0, ...started(agent.depth + 1));
    return { subagent: { ...subagent, nested } };
  });
}

/** Claude's Agent call that a subagent's Agent call is nested under, by the nested call's id. */
function nestedOwner(state: State, id: string) {
  const owner = state.items.findLast((item): item is ToolItem => item.kind === "tool" && item.call.subagent?.nested.some((one) => one.id === id) === true);
  return owner?.call.id;
}

/** Claude's Agent call that a subagent runs under, by its agent id, at any depth. */
function agentCallOf(state: State, agentId: string) {
  const started = state.taskInfo[agentId]?.toolUseId;
  if (started === undefined) return undefined;
  return state.tools[started] !== undefined ? started : nestedOwner(state, started);
}

/** A subagent's tool results: one for an Agent call it made says how that subagent ended. */
function applySubagentResults(state: State, content: Exclude<UserMessage["message"]["content"], string>): State {
  let next = state;
  for (const block of content) {
    if (block.type !== "tool_result") continue;
    const owner = nestedOwner(next, block.tool_use_id);
    if (!owner) continue;
    const status = block.is_error ? "error" : "done";
    next = updateTool(next, owner, (call) => {
      const subagent = call.subagent ?? { nested: [] };
      return { subagent: { ...subagent, nested: subagent.nested.map((one) => (one.id === block.tool_use_id ? { ...one, status } : one)) } };
    });
  }
  return next;
}

function applyUser(state: State, message: UserMessage, images: Record<string, ImageAttachment[]>, at?: number): State {
  const content = message.message.content;
  if (typeof content === "string") return state;
  if (message.parent_tool_use_id) return applySubagentResults(state, content);
  const results = content.filter((block) => block.type === "tool_result");
  // The structured output belongs to the message's tool result, so it's only clear when there's one.
  const output = results.length === 1 && "tool_use_result" in message ? message.tool_use_result : undefined;
  let next = state;
  for (const block of results) {
    const result = resultText(block.content);
    // A saved conversation has no record of the prompt, only Claude Code's note that it was refused.
    const refused = block.is_error === true && result.startsWith("The user doesn't want to proceed with this tool use");
    next = updateTool(next, block.tool_use_id, (call) => {
      const taskId = launched(call.name, output);
      return {
        result,
        output,
        images: images[block.tool_use_id],
        status: call.status === "denied" || call.status === "stopped" ? call.status : refused ? "denied" : block.is_error ? "error" : "done",
        endedAt: at,
        // Started in the background or moved there: Claude Code answers at once, and the work goes on.
        background: taskId ? (call.background ?? "running") : output === undefined && launchedText(call.name, result) ? "unknown" : call.background,
        taskId: taskId ?? call.taskId,
      };
    });
  }
  return next;
}

function applyResult(state: State, message: SDKResultMessage): State {
  // Claude Code answers a message that doesn't start a turn, such as a `!` command's, with a result of no turns.
  if (!state.busy && message.num_turns === 0) return state;
  const settled = { ...stopRunningTools(state), busy: false, live: null, turnTokens: 0, retry: undefined, compacting: false, fast: fastOf(message) ?? state.fast };
  const turn = { kind: "turn" as const, durationMs: message.duration_ms, tokens: state.turnTokens, ...turnWork(state.items) };
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
 * What the turn now ending did: the files it changed and the commands it ran, since your last
 * message or, for a turn Claude started on its own, as when a background task reports back, since
 * the turn before it ended.
 */
function turnWork(items: Item[]) {
  const start = items.findLastIndex((item) => item.kind === "prompt" || item.kind === "turn");
  const files: string[] = [];
  const commands: string[] = [];
  for (const item of items.slice(start + 1)) {
    if (item.kind !== "tool" || item.call.status !== "done") continue;
    const { name, input } = item.call;
    const path = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
    if ((name === "Edit" || name === "Write" || name === "NotebookEdit" || name === "MultiEdit") && path && !files.includes(path)) files.push(path);
    if (name === "Bash" && typeof input.command === "string") commands.push(input.command);
  }
  return { files, commands };
}

/**
 * A saved conversation doesn't record where its turns ended, so each replayed turn ends where the
 * next prompt starts, and the last one at the end, timed from your message to the last thing saved
 * in it, with the files it changed and the commands it ran. Items from `from` on are the replayed ones.
 */
function closeTurns(state: State, from: number): State {
  let seq = state.seq;
  const items = state.items.slice(0, from);
  /** Where the open turn's prompt is in `items`, or -1 outside a turn. */
  let start = -1;
  const close = () => {
    if (start === -1) return;
    const turn = items.slice(start);
    const began = turn[0]?.kind === "prompt" ? turn[0].at : undefined;
    const ended = Math.max(...turn.map(lastAt).filter((at) => at !== undefined));
    const durationMs = began !== undefined && ended > began ? ended - began : 0;
    items.push({ kind: "turn", key: `i${seq++}`, outcome: "finished", durationMs, tokens: 0, replayed: true, ...turnWork(turn) });
    start = -1;
  };
  for (const item of state.items.slice(from)) {
    if (item.kind === "prompt") {
      close();
      start = items.length;
    } else if (item.kind === "turn") start = -1;
    items.push(item);
  }
  close();
  const tools: Record<string, number> = {};
  items.forEach((item, index) => {
    if (item.kind === "tool") tools[item.call.id] = index;
  });
  return { ...state, items, tools, seq };
}

/** The last moment an entry was known to be at, if any. */
function lastAt(item: Item): number | undefined {
  switch (item.kind) {
    case "prompt":
    case "text":
    case "thinking":
      return item.at;
    case "tool":
      return item.call.endedAt ?? item.call.startedAt;
    case "shell":
      return item.endedAt ?? item.at;
    default:
      return undefined;
  }
}

/** Whatever was still running when a turn ended won't report back. */
function stopRunningTools(state: State): State {
  const items = state.items.map((item) =>
    item.kind === "tool" && item.call.status === "running" ? { ...item, call: { ...item.call, status: "stopped" as const } } : item,
  );
  return { ...state, items };
}

/**
 * A new entry at the end. A `!` command still running moves to the background once anything comes
 * after it, so what follows can be drawn for good.
 */
function add(state: State, item: NewItem): State {
  const live = (one: Item) => one.kind === "shell" && one.status === "running" && !one.background;
  const items = state.items.some(live) ? state.items.map((one) => (live(one) ? { ...one, background: true } : one)) : state.items;
  return { ...state, seq: state.seq + 1, items: [...items, { ...item, key: `i${state.seq}` } as Item] };
}

function updateShell(state: State, id: string, patch: (item: ShellItem) => Partial<ShellItem>): State {
  const index = state.items.findIndex((item) => item.kind === "shell" && item.id === id);
  const item = state.items[index];
  if (item?.kind !== "shell") return state;
  const changes = patch(item);
  if (!Object.keys(changes).length) return state;
  const items = state.items.slice();
  items[index] = { ...item, ...changes };
  return { ...state, items };
}

function updateTask(state: State, id: string, patch: (task: TaskInfo) => Partial<TaskInfo>): State {
  const task = state.taskInfo[id];
  return task ? { ...state, taskInfo: { ...state.taskInfo, [id]: { ...task, ...patch(task) } } } : state;
}

function firstLine(text: string) {
  const [first = ""] = text.split("\n");
  return text.includes("\n") ? `${first} …` : first;
}

/**
 * The task a tool call started in the background, from its structured result: a command started
 * there or moved there, a subagent launched to run on its own, a Monitor, or a workflow.
 */
function launched(name: string, output: unknown): string | undefined {
  const text = (key: string) => {
    const value = field(output, key);
    return typeof value === "string" ? value : undefined;
  };
  switch (name) {
    case "Bash":
      return text("backgroundTaskId");
    case "Agent":
    case "Task":
      return field(output, "status") === "async_launched" ? text("agentId") : field(output, "status") === "remote_launched" ? text("taskId") : undefined;
    case "Monitor":
    case "Workflow":
      return text("taskId");
    default:
      return undefined;
  }
}

/** A saved conversation has no structured results, only what Claude Code told Claude. */
function launchedText(name: string, result: string) {
  if (name === "Bash") return result.startsWith("Command running in background with ID:");
  if (name === "Agent" || name === "Task") return result.startsWith("Async agent launched successfully");
  return false;
}

/** What sort of work a task is, in a word, by Claude Code's task types. */
export function kindOf(task: { type: string }) {
  switch (task.type) {
    case "local_bash":
      return "command";
    case "local_agent":
    case "remote_agent":
      return "subagent";
    case "local_workflow":
      return "workflow";
    case "monitor_ws":
    case "monitor_mcp":
    case "monitor":
      return "monitor";
    default:
      return task.type.replace(/_/g, " ") || "task";
  }
}

/** What sort of work a task is, in a word: a Monitor that runs a command is a command task to Claude Code. */
export function taskKind(state: State, task: TaskInfo) {
  const index = task.toolUseId ? state.tools[task.toolUseId] : undefined;
  const item = index === undefined ? undefined : state.items[index];
  return item?.kind === "tool" && item.call.name === "Monitor" ? "monitor" : kindOf(task);
}

/** A workflow's phases and agents, from Claude Code's progress report, which the SDK doesn't type. */
function workflowOf(progress: unknown): WorkflowPhase[] | undefined {
  if (!Array.isArray(progress)) return undefined;
  const phases: WorkflowPhase[] = [];
  const phaseAt = (index: unknown, title: unknown) => {
    const at = typeof index === "number" ? index : phases.length;
    phases[at] ??= { title: typeof title === "string" ? title : "", agents: [] };
    if (typeof title === "string" && title) phases[at].title = title;
    return phases[at];
  };
  for (const entry of progress) {
    if (field(entry, "type") === "workflow_phase") phaseAt(field(entry, "index"), field(entry, "title"));
    else if (field(entry, "type") === "workflow_agent") {
      const phase = phaseAt(field(entry, "phaseIndex"), field(entry, "phaseTitle"));
      const number = (key: string) => (typeof field(entry, key) === "number" ? (field(entry, key) as number) : undefined);
      const text = (key: string) => (typeof field(entry, key) === "string" ? (field(entry, key) as string) : undefined);
      phase.agents.push({ label: text("label") ?? "agent", state: text("state") ?? "", lastTool: text("lastToolName"), tokens: number("tokens"), toolCalls: number("toolCalls"), error: text("error") });
    }
  }
  const found = phases.filter(Boolean);
  return found.length ? found : undefined;
}

/** The notice for a compaction: how it started and how much it freed, where Claude Code says. */
function compactedText({ trigger, pre_tokens, post_tokens, duration_ms }: { trigger: "manual" | "auto"; pre_tokens: number; post_tokens?: number; duration_ms?: number }) {
  const what = trigger === "auto" ? "Claude Code compacted the conversation to free up context" : "Compacted the conversation";
  const tokens = post_tokens !== undefined ? `: ${compact(pre_tokens)} → ${compact(post_tokens)} tokens` : "";
  const took = duration_ms ? ` in ${duration(duration_ms)}` : "";
  return `${what}${tokens}${took}.`;
}

/**
 * What a task said as it ended. A subagent that handed its report back with SubagentHandback ends
 * with a note to Claude to read it there, which says nothing to you; the report is in its
 * transcript, and in `handback_report` where Claude Code sends it, which the SDK doesn't type.
 */
function endSummary(message: { summary: string }) {
  const report = field(message, "handback_report");
  // Its first line: the task view shows the whole report in the transcript under it.
  if (typeof report === "string" && report.trim()) return report.trim().split("\n")[0];
  if (!message.summary || message.summary.includes("SubagentHandback")) return undefined;
  return message.summary;
}

/** Fast mode as a message reports it, if it does. */
function fastOf(message: { fast_mode_state?: FastModeState; fast_mode_disabled_reason?: FastModeDisabledReason }): State["fast"] {
  return message.fast_mode_state ? { state: message.fast_mode_state, reason: message.fast_mode_disabled_reason } : undefined;
}

/** Who refused a tool call without asking you, from Claude Code's reason for it. */
function deniedBy(reason: string | undefined) {
  switch (reason) {
    case "classifier":
      return "auto mode";
    case "rule":
      return "a rule";
    case "mode":
      return "the mode";
    case "hook":
      return "a hook";
    default:
      return undefined;
  }
}

function addTool(state: State, call: ToolCall): State {
  const next = add(state, { kind: "tool", call });
  return { ...next, tools: { ...next.tools, [call.id]: next.items.length - 1 } };
}

function updateTool(state: State, id: string, patch: (call: ToolCall) => Partial<ToolCall>): State {
  const index = state.tools[id];
  const item = index === undefined ? undefined : state.items[index];
  if (index === undefined || item?.kind !== "tool") return state;
  const changes = patch(item.call);
  if (!Object.keys(changes).length) return state;
  const items = state.items.slice();
  items[index] = { ...item, call: { ...item.call, ...changes } };
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
