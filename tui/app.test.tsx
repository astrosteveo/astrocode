import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession, TaskOutput } from "../src/session";
import { saved } from "../src/settings";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
import { Background, Fleet } from "./fleet";
import { Mouse, MouseContext, MULTI_CLICK_MS } from "./mouse";
import { scratchConfig } from "./scratch-config";
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

// Shift+Tab saves the mode it picks, so every test gets a scratch config folder in place of yours.
const config = scratchConfig();
let quit: (() => void) | null = null;
beforeEach(config.start);
afterEach(async () => {
  quit?.();
  quit = null;
  await config.stop();
});

/**
 * astrocode in full screen (or with `fullscreen: false` in scrollback) on a fake terminal, over
 * `state`, with a session that does nothing but answer `taskOutput` as `output` says and what
 * `session` answers, and the mouse on. `screen()` is the last frame drawn, a row per line, without
 * its colors; `update()` puts another state in its place.
 */
async function launch(state: State, { columns = 200, rows = 40, fullscreen = true, output = (_id: string): TaskOutput | null => null, session: answers = {} as Record<string, (...args: unknown[]) => Promise<unknown>> } = {}) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows });
  const writes: string[] = [];
  stdout.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const store = new Store("/p", "/home/u");
  let current = state;
  const listeners = new Set<() => void>();
  store.getSnapshot = () => current;
  store.subscribe = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  /** What the app asked of the session, by method, and with what. */
  const asked: string[] = [];
  const calls: { name: string; args: unknown[] }[] = [];
  const session = new Proxy(
    {},
    {
      get: (_, name) =>
        name === "watchMods"
          ? () => () => {}
          : name === "knownId"
            ? undefined
            : (...args: unknown[]) => {
                asked.push(String(name));
                calls.push({ name: String(name), args });
                if (name === "taskOutput") return Promise.resolve(output(String(args[0])));
                return answers[String(name)]?.(...args) ?? Promise.resolve(null);
              },
    },
  ) as unknown as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext.Provider value={mouse}>
      {/* No conversations besides this one, and no background sessions: never the real `claude agents`. */}
      <App
        store={store}
        session={session}
        fullscreen={fullscreen}
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
  let exited = false;
  void app.waitUntilExit().then(() => {
    exited = true;
  });
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
  /** The wheel turned `by` notches at a cell: up when negative. */
  const wheel = async (x: number, y: number, by: number) => {
    for (let i = 0; i < Math.abs(by); i++) stdin.write(`\x1b[<${by < 0 ? 64 : 65};${x + 1};${y + 1}M`);
    await settle();
  };
  const update = async (next: State) => {
    current = next;
    for (const listener of listeners) listener();
    await settle();
  };
  /**
   * The transcript's row the cursor's gold `›` is on, in the gutter or beside an opened call's
   * panel, or -1. The transcript ends at the first edge across the screen, a decision's or the box's.
   */
  const cursor = () => {
    const lines = screen();
    const end = lines.findIndex((line) => /^[▁▄]{20}/.test(line));
    return lines.slice(0, end).findIndex((line) => [...line][1] === "›" || [...line][3] === "›");
  };
  /** Whether the message box has your keys: its top edge is the hairline, not the panel's own edge. */
  const boxKeys = () => {
    const lines = screen();
    const box = lines.findIndex((line) => line.startsWith(" ❯"));
    return /^▁+$/.test(lines[box - 1] ?? "");
  };
  return { screen, row, press, click, wheel, update, cursor, boxKeys, asked, calls, writes, exited: () => exited };
}

