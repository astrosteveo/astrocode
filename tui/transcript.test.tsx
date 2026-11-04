import { expect, spyOn, test } from "bun:test";
import * as ink from "ink";
import { stripVTControlCharacters } from "node:util";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { callTarget, STEP_NODES } from "./entries";
import { DEFAULT_KEYMAP } from "./keys";
import { cellWidth } from "./markdown";
import { moveTarget, tabTarget, WHOLE } from "./opened";
import { startOf } from "./start";
import { layout, type Transcript } from "./transcript";

const call = (id: string, more: Partial<ToolCall> = {}): ToolCall => ({ id, name: "Grep", input: { pattern: id, path: "/p/src" }, status: "done", subagentCalls: 0, result: "src/a.ts", ...more });

/** A turn: your message, Claude's sentence, then its calls, which make one step. */
function turn(calls: ToolCall[]): State {
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "look around" },
    { kind: "text", key: "t", text: "Looking around." },
    ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one })),
  ];
  return { ...initialState("/p", "/home/u"), items, tools: Object.fromEntries(calls.map((one, i) => [one.id, i + 2])) };
}

const plain = (transcript: Transcript) => transcript.rows.map((row) => stripVTControlCharacters(row.text));
const input = (state: State, width: number, opened?: { id: string; tab?: "result" | "input"; whole?: boolean }) => ({
  state,
  width,
  pictureRows: 10,
  start: startOf(state, undefined, DEFAULT_KEYMAP),
  expanded: new Set<string>(),
  waiting: new Set<string>(),
  opened,
});

test("a call opens under its own line, inside the column, at every width", () => {
  const state = turn([call("a"), call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, result: "3 pass" }), call("c")]);
  for (const width of [78, 118, 198]) {
    const transcript = layout(input(state, width, { id: "b" }));
    const lines = plain(transcript);
    const at = transcript.starts.get("b")!;
    expect(lines[at]).toContain("the tests");
    // The header, then the tabs, right under the line, on a panel from column 4 with a cell of
    // padding: nothing stands beside the column.
    expect(lines[at + 1]).toMatch(/^│ {4}\S/);
    expect(lines[at + 1]).toContain("‹ 2 of 3 ›");
    expect(lines[at + 2]).toContain("Output");
    expect(lines[at + 2]).toContain("Command");
    expect(transcript.opened).toMatchObject({ id: "b", tab: "output" });
    // Closing it is what the panel's rows do; the next call's line follows them.
    expect(transcript.rows[at + 1]).toMatchObject({ target: callTarget("b"), open: true, hot: true });
    expect(lines.findIndex((line) => line.includes("Searched  c"))).toBeGreaterThan(at + 3);
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width);
  }
  // Closed again, it's one line.
  const closed = plain(layout(input(state, 118)));
  expect(closed.some((line) => line.includes("‹ 2 of 3 ›"))).toBe(false);
});

test("its tabs and arrows answer to a click where they're drawn", () => {
  const transcript = layout(input(turn([call("a"), call("b")]), 118, { id: "a" }));
  const at = transcript.starts.get("a")!;
  const [header, tabs] = [transcript.rows[at + 1]!, transcript.rows[at + 2]!];
  const cells = (text: string, from: number, to: number) => [...stripVTControlCharacters(text)].slice(from, to).join("");
  for (const spot of tabs.spots!) expect(["Results", "Input"].some((name) => cells(tabs.text, spot.from, spot.to).includes(name))).toBe(true);
  expect(tabs.spots!.map((spot) => spot.target)).toEqual([tabTarget("results"), tabTarget("input")]);
  const [back, forward] = header.spots!;
  expect(back!.target).toBe(moveTarget(-1));
  expect(cells(header.text, back!.from, back!.to)).toBe("‹ ");
  expect(forward!.target).toBe(moveTarget(1));
  expect(cells(header.text, forward!.from, forward!.to)).toBe(" ›");
  // Another tab, picked.
  expect(layout(input(turn([call("a"), call("b")]), 118, { id: "a", tab: "input" })).opened?.tab).toBe("input");
});

