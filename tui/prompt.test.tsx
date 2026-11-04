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
      onCtrlC={call("ctrlC")}
      onExit={call("exit")}
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
  return { press, calls, sent, effort, history, app, screen: () => stripVTControlCharacters(screen) };
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

test("Ctrl+L redraws the screen and keeps what's typed, as in claude", async () => {
  const { press, calls, sent, app } = box();
  await press("hello", KEYS.ctrlL, KEYS.enter);
  app.unmount();
  expect(calls).toEqual(["redraw"]);
  expect(sent).toEqual(["hello"]);
});
