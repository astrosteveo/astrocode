// Claude Code's background sessions, the ones `claude agents` shows. They're listed with
// `claude agents --json --all`, which Claude Code's docs give as the way to read them, and filled
// in from each one's `jobs/<id>/state.json`: its summary line, result and pull requests. The docs
// say those files aren't a stable interface, so everything read from them is optional, and a row
// without it still shows its state.
import type { EffortLevel, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { installedClaude } from "./claude";
import { configDir } from "./claude-dir";

export type AgentState = "working" | "blocked" | "done" | "failed" | "stopped";

export type Agent = {
  /** The short id `claude attach`, `stop` and `rm` take. */
  id: string;
  /** The conversation's id, which resumes it. */
  sessionId?: string;
  name: string;
  /** Where it works, which can be a worktree. */
  cwd: string;
  /** The project it was started in, which it's listed under. */
  folder: string;
  state: AgentState;
  /** Whether its Claude Code is running. A finished one stops after an hour unattended. */
  alive: boolean;
  /** busy, waiting or idle, while it runs. */
  status?: string;
  /** What it waits on while `status` is waiting, such as a permission prompt. */
  waitingFor?: string;
  createdAt: number;
  /** When its state or summary last changed. */
  updatedAt: number;
  /** What it was asked to do. */
  intent?: string;
  /** What it says it's doing, or the question it's asking. */
  detail?: string;
  /** What it said it got done, once it's done. */
  result?: string;
  prs: { id: string; href: string }[];
};

/** The model, effort and permission mode a session started or moved here runs with. */
export type SessionSettings = { model?: string; effort?: EffortLevel; mode?: PermissionMode };

export const STATE_LABELS: Record<AgentState, string> = {
  working: "Working",
  blocked: "Needs input",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

const STATES = new Set<string>(Object.keys(STATE_LABELS));

/** Every background session, running or finished, with what its job file says of it. */
export async function listAgents(): Promise<Agent[]> {
  const rows = await agentRows(["--all"]);
  const jobs = await Promise.all(rows.map((row) => readJob(row.id)));
  return rows.map((row, i) => toAgent(row, jobs[i]));
}

/** The background sessions running now, as `claude agents --json` lists them: enough to tell which wait on you. */
export async function runningAgents(): Promise<Agent[]> {
  return (await agentRows([])).map((row) => toAgent(row, undefined));
}

async function agentRows(more: string[]) {
  const { out, err, code } = await installedClaude(homedir(), ["agents", "--json", ...more]);
  if (code !== 0) throw new Error(`claude agents failed: ${(err || out).trim() || `exit ${code}`}`);
  return parseAgentList(out);
}

async function readJob(id: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(configDir(), "jobs", id, "state.json"), "utf8"));
  } catch {
    return undefined;
  }
}

type Row = { id: string; cwd: string; startedAt: number; state: AgentState; pid?: number; status?: string; waitingFor?: string; sessionId?: string; name?: string };

/** The background sessions in `claude agents --json`'s output. Interactive sessions in other terminals aren't agents until they're backgrounded. */
export function parseAgentList(json: string): Row[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("claude agents --json didn't print a list.");
  return parsed.flatMap((value): Row[] => {
    const row = record(value);
    const id = text(row.id);
    const cwd = text(row.cwd);
    if (row.kind !== "background" || !id || !cwd) return [];
    return [
      {
        id,
        cwd,
        startedAt: typeof row.startedAt === "number" ? row.startedAt : 0,
        state: STATES.has(String(row.state)) ? (row.state as AgentState) : "stopped",
        pid: typeof row.pid === "number" ? row.pid : undefined,
        status: text(row.status),
        waitingFor: text(row.waitingFor),
        sessionId: text(row.sessionId),
        name: text(row.name),
      },
    ];
  });
}

/** A row of `claude agents --json`, filled in from its job file where that has more. */
export function toAgent(row: Row, job: unknown): Agent {
  const fields = record(job);
  const output = record(fields.output);
  const children = Array.isArray(fields.children) ? fields.children.map(record) : [];
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name ?? text(fields.name) ?? row.id,
    cwd: row.cwd,
    folder: text(fields.originCwd) ?? projectOf(row.cwd),
    state: row.state,
    alive: row.pid !== undefined,
    status: row.status,
    waitingFor: row.waitingFor,
    createdAt: time(fields.createdAt) ?? row.startedAt,
    updatedAt: time(fields.updatedAt) ?? row.startedAt,
    intent: text(fields.intent),
    detail: text(fields.detail),
    result: text(output.result),
    prs: children.flatMap((child) => (child.kind === "pr" && text(child.id) && text(child.href) ? [{ id: String(child.id), href: String(child.href) }] : [])),
  };
}

