// A shell command as its card shows it, whether Claude ran it with Bash or you ran it with `!`:
// what it does, how it went, and the one line of its output that says the most.
import { duration } from "./format";
import { taskKind, type Item, type ShellItem, type State, type ToolCall, type WorkflowPhase } from "./state";
import { bashOutput, field, plural } from "./tools";

export type RunStatus = "running" | "waiting" | "done" | "error" | "denied" | "stopped";

export type Run = {
  /** What the command does, in Claude's words, or the command itself for one you ran. */
  headline: string;
  command: string;
  /** You ran it with `!`. */
  yours: boolean;
  status: RunStatus;
  /** Running in the background, or how it ended there, where that's known. */
  background?: "running" | "completed" | "failed" | "stopped" | "unknown";
  /** Moved to the background after this long, by Claude Code's timeout. */
  timedOutAfterMs?: number;
  /** The task to open for its output while it runs in the background. */
  taskId?: string;
  stdout: string;
  stderr: string;
  /** The exit code, where known. */
  code: number | null;
  /** How long it ran, or has run so far. */
  ms?: number;
  /** What Claude Code made of it: a commit, a push, a pull request, or what an exit code means. */
  note?: string;
  interrupted: boolean;
};

/** A Bash call as a run. */
export function runOfCall(call: ToolCall, waiting: boolean): Run {
  const input = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  const output = bashOutput(call.output);
  const result = call.result ?? "";
  // A failed command's result starts with its exit code, then what it printed.
  const exit = /^Exit code (\d+)\n?/.exec(result);
  const said = output ?? { stdout: exit ? result.slice(exit[0].length) : result, stderr: "" };
  const timedOut = field(call.output, "timedOutAfterMs");
  const taskId = field(call.output, "backgroundTaskId");
  const ms = call.startedAt !== undefined && call.endedAt !== undefined ? call.endedAt - call.startedAt : call.elapsed !== undefined ? call.elapsed * 1000 : undefined;
  return {
    headline: input("description") || firstLine(input("command")),
    command: input("command"),
    yours: false,
    status: waiting ? "waiting" : call.status,
    background: call.background,
    timedOutAfterMs: typeof timedOut === "number" ? timedOut : undefined,
    taskId: typeof taskId === "string" ? taskId : undefined,
    stdout: /^\(\w+ completed with no output\)$/.test(said.stdout.trim()) ? "" : said.stdout,
    stderr: said.stderr,
    code: exit ? Number(exit[1]) : call.status === "done" ? 0 : null,
    ms,
    note: gitNote(field(call.output, "gitOperation")) || stringOr(field(call.output, "returnCodeInterpretation")),
    interrupted: field(call.output, "interrupted") === true,
  };
}

/** A command you ran with `!` as a run. */
export function runOfShell(item: ShellItem): Run {
  const end = item.endedAt ?? item.at;
  return {
    headline: firstLine(item.command),
    command: item.command,
    yours: true,
    status: item.status,
    background: item.background && item.status === "running" ? "running" : undefined,
    stdout: item.stdout,
    stderr: item.stderr,
    code: item.code ?? (item.status === "done" ? 0 : null),
    ms: item.startedAt !== undefined && end !== undefined ? end - item.startedAt : undefined,
    interrupted: false,
  };
}

/** How a run went, in a few words for the end of its headline: `✓ 3.2s`, `✕ exit 1 · 8s`. */
export function runStatus(run: Run): { text: string; tone: Tone } {
  const took = run.ms !== undefined && run.ms >= 1000 ? duration(run.ms) : run.ms !== undefined ? `${(run.ms / 1000).toFixed(1)}s` : "";
  if (run.status === "waiting") return { text: "waiting for you", tone: "you" };
  if (run.background === "running") return { text: "◌ in the background", tone: "claude" };
  switch (run.status) {
    case "running":
      return { text: took ? `running ${took}` : "running", tone: "quiet" };
    case "denied":
      return { text: "denied", tone: "stopped" };
    case "stopped":
      return { text: took ? `■ stopped after ${took}` : "■ stopped", tone: "stopped" };
    case "error":
      return { text: [run.code !== null ? `✕ exit ${run.code}` : "✕ failed", took].filter(Boolean).join(" · "), tone: "failed" };
    case "done":
      if (run.background === "failed") return { text: "✕ failed in the background", tone: "failed" };
      if (run.background === "stopped") return { text: "■ stopped in the background", tone: "stopped" };
      if (run.background === "completed") return { text: "✓ in the background", tone: "claude" };
      if (run.background === "unknown") return { text: "◌ in the background", tone: "quiet" };
      return { text: took ? `✓ ${took}` : "✓", tone: "claude" };
  }
}

