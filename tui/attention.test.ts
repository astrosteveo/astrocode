import { expect, test } from "bun:test";
import { initialState } from "../src/view/state";
import { titleMark } from "./attention";

test("the window's title leads with the transcript's marks: ◐ while Claude works, ◇ while it waits on you", () => {
  const idle = initialState("/p", "/home/u");
  expect(titleMark(idle)).toBe("");
  expect(titleMark({ ...idle, busy: true })).toBe("◐ ");
  expect(titleMark({ ...idle, busy: true, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] })).toBe("◇ ");
});
