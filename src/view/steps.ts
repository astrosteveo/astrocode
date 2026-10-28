// A turn as steps: each run of tool calls, with the sentence Claude wrote before it as its title,
// drawn as one row that says what Claude meant to do and what came of it. Prose that isn't a
// title (a long explanation, a reply) stays as it is. Without a sentence to use, a title is made
// from the calls. Calls that show you something on purpose (a picture, a plan, a question) stand
// apart, since a closed step would hide them.
import { field, plural, SHOW_TOOL, shortPath, toolLabel, toolTarget } from "./tools";
import type { Item, ToolItem } from "./state";

/** Calls that stay out of steps, drawn whole. */
const APART = new Set([SHOW_TOOL, "ExitPlanMode", "AskUserQuestion"]);

/** The longest text that can be a title: one paragraph, about two lines. */
const TITLE_MOST = 300;

type TextItem = Extract<Item, { kind: "text" }>;

/**
 * `key` is the step's own, which opens and closes it. `title` is the text it's named by, if any;
 * `members` are the calls, the thinking between them and their progress lines, in order.
 */
export type Step = { key: string; title?: TextItem; members: Item[]; calls: ToolItem[] };

const isCall = (item: Item | undefined): item is ToolItem => item?.kind === "tool" && !APART.has(item.call.name);

/** The first item from `from` that isn't thinking. */
function past(items: Item[], from: number) {
  let i = from;
  while (items[i]?.kind === "thinking") i += 1;
  return i;
}

/** Whether Claude's text reads as a title: one short paragraph, no lists, headings, code or tables. */
export function titleWorthy(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > TITLE_MOST || /\n\s*\n/.test(trimmed) || trimmed.includes("```")) return false;
  return !trimmed.split("\n").some((line) => /^\s*([-*+]\s|\d+[.)]\s|#|\||>)/.test(line));
}

/** The steps in `items`, by the index of their first item (the title, when there is one). */
export function steps(items: Item[]): Map<number, Step> {
  const found = new Map<number, Step>();
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    const titled = item.kind === "text" && titleWorthy(item.text) && isCall(items[past(items, i + 1)]);
    const untitled = isCall(items[past(items, i)]) && item.kind !== "text";
    if (!titled && !untitled) {
      i += 1;
      continue;
    }
    const start = i;
    const members: Item[] = [];
    const calls: ToolItem[] = [];
    if (titled) i += 1;
    const ids = new Set<string>();
    for (;;) {
      const next = items[i];
      if (isCall(next)) {
        members.push(next);
        calls.push(next);
        ids.add(next.call.id);
        i += 1;
      } else if (next?.kind === "thinking" && isCall(items[past(items, i)])) {
        members.push(next);
        i += 1;
      } else if (next?.kind === "notice" && next.of && ids.has(next.of)) {
        members.push(next);
        i += 1;
      } else break;
    }
    found.set(start, { key: `step:${items[start]!.key}`, title: titled ? (item as TextItem) : undefined, members, calls });
  }
  return found;
}

/** Words that open Claude's narration and say nothing: "Now", "Next,", "Let me". */
const FILLER = /^(now|next|first|then|so|okay|ok|alright|good|great|right|done|perfect)\b[,:.!]?\s+|^(let me|i'll|i will|i'm going to|i am going to)\s+/i;

