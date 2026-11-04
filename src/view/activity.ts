// A step's tool calls as an activity log: one line for each thing Claude did, in the order it did
// them, saying what it did (Searched, Read, Edited, Ran), what it acted on, and what came of it.
// The verb's tense says where the call is: `Reading` while it runs, `Read` as a request while it
// waits on you, `Read` once done, `Not run` when it never ran and `Stopped` when it was stopped.
// A command says what Claude said it does. Reads in a row are one line, and so are edits to one
// file in a row. A call that failed says why on a line of its own.
import { timed, took } from "./format";
import { failureLine, onlyLine, runOfCall, runSize, testCounts, type Run } from "./runs";
import type { ToolCall, ToolStatus } from "./state";
import { inPastTense, inPresentTense } from "./tense";
import { field, plural, shortPath, SHOW_TOOL, subagentCallCount, toolLabel, toolSummary, toolTarget } from "./tools";

/**
 * How a piece of a line is drawn: `plain` as text, `bright` brighter, `quiet` and `faint` stepping
 * back, `code` as inline code, and the rest in the colors of how things went.
 */
export type Tone = "plain" | "bright" | "quiet" | "faint" | "code" | "added" | "removed" | "done" | "failed" | "stopped" | "waiting";
export type Part = { text: string; tone: Tone };

export type ActivityRow = {
  /** The calls the line stands for, in order. A click on the line inspects the first. */
  calls: ToolCall[];
  verb: string;
  target: Part[];
  /** The target is a path, or paths, which keep their ends when cut to fit. */
  path: boolean;
  result: Part[];
  /** Lines an edit added and removed, drawn as a diffstat. */
  diff?: { added: number; removed: number };
  status: ToolStatus | "waiting";
  /** For a call that failed, the line that says the most about why. */
  failure?: string;
};

/** Tools whose calls read as one line when they come one after another. */
const GROUPED = new Set(["Read"]);
const EDITS = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const AGENTS = new Set(["Agent", "Task"]);

type Tense = "doing" | "ask" | "done";

/**
 * A call's verb as it runs (`Reading`), as a request while it waits on you (`Read`) and once done
 * (`Read`). `rest`: what follows the verb in each tense, where that changes with it, as in a
 * command's description. `bare`: its target reads on its own after `Not run`, as a command does.
 */
type Verbs = Record<Tense, string> & { rest?: Record<Tense, string>; bare?: boolean };

const firstWord = (text: string): [string, string] => {
  const space = text.indexOf(" ");
  return space < 0 ? [text, ""] : [text.slice(0, space), text.slice(space + 1)];
};

const verbs = (doing: string, ask: string, done: string): Verbs => ({ doing, ask, done });
const SEARCH = verbs("Searching", "Search", "Searched");
const EDIT = verbs("Editing", "Edit", "Edited");
const LOAD = verbs("Loading", "Load", "Loaded");
const STOP = verbs("Stopping", "Stop", "Stopped");
const DELEGATE = verbs("Delegating", "Delegate", "Delegated");

/** Each tool's verbs, where one reads as a verb. */
const VERBS: Record<string, Verbs> = {
  Read: verbs("Reading", "Read", "Read"),
  Grep: SEARCH,
  Glob: SEARCH,
  WebSearch: SEARCH,
  Edit: EDIT,
  MultiEdit: EDIT,
  NotebookEdit: EDIT,
  Write: verbs("Writing", "Write", "Wrote"),
  Bash: verbs("Running", "Run", "Ran"),
  WebFetch: verbs("Fetching", "Fetch", "Fetched"),
  Agent: DELEGATE,
  Task: DELEGATE,
  TodoWrite: verbs("Updating", "Update", "Updated"),
  Skill: LOAD,
  ToolSearch: LOAD,
  Monitor: verbs("Watching", "Watch", "Watched"),
  TaskStop: STOP,
  KillShell: STOP,
  SendMessage: verbs("Messaging", "Message", "Messaged"),
  ExitPlanMode: verbs("Planning", "Plan", "Planned"),
  AskUserQuestion: verbs("Asking", "Ask", "Asked"),
  [SHOW_TOOL]: verbs("Drawing", "Show", "Showed"),
};

