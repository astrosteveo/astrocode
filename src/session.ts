import {
  getSessionMessages,
  query,
  type AccountInfo,
  type CanUseTool,
  type EffortLevel,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
  type SessionMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import {
  MODES,
  sdkEvent,
  type Answers,
  type CommandInfo,
  type Decision,
  type ImageAttachment,
  type PermissionRequest,
  type Question,
  type SessionEvent,
} from "./events";
import { AsyncQueue } from "./queue";
import { field } from "./view/tools";

export type SessionOptions = {
  /** The project Claude works in. */
  cwd: string;
  /** Leave unset to use Claude Code's default model. */
  model?: string;
  /** Leave unset to use Claude Code's default effort for the model. */
  effort?: EffortLevel;
  /** False starts with thinking off. Leave unset for Claude Code's default, which thinks. */
  thinking?: boolean;
  /** Leave unset to start in auto mode. */
  mode?: PermissionMode;
  /** A saved session to pick up instead of starting a new one. */
  resume?: string;
  /** Pick up the most recent session in `cwd`. */
  continue?: boolean;
  /** Where Claude Code's own stderr goes. Defaults to this process's stderr. */
  onStderr?: (data: string) => void;
  emit: (event: SessionEvent) => void;
};

/** A background task's output, as the SDK's `SDKControlGetTaskOutputResponse` has it. */
export type TaskOutput = { output: string; total_bytes: number; truncated: boolean };

/** Thinking turned back on in a Claude Code that started without it: Claude Code's own largest default budget. */
const THINKING_BUDGET = 31_999;

/** One running Claude Code process. A session starts a new run after a reset, a resume or a crash. */
type Run = { query: Query; inbox: AsyncQueue<SDKUserMessage>; closing: boolean };

type Waiting<T> = { run: Run; value: T; resolve: (result: PermissionResult) => void };

/**
 * One Claude Code session, driven through the Agent SDK in streaming-input mode.
 *
 * The SDK runs the Claude Code binary, so this uses the same login as `claude`
 * (your subscription, unless ANTHROPIC_API_KEY is set) and loads the same
 * settings, CLAUDE.md files, skills, plugins, hooks and MCP servers.
 */
export class AgentSession {
  private run: Run | null = null;
  private permissions = new Map<string, Waiting<PermissionRequest>>();
  private questions = new Map<string, Waiting<Record<string, unknown>>>();
  private sessionId: string | undefined;
  private mode: PermissionMode;
  private model: string | undefined;
  private effort: EffortLevel | undefined;
  private thinking: boolean | undefined;
  /** Whether the running Claude Code started with thinking off, which a null budget can't undo. */
  private startedWithoutThinking = false;
  private resumeFrom: string | undefined;
  private continueLast: boolean;
  /** Where a rewound conversation picks up: the last message kept. Until something new is sent. */
  private resumeAt: string | undefined;

  constructor(private readonly options: SessionOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.thinking = options.thinking;
    this.mode = options.mode ?? "auto";
    this.resumeFrom = options.resume;
    this.continueLast = options.continue ?? false;
  }

  /** The conversation's id, once Claude Code has reported it. */
  get id() {
    return this.sessionId;
  }

  /** Starts Claude Code if it isn't running, picking the conversation back up if there was one. */
  start() {
    if (this.run) return;
    const inbox = new AsyncQueue<SDKUserMessage>();
    // Assigned right below; canUseTool only runs once the query is under way.
    let run!: Run;
    const q = query({
      prompt: inbox,
      options: {
        cwd: this.options.cwd,
        model: this.model,
        effort: this.effort,
        thinking: this.thinking === false ? { type: "disabled" } : undefined,
        resume: this.sessionId ?? this.resumeFrom,
        resumeSessionAt: this.resumeAt,
        continue: this.sessionId === undefined && this.resumeFrom === undefined && this.continueLast ? true : undefined,
        // Without an explicit mode, Claude Code starts in the mode from your settings, which can
        // skip our prompts. Start in auto, Claude Code's own default, unless you picked another:
        // its classifier allows what's safe and asks through canUseTool about the rest.
        permissionMode: this.mode,
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        // Backups of the files Claude changes, so rewinding can put them back.
        enableFileCheckpointing: true,
        systemPrompt: { type: "preset", preset: "claude_code" },
        canUseTool: (toolName, input, context) => this.ask(run, toolName, input, context),
        stderr: this.options.onStderr ?? ((data) => process.stderr.write(`[claude] ${data}`)),
        env: topLevelEnv(),
      },
    });
    run = { query: q, inbox, closing: false };
    this.startedWithoutThinking = this.thinking === false;
    this.run = run;
    void this.pump(run);
    void this.announce(run);
  }

  /**
   * Sends a message, with the images its `[Image #n]` labels mention, by number, before its text.
   * Its uuid is the one rewinding goes back to.
   */
  send(text: string, images: ReadonlyMap<number, ImageAttachment> = new Map()) {
    this.start();
    this.resumeAt = undefined;
    const uuid = randomUUID();
    const mentions = mentionsIn(text, images);
    this.options.emit({ kind: "prompt", text, uuid, images: Object.fromEntries(mentions.map(({ n, image }) => [n, image])) });
    this.run?.inbox.push({ type: "user", message: { role: "user", content: messageContent(text, mentions) }, parent_tool_use_id: null, uuid });
  }

  /**
   * Adds to the conversation without starting a turn, as a command run with `!` does. It goes to
   * Claude with the next message.
   */
  note(text: string) {
    this.start();
    this.run?.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, shouldQuery: false });
  }

  /** What rewinding the files to how they were when `uuid` was sent would change, or does change. */
  async rewindFiles(uuid: string, dryRun: boolean) {
    this.start();
    const run = this.run;
    if (!run) throw new Error("Claude Code isn't running.");
    return run.query.rewindFiles(uuid, { dryRun });
  }

  /**
   * Takes the conversation back to before the message `uuid`: Claude Code starts again on the
   * same session, picking up after the message before it. Returns the messages kept.
   */
  async rewindConversation(uuid: string): Promise<SessionMessage[]> {
    const id = this.sessionId;
    if (!id) throw new Error("There's no conversation to rewind yet.");
    const messages = await getSessionMessages(id, { dir: this.options.cwd });
    const at = messages.findIndex((message) => message.uuid === uuid);
    if (at === -1) throw new Error("Claude Code hasn't saved that message, so the conversation can't go back to it.");
    if (at === 0) {
      // Back to before the first message: a new conversation.
      this.reset();
      this.start();
      return [];
    }
    this.close();
    this.resumeFrom = id;
    this.resumeAt = messages[at - 1]?.uuid;
    this.start();
    return messages.slice(0, at);
  }

  /**
   * Moves the commands and subagents Claude is waiting on to the background, as Ctrl+B does in
   * Claude Code. Asked about each running tool call, Claude Code says which ones moved; asked
   * about none in particular, it says yes even when nothing could.
   */
  async background(toolUseIds: string[]) {
    const run = this.run;
    if (!run) return 0;
    const moved = await Promise.all(toolUseIds.map((id) => run.query.backgroundTasks(id).catch(() => false)));
    return moved.filter(Boolean).length;
  }

  async stopTask(id: string) {
    await this.run?.query.stopTask(id);
  }

  /**
   * The end of what a background command or Monitor printed, the last 8 KiB of it, while it runs
   * and once more after it ends. Null for a task with no output to read, such as a subagent, or
   * once Claude Code has stopped.
   */
  async taskOutput(id: string): Promise<TaskOutput | null> {
    // The SDK has this in its code, answering `get_task_output`, but not in Query's type.
    const query = this.run?.query as (Query & { getTaskOutput?: (taskId: string) => Promise<TaskOutput> }) | undefined;
    if (!query?.getTaskOutput) return null;
    try {
      return await query.getTaskOutput(id);
    } catch {
      return null;
    }
  }

  decide(id: string, decision: Decision) {
    const waiting = this.permissions.get(id);
    if (!waiting) return;
    this.permissions.delete(id);
    const request = waiting.value;
    if (decision === "deny") {
      // Like saying no in Claude Code: the turn stops and Claude waits for you.
      waiting.resolve({ behavior: "deny", message: "The user declined this action. Wait for them to say how to proceed.", interrupt: true });
    } else {
      waiting.resolve({
        behavior: "allow",
        updatedInput: request.input,
        updatedPermissions: decision === "always" ? request.alwaysAllow : undefined,
      });
    }
    this.options.emit({ kind: "resolved", id, outcome: decision });
  }

  /** Answers Claude's questions, or dismisses them with `null`. */
  answer(id: string, answers: Answers | null) {
    const waiting = this.questions.get(id);
    if (!waiting) return;
    this.questions.delete(id);
    if (answers) waiting.resolve({ behavior: "allow", updatedInput: { ...waiting.value, answers } });
    else waiting.resolve({ behavior: "deny", message: "The user dismissed the questions without answering." });
    this.options.emit({ kind: "resolved", id, outcome: answers ? "answered" : "cancelled" });
  }

  async interrupt() {
    await this.run?.query.interrupt();
  }

  async setMode(mode: PermissionMode) {
    await this.run?.query.setPermissionMode(mode);
    this.mode = mode;
    this.options.emit({ kind: "mode", mode });
  }

  async setModel(model: string) {
    await this.run?.query.setModel(model);
    this.model = model;
    this.options.emit({ kind: "model", model });
  }

  async setEffort(effort: EffortLevel) {
    await this.run?.query.applyFlagSettings({ effortLevel: effort });
    this.effort = effort;
    this.options.emit({ kind: "effort", effort });
  }

  /**
   * Turns thinking on or off for the rest of the session. A budget of 0 turns it off, and any other
   * turns it back on (adaptive, on models that decide for themselves). Null goes back to how Claude
   * Code started, which is on unless it started with thinking off.
   */
  async setThinking(on: boolean) {
    await this.run?.query.setMaxThinkingTokens(on ? (this.startedWithoutThinking ? THINKING_BUDGET : null) : 0);
    this.thinking = on;
    this.options.emit({ kind: "thinking", on });
  }

  /**
   * Loads plugins again after they're installed, removed, or turned on or off, and passes on the
   * slash commands that come with them. Without a running Claude Code there's nothing to reload:
   * the next start loads them.
   */
  async reloadPlugins() {
    const run = this.run;
    if (!run) return;
    const reloaded = await run.query.reloadPlugins();
    if (run.closing) return;
    this.options.emit({ kind: "commands", commands: reloaded.commands.map(commandInfo) });
  }

  /** Stops Claude Code and forgets the conversation, so the next start begins a new one. */
  reset() {
    this.close();
    this.sessionId = undefined;
    this.resumeFrom = undefined;
    this.resumeAt = undefined;
    this.continueLast = false;
  }

  /** Switches to a saved conversation. */
  resume(sessionId: string) {
    this.reset();
    this.resumeFrom = sessionId;
    this.start();
  }

  close() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.closing = true;
    this.cancelWaiting(run, false);
    run.inbox.close();
    run.query.close();
  }

  private ask(run: Run, toolName: string, input: Record<string, unknown>, context: Parameters<CanUseTool>[2]) {
    return new Promise<PermissionResult>((resolve) => {
      const id = context.toolUseID;
      if (toolName === "AskUserQuestion") {
        const questions = parseQuestions(input.questions);
        if (!questions) {
          resolve({ behavior: "deny", message: "astrocode couldn't read these questions. Ask them in plain text instead." });
          return;
        }
        this.questions.set(id, { run, value: input, resolve });
        context.signal.addEventListener("abort", () => this.answer(id, null), { once: true });
        this.options.emit({ kind: "question", request: { id, questions } });
        return;
      }
      const request: PermissionRequest = {
        id,
        toolName,
        input,
        title: context.title,
        description: context.description,
        decisionReason: context.decisionReason,
        blockedPath: context.blockedPath,
        alwaysAllow: context.suppressAlwaysAllowRule ? undefined : narrowest(context.suggestions),
        defaultToNo: context.defaultToNo,
        fromSubagent: context.agentID !== undefined,
      };
      this.permissions.set(id, { run, value: request, resolve });
      context.signal.addEventListener("abort", () => this.cancel(id), { once: true });
      this.options.emit({ kind: "permission", request });
    });
  }

  /** Settles a permission prompt Claude Code no longer needs, such as after an interrupt. */
  private cancel(id: string, announce = true) {
    const waiting = this.permissions.get(id);
    if (!waiting) return;
    this.permissions.delete(id);
    waiting.resolve({ behavior: "deny", message: "The request was cancelled." });
    if (announce) this.options.emit({ kind: "resolved", id, outcome: "cancelled" });
  }

  private cancelWaiting(run: Run, announce: boolean) {
    for (const [id, waiting] of [...this.permissions]) if (waiting.run === run) this.cancel(id, announce);
    for (const [id, waiting] of [...this.questions]) {
      if (waiting.run !== run) continue;
      this.questions.delete(id);
      waiting.resolve({ behavior: "deny", message: "The request was cancelled." });
      if (announce) this.options.emit({ kind: "resolved", id, outcome: "cancelled" });
    }
  }

  private async pump(run: Run) {
    try {
      for await (const message of run.query) {
        if (run.closing) break;
        if ("session_id" in message && message.session_id) this.sessionId = message.session_id;
        if (message.type === "system" && message.subtype === "init") this.mode = message.permissionMode;
        // Claude Code changes modes too, such as when Claude leaves plan mode. A restart carries on in that one.
        if (message.type === "system" && message.subtype === "status" && message.permissionMode) this.mode = message.permissionMode;
        this.options.emit(sdkEvent(message, Date.now()));
        if (message.type === "result") void this.reportContext(run);
      }
    } catch (error) {
      if (!run.closing) this.options.emit({ kind: "notice", tone: "error", text: `Claude Code stopped: ${messageOf(error)}` });
    } finally {
      if (this.run === run) this.run = null;
      this.cancelWaiting(run, !run.closing);
    }
  }

  /** The account, models and slash commands Claude Code reports when it starts. */
  private async announce(run: Run) {
    const asked = this.mode;
    try {
      const init = await run.query.initializationResult();
      if (run.closing) return;
      this.options.emit({
        kind: "ready",
        plan: planOf(init.account),
        models: init.models.map((model) => ({
          value: model.value,
          name: model.displayName,
          description: model.description,
          efforts: model.supportsEffort ? (model.supportedEffortLevels ?? undefined) : undefined,
          // Not in the SDK's types. Claude Code ignores a request to stop thinking on a model without it.
          thinkingOff: field(model, "supportsThinkingOff") === true,
        })),
        commands: init.commands.map(commandInfo),
      });
      // Where auto mode isn't available, as on some models, Claude Code starts by asking instead.
      // `current_permission_mode` isn't in the SDK's types. A mode picked meanwhile stands.
      const started = MODES.find((one) => one === field(init, "current_permission_mode"));
      if (started && this.mode === asked) {
        this.mode = started;
        this.options.emit({ kind: "mode", mode: started });
        if (asked === "auto" && started !== "auto") {
          this.options.emit({ kind: "notice", tone: "info", text: "Auto mode isn't available with this model or account, so Claude asks first. Shift+Tab changes the mode." });
        }
      }
      // A model chosen at launch is known now; Claude Code's own default arrives with the first reply.
      if (this.model) this.options.emit({ kind: "model", model: this.model });
      // Claude Code doesn't report its default effort, so only a level chosen here is shown.
      if (this.effort) this.options.emit({ kind: "effort", effort: this.effort });
      if (this.thinking !== undefined) this.options.emit({ kind: "thinking", on: this.thinking });
      await this.reportContext(run);
    } catch {
      // A failed start is reported by pump().
    }
  }

  private async reportContext(run: Run) {
    try {
      const usage = await run.query.getContextUsage();
      if (run.closing) return;
      this.options.emit({ kind: "context", percentage: usage.percentage, tokens: usage.totalTokens, max: usage.maxTokens });
    } catch {
      // Context usage is a nicety; the session goes on without it.
    }
  }
}