const KEYS = { ctrlO: "\x0f", up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", enter: "\r", esc: "\x1b", tab: "\t", shiftTab: "\x1b[Z", ctrlC: "\x03", ctrlL: "\x0c", ctrlA: "\x01", ctrlD: "\x04", shiftUp: "\x1b[1;2A" };

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

/** A turn whose newest call is a subagent Claude waits on, which Claude Code runs as a task. */
function exploring(): State {
  const agent = call("s", { name: "Agent", status: "running", input: { description: "Find the retry code", subagent_type: "Explore", prompt: "Find where retries happen." }, result: undefined });
  const state = turn([call("a"), agent]);
  return {
    ...state,
    busy: true,
    taskInfo: { "agent-1": { id: "agent-1", description: "Find the retry code", type: "local_agent", toolUseId: "s", background: false, status: "running" } },
    agentLogs: { s: [{ text: "❯ Find where retries happen.", kind: "prompt" }, { text: "⬢ Grep  retry", kind: "tool" }] },
  };
}

test("a running subagent opens under its line, its calls streaming in, rather than in /tasks", async () => {
  const { press, screen, row } = await launch(exploring());
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  const lines = screen();
  const at = lines.findIndex((line) => line.includes("‹ 2 of 2 ›"));
  expect(at).toBeGreaterThan(0);
  expect(lines[at + 1]).toMatch(/▐Calls▌ +Prompt +Input/);
  expect(lines[at + 1]).not.toContain("Report");
  expect(row(/⬢ Grep +retry/)).toBeGreaterThan(at);
  expect(row(/Running · enter opens one|Find the retry code.*subagent/)).toBe(-1);
});

test("x stops the running subagent or command under the cursor, opened or not, and nothing that's finished", async () => {
  const sleeping = call("w", { name: "Bash", input: { command: "sleep 90", description: "Wait for the build", run_in_background: true }, background: "running", taskId: "bash-1", result: "Command running in background with ID: bash-1" });
  const state = exploring();
  const items: Item[] = [...state.items.slice(0, 2), { kind: "tool", key: "w", call: sleeping }, ...state.items.slice(2)];
  const both: State = {
    ...state,
    items,
    tools: Object.fromEntries(items.flatMap((item, i) => (item.kind === "tool" ? [[item.call.id, i]] : []))),
    taskInfo: { ...state.taskInfo, "bash-1": { id: "bash-1", description: "Wait for the build", type: "local_bash", toolUseId: "w", background: true, status: "running" } },
  };
  const { press, calls, row, cursor } = await launch(both);
  const stopped = () => calls.filter((one) => one.name === "stopTask").map((one) => one.args[0]);
  await press(KEYS.ctrlO);
  await press("x");
  expect(stopped()).toEqual(["agent-1"]);
  // Opened, from inside it.
  await press(KEYS.enter);
  await press(KEYS.down);
  await press("x");
  expect(stopped()).toEqual(["agent-1", "agent-1"]);
  // A finished call has nothing to stop; a command in the background does.
  await press(KEYS.esc);
  await press(KEYS.up);
  expect(cursor()).toBe(row(/Searched +a in src/));
  await press("x");
  expect(stopped()).toHaveLength(2);
  await press(KEYS.up);
  expect(cursor()).toBe(row(/Waiting +for the build/));
  await press("x");
  expect(stopped()).toEqual(["agent-1", "agent-1", "bash-1"]);
});

/** A turn whose calls `more` started tasks of Claude Code's in the background, which `tasks` has. */
function inBackground(more: ToolCall[], tasks: State["taskInfo"]): State {
  return { ...turn([call("a"), ...more]), taskInfo: tasks };
}

test("a workflow or a Monitor in the background opens its task view, which shows it live", async () => {
  const workflow = call("f", { name: "Workflow", input: { description: "Review the code" }, result: "Workflow launched in the background with ID: wf-1", background: "running", taskId: "wf-1" });
  const monitor = call("m", { name: "Monitor", input: { description: "Watch the logs", command: "tail -f log" }, result: "Monitor started with ID: mon-1", background: "running", taskId: "mon-1" });
  const state = inBackground([monitor, workflow], {
    "wf-1": { id: "wf-1", description: "Review the code", type: "local_workflow", toolUseId: "f", background: true, status: "running" },
    "mon-1": { id: "mon-1", description: "Watch the logs", type: "monitor", toolUseId: "m", background: true, status: "running" },
  });
  const { press, row, screen } = await launch(state);
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(row(/workflow +Review the code/)).not.toBe(-1);
  expect(screen().some((line) => line.includes("▐Result▌"))).toBe(false);
  await press(KEYS.esc);
  await press(KEYS.up);
  await press(KEYS.enter);
  expect(row(/monitor +Watch the logs/)).not.toBe(-1);
  expect(screen().some((line) => line.includes("▐Result▌"))).toBe(false);
});

/** A command Claude started in the background as the task `bash-1`, running or ended as `status` says. */
function waitingForBuild(status: "running" | "completed"): State {
  const sleeping = call("w", { name: "Bash", input: { command: "make all", description: "Build it all", run_in_background: true }, background: status, taskId: "bash-1", result: "Command running in background with ID: bash-1", output: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "bash-1" } });
  return inBackground([sleeping], { "bash-1": { id: "bash-1", description: "Build it all", type: "local_bash", toolUseId: "w", background: true, status } });
}

test("a command in the background opens under its line with its output as it prints, read from Claude Code", async () => {
  let reads = 0;
  const output = (id: string) => (id === "bash-1" ? { output: ++reads === 1 ? "compiling a\n" : "compiling a\ncompiling b\n", total_bytes: 0, truncated: false } : null);
  const { press, screen } = await launch(waitingForBuild("running"), { output });
  const shows = (text: string) => screen().some((line) => line.includes(text));
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(shows("‹ 2 of 2 ›")).toBe(true);
  expect(shows("compiling a")).toBe(true);
  expect(shows("/tasks shows")).toBe(false);
  // Read again each second while it runs.
  await settle(1200);
  expect(shows("compiling b")).toBe(true);
});

test("a command that ended in the background opens on what it printed, not on the note that it started", async () => {
  const output = (id: string) => (id === "bash-1" ? { output: "built 3 files\n", total_bytes: 0, truncated: false } : null);
  const { press, screen } = await launch(waitingForBuild("completed"), { output });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(screen().some((line) => line.includes("built 3 files"))).toBe(true);
  expect(screen().some((line) => line.includes("It printed nothing"))).toBe(false);
});

test("a subagent that ended in the background doesn't give the note that started it as its report", async () => {
  const launched = "Async agent launched successfully.\nagentId: agent-2 (This is an internal ID for your use, do not mention it to the user. Use SendMessage with to: 'agent-2' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.";
  const agent = call("s", { name: "Agent", input: { description: "Map the tests", prompt: "Map the tests.", run_in_background: true }, result: launched, background: "completed", taskId: "agent-2" });
  const state = inBackground([agent], { "agent-2": { id: "agent-2", description: "Map the tests", type: "local_agent", toolUseId: "s", background: true, status: "completed" } });
  const { press, screen } = await launch({ ...state, agentLogs: { s: [{ text: "❯ Map the tests.", kind: "prompt" }, { text: "The tests live in tui.", kind: "text" }] } });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(screen().some((line) => line.includes("‹ 2 of 2 ›"))).toBe(true);
  expect(screen().some((line) => line.includes("Async agent launched"))).toBe(false);
});

test("x on a running call that can't stop on its own says what stops it", async () => {
  const { press, asked, row } = await launch({ ...turn([call("a", { status: "running", result: undefined })]), busy: true });
  await press(KEYS.ctrlO);
  await press("x");
  expect(asked).not.toContain("stopTask");
  expect(row(/Ctrl\+C stops Claude/)).not.toBe(-1);
});

/** A command Claude is running, by its description. */
const running = (id: string, description: string, more: Partial<ToolCall> = {}) => call(id, { name: "Bash", status: "running", input: { command: `make ${id}`, description }, result: undefined, ...more });

test("opening the running call's line opens each call Claude starts after it under its own line, and the one before closes, until you move the cursor", async () => {
  const first = { ...turn([call("a"), running("b", "Build the app")]), busy: true };
  const { press, update, screen, row, cursor } = await launch(first);
  const under = (line: RegExp) => screen()[row(line) + 1] ?? "";
  const opened = () => screen().filter((line) => /‹ \d of \d ›/.test(line)).length;
  await press(KEYS.ctrlO);
  expect(cursor()).toBe(row(/Building +the app/));
  await press(KEYS.enter);
  expect(under(/Building +the app/)).toContain("‹ 2 of 2 ›");
  const built = running("b", "Build the app", { status: "done", result: "built" });
  await update({ ...turn([call("a"), built, running("c", "Lint the code")]), busy: true });
  expect(under(/Linting +the code/)).toContain("‹ 3 of 3 ›");
  expect(opened()).toBe(1);
  expect(cursor()).toBe(row(/Linting +the code/));
  // Moving the cursor stops it: the call open stays open, and the next one opens only if you open it.
  await press(KEYS.up);
  await update({ ...turn([call("a"), built, running("c", "Lint the code", { status: "done", result: "clean" }), running("d", "Test the code")]), busy: true });
  expect(under(/Linted +the code/)).toContain("‹ 3 of 4 ›");
  expect(opened()).toBe(1);
});

test("following Claude goes on past Tab and a click on a tab, and stops at a click on another line", async () => {
  const { press, update, click, screen, row } = await launch({ ...turn([call("a"), running("b", "Build the app")]), busy: true });
  const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
  const done = (id: string, description: string) => running(id, description, { status: "done", result: "ok" });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  await press(KEYS.tab);
  await update({ ...turn([call("a"), done("b", "Build the app"), running("c", "Lint the code")]), busy: true });
  expect(opened()).toBe("‹ 3 of 3 ›");
  const tabs = row(/‹ 3 of 3 ›/) + 1;
  expect(screen()[tabs]).toMatch(/Output.+Command/);
  await click(screen()[tabs]!.indexOf("Command") + 1, tabs);
  expect(screen()[row(/‹ 3 of 3 ›/) + 1]).toContain("▐Command▌");
  await update({ ...turn([call("a"), done("b", "Build the app"), done("c", "Lint the code"), running("d", "Test the code")]), busy: true });
  expect(opened()).toBe("‹ 4 of 4 ›");
  // Claude's sentence: the cursor goes there, and what's open stays open, but follows no more.
  await click(10, row(/Looking around/));
  await update({ ...turn([call("a"), done("b", "Build the app"), done("c", "Lint the code"), done("d", "Test the code"), running("e", "Ship it")]), busy: true });
  expect(opened()).toBe("‹ 4 of 5 ›");
});

test("following Claude, a command that waits for your OK opens once it runs, so the line that asks sits right above its decision and the command shows once", async () => {
  const { press, update, screen, row } = await launch({ ...turn([call("a"), running("b", "Build the app")]), busy: true }, { columns: 80, rows: 24 });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  const asking = { ...turn([call("a"), running("b", "Build the app", { status: "done", result: "built" }), running("c", "Lint the code")]), busy: true };
  // The prompt comes a moment after the call starts, as Claude Code sends them.
  await update(asking);
  await update({ ...asking, pending: [{ id: "c", toolName: "Bash", input: { command: "make c" }, description: "Lint the code" }] });
  expect(row(/^▁+$/)).toBe(row(/^│.*Lint +the code/) + 1);
  expect(screen().filter((line) => line.includes("make c"))).toEqual([" $ make c"]);
  // Answered, it runs, and opens under its line on what it prints.
  await update(asking);
  expect(screen()[row(/Linting +the code/) + 2]).toContain("▐Output▌");
});

test("a click on the line that asks opens its call at once, though following Claude reached it and keeps it closed while it waits", async () => {
  const { press, update, click, screen, row } = await launch({ ...turn([call("a"), running("b", "Build the app")]), busy: true });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  const asking = { ...turn([call("a"), running("b", "Build the app", { status: "done", result: "built" }), running("c", "Lint the code")]), busy: true };
  await update(asking);
  await update({ ...asking, pending: [{ id: "c", toolName: "Bash", input: { command: "make c" }, description: "Lint the code" }] });
  expect(row(/‹ \d of \d ›/)).toBe(-1);
  await click(10, row(/^│.*Lint +the code/));
  expect(screen()[row(/^│.*Lint +the code/) + 1]).toContain("‹ 3 of 3 ›");
});

test("a line of several reads, the last of them running, opens on the one running, and follows Claude from there", async () => {
  const read = (id: string, file: string, more: Partial<ToolCall> = {}) => call(id, { name: "Read", input: { file_path: `/p/src/${file}` }, result: "1\tx", ...more });
  const { press, update, screen } = await launch({ ...turn([call("g"), read("r1", "a.ts"), read("r2", "b.ts", { status: "running", result: undefined })]), busy: true });
  const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(opened()).toBe("‹ 3 of 3 ›");
  await update({ ...turn([call("g"), read("r1", "a.ts"), read("r2", "b.ts"), running("c", "Lint the code")]), busy: true });
  expect(opened()).toBe("‹ 4 of 4 ›");
});

test("a line of edits to one file opens on the one that waits for your OK, and follows Claude from there", async () => {
  const edit = (id: string) => call(id, { name: "Edit", status: "running", input: { file_path: "/p/src/x.ts", old_string: `a${id}`, new_string: `b${id}` }, result: undefined });
  const edits = { ...turn([call("g"), edit("e1"), edit("e2"), edit("e3")]), busy: true };
  const { click, update, screen, row } = await launch({ ...edits, pending: [{ id: "e1", toolName: "Edit", input: edits.items[2]!.kind === "tool" ? edits.items[2]!.call.input : {} }] });
  const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
  await click(10, row(/Edit +src\/x\.ts/));
  expect(opened()).toBe("‹ 2 of 4 ›");
  await update({ ...turn([call("g"), edit("e1"), edit("e2"), edit("e3"), running("c", "Lint the code")]), busy: true });
  expect(opened()).toBe("‹ 5 of 5 ›");
});

test("a line of reads that finished out of order opens on the one still running", async () => {
  const read = (id: string, file: string, more: Partial<ToolCall> = {}) => call(id, { name: "Read", input: { file_path: `/p/src/${file}` }, result: "1\tx", ...more });
  const { press, screen } = await launch({ ...turn([call("g"), read("r1", "a.ts", { status: "running", result: undefined }), read("r2", "b.ts")]), busy: true });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(screen().find((line) => /‹ \d of \d ›/.test(line))).toContain("‹ 2 of 3 ›");
});

test("in scrollback's transcript viewer the call opened on the one Claude is on follows Claude, until ← or →", async () => {
  const { press, update, writes } = await launch({ ...turn([call("a"), running("b", "Build the app")]), busy: true }, { fullscreen: false });
  /** Where the opened call is, by the last frame it's in. */
  const place = () => stripVTControlCharacters(writes.join("")).match(/\d of \d(?= *›)/g)?.at(-1);
  const done = (id: string, description: string) => running(id, description, { status: "done", result: "ok" });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(place()).toBe("2 of 2");
  await update({ ...turn([call("a"), done("b", "Build the app"), running("c", "Lint the code")]), busy: true });
  expect(place()).toBe("3 of 3");
  await press(KEYS.left);
  expect(place()).toBe("2 of 3");
  await press(KEYS.right);
  await update({ ...turn([call("a"), done("b", "Build the app"), done("c", "Lint the code"), running("d", "Test the code")]), busy: true });
  expect(place()).toBe("3 of 4");
});

test("a finished call opened while Claude works stays open as Claude starts the next", async () => {
  const { press, update, screen, row } = await launch({ ...turn([call("a"), running("b", "Build the app")]), busy: true });
  await press(KEYS.ctrlO);
  await press(KEYS.up);
  await press(KEYS.enter);
  expect(screen()[row(/Searched +a in src/) + 1]).toContain("‹ 1 of 2 ›");
  await update({ ...turn([call("a"), running("b", "Build the app", { status: "done", result: "built" }), running("c", "Lint the code")]), busy: true });
  expect(screen()[row(/Searched +a in src/) + 1]).toContain("‹ 1 of 3 ›");
});

test("opening the running call's line at the end of the conversation keeps the view following the end", async () => {
  const before = long();
  const state: State = { ...before, busy: true, items: [...before.items, { kind: "tool", key: "z", call: call("z", { status: "running", result: undefined }) }], tools: { ...before.tools, z: before.items.length } };
  const { press, update, row, cursor } = await launch(state, { rows: 24 });
  await press(KEYS.ctrlO);
  expect(cursor()).toBe(row(/Searching +z in src/));
  await press(KEYS.enter);
  await update({ ...state, live: { messageId: "m", blocks: [{ kind: "text", text: "Nothing matched z." }], finalized: 0 } });
  expect(row(/Nothing matched z/)).not.toBe(-1);
  expect(row(/more lines?/)).toBe(-1);
});

test("scrolling away from the call followed stops following, so the view stays where you scrolled as Claude goes on", async () => {
  const before = long();
  const running = (id: string) => ({ kind: "tool" as const, key: id, call: call(id, { status: "running", result: undefined }) });
  const state: State = { ...before, busy: true, items: [...before.items, running("z")], tools: { ...before.tools, z: before.items.length } };
  const { press, update, screen, row, cursor } = await launch(state, { rows: 24 });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(screen()[row(/Searching +z in src/) + 1]).toContain("‹ 2 of 2 ›");
  for (let i = 0; i < 6; i++) await press("\x1b[<64;20;5M");
  const away = screen()[0];
  const done = { ...state.items.at(-1)!, call: call("z") };
  await update({ ...state, items: [...before.items, done, running("y")], tools: { ...state.tools, y: before.items.length + 1 } });
  expect(screen()[0]).toBe(away);
  expect(row(/Searching +y in src/)).toBe(-1);
  expect(cursor()).not.toBe(-1);
});

/** A turn closed by its ledger, then the next, with Claude at work in it on `calls`. */
function workingAfterLedger(calls: ToolCall[], cwd = "/p"): State {
  const before = ledgers(cwd);
  const items: Item[] = [...before.items.slice(0, 5), { kind: "prompt", key: "p2", text: "and again", starts: true }, { kind: "text", key: "t2", text: "Going again." }, ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one }))];
  return { ...before, items, busy: true, tools: { ...before.tools, ...Object.fromEntries(calls.map((one, i) => [one.id, 7 + i])) } };
}

