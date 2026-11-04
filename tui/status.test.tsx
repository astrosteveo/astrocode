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
  plan: "Claude Max",
  context: { percentage: 18, tokens: 36_000, max: 200_000 },
  limits: { fiveHour: { utilization: 0.31, resetsAt: 0 }, sevenDay: { utilization: 0.64, resetsAt: 0 } },
};

/** The bar on a fake terminal `columns` wide, with a mouse that `click` presses at a cell of it. */
function bar(columns: number, props: { state?: State; needsYou?: number; armed?: string | null; mode?: PermissionMode; toast?: string; running?: number; onNeedsYou?: () => void; onMode?: () => void; onModel?: () => void; onEffort?: () => void }) {
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
        state={props.state ?? state}
        mode={props.mode ?? "default"}
        git={{ branch: "feat/cache-clock", changes: 3 }}
        width={columns}
        armed={props.armed ?? null}
        running={props.running ?? 0}
        toast={props.toast ?? null}
        keepWarm={false}
        usageMode="on"
        needsYou={props.needsYou}
        onNeedsYou={props.onNeedsYou}
        onMode={props.onMode}
        onModel={props.onModel}
        onEffort={props.onEffort}
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

/** Each reading by the words it starts with, in the order the bar keeps them in as it narrows. */
const RANKED = [["context 18%"], ["7d 64%"], ["◌ 2 running"], ["5h 31%"], ["Opus 5.5 xhigh"], ["feat/cache-clock ±3"]];
/** The same, in the order they're drawn. */
const DRAWN = ["◌ 2 running", "context 18%", "5h 31%", "7d 64%", "Opus 5.5 xhigh", "feat/cache-clock ±3"];

test("draws each reading in as few cells as says it: the context's share, the model with its effort, the branch", () => {
  const { line, stop } = bar(200, { running: 2 });
  const shown = line();
  stop();
  expect(shown).toContain("◌ 2 running   context 18%   5h 31%   7d 64%   Opus 5.5 xhigh   feat/cache-clock ±3");
});

test("an effort with no model named stands as a reading of its own", () => {
  const { line, stop } = bar(200, { state: { ...state, model: undefined } });
  const shown = line();
  stop();
  expect(shown).toContain("7d 64%   xhigh");
});

test("with another conversation waiting and two things running, keeps what's running at 80 columns, and the model and effort at 120", () => {
  const at = (columns: number) => {
    const { line, stop } = bar(columns, { needsYou: 1, running: 2 });
    const shown = line();
    stop();
    return shown;
  };
  expect(at(80)).toContain("◌ 2 running   context 18%");
  expect(at(80).trimEnd()).toEndWith("7d 64%");
  expect(at(120)).toContain("◌ 2 running   context 18%   5h 31%   7d 64%   Opus 5.5 xhigh");
});

test("readings drop by rank as the bar narrows, are drawn in their own order, and the mode and the count always stay", () => {
  const kept: Record<number, number> = {};
  for (const columns of [50, 60, 70, 80, 90, 100, 120, 140, 200]) {
    const { line, stop } = bar(columns, { needsYou: 1, running: 2 });
    const shown = line();
    stop();
    expect(shown).toStartWith(" ▐ask first▌");
    expect(shown).toContain("← 1 needs you");
    expect(shown.trimEnd().length).toBeLessThanOrEqual(columns);
    // The readings shown are the first ranks, whole: the model and its effort go together.
    const ranks = RANKED.map((words) => words.filter((one) => shown.includes(one)).length);
    const count = ranks.filter((n) => n > 0).length;
    expect(ranks).toEqual(RANKED.map((words, i) => (i < count ? words.length : 0)));
    const at = DRAWN.filter((words) => shown.includes(words)).map((words) => shown.indexOf(words));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    kept[columns] = count;
  }
  // Fewer as it narrows, all of them on a wide screen.
  expect(Object.values(kept)).toEqual(Object.values(kept).sort((a, b) => a - b));
  expect(kept[200]).toBe(RANKED.length);
  expect(kept[80]).toBeGreaterThanOrEqual(2);
});

test("a click on a reading acts on that reading, drawn out of rank order", async () => {
  const clicked: string[] = [];
  const { line, click, stop } = bar(200, { running: 2, onModel: () => clicked.push("model"), onEffort: () => clicked.push("effort") });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const shown = line();
  await click(shown.indexOf("Opus 5.5") + 2);
  await click(shown.indexOf("xhigh") + 2);
  stop();
  expect(clicked).toEqual(["model", "effort"]);
});