/** Subagents whose kind says what they do, which their line's verb says instead of their kind. */
const AGENT_VERBS: Record<string, Verbs> = { Explore: verbs("Exploring", "Explore", "Explored"), Plan: verbs("Planning", "Plan", "Planned") };

/** A call's verbs: its tool's, its subagent's kind's, `Calling` for an MCP tool's, else the tool's own name. */
function verbsOf(call: ToolCall): Verbs {
  if (AGENTS.has(call.name)) return AGENT_VERBS[String(call.input.subagent_type)] ?? DELEGATE;
  if (VERBS[call.name]) return VERBS[call.name]!;
  if (call.name.startsWith("mcp__")) return verbs("Calling", "Call", "Called");
  const label = toolLabel(call.name);
  return verbs(label, label, label);
}

/** How a line's calls went, the one that matters most: waiting on you, then running, then a failure. */
const RANK: Record<ActivityRow["status"], number> = { waiting: 5, running: 4, error: 3, denied: 2, stopped: 1, done: 0 };

export function activityRows(calls: readonly ToolCall[], waiting: ReadonlySet<string>, cwd: string, home: string): ActivityRow[] {
  const groups: ToolCall[][] = [];
  let last: string | null = null;
  for (const call of calls) {
    const key = groupKey(call);
    const open = groups.at(-1);
    if (key && key === last && open) open.push(call);
    else groups.push([call]);
    last = key;
  }
  return groups.map((group) => rowOf(group, waiting, cwd, home));
}

/** What a call shares with the calls it's one line with, or null when it's a line of its own. */
function groupKey(call: ToolCall) {
  if (GROUPED.has(call.name)) return call.name;
  const path = filePath(call);
  return EDITS.has(call.name) && path ? `edit:${path}` : null;
}

const filePath = (call: ToolCall) =>
  typeof call.input.file_path === "string" ? call.input.file_path : typeof call.input.notebook_path === "string" ? call.input.notebook_path : "";

function rowOf(calls: ToolCall[], waiting: ReadonlySet<string>, cwd: string, home: string): ActivityRow {
  const first = calls[0]!;
  const status = calls.reduce<ActivityRow["status"]>((worst, call) => {
    const one = waiting.has(call.id) ? "waiting" : call.status;
    return RANK[one] > RANK[worst] ? one : worst;
  }, "done");
  const row: ActivityRow = { calls, verb: "", target: [], path: false, result: [], status };
  const forms = describe(row, cwd, home);
  const last = calls.at(-1)!;
  /** The target in a tense, after `verb` where one leads it. */
  const target = (tense: Tense, verb = ""): Part[] => [
    ...(verb ? [{ text: `${verb} `, tone: "plain" as const }] : []),
    ...(forms.rest ? [{ text: forms.rest[tense], tone: "plain" as const }] : row.target),
  ];
  // How it's going says more than any count while it runs, waits on you, or was stopped.
  if (status === "waiting") {
    row.verb = forms.ask;
    row.target = target("ask");
    // An edit asks with the change it would make.
    row.result = EDITS.has(first.name) || first.name === "Write" ? diffParts(changed(last), false) : [];
  } else if (status === "running" || last.background === "running") {
    row.verb = forms.doing;
    row.target = target("doing");
    if (status === "running" && !AGENTS.has(first.name)) row.result = last.elapsed ? [{ text: took(last.elapsed * 1000), tone: "quiet" }] : [];
  } else if (status === "denied" || (status === "stopped" && last.unanswered)) {
    // What it would have done, in the words it asked with.
    row.verb = "Not run";
    if (!forms.bare) row.target = target("ask", forms.ask);
    row.result = [{ text: status === "stopped" ? "stopped" : last.deniedBy ? `denied by ${last.deniedBy}` : "you said no", tone: "stopped" }];
    row.diff = undefined;
  } else if (status === "stopped") {
    row.verb = "Stopped";
    row.target = target("doing", forms.doing[0]!.toLowerCase() + forms.doing.slice(1));
    const ms = last.startedAt !== undefined && last.endedAt !== undefined ? last.endedAt - last.startedAt : last.elapsed !== undefined ? last.elapsed * 1000 : undefined;
    row.result = ms !== undefined && ms >= 1000 ? [{ text: `after ${took(ms)}`, tone: "quiet" }] : [];
  } else {
    row.verb = forms.done;
    row.target = target("done");
  }
  if (status === "error" && !row.failure) {
    const failed = calls.findLast((call) => call.status === "error");
    row.failure = failed ? firstWords(failed.result ?? "") : undefined;
  }
  return row;
}

