import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession } from "../src/session";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
import { Background, Fleet } from "./fleet";
import { cellWidth } from "./markdown";
import { DEFAULT_KEYMAP } from "./keys";
import { edgeOf, isNarrow, MEASURE } from "./measure";
import { Mouse, MouseContext } from "./mouse";
import { scratchConfig } from "./scratch-config";
import { startOf } from "./start";
import { Store } from "./store";
import { layout } from "./transcript";

const call = (id: string, name: string, input: Record<string, unknown>, more: Partial<ToolCall> = {}): ToolCall => ({ id, name, input, status: "done", subagentCalls: 0, ...more });

/**
 * A finished turn as working.png has it: your message, a step that reads, writes and edits, one
 * that runs the tests, whose result doesn't fit beside its line under 100 columns, and Claude's
 * reply, long enough to wrap at the measure, then the turn's ledger.
 */
function turn(): State {
  const calls = [
    call("r", "Read", { file_path: "/p/src/cache.ts" }, { result: Array.from({ length: 25 }, (_, i) => `${i + 1}\tline`).join("\n") }),
    call("w", "Write", { file_path: "/p/src/clock.ts", content: Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join("\n") }, { result: "File created" }),
    call("e", "Edit", { file_path: "/p/src/cache.ts", old_string: "Date.now()", new_string: "this.clock.now()" }, { result: "ok" }),
    call("b", "Bash", { command: "bun test", description: "Run the whole suite, retry's attempts test and the cache's" }, { status: "error", result: "Exit code 1\n 7 pass\n 1 fail\nRan 8 tests across 1 file." }),
  ];
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "Give src/cache.ts the same injectable clock retry needs (Clock type in src/clock.ts), then run bun test. Don't fix retry.", starts: true },
    { kind: "text", key: "t1", text: "I'll put the Clock type in its own file and give Cache an optional clock." },
    { kind: "tool", key: "r", call: calls[0]! },
    { kind: "tool", key: "w", call: calls[1]! },
    { kind: "tool", key: "e", call: calls[2]! },
    { kind: "text", key: "t2", text: "Running the whole suite; retry's attempts test should still fail." },
    { kind: "tool", key: "b", call: calls[3]! },
    {
      kind: "text",
      key: "t3",
      text: "Cache takes a clock now, as retry does: Clock lives in src/clock.ts, and Cache's constructor takes an optional one that defaults to the system clock, so nothing that builds a Cache today has to change. The suite runs 8 tests; retry's attempts test still fails, as you asked.",
    },
    { kind: "turn", key: "end", outcome: "finished", durationMs: 99_000, tokens: 2900, files: [{ path: "/p/src/clock.ts", added: 11, removed: 0, status: "new" }, { path: "/p/src/cache.ts", added: 1, removed: 1 }], commands: ["bun test"] },
  ];
  return {
    ...initialState("/p", "/home/u"),
    items,
    tools: Object.fromEntries(items.flatMap((item, i) => (item.kind === "tool" ? [[item.call.id, i]] : []))),
    model: "claude-opus-5-5",
    effort: "xhigh",
    context: { percentage: 18, tokens: 36_000, max: 200_000 },
    limits: { fiveHour: { utilization: 0.51, resetsAt: 0 }, sevenDay: { utilization: 0.64, resetsAt: 0 } },
    loaded: { version: "2.1.318" },
    recent: [],
  };
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

const config = scratchConfig();
let quit: (() => void) | null = null;
beforeEach(config.start);
afterEach(async () => {
  quit?.();
  quit = null;
  await config.stop();
});

/**
 * astrocode over `state` on a fake terminal `columns` by `rows`, in full screen or scrollback, with a
 * session that does nothing. `screen()` is the last frame drawn, a row per line, without its colors.
 */
async function launch(state: State, columns: number, rows: number, fullscreen = true) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows });
  const writes: string[] = [];
  stdout.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const store = new Store("/p", "/home/u");
  store.getSnapshot = () => state;
  store.subscribe = () => () => {};
  const session = new Proxy({}, { get: (_, name) => (name === "watchMods" ? () => () => {} : name === "knownId" ? undefined : () => Promise.resolve(null)) }) as unknown as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext.Provider value={mouse}>
      {/* No conversations besides this one, and no background sessions: never the real `claude agents`. */}
      <App store={store} session={session} fullscreen={fullscreen} onToggleFullscreen={() => {}} onAgents={() => {}} fleet={new Fleet()} backgroundSessions={new Background(async () => [])} agentsHint={Promise.resolve(false)} />
    </MouseContext.Provider>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false, debug: true },
  );
  quit = () => {
    app.unmount();
    mouse.stop();
  };
  await settle();
  // Each frame is written whole, scrollback's with what it wrote for good above it.
  const screen = () => stripVTControlCharacters(writes.findLast((one) => one.includes("ask first")) ?? "").split("\n");
  const press = async (keys: string) => {
    stdin.write(keys);
    await settle();
  };
  return { screen, press };
}

/** The transcript's rows: those above the box's top edge, less full screen's scrollbar at the right. */
const transcriptOf = (lines: string[], columns: number) => lines.slice(0, lines.findIndex((line) => /^[▁▄]{20}/.test(line))).map((line) => [...line].slice(0, columns - 2).join("").trimEnd());

test("the transcript's width: two columns short of the terminal's, and no wider than the measure", () => {
  expect([80, 99, 100, 120, 200].map(edgeOf)).toEqual([78, 97, 98, 112, 112]);
  expect(edgeOf(1000)).toBe(MEASURE + 2);
  // Under 100 columns, not at 100.
  expect([80, 99, 100, 120, 200].map((columns) => isNarrow(edgeOf(columns)))).toEqual([true, true, false, false, false]);
});