/** The project a worktree of Claude Code's belongs to. */
export function projectOf(cwd: string) {
  return cwd.replace(/\/\.claude\/worktrees\/[^/]+$/, "");
}

/** What a row says after its state: the result of one that's done, else what it's doing or asking. */
export function summary(agent: Agent) {
  return (agent.state === "done" ? (agent.result ?? agent.detail) : (agent.detail ?? agent.intent)) ?? "";
}

/** Its pull requests, briefly: `#22`, or `2 PRs`. */
export function prLabel(agent: Agent) {
  if (agent.prs.length === 0) return "";
  return agent.prs.length === 1 ? `#${agent.prs[0]?.id}` : `${agent.prs.length} PRs`;
}

/**
 * Whether it waits on you. A session can be listed as needing input while it's idle, only waiting
 * for a prompt, as a conversation handed to the background service is until it's sent one.
 */
export function waitsOnYou(agent: Agent) {
  return agent.state === "blocked" && agent.status !== "idle";
}

/**
 * Whether opening it means joining it where it runs, with `claude attach`: it's working or waiting
 * on you, and taking it over would cut that off. The rest can be moved into astrocode, which a
 * session only waiting for a prompt loses nothing by.
 */
export function attaches(agent: Agent) {
  if (!agent.alive) return false;
  if (agent.state === "blocked") return waitsOnYou(agent);
  return agent.state === "working" || agent.status === "busy" || agent.status === "waiting";
}

/**
 * Whether `claude attach` has turned into Claude Code's agent view, which ← in it opens, by
 * replacing itself with `claude agents`. astrocode's agents view is the one to go back to.
 */
export function leftForAgentView(argv: string[]) {
  return argv[1] === "agents";
}

/**
 * Sessions by the project they were started in: `here`'s first, the rest by path, each oldest
 * first. Each of `folders` has a group too, empty if nothing ran there.
 */
export function groupAgents(agents: Agent[], here: string, folders: string[] = []) {
  const groups = new Map<string, Agent[]>(folders.map((folder) => [folder, []]));
  for (const agent of [...agents].sort((a, b) => a.createdAt - b.createdAt)) {
    const group = groups.get(agent.folder) ?? [];
    group.push(agent);
    groups.set(agent.folder, group);
  }
  const project = projectOf(here);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === project ? -1 : b === project ? 1 : a.localeCompare(b)))
    .map(([folder, members]) => ({ folder, agents: members }));
}

/** Fails when `cwd` is gone, which an older project's folder can be: a session started there would only say ENOENT. */
export function checkFolder(cwd: string) {
  if (!existsSync(cwd)) throw new Error(`${cwd} is gone.`);
}

/**
 * Hands a conversation to Claude Code's background service, which carries it on under the same
 * session id, idle until it's given a prompt, and gives its id.
 */
export async function moveToBackground(sessionId: string, cwd: string, settings: SessionSettings) {
  return backgrounded(await installedClaude(cwd, backgroundArgs(sessionId, settings, await listAgents())));
}

/**
 * `claude --bg --resume`'s arguments. A conversation that already has a background session goes
 * back to it as it was: Claude Code keeps that session's options, and flags would start a copy
 * of it instead. One that never ran there takes the settings it had here.
 */
export function backgroundArgs(sessionId: string, settings: SessionSettings, agents: Agent[]) {
  const known = agents.some((agent) => agent.sessionId === sessionId);
  return ["--bg", "--resume", sessionId, ...(known ? [] : flags(settings))];
}

/** Stops a session. Its conversation is kept, to resume. */
export async function stopAgent(id: string) {
  checked(await installedClaude(homedir(), ["stop", id]), "stop");
}

/** Deletes a session from the list, and its worktree where Claude Code finds that safe. */
export async function removeAgent(id: string) {
  checked(await installedClaude(homedir(), ["rm", id]), "rm");
}

function flags({ model, effort, mode }: SessionSettings) {
  return [...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), ...(mode ? ["--permission-mode", mode] : [])];
}

/** The id in `claude --bg`'s `backgrounded · 7c5dcf5d · name`. */
export function backgroundedId(out: string) {
  return /backgrounded · ([0-9a-f]+)/.exec(out)?.[1];
}

function backgrounded(result: { out: string; err: string; code: number }) {
  const id = backgroundedId(result.out);
  if (result.code !== 0 || !id) throw new Error((result.err || result.out).trim() || `claude --bg exited with ${result.code}`);
  return id;
}

function checked(result: { out: string; err: string; code: number }, command: string) {
  if (result.code !== 0) throw new Error((result.err || result.out).trim() || `claude ${command} exited with ${result.code}`);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
}

function time(value: unknown) {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
}
