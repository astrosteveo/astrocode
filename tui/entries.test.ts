import { expect, test } from "bun:test";
import { turnWork } from "./entries";

test("opens a turn that only replied, to show its tokens, and not one with nothing to list", () => {
  expect(turnWork({ kind: "turn", key: "t", outcome: "finished", durationMs: 6000, tokens: 1200, files: [], commands: [] })).toBe("1.2k tokens");
  expect(turnWork({ kind: "turn", key: "t", outcome: "finished", durationMs: 6000, tokens: 0, files: [], commands: [] })).toBe("");
});
