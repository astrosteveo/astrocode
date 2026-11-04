import { expect, test } from "bun:test";
import { runOfCall, runStatus } from "./runs";

test("a command waiting for your OK is marked, not said: the decision is where Claude says it waits", () => {
  const call = { id: "b", name: "Bash", input: { command: "rm -rf build" }, status: "running" as const, subagentCalls: 0 };
  expect(runStatus(runOfCall(call, true))).toEqual({ text: "◇", tone: "you" });
  expect(runStatus(runOfCall(call, false)).text).toBe("running");
});
