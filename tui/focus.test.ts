import { expect, test } from "bun:test";
import { focusOf, type Focus } from "./focus";

const states = [false, true].flatMap((decision) => [false, true].flatMap((overlay) => [false, true].map((transcript) => ({ decision, overlay, transcript }))));

test("exactly one region has your keys in every state", () => {
  const regions: Focus[] = ["box", "transcript", "overlay", "decision"];
  for (const state of states) {
    const focus = focusOf(state);
    expect(regions.filter((region) => region === focus)).toHaveLength(1);
    // And it's one that's there to take them: the box always is.
    if (focus !== "box") expect(state[focus]).toBe(true);
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
