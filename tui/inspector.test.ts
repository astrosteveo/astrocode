import { expect, test } from "bun:test";
import type { ToolCall } from "../src/view/state";
import { LABELS, tabsOf } from "./inspector";

const call = (id: string, more: Partial<ToolCall> = {}): ToolCall => ({ id, name: "Agent", input: {}, status: "done", subagentCalls: 0, ...more });

test("a subagent opens on its calls while it works, in the background too, and on its report once it's done", () => {
  const log = [{ text: "❯ look around", kind: "prompt" as const }];
  expect(tabsOf(call("s", { status: "running" }), log).map((tab) => LABELS[tab])).toEqual(["Calls", "Prompt", "Input"]);
  // Before it has written anything, its calls say so.
  expect(tabsOf(call("s", { status: "running" }))[0]).toBe("transcript");
  expect(tabsOf(call("s", { background: "running" }), log)[0]).toBe("transcript");
  expect(tabsOf(call("s"), log).map((tab) => LABELS[tab])).toEqual(["Report", "Calls", "Prompt", "Input"]);
  expect(tabsOf(call("s"))).toEqual(["report", "prompt", "input"]);
});
