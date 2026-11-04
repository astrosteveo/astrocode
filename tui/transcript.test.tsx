import { expect, spyOn, test } from "bun:test";
import * as ink from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { historyEvents } from "../src/history";
import { initialState, reduce, type Item, type State, type ToolCall } from "../src/view/state";
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
    expect(lines[at + 1]).toMatch(/^ {5}\S/);
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

test("an activity line ends at its result, with no › after it and no meter for an edit's size", () => {
  const patch = [{ oldStart: 1, oldLines: 4, newStart: 1, newLines: 9, lines: ["-a", "-b", "-c", "-d", ...Array.from({ length: 9 }, (_, i) => `+${i}`)] }];
  const edit = call("e", { name: "Edit", input: { file_path: "/p/src/retry.ts", old_string: "a", new_string: "b" }, output: { filePath: "/p/src/retry.ts", structuredPatch: patch } });
  const lines = plain(layout(input(turn([call("a"), edit]), 118)));
  expect(lines.find((line) => line.includes("Edited"))?.trimEnd()).toMatch(/src\/retry\.ts +\+9 −4$/);
  for (const line of lines) {
    expect(line).not.toMatch(/›\s*$/);
    expect(line).not.toContain("■");
  }
});

test("no rail: each entry's mark stands alone in the gutter, a blank row sets entries apart, and the ledger closes the reply right under it", () => {
  const state = turn([call("a"), call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, result: "3 pass" })]);
  state.items.push(
    { kind: "text", key: "r", text: "All quiet in here." },
    { kind: "turn", key: "end", outcome: "finished", durationMs: 6000, tokens: 1200, files: [{ path: "/p/src/a.ts", added: 2, removed: 1 }] },
  );
  const transcript = layout(input(state, 118));
  const lines = plain(transcript).slice(transcript.starts.get("p"));
  for (const line of lines) expect(line).not.toMatch(/[│╭╮╯]/);
  // A blank row before your message, the step and the reply, and none inside the step.
  expect(lines.map((line) => line.trim() === "")).toEqual([true, false, true, false, false, false, true, false, false]);
  expect(lines[1]).toMatch(/^● look around/);
  expect(lines[7]).toMatch(/^◆ All quiet in here\./);
  // The ledger's mark, then its readings from where text starts.
  expect(lines[8]).toMatch(/^╰ 6s · 1 file \+2 −1/);
  // An opened call's panel starts at column 4, with nothing in the gutter beside it.
  const opened = plain(layout(input(state, 118, { id: "b" })));
  const at = layout(input(state, 118, { id: "b" })).starts.get("b")!;
  expect(opened[at + 1]).toMatch(/^ {5}Run the tests/);
});

test("a step Claude wrote no sentence for has no heading: its calls sit right under your message, each line opening its call", () => {
  const calls = [call("a"), call("b")];
  const state: State = {
    ...initialState("/p", "/home/u"),
    items: [{ kind: "prompt", key: "p", text: "look around" }, ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one }))],
    tools: { a: 1, b: 2 },
  };
  const transcript = layout(input(state, 118));
  const lines = plain(transcript).slice(transcript.starts.get("p"));
  expect(lines.map((line) => line.trimEnd())).toEqual([
    "",
    "● look around",
    "",
    expect.stringMatching(/^ {4}Searched +a in src/),
    expect.stringMatching(/^ {14}b in src/),
  ]);
  // No name made from the calls, such as `Search for a and b`.
  expect(lines.join("\n")).not.toMatch(/Search for/);
  const first = transcript.starts.get("a")!;
  expect(plain(transcript)[first]).toMatch(/Searched +a in src/);
  expect(transcript.rows[first]).toMatchObject({ head: true, hot: true, target: callTarget("a") });
});

/** Your message, then `items` with no sentence of Claude's before them: one step without a heading. */
function unnamed(items: Item[]): State {
  const tools = Object.fromEntries(items.flatMap((item, i) => (item.kind === "tool" ? [[item.call.id, i + 1]] : [])));
  return { ...initialState("/p", "/home/u"), items: [{ kind: "prompt", key: "p", text: "look around" }, ...items], tools };
}

