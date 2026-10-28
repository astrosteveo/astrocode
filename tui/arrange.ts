// The transcript's entries in order, for both layouts: Claude's tool calls gathered into steps,
// each a row that's open or closed, and every other item as itself. Calls under an open step's
// row stack under it, and closed steps stack under each other, as calls do.
import { isCurrent, restOf, stepSpan, stepStatus, steps, stepSummary, stepTitle, type Step } from "../src/view/steps";
import type { Item, State } from "../src/view/state";
import type { StepRow } from "./entries";
import { rails, type Rail } from "./rail";

/** `index`: the item the entry starts at. A step's `end` is the index just past its last item. */
export type Entry =
  | { kind: "item"; item: Item; rail: Rail; index: number }
  | { kind: "step"; key: string; row: StepRow; open: boolean; rail: Rail; index: number; end: number; first: Item };

/** A step's row as it's drawn, from the step and how its calls went. One Claude is still working in shows as running. */
function stepRow(step: Step, state: State, waiting: ReadonlySet<string>, current: boolean): StepRow {
  const title = stepTitle(step, state.cwd, state.home);
  const more = step.title ? restOf(step.title.text) || undefined : undefined;
  const status = stepStatus(step, waiting);
  return {
    title: title.text,
    made: title.made,
    more,
    summary: stepSummary(step, state.cwd, state.home),
    status: current && status === "done" ? "running" : status,
    span: stepSpan(step),
  };
}

/** Whether a step starts open: the one Claude is working in, one waiting for you, and one whose last call failed. */
export function stepOpens(state: State, start: number, step: Step, waiting: ReadonlySet<string>) {
  const status = stepStatus(step, waiting);
  return isCurrent(state.items, start, step, state.busy) || status === "waiting" || status === "failed";
}

const isCard = (item: Item) => item.kind === "tool" && item.call.name === "Bash";

/**
 * The entries for `state.items`. `toggled` holds the steps opened or closed away from how they
 * start (`stepOpens()`), by key; `open` may force a step's state, as scrollback does for good.
 */
export function arrange(state: State, waiting: ReadonlySet<string>, toggled: ReadonlySet<string>, open?: (step: Step, start: number) => boolean | undefined): Entry[] {
  const placed = rails(state.items);
  const found = steps(state.items);
  const entries: Entry[] = [];
  /** The first item under an open step's row. */
  let under = -1;
  /** Whether the last entry was a closed step, which the next step's row stacks under. */
  let afterStep = false;
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]!;
    let rail = placed[i]!;
    const step = found.get(i);
    if (step) {
      const end = i + (step.title ? 1 : 0) + step.members.length;
      const isOpen = open?.(step, i) ?? stepOpens(state, i, step, waiting) !== toggled.has(step.key);
      if (afterStep) rail = { ...rail, spaced: false };
      const row = stepRow(step, state, waiting, isCurrent(state.items, i, step, state.busy));
      entries.push({ kind: "step", key: step.key, row, open: isOpen, rail, index: i, end, first: item });
      afterStep = !isOpen;
      if (!isOpen) {
        i = end - 1;
        continue;
      }
      // Open, the title is the row, and the calls follow it.
      under = step.title ? i + 1 : i;
      if (step.title) continue;
    } else afterStep = false;
    if (i === under) rail = { ...rail, spaced: isCard(item) };
    entries.push({ kind: "item", item, rail, index: i });
  }
  return entries;
}
