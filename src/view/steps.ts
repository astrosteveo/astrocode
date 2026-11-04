// A turn as steps: each run of tool calls, with the sentence Claude wrote before it as its title,
// drawn as one row that says what Claude meant to do and what came of it. Prose that isn't a
// title (a long explanation, a reply) stays as it is. Without a sentence to use, a step has no
// title. Calls that show you something on purpose (a picture, a plan, a question) stand apart,
// since a closed step would hide them.
import { SHOW_TOOL } from "./tools";
import type { Item, ToolItem } from "./state";

/** Calls that stay out of steps, drawn whole, as does a call a mod drew a result for. */
const APART = new Set([SHOW_TOOL, "ExitPlanMode", "AskUserQuestion"]);

/** The longest text that can be a title: one paragraph, about two lines. */
const TITLE_MOST = 300;

type TextItem = Extract<Item, { kind: "text" }>;

/**
 * `key` is the step's own, which opens and closes it. `title` is the text it's named by, if any;
 * `members` are the rest of its items in order: the calls, the thinking before and between them,
 * and their progress lines. Its items run from where it's found to `end`, not counting `end`.
 */
export type Step = { key: string; title?: TextItem; members: Item[]; calls: ToolItem[]; end: number };

/** A call a mod drew a result for stands apart too, so its drawing shows. */
const isCall = (item: Item | undefined): item is ToolItem => item?.kind === "tool" && !APART.has(item.call.name) && !item.call.drawing;

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
    // Thinking that leads into a step is part of it.
    const at = past(items, i);
    const lead = items[at];
    const titled = lead?.kind === "text" && titleWorthy(lead.text) && isCall(items[past(items, at + 1)]);
    const untitled = isCall(lead);
    if (!titled && !untitled) {
      i = Math.max(i + 1, at);
      continue;
    }
    const start = i;
    const members: Item[] = items.slice(start, at);
    const calls: ToolItem[] = [];
    i = titled ? at + 1 : at;
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
    found.set(start, { key: `step:${item.key}`, title: titled ? (lead as TextItem) : undefined, members, calls, end: i });
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
export function isCurrent(items: Item[], step: Step, busy: boolean) {
  if (!busy) return false;
  return items.slice(step.end).every((item) => item.kind === "thinking" || item.kind === "notice");
}
