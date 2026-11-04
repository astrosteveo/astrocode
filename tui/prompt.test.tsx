import { expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { CommandInfo } from "../src/events";
import { DEFAULT_KEYMAP } from "./keys";
import { Prompt } from "./prompt";

/** Keys as a terminal sends them. */
const KEYS = {
  enter: "\r",
  escape: "\x1b",
  up: "\x1b[A",
  left: "\x1b[D",
  right: "\x1b[C",
  tab: "\t",
  shiftTab: "\x1b[Z",
  backspace: "\x7f",
  shiftUp: "\x1b[1;2A",
  shiftDown: "\x1b[1;2B",
  ctrlC: "\x03",
  ctrlD: "\x04",
  ctrlL: "\x0c",
};

/** The message box on a fake terminal, with what it asked the app to do. */
function box(options: { busy?: boolean; history?: string[]; commands?: CommandInfo[]; suggestion?: string; active?: boolean; hidden?: boolean } = {}) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
  let screen = "";
  stdout.on("data", (chunk: Buffer) => {
    screen += chunk.toString();
  });
  const history = options.history ?? [];
  const calls: string[] = [];
  const sent: string[] = [];
  const armed: (string | null)[] = [];
  const effort: number[] = [];
  const call = (name: string) => () => void calls.push(name);
  const app = render(
    <Prompt
      active={options.active ?? true}
      fullscreen={false}
      busy={options.busy ?? false}
      suggestion={options.suggestion}
      hidden={options.hidden}
      width={80}
      cwd={process.cwd()}
      history={history}
      everywhere={history}
      commands={options.commands ?? []}
      onSubmit={(text) => void sent.push(text)}
      onSendQueuedNow={call("sendQueuedNow")}
      onInterrupt={call("interrupt")}
      onCycleMode={call("cycleMode")}
      onExit={call("exit")}
      onArmed={(hint) => void armed.push(hint)}
      onClearIntoHistory={(text) => void history.push(text)}
      onRedraw={call("redraw")}
      onOpenOutput={call("openOutput")}
      prefill={null}
      onAttach={() => 1}
      onNotice={call("notice")}
      onEdit={call("edit")}
      onBackground={call("background")}
      onToggleTodos={call("toggleTodos")}
      onRewind={call("rewind")}
      onSuspend={call("suspend")}
      keymap={DEFAULT_KEYMAP}
      onStepEffort={(by) => void effort.push(by)}
      onToggleThinking={call("toggleThinking")}
      onModelPicker={call("modelPicker")}
      onFastMode={call("fastMode")}
      onStopTasks={call("stopTasks")}
      stash={null}
      onStash={() => {}}
      workflows
    />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  /** Each key on its own, as typed, so two Escs aren't read as one Alt+Esc. */
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await settle();
    }
  };
  /** The rows last drawn: each frame is drawn as one synchronized update. */
  const frame = () => stripVTControlCharacters(screen.split("\x1b[?2026h").at(-1) ?? "").split("\n").map((row) => row.trimEnd()).filter(Boolean);
  return { press, calls, sent, armed, effort, history, app, frame, screen: () => stripVTControlCharacters(screen) };
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

test("Ctrl+L redraws the screen and keeps what's typed, as in claude", async () => {
  const { press, calls, sent, app } = box();
  await press("hello", KEYS.ctrlL, KEYS.enter);
  app.unmount();
  expect(calls).toEqual(["redraw"]);
  expect(sent).toEqual(["hello"]);
});

test("Ctrl+D on an empty box exits on the second press, and says so after the first", async () => {
  const { press, calls, armed, app } = box();
  await press(KEYS.ctrlD);
  expect(calls).toEqual([]);
  expect(armed).toEqual(["Press Ctrl+D again to exit"]);
  await press(KEYS.ctrlD);
  app.unmount();
  expect(calls).toEqual(["exit"]);
});

test("Ctrl+D pressed again after 800 ms starts over rather than exiting", async () => {
  const { press, calls, armed, app } = box();
  await press(KEYS.ctrlD);
  await settle(900);
  await press(KEYS.ctrlD);
  app.unmount();
  expect(calls).toEqual([]);
  expect(armed).toEqual(["Press Ctrl+D again to exit", null, "Press Ctrl+D again to exit"]);
});

