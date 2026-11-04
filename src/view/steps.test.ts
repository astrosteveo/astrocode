import { expect, test } from "bun:test";
import { firstSentence } from "./steps";

test("a thinking line says the first sentence of Claude's summary, and opens when there's more", () => {
  expect(firstSentence("I should read retry and its tests first. Then run the suite.\n\n")).toEqual({ text: "I should read retry and its tests first.", more: true });
  expect(firstSentence("The loop runs attempts + 1 times.\n\n")).toEqual({ text: "The loop runs attempts + 1 times.", more: false });
  // A sentence that runs over lines is one line, and a summary's own heading is its first sentence.
  expect(firstSentence("Cache only needs `now()`; retry needs\n`now()` and `sleep()`, e.g. for its delays")).toEqual({ text: "Cache only needs `now()`; retry needs `now()` and `sleep()`, e.g. for its delays", more: false });
  expect(firstSentence("**Finding the off-by-one**\n\nThe loop bound is wrong.")).toEqual({ text: "**Finding the off-by-one**", more: true });
});