/** "Claude Max", "API key", or the cloud provider in use. */
function planOf(account: AccountInfo) {
  if (account.apiProvider && account.apiProvider !== "firstParty") return account.apiProvider;
  if (account.apiKeySource && account.apiKeySource !== "none") return "API key";
  return account.subscriptionType;
}

type Content = SDKUserMessage["message"]["content"];
type Mention = { n: number; image: ImageAttachment };

/** The images `text` mentions with `[Image #n]`, each once, in the order they're first mentioned. */
function mentionsIn(text: string, images: ReadonlyMap<number, ImageAttachment>): Mention[] {
  const seen = new Set<number>();
  return [...text.matchAll(/\[Image #(\d+)\]/g)].flatMap((match) => {
    const n = Number(match[1]);
    const image = images.get(n);
    if (!image || seen.has(n)) return [];
    seen.add(n);
    return [{ n, image }];
  });
}

/** A message's content: its images, then its text. */
function messageContent(text: string, mentions: Mention[]): Content {
  if (!mentions.length) return text;
  return [
    ...mentions.map(({ image }) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } })),
    { type: "text" as const, text },
  ];
}

function commandInfo(command: SlashCommand): CommandInfo {
  return { name: command.name, description: command.description, argumentHint: command.argumentHint ?? "" };
}

