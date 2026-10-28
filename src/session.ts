import {
  getSessionMessages,
  getSubagentMessages,
  query,
  type AccountInfo,
  type CanUseTool,
  type EffortLevel,
  type ElicitationRequest as McpElicitation,
  type ElicitationResult,
  type McpSdkServerConfigWithInstance,
  type McpServerStatus,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { hooksListing, memoryDialog, permissionRules, sandboxDialog, skillsDialog, statusDialog } from "./dialogs";
import {
  imageBlocks,
  MODES,
  sdkEvent,
  type Answers,
  type CommandInfo,
  type Decision,
  type ElicitationAnswer,
  type ElicitationField,
  type ElicitationRequest,
  type ImageAttachment,
  type PermissionRequest,
  type Question,
  type RemoteControl,
  type SessionEvent,
} from "./events";
import { AsyncQueue } from "./queue";
import { SHOW_SERVER, SHOW_TOOL } from "./show";
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
  /** Claude Code writes a line every half minute on what each subagent is doing, for the task view. */
  agentSummaries?: boolean;
  /** Start with Remote Control on. */
  remoteControl?: boolean;
  /** Lets Claude show pictures, where the terminal can draw them. */
  visuals?: Visuals;
  /** Where Claude Code's own stderr goes. Defaults to this process's stderr. */
  onStderr?: (data: string) => void;
  emit: (event: SessionEvent) => void;
};

/**
 * What lets Claude show you pictures: the server with the `show` tool, made anew for each Claude
 * Code since a server runs in one at a time, and what Claude is told about drawing.
 * `htmlPreviews`: AskUserQuestion's previews are HTML, which the interface draws.
 */
export type Visuals = { server: () => McpSdkServerConfigWithInstance; instructions: string; htmlPreviews: boolean };

/** Where to sign in to an MCP server, and whether Claude Code waits on this machine for the browser to come back. */
export type McpSignIn = { url?: string; waits: boolean };

/** A side question asked with `/btw`, and Claude's answer. */
export type Aside = { question: string; response: string };

/** A background task's output, as the SDK's `SDKControlGetTaskOutputResponse` has it. */
export type TaskOutput = { output: string; total_bytes: number; truncated: boolean };

/** Thinking turned back on in a Claude Code that started without it: Claude Code's own largest default budget. */
const THINKING_BUDGET = 31_999;

/** What a keep-warm request asks for: as little as Claude can say. */
const WARM_PROMPT = "Reply with only the word ok.";

/** How a keep-warm request went: the tokens it read from the cache and wrote to it. */
export type Warmed = { read: number; written: number };

/** One running Claude Code process. A session starts a new run after a reset, a resume or a crash. */
type Run = { query: Query; inbox: AsyncQueue<SDKUserMessage>; closing: boolean };

/**
 * How a message goes: `later` waits for Claude's turn to end instead of joining it between tool
 * rounds; `ignoreUltracode` keeps its `ultracode` from starting a workflow.
 */