test("Ctrl+D with text deletes the character after the cursor, as in claude", async () => {
  const { press, calls, sent, app } = box();
  await press("abc", KEYS.left, KEYS.left, KEYS.ctrlD, KEYS.ctrlD, KEYS.enter);
  app.unmount();
  expect(calls).toEqual([]);
  expect(sent).toEqual(["a"]);
});

test("Ctrl+C then Ctrl+D is one double press, as in claude", async () => {
  const { press, calls, armed, app } = box();
  await press(KEYS.ctrlC, KEYS.ctrlD);
  app.unmount();
  expect(armed[0]).toBe("Press Ctrl+C again to exit");
  expect(calls).toEqual(["exit"]);
});

test("Ctrl+C with text clears it as the first of the two presses that exit, as in claude", async () => {
  const { press, calls, sent, armed, app } = box();
  await press("draft", KEYS.ctrlC);
  expect(armed).toEqual(["Press Ctrl+C again to exit"]);
  await press(KEYS.ctrlC);
  await press("kept", KEYS.enter);
  app.unmount();
  expect(calls).toEqual(["exit"]);
  expect(sent).toEqual(["kept"]);
});

test("Ctrl+C with text while Claude works only clears it, and the next press stops Claude", async () => {
  const { press, calls, armed, app } = box({ busy: true });
  await press("draft", KEYS.ctrlC, KEYS.ctrlC);
  app.unmount();
  expect(armed).toEqual([]);
  expect(calls).toEqual(["interrupt"]);
});

test("Ctrl+C while Claude works stops it, however often it's pressed", async () => {
  const { press, calls, app } = box({ busy: true });
  await press(KEYS.ctrlC, KEYS.ctrlC);
  app.unmount();
  expect(calls).toEqual(["interrupt", "interrupt"]);
});

test("Esc Esc with text clears it into history, and ↑ brings it back, as in claude", async () => {
  const { press, calls, sent, armed, history, app } = box({ history: ["older"] });
  await press("draft", KEYS.escape);
  expect(armed).toEqual(["Esc again to clear"]);
  await press(KEYS.escape);
  expect(history).toEqual(["older", "draft"]);
  await press(KEYS.enter);
  expect(sent).toEqual([]);
  await press(KEYS.up, KEYS.enter);
  app.unmount();
  expect(sent).toEqual(["draft"]);
  expect(calls).toEqual([]);
});

test("one Esc never throws away what's typed", async () => {
  const { press, calls, sent, history, app } = box();
  await press("draft", KEYS.escape);
  await settle(900);
  await press(KEYS.escape, KEYS.enter);
  app.unmount();
  expect(sent).toEqual(["draft"]);
  expect(history).toEqual([]);
  expect(calls).toEqual([]);
});

test("Esc Esc clears a blank box without keeping it", async () => {
  const { press, sent, history, app } = box();
  await press("   ", KEYS.escape, KEYS.escape, "x", KEYS.enter);
  app.unmount();
  expect(history).toEqual([]);
  expect(sent).toEqual(["x"]);
});

test("Esc Esc on an empty box rewinds, with nothing said after the first Esc", async () => {
  const { press, calls, armed, app } = box();
  await press(KEYS.escape, KEYS.escape);
  app.unmount();
  expect(calls).toEqual(["rewind"]);
  expect(armed.filter(Boolean)).toEqual([]);
});

test("Esc while Claude works stops it and keeps what's typed", async () => {
  const { press, calls, sent, history, app } = box({ busy: true });
  await press("draft", KEYS.escape, KEYS.escape, KEYS.enter);
  app.unmount();
  expect(calls).toEqual(["interrupt", "interrupt"]);
  expect(history).toEqual([]);
  expect(sent).toEqual(["draft"]);
});

test("Shift+↑ and Shift+↓ step the effort, and leave the box and its history alone, as in claude", async () => {
  const { press, sent, effort, app } = box({ history: ["older"] });
  await press("draft", KEYS.shiftUp, KEYS.shiftDown, KEYS.shiftDown, KEYS.enter);
  app.unmount();
  expect(effort).toEqual([1, -1, -1]);
  expect(sent).toEqual(["draft"]);
});