/** AskUserQuestion's questions, checked, since the model writes them. */
function parseQuestions(value: unknown): Question[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const questions: Question[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { question, header, multiSelect, options } = item as Record<string, unknown>;
    if (typeof question !== "string" || !Array.isArray(options) || options.length === 0) return null;
    questions.push({
      question,
      header: typeof header === "string" ? header : "",
      multiSelect: multiSelect === true,
      options: options.map((option) => {
        const { label, description, preview } = (option ?? {}) as Record<string, unknown>;
        return {
          label: String(label ?? ""),
          description: typeof description === "string" ? description : "",
          preview: typeof preview === "string" ? preview : undefined,
        };
      }),
    });
  }
  return questions;
}

/** What a running Claude Code session sets for the processes it starts, marking them as its children. */
const SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_EFFORT",
  "CLAUDE_JOB_DIR",
  "CLAUDE_PID",
];

/**
 * This process's environment without those markers, so astrocode runs as its own top-level
 * session even when it's launched from inside Claude Code. Settings such as
 * CLAUDE_CODE_OAUTH_TOKEN pass through.
 */
export function topLevelEnv() {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "astrocode" };
  for (const name of SESSION_MARKERS) delete env[name];
  return env;
}

/**
 * Claude Code's suggestions can bundle a rule for this one call with broader changes, such as
 * switching the whole session to accept edits. "Always allow" applies only the narrowest kind.
 */
function narrowest(suggestions: PermissionUpdate[] | undefined) {
  for (const type of ["addRules", "addDirectories", "setMode"] as const) {
    const picked = suggestions?.filter((s) => s.type === type && (s.type !== "addRules" || s.behavior === "allow"));
    if (picked?.length) return picked;
  }
  return undefined;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
