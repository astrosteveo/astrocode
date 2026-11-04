// The transcript's entries in order, for both layouts: Claude's tool calls gathered into steps, each
// drawn as an activity log that's open or closed, and every other item as itself.
import { activityRows } from "../src/view/activity";
import { folds, foldsBefore, isCurrent, restOf, stepSpan, stepStatus, steps, stepTitle, type Step } from "../src/view/steps";
import type { Item, State, ToolItem } from "../src/view/state";
import type { Flow, StepRow } from "./entries";
import { rails, type Rail } from "./rail";

/** `index`: the item the entry starts at. A step's `end` is the index just past its last item. */
export type Entry =
  | { kind: "item"; item: Item; rail: Rail; index: number }
  | { kind: "step"; key: string; row: StepRow; open: boolean; rail: Rail; index: number; end: number; first: Item };

/** A step's row as it's drawn, from the step and how its calls went. One Claude is still working in shows as running. */
function stepRow(step: Step, state: State, waiting: ReadonlySet<string>, toggled: ReadonlySet<string>, current: boolean, folded: boolean): StepRow {
  const title = stepTitle(step, state.cwd, state.home);
  const more = step.title ? restOf(step.title.text) || undefined : undefined;
  const status = stepStatus(step, waiting);
  return {
    key: step.key,
    title: title.text,
    made: title.made,
    more,
    status: current && status === "done" ? "running" : status,
    folded,
    span: stepSpan(step),
    flow: flowOf(step, state, waiting, toggled),
  };
}

/**
 * The step's members in order: each run of calls as activity lines, and the thinking and progress
 * lines between the runs, which show once the step opens. Calls group into a line only within a
 * run, so a step's lines are the same open or closed. A stretch of thinking is one line, open if
 * it's in `toggled`.
 */
function flowOf(step: Step, state: State, waiting: ReadonlySet<string>, toggled: ReadonlySet<string>): Flow[] {
  const flow: Flow[] = [];
  let run: ToolItem[] = [];
  const rows = (calls: ToolItem[]): Flow[] => activityRows(calls.map((one) => one.call), waiting, state.cwd, state.home).map((row) => ({ kind: "row", row }));
  for (const member of step.members) {
    if (member.kind === "tool") {
      run.push(member);
      continue;
    }
    flow.push(...rows(run));
    run = [];
    const last = flow.at(-1);
    if (member.kind === "thinking" && last?.kind === "thinking") flow[flow.length - 1] = { ...last, text: `${last.text}\n\n${member.text}` };
    else if (member.kind === "thinking") flow.push({ kind: "thinking", key: member.key, text: member.text, open: toggled.has(member.key) });
    else if (member.kind === "notice") flow.push({ kind: "notice", key: member.key, text: member.text, tone: member.tone });
  }
  flow.push(...rows(run));
  return flow;
}

/**
 * The entries for `state.items`. `toggled` holds the steps and thinking opened by a click, by key:
 * a step starts closed, its lines capped and the thinking between them left out, and once its turn
 * is over, folded to its sentence, with the thinking that led to it. A finished turn leaves out the
 * rest of its thinking too. `scrollback`: arranged for scrollback, which can't take back what it
 * wrote, so only a resumed conversation's turns fold there, written folded from the start.
 */
export function arrange(state: State, waiting: ReadonlySet<string>, toggled: ReadonlySet<string>, scrollback = false): Entry[] {
  const placed = rails(state.items);
  const found = steps(state.items);
  const before = foldsBefore(state.items, scrollback);
  const entries: Entry[] = [];
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]!;
    const step = found.get(i);
    // A finished turn reads as one block: no row sets its folded steps apart, from each other or from what's around them.
    const last = entries.at(-1);
    const tight = (folded: boolean) => (folded || (last?.kind === "step" && last.row.folded) ? { ...placed[i]!, spaced: false } : placed[i]!);
    if (step) {
      const row = stepRow(step, state, waiting, toggled, isCurrent(state.items, step, state.busy), folds(step, before));
      entries.push({ kind: "step", key: step.key, row, open: toggled.has(step.key), rail: tight(row.folded), index: i, end: step.end, first: item });
      i = step.end - 1;
      continue;
    }
    if (item.kind === "thinking" && i < before) continue;
    entries.push({ kind: "item", item, rail: item.kind === "prompt" ? placed[i]! : tight(false), index: i });
  }
  return entries;
}