for (const [name, keys, lands] of [
  ["[ to the ledger before", ["["], /6s · 2 files/],
  ["n to the next match", ["n"], /and again/],
  ["/ and Enter on a match", ["/", "and again", KEYS.enter], /and again/],
  ["/diff to the latest ledger", [KEYS.ctrlO, "/diff", KEYS.enter], /6s · 2 files/],
] as const) {
  test(`${name} moves the cursor, so following Claude stops there rather than pull the cursor to the next call`, async () => {
    const built = running("m", "Build the app", { status: "done", result: "built" });
    const { press, update, screen, row, cursor } = await launch(workingAfterLedger([running("m", "Build the app")]));
    const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
    await press(KEYS.ctrlO);
    // Something found already, for n to go on to.
    for (const key of ["/", "and again", KEYS.enter, "\x1b[F"]) await press(key);
    expect(cursor()).toBe(row(/Building +the app/));
    await press(KEYS.enter);
    expect(opened()).toBe("‹ 1 of 1 ›");
    for (const key of keys) await press(key);
    expect(cursor()).toBe(row(lands));
    await update(workingAfterLedger([built, running("n", "Lint the code")]));
    expect(cursor()).toBe(row(lands));
    expect(opened()).toBe("‹ 1 of 2 ›");
  });
}

test("Esc in the / bar puts the cursor back on the call followed, and following Claude goes on from it", async () => {
  const built = running("m", "Build the app", { status: "done", result: "built" });
  const { press, update, screen, row, cursor } = await launch(workingAfterLedger([running("m", "Build the app")]));
  const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  // The match moves the cursor, which stops following, until Esc puts the cursor back.
  for (const key of ["/", "and again"]) await press(key);
  await press(KEYS.esc);
  expect(cursor()).toBe(row(/Building +the app/));
  await update(workingAfterLedger([built, running("n", "Lint the code")]));
  expect(opened()).toBe("‹ 2 of 2 ›");
  expect(cursor()).toBe(row(/Linting +the code/));
});

test("a click on an opened ledger's scope moves the cursor, so following Claude stops there", async () => {
  // A git repository, so the ledger has scopes, whose files the session reads.
  const cwd = process.cwd();
  const changes = async () => ({ files: [{ path: `${cwd}/notes.md`, added: 2, removed: 0, status: "new" }], trees: { from: "h", to: "w" } });
  const built = running("m", "Build the app", { status: "done", result: "built" });
  const { press, update, click, screen, row, cursor } = await launch(workingAfterLedger([running("m", "Build the app")], cwd), { session: { changes } });
  const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
  await press(KEYS.ctrlO);
  await press("[");
  await press(KEYS.enter);
  await press("\x1b[F");
  await press(KEYS.enter);
  expect(opened()).toBe("‹ 1 of 1 ›");
  const scopes = row(/▐this turn▌/);
  await click(screen()[scopes]!.indexOf("uncommitted") + 1, scopes);
  expect(screen()[cursor()]).toContain("▐uncommitted▌");
  await update(workingAfterLedger([built, running("n", "Lint the code")], cwd));
  expect(screen()[cursor()]).toContain("▐uncommitted▌");
  expect(opened()).toBe("‹ 1 of 2 ›");
});

test("full screen opens on the start screen, which names Ctrl+O by the transcript it gives your keys to", async () => {
  const { screen } = await launch(initialState("/p", "/home/u"));
  expect(screen().join("\n")).toContain("ctrl+o transcript");
  expect(screen().join("\n")).not.toContain("tool output");
});

test("Ctrl+O gives the transcript your keys, with its cursor on the last line in view, and Esc gives them back", async () => {
  const { press, cursor, boxKeys, row } = await launch(THREE);
  expect(boxKeys()).toBe(true);
  expect(cursor()).toBe(-1);
  await press(KEYS.ctrlO);
  expect(boxKeys()).toBe(false);
  expect(cursor()).toBe(row(/Searched +c in src/));
  expect(row(/esc back to the box/)).toBeGreaterThan(cursor());
  await press(KEYS.esc);
  expect(boxKeys()).toBe(true);
  expect(cursor()).toBe(-1);
  // Ctrl+O again goes there and back.
  await press(KEYS.ctrlO);
  expect(cursor()).not.toBe(-1);
  await press(KEYS.ctrlO);
  expect(boxKeys()).toBe(true);
});

test("↑ and ↓ move the cursor over lines, and Enter opens a call under its line and closes it", async () => {
  const { press, cursor, row, screen } = await launch(THREE);
  await press(KEYS.ctrlO);
  await press(KEYS.up);
  const at = row(/Ran +the tests/);
  expect(cursor()).toBe(at);
  await press(KEYS.up);
  expect(cursor()).toBe(row(/Searched +a in src/));
  // Blank rows are passed over: the step's title is next.
  await press(KEYS.up);
  expect(cursor()).toBe(row(/Looking around/));
  await press(KEYS.down);
  await press(KEYS.down);
  await press(KEYS.enter);
  // A conversation shorter than the screen sits on the box, so what opens pushes its lines up.
  const open = row(/Ran +the tests/);
  expect(screen()[open + 1]).toContain("‹ 2 of 3 ›");
  expect(cursor()).toBe(open);
  // The cursor moves into what opened, as into any lines; Enter there closes it, back on its line.
  await press(KEYS.down);
  expect(cursor()).toBe(open + 1);
  await press(KEYS.enter);
  expect(screen().some((line) => line.includes("‹ 2 of 3 ›"))).toBe(false);
  expect(cursor()).toBe(row(/Ran +the tests/));
});

test("in an opened call ← and → open the call before or after, Tab its next tab, and Esc closes it before leaving", async () => {
  const { press, cursor, row, screen, boxKeys } = await launch(THREE);
  await press(KEYS.ctrlO);
  await press(KEYS.up);
  await press(KEYS.enter);
  await press(KEYS.right);
  expect(screen().some((line) => line.includes("‹ 2 of 3 ›"))).toBe(false);
  expect(screen()[row(/Searched +c in src/) + 1]).toContain("‹ 3 of 3 ›");
  expect(cursor()).toBe(row(/Searched +c in src/));
  await press(KEYS.left);
  expect(screen()[row(/Ran +the tests/) + 1]).toContain("‹ 2 of 3 ›");
  expect(screen()[row(/Ran +the tests/) + 2]).toContain("▐Output▌");
  await press(KEYS.tab);
  expect(screen()[row(/Ran +the tests/) + 2]).toContain("▐Command▌");
  expect(screen()[row(/Ran +the tests/) + 3]).toContain("$ bun test");
  await press(KEYS.esc);
  expect(screen().some((line) => line.includes("‹ 2 of 3 ›"))).toBe(false);
  expect(cursor()).toBe(row(/Ran +the tests/));
  expect(boxKeys()).toBe(false);
  await press(KEYS.esc);
  expect(boxKeys()).toBe(true);
});

test("a click on a line puts the cursor there with your keys, and a click on the box takes them back", async () => {
  const { click, cursor, row, screen, boxKeys } = await launch(THREE);
  await click(30, row(/Looking around/));
  expect(cursor()).toBe(row(/Looking around/));
  expect(boxKeys()).toBe(false);
  // A click on a call's line is Enter there.
  await click(10, row(/Searched +a in src/));
  const at = row(/Searched +a in src/);
  expect(cursor()).toBe(at);
  expect(screen()[at + 1]).toContain("‹ 1 of 3 ›");
  await click(4, row(/^ ❯/));
  expect(boxKeys()).toBe(true);
  expect(cursor()).toBe(-1);
});

test("exactly one place has your keys: a decision takes them from the transcript, and gives them back once answered", async () => {
  const { press, cursor, boxKeys, update, row } = await launch(THREE);
  await press(KEYS.ctrlO);
  expect([boxKeys(), cursor() !== -1]).toEqual([false, true]);
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  expect(row(/rm -rf build/)).not.toBe(-1);
  expect([boxKeys(), cursor() !== -1]).toEqual([false, false]);
  await update(THREE);
  expect([boxKeys(), cursor() !== -1]).toEqual([false, true]);
  await press(KEYS.esc);
  expect([boxKeys(), cursor() !== -1]).toEqual([true, false]);
});

