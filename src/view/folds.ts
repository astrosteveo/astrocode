// Runs of tool calls that went as planned, folded into one row once their turn has ended: a long
// turn reads as what Claude said, with what it did a click away. Calls that show you something
// (edits, writes, answers, to-dos, pictures) and calls that failed, were refused or stopped
// stay unfolded, and so do calls that went to the background.
import type { Item, ToolItem } from "./state";

/** The fewest calls in a row that fold. */
const FOLD_LEAST = 3;

/** Calls whose rows show what you'd look for: a diff, your answers, the to-dos. */
const SHOWN = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "AskUserQuestion", "TodoWrite", "ExitPlanMode"]);

/** `key` is the fold's own, which opens and closes it; `calls` are the tool calls in it, in order. */
export type Fold = { key: string; calls: ToolItem[] };

/** What each kind of call is counted as in a fold's summary. */
const NOUNS: Record<string, string> = {
  Bash: "command",
  Read: "read",
  Grep: "search",
  Glob: "search",
  WebFetch: "fetch",
  WebSearch: "web search",
  Task: "subagent",
  Agent: "subagent",
};

const foldable = (item: Item | undefined): item is ToolItem =>
  item?.kind === "tool" && item.call.status === "done" && !item.call.background && !item.call.images?.length && !SHOWN.has(item.call.name);

/**
 * The folds in `items`, by the index of their first call. `ended` says whether a turn's closer may
 * count: scrollback folds only replayed turns, since it has already written a live turn's calls.
 */
export function folds(items: Item[], ended: (turn: Extract<Item, { kind: "turn" }>) => boolean = () => true): Map<number, Fold> {
  const found = new Map<number, Fold>();
  let i = 0;
  while (i < items.length) {
    if (!foldable(items[i])) {
      i += 1;
      continue;
    }
    let end = i;
    while (foldable(items[end])) end += 1;
    if (end - i >= FOLD_LEAST && turnEnded(items, end, ended)) {
      const calls = items.slice(i, end) as ToolItem[];
      found.set(i, { key: `fold:${calls[0]!.key}`, calls });
    }
    i = end;
  }
  return found;
}

/** Whether the turn holding the items before `from` has closed, by the first prompt or closer after it. */
function turnEnded(items: Item[], from: number, ended: (turn: Extract<Item, { kind: "turn" }>) => boolean) {
  const next = items.slice(from).find((item) => item.kind === "prompt" || item.kind === "turn");
  return next?.kind === "turn" && ended(next);
}

/** `3 commands · 2 reads · 1 search`, in the order each kind first came. */
export function foldSummary(fold: Fold) {
  const counts = new Map<string, number>();
  for (const { call } of fold.calls) {
    const noun = NOUNS[call.name] ?? "other call";
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  return [...counts].map(([noun, count]) => `${count} ${count === 1 ? noun : noun.endsWith("ch") ? `${noun}es` : `${noun}s`}`).join(" · ");
}

/** From the first call's start to the last one's end, in ms, where the calls were timed. */
export function foldSpan(fold: Fold) {
  const first = fold.calls[0]?.call.startedAt;
  const last = Math.max(...fold.calls.map(({ call }) => call.endedAt ?? 0));
  return first !== undefined && last > first ? last - first : undefined;
}

/** The fold an item is in, if any, so opening the item can open its fold first. */
export function foldOf(all: Map<number, Fold>, key: string) {
  for (const fold of all.values()) if (fold.calls.some((call) => call.key === key)) return fold;
  return undefined;
}