export type Sending = { later?: boolean; ignoreUltracode?: boolean };

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
  private elicitations = new Map<string, { run: Run; resolve: (result: ElicitationResult) => void }>();
  private sessionId: string | undefined;
  private mode: PermissionMode;
  private model: string | undefined;
  private effort: EffortLevel | undefined;
  private thinking: boolean | undefined;
  /** Ultracode asked for, for the session: kept through a restart, as an effort level is. */
  private ultracode = false;
  /** Fast mode, for the session: Opus with faster output. Kept through a restart. */
  private fast = false;
  /** Messages and notes go to Claude Code in order, each after whatever it waits on. */
  private outbox = Promise.resolve();
  /**
   * Messages sent with their `ultracode` ignored, by uuid, until Claude Code says their turns are
   * over. The keyword trigger stays off while any is left, so another message Claude Code starts on
   * meanwhile has its `ultracode` ignored too.
   */
  private ignoring = new Set<string>();
  /** The keyword trigger is off in Claude Code's flag settings. */
  private triggerOff = false;
  private agentSummaries: boolean;
  /** Whether the running Claude Code started with thinking off, which a null budget can't undo. */
  private startedWithoutThinking = false;
  private resumeFrom: string | undefined;
  private continueLast: boolean;
  /** Where a rewound conversation picks up: the last message kept. Until something new is sent. */
  private resumeAt: string | undefined;
  /** Remote Control asked for. It stays on through a restart of Claude Code, with a new link. */
  private remoteWanted: boolean;
  /** Remote Control as last reported, or null while it's off. */
  private remote: RemoteControl | null = null;
  /** The messages and notes sent from here that Claude Code hasn't echoed back yet, by uuid. */
  private sent = new Set<string>();

  constructor(private readonly options: SessionOptions) {
    this.model = options.model;
    this.effort = options.effort;
    this.thinking = options.thinking;
    this.mode = options.mode ?? "auto";
    this.resumeFrom = options.resume;
    this.continueLast = options.continue ?? false;
    this.agentSummaries = options.agentSummaries ?? false;
    this.remoteWanted = options.remoteControl ?? false;
  }

  /** The conversation's id, once Claude Code has reported it. */
  get id() {
    return this.sessionId;
  }

  /** The conversation's id as far as it's known: Claude Code's, else the one being resumed, before Claude Code has said. */
  get knownId() {
    return this.sessionId ?? this.resumeFrom;
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
        ...this.shared(),
        resume: this.sessionId ?? this.resumeFrom,
        resumeSessionAt: this.resumeAt,
        continue: this.sessionId === undefined && this.resumeFrom === undefined && this.continueLast ? true : undefined,
        includePartialMessages: true,
        // Backups of the files Claude changes, so rewinding can put them back.
        enableFileCheckpointing: true,
        // Each background task can be stopped on its own from the task view, so Esc stops only the
        // turn. Without this, Claude Code stops every background agent and workflow along with it.
        perTaskStopAffordance: true,
        agentProgressSummaries: this.agentSummaries,
        // Claude Code echoes every message back as it takes it. That's the only way a message sent
        // from claude.ai or the Claude app over Remote Control reaches astrocode; the rest are ours.
        extraArgs: { "replay-user-messages": null },
        settings: { ...(this.fast ? { fastMode: true } : {}), ...(this.ultracode ? { ultracode: true } : {}) },
        canUseTool: (toolName, input, context) => this.ask(run, toolName, input, context),
        onElicitation: (request, { signal }) => this.elicit(run, request, signal),
        stderr: this.options.onStderr ?? ((data) => process.stderr.write(`[claude] ${data}`)),
      },
    });
    run = { query: q, inbox, closing: false };
    // A new Claude Code process starts with no flag settings but those passed above.
    this.ignoring.clear();
    this.triggerOff = false;
    this.startedWithoutThinking = this.thinking === false;
    this.run = run;
    void this.pump(run);
    void this.announce(run);
  }

  /**
   * What the session's requests are made of, which a keep-warm request must match to read the same
   * prompt cache: the model, effort, thinking, mode, system prompt, tools and environment.
   */
  private shared(): Options {
    const visuals = this.options.visuals;
    return {
      cwd: this.options.cwd,
      model: this.model,
      effort: this.effort,
      thinking: this.thinking === false ? { type: "disabled" } : undefined,
      // Without an explicit mode, Claude Code starts in the mode from your settings, which can
      // skip our prompts. Start in auto, Claude Code's own default, unless you picked another:
      // its classifier allows what's safe and asks through canUseTool about the rest.
      permissionMode: this.mode,
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: "preset", preset: "claude_code", ...(visuals ? { append: visuals.instructions } : {}) },
      ...(visuals
        ? {
            mcpServers: { [SHOW_SERVER]: visuals.server() },
            // Showing a picture changes nothing, so it never asks.
            allowedTools: [SHOW_TOOL],
            toolConfig: { askUserQuestion: { previewFormat: visuals.htmlPreviews ? "html" : "markdown" } },
          }
        : {}),
      env: topLevelEnv(),
      // Fast mode makes its requests differently, so a keep-warm request matches it.
      settings: this.fast ? { fastMode: true } : undefined,
    };
  }

  /**
   * Keeps the conversation's prompt cache warm: one short request on a copy of the conversation
   * that isn't saved (`forkSession` with `persistSession: false`), so nothing is added to it. The
   * request starts with the same system prompt, tools and messages as the conversation's next one
   * would, so reading them from the cache keeps them there for another TTL. It runs in a Claude
   * Code of its own, which starts as any session does, hooks and MCP servers included. Null when
   * there's no conversation yet.
   */
  async warm(): Promise<Warmed | null> {
    const id = this.sessionId ?? this.resumeFrom;
    if (!id) return null;
    const q = query({
      prompt: WARM_PROMPT,
      options: {
        ...this.shared(),
        resume: id,
        resumeSessionAt: this.resumeAt,
        forkSession: true,
        persistSession: false,
        maxTurns: 1,
        canUseTool: async () => ({ behavior: "deny", message: "This request only keeps the cache warm." }),
        stderr: () => {},
      },
    });
    let warmed: Warmed | null = null;
    try {
      for await (const message of q) {
        if (message.type === "assistant" && !message.parent_tool_use_id) {
          const usage = message.message.usage;
          warmed = { read: usage?.cache_read_input_tokens ?? 0, written: usage?.cache_creation_input_tokens ?? 0 };
        }
        if (message.type === "result") break;
      }
    } finally {
      q.close();
    }
    return warmed;
  }

  /**
   * Sends a message, with the images its `[Image #n]` labels mention, by number, before its text.
   * Its uuid is the one rewinding goes back to.
   */
  send(text: string, images: ReadonlyMap<number, ImageAttachment> = new Map(), how: Sending = {}) {
    this.start();
    this.resumeAt = undefined;
    const uuid = randomUUID();
    this.sent.add(uuid);
    const mentions = mentionsIn(text, images);
    this.options.emit({ kind: "prompt", text, uuid, images: Object.fromEntries(mentions.map(({ n, image }) => [n, image])), at: Date.now(), later: how.later });
    const run = this.run;
    // Typed by a person: Claude Code acts on what only you can ask for, such as the ultracode
    // keyword or a skill named partway through, only in a message stamped as yours.
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: messageContent(text, mentions) },
      parent_tool_use_id: null,
      uuid,
      origin: { kind: "human" },
      priority: how.later ? "later" : undefined,
    };
    this.post(run, async () => {
      // Claude Code has no way to ignore the keyword in one message, and reads the trigger as it
      // starts on a message, so the trigger goes off before it arrives and back on once Claude
      // Code says the message's turn is over.
      if (how.ignoreUltracode && run) {
        if (!this.triggerOff) {
          this.triggerOff = true;
          await run.query.applyFlagSettings({ workflowKeywordTriggerEnabled: false }).catch(() => {});
        }
        this.ignoring.add(uuid);
      }
      return message;
    });
  }

  /**
   * Adds to the conversation without starting a turn, as a command run with `!` does. It goes to
   * Claude with the next message.
   */
  note(text: string) {
    this.start();
    const uuid = randomUUID();
    this.sent.add(uuid);
    this.post(this.run, async () => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, uuid, shouldQuery: false }));
  }

  /** Sends a message once those before it have gone, and whatever it waits on is done. */
  private post(run: Run | null, ready: () => Promise<SDKUserMessage>) {
    this.outbox = this.outbox
      .then(async () => {
        const message = await ready();
        if (run && !run.closing) run.inbox.push(message);
      })
      .catch((error: unknown) => {
        // The messages after it still go.
        this.options.emit({ kind: "notice", tone: "error", text: `A message couldn't be sent: ${messageOf(error)}` });
      });
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
   * What a subagent has said and done so far, from the transcript Claude Code keeps for it. Empty
   * before there's a conversation, or before the subagent has written anything.
   */
  async subagentMessages(agentId: string): Promise<SessionMessage[]> {
    const id = this.sessionId ?? this.resumeFrom;
    if (!id) return [];
    return getSubagentMessages(id, agentId, { dir: this.options.cwd }).catch(() => []);
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

  /**
   * Takes back a message sent while Claude works, if Claude Code hasn't started on it yet. True
   * when it was taken back; Claude Code then reports it cancelled.
   */
  async unqueue(uuid: string) {
    // In the SDK's code, answering `cancel_async_message`, but not in Query's type.
    const query = this.run?.query as (Query & { cancelAsyncMessage?: (uuid: string) => Promise<boolean> }) | undefined;
    if (!query?.cancelAsyncMessage) return false;
    try {
      return await query.cancelAsyncMessage(uuid);
    } catch {
      return false;
    }
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
    const run = this.run;
    await run?.query.setModel(model);
    this.model = model;
    this.options.emit({ kind: "model", model });
    // Whether ultracode can be on depends on the model.
    if (run) void this.reportUltracode(run);
  }

  /**
   * A level of its own turns ultracode off, as `/effort <level>` does in Claude Code. Claude Code
   * turns it off by itself only when the level changes, so it's asked to in so many words.
   */
  async setEffort(effort: EffortLevel) {
    await this.run?.query.applyFlagSettings(this.ultracode ? { effortLevel: effort, ultracode: false } : { effortLevel: effort });
    this.effort = effort;
    this.options.emit({ kind: "effort", effort });
    if (this.ultracode) {
      this.ultracode = false;
      this.options.emit({ kind: "ultracode", on: false });
    }
  }

  /**
   * Ultracode: Claude orchestrates a workflow of agents on every substantive task, for the rest of
   * the session. The effort level stays as it is. Claude Code refuses it where it isn't available.
   */
  async setUltracode(on: boolean) {
    const run = this.run;
    await run?.query.applyFlagSettings({ ultracode: on });
    this.ultracode = on;
    // Claude Code takes the request even where ultracode can't be on, and says so only in its settings.
    const active = run ? await this.reportUltracode(run) : undefined;
    if (active === undefined) this.options.emit({ kind: "ultracode", on });
    this.ultracode = active ?? on;
    return this.ultracode;
  }

  /**
   * Fast mode: Opus with faster output, for the session. Claude Code turns it on only for a host
   * that asks for it, and with an Opus model, which it switches to.
   */
  async setFastMode(on: boolean) {
    await this.run?.query.applyFlagSettings(on ? { fastMode: true, model: "opus" } : { fastMode: null });
    this.fast = on;
    this.options.emit({ kind: "fast", on });
    if (on) {
      this.model = "opus";
      this.options.emit({ kind: "model", model: "opus" });
    }
  }

  /** From the next start of Claude Code: a new session, or the next astrocode. */
  setAgentSummaries(on: boolean) {
    this.agentSummaries = on;
  }

  /**
   * Remote Control: the session can be reached from claude.ai/code and the Claude app, where your
   * messages and answers to its prompts go to Claude as typed here, until it's turned off or
   * astrocode quits. A restart of Claude Code, as after /clear, starts a new remote session with a
   * link of its own.
   */
  async setRemoteControl(on: boolean) {
    this.remoteWanted = on;
    const run = this.running();
    if (on) return this.connectRemote(run);
    this.reportRemote(null);
    await remoteOf(run).enableRemoteControl?.(false);
  }

  private async connectRemote(run: Run) {
    const query = remoteOf(run);
    if (!query.enableRemoteControl) throw new Error("This Agent SDK can't turn on Remote Control (enableRemoteControl is missing).");
    this.reportRemote({ status: "connecting" });
    try {
      const answer = await query.enableRemoteControl(true);
      if (run.closing || !this.remoteWanted) return;
      const url = field(answer, "session_url");
      // Claude Code may have said it's connected while this was on its way.
      this.reportRemote({ status: this.remote?.status ?? "connecting", url: typeof url === "string" && url ? url : undefined });
    } catch (error) {
      if (!run.closing && this.remoteWanted) this.reportRemote({ status: "failed", detail: messageOf(error) });
      throw error;
    }
  }

  /**
   * Claude Code's `bridge_state`, which isn't in the SDK's types: `ready` as it registers, then
   * `connected`, or `failed` with a `detail`, or `policy_disabled` where an organization turns it off.
   */
  private bridged(message: SDKMessage) {
    if (!this.remoteWanted || !this.remote) return;
    const state = field(message, "state");
    const detail = field(message, "detail");
    const status = state === "connected" ? "connected" : state === "failed" || state === "policy_disabled" ? "failed" : "connecting";
    const why = typeof detail === "string" && detail ? detail : state === "policy_disabled" ? "Your organization's policy turns Remote Control off." : undefined;
    this.reportRemote({ status, url: this.remote.url, detail: status === "connected" ? undefined : why });
  }

  private reportRemote(remote: RemoteControl | null) {
    this.remote = remote;
    this.options.emit({ kind: "remote", remote });
  }

  /**
   * A message Claude Code echoed back as it took it. One sent from here is in the transcript already.
   * One a person sent from elsewhere, as from claude.ai or the Claude app over Remote Control, comes
   * in as a message of yours: Claude Code stamps both human. True when it's dealt with.
   */
  private echoed(message: SDKMessage): boolean {
    if (message.type !== "user" || !("isReplay" in message) || !message.isReplay || message.parent_tool_use_id) return false;
    const content = message.message.content;
    if (Array.isArray(content) && content.some((block) => block.type === "tool_result")) return false;
    if (this.sent.delete(message.uuid)) return true;
    if (message.origin?.kind !== "human") return false;
    const text = typeof content === "string" ? content : content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    // Claude Code's own wrapped messages, such as a command's output, aren't anyone's typing.
    if (text.trimStart().startsWith("<")) return false;
    const images = imageBlocks(content);
    const labels = images.map((_, i) => `[Image #${i + 1}]`).join(" ");
    const at = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : NaN;
    this.options.emit({
      kind: "prompt",
      text: [text.trim(), labels].filter(Boolean).join(text.trim() ? " " : ""),
      uuid: message.uuid,
      images: images.length ? Object.fromEntries(images.map((image, i) => [i + 1, image])) : undefined,
      at: Number.isNaN(at) ? Date.now() : at,
      remote: true,
    });
    return true;
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

  /** The MCP servers Claude Code knows, how each is doing, and the tools each serves. */
  async mcpServers(): Promise<McpServerStatus[]> {
    return this.running().query.mcpServerStatus();
  }

  async reconnectMcp(name: string) {
    await this.running().query.reconnectMcpServer(name);
  }

  /** Claude Code remembers a server turned off for this project, as `claude` does. */
  async toggleMcp(name: string, on: boolean) {
    await this.running().query.toggleMcpServer(name, on);
  }

  /**
   * Starts signing in to an MCP server: the address to open, if there's one, and whether Claude
   * Code waits on this machine for the browser to come back to it. A claude.ai connector is signed
   * in on claude.ai instead, and needs reconnecting after.
   */
  async signInMcp(name: string): Promise<McpSignIn> {
    const answer = await this.untyped("mcpAuthenticate", name, undefined);
    const url = field(answer, "authUrl");
    return { url: typeof url === "string" && url ? url : undefined, waits: field(answer, "callbackExpected") === true };
  }

  /**
   * The address the browser ended on after signing in, for when it couldn't reach Claude Code on
   * this machine, as over SSH. Resolves once Claude Code has finished signing in.
   */
  async finishMcpSignIn(name: string, url: string) {
    await this.untyped("mcpSubmitOAuthCallbackUrl", name, url);
  }

  async signOutMcp(name: string) {
    await this.untyped("mcpClearAuth", name);
  }

  async permissionRules() {
    return permissionRules(await this.untyped("listPermissionRules"));
  }

  async memoryDialog() {
    return memoryDialog(await this.untyped("getMemoryDialog"));
  }

  async hooks() {
    return hooksListing(await this.untyped("getHooksListing"));
  }

  async skills() {
    return skillsDialog(await this.untyped("getSkillsDialog"));
  }

  async status() {
    return statusDialog(await this.untyped("getStatus"));
  }

  async sandbox() {
    return sandboxDialog(await this.untyped("getSandboxDialog"));
  }

  /** The conversation as text, as `claude`'s /export writes it, and the file name it suggests. */
  async exportConversation(): Promise<{ text: string; filename: string }> {
    const answer = await this.untyped("exportConversation");
    const text = field(answer, "text");
    const filename = field(answer, "default_filename");
    if (typeof text !== "string") throw new Error("Claude Code didn't send the conversation.");
    return { text, filename: typeof filename === "string" && filename ? filename : "conversation.txt" };
  }

  /**
   * A question on the side, as `/btw` asks it: Claude answers from the conversation so far, without
   * tools, while a turn goes on, and nothing goes into the conversation. `earlier` is the side
   * questions before it and their answers. Null when Claude Code had no answer.
   */
  async askAside(question: string, earlier: Aside[], signal?: AbortSignal): Promise<string | null> {
    const answer = await this.untyped("askSideQuestion", question, { history: earlier, signal });
    const response = field(answer, "response");
    return typeof response === "string" ? response : null;
  }

  /** The output styles there are, and the one in use, which is "default" unless your settings name another. */
  async outputStyles(): Promise<{ styles: string[]; current: string }> {
    const query = this.running().query as Query & { getSettings?: () => Promise<unknown> };
    const [{ available_output_styles: styles }, settings] = await Promise.all([query.reloadOutputStyles(), query.getSettings?.().catch(() => undefined)]);
    const current = field(field(settings, "effective"), "outputStyle");
    return { styles, current: typeof current === "string" && current ? current : "default" };
  }

  private running() {
    this.start();
    const run = this.run;
    if (!run) throw new Error("Claude Code isn't running.");
    return run;
  }

  /** One of the requests the SDK makes in its code but leaves out of Query's type. */
  private async untyped(name: string, ...args: unknown[]): Promise<unknown> {
    const query = this.running().query as unknown as Record<string, unknown>;
    const method = query[name];
    if (typeof method !== "function") throw new Error(`This Agent SDK can't ask Claude Code for that (${name} is missing).`);
    return (method as (...args: unknown[]) => Promise<unknown>).apply(query, args);
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
        context.signal.addEventListener("abort", () => this.withdraw(id), { once: true });
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
      context.signal.addEventListener("abort", () => this.withdraw(id), { once: true });
      this.options.emit({ kind: "permission", request });
    });
  }

  /**
   * A prompt or question Claude Code took back: after an interrupt, or once it was answered on
   * claude.ai or the Claude app over Remote Control. The tool call's result says how it went, or,
   * if none comes, the turn's end stops it.
   */
  private withdraw(id: string) {
    const waiting = this.permissions.get(id) ?? this.questions.get(id);
    if (!waiting) return;
    this.permissions.delete(id);
    this.questions.delete(id);
    waiting.resolve({ behavior: "deny", message: "The request was cancelled." });
    this.options.emit({ kind: "resolved", id, outcome: "withdrawn" });
  }

  /** Settles a permission prompt as Claude Code stops, as on /clear or a crash. */
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
    for (const [id, waiting] of [...this.elicitations]) {
      if (waiting.run !== run) continue;
      this.elicitations.delete(id);
      waiting.resolve({ action: "cancel" });
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
        if (this.echoed(message)) continue;
        if (message.type === "system" && field(message, "subtype") === "bridge_state") this.bridged(message);
        this.options.emit(sdkEvent(message, Date.now()));
        // Skills found as Claude works in a folder bring commands of their own.
        if (message.type === "system" && message.subtype === "commands_changed") this.options.emit({ kind: "commands", commands: message.commands.map(commandInfo) });
        // Not in the SDK's types: where each message is in Claude Code's queue. Every message gets
        // `queued`, `started`, and `completed` after its turn's result, or `cancelled`.
        if (field(message, "type") === "command_lifecycle") this.taken(run, field(message, "command_uuid"), field(message, "state"));
        if (message.type === "result") void this.reportContext(run);
      }
    } catch (error) {
      if (!run.closing) this.options.emit({ kind: "notice", tone: "error", text: `Claude Code stopped: ${messageOf(error)}` });
    } finally {
      if (this.run === run) this.run = null;
      this.cancelWaiting(run, !run.closing);
      // The link was to this Claude Code. The next one connects again, with a link of its own.
      if (this.remoteWanted && this.remote && !this.run) this.reportRemote({ status: "connecting" });
    }
  }

  /** A message sent with its `ultracode` ignored, done with once its turn is over or it's taken back. */
  private taken(run: Run, uuid: unknown, state: unknown) {
    if (typeof uuid !== "string" || !this.ignoring.has(uuid)) return;
    if (state === "completed" || state === "cancelled") {
      this.ignoring.delete(uuid);
      this.restoreKeyword(run);
    }
  }

  /** The ultracode keyword trigger back to whatever your settings say, once no message ignores it. */
  private restoreKeyword(run: Run) {
    if (this.ignoring.size || !this.triggerOff || run.closing) return;
    this.triggerOff = false;
    void run.query.applyFlagSettings({ workflowKeywordTriggerEnabled: null }).catch(() => {});
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
      if (this.remoteWanted) {
        this.connectRemote(run).catch((error: unknown) => {
          if (!run.closing) this.options.emit({ kind: "notice", tone: "error", text: `Remote Control couldn't start: ${messageOf(error)}` });
        });
      }
      await Promise.all([this.reportContext(run), this.reportUltracode(run)]);
    } catch {
      // A failed start is reported by pump().
    }
  }

  /**
   * Whether ultracode can be turned on, and whether it's on, from Claude Code's settings, which say
   * so for the model in use. `getSettings()` and its `applied` are in the SDK's code but not its
   * types. Returns whether it's on, if Claude Code said.
   */
  private async reportUltracode(run: Run) {
    const query = run.query as Query & { getSettings?: () => Promise<unknown> };
    try {
      const applied = field(await query.getSettings?.(), "applied");
      if (run.closing) return undefined;
      const available = field(applied, "ultracodeAvailable");
      const on = field(applied, "ultracode");
      if (typeof available === "boolean") this.options.emit({ kind: "ultracode-available", available });
      if (typeof on === "boolean") {
        // It can come on from Claude Code's own settings too; then a level picked must turn it off.
        this.ultracode = on;
        this.options.emit({ kind: "ultracode", on });
      }
      return typeof on === "boolean" ? on : undefined;
    } catch {
      // Without an answer, ultracode isn't offered.
      return undefined;
    }
  }

  /**
   * An MCP server's request for a form or a visit to an address, put to you. It's declined if the
   * turn stops first, and cancelled when Claude Code goes.
   */
  private elicit(run: Run, request: McpElicitation, signal: AbortSignal) {
    return new Promise<ElicitationResult>((resolve) => {
      const id = randomUUID();
      this.elicitations.set(id, { run, resolve });
      signal.addEventListener("abort", () => this.answerElicitation(id, { action: "cancel" }), { once: true });
      this.options.emit({
        kind: "elicitation",
        request: {
          id,
          server: request.displayName || request.serverName,
          message: request.message,
          title: request.title,
          mode: request.mode === "url" ? "url" : "form",
          url: request.url,
          fields: formFields(request.requestedSchema),
        },
      });
    });
  }

  answerElicitation(id: string, answer: ElicitationAnswer) {
    const waiting = this.elicitations.get(id);
    if (!waiting) return;
    this.elicitations.delete(id);
    waiting.resolve(answer);
    this.options.emit({ kind: "resolved", id, outcome: answer.action === "accept" ? "answered" : "cancelled" });
  }

  private async reportContext(run: Run) {
    try {
      // From the last response's usage, without asking the token-count API about each part.
      const usage = await run.query.getContextUsage({ detail: "summary" });
      if (run.closing) return;
      this.options.emit({ kind: "context", percentage: usage.percentage, tokens: usage.totalTokens, max: usage.maxTokens });
    } catch {
      // Context usage is a nicety; the session goes on without it.
    }
  }
}

