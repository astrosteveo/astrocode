import {
  query,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Decision, PermissionRequest, ServerEvent } from "./protocol";
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
  emit: (event: ServerEvent) => void;
};

/** One running Claude Code process. A session starts a new run after a reset or a crash. */
type Run = { query: Query; inbox: AsyncQueue<SDKUserMessage>; closing: boolean };

type Pending = { run: Run; request: PermissionRequest; resolve: (result: PermissionResult) => void };

/**
 * One Claude Code session, driven through the Agent SDK in streaming-input mode.
 *
 * The SDK runs the Claude Code binary, so this uses the same login as `claude`
 * (your subscription, unless ANTHROPIC_API_KEY is set) and loads the same
 * settings, CLAUDE.md files, skills, plugins, hooks and MCP servers.
 */
export class AgentSession {
  private run: Run | null = null;
  private pending = new Map<string, Pending>();
  private sessionId: string | undefined;
  private mode: PermissionMode = "default";
  private resumeFrom: string | undefined;
  private continueLast: boolean;

  constructor(private readonly options: SessionOptions) {
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
        model: this.options.model,
        resume: this.sessionId ?? this.resumeFrom,
        continue: this.sessionId === undefined && this.resumeFrom === undefined && this.continueLast ? true : undefined,
        // Without an explicit mode, Claude Code starts in the mode from your settings, which
        // can skip our prompts. Start by asking; the page can switch modes, bypass included.
        permissionMode: this.mode,
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code" },
        // There's no question UI yet, so Claude asks its questions in plain text instead.
        disallowedTools: ["AskUserQuestion"],
        canUseTool: (toolName, input, context) => this.ask(run, toolName, input, context),
        stderr: this.options.onStderr ?? ((data) => process.stderr.write(`[claude] ${data}`)),
        env: topLevelEnv(),
      },
    });
    run = { query: q, inbox, closing: false };
    this.run = run;
    void this.pump(run);
    void this.announceAccount(run);
  }

  send(text: string) {
    this.start();
    this.options.emit({ kind: "prompt", text });
    this.run?.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
  }

  decide(id: string, decision: Decision) {
    this.settle(id, decision);
  }

  async interrupt() {
    await this.run?.query.interrupt();
  }

  async setMode(mode: PermissionMode) {
    await this.run?.query.setPermissionMode(mode);
    this.mode = mode;
    this.options.emit({ kind: "mode", mode });
  }

  /** Stops Claude Code and forgets the conversation, so the next start begins a new one. */
  reset() {
    this.close();
    this.sessionId = undefined;
    this.resumeFrom = undefined;
    this.continueLast = false;
  }

  close() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.closing = true;
    this.cancelPending(run, false);
    run.inbox.close();
    run.query.close();
  }

  private ask(run: Run, toolName: string, input: Record<string, unknown>, context: Parameters<CanUseTool>[2]) {
    return new Promise<PermissionResult>((resolve) => {
      const request: PermissionRequest = {
        id: context.toolUseID,
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
      this.pending.set(request.id, { run, request, resolve });
      context.signal.addEventListener("abort", () => this.settle(request.id, "cancelled"), { once: true });
      this.options.emit({ kind: "permission", request });
    });
  }

  private settle(id: string, decision: Decision | "cancelled", announce = true) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const { request, resolve } = pending;
    if (decision === "allow" || decision === "always") {
      resolve({
        behavior: "allow",
        updatedInput: request.input,
        updatedPermissions: decision === "always" ? request.alwaysAllow : undefined,
      });
    } else if (decision === "deny") {
      // Like saying no in Claude Code: the turn stops and Claude waits for you.
      resolve({ behavior: "deny", message: "The user declined this action. Wait for them to say how to proceed.", interrupt: true });
    } else {
      resolve({ behavior: "deny", message: "The request was cancelled." });
    }
    if (announce) this.options.emit({ kind: "permission_resolved", id, decision });
  }

  private cancelPending(run: Run, announce: boolean) {
    for (const [id, pending] of [...this.pending]) {
      if (pending.run === run) this.settle(id, "cancelled", announce);
    }
  }

  private async pump(run: Run) {
    try {
      for await (const message of run.query) {
        if (run.closing) break;
        if ("session_id" in message && message.session_id) this.sessionId = message.session_id;
        if (message.type === "system" && message.subtype === "init") this.mode = message.permissionMode;
        this.options.emit({ kind: "sdk", message });
      }
    } catch (error) {
      if (!run.closing) this.options.emit({ kind: "notice", tone: "error", text: `Claude Code stopped: ${messageOf(error)}` });
    } finally {
      if (this.run === run) this.run = null;
      this.cancelPending(run, !run.closing);
    }
  }

  private async announceAccount(run: Run) {
    try {
      const { account } = await run.query.initializationResult();
      if (run.closing) return;
      this.options.emit({
        kind: "account",
        subscriptionType: account.subscriptionType,
        apiKeySource: account.apiKeySource,
        apiProvider: account.apiProvider,
      });
    } catch {
      // A failed start is reported by pump().
    }
  }
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
