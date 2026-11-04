// The transcript's entries in order, for both layouts: Claude's tool calls gathered into steps, each
// drawn as an activity log that's open or closed, and every other item as itself.
import { activityRows } from "../src/view/activity";
import { isCurrent, restOf, stepSpan, stepStatus, steps, stepTitle, type Step } from "../src/view/steps";
import type { Item, State, ToolItem } from "../src/view/state";
import type { Flow, StepRow } from "./entries";
import { hasPictures } from "./figure";

/**
 * `index`: the item the entry starts at. A step's `end` is the index just past its last item.
 * `spaced`: a blank row sets the entry apart from the one before.
 */
export type Entry =
  | { kind: "item"; item: Item; spaced: boolean; index: number }
  | { kind: "step"; key: string; row: StepRow; open: boolean; spaced: boolean; index: number; end: number; first: Item };

/**
 * Whether a blank row goes between `before` and `item`: between entries, but not between tool
 * calls, which stack as one run of lines, nor before the ledger, which closes the reply it follows.
 * A shell command's card stands apart, and a picture under a call's row ends the run, so the next
 * call doesn't sit on the picture's edge.
 */
function spaced(before: Item | undefined, item: Item) {
  if (item.kind === "turn" && before) return false;
  if (before?.kind !== "tool" || item.kind !== "tool") return true;
  return before.call.name === "Bash" || item.call.name === "Bash" || hasPictures(before.call);
}

/** A step's row as it's drawn, from the step and how its calls went. One Claude is still working in shows as running. */
function stepRow(step: Step, state: State, waiting: ReadonlySet<string>, current: boolean): StepRow {
  const title = stepTitle(step, state.cwd, state.home);
  const more = step.title ? restOf(step.title.text) || undefined : undefined;
  const status = stepStatus(step, waiting);
  return {
    key: step.key,
    title: title.text,
    made: title.made,
    more,
    status: current && status === "done" ? "running" : status,
    span: stepSpan(step),
    flow: flowOf(step, state, waiting),
  };
}

/**
 * The step's members in order: each run of calls as activity lines, and the thinking and progress
 * lines between the runs, which show once the step opens. Calls group into a line only within a
 * run, so a step's lines are the same open or closed.
 */
function flowOf(step: Step, state: State, waiting: ReadonlySet<string>): Flow[] {
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
    if (member.kind === "thinking") flow.push({ kind: "thinking", key: member.key, text: member.text });
    else if (member.kind === "notice") flow.push({ kind: "notice", key: member.key, text: member.text, tone: member.tone });
  }
  flow.push(...rows(run));
  return flow;
}

/**
 * The entries for `state.items`. `toggled` holds the steps opened by a click, by key: a step starts
 * closed, its lines capped and its thinking left out.
 */
export function arrange(state: State, waiting: ReadonlySet<string>, toggled: ReadonlySet<string>): Entry[] {
  const found = steps(state.items);
  const entries: Entry[] = [];
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]!;
    const step = found.get(i);
    if (step) {
      const row = stepRow(step, state, waiting, isCurrent(state.items, step, state.busy));
      entries.push({ kind: "step", key: step.key, row, open: toggled.has(step.key), spaced: spaced(state.items[i - 1], item), index: i, end: step.end, first: item });
      i = step.end - 1;
      continue;
    }
    entries.push({ kind: "item", item, spaced: spaced(state.items[i - 1], item), index: i });
  }
  return entries;
}
