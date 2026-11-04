import { expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { DEFAULT_KEYMAP } from "./keys";
import { Prompt } from "./prompt";

/** Keys as a terminal sends them. */
const KEYS = {
  enter: "\r",
  escape: "\x1b",
  up: "\x1b[A",
  left: "\x1b[D",
  shiftUp: "\x1b[1;2A",
  shiftDown: "\x1b[1;2B",
  ctrlC: "\x03",
  ctrlD: "\x04",
  ctrlL: "\x0c",
};

/** The message box on a fake terminal, with what it asked the app to do. */
function box(options: { busy?: boolean; history?: string[] } = {}) {
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
      active
      fullscreen={false}
      busy={options.busy ?? false}
      width={80}
      cwd={process.cwd()}
      history={history}
      commands={[]}
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
  return { press, calls, sent, armed, effort, history, app, screen: () => stripVTControlCharacters(screen) };
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