test("a decision stands in the box's place, right under the line that asks, and says once that Claude waits", async () => {
  const command = { command: "rm -rf build", description: "Clean the build" };
  const asking = turn([call("a"), call("b", { name: "Bash", input: command, status: "running" })]);
  const { screen, row, press, update } = await launch({ ...asking, busy: true }, { columns: 120, rows: 30 });
  await press("half a thought");
  await update({ ...asking, busy: true, pending: [{ id: "b", toolName: "Bash", input: command, description: command.description }] });
  expect(screen().join("\n").match(/waiting/gi)).toEqual(["waiting"]);
  // No line over the box saying what Claude does, and no box: the decision is in its place.
  expect(row(/Waiting for your OK|esc to stop/)).toBe(-1);
  expect(row(/❯|half a thought/)).toBe(-1);
  expect(row(/^▁+$/)).toBe(row(/Clean\s+the build/) + 1);
  // The command shows once in the decision, with Claude's description under it.
  expect(screen().filter((line) => line.includes("rm -rf build"))).toEqual([" $ rm -rf build"]);
  await update({ ...asking, busy: true });
  expect(row(/❯ half a thought/)).not.toBe(-1);
});

test("with the call that waits open in the transcript, \"waiting\" is still said once, in the decision", async () => {
  const command = { command: "rm -rf build", description: "Clean the build" };
  const asking = turn([call("a"), call("b", { name: "Bash", input: command, status: "running" })]);
  const { screen, press, update, row } = await launch({ ...asking, busy: true }, { columns: 120, rows: 40 });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(row(/‹ 2 of 2 ›/)).not.toBe(-1);
  await update({ ...asking, busy: true, pending: [{ id: "b", toolName: "Bash", input: command, description: command.description }] });
  expect(row(/‹ 2 of 2 ›/)).not.toBe(-1);
  expect(screen().join("\n").match(/waiting/gi)).toEqual(["waiting"]);
});

test("Claude's question and an MCP server's form say once, on their title row, how long Claude has waited", async () => {
  const question = { id: "q", questions: [{ question: "Which cache?", header: "Cache", multiSelect: false, options: [{ label: "LRU", description: "least recently used" }, { label: "TTL", description: "time based" }] }] };
  const form = { id: "e", server: "hello", message: "Your name?", mode: "form" as const, fields: [{ name: "name", label: "Name", type: "string" as const, required: true }] };
  const asking = turn([call("a"), call("q", { name: "AskUserQuestion", input: {}, status: "running" })]);
  const cases: [Partial<State>, RegExp][] = [
    [{ questions: [question] }, /Which cache\?/],
    [{ elicitations: [form] }, /hello asks for some details/],
  ];
  for (const [waiting, title] of cases) {
    const { screen, row } = await launch({ ...asking, busy: true, ...waiting }, { columns: 120, rows: 30 });
    expect(screen().join("\n").match(/waiting/gi)).toEqual(["waiting"]);
    expect(row(/waiting \d+s/)).toBe(row(title));
    quit?.();
  }
});

test("a decision opening brings the end back into view, so the line that asks sits right above it", async () => {
  const command = { command: "rm -rf build", description: "Clean the build" };
  const asking = turn([call("a"), call("b", { name: "Bash", input: command, status: "running" })]);
  const earlier: Item[] = Array.from({ length: 20 }, (_, i) => ({ kind: "prompt", key: `old${i}`, text: `an earlier message, number ${i}` }));
  const long = { ...asking, busy: true, items: [...earlier, ...asking.items], tools: { a: 22, b: 23 } };
  const { row, press, update } = await launch(long, { columns: 100, rows: 24 });
  await press(KEYS.ctrlO);
  await press("\x1b[H");
  // The call's own line, not the line over the box that names it while it runs.
  const asks = /^│\s+Clean\s+the build/;
  expect(row(asks)).toBe(-1);
  await update({ ...long, pending: [{ id: "b", toolName: "Bash", input: command, description: command.description }] });
  expect(row(/^▁+$/)).toBe(row(asks) + 1);
});

test("at 80×24 a long diff or plan is cut short, so the line that asks stays in view above the decision", async () => {
  const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const edit = { file_path: "/p/src/cache.ts", old_string: "a", new_string: long };
  const plan = { plan: long, planFilePath: "/home/u/.claude/plans/a-plan.md" };
  for (const [name, input, asks] of [
    ["Edit", edit, /Edit\s+src\/cache\.ts/],
    ["ExitPlanMode", plan, /ExitPlanMode/],
  ] as const) {
    const asking = turn([call("a"), call("x", { name, input, status: "running" })]);
    const { screen, row } = await launch({ ...asking, busy: true, pending: [{ id: "x", toolName: name, input }] }, { columns: 80, rows: 24 });
    const edge = row(/^▁+$/);
    expect(edge).toBeGreaterThan(0);
    expect(screen().slice(0, edge).some((line) => asks.test(line))).toBe(true);
    expect(screen().join("\n").match(/waiting/gi)).toEqual(["waiting"]);
    expect(screen().some((line) => /more lines/.test(line))).toBe(true);
    quit?.();
  }
});

test("at 80×24 a decision's long lines count as the rows they wrap to, so the whole panel fits under the line that asks", async () => {
  const wide = Array.from({ length: 40 }, (_, i) => `  const value${i} = compute(${i}); // a fairly long line of code that wraps at eighty columns`).join("\n");
  const edit = { file_path: "/p/src/cache.ts", old_string: "a", new_string: wide };
  const write = { file_path: "/p/src/wide.ts", content: wide };
  const bash = { command: wide.replaceAll("const", "echo"), description: "Echo the values" };
  for (const [name, input, asks] of [
    ["Edit", edit, /Edit\s+src\/cache\.ts/],
    ["Write", write, /Write\s+src\/wide\.ts/],
    ["Bash", bash, /Echo\s+the values/],
  ] as const) {
    const asking = turn([call("a"), call("x", { name, input, status: "running" })]);
    const pending = [{ id: "x", toolName: name, input, description: "description" in input ? input.description : undefined, alwaysAllow: [{ type: "setMode" as const, mode: "acceptEdits" as const, destination: "session" as const }] }];
    const { screen, row } = await launch({ ...asking, busy: true, pending }, { columns: 80, rows: 24 });
    const edge = row(/^▁+$/);
    expect(screen().slice(0, edge).some((line) => asks.test(line))).toBe(true);
    expect(screen().length).toBeLessThanOrEqual(24);
    expect(row(/ \d {2}No\b/)).toBeGreaterThan(edge);
    expect(row(/Esc to cancel/)).toBeGreaterThan(edge);
    // The status bar is the last row, under the decision.
    expect(screen().at(-1)).toMatch(/ask first|auto|default/i);
    quit?.();
  }
});

test("the view follows the cursor past the screen's edge", async () => {
  const items: Item[] = Array.from({ length: 15 }, (_, i): Item[] => [
    { kind: "prompt", key: `p${i}`, text: `message ${i}` },
    { kind: "tool", key: `c${i}`, call: call(`c${i}`) },
  ]).flat();
  const state: State = { ...initialState("/p", "/home/u"), items, tools: Object.fromEntries(items.flatMap((item, i) => (item.kind === "tool" ? [[item.call.id, i]] : []))) };
  const { press, cursor, row } = await launch(state, { rows: 24 });
  expect(row(/message 0\b/)).toBe(-1);
  await press(KEYS.ctrlO);
  expect(cursor()).toBe(row(/Searched +c14 in src/));
  // Past the first line it stays there.
  await press(KEYS.up.repeat(60));
  expect(cursor()).not.toBe(-1);
  expect(cursor()).toBe(row(/message 0\b/));
  expect(row(/c14/)).toBe(-1);
  await press(KEYS.down.repeat(60));
  expect(cursor()).toBe(row(/Searched +c14 in src/));
});

test("Enter on ⋯ shows the whole tab and keeps the cursor in view, even at the end of the conversation", async () => {
  const result = Array.from({ length: 60 }, (_, i) => `match ${i + 1}`).join("\n");
  const { press, cursor, row } = await launch(turn([call("a", { result })]), { rows: 30 });
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(row(/⋯ 40 lines/)).not.toBe(-1);
  await press(KEYS.down.repeat(15));
  expect(cursor()).toBe(row(/⋯ 40 lines/));
  await press(KEYS.enter);
  expect(row(/⋯/)).toBe(-1);
  expect(cursor()).not.toBe(-1);
  expect(cursor()).toBe(row(/ 13 +match 13\b/));
});

test("Ctrl+O with no line to put the cursor on leaves your keys in the box", async () => {
  const { press, boxKeys, cursor } = await launch(initialState("/p", "/home/u"));
  await press(KEYS.ctrlO);
  expect(boxKeys()).toBe(true);
  expect(cursor()).toBe(-1);
});

test("the cursor stays in sight when the reply it's on finishes streaming", async () => {
  const text = "All three searches came back empty.";
  const streaming: State = { ...THREE, busy: true, live: { messageId: "m", blocks: [{ kind: "text", text }], finalized: 0 } };
  const { press, cursor, update, row, boxKeys } = await launch(streaming);
  await press(KEYS.ctrlO);
  expect(cursor()).toBe(row(/All three searches/));
  await update({ ...THREE, items: [...THREE.items, { kind: "text", key: "r", text }] });
  expect(boxKeys()).toBe(false);
  expect(cursor()).not.toBe(-1);
});