test("a long tab shows its first 12 and last 8 lines, and the line between opens the rest", () => {
  const result = Array.from({ length: 40 }, (_, i) => `match ${i + 1}`).join("\n");
  const state = turn([call("a", { result })]);
  const folded = layout(input(state, 118, { id: "a" }));
  const lines = plain(folded);
  const at = folded.starts.get("a")!;
  const more = lines.findIndex((line) => line.includes("⋯ 20 lines"));
  expect(more).toBe(at + 3 + 12);
  expect(folded.rows[more]!.target).toBe(WHOLE);
  expect(lines[more - 1]).toContain("match 12");
  expect(lines[more + 1]).toContain("match 33");
  expect(lines.some((line) => line.includes("match 20"))).toBe(false);
  const whole = plain(layout(input(state, 118, { id: "a", whole: true })));
  expect(whole.some((line) => line.includes("⋯"))).toBe(false);
  expect(whole.some((line) => line.includes("match 20"))).toBe(true);
});

test("a call a closed step leaves out opens the step, to go under its line", () => {
  const calls = Array.from({ length: 8 }, (_, i) => call(`c${i}`));
  const closed = plain(layout(input(turn(calls), 118)));
  expect(closed.some((line) => line.includes("… 3 more"))).toBe(true);
  expect(closed.some((line) => line.includes("c4"))).toBe(false);
  const opened = layout(input(turn(calls), 118, { id: "c4" }));
  const lines = plain(opened);
  const at = opened.starts.get("c4")!;
  expect(lines[at]).toContain("c4");
  expect(lines[at + 1]).toContain("‹ 5 of 8 ›");
});

test("a whole tab opened isn't drawn again each time Claude starts another call in the turn", () => {
  const result = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n");
  const big = call("a", { name: "Bash", input: { command: "cat big.log", description: "Print the log" }, result });
  const before = layout(input(turn([big]), 118, { id: "a", whole: true }));
  const drawn = spyOn(ink, "renderToString");
  const after = layout(input(turn([big, call("n")]), 118, { id: "a", whole: true }));
  const tall = drawn.mock.results.filter((one) => String(one.value).split("\n").length > 100);
  drawn.mockRestore();
  expect(tall).toHaveLength(0);
  // What's drawn is as it was, but for the count of the turn's calls.
  const header = (transcript: Transcript) => plain(transcript).find((line) => line.includes(" of "));
  expect(header(before)).toContain("‹ 1 of 1 ›");
  expect(header(after)).toContain("‹ 1 of 2 ›");
  const body = (transcript: Transcript) => plain(transcript).filter((line) => / line \d+$/.test(line.trimEnd()));
  expect(body(after)).toEqual(body(before));
  expect(body(after)).toHaveLength(3000);
});

const BUN_FAILED = [
  "src/retry.test.ts:",
  "error: expect(received).toBe(expected)",
  "",
  "Expected: 3",
  "Received: 4",
  "",
  "(fail) tries exactly `attempts` times [151.19ms]",
  "",
  " 3 pass",
  " 1 fail",
  "Ran 4 tests across 1 file. [2.07s]",
].join("\n");

/**
 * A turn of two steps, each led by Claude's thinking, and the reply. The second step's run of the
 * tests failed. `ended` closes the turn with its ledger, else Claude is still at it.
 */
function fixing(ended: boolean): State {
  const steps = [
    call("r", { name: "Read", input: { file_path: "/p/src/retry.ts" }, result: "1\tx", startedAt: 0, endedAt: 400 }),
    call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, status: "error", result: BUN_FAILED, startedAt: 1000, endedAt: 3100 }),
  ];
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "The tests in src/retry.test.ts fail. Fix retry." },
    { kind: "thinking", key: "k1", text: "I should read retry and its tests first. Then run the suite, so the failure is on record." },
    { kind: "text", key: "s1", text: "Reading retry and its tests to find the off-by-one.", at: 0 },
    { kind: "tool", key: "r", call: steps[0]! },
    { kind: "thinking", key: "k2", text: "The loop runs attempts + 1 times." },
    { kind: "text", key: "s2", text: "Running the suite to see the failure first.", at: 1000 },
    { kind: "tool", key: "b", call: steps[1]! },
    { kind: "thinking", key: "k3", text: "The failure is on record. Time to say so." },
    { kind: "text", key: "reply", text: "The suite fails as expected: retry tries 4 times, not 3." },
    ...(ended ? [{ kind: "turn" as const, key: "end", outcome: "finished" as const, durationMs: 6000, tokens: 1200, commands: ["bun test"], tests: { passed: 3, failed: 1 } }] : []),
  ];
  return { ...initialState("/p", "/home/u"), items, busy: !ended, tools: { r: 3, b: 6 } };
}

