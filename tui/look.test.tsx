import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession } from "../src/session";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
import { Background, Fleet } from "./fleet";
import { Mouse, MouseContext } from "./mouse";
import { scratchConfig } from "./scratch-config";
import { Store } from "./store";

const COLUMNS = 120;
const ROWS = 40;

// What the App might save, settings or prompt history, goes to a scratch folder, never yours.
const config = scratchConfig();
let quit: (() => void) | null = null;
beforeEach(config.start);
afterEach(async () => {
  quit?.();
  quit = null;
  await config.stop();
});

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

const call = (id: string, more: Partial<ToolCall> = {}): ToolCall => ({ id, name: "Grep", input: { pattern: id, path: "/p/src" }, status: "done", subagentCalls: 0, result: "src/a.ts", ...more });

/** A finished turn: your message, Claude's sentence, its calls, and the reply. */
function turn(more: Partial<State> = {}): State {
  const calls = [call("a"), call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, result: "3 pass" })];
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "look around" },
    { kind: "text", key: "t", text: "Looking around." },
    ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one })),
    { kind: "text", key: "r", text: "All quiet in here." },
  ];
  return { ...initialState("/p", "/home/u"), items, tools: { a: 2, b: 3 }, ...more };
}

/** astrocode full screen at 120×40 over `state`, with a session that does nothing. `frame()` is the last frame drawn, a row per line. */
async function launch(state: State) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: COLUMNS, rows: ROWS });
  const writes: string[] = [];
  stdout.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const store = new Store("/p", "/home/u");
  store.getSnapshot = () => state;
  store.subscribe = () => () => {};
  const session = new Proxy({}, { get: (_, key) => (key === "then" || key === "knownId" ? undefined : key === "watchMods" ? () => () => {} : () => Promise.resolve(null)) }) as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext.Provider value={mouse}>
      <App
        store={store}
        session={session}
        fullscreen
        onToggleFullscreen={() => {}}
        onAgents={() => {}}
        fleet={new Fleet()}
        backgroundSessions={new Background(async () => [])}
        agentsHint={Promise.resolve(false)}
      />
    </MouseContext.Provider>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false, debug: true },
  );
  quit = () => {
    app.unmount();
    mouse.stop();
  };
  await settle();
  // Each frame is written whole; the mouse writes its own codes between them.
  const frame = () => stripVTControlCharacters(writes.findLast((one) => one.split("\n").length >= ROWS - 1) ?? "").split("\n");
  return { frame };
}

/** The rows from the box's hairline to the bottom of the screen. */
const chrome = (lines: string[]) => lines.slice(lines.findIndex((line) => /^▁{20}/.test(line))).filter((line, i, all) => i < all.length - 1 || line !== "");

test("under the transcript, the box is its hairline and a row, then the status bar, and nothing else", async () => {
  const { frame } = await launch(turn());
  const rows = chrome(frame());
  expect(rows).toHaveLength(3);
  expect(rows[1]).toMatch(/^ ❯/);
});