/** Fills in the row's target and result, by its tool, and gives its verbs. */
function describe(row: ActivityRow, cwd: string, home: string): Verbs {
  const calls = row.calls;
  const call = calls[0]!;
  const forms = verbsOf(call);
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  switch (call.name) {
    case "Read": {
      row.path = true;
      row.target = joinPaths(calls.map((one) => shortPath(String(one.input.file_path ?? ""), cwd, home)));
      row.result = readResult(calls);
      return forms;
    }
    case "Grep":
    case "Glob": {
      row.target = [{ text: text("pattern"), tone: "code" }];
      if (text("path")) row.target.push({ text: ` in ${shortPath(text("path"), cwd, home)}`, tone: "quiet" });
      if (text("glob")) row.target.push({ text: ` (${text("glob")})`, tone: "quiet" });
      row.result = call.status === "done" ? [{ text: searchResult(call), tone: "quiet" }] : [];
      return forms;
    }
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "Write": {
      row.path = true;
      row.target = splitPath(shortPath(filePath(call), cwd, home));
      const done = calls.filter((one) => one.status === "done");
      const counts = done.reduce((sum, one) => {
        const each = changed(one);
        return { added: sum.added + each.added, removed: sum.removed + each.removed };
      }, { added: 0, removed: 0 });
      const created = call.name === "Write" && field(call.output, "type") === "create";
      if (done.length) {
        row.diff = counts;
        row.result = [
          ...diffParts(counts, created),
          ...(calls.length > 1 ? [{ text: ` · ${plural(calls.length, call.name === "Write" ? "write" : "edit")}`, tone: "faint" as const }] : []),
        ];
      }
      return call.name === "Write" && field(call.output, "type") === "update" ? { ...forms, done: "Rewrote" } : forms;
    }
    case "Bash": {
      const run = runOfCall(call, false);
      row.result = runResult(run);
      if (run.status === "error") row.failure = failureLine(run);
      // What Claude said the command does tells more at a glance than the command, which the
      // inspector shows. Its verb takes the line's tense: `Running the test suite`, `Run the test
      // suite` while it asks, `Ran the test suite`. One that doesn't start with a verb follows
      // `Ran` as it is.
      const said = text("description").split("\n")[0]!.trim();
      const done = said ? inPastTense(said) : null;
      if (!said) {
        row.target = [{ text: "$ ", tone: "faint" }, { text: toolTarget(call, cwd, home), tone: "plain" }];
        return { ...forms, bare: true };
      }
      if (!done) {
        row.target = [{ text: said, tone: "plain" }];
        return forms;
      }
      // The verbs joined to the first change with it, so each tense has its own rest of the sentence.
      const [ask, asked] = firstWord(said.replace(/\.$/, ""));
      const [doing, going] = firstWord(inPresentTense(said) ?? said);
      const [past, went] = firstWord(done);
      return { doing, ask, done: past, rest: { doing: going, ask: asked, done: went } };
    }
    case "WebFetch": {
      row.target = [{ text: text("url").replace(/^https?:\/\//, ""), tone: "plain" }];
      const code = field(call.output, "code");
      const bytes = field(call.output, "bytes");
      if (typeof code === "number") {
        row.result = [
          { text: `${code} ${String(field(call.output, "codeText") ?? "")}`.trim(), tone: code < 400 ? "quiet" : "failed" },
          ...(typeof bytes === "number" && bytes > 0 ? [{ text: ` · ${size(bytes)}`, tone: "faint" as const }] : []),
        ];
      }
      return forms;
    }
    case "WebSearch": {
      row.target = [{ text: `“${text("query")}”`, tone: "plain" }, { text: " on the web", tone: "quiet" }];
      const hits = webHits(call.output);
      if (hits) row.result = [{ text: plural(hits, "result"), tone: "quiet" }];
      return forms;
    }
    case "Agent":
    case "Task": {
      // A kind the verb says (`Exploring`) isn't said again.
      const type = AGENT_VERBS[text("subagent_type")] ? "" : text("subagent_type");
      row.target = [...(type ? [{ text: type, tone: "code" as const }, { text: "  ", tone: "plain" as const }] : []), { text: text("description") || text("prompt").split("\n")[0] || "", tone: "plain" }];
      const count = subagentCallCount(call);
      if (call.status === "running" && !call.background) row.result = [{ text: count ? `◌ ${plural(count, "tool call")}` : "◌ starting", tone: "quiet" }];
      else if (call.background) row.result = [{ text: toolSummary(call, false), tone: call.background === "failed" ? "failed" : "quiet" }];
      // A saved conversation may not say how many calls it made, which isn't none.
      else if (call.status === "done") row.result = count ? [{ text: plural(count, "tool call"), tone: "quiet" }, ...span(call)] : [{ text: "✓", tone: "done" }, ...span(call).map((part) => ({ ...part, text: part.text.replace(" · ", " ") }))];
      return forms;
    }
    case "TodoWrite": {
      const todos = Array.isArray(call.input.todos) ? call.input.todos : [];
      const done = todos.filter((todo) => field(todo, "status") === "completed").length;
      row.target = [{ text: "the to-do list", tone: "plain" }];
      row.result = [{ text: `${done} of ${todos.length} done`, tone: "quiet" }];
      return forms;
    }
    case "ToolSearch": {
      const query = text("query").replace(/^select:/, "");
      row.target = [{ text: query.split(",").join(", "), tone: "code" }];
      return forms;
    }
    case "Skill": {
      row.target = [{ text: text("skill"), tone: "code" }, { text: " skill", tone: "quiet" }];
      return forms;
    }
  }
  if (call.name.startsWith("mcp__")) {
    const [, server = "", ...rest] = call.name.split("__");
    const about = toolTarget(call, cwd, home);
    row.target = [{ text: rest.join("__"), tone: "plain" }, { text: ` (${server})`, tone: "quiet" }, ...(about ? [{ text: `  ${about}`, tone: "quiet" as const }] : [])];
  } else {
    row.target = [{ text: toolTarget(call, cwd, home), tone: "plain" }];
  }
  if (call.status === "done") row.result = [{ text: toolSummary(call, false), tone: "quiet" }];
  return forms;
}

/** An edit's size, `+8 −3`, or `new +11` for a file it created. */
function diffParts(counts: { added: number; removed: number }, created: boolean): Part[] {
  return [
    ...(created ? [{ text: "new ", tone: "faint" as const }] : []),
    ...(counts.added || created ? [{ text: `+${counts.added}`, tone: "added" as const }] : []),
    ...(counts.removed ? [{ text: `${counts.added || created ? " " : ""}−${counts.removed}`, tone: "removed" as const }] : []),
    ...(!counts.added && !counts.removed && !created ? [{ text: "no change", tone: "quiet" as const }] : []),
  ];
}

/** `src/retry.ts, src/clock.ts`: each path's folder quiet and its name plain. */
function joinPaths(paths: string[]): Part[] {
  const unique = [...new Set(paths)];
  return unique.flatMap((path, i) => [...(i ? [{ text: ", ", tone: "faint" as const }] : []), ...splitPath(path)]);
}

function splitPath(path: string): Part[] {
  const cut = path.lastIndexOf("/") + 1;
  return [...(cut ? [{ text: path.slice(0, cut), tone: "quiet" as const }] : []), { text: path.slice(cut), tone: "plain" }];
}

/** How much the reads took in: `182 lines`, `lines 40–80 of 182`, or how many failed. */
function readResult(calls: ToolCall[]): Part[] {
  const done = calls.filter((call) => call.status === "done");
  const failed = calls.filter((call) => call.status === "error").length;
  const parts: Part[] = [];
  const file = (call: ToolCall) => field(call.output, "file");
  const images = done.filter((call) => call.images?.length || field(call.output, "type") === "image").length;
  // A saved conversation keeps only the text Claude got, numbered as `cat -n` numbers it.
  const count = (call: ToolCall) => Number(field(file(call), "numLines")) || readLines(call.result ?? "").lines.length;
  const lines = done.reduce((sum, call) => sum + count(call), 0);
  if (done.length === 1 && lines) {
    const one = file(done[0]!);
    const start = Number(field(one, "startLine")) || 1;
    const total = Number(field(one, "totalLines")) || 0;
    parts.push({ text: total > lines ? `lines ${start}–${start + lines - 1} of ${total}` : plural(lines, "line"), tone: "quiet" });
  } else if (lines) parts.push({ text: plural(lines, "line"), tone: "quiet" });
  if (images) parts.push({ text: `${parts.length ? " · " : ""}${plural(images, "image")}`, tone: "quiet" });
  if (failed) parts.push({ text: `${parts.length ? " · " : ""}${failed} failed`, tone: "failed" });
  return parts;
}

/**
 * A read's lines from the text Claude got, which numbers each line as `cat -n` does, and the number
 * of its first line: all a saved conversation keeps of a read.
 */
export function readLines(result: string) {
  const lines: string[] = [];
  let start = 0;
  for (const line of result.split("\n")) {
    const numbered = /^\s*(\d+)\t(.*)$/.exec(line);
    if (!numbered) {
      if (lines.length) break;
      continue;
    }
    if (!lines.length) start = Number(numbered[1]);
    lines.push(numbered[2]!);
  }
  return { lines, start: start || 1 };
}

/** What a search found: `3 matches in 2 files`, `12 files`, or `no matches`. */
function searchResult(call: ToolCall) {
  const files = Number(field(call.output, "numFiles")) || 0;
  const matches = Number(field(call.output, "numMatches")) || 0;
  const lines = Number(field(call.output, "numLines")) || 0;
  const mode = field(call.output, "mode");
  if (mode === "content" && (matches || lines)) return `${plural(matches || lines, matches ? "match" : "line").replace("matchs", "matches")}${files > 1 ? ` in ${plural(files, "file")}` : ""}`;
  if (mode === "count" && matches) return `${plural(matches, "match").replace("matchs", "matches")}${files > 1 ? ` in ${plural(files, "file")}` : ""}`;
  if (files) return `${plural(files, "file")}${field(call.output, "truncated") === true ? "+" : ""}`;
  return call.output === undefined ? toolSummary(call, false) : "no matches";
}

/** The longest line a command printed that its activity line shows in place of `1 line`. */
const SHORT_LINE = 32;

/** How a command went, for the end of its line: `✓ 48 passed · 3.1s`, `✕ exit 1 · 47 passed, 1 failed`, `✓ 42`. */
function runResult(run: Run): Part[] {
  const time = timed(run.ms) && run.status !== "running" ? [{ text: ` · ${took(run.ms)}`, tone: "faint" as const }] : [];
  if (run.background === "running") return [{ text: "◌ in the background", tone: "quiet" }];
  if (run.background === "unknown") return [{ text: "◌ ran in the background", tone: "quiet" }];
  const counts = testCounts([run.stdout, run.stderr].join("\n"));
  const tested: Part[] = counts.flatMap((count, i) => [...(i ? [{ text: ", ", tone: "quiet" as const }] : []), { text: count.text, tone: count.failed ? ("failed" as const) : ("quiet" as const) }]);
  switch (run.status) {
    case "error":
      return [{ text: run.code !== null ? `✕ exit ${run.code}` : "✕ failed", tone: "failed" }, ...(tested.length ? [{ text: " · ", tone: "faint" as const }, ...tested] : []), ...time];
    case "stopped":
      return [{ text: "■ stopped", tone: "stopped" }, ...time];
    case "done": {
      if (run.background === "failed") return [{ text: "✕ failed in the background", tone: "failed" }];
      if (run.background === "stopped") return [{ text: "■ stopped in the background", tone: "stopped" }];
      if (run.background === "completed") return [{ text: "✓ in the background", tone: "done" }];
      const one = onlyLine(run);
      const said = tested.length
        ? tested
        : run.note
          ? [{ text: run.note, tone: "quiet" as const }]
          : one && [...one].length <= SHORT_LINE
            ? [{ text: one, tone: "quiet" as const }]
            : [{ text: runSize(run) || "no output", tone: "quiet" as const }];
      return [{ text: "✓ ", tone: "done" }, ...said, ...time];
    }
    default:
      return [];
  }
}

/** From a call's start to its end, as ` · 52s`, where both are known. */
function span(call: ToolCall): Part[] {
  const ms = call.startedAt !== undefined && call.endedAt !== undefined ? call.endedAt - call.startedAt : undefined;
  return timed(ms) ? [{ text: ` · ${took(ms)}`, tone: "faint" }] : [];
}

function webHits(output: unknown) {
  const results = field(output, "results");
  if (!Array.isArray(results)) return 0;
  return results.reduce((sum: number, one) => sum + (Array.isArray(field(one, "content")) ? (field(one, "content") as unknown[]).length : 0), 0);
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The first line of an error with words in it, without Claude Code's wrapping tags. */
function firstWords(text: string) {
  return (
    text
      .replace(/<\/?tool_use_error>/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /[\p{L}\p{N}]/u.test(line)) ?? ""
  );
}

/** Lines an edit or write added and removed, from Claude Code's patch where it gave one. */
export function changed(call: ToolCall) {
  const hunks = field(call.output, "structuredPatch");
  if (Array.isArray(hunks) && hunks.length) {
    let added = 0;
    let removed = 0;
    for (const hunk of hunks) {
      const lines = field(hunk, "lines");
      for (const line of Array.isArray(lines) ? lines.map(String) : []) {
        if (line.startsWith("+")) added += 1;
        else if (line.startsWith("-")) removed += 1;
      }
    }
    return { added, removed };
  }
  const text = (key: string) => (typeof call.input[key] === "string" ? (call.input[key] as string) : "");
  // A file's last newline ends its last line rather than starting another.
  if (call.name === "Write") return { added: text("content").replace(/\n$/, "").split("\n").length, removed: 0 };
  // Lines each side has that the other doesn't, counted as a multiset.
  const before = text("old_string").split("\n");
  const after = text("new_string").split("\n");
  const left = new Map<string, number>();
  for (const line of before) left.set(line, (left.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after) {
    const count = left.get(line) ?? 0;
    if (count) left.set(line, count - 1);
    else added += 1;
  }
  const removed = [...left.values()].reduce((sum, count) => sum + count, 0);
  return { added, removed };
}