/**
 * Remote Control's request, which the SDK has in its code, sending `remote_control`, but not in
 * Query's type. Claude Code answers turning it on with the link, `session_url`.
 */
function remoteOf(run: Run) {
  return run.query as Query & { enableRemoteControl?: (enabled: boolean) => Promise<unknown> };
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

/**
 * An MCP form's fields, from the JSON Schema it sent: an object whose properties are text, numbers,
 * yes or no, one of a list (`enum`, or `oneOf`/`anyOf` of `const`s), or several of it (an `array`
 * of those). Anything else is asked for as text. The server checks the answer against the schema,
 * so its limits come along to be checked before it goes.
 */
function formFields(schema: Record<string, unknown> | undefined): ElicitationField[] {
  const properties = field(schema, "properties");
  if (typeof properties !== "object" || properties === null) return [];
  const required = field(schema, "required");
  return Object.entries(properties as Record<string, unknown>).map(([name, property]): ElicitationField => {
    const text = (key: string) => {
      const value = field(property, key);
      return typeof value === "string" ? value : undefined;
    };
    const number = (key: string) => {
      const value = field(property, key);
      return typeof value === "number" ? value : undefined;
    };
    const type = text("type");
    const many = type === "array";
    const options = choicesIn(many ? field(property, "items") : property);
    const fallback = field(property, "default");
    const kind: ElicitationField["type"] = many ? "multi" : options?.length ? "enum" : type === "number" || type === "integer" || type === "boolean" ? type : "string";
    return {
      name,
      label: text("title") ?? name,
      description: text("description"),
      type: kind,
      required: Array.isArray(required) && required.includes(name),
      options: options?.length ? options : undefined,
      default:
        typeof fallback === "string" || typeof fallback === "number" || typeof fallback === "boolean"
          ? fallback
          : Array.isArray(fallback)
            ? fallback.map(String)
            : undefined,
      min: kind === "multi" ? number("minItems") : kind === "number" || kind === "integer" ? number("minimum") : number("minLength"),
      max: kind === "multi" ? number("maxItems") : kind === "number" || kind === "integer" ? number("maximum") : number("maxLength"),
      pattern: text("pattern"),
      format: text("format"),
    };
  });
}

/** The choices a schema offers: `enum` with its `enumNames`, or `oneOf`/`anyOf` of `const`s with their titles. */
function choicesIn(schema: unknown) {
  const values = field(schema, "enum");
  const names = field(schema, "enumNames");
  if (Array.isArray(values)) return values.map((value, i) => ({ value: String(value), label: Array.isArray(names) && typeof names[i] === "string" ? names[i] : String(value) }));
  const listed = field(schema, "oneOf") ?? field(schema, "anyOf");
  if (!Array.isArray(listed)) return undefined;
  return listed.flatMap((one) => (field(one, "const") !== undefined ? [{ value: String(field(one, "const")), label: String(field(one, "title") ?? field(one, "const")) }] : []));
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
