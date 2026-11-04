import { afterEach, expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession } from "../src/session";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
import { Mouse, MouseContext, MULTI_CLICK_MS } from "./mouse";
import { Store } from "./store";

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

const THREE = turn([call("a"), call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, result: "3 pass" }), call("c")]);

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

let quit: (() => void) | null = null;
afterEach(() => {
  quit?.();
  quit = null;
});

/**
 * astrocode in full screen on a fake terminal, over `state`, with a session that does nothing and the
 * mouse on. `screen()` is the last frame drawn, a row per line, without its colors.
 */
async function launch(state: State, { columns = 200, rows = 40, follow = false } = {}) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows });
  const writes: string[] = [];
  stdout.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const store = new Store("/p", "/home/u");
  store.getSnapshot = () => state;
  store.follow = follow;
  const session = new Proxy({}, { get: (_, name) => (name === "watchMods" ? () => () => {} : name === "knownId" ? undefined : () => Promise.resolve(null)) }) as unknown as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext.Provider value={mouse}>
      <App store={store} session={session} fullscreen onToggleFullscreen={() => {}} onAgents={() => {}} />
    </MouseContext.Provider>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false, debug: true },
  );
  quit = () => {
    app.unmount();
    mouse.stop();
  };
  await settle();
  // Each frame is written whole; the mouse writes its own codes between them.
  const screen = () => stripVTControlCharacters(writes.findLast((one) => one.split("\n").length >= rows - 1) ?? "").split("\n");
  const row = (text: RegExp) => screen().findIndex((line) => text.test(line));
  const press = async (keys: string) => {
    stdin.write(keys);
    await settle();
  };
  /** A click on a cell, once a click before it can't make it a double click. */
  const click = async (x: number, y: number) => {
    await settle(MULTI_CLICK_MS);
    stdin.write(`\x1b[<0;${x + 1};${y + 1}M`);
    await settle(20);
    stdin.write(`\x1b[<0;${x + 1};${y + 1}m`);
    await settle();
  };
  return { screen, row, press, click };
}

test("at 200 columns a click opens a call under its line, with nothing beside the column, and another closes it", async () => {
  const { screen, row, click } = await launch(THREE);
  await click(10, row(/Ran +the tests/));
  const at = row(/Ran +the tests/);
  const lines = screen();
  expect(lines[at + 1]).toContain("‹ 2 of 3 ›");
  expect(lines[at + 1]).toMatch(/^│ {4}Run the tests/);
  expect(lines[at + 2]).toContain("Output");
  // The transcript keeps its whole width: its lines run to the right edge, and no row holds two things side by side.
  expect(lines[at]!.trimEnd().length).toBeGreaterThan(190);
  expect(lines.filter((line) => line.includes("Output")).length).toBe(1);
  await click(10, at);
  expect(screen().some((line) => line.includes("‹ 2 of 3 ›"))).toBe(false);
});

test("Follow Claude docks above the box at 200 columns, not beside the transcript", async () => {
  const state = turn([call("a"), call("b", { name: "Bash", status: "running", input: { command: "sleep 9", description: "Wait a while" } })]);
  const { screen, row } = await launch(state, { follow: true });
  const dock = row(/◉ Following/);
  const line = row(/Waiting +a while/);
  expect(line).toBeGreaterThan(0);
  expect(dock).toBeGreaterThan(line);
  expect(screen()[dock]).not.toMatch(/Waiting +a while/);
  expect(screen()[line]!.trimEnd().length).toBeGreaterThan(190);
});
