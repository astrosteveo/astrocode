import { expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { initialState, type State } from "../src/view/state";
import { Mouse, MouseContext } from "./mouse";
import { StatusBar } from "./status";

/** A conversation with every reading the bar can show, more than fit at 80 columns. */
const state: State = {
  ...initialState("/p", "/home/u"),
  model: "claude-opus-5-5",
  effort: "xhigh",
  plan: "Claude Max",
  context: { percentage: 18, tokens: 36_000, max: 200_000 },
  limits: { fiveHour: { utilization: 0.31, resetsAt: 0 }, sevenDay: { utilization: 0.64, resetsAt: 0 } },
};

/** The bar on a fake terminal `columns` wide, with a mouse that `click` presses at a cell of it. */
function bar(columns: number, props: { needsYou?: number; armed?: string | null; onNeedsYou?: () => void; onMode?: () => void }) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows: 10 });
  let drawn = "";
  stdout.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const reports: string[] = [];
  const input = { read: () => reports.shift() ?? null } as unknown as NodeJS.ReadStream;
  const mouse = new Mouse(input, { write: () => true } as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext value={mouse}>
      <StatusBar
        state={state}
        mode="default"
        git={{ branch: "feat/cache-clock", changes: 3 }}
        width={columns}
        armed={props.armed ?? null}
        running={0}
        keepWarm={false}
        usageMode="on"
        needsYou={props.needsYou}
        onNeedsYou={props.onNeedsYou}
        onMode={props.onMode}
      />
    </MouseContext>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  const line = () => stripVTControlCharacters(drawn).split("\n").filter((one) => one.trim()).at(-1) ?? "";
  const click = async (x: number) => {
    reports.push(`\x1b[<0;${x + 1};1M`);
    // The mouse takes its reports out of stdin's reads and hands them on a microtask later.
    input.read();
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { line, click, stop: () => (app.unmount(), mouse.stop()) };
}

test("says in the status bar, after the mode, how many other conversations wait on you, at every width", () => {
  for (const columns of [80, 120, 200]) {
    const { line, stop } = bar(columns, { needsYou: 2 });
    const shown = line();
    stop();
    expect(shown).toMatch(/^ ▐ask first▌ {2}shift\+tab {2}← 2 need you /);
    // The readings make room for it, keeping the context first.
    expect(shown).toContain("context");
    expect(shown.trimEnd().length).toBeLessThanOrEqual(columns);
  }
});

test("says nothing of other conversations while none waits on you", () => {
  const { line, stop } = bar(120, { needsYou: 0 });
  const shown = line();
  stop();
  expect(shown).not.toContain("needs you");
  expect(shown).not.toContain("←");
});

test("keeps the count while a key pressed once waits for its second press", () => {
  const { line, stop } = bar(120, { needsYou: 1, armed: "Press Ctrl+C again to exit" });
  const shown = line();
  stop();
  expect(shown).toMatch(/^ Press Ctrl\+C again to exit {2}← 1 needs you/);
});

test("a click on the count opens the conversations, and a click on the mode still changes it", async () => {
  let opened = 0;
  let cycled = 0;
  const { line, click, stop } = bar(120, { needsYou: 1, onNeedsYou: () => (opened += 1), onMode: () => (cycled += 1) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const shown = line();
  await click(shown.indexOf("← 1 needs you") + 4);
  expect(opened).toBe(1);
  await click(shown.indexOf("shift+tab") + 2);
  expect(opened).toBe(1);
  await click(shown.indexOf("ask first"));
  stop();
  expect(cycled).toBe(1);
});