test("the transcript keeps to the measure at every width, in full screen and in scrollback, while the status bar takes the whole width", async () => {
  for (const fullscreen of [true, false]) {
    for (const [columns, rows, edge] of [
      [80, 24, 78],
      [120, 40, 112],
      [200, 50, 112],
    ] as const) {
      const { screen } = await launch(turn(), columns, rows, fullscreen);
      const lines = screen();
      quit?.();
      const transcript = transcriptOf(lines, columns);
      const widest = Math.max(...transcript.map(cellWidth));
      // Claude's reply wraps at the measure, so something reaches it, and nothing goes past it.
      expect(widest).toBe(edge);
      // The readings kept longest are there at every width.
      expect(lines.at(-1)).toMatch(/context .* 7d 64%/);
      if (columns === 200) expect(cellWidth(lines.at(-1)!.trimEnd())).toBeGreaterThan(190);
    }
  }
});

test("a conversation that fits starts at the top, under the start screen, and its end sits right above a decision", async () => {
  const { screen } = await launch(turn(), 200, 50);
  const lines = screen();
  quit?.();
  expect(lines[1]).toStartWith("  astrocode");
  // What's left over is under it, above the box.
  expect(transcriptOf(lines, 200).at(-1)).toBe("");

  const command = { command: "rm -rf build", description: "Clean the build" };
  const before = turn();
  const items: Item[] = [...before.items, { kind: "prompt", key: "p2", text: "and clean up", starts: true }, { kind: "tool", key: "c", call: call("c", "Bash", command, { status: "running" }) }];
  const asking: State = { ...before, items, tools: { ...before.tools, c: items.length - 1 }, busy: true, pending: [{ id: "c", toolName: "Bash", input: command, description: command.description }] };
  const decided = await launch(asking, 200, 50);
  const shown = decided.screen();
  // The call's own line, under the step's.
  const asks = shown.findIndex((line) => /^│\s+Clean\s+the build/.test(line));
  expect(shown[asks + 1]).toMatch(/^▁+$/);
  expect(shown[1]).toBe("");
});

test("under 100 columns a result that doesn't fit beside its line goes under it, where the target starts; from 100 the target is cut for it", () => {
  const state = turn();
  for (const columns of [80, 99, 100, 120]) {
    const width = edgeOf(columns);
    const { rows } = layout({ state, width, pictureRows: 10, start: startOf(state, undefined, DEFAULT_KEYMAP), expanded: new Set(), waiting: new Set() });
    const lines = rows.map((row) => stripVTControlCharacters(row.text));
    const at = lines.findIndex((line) => /Ran +the whole suite/.test(line));
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(width);
    if (columns < 100) {
      expect(lines[at]).toContain("the whole suite, retry's attempts test and the cache's");
      expect(lines[at]).not.toContain("exit 1");
      const under = lines[at + 1]!;
      expect([...under].indexOf("✕")).toBe([...lines[at]!].indexOf("t", [...lines[at]!].indexOf("Ran") + 3));
      expect(under.trimEnd()).toEndWith("✕ exit 1 · 7 passed, 1 failed");
      // Both rows are the call's: a click on either opens it.
      expect(rows[at + 1]!.target).toBe(rows[at]!.target);
    } else {
      expect(lines[at]).toContain("✕ exit 1 · 7 passed, 1 failed");
      expect(lines[at]!.includes("…")).toBe(columns === 100);
    }
  }
});

const KEYS = { ctrlO: "\x0f", down: "\x1b[B", enter: "\r" };

test("render snapshots at 80×24, 120×40 and 200×50: the turn as it ended, a call opened under its line, and a file's diff opened in the turn's ledger", async () => {
  for (const [columns, rows] of [
    [80, 24],
    [120, 40],
    [200, 50],
  ] as const) {
    const frame = (lines: string[]) => lines.map((line) => line.trimEnd()).join("\n");
    const ended = await launch(turn(), columns, rows);
    expect(frame(ended.screen())).toMatchSnapshot(`${columns}×${rows} ended`);
    quit?.();

    // The call that ran the tests, found and opened with the transcript's keys.
    const call = await launch(turn(), columns, rows);
    await call.press(KEYS.ctrlO);
    await call.press("/");
    for (const key of "whole suite") await call.press(key);
    await call.press(KEYS.enter);
    await call.press(KEYS.enter);
    const opened = call.screen();
    expect(opened.some((line) => line.includes("Sent to Claude"))).toBe(true);
    expect(frame(opened)).toMatchSnapshot(`${columns}×${rows} call opened`);
    quit?.();

    // The ledger on its closing line, and the edited file's diff under the file.
    const ledger = await launch(turn(), columns, rows);
    await ledger.press(KEYS.ctrlO);
    await ledger.press(KEYS.enter);
    await ledger.press(KEYS.down);
    await ledger.press(KEYS.down);
    await ledger.press(KEYS.enter);
    const diff = ledger.screen();
    expect(diff.some((line) => line.includes("this.clock.now()"))).toBe(true);
    expect(frame(diff)).toMatchSnapshot(`${columns}×${rows} diff opened`);
    quit?.();

    // Nothing opens beside the column: what's open keeps to the measure, too.
    for (const lines of [opened, diff]) for (const line of transcriptOf(lines, columns)) expect(cellWidth(line)).toBeLessThanOrEqual(edgeOf(columns));
  }
}, 60_000);