test("Shift+↑ steps the effort with the / menu open too, where ↑ moves in the menu", async () => {
  const { press, effort, app } = box({ commands: [{ name: "help", description: "Keys and commands", argumentHint: "" }] });
  await press("/", KEYS.shiftUp);
  app.unmount();
  expect(effort).toEqual([1]);
});

// Claude Code's guess at your next message, offered in the empty box after a turn.
const SUGGESTED = "next one adds two numbers";

test("the empty box offers Claude Code's suggestion, and Tab takes it to send unchanged, as in claude", async () => {
  const { press, frame, sent, app } = box({ suggestion: SUGGESTED });
  expect(frame().join("\n")).toContain(SUGGESTED);
  expect(frame().join("\n")).toContain("tab to use");
  await press(KEYS.tab);
  expect(frame()).toContain(` ❯ ${SUGGESTED}`);
  expect(frame().join("\n")).not.toContain("tab to use");
  await press(KEYS.enter);
  app.unmount();
  expect(sent).toEqual([SUGGESTED]);
});

test("→ takes the suggestion on an empty box, and only moves the cursor once something's typed", async () => {
  const empty = box({ suggestion: SUGGESTED });
  await empty.press(KEYS.right, KEYS.enter);
  empty.app.unmount();
  expect(empty.sent).toEqual([SUGGESTED]);
  const typed = box({ suggestion: SUGGESTED });
  await typed.press("ac", KEYS.left, KEYS.right, KEYS.left, "b", KEYS.enter);
  typed.app.unmount();
  expect(typed.sent).toEqual(["abc"]);
});

test("typing hides the suggestion, and emptying the box brings it back, as in claude", async () => {
  const { press, frame, sent, app } = box({ suggestion: SUGGESTED });
  await press("x");
  expect(frame().join("\n")).not.toContain(SUGGESTED);
  await press(KEYS.tab);
  expect(frame()).toContain(" ❯ x");
  await press(KEYS.backspace);
  expect(frame().join("\n")).toContain(SUGGESTED);
  await press(KEYS.tab, KEYS.enter);
  app.unmount();
  expect(sent).toEqual([SUGGESTED]);
});

test("Shift+Tab still changes the mode with a suggestion showing", async () => {
  const { press, frame, calls, app } = box({ suggestion: SUGGESTED });
  await press(KEYS.shiftTab);
  app.unmount();
  expect(calls).toEqual(["cycleMode"]);
  expect(frame().join("\n")).toContain("tab to use");
});

test("while Claude works the box says so, and offers no suggestion", async () => {
  const { press, frame, sent, app } = box({ busy: true, suggestion: SUGGESTED });
  expect(frame().join("\n")).toContain("Claude is working");
  expect(frame().join("\n")).not.toContain(SUGGESTED);
  await press(KEYS.tab, KEYS.right, KEYS.enter);
  app.unmount();
  expect(sent).toEqual([]);
});

test("while a decision has the box's place, the box offers no suggestion", async () => {
  const { press, frame, sent, app } = box({ hidden: true, suggestion: SUGGESTED });
  expect(frame().join("\n")).not.toContain(SUGGESTED);
  await press(KEYS.tab, KEYS.right, KEYS.enter);
  app.unmount();
  expect(sent).toEqual([]);
});

test("without your keys the box shows the suggestion but not tab to use, as Tab isn't the box's then", async () => {
  const { frame, app } = box({ active: false, suggestion: SUGGESTED });
  app.unmount();
  expect(frame().join("\n")).toContain(SUGGESTED);
  expect(frame().join("\n")).not.toContain("tab to use");
});

test("a long suggestion keeps to the box's one row, with tab to use beside it", async () => {
  const long = "now write the tests for every one of the five functions we wrote, and run them all";
  const { frame, app } = box({ suggestion: long });
  const row = frame().find((one) => one.includes("tab to use"));
  app.unmount();
  expect(row).toContain("now write the tests");
  expect(row).toContain("…");
  expect(row!.length).toBeLessThanOrEqual(80);
});
