import { expect, test } from "bun:test";
import { focusOf } from "./focus";

const states = [false, true].flatMap((decision) => [false, true].flatMap((overlay) => [false, true].map((transcript) => ({ decision, overlay, transcript }))));

test("your keys go to a place that's there to take them, and to the box when nothing else is", () => {
  for (const state of states) {
    const focus = focusOf(state);
    if (focus === "box") expect(state).toEqual({ decision: false, overlay: false, transcript: false });
    else expect(state[focus]).toBe(true);
  }
});

test("a decision takes your keys from anything, an overlay from the transcript, and the box has them otherwise", () => {
  expect(focusOf({ decision: false, overlay: false, transcript: false })).toBe("box");
  expect(focusOf({ decision: false, overlay: false, transcript: true })).toBe("transcript");
  expect(focusOf({ decision: false, overlay: true, transcript: true })).toBe("overlay");
  expect(focusOf({ decision: true, overlay: true, transcript: true })).toBe("decision");
  // Answered, the keys go back where they were.
  expect(focusOf({ decision: false, overlay: false, transcript: true })).toBe("transcript");
});
