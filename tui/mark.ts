// The running mark, `◐◓◑◒`: the one thing on screen that moves, in the gutter of the step Claude
// is on and on the now line. Every mark reads one clock, so they turn in step; each Ink timer
// counts from when its own component started, which would leave two marks a part of a turn apart.
import { useSyncExternalStore } from "react";
import { asksYou, type State } from "../src/view/state";

export const MARKS = ["◐", "◓", "◑", "◒"];
/** Four frames a second. */
const FRAME_MS = 250;

let frame = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    frame = (frame + 1) % MARKS.length;
    for (const one of listeners) one();
  }, FRAME_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    timer = undefined;
    frame = 0;
  };
}

const still = () => () => {};

/** Whether the mark turns: while Claude works, and stops once it waits on you. */
export function markTurns(state: State) {
  return state.busy && !asksYou(state);
}

/** The mark as it is now: turning while `turning`, and otherwise still, at its first frame. */
export function useMark(turning: boolean) {
  return MARKS[useSyncExternalStore(turning ? subscribe : still, () => (turning ? frame : 0))]!;
}
