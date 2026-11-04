import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { firstSentence, folds, foldsBefore, steps } from "./steps";
import type { SessionEvent } from "../events";
import { initialState, reduce, type State, type ViewEvent } from "./state";

// A turn as Claude Code's messages bring it, one block to a message: Claude's thinking, its
// sentence, its calls and their results, and the result that ends the turn.
const T = 1_000_000;
const sdk = (message: Record<string, unknown>, at = T) => ({ kind: "sdk", message: message as unknown as SDKMessage, at }) as const;
const block = (id: string, content: Record<string, unknown>) =>
  sdk({ type: "assistant", uuid: `a-${id}`, session_id: "s", parent_tool_use_id: null, message: { id: `m-${id}`, model: "claude-opus-5-5", role: "assistant", content: [content] } });
const thought = (id: string, thinking: string) => block(id, { type: "thinking", thinking, signature: "x" });
const said = (id: string, text: string) => block(id, { type: "text", text });
const call = (id: string, name: string, input: Record<string, unknown>) => block(id, { type: "tool_use", id, name, input });
const answered = (id: string, content: string, output?: unknown) =>
  sdk({ type: "user", uuid: `u-${id}`, session_id: "s", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] }, ...(output !== undefined && { tool_use_result: output }) }, T + 1000);
const ended = sdk({ type: "result", subtype: "success", uuid: "r", session_id: "s", duration_ms: 6000, num_turns: 3, is_error: false, result: "done" }, T + 6000);

/** Two steps of a turn; `n` sets another turn's messages apart. */
const fixing = (n = ""): SessionEvent[] => [
  { kind: "prompt", text: `The tests in src/retry.test.ts fail. Fix retry.${n}` },
  thought(`t1${n}`, "I should read retry and its tests first. Then run the suite."),
  said(`s1${n}`, "Reading retry and its tests to find the off-by-one."),
  call(`r1${n}`, "Read", { file_path: "/work/src/retry.ts" }),
  answered(`r1${n}`, "1\tx"),
  thought(`t2${n}`, "The loop runs attempts + 1 times."),
  said(`s2${n}`, "Running the suite to see the failure first."),
  call(`b1${n}`, "Bash", { command: "bun test", description: "Run the tests" }),
  answered(`b1${n}`, "3 pass\n1 fail"),
];

const play = (events: ViewEvent[], state: State = initialState("/work", "/home")) => events.reduce(reduce, state);
const folded = (state: State, replayed = false) => [...steps(state.items).values()].map((step) => folds(step, foldsBefore(state.items, replayed)));

test("a step keeps the thinking that led to it, and folds to its sentence once its turn is over", () => {
  const working = play(fixing());
  const found = [...steps(working.items).values()];
  expect(found.map((step) => [step.members[0]?.kind, step.title?.text])).toEqual([
    ["thinking", "Reading retry and its tests to find the off-by-one."],
    ["thinking", "Running the suite to see the failure first."],
  ]);
  expect(folded(working)).toEqual([false, false]);
  expect(folded(reduce(working, ended))).toEqual([true, true]);
  // A turn you stopped is over too.
  expect(folded(reduce(working, { ...ended, message: { ...ended.message, subtype: "error_during_execution", is_error: true, errors: [] } as unknown as SDKMessage }))).toEqual([true, true]);
});

test("a step whose command still runs in the background stays open after the turn, until it ends", () => {
  const watching = play([...fixing(), call("w1", "Bash", { command: "sleep 90", run_in_background: true }), answered("w1", "Command running in background with ID: w9", { backgroundTaskId: "w9" }), ended]);
  expect(folded(watching)).toEqual([true, false]);
});

test("in scrollback only a resumed conversation's turns fold, since what scrollback wrote stays as it was written", () => {
  const resumed = reduce(initialState("/work", "/home"), { kind: "history", events: fixing() });
  const live = play([...fixing(" again"), ended], resumed);
  expect(folded(live)).toEqual([true, true, true, true]);
  expect(folded(live, true)).toEqual([true, true, false, false]);
});

test("a thinking line says the first sentence of Claude's summary, and opens when there's more", () => {
  expect(firstSentence("I should read retry and its tests first. Then run the suite.\n\n")).toEqual({ text: "I should read retry and its tests first.", more: true });
  expect(firstSentence("The loop runs attempts + 1 times.\n\n")).toEqual({ text: "The loop runs attempts + 1 times.", more: false });
  // A sentence that runs over lines is one line, and a summary's own heading is its first sentence.
  expect(firstSentence("Cache only needs `now()`; retry needs\n`now()` and `sleep()`, e.g. for its delays")).toEqual({ text: "Cache only needs `now()`; retry needs `now()` and `sleep()`, e.g. for its delays", more: false });
  expect(firstSentence("**Finding the off-by-one**\n\nThe loop bound is wrong.")).toEqual({ text: "**Finding the off-by-one**", more: true });
});
