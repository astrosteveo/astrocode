import {
  query,
  type AccountInfo,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Answers, Decision, PermissionRequest, Question, SessionEvent } from "./events";
import { AsyncQueue } from "./queue";

export type SessionOptions = {
  /** The project Claude works in. */
  cwd: string;
  /** Leave unset to use Claude Code's default model. */
  model?: string;
  /** A saved session to pick up instead of starting a new one. */
  resume?: string;
  /** Pick up the most recent session in `cwd`. */
  continue?: boolean;
  /** Where Claude Code's own stderr goes. Defaults to this process's stderr. */
  onStderr?: (data: string) => void;
  emit: (event: SessionEvent) => void;
};

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
  private mode: PermissionMode = "default";
  private model: string | undefined;
  private resumeFrom: string | undefined;
  private continueLast: boolean;

  constructor(private readonly options: SessionOptions) {
    this.model = options.model;
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
        resume: this.sessionId ?? this.resumeFrom,
        continue: this.sessionId === undefined && this.resumeFrom === undefined && this.continueLast ? true : undefined,
        // Without an explicit mode, Claude Code starts in the mode from your settings, which
        // can skip our prompts. Start by asking; Shift+Tab can switch modes, bypass included.
        permissionMode: this.mode,
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code" },
        canUseTool: (toolName, input, context) => this.ask(run, toolName, input, context),
        stderr: this.options.onStderr ?? ((data) => process.stderr.write(`[claude] ${data}`)),
        env: topLevelEnv(),
      },
    });
    run = { query: q, inbox, closing: false };
    this.run = run;
    void this.pump(run);
    void this.announce(run);
  }

  send(text: string) {
    this.start();
    this.options.emit({ kind: "prompt", text });
    this.run?.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
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

  /** Stops Claude Code and forgets the conversation, so the next start begins a new one. */
  reset() {
    this.close();
    this.sessionId = undefined;
    this.resumeFrom = undefined;
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
        this.options.emit({ kind: "sdk", message });
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
    try {
      const init = await run.query.initializationResult();
      if (run.closing) return;
      this.options.emit({
        kind: "ready",
        plan: planOf(init.account),
        models: init.models.map((model) => ({ value: model.value, name: model.displayName, description: model.description })),
        commands: init.commands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint ?? "",
        })),
      });
      // A model chosen at launch is known now; Claude Code's own default arrives with the first reply.
      if (this.model) this.options.emit({ kind: "model", model: this.model });
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
function topLevelEnv() {
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