test("keys that work anywhere still work while the transcript has your keys", async () => {
  const reply: State = { ...THREE, busy: true, items: [...THREE.items, { kind: "text", key: "r", text: "All three searches came back empty." }] };
  const { press, click, row, screen, boxKeys, asked } = await launch(reply);
  // A click on Claude's reply, to read it, gives the transcript your keys; Ctrl+C there still stops Claude.
  const y = row(/All three searches/);
  await click(screen()[y]!.indexOf("three") + 1, y);
  expect(boxKeys()).toBe(false);
  await press(KEYS.ctrlC);
  expect(asked).toContain("interrupt");
  // Shift+Tab is the next permission mode, as in the box.
  await press(KEYS.ctrlO);
  await press(KEYS.ctrlO);
  expect(boxKeys()).toBe(false);
  await press(KEYS.shiftTab);
  expect(asked).toContain("setMode");
  // The mode it picked is saved in the test's scratch folder.
  await saved();
  expect(JSON.parse(readFileSync(join(config.folder(), "astrocode", "settings.json"), "utf8"))).toEqual({ mode: "acceptEdits" });
  // And the transcript keeps your keys through them.
  expect(boxKeys()).toBe(false);
});

test("in an opened call Shift+Tab leaves the tab alone, and Ctrl+C doesn't copy it", async () => {
  const { press, row, screen, asked } = await launch(THREE);
  await press(KEYS.ctrlO);
  await press(KEYS.up);
  await press(KEYS.enter);
  expect(screen()[row(/Ran +the tests/) + 2]).toContain("▐Output▌");
  await press(KEYS.shiftTab);
  expect(screen()[row(/Ran +the tests/) + 2]).toContain("▐Output▌");
  expect(asked).toContain("setMode");
  await press(KEYS.ctrlC);
  expect(screen().some((line) => line.includes("Copied"))).toBe(false);
});

/** Fifteen messages, each with a call: longer than a screen of 24 rows. */
function long(): State {
  const items: Item[] = Array.from({ length: 15 }, (_, i): Item[] => [
    { kind: "prompt", key: `p${i}`, text: `message ${i}` },
    { kind: "tool", key: `c${i}`, call: call(`c${i}`) },
  ]).flat();
  return { ...initialState("/p", "/home/u"), items, tools: Object.fromEntries(items.flatMap((item, i) => (item.kind === "tool" ? [[item.call.id, i]] : []))) };
}

test("the transcript taking your keys moves nothing on screen, and its cursor shows even after scrolling up", async () => {
  const { press, cursor, screen, row } = await launch(long(), { rows: 24 });
  await press("\x1b[5~");
  const before = screen();
  await press(KEYS.ctrlO);
  // The box and every line stay where they were, and the cursor is on the last line in view.
  expect(row(/^ ❯/)).toBe(before.findIndex((line) => line.startsWith(" ❯")));
  const box = row(/^ ❯/) - 1;
  const plain = (lines: string[]) => lines.slice(0, box).map((line) => line.replace("›", " ").trimEnd());
  expect(plain(screen())).toEqual(plain(before));
  expect(cursor()).not.toBe(-1);
  const at = cursor();
  await press(KEYS.up);
  expect(cursor()).toBeLessThan(at);
});

test("a click on a line while the view follows the end leaves the line where it was clicked", async () => {
  const { click, cursor, row } = await launch(long(), { rows: 24 });
  const y = row(/message 13\b/);
  await click(20, y);
  expect(row(/message 13\b/)).toBe(y);
  expect(cursor()).toBe(y);
});

test("Enter on a line of several calls closes the one of them that's open", async () => {
  const read = (id: string, file: string) => call(id, { name: "Read", input: { file_path: `/p/src/${file}` }, result: "1\tx" });
  const { press, screen } = await launch(turn([call("g"), read("r1", "a.ts"), read("r2", "b.ts"), read("r3", "c.ts")]));
  const opened = () => screen().find((line) => /‹ \d of \d ›/.test(line))?.match(/‹ \d of \d ›/)?.[0];
  await press(KEYS.ctrlO);
  await press(KEYS.enter);
  expect(opened()).toBe("‹ 2 of 4 ›");
  await press(KEYS.right);
  expect(opened()).toBe("‹ 3 of 4 ›");
  await press(KEYS.enter);
  expect(opened()).toBeUndefined();
});

/** A file's line in an opened ledger, from column 4 with the cursor's `›` before it or not, and the scrollbar after it or not. */
const fileLine = (name: string, result: string) => new RegExp(`^ {3}.${name.replace(/[./]/g, "\\$&")} +${result.replace(/[+]/g, "\\$&")} ?.?$`);

/** A turn that edited a file and ran the tests, closed by its ledger, then a second turn after it. */
function ledgers(cwd = "/p"): State {
  const patch = [{ oldStart: 3, oldLines: 3, newStart: 3, newLines: 3, lines: [" const a = 1;", "-  if (Date.now() > entry.expires) {", "+  if (this.clock.now() > entry.expires) {", " }"] }];
  return {
    ...initialState(cwd, "/home/u"),
    items: [
      { kind: "prompt", key: "p", text: "fix it", starts: true },
      { kind: "tool", key: "e", call: call("e", { name: "Edit", input: { file_path: `${cwd}/src/a.ts`, old_string: "a", new_string: "b" }, output: { structuredPatch: patch } }) },
      { kind: "tool", key: "b", call: call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, status: "error", result: "Exit code 1\n 7 pass\n 1 fail\nRan 8 tests across 1 file." }) },
      { kind: "text", key: "t", text: "Fixed." },
      { kind: "turn", key: "end", outcome: "finished", durationMs: 6000, tokens: 1200, files: [{ path: `${cwd}/src/a.ts`, added: 1, removed: 1 }, { path: `${cwd}/src/b.ts`, added: 4, removed: 0, status: "new" }], commands: ["bun test"] },
      { kind: "prompt", key: "p2", text: "and again", starts: true },
      { kind: "text", key: "t2", text: "Done again." },
      { kind: "turn", key: "end2", outcome: "finished", durationMs: 9000, tokens: 300 },
    ],
    tools: { e: 1, b: 2 },
  };
}