/** Where the first sentence of `text` ends: after its stop, or at the end. */
const SENTENCE_END = /[.!?](\s+(?=[A-Z("'“`*])|$)/;

/** What Claude wrote after the sentence that titles its step, which the step shows once open. */
export function restOf(text: string) {
  const trimmed = text.trim();
  const end = trimmed.search(SENTENCE_END);
  return end === -1 ? "" : trimmed.slice(end + 1).trim();
}

/** The first sentence of `text`, without filler or markdown, capitalized and without its closing stop. */
export function titleOf(text: string) {
  let line = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(\*\*|__|`)/g, "");
  const end = line.search(SENTENCE_END);
  if (end !== -1) line = line.slice(0, end + 1);
  for (let before = ""; before !== line; ) {
    before = line;
    line = line.replace(FILLER, "");
  }
  line = line.replace(/[.:,;]$/, "");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** What the step is called, and whether it was made from its calls for want of a sentence. */
export function stepTitle(step: Step, cwd: string, home: string): { text: string; made: boolean } {
  if (step.title) return { text: titleOf(step.title.text), made: false };
  // Consecutive calls of one tool read as one phrase: `Read queue.ts, fixtures.ts`.
  const phrases: string[] = [];
  /** Phrases from Claude's descriptions, which read on in lower case; a tool's name keeps its capital. */
  const said = new Set<number>();
  let last = "";
  for (const { call } of step.calls) {
    // A command reads best by what Claude said it does.
    const description = typeof call.input.description === "string" ? call.input.description.trim() : "";
    if (call.name === "Bash" && description) {
      said.add(phrases.length);
      phrases.push(description);
      last = "";
      continue;
    }
    const label = toolLabel(call.name);
    const target = shortTarget(call, cwd, home);
    if (label === last && phrases.length) phrases[phrases.length - 1] += target ? ` and ${target}` : "";
    else phrases.push(target ? `${label} ${target}` : label);
    last = label;
  }
  // Phrases after the first read on as one sentence: `Find the test, read retry.ts`.
  const rest = phrases.slice(1).map((phrase, i) => (said.has(i + 1) && /^[A-Z][a-z]/.test(phrase) ? phrase.charAt(0).toLowerCase() + phrase.slice(1) : phrase));
  return { text: [phrases[0] ?? "", ...rest].join(", "), made: true };
}

/** A target short enough for a title: a file's name without its folder. */
function shortTarget(call: ToolItem["call"], cwd: string, home: string) {
  const target = toolTarget(call, cwd, home);
  return call.name === "Read" || call.name === "Edit" || call.name === "Write" ? basename(target) : target;
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** A piece of a step's summary; `tone` colors it. */
export type Part = { text: string; tone: "plain" | "added" | "removed" | "failed" };

/** What each kind of call counts as. */
const COUNTED: Record<string, string> = {
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebFetch: "web",
  WebSearch: "web",
  Task: "agent",
  Agent: "agent",
};

/**
 * What the step did, at a glance: `edit queue.ts +9 −4 · $ bun test · read 3`. Edits and commands
 * come first, since they're what changed something; failures are counted in rose.
 */
export function stepSummary(step: Step, cwd: string, home: string): Part[][] {
  const groups: Part[][] = [];
  const edits = step.calls.filter(({ call }) => call.name === "Edit" || call.name === "Write" || call.name === "MultiEdit" || call.name === "NotebookEdit");
  if (edits.length) {
    const files = new Set(edits.map(({ call }) => String(call.input.file_path ?? call.input.notebook_path ?? "")));
    let added = 0;
    let removed = 0;
    for (const { call } of edits) {
      const counts = changed(call);
      added += counts.added;
      removed += counts.removed;
    }
    const verb = edits.every(({ call }) => call.name === "Write") ? "write" : "edit";
    const what = files.size === 1 ? basename(shortPath([...files][0]!, cwd, home)) : `${files.size} files`;
    const group: Part[] = [{ text: `${verb} ${what}`, tone: "plain" }];
    if (added) group.push({ text: ` +${added}`, tone: "added" });
    if (removed) group.push({ text: ` −${removed}`, tone: "removed" });
    groups.push(group);
  }
  const commands = step.calls.filter(({ call }) => call.name === "Bash");
  if (commands.length) {
    const failed = commands.filter(({ call }) => call.status === "error").length;
    // One command shows itself, unless it's a script that reads as noise in a line.
    const command = commands.length === 1 ? String(commands[0]!.call.input.command ?? "") : "";
    const one = command && !command.includes("\n") && !command.includes("<<") ? `$ ${toolTarget(commands[0]!.call, cwd, home)}` : plural(commands.length, "command");
    const group: Part[] = [{ text: one, tone: "plain" }];
    if (failed) group.push({ text: commands.length === 1 ? " ✗" : ` ✗${failed}`, tone: "failed" });
    groups.push(group);
  }
  const counts = new Map<string, number>();
  for (const { call } of step.calls) {
    if (call.name === "Bash" || edits.some((edit) => edit.call === call)) continue;
    const noun = COUNTED[call.name] ?? "other";
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  for (const [noun, count] of counts) groups.push([{ text: `${noun} ${count}`, tone: "plain" }]);
  const failed = step.calls.filter(({ call }) => call.name !== "Bash" && call.status === "error").length;
  if (failed) groups.push([{ text: `${failed} failed`, tone: "failed" }]);
  return groups;
}

/** Lines an edit or write added and removed, from Claude Code's patch where it gave one. */
export function changed(call: ToolItem["call"]) {
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
  if (call.name === "Write") return { added: text("content").split("\n").length, removed: 0 };
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

/**
 * How the step is going. It has `failed` when its last call failed; a failure Claude got past
 * shows only in the summary.
 */
export function stepStatus(step: Step, waiting: ReadonlySet<string>): "running" | "waiting" | "done" | "failed" | "stopped" {
  if (step.calls.some(({ call }) => waiting.has(call.id))) return "waiting";
  if (step.calls.some(({ call }) => call.status === "running")) return "running";
  const last = step.calls.at(-1)?.call.status;
  if (last === "error") return "failed";
  if (last === "denied" || last === "stopped") return "stopped";
  return "done";
}

/** From the step's first call's start to its last one's end, in ms, where the calls were timed. */
export function stepSpan(step: Step) {
  const first = step.title?.at ?? step.calls[0]?.call.startedAt;
  const last = Math.max(...step.calls.map(({ call }) => call.endedAt ?? 0));
  return first !== undefined && last > first ? last - first : undefined;
}

/** Whether the step is the last thing in a turn that's still going, so more calls may join it. */
export function isCurrent(items: Item[], start: number, step: Step, busy: boolean) {
  if (!busy) return false;
  const end = start + (step.title ? 1 : 0) + step.members.length;
  return items.slice(end).every((item) => item.kind === "thinking" || item.kind === "notice");
}