export type Tone = "quiet" | "claude" | "you" | "failed" | "stopped";

/**
 * The line that says the most about how it went: what Claude Code made of it (a commit, a push),
 * a line of totals such as a test run's, or else the last line it printed.
 */
export function runInsight(run: Run): { text: string; tone: Tone } {
  if (run.status === "waiting") return { text: "Claude wants to run this", tone: "you" };
  if (run.status === "denied") return { text: "You didn't let it run", tone: "stopped" };
  if (run.background === "running") {
    const after = run.timedOutAfterMs ? ` after ${duration(run.timedOutAfterMs)}` : "";
    return { text: run.yours ? "Still running. /tasks shows it as it goes" : `Moved to the background${after}. /tasks shows it as it goes`, tone: "quiet" };
  }
  if (run.background === "unknown") return { text: "Ran in the background", tone: "quiet" };
  if (run.background && !run.yours) return { text: "Ran in the background. /tasks has its output", tone: "quiet" };
  const all = [run.stdout, run.stderr].filter((text) => text.trim()).join("\n");
  if (run.status === "running") return { text: lastLine(all) || "Waiting for output…", tone: "quiet" };
  if (run.note) return { text: run.note, tone: run.status === "error" ? "failed" : "claude" };
  if (run.interrupted) return { text: "Interrupted", tone: "stopped" };
  // A failure's error lines follow this one, so it's the first of them, unless there are totals.
  const line = totalsLine(all) || (run.status === "error" ? failureLines(run, FAILURE_LINES)[0] : "") || lastLine(all);
  return { text: line || "No output", tone: line && run.status === "error" ? "failed" : "quiet" };
}

/** Lines of a failed command's errors its card keeps. */
export const FAILURE_LINES = 3;

/** How much it printed: `214 lines`, or nothing when it printed nothing or is still printing. */
export function runSize(run: Run) {
  // Claude's command in the background answered with a note on where its output goes, not output.
  if (run.status === "running" || run.background === "running" || (run.background && !run.yours)) return "";
  const lines = lineCount([run.stdout, run.stderr].filter((text) => text.trim()).join("\n"));
  return lines ? plural(lines, "line") : "";
}

/** The last lines of what a failed run printed, its errors first if it kept them apart. */
export function failureLines(run: Run, count: number) {
  if (run.status !== "error") return [];
  const text = run.stderr.trim() ? run.stderr : run.stdout;
  return meaningful(text).slice(-count);
}

/** A running command's last `count` lines, for its live card. */
export function tailLines(run: Run, count: number) {
  return run.stdout.replace(/\n+$/, "").split("\n").slice(-count);
}

/** A line of totals, as test runners, linters, installers and git print last: `14 pass · 0 fail`. */
const TOTALS = /\b\d+\s+(?:pass(?:ed|ing)?|fail(?:ed|ures?|ing)?|errors?|warnings?|tests?|skipped|todo|files? changed|insertions?|deletions?|packages?|problems?|issues?)\b/i;

function totalsLine(text: string) {
  const lines = meaningful(text).slice(-20);
  return lines.findLast((line) => TOTALS.test(line)) ?? "";
}

function lastLine(text: string) {
  return meaningful(text).at(-1) ?? "";
}

/** Lines with words in them, without color codes or the box drawing and rules around them. */
function meaningful(text: string) {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
}

/** Claude Code's reading of a git or gh command: `committed 9f2c1ab on main`, `pushed main`. */
function gitNote(operation: unknown) {
  const notes: string[] = [];
  const commit = field(operation, "commit");
  const sha = field(commit, "sha");
  if (typeof sha === "string") {
    const kind = stringOr(field(commit, "kind")) || "committed";
    const branch = stringOr(field(commit, "branch"));
    notes.push(`${kind} ${sha.slice(0, 7)}${branch ? ` on ${branch}` : ""}`);
  }
  const pushed = stringOr(field(field(operation, "push"), "branch"));
  if (pushed) notes.push(`pushed ${pushed}`);
  const branch = field(operation, "branch");
  const ref = stringOr(field(branch, "ref"));
  if (ref) notes.push(`${stringOr(field(branch, "action"))} ${ref}`);
  const pr = field(operation, "pr");
  const number = field(pr, "number");
  if (typeof number === "number") notes.push(`pull request #${number} ${stringOr(field(pr, "action")).replaceAll("-", " ")}`);
  return notes.join(" · ");
}

function stringOr(value: unknown) {
  return typeof value === "string" ? value : "";
}

function lineCount(text: string) {
  return text.trim() ? text.replace(/\n+$/, "").split("\n").length : 0;
}