test("Enter on a turn's closing line opens its ledger, Enter on a file its diff, and Esc closes the diff, then the ledger", async () => {
  // Under 146 columns, so the diff is unified.
  const { press, cursor, row, screen, boxKeys } = await launch(ledgers(), { columns: 120 });
  await press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await press(KEYS.up);
  expect(cursor()).toBe(row(/6s · 2 files \+5 −1/));
  await press(KEYS.enter);
  expect(row(fileLine("src/a.ts", "+1 −1"))).toBe(cursor() + 1);
  expect(row(fileLine("src/b.ts", "new +4"))).toBe(cursor() + 2);
  expect(row(/^ {4}bun test +✕ exit 1 · 7 passed, 1 failed$/)).toBe(cursor() + 3);
  expect(row(/^ {4}1\.2k tokens/)).toBe(cursor() + 4);
  await press(KEYS.down);
  await press(KEYS.enter);
  // The file's diff, from the turn's edit, under its line.
  const file = row(fileLine("src/a.ts", "+1 −1"));
  expect(cursor()).toBe(file);
  expect(screen()[file + 1]).toMatch(/^ {4}\s*⋯ 2 lines/);
  expect(screen()[file + 3]).toMatch(/^ {4}4  - +if \(Date\.now\(\)/);
  expect(screen()[file + 4]).toMatch(/^ {4}4  \+ +if \(this\.clock\.now\(\)/);
  // Esc closes what the cursor's in: the diff, back to its file, then the ledger, back to its line.
  for (let i = 0; i < 3; i++) await press(KEYS.down);
  await press(KEYS.esc);
  expect(screen().some((line) => line.includes("this.clock.now()"))).toBe(false);
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  await press(KEYS.esc);
  expect(row(fileLine("src/a.ts", "+1 −1"))).toBe(-1);
  expect(cursor()).toBe(row(/6s · 2 files \+5 −1/));
  await press(KEYS.esc);
  expect(boxKeys()).toBe(true);
});

test("Esc on a file's line closes its diff, not the ledger, and on a file with no diff open closes the ledger", async () => {
  const { press, cursor, row, screen } = await launch(ledgers(), { columns: 120 });
  const shown = (text: string) => screen().some((line) => line.includes(text));
  await press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await press(KEYS.up);
  await press(KEYS.enter);
  await press(KEYS.down);
  await press(KEYS.enter);
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  expect(shown("this.clock.now()")).toBe(true);
  await press(KEYS.esc);
  expect(shown("this.clock.now()")).toBe(false);
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  expect(row(fileLine("src/b.ts", "new +4"))).toBeGreaterThan(-1);
  // With every diff open, Esc on a file closes that file's alone.
  await press("a");
  await press(KEYS.right);
  expect(cursor()).toBe(row(fileLine("src/b.ts", "new +4")));
  await press(KEYS.esc);
  expect(shown("Its diff wasn't kept.")).toBe(false);
  expect(shown("this.clock.now()")).toBe(true);
  expect(cursor()).toBe(row(fileLine("src/b.ts", "new +4")));
  await press(KEYS.esc);
  expect(row(fileLine("src/b.ts", "new +4"))).toBe(-1);
  expect(cursor()).toBe(row(/6s · 2 files \+5 −1/));
});

test("in an opened ledger ← and → move between its files, a opens every file's diff, and a again closes them", async () => {
  const { press, cursor, row, screen } = await launch(ledgers());
  await press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await press(KEYS.up);
  await press(KEYS.enter);
  await press(KEYS.right);
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  await press(KEYS.right);
  expect(cursor()).toBe(row(fileLine("src/b.ts", "new +4")));
  await press(KEYS.right);
  expect(cursor()).toBe(row(fileLine("src/b.ts", "new +4")));
  await press(KEYS.left);
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  await press("a");
  expect(screen().some((line) => line.includes("this.clock.now()"))).toBe(true);
  // b.ts came from no edit, and git kept no trees for it. The view follows the cursor down to it.
  await press(KEYS.right);
  expect(screen()[cursor()]).toMatch(/^ {3}›src\/b\.ts/);
  await press(KEYS.down);
  expect(screen()[cursor()]).toContain("Its diff wasn't kept.");
  await press("a");
  expect(screen().some((line) => line.includes("this.clock.now()") || line.includes("wasn't kept"))).toBe(false);
});

test("[ and ] move the cursor between ledgers, and in an opened one switch it to what isn't committed and to the branch", async () => {
  // A git repository, so the ledger has scopes, whose files the session reads.
  const cwd = process.cwd();
  const changes = async (scope: unknown) =>
    scope === "uncommitted" ? { files: [{ path: `${cwd}/notes.md`, added: 2, removed: 0, status: "new" }], trees: { from: "h", to: "w" } } : { files: [{ path: `${cwd}/src/c.ts`, added: 1, removed: 1 }], trees: { from: "m", to: "w" }, base: "main" };
  const { press, cursor, row, screen } = await launch(ledgers(cwd), { session: { changes } });
  await press(KEYS.ctrlO);
  expect(cursor()).toBe(row(/^╰.─ 9s/));
  await press("[");
  expect(cursor()).toBe(row(/6s · 2 files/));
  await press("]");
  expect(cursor()).toBe(row(/^╰.─ 9s/));
  await press("[");
  await press(KEYS.enter);
  expect(screen()[cursor() + 1]).toContain("▐this turn▌");
  // The cursor goes to the scopes, which stay put as what's under them changes.
  await press("]");
  expect(screen()[cursor()]).toContain("▐uncommitted▌");
  expect(row(fileLine("notes.md", "new +2"))).toBe(cursor() + 1);
  expect(row(/bun test/)).toBe(-1);
  await press("]");
  expect(screen()[cursor()]).toMatch(/▐branch▌ +vs main/);
  expect(row(fileLine("src/c.ts", "+1 −1"))).toBe(cursor() + 1);
  await press("]");
  expect(screen()[cursor()]).toContain("▐this turn▌");
  expect(row(/bun test/)).toBeGreaterThan(cursor());
  await press("[");
  expect(screen()[cursor()]).toMatch(/▐branch▌/);
});

test("a ledger showing what isn't committed reads it again once another turn ends, since the working tree moved on", async () => {
  const cwd = process.cwd();
  let reads = 0;
  const changes = async () => {
    reads += 1;
    return { files: [{ path: `${cwd}/read-${reads}.md`, added: reads, removed: 0, status: "new" }], trees: { from: "h", to: `w${reads}` } };
  };
  const state = ledgers(cwd);
  const { press, row, update } = await launch(state, { session: { changes } });
  await press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await press(KEYS.up);
  await press(KEYS.enter);
  await press("]");
  expect(row(fileLine("read-1.md", "new +1"))).toBeGreaterThan(-1);
  await update({ ...state, items: [...state.items, { kind: "prompt", key: "p3", text: "once more", starts: true }, { kind: "turn", key: "end3", outcome: "finished", durationMs: 2000, tokens: 10 }] });
  await settle();
  expect(row(fileLine("read-1.md", "new +1"))).toBe(-1);
  expect(row(fileLine("read-2.md", "new +2"))).toBeGreaterThan(-1);
});

test("/diff opens the latest turn's ledger with the cursor on it, and the keys a ledger takes never reach the box", async () => {
  const { press, cursor, row, boxKeys, screen } = await launch(ledgers());
  const box = () => screen().find((line) => line.startsWith(" ❯")) ?? "";
  await press("/diff");
  await press(KEYS.enter);
  expect(boxKeys()).toBe(false);
  const line = row(/^╰.─ 9s/);
  expect(cursor()).toBe(line);
  expect(row(/^ {4}300 tokens/)).toBe(line + 1);
  // The hint in the box's edge names the ledger's keys. Outside git there's no scope to switch, so
  // [ and ] go to the ledger before or after.
  expect(row(/a open all {3}\[ \] ledgers/)).toBeGreaterThan(line);
  await press("[");
  expect(cursor()).toBe(row(/6s · 2 files/));
  for (const key of ["]", "a", KEYS.right, KEYS.left]) await press(key);
  expect(box().trim()).toBe("❯");
  expect(cursor()).toBe(line);
  // The hint follows the cursor: out of the ledger, it's the transcript's own again.
  await press(KEYS.up);
  expect(row(/\{ \} messages/)).toBeGreaterThan(line);
  expect(row(/a open all/)).toBe(-1);
});

test("? with the cursor in an opened ledger lists the ledger's keys first, and Esc leaves the ledger open with your keys in it", async () => {
  const { press, cursor, row, screen } = await launch(ledgers());
  await press("/diff");
  await press(KEYS.enter);
  await press("?");
  expect(sheetFirst(screen())).toBe("In an opened ledger");
  expect(screen().join("\n")).toMatch(/a +every diff, or none/);
  await press(KEYS.esc);
  expect(sheetFirst(screen())).toBeUndefined();
  expect(cursor()).toBe(row(/^╰.─ 9s/));
  expect(row(/^ {4}300 tokens/)).toBe(cursor() + 1);
});

test("a click on a ledger's file opens its diff, and one on a scope's tab switches to it, as Enter and ] do", async () => {
  const cwd = process.cwd();
  const changes = async () => ({ files: [{ path: `${cwd}/notes.md`, added: 2, removed: 0, status: "new" }], trees: { from: "h", to: "w" } });
  const { press, click, cursor, row, screen } = await launch(ledgers(cwd), { columns: 120, session: { changes } });
  await click(10, row(/6s · 2 files/));
  await click(10, row(fileLine("src/a.ts", "+1 −1")));
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  expect(screen().some((line) => line.includes("this.clock.now()"))).toBe(true);
  const tabs = row(/this turn.*uncommitted.*branch/);
  await click([...screen()[tabs]!].join("").indexOf("uncommitted") + 2, tabs);
  expect(row(fileLine("notes.md", "new +2"))).toBe(row(/▐uncommitted▌/) + 1);
  await press(KEYS.esc);
  expect(row(fileLine("notes.md", "new +2"))).toBe(-1);
});

test("[ and ] deep in an opened ledger bring its scopes back into view, with the cursor on them", async () => {
  const cwd = process.cwd();
  const state = ledgers(cwd);
  const big = Array.from({ length: 40 }, (_, i) => `+line ${i + 1}`);
  const items = state.items.map((item) =>
    item.kind === "tool" && item.call.name === "Edit" ? { ...item, call: { ...item.call, output: { structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 40, lines: big }] } } } : item,
  );
  // What isn't committed has the same file, whose diff stays open as long.
  const changes = async () => ({ files: [{ path: `${cwd}/src/a.ts`, added: 40, removed: 0 }], trees: { from: "h", to: "w" } });
  const patch = async () => `@@ -0,0 +1,40 @@\n${big.join("\n")}\n`;
  const { press, cursor, row, screen } = await launch({ ...state, items }, { columns: 120, rows: 24, session: { changes, patch } });
  await press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await press(KEYS.up);
  await press(KEYS.enter);
  await press(KEYS.down);
  await press(KEYS.down);
  await press(KEYS.enter);
  for (let i = 0; i < 22; i++) await press(KEYS.down);
  expect(screen()[cursor()]).toMatch(/src\/b\.ts/);
  expect(row(/this turn.*uncommitted/)).toBe(-1);
  await press("]");
  expect(screen()[cursor()]).toContain("▐uncommitted▌");
}, 15_000);

test("Esc on a long diff's ⋯ line closes the diff, where Enter on it shows the rest", async () => {
  const state = ledgers();
  const big = Array.from({ length: 40 }, (_, i) => `+line ${i + 1}`);
  const items = state.items.map((item) =>
    item.kind === "tool" && item.call.name === "Edit" ? { ...item, call: { ...item.call, output: { structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 40, lines: big }] } } } : item,
  );
  const { press, cursor, row, screen } = await launch({ ...state, items }, { columns: 120 });
  await press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await press(KEYS.up);
  await press(KEYS.enter);
  await press(KEYS.down);
  await press(KEYS.enter);
  // The file's first 12 lines, then the line that stands for the 20 between, which the cursor stops on.
  const fold = async () => {
    for (let i = 0; i < 13; i++) await press(KEYS.down);
    expect(screen()[cursor()]).toContain("⋯ 20 more lines");
  };
  await fold();
  expect(screen().some((line) => /\+ line 13$/.test(line.trimEnd()))).toBe(false);
  await press(KEYS.esc);
  expect(screen().some((line) => line.includes("+ line"))).toBe(false);
  expect(cursor()).toBe(row(fileLine("src/a.ts", "+1 −1")));
  await press(KEYS.enter);
  await fold();
  await press(KEYS.enter);
  expect(row(/⋯ \d+ more lines/)).toBe(-1);
  expect(screen().some((line) => /13  \+ line 13/.test(line))).toBe(true);
}, 15_000);

test("PgUp and PgDn move the cursor half a screen, Home and End to the top and the end, which the view follows again", async () => {
  const { press, cursor, row, screen } = await launch(long(), { rows: 24 });
  await press(KEYS.ctrlO);
  const end = cursor();
  expect(end).toBe(row(/Searched +c14 in src/));
  await press("\x1b[5~");
  const up = cursor();
  expect(up).not.toBe(-1);
  // The view went up with it, so it's still half a screen up from the end.
  expect(row(/Searched +c14 in src/)).toBe(-1);
  await press("\x1b[6~");
  expect(cursor()).toBe(row(/Searched +c14 in src/));
  await press("\x1b[H");
  expect(cursor()).toBe(row(/message 0\b/));
  await press("\x1b[F");
  expect(cursor()).toBe(row(/Searched +c14 in src/));
  expect(screen().some((line) => /more lines/.test(line))).toBe(false);
});

test("{ and }, Alt+↑ and Alt+↓ move the cursor to your message before or after, and Alt+Shift to a call", async () => {
  const { press, cursor, row } = await launch(long(), { rows: 24 });
  await press(KEYS.ctrlO);
  await press("{");
  expect(cursor()).toBe(row(/message 14\b/));
  await press("{");
  expect(cursor()).toBe(row(/message 13\b/));
  await press("}");
  expect(cursor()).toBe(row(/message 14\b/));
  await press("\x1b\x1b[A");
  expect(cursor()).toBe(row(/message 13\b/));
  await press("\x1b\x1b[B");
  expect(cursor()).toBe(row(/message 14\b/));
  await press("\x1b[1;4A");
  expect(cursor()).toBe(row(/Searched +c13 in src/));
});

