import { afterEach, beforeEach, expect, test } from "bun:test";
import { render, Text } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { loadSettings, remember, saved } from "../src/settings";
import { initialState, type State, type ToolCall } from "../src/view/state";
import { FollowDock, followedCall, useDwell } from "./follow";
import { tabsOf } from "./inspector";
import { DEFAULT_KEYMAP, followKey } from "./keys";
import { scratchConfig } from "./scratch-config";

const call = (id: string, more: Partial<ToolCall> = {}): ToolCall => ({ id, name: "Read", input: {}, status: "done", subagentCalls: 0, ...more });

const conversation = (calls: ToolCall[]): State => {
  const state = initialState("/p", "/home/u");
  return {
    ...state,
    items: [{ kind: "prompt", key: "p", text: "go" }, ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one }))],
    tools: Object.fromEntries(calls.map((one, i) => [one.id, i + 1])),
  };
};

/** A fake terminal, and what was last drawn on it. */
function terminal(columns = 80) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows: 30 });
  let drawn = "";
  stdout.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const options = { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false };
  return { options, screen: () => stripVTControlCharacters(drawn) };
}

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

// One test saves a setting, so every test gets a scratch config folder in place of yours.
const config = scratchConfig();
beforeEach(config.start);
afterEach(config.stop);

test("follows the call waiting for you first, else the one Claude started last", () => {
  const state = conversation([call("a"), call("b", { name: "Edit" }), call("c", { status: "running" })]);
  expect(followedCall(state, new Set())).toBe("c");
  expect(followedCall(state, new Set(["b"]))).toBe("b");
  // A subagent's own call that waits isn't in the conversation; the latest call stands.
  expect(followedCall(state, new Set(["inner"]))).toBe("c");
  expect(followedCall(initialState("/p", "/home/u"), new Set())).toBeUndefined();
});

test("holds each call a moment, so a burst of calls shows only the last, and a call waiting for you at once", async () => {
  const seen: (string | undefined)[] = [];
  function Probe({ target, urgent }: { target?: string; urgent: boolean }) {
    const shown = useDwell(target, urgent, 300);
    if (!seen.length || seen.at(-1) !== shown) seen.push(shown);
    return <Text>{shown ?? "-"}</Text>;
  }
  const { options } = terminal();
  const app = render(<Probe target="a" urgent={false} />, options);
  await settle(50);
  app.rerender(<Probe target="b" urgent={false} />);
  await settle(50);
  app.rerender(<Probe target="c" urgent={false} />);
  await settle(100);
  // Still on the first: the moment isn't up.
  expect(seen).toEqual(["a"]);
  await settle(250);
  expect(seen).toEqual(["a", "c"]);
  app.rerender(<Probe target="d" urgent />);
  await settle(50);
  app.unmount();
  expect(seen).toEqual(["a", "c", "d"]);
});

test("the first call shows at once when following starts", async () => {
  const seen: (string | undefined)[] = [];
  function Probe({ target }: { target?: string }) {
    const shown = useDwell(target, false, 300);
    if (!seen.length || seen.at(-1) !== shown) seen.push(shown);
    return <Text>{shown ?? "-"}</Text>;
  }
  const { options } = terminal();
  const app = render(<Probe />, options);
  await settle(50);
  app.rerender(<Probe target="a" />);
  await settle(50);
  app.unmount();
  expect(seen).toEqual([undefined, "a"]);
});

test("the dock shows what a command is and how it went, over the end of what it printed", async () => {
  const output = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const bash = call("x", { name: "Bash", input: { command: "seq 20", description: "Count to twenty" }, result: output });
  const { options, screen } = terminal();
  const app = render(<FollowDock call={bash} waiting={false} width={80} rows={3} cwd="/p" home="/home/u" onOpen={() => {}} />, options);
  await settle();
  app.unmount();
  const drawn = screen();
  expect(drawn).toContain("◉ Following");
  expect(drawn).toContain("Count to twenty");
  expect(drawn).toContain("✓ exit 0");
  expect(drawn).toContain("line 20");
  expect(drawn).not.toContain("line 17");
});

test("the dock says it waits for you, before Claude has made a call it says what it will show", async () => {
  const edit = call("e", { name: "Edit", status: "running", input: { file_path: "/p/a.ts", old_string: "a", new_string: "b" } });
  const first = terminal();
  const app = render(<FollowDock call={edit} waiting width={80} rows={3} cwd="/p" home="/home/u" onOpen={() => {}} />, first.options);
  await settle();
  app.unmount();
  expect(first.screen()).toContain("◆ Waiting for you");
  expect(first.screen()).toContain("waiting for you");
  // It asks to edit; nothing is being edited yet.
  expect(first.screen()).toContain("Edit a.ts");
  expect(first.screen()).not.toContain("Editing");
  // A command waiting for your OK shows the command, which has no output yet.
  const bash = call("w", { name: "Bash", status: "running", input: { command: "rm -rf build", description: "Clean the build" } });
  const third = terminal();
  const asking = render(<FollowDock call={bash} waiting width={80} rows={4} cwd="/p" home="/home/u" onOpen={() => {}} />, third.options);
  await settle();
  asking.unmount();
  expect(third.screen()).toContain("$ rm -rf build");
  expect(third.screen()).not.toContain("still running");
  const second = terminal();
  const empty = render(<FollowDock call={undefined} waiting={false} width={80} rows={3} cwd="/p" home="/home/u" onOpen={() => {}} />, second.options);
  await settle();
  empty.unmount();
  expect(second.screen()).toContain("Each tool call Claude makes shows here as it runs.");
});

test("a subagent opens on its transcript while it works, and on its report once it's done", () => {
  const log = [{ text: "❯ look around", kind: "prompt" as const }];
  expect(tabsOf(call("s", { name: "Agent", status: "running" }), log)[0]).toBe("transcript");
  expect(tabsOf(call("s", { name: "Agent" }), log).slice(0, 2)).toEqual(["report", "transcript"]);
  expect(tabsOf(call("s", { name: "Agent", status: "running" }))).toEqual(["report", "prompt", "input"]);
});

test("Alt+L follows Claude, and hints name the key as bound", () => {
  expect(DEFAULT_KEYMAP.get("meta+l")).toBe("chat:followClaude");
  expect(followKey(DEFAULT_KEYMAP)).toBe("alt+l");
  expect(followKey(new Map([["ctrl+x f", "chat:followClaude"]]))).toBe("ctrl+x f");
});

test("following is remembered for the next session", async () => {
  expect((await loadSettings()).follow).toBeUndefined();
  await remember({ follow: true });
  await saved();
  expect((await loadSettings()).follow).toBe(true);
});