const at = (lines: string[], text: string) => lines.findIndex((line) => line.includes(text));

test("while Claude works, its thinking stands above the step it led to, as its first sentence, and the step shows its calls", () => {
  const lines = plain(layout(input(fixing(false), 118)));
  expect(at(lines, "∴ I should read retry and its tests first.")).toBeGreaterThan(-1);
  expect(at(lines, "Then run the suite")).toBe(-1);
  expect(at(lines, "∴ I should read")).toBeLessThan(at(lines, "Reading retry and its tests"));
  expect(at(lines, "∴ The loop runs")).toBeLessThan(at(lines, "Running the suite to see"));
  expect(at(lines, "src/retry.ts")).toBeGreaterThan(at(lines, "Reading retry and its tests"));
  // Thinking that led to the reply stands above the reply.
  expect(at(lines, "∴ The failure is on record.")).toBeLessThan(at(lines, "The suite fails as expected"));
});

test("Enter on a thinking line opens the whole of it in place, and again closes it", () => {
  const shut = layout(input(fixing(false), 118));
  const row = shut.rows[at(plain(shut), "∴ I should read")]!;
  expect(row).toMatchObject({ hot: true, target: "k1" });
  const open = plain(layout({ ...input(fixing(false), 118), expanded: new Set(["k1"]) }));
  expect(at(open, "Then run the suite")).toBeGreaterThanOrEqual(at(open, "∴ I should read"));
  expect(at(open, "Then run the suite")).toBeLessThan(at(open, "Reading retry and its tests"));
  // A thought of one sentence has nothing more to open.
  const one = shut.rows[at(plain(shut), "∴ The loop runs")]!;
  expect(one.target).toBeUndefined();
});

test("once the turn is over, its steps fold to their sentences, with the failure kept under the step that failed", () => {
  const lines = plain(layout(input(fixing(true), 118)));
  const read = at(lines, "Reading retry and its tests to find the off-by-one");
  const ran = at(lines, "Running the suite to see the failure first");
  expect(lines[read]!.startsWith(`${STEP_NODES.done.node} `)).toBe(true);
  expect(lines[ran]!.startsWith(`${STEP_NODES.failed.node} `)).toBe(true);
  expect(lines[read]).toContain("0.4s");
  // No row between folded steps, nor between the message and the first of them.
  expect(ran).toBe(read + 1);
  expect(lines[read - 1]).toContain("Fix retry.");
  // The line that failed and why, under its step; the rest of the turn's calls and its thinking are folded away.
  expect(lines[ran + 1]).toContain("the tests");
  expect(lines[ran + 2]).toContain("Expected: 3");
  expect(at(lines, "src/retry.ts")).toBe(-1);
  expect(lines.some((line) => line.includes("∴"))).toBe(false);
  expect(at(lines, "The suite fails as expected")).toBe(ran + 3);
  expect(at(lines, "3 passed 1 failed")).toBeGreaterThan(ran);
});

test("Enter on a folded step opens its calls and thinking under its sentence", () => {
  const shut = layout(input(fixing(true), 118));
  const read = at(plain(shut), "Reading retry and its tests to find the off-by-one");
  // A step goes by its first item, here the thinking that led to it.
  expect(shut.rows[read]).toMatchObject({ hot: true, target: "step:k1" });
  const open = plain(layout({ ...input(fixing(true), 118), expanded: new Set(["step:k1"]) }));
  const heading = at(open, "Reading retry and its tests to find the off-by-one");
  expect(open[heading + 1]).toContain("∴ I should read retry and its tests first.");
  expect(open[heading + 2]).toContain("src/retry.ts");
  // The next step stays folded.
  expect(open[heading + 3]).toContain("Running the suite to see the failure first");
});

test("a call opened in a folded step opens the step, to go under its line", () => {
  const opened = layout(input(fixing(true), 118, { id: "r" }));
  const lines = plain(opened);
  const line = opened.starts.get("r")!;
  expect(lines[line]).toContain("src/retry.ts");
  expect(lines[line + 1]).toContain("‹ 1 of 2 ›");
});

test("a finished turn, folded, at 80, 120 and 200 columns", () => {
  const drawn = [78, 118, 198].map((width) => {
    const lines = plain(layout(input(fixing(true), width)));
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width);
    return lines.slice(lines.findIndex((line) => line.includes("Fix retry."))).map((line) => line.trimEnd()).join("\n");
  });
  expect(drawn).toMatchSnapshot();
});