/** The find bar's row, or -1: what it finds, then how many matches or none, or its placeholder. */
const findBar = (row: (text: RegExp) => number) => row(/Find .*(in the conversation|\d of \d|no matches)/);

test("/ in the transcript finds as claude's viewer does: Enter keeps the match, with the cursor on it, and n and N go on to the next and previous line that has it, round past the ends", async () => {
  const { press, cursor, row, boxKeys } = await launch(THREE);
  await press(KEYS.ctrlO);
  await press(KEYS.up);
  await press(KEYS.up);
  expect(cursor()).toBe(row(/Searched +a in src/));
  await press("/");
  expect(row(/Find +in the conversation/)).not.toBe(-1);
  await press("Searched");
  // The bar starts on the newest match, and the cursor goes with it.
  expect(row(/2 of 2/)).not.toBe(-1);
  // Enter accepts: the bar closes, and the transcript has your keys again, its cursor on the match.
  await press(KEYS.enter);
  expect(findBar(row)).toBe(-1);
  expect(boxKeys()).toBe(false);
  expect(cursor()).toBe(row(/Searched +c in src/));
  // n goes down, and from the last match round to the first; N goes up, and round the other way.
  await press("n");
  expect(cursor()).toBe(row(/Searched +a in src/));
  await press("n");
  expect(cursor()).toBe(row(/Searched +c in src/));
  await press("N");
  expect(cursor()).toBe(row(/Searched +a in src/));
  await press("N");
  expect(cursor()).toBe(row(/Searched +c in src/));
  // The next / starts empty, so what's typed is a new search.
  await press("/");
  expect(row(/Find +in the conversation/)).not.toBe(-1);
});

test("Esc in the / bar puts the cursor and the view back where they were, and n and N keep to what was found before", async () => {
  // Enough of a conversation that its start is out of view from its end.
  const long: State = { ...THREE, items: [...THREE.items, ...Array.from({ length: 40 }, (_, i): Item => ({ kind: "text", key: `f${i}`, text: `Filler ${i}.` }))] };
  const { press, cursor, row } = await launch(long, { rows: 24 });
  await press(KEYS.ctrlO);
  expect(cursor()).toBe(row(/Filler 39\./));
  await press("/");
  await press("look around");
  expect(row(/look around/)).not.toBe(-1);
  await press(KEYS.esc);
  expect(findBar(row)).toBe(-1);
  expect(row(/look around/)).toBe(-1);
  expect(cursor()).toBe(row(/Filler 39\./));
  // Nothing was found before, so n has nothing to go to.
  await press("n");
  expect(cursor()).toBe(row(/Filler 39\./));
  await press("/");
  await press("Searched");
  await press(KEYS.enter);
  expect(cursor()).toBe(row(/Searched +c in src/));
  await press("/");
  await press("Filler 3");
  await press(KEYS.esc);
  expect(cursor()).toBe(row(/Searched +c in src/));
  await press("N");
  expect(cursor()).toBe(row(/Searched +a in src/));
});

