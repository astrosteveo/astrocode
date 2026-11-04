// The ledger a turn closes with: how long it took, the files it changed with their totals, how its
// last test run went, and what it did with git, as one line:
// `1m 40s · 3 files +58 −3 · 7 passed 1 failed · not committed`.
//
// The files are git's, from the working tree at the turn's edges, where the session could record
// them; else the edit tools' own diffs. The rest comes from the commands' results.
import type { FileChange } from "../events";
import { changed, type Part } from "./activity";
import { duration } from "./format";
import { runOfCall, testTotals } from "./runs";
import type { Item, ToolCall } from "./state";
import { field, plural } from "./tools";

type Turn = Extract<Item, { kind: "turn" }>;

/** What a turn did, as its closing line and its opened list read it. */
export type TurnWork = Pick<Turn, "files" | "commands" | "tests" | "commits" | "pushed" | "pr">;

const EDITS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/**
 * What the turn now ending did since the turn before it ended. A message you sent while Claude
 * worked, which it took mid-turn, doesn't split the turn. `git` is what git said the turn changed,
 * when the session could record its edges.
 */
export function turnWork(items: Item[], { cwd, home }: { cwd: string; home: string }, git?: { files: FileChange[]; commits: string[] }): TurnWork {
  const start = items.findLastIndex((item) => item.kind === "turn");
  const edits = new Map<string, FileChange>();
  const commands: string[] = [];
  const commits: string[] = [];
  const work: TurnWork = {};
  const claude = `${home}/.claude`;
  const inClaude = (path: string) => path === claude || path.startsWith(`${claude}/`);
  for (const item of items.slice(start + 1)) {
    if (item.kind !== "tool") continue;
    const { call } = item;
    const path = typeof call.input.file_path === "string" ? call.input.file_path : typeof call.input.notebook_path === "string" ? call.input.notebook_path : "";
    // Files under ~/.claude, such as a plan, aren't the project's, unless the project is there.
    if (EDITS.has(call.name) && call.status === "done" && path && (!inClaude(path) || inClaude(cwd))) {
      const counts = changed(call) ?? { added: 0, removed: 0 };
      const before = edits.get(path);
      edits.set(path, { path, added: (before?.added ?? 0) + counts.added, removed: (before?.removed ?? 0) + counts.removed });
    }
    if (call.name !== "Bash" || typeof call.input.command !== "string" || !ran(call)) continue;
    commands.push(call.input.command);
    const run = runOfCall(call, false);
    const tests = testTotals(`${run.stdout}\n${run.stderr}`);
    if (tests) work.tests = { passed: tests.passed, failed: tests.failed };
    // What Claude Code made of the command. It misses a commit made quietly, so git's word comes first.
    const operation = field(call.output, "gitOperation");
    const sha = field(field(operation, "commit"), "sha");
    if (typeof sha === "string") commits.push(sha.slice(0, 7));
    if (field(operation, "push") !== undefined) work.pushed = true;
    const pr = field(operation, "pr");
    const number = field(pr, "number");
    if (typeof number === "number") work.pr = { number, action: String(field(pr, "action") ?? "") };
  }
  work.files = git?.files ?? [...edits.values()];
  work.commands = commands;
  // Without git's word, a commit Claude Code saw is known, but not that there was none.
  work.commits = git?.commits ?? (commits.length ? commits : undefined);
  return work;
}

/** A command that failed, or was stopped as it ran, still ran. */
function ran(call: ToolCall) {
  return call.status === "done" || call.status === "error" || (call.status === "stopped" && !call.unanswered);
}

/** The line that closes a turn: `1m 40s · 3 files +58 −3 · 7 passed 1 failed · not committed`. */
export function ledgerLine(turn: Turn): Part[] {
  const readings: Part[][] = [];
  const took = duration(turn.durationMs);
  const reason = turn.detail?.split("\n")[0];
  if (turn.outcome === "failed") readings.push([{ text: reason ? `failed: ${reason}` : `failed after ${took}`, tone: "failed" }]);
  else if (turn.outcome === "stopped") readings.push([{ text: `stopped after ${took}`, tone: "stopped" }]);
  // A replayed turn whose messages carried no times says only what it did.
  else if (!turn.replayed || turn.durationMs > 0) readings.push([{ text: took, tone: "quiet" }]);
  const files = turn.files ?? [];
  const uncommitted = turn.commits?.length === 0 && files.length > 0;
  if (files.length) {
    const added = files.reduce((sum, file) => sum + file.added, 0);
    const removed = files.reduce((sum, file) => sum + file.removed, 0);
    readings.push([
      // Changes that aren't committed are what to read first.
      { text: plural(files.length, "file"), tone: uncommitted ? "bright" : "quiet" },
      ...(added ? [{ text: ` +${added}`, tone: "added" as const }] : []),
      ...(removed ? [{ text: ` −${removed}`, tone: "removed" as const }] : []),
    ]);
  }
  const tests = turn.tests;
  if (tests && (tests.passed || tests.failed)) {
    readings.push([
      ...(tests.passed ? [{ text: `${tests.passed} passed`, tone: "done" as const }] : []),
      ...(tests.failed ? [{ text: `${tests.passed ? " " : ""}${tests.failed} failed`, tone: "failed" as const }] : []),
    ]);
  }
  const commits = turn.commits ?? [];
  if (commits.length) {
    const more = commits.length - 1;
    readings.push([
      { text: "committed ", tone: "quiet" },
      { text: commits.at(-1)!, tone: "code" },
      ...(more ? [{ text: ` and ${more} more`, tone: "quiet" as const }] : []),
    ]);
  }
  if (turn.pushed) readings.push([{ text: "pushed", tone: "quiet" }]);
  if (turn.pr) readings.push([{ text: `PR #${turn.pr.number}${turn.pr.action === "created" ? "" : ` ${turn.pr.action.replaceAll("-", " ")}`}`, tone: "elsewhere" }]);
  if (uncommitted) readings.push([{ text: "not committed", tone: "stopped" }]);
  return readings.flatMap((parts, i) => (i ? [{ text: " · ", tone: "faint" as const }, ...parts] : parts));
}
