import { afterEach, expect, setSystemTime, test } from "bun:test";
import { render, renderToString } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { Activity } from "./activity";

const working: State = { ...initialState("/p", "/home/u"), busy: true };

/** The now line over `state`, without its colors and the spaces before its keys. */
const nowLine = (state: State) => stripVTControlCharacters(renderToString(<Activity state={state} width={100} />, { columns: 100 })).replace(/ {2,}/g, "  ");

/** Claude at work on `call`, which runs. */
function running(call: Partial<ToolCall> & Pick<ToolCall, "name" | "input">): State {
  const item: Item = { kind: "tool", key: "c", call: { id: "c", status: "running", subagentCalls: 0, ...call } };
  return { ...working, items: [{ kind: "prompt", key: "p", text: "go" }, item], tools: { c: 1 } };
}

test("the now line names what Claude is doing, its time and the turn's tokens, with the key that stops it", () => {
  const live = (kind: "thinking" | "text") => ({ ...working, turnTokens: 400, live: { messageId: "m", blocks: [{ kind, text: "" }], finalized: 0 } });
  expect(nowLine(live("thinking"))).toBe("◐ Thinking · 1s · 400 tokens  esc to stop");
  expect(nowLine(live("text"))).toBe("◐ Writing · 1s · 400 tokens  esc to stop");
  expect(nowLine({ ...working, compacting: true })).toBe("◐ Compacting · 1s  esc to stop");
});

test("a call is named as its activity line names it, in the present tense, with the time it has run", () => {
  expect(nowLine(running({ name: "Bash", input: { command: "bun test", description: "Run the tests" }, elapsed: 8 }))).toBe("◐ Running the tests · 8s  esc to stop");
  expect(nowLine(running({ name: "Bash", input: { command: "bun test" }, elapsed: 8 }))).toBe("◐ Running bun test · 8s  esc to stop");
  expect(nowLine(running({ name: "Read", input: { file_path: "/p/src/retry.ts" } }))).toBe("◐ Reading src/retry.ts · 1s  esc to stop");
  expect(nowLine(running({ name: "Grep", input: { pattern: "Date.now", path: "/p/src" } }))).toBe("◐ Searching Date.now in src · 1s  esc to stop");
});

test("while a subagent runs, the now line says Claude waits on it", () => {
  expect(nowLine(running({ name: "Agent", input: { subagent_type: "Explore", description: "Find the clock" }, elapsed: 72 }))).toBe("◐ Waiting on Explore · 1m 12s  esc to stop");
  expect(nowLine(running({ name: "Agent", input: { subagent_type: "general-purpose", description: "Find the clock" } }))).toBe("◐ Waiting on a subagent · 1s  esc to stop");
});

test("a request tried again says when, why and which attempt", () => {
  const retry = { attempt: 2, max: 10, at: Date.now(), delayMs: 8000, status: 529, error: "overloaded" };
  expect(nowLine({ ...working, turnTokens: 400, retry })).toBe("◐ Retrying in 8s · overloaded · attempt 2 of 10  esc to stop");
  expect(nowLine({ ...working, retry: { ...retry, at: 0, status: null } })).toBe("◐ Retrying · no connection · attempt 2 of 10  esc to stop");
});

test("there's no now line while Claude waits on you, or once it's done", () => {
  const asking = running({ name: "Bash", input: { command: "rm -rf build" } });
  expect(nowLine({ ...asking, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] })).toBe("");
  expect(nowLine({ ...working, elicitations: [{ id: "e", server: "github", message: "Pick a repository", mode: "form", fields: [] }] })).toBe("");
  expect(nowLine({ ...working, busy: false })).toBe("");
});

let quit: (() => void) | null = null;
afterEach(() => {
  quit?.();
  quit = null;
  setSystemTime();
});

/** One now line on a fake terminal, drawn again for each state `show` gets, as the app keeps it; `show` gives its last frame. */
function mounted(state: State) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 10 });
  let frame = "";
  stdout.on("data", (chunk: Buffer) => {
    frame = chunk.toString();
  });
  const app = render(<Activity state={state} width={100} />, { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false, debug: true });
  quit = () => app.unmount();
  return async (next: State) => {
    app.rerender(<Activity state={next} width={100} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return stripVTControlCharacters(frame).trim().replace(/ {2,}/g, "  ");
  };
}

test("the now line's clock starts when the line shows: not while Claude was idle, nor while it waited on you", async () => {
  setSystemTime(Date.now());
  const idle = { ...working, busy: false };
  const show = mounted(idle);
  await show(idle);
  setSystemTime(Date.now() + 5 * 60_000);
  expect(await show(working)).toBe("◐ Working · 1s  esc to stop");

  const command = { command: "rm -rf build", description: "Clean the build" };
  const asking = running({ name: "Bash", input: command });
  await show({ ...asking, pending: [{ id: "c", toolName: "Bash", input: command }] });
  setSystemTime(Date.now() + 2 * 60_000);
  expect(await show(asking)).toBe("◐ Cleaning the build · 1s  esc to stop");
});