test("v in the transcript opens the whole conversation in $EDITOR, as claude's viewer does", async () => {
  const kept = mkdtempSync(join(tmpdir(), "astrocode-viewer-"));
  const visual = process.env.VISUAL;
  // The editor borrows the test's own stdin, which isn't a terminal, and keeps a copy of what it was given.
  const setRawMode = process.stdin.setRawMode;
  process.stdin.setRawMode = (() => process.stdin) as typeof process.stdin.setRawMode;
  process.env.VISUAL = `sh -c 'cp "$1" ${kept}/seen' sh`;
  try {
    const { press } = await launch(THREE);
    await press(KEYS.ctrlO);
    await press("v");
    // The editor runs in a terminal of its own, which takes a moment to start, longer on a busy machine.
    for (let i = 0; i < 50 && !existsSync(join(kept, "seen")); i++) await settle(100);
    const seen = readFileSync(join(kept, "seen"), "utf8");
    expect(seen).toContain("look around");
    expect(seen).toContain("Looking around");
    expect(seen).toMatch(/Ran +the tests/);
    // Content only, as a drag copies it: no rail, and not the start screen.
    expect(seen).not.toContain("│");
    expect(seen).not.toContain("astrocode");
  } finally {
    process.stdin.setRawMode = setRawMode;
    if (visual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = visual;
    rmSync(kept, { recursive: true, force: true });
  }
});

test("the transcript's hint in the box's edge lists four to six keys, all of them at 80 columns", async () => {
  const { press, screen } = await launch(THREE, { columns: 80, rows: 24 });
  const pairs = () => (screen().find((line) => line.startsWith("▄") && /↑↓/.test(line)) ?? "").replace(/^▄+ | ▄$/g, "").split("   ");
  await press(KEYS.ctrlO);
  expect(pairs().length).toBeGreaterThanOrEqual(4);
  expect(pairs().length).toBeLessThanOrEqual(6);
  await press(KEYS.enter);
  expect(pairs().length).toBeGreaterThanOrEqual(4);
  expect(pairs().length).toBeLessThanOrEqual(6);
  expect(pairs().at(-1)).toBe("esc close");
});

test("exactly one gold mark in every place your keys can be, and Esc from an overlay gives them back to the transcript", async () => {
  const { press, cursor, update, screen } = await launch(THREE);
  // A gold hairline is a panel's top edge drawn with `▁`: the box's, a decision's or an overlay's.
  const marks = () => screen().filter((line) => line.startsWith("▁")).length + (cursor() === -1 ? 0 : 1);
  const where = () => ({ marks: marks(), cursor: cursor() !== -1, box: screen().some((line, i, lines) => lines[i + 1]?.startsWith(" ❯") && /^▁+$/.test(line)) });
  expect(where()).toEqual({ marks: 1, cursor: false, box: true });
  await press(KEYS.ctrlO);
  expect(where()).toEqual({ marks: 1, cursor: true, box: false });
  await press(KEYS.enter);
  expect(screen().some((line) => line.includes("‹ 3 of 3 ›"))).toBe(true);
  expect(where()).toEqual({ marks: 1, cursor: true, box: false });
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  expect(where()).toEqual({ marks: 1, cursor: false, box: false });
  await update(THREE);
  expect(where()).toEqual({ marks: 1, cursor: true, box: false });
  // Alt+P, a key that works anywhere, opens the model picker over the transcript.
  await press("\x1bp");
  expect(where()).toEqual({ marks: 1, cursor: false, box: false });
  await press(KEYS.esc);
  expect(where()).toEqual({ marks: 1, cursor: true, box: false });
});

test("while the transcript has your keys, the line over the box names the key that stops Claude there", async () => {
  const { press, row } = await launch({ ...THREE, busy: true });
  expect(row(/esc to stop/)).not.toBe(-1);
  await press(KEYS.ctrlO);
  // Esc there leaves the transcript; Ctrl+C, a key that works anywhere, stops Claude.
  expect(row(/esc to stop/)).toBe(-1);
  expect(row(/ctrl\+c to stop/)).not.toBe(-1);
});

test("Ctrl+C in the transcript stops Claude and leaves what's typed in the box alone", async () => {
  const { press, row, asked, boxKeys } = await launch({ ...THREE, busy: true });
  await press("keep me");
  await press(KEYS.ctrlO);
  expect(boxKeys()).toBe(false);
  await press(KEYS.ctrlC);
  expect(asked).toContain("interrupt");
  await press(KEYS.esc);
  expect(boxKeys()).toBe(true);
  expect(row(/^ ❯ keep me/)).not.toBe(-1);
});

test("Ctrl+C in the transcript with Claude idle is the first press of the two that exit, and leaves what's typed alone", async () => {
  const { press, row, boxKeys } = await launch(THREE);
  await press("keep me");
  await press(KEYS.ctrlO);
  await press(KEYS.ctrlC);
  expect(row(/Press Ctrl\+C again to exit/)).not.toBe(-1);
  await press(KEYS.esc);
  expect(boxKeys()).toBe(true);
  expect(row(/^ ❯ keep me/)).not.toBe(-1);
});

test("Ctrl+L redraws while the transcript has your keys, and leaves them there", async () => {
  const { press, boxKeys, writes } = await launch(THREE);
  await press(KEYS.ctrlO);
  const before = writes.length;
  await press(KEYS.ctrlL);
  expect(writes.slice(before).join("")).toContain("\x1b[2J\x1b[H");
  expect(boxKeys()).toBe(false);
});

test("Ctrl+D in the transcript with text in the box does nothing: it neither deletes from it nor counts toward exit", async () => {
  const { press, row, boxKeys } = await launch(THREE);
  await press("hello");
  await press(KEYS.ctrlA);
  await press(KEYS.ctrlO);
  await press(KEYS.ctrlD);
  expect(row(/again to exit/)).toBe(-1);
  await press(KEYS.esc);
  expect(boxKeys()).toBe(true);
  expect(row(/^ ❯ hello/)).not.toBe(-1);
});

test("Ctrl+D pressed twice in the transcript with the box empty exits", async () => {
  const { press, row, exited } = await launch(THREE);
  await press(KEYS.ctrlO);
  await press(KEYS.ctrlD);
  expect(row(/Press Ctrl\+D again to exit/)).not.toBe(-1);
  expect(exited()).toBe(false);
  await press(KEYS.ctrlD);
  expect(exited()).toBe(true);
});

test("Ctrl+C pressed twice in the transcript with Claude idle exits, with what's typed in the box", async () => {
  const { press, exited } = await launch(THREE);
  await press("keep me");
  await press(KEYS.ctrlO);
  await press(KEYS.ctrlC);
  expect(exited()).toBe(false);
  await press(KEYS.ctrlC);
  expect(exited()).toBe(true);
});

test("Shift+↑ in the transcript steps the effort and leaves the cursor where it is", async () => {
  const { press, cursor, asked } = await launch(THREE);
  await press(KEYS.ctrlO);
  const at = cursor();
  expect(at).not.toBe(-1);
  await press(KEYS.shiftUp);
  expect(asked).toContain("setEffort");
  expect(cursor()).toBe(at);
});

/** The first section of the key sheet on screen, or undefined when it isn't open: its title, under the sheet's own and a blank row. */
const sheetFirst = (lines: string[]) => {
  const title = lines.findIndex((line) => /^ Keys\b/.test(line));
  return title === -1 ? undefined : lines[title + 2]?.trim().split(/ {2,}/)[0];
};

test("? in an empty box shows the box's keys over it; Esc gives the box its keys back, and ? after text is typed", async () => {
  const { press, screen, boxKeys, row } = await launch(THREE);
  await press("?");
  expect(sheetFirst(screen())).toBe("In the box");
  expect(boxKeys()).toBe(false);
  // Typing filters it.
  await press("redraw");
  expect(row(/ctrl\+l +redraw/)).not.toBe(-1);
  expect(row(/alt\+p +model/)).toBe(-1);
  await press(KEYS.esc);
  expect(sheetFirst(screen())).toBeUndefined();
  expect(boxKeys()).toBe(true);
  await press("why?");
  expect(row(/❯ why\?/)).not.toBe(-1);
  expect(sheetFirst(screen())).toBeUndefined();
});

test("? in the transcript lists its keys first, and an opened call's while one is open; Esc gives the transcript its keys back", async () => {
  const { press, screen, cursor } = await launch(THREE);
  await press(KEYS.ctrlO);
  await press("?");
  expect(sheetFirst(screen())).toBe("In the transcript");
  expect(cursor()).toBe(-1);
  await press(KEYS.esc);
  expect(sheetFirst(screen())).toBeUndefined();
  expect(cursor()).not.toBe(-1);
  await press(KEYS.enter);
  await press("?");
  expect(sheetFirst(screen())).toBe("In an opened call");
  await press(KEYS.esc);
  // The call stays open under its line.
  expect(screen().some((line) => line.includes("‹ 3 of 3 ›"))).toBe(true);
  expect(cursor()).not.toBe(-1);
});

/** That ? and Esc leave the screen as it was, but for spaces at a line's end. */
const sheetAndBack = async ({ press, screen }: Awaited<ReturnType<typeof launch>>) => {
  const plain = () => screen().map((line) => line.trimEnd());
  const before = plain();
  await press("?");
  expect(sheetFirst(screen())).toBeDefined();
  await press(KEYS.esc);
  expect(plain()).toEqual(before);
};

test("? and Esc in the transcript scrolled up leave the cursor on its line and the view where it was", async () => {
  const app = await launch(long(), { rows: 24 });
  await app.press(KEYS.ctrlO);
  await app.press("\x1b[F");
  await app.press("\x1b[5~");
  await sheetAndBack(app);
});

test("? and Esc in an opened ledger leave the cursor on its file, with its diff open", async () => {
  const app = await launch(ledgers(), { columns: 120 });
  await app.press(KEYS.ctrlO);
  for (let i = 0; i < 3; i++) await app.press(KEYS.up);
  await app.press(KEYS.enter);
  await app.press(KEYS.down);
  await app.press(KEYS.enter);
  expect(app.screen()[app.cursor()]).toMatch(/src\/a\.ts/);
  await sheetAndBack(app);
});

test("? and Esc in an opened call leave the cursor on its line, with the call open", async () => {
  const app = await launch(long(), { rows: 24 });
  await app.press(KEYS.ctrlO);
  // Up to the call before the last, whose panel opens under its line with room below it.
  while (!/Searched +c13/.test(app.screen()[app.cursor()] ?? "")) await app.press(KEYS.up);
  await app.press(KEYS.enter);
  expect(app.row(/‹ 1 of 1 ›/)).toBe(app.cursor() + 1);
  await sheetAndBack(app);
});

test("? in a permission prompt shows its keys in its place, and Esc goes back to it without saying no", async () => {
  const { press, screen, update, row, asked } = await launch(THREE);
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  await press("?");
  expect(sheetFirst(screen())).toBe("In a permission prompt");
  expect(row(/rm -rf build/)).toBe(-1);
  await press(KEYS.esc);
  expect(sheetFirst(screen())).toBeUndefined();
  expect(row(/rm -rf build/)).not.toBe(-1);
  expect(asked).not.toContain("decide");
});

test("a decision that comes while the box's key sheet is open takes its place, and the sheet is back once it's answered", async () => {
  const { press, screen, update, row } = await launch(THREE);
  await press("?");
  expect(sheetFirst(screen())).toBe("In the box");
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  expect(row(/rm -rf build/)).not.toBe(-1);
  expect(sheetFirst(screen())).toBeUndefined();
  await update(THREE);
  expect(sheetFirst(screen())).toBe("In the box");
});

test("the key sheet over a permission prompt keeps its choice: No is still chosen after ? and Esc", async () => {
  const { press, update, row, asked } = await launch(THREE);
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  // ↑ from the first row goes round to the last, No.
  await press(KEYS.up);
  expect(row(/› \d {2}No\b/)).not.toBe(-1);
  await press("?");
  await press(KEYS.esc);
  expect(row(/› \d {2}No\b/)).not.toBe(-1);
  expect(row(/› 1 {2}Yes\b/)).toBe(-1);
  // The prompt has been in view long enough that Enter answers it at once.
  await press(KEYS.enter);
  expect(asked).toContain("decide");
});

test("? in a permission prompt's comment, or in a plan's row of what to change, is typed there and opens no key sheet", async () => {
  const { press, screen, update, row } = await launch(THREE);
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  // Past the half second in which a new prompt takes no typing.
  await settle(500);
  // ↑ goes round to No, and Tab opens its comment.
  await press(KEYS.up);
  await press(KEYS.tab);
  await press("why");
  await press("?");
  expect(sheetFirst(screen())).toBeUndefined();
  expect(row(/No, why\?/)).not.toBe(-1);
  await update({ ...THREE, pending: [{ id: "p", toolName: "ExitPlanMode", input: { plan: "# Plan\n\nRename the cache." } }] });
  await settle(500);
  // ↑ goes round to the plan's last row, which you type in.
  await press(KEYS.up);
  await press("why not");
  await press("?");
  expect(sheetFirst(screen())).toBeUndefined();
  expect(row(/why not\?/)).not.toBe(-1);
  // On a row you pick, ? is the key sheet's.
  await press(KEYS.down);
  await press("?");
  expect(sheetFirst(screen())).toBe("In a permission prompt");
});

test("? in a permission prompt lists the keys that prompt takes: an edit's Shift+Tab and Tab, a plan's Ctrl+G", async () => {
  const { press, screen, update } = await launch(THREE);
  const edit = { id: "e", toolName: "Edit", input: { file_path: "/p/a.ts", old_string: "a", new_string: "b" }, alwaysAllow: [{ type: "setMode" as const, mode: "acceptEdits" as const, destination: "session" as const }] };
  await update({ ...THREE, pending: [edit] });
  await press("?");
  expect(sheetFirst(screen())).toBe("In a permission prompt");
  expect(screen().join("\n")).toMatch(/shift\+tab +yes, for this session/);
  expect(screen().join("\n")).toMatch(/ tab +a comment on No/);
  expect(screen().join("\n")).not.toContain("ctrl+g");
  await press(KEYS.esc);
  await update({ ...THREE, pending: [{ id: "p", toolName: "ExitPlanMode", input: { plan: "# Plan\n\nRename the cache.", planFilePath: "/home/u/.claude/plans/p.md" } }] });
  await press("?");
  expect(screen().join("\n")).toMatch(/ctrl\+g +the plan in your editor/);
  expect(screen().join("\n")).not.toContain("a comment on No");
});

test("the key sheet over a permission prompt closes with it, when it's answered elsewhere or another takes its place", async () => {
  const { press, screen, update, row, boxKeys } = await launch(THREE);
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  await press("?");
  expect(sheetFirst(screen())).toBe("In a permission prompt");
  // Answered from Remote Control, or withdrawn as the turn ends.
  await update(THREE);
  expect(sheetFirst(screen())).toBeUndefined();
  expect(boxKeys()).toBe(true);
  await update({ ...THREE, pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  await press("?");
  await update({ ...THREE, pending: [{ id: "d", toolName: "Bash", input: { command: "git push" } }] });
  expect(sheetFirst(screen())).toBeUndefined();
  expect(row(/git push/)).not.toBe(-1);
});

test("the wheel over the key sheet scrolls the sheet, and leaves the conversation behind it where it was", async () => {
  const { press, screen, row, wheel } = await launch(turn(Array.from({ length: 60 }, (_, i) => call(`c${i}`))), { columns: 120, rows: 40 });
  await press("?");
  const behind = () => screen().slice(0, 4).join("\n");
  const transcript = behind();
  const keys = () => screen()[row(/^ Keys\b/) + 2];
  const first = keys();
  await wheel(20, row(/^ Keys\b/) + 5, 3);
  expect(keys()).not.toBe(first);
  await wheel(20, row(/^ Keys\b/) + 5, -5);
  expect(keys()).toBe(first);
  expect(behind()).toBe(transcript);
});

test("a key sheet taller than the room above it cuts the start screen short, and never draws its lines over each other", async () => {
  const { press, screen } = await launch(initialState("/p", "/home/u"), { columns: 80, rows: 23 });
  const start = new Set(screen().map((line) => line.trimEnd()));
  /** The rows above the sheet's top edge, each a row of the start screen as it was before. */
  const above = () => {
    const lines = screen();
    return lines.slice(0, lines.findIndex((line) => /^▁{20}/.test(line)));
  };
  await press("?");
  for (const line of above()) expect(start).toContain(line.trimEnd());
  // Filtering makes the sheet shorter, and the start screen has more room.
  for (const key of "send") await press(key);
  expect(above().length).toBeGreaterThan(3);
  for (const line of above()) expect(start).toContain(line.trimEnd());
});
