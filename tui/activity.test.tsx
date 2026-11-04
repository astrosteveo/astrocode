import { afterEach, expect, setSystemTime, test } from "bun:test";
import { render, renderToString } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { initialState, type Item, type State, type TaskInfo, type ToolCall } from "../src/view/state";
import { Activity } from "./activity";

const working: State = { ...initialState("/p", "/home/u"), busy: true };

/** The now line over `state`, without its colors and the spaces before its keys. */
const nowLine = (state: State, width = 100) => stripVTControlCharacters(renderToString(<Activity state={state} width={width} />, { columns: width })).replace(/ {2,}/g, "  ");

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

test("while a command or subagent Claude waits on can move to the background, the now line offers the key that moves it", () => {
  const command = running({ name: "Bash", input: { command: "bun test", description: "Run the tests" }, elapsed: 8 });
  const task = (patch: Partial<TaskInfo>): State => ({ ...command, taskInfo: { t: { id: "t", description: "bun test", type: "local_bash", toolUseId: "c", background: false, status: "running", ...patch } } });
  expect(nowLine(task({}))).toBe("◐ Running the tests · 8s  esc to stop  ctrl+b background");
  expect(nowLine(task({ type: "local_agent" }))).toBe("◐ Running the tests · 8s  esc to stop  ctrl+b background");
  // Before Claude Code has made it a task it can't move yet, and once moved or ended there's nothing to.
  expect(nowLine(command)).toBe("◐ Running the tests · 8s  esc to stop");
  expect(nowLine(task({ background: true }))).toBe("◐ Running the tests · 8s  esc to stop");
  expect(nowLine(task({ status: "completed" }))).toBe("◐ Running the tests · 8s  esc to stop");
});

test("at 80 columns the now line stays one row: what Claude does is cut to leave its time, tokens and keys", () => {
  const explore = running({ name: "Agent", input: { subagent_type: "pr-review-toolkit:silent-failure-hunter", description: "Hunt" }, elapsed: 72 });
  const moving = { ...explore, turnTokens: 12_000, taskInfo: { t: { id: "t", description: "Hunt", type: "local_agent", toolUseId: "c", background: false, status: "running" as const } } };
  const tool = { messageId: "m", blocks: [{ kind: "tool" as const, name: "mcp__claude_ai_Claude_Docs__batch_create_document_from_template", text: "" }], finalized: 0 };
  const command = running({ name: "Bash", input: { command: `bun test ${"src/a-rather-long-folder/".repeat(4)}` }, elapsed: 8 });
  const read = running({ name: "Read", input: { file_path: "/p/src/some/really/deep/folder/structure/that/goes/on/and/on/retry.ts" } });
  const retry = { ...working, retry: { attempt: 2, max: 10, at: Date.now(), delayMs: 8000, status: 529, error: "a_very_long_reason_that_claude_code_gave_for_this_failure" } };
  const cases: [State, string][] = [
    [moving, "◐ Waiting on pr-review-t… · 1m 12s · 12k tokens  esc to stop  ctrl+b background"],
    [{ ...working, live: tool }, "◐ Getting batch_create_document_from_template (claude_ai_Clau… · 1s  esc to stop"],
    [command, "◐ Running bun test src/a-rather-long-folder/src/a-rather-long… · 8s  esc to stop"],
    // A path keeps its end, the file's name.
    [read, "◐ Reading …/deep/folder/structure/that/goes/on/and/on/retry.ts · 1s  esc to stop"],
    [retry, "◐ Retrying in 8s · a very long reason that claude code gave for th…  esc to stop"],
  ];
  for (const [state, line] of cases) {
    expect(nowLine(state, 80)).toBe(line);
    expect(stripVTControlCharacters(renderToString(<Activity state={state} width={80} />, { columns: 80 }))).toHaveLength(80);
  }
});

test("a request tried again says when, why and which attempt", () => {
  const retry = { attempt: 2, max: 10, at: Date.now(), delayMs: 8000, status: 529, error: "overloaded" };
  expect(nowLine({ ...working, turnTokens: 400, retry })).toBe("◐ Retrying in 8s · overloaded · attempt 2 of 10  esc to stop");
  expect(nowLine({ ...working, retry: { ...retry, at: 0, status: null } })).toBe("◐ Retrying · no connection · attempt 2 of 10  esc to stop");
});

test("there's no now line while Claude waits on you, or once it's done", () => {
  const asking = running({ name: "Bash", input: { command: "rm -rf build" } });
  expect(nowLine({ ...asking, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] })).toBe("");
  expect(nowLine({ ...working, elicitations: [{ id: "e", server: "github", serverName: "github", message: "Pick a repository", mode: "form", fields: [] }] })).toBe("");
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
