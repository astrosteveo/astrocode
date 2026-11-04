import { expect, spyOn, test } from "bun:test";
import * as ink from "ink";
import { stripVTControlCharacters } from "node:util";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { callTarget } from "./entries";
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
    expect(lines.findIndex((line) => /Searched +c/.test(line))).toBeGreaterThan(at + 3);
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
