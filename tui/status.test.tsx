import { expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { initialState, type State } from "../src/view/state";
import { Mouse, MouseContext } from "./mouse";
import { StatusBar } from "./status";

/** A conversation with every reading the bar can show, more than fit at 80 columns. */
const state: State = {
  ...initialState("/p", "/home/u"),
  model: "claude-opus-5-5",
  effort: "xhigh",
  context: { percentage: 18, tokens: 36_000, max: 200_000 },
  limits: { fiveHour: { utilization: 0.31, resetsAt: 0 }, sevenDay: { utilization: 0.64, resetsAt: 0 } },
};

/** The bar on a fake terminal `columns` wide, with a mouse that `click` presses at a cell of it. */
function bar(columns: number, props: { needsYou?: number; armed?: string | null; mode?: PermissionMode; toast?: string; onNeedsYou?: () => void; onMode?: () => void }) {
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
        mode={props.mode ?? "default"}
        git={{ branch: "feat/cache-clock", changes: 3 }}
        width={columns}
        armed={props.armed ?? null}
        running={0}
        toast={props.toast ?? null}
        keepWarm={false}
        usageMode="on"
        needsYou={props.needsYou}
        onNeedsYou={props.onNeedsYou}
        onMode={props.onMode}
      />
    </MouseContext>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  const lines = () => stripVTControlCharacters(drawn).split("\n").filter((one) => one.trim());
  const line = () => lines().at(-1) ?? "";
  const click = async (x: number) => {
    reports.push(`\x1b[<0;${x + 1};1M`);
    // The mouse takes its reports out of stdin's reads and hands them on a microtask later.
    input.read();
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { line, lines, click, stop: () => (app.unmount(), mouse.stop()) };
}

test("says in the status bar, after the mode, how many other conversations wait on you, at every width", () => {
  for (const columns of [80, 120, 200]) {
    const { line, stop } = bar(columns, { needsYou: 2 });
    const shown = line();
    stop();
    expect(shown).toMatch(/^ ▐ask first▌ {2}← 2 need you /);
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
  // The gap between the mode and the count is neither.
  await click(shown.indexOf("← 1 needs you") - 1);
  expect(opened).toBe(1);
  await click(shown.indexOf("ask first"));
  stop();
  expect(cycled).toBe(1);
});

test("a toast is cut to the room the count leaves it, so the bar stays one row", () => {
  for (const mode of ["default", "bypassPermissions"] as const) {
    const { lines, stop } = bar(80, { needsYou: 1, mode, toast: "Copied Claude's last reply, 12 lines" });
    const shown = lines();
    stop();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("← 1 needs you");
    expect(shown[0]).toContain("✓ Copied Claude's last");
    expect(shown[0]!.trimEnd().length).toBeLessThanOrEqual(80);
  }
});

test("a key's armed hint is cut to the room the count leaves it, so the bar stays one row at 60 columns", () => {
  for (const armed of ["shift+↑ stops below max · /effort max to set it", "Press Ctrl+D again to exit"]) {
    const { lines, stop } = bar(60, { needsYou: 2, armed });
    const shown = lines();
    stop();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("← 2 need you");
    expect(shown[0]).toContain(armed.slice(0, 20));
    expect(shown[0]!.trimEnd().length).toBeLessThanOrEqual(60);
  }
});

test("a click on the count beside a cut armed hint still opens the conversations", async () => {
  let opened = 0;
  const { line, click, stop } = bar(60, { needsYou: 2, armed: "shift+↑ stops below max · /effort max to set it", onNeedsYou: () => (opened += 1) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const shown = line();
  expect(shown).toContain("← 2 need you");
  await click(shown.indexOf("← 2 need you") + 4);
  stop();
  expect(opened).toBe(1);
});

test("leaves out the key that changes the mode, which ? lists, even with room for it", () => {
  const { line, stop } = bar(200, {});
  const shown = line();
  stop();
  expect(shown).not.toContain("shift+tab");
  expect(shown).toMatch(/⎇ feat\/cache-clock ±3 *$/);
});