const tool = (one: ToolCall): Item => ({ kind: "tool", key: one.id, call: one });

test("a step with no heading folds past six lines behind `… N more`, which stays where it was to fold it again", () => {
  // Searches and reads in turn, so no two calls make one line.
  const calls = Array.from({ length: 7 }, (_, i) => (i % 2 ? call(`c${i}`, { name: "Read", input: { file_path: `/p/src/f${i}.ts` }, result: "1\n2" }) : call(`c${i}`)));
  const state = unnamed(calls.map(tool));
  const toggles = (transcript: Transcript) => transcript.rows.flatMap((row, i) => (row.target === "step:c0" ? [i] : []));
  const closed = layout(input(state, 118));
  expect(toggles(closed)).toHaveLength(1);
  const at = toggles(closed)[0]!;
  expect(plain(closed)[at]).toMatch(/^ {4}… 2 more +▸$/);
  // Open, the line stays under the first two lines, with the two it stood for under it, and closes the step.
  const open = layout({ ...input(state, 118), expanded: new Set(["step:c0"]) });
  expect(toggles(open)).toEqual([at]);
  expect(plain(open)[at]).toMatch(/^ {4}… 2 more +▾$/);
  expect(open.rows.slice(at + 1, at + 3).map((row) => row.target)).toEqual([callTarget("c2"), callTarget("c3")]);
});

test("a step with no heading shows Claude's thinking between its calls, as there's no heading to open it by", () => {
  const state = unnamed([
    { kind: "thinking", key: "th0", text: "Search for a first." },
    tool(call("a")),
    { kind: "thinking", key: "th1", text: "Then b." },
    tool(call("b")),
  ]);
  const transcript = layout(input(state, 118));
  const lines = plain(transcript).slice(transcript.starts.get("p")).map((line) => line.trimEnd());
  expect(lines).toEqual(["", "● look around", "", "    ∴ Search for a first.", expect.stringMatching(/^ {4}Searched +a in src/), "    ∴ Then b.", expect.stringMatching(/^ {4}Searched +b in src/)]);
  // Nothing more to open, so nothing says it opens.
  expect(transcript.rows.some((row) => row.target?.startsWith("step:"))).toBe(false);
});

/**
 * The audit's first side-by-side turn, as Claude Code saved it: your message, four commands with no
 * sentence of Claude's before them, and the reply. The spec's mockups give the same task as their
 * first turn, from another run, with a sentence for each step.
 */
function recordedTurn(): State {
  const saved = readFileSync(join(import.meta.dir, "../src/view/fixtures/heredoc-turn.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => ({ ...JSON.parse(line), session_id: "s", parent_tool_use_id: null, parent_agent_id: null }) as SessionMessage);
  return reduce(initialState("/tmp/ac-ux-8259/ac", "/home"), { kind: "history", events: historyEvents(saved) });
}

test("a recorded turn at 120×40 fits in the rows the spec's rules give it", () => {
  // The spec's rows, with text wrapped at the mockups' 110-column measure: your message (3 rows), a
  // blank row, the four commands with no heading, since Claude wrote no sentence before them, a
  // blank row, the reply (18 rows), and the ledger right under it.
  const N = 3 + 1 + 4 + 1 + 18 + 1;
  // At 118 columns, what full screen gives the transcript at 120, and at 112, where text wraps at the mockup's measure.
  for (const width of [118, 112]) {
    const lines = plain(layout(input(recordedTurn(), width)));
    const from = lines.findIndex((line) => line.startsWith("● The tests in src/retry.test.ts fail"));
    const to = lines.findIndex((line) => line.startsWith("╰"));
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(to - from + 1).toBeLessThanOrEqual(N);
    expect(lines[to]).toMatch(/^╰ 1m 39s/);
    expect(lines[to - 1]).toMatch(/getText in src\/http\.ts doesn't pass a clock/);
    for (const line of lines.slice(from, to + 1)) expect(line).not.toMatch(/[│■›]/);
  }
});