function firstLine(text: string) {
  const [first = ""] = text.trim().split("\n");
  return text.trim().includes("\n") ? `${first} …` : first;
}

/**
 * Something running alongside the conversation, or that ran there: a task of Claude Code's in the
 * background, a subagent Claude waits on, or a command you ran with `!`. `key` names it for the
 * task view.
 */
export type Running = {
  key: string;
  /** What sort of work it is: `your command`, `command`, `subagent`, `monitor`, `workflow`. */
  kind: string;
  title: string;
  command?: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt?: number;
  endedAt?: number;
  /** Claude Code's task, to read its output and stop it. */
  taskId?: string;
  /** A subagent Claude waits on, by the tool call that started it, which can move it to the background. */
  foreground?: string;
  /** Your command's id. */
  shellId?: string;
  /** Claude Code can read out what it printed, as it can for a command or a Monitor. */
  hasOutput: boolean;
  /** A subagent's id, which names the transcript Claude Code keeps for it. */
  agentId?: string;
  /** The tool call that started it, which keys a subagent's transcript from the stream (`agentLogs`). */
  toolUseId?: string;
  /** For a subagent or workflow: what it's doing, its last tool, and how much it has done. */
  summary?: string;
  lastTool?: string;
  tokens?: number;
  toolUses?: number;
  /** A workflow's phases and their agents. */
  workflow?: WorkflowPhase[];
};

/**
 * What runs alongside the conversation, and what ran there in this Claude Code process: running
 * first, then ended, newest first in each. Subagents Claude waits on are here too, so you can watch
 * them. Your commands show only while they run, since their cards hold how they ended.
 */
export function runningList(state: State): Running[] {
  const shells = state.items.flatMap((item) => (item.kind === "shell" && item.status === "running" ? [shellEntry(item)] : []));
  const tasks = Object.values(state.taskInfo)
    .filter((task) => task.background || task.type === "local_agent")
    .map((task): Running => {
      const index = task.toolUseId ? state.tools[task.toolUseId] : undefined;
      const item = index === undefined ? undefined : state.items[index];
      const call = item?.kind === "tool" ? item.call : undefined;
      const command = typeof call?.input.command === "string" ? call.input.command : undefined;
      const kind = taskKind(state, task);
      return {
        key: `task:${task.id}`,
        kind,
        title: task.workflowName && task.workflowName !== task.description ? `${task.workflowName} · ${task.description}` : task.description,
        command,
        status: task.status,
        startedAt: task.startedAt,
        endedAt: task.endedAt,
        taskId: task.id,
        foreground: !task.background && task.status === "running" ? task.toolUseId : undefined,
        hasOutput: kind === "command" || kind === "monitor",
        agentId: kind === "subagent" && task.type === "local_agent" ? task.id : undefined,
        toolUseId: task.toolUseId,
        summary: task.summary,
        lastTool: task.lastTool,
        tokens: task.tokens,
        toolUses: task.toolUses,
        workflow: task.workflow,
      };
    });
  const newest = (a: Running, b: Running) => (b.startedAt ?? 0) - (a.startedAt ?? 0);
  const all = [...shells, ...tasks];
  return [...all.filter((one) => one.status === "running").sort(newest), ...all.filter((one) => one.status !== "running").sort(newest)];
}

/** What's open in the task view, by its key, even once it has ended. */
export function findRunning(state: State, key: string) {
  const shell = key.startsWith("shell:") ? state.items.find((item): item is ShellItem => item.kind === "shell" && `shell:${item.id}` === key) : undefined;
  return shell ? shellEntry(shell) : runningList(state).find((one) => one.key === key);
}

function shellEntry(item: ShellItem): Running {
  const status = item.status === "done" ? "completed" : item.status === "error" ? "failed" : item.status;
  return {
    key: `shell:${item.id}`,
    kind: "your command",
    title: firstLine(item.command),
    command: item.command,
    status,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    shellId: item.id,
    hasOutput: true,
  };
}

/**
 * The task to open for a transcript entry: a command of yours still running, a subagent Claude is
 * waiting on, or one of Claude's in the background.
 */
export function runningKeyOf(item: Item, state: State) {
  if (item.kind === "shell") return item.status === "running" ? `shell:${item.id}` : undefined;
  if (item.kind !== "tool") return undefined;
  if (!item.call.background) {
    if (item.call.status !== "running") return undefined;
    const task = Object.values(state.taskInfo).find((one) => one.toolUseId === item.call.id && one.type === "local_agent");
    return task ? `task:${task.id}` : undefined;
  }
  const taskId = item.call.taskId ?? field(item.call.output, "backgroundTaskId");
  return typeof taskId === "string" && state.taskInfo[taskId] ? `task:${taskId}` : undefined;
}
