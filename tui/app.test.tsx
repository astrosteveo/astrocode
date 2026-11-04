import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession } from "../src/session";
import { saved } from "../src/settings";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
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
 * astrocode in full screen on a fake terminal, over `state`, with a session that does nothing and the
 * mouse on. `screen()` is the last frame drawn, a row per line, without its colors; `update()` puts
 * another state in its place.
 */
async function launch(state: State, { columns = 200, rows = 40, follow = false } = {}) {
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
  store.follow = follow;
  /** What the app asked of the session, by method. */
  const asked: string[] = [];
  const session = new Proxy(
    {},
    {
      get: (_, name) =>
        name === "watchMods"
          ? () => () => {}
          : name === "knownId"
            ? undefined
            : () => {
                asked.push(String(name));
                return Promise.resolve(null);
              },
    },
  ) as unknown as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext.Provider value={mouse}>
      <App store={store} session={session} fullscreen onToggleFullscreen={() => {}} onAgents={() => {}} />
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
  return { screen, row, press, click, update, cursor, boxKeys, asked, writes, exited: () => exited };
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

test("Follow Claude docks above the box at 200 columns, not beside the transcript", async () => {
  const state = turn([call("a"), call("b", { name: "Bash", status: "running", input: { command: "sleep 9", description: "Wait a while" } })]);
  const { screen, row } = await launch(state, { follow: true });
  const dock = row(/◉ Following/);
  const line = row(/Waiting +a while/);
  expect(line).toBeGreaterThan(0);
  expect(dock).toBeGreaterThan(line);
  expect(screen()[dock]).not.toMatch(/Waiting +a while/);
  expect(screen()[line]!.trimEnd().length).toBeGreaterThan(190);
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

test("Alt+L with a call opened from the transcript closes it and follows Claude again", async () => {
  const state = turn([call("a"), call("b", { name: "Bash", status: "running", input: { command: "sleep 9", description: "Wait a while" } })]);
  const { press, screen, row, click } = await launch(state, { follow: true });
  expect(row(/◉ Following/)).not.toBe(-1);
  await click(10, row(/Searched +a in src/));
  expect(screen().some((line) => line.includes("‹ 1 of 2 ›"))).toBe(true);
  expect(row(/◉ Following/)).toBe(-1);
  await press("\x1bl");
  expect(screen().some((line) => line.includes("‹ 1 of 2 ›"))).toBe(false);
  expect(row(/◉ Following/)).not.toBe(-1);
  expect(row(/Following Claude again/)).not.toBe(-1);
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
