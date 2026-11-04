import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { Agent } from "../src/agents";
import type { AgentSession } from "../src/session";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
import { Background, Fleet } from "./fleet";
import { Mouse, MouseContext, MULTI_CLICK_MS } from "./mouse";
import { scratchConfig } from "./scratch-config";
import { Store } from "./store";

/** What the terminal is told on the way into the alternate screen and back out to the scrollback. */
const ENTER = "\x1b[?1049h";
const LEAVE = "\x1b[?1049l";
/** What clears the scrollback itself, which the viewer must never do. */
const CLEAR_SCROLLBACK = "\x1b[3J";
const MOUSE_ON = "\x1b[?1000h";
const MOUSE_OFF = "\x1b[?1000l";

const KEYS = { ctrlO: "\x0f", esc: "\x1b", enter: "\r", up: "\x1b[A", down: "\x1b[B", ctrlL: "\x0c", ctrlD: "\x04" };

const call = (id: string, more: Partial<ToolCall> = {}): ToolCall => ({ id, name: "Grep", input: { pattern: id, path: "/p/src" }, status: "done", subagentCalls: 0, result: "src/a.ts", ...more });

/** A finished turn: your message, Claude's sentence, three calls, a reply, and the line that closes it with what it changed and its tokens. */
function finished(): State {
  const calls = [call("a"), call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, result: "3 pass" }), call("c")];
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "look around" },
    { kind: "text", key: "t", text: "Looking around." },
    ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one })),
    { kind: "text", key: "r", text: "All quiet in here." },
    { kind: "turn", key: "end", outcome: "finished", durationMs: 6000, tokens: 1200, files: [{ path: "/p/src/a.ts", added: 2, removed: 1 }], commands: ["bun test"] },
  ];
  return {
    ...initialState("/p", "/home/u"),
    // All the start screen says is known, so scrollback writes it, and the conversation after it.
    loaded: { version: "2.1.318" },
    recent: [],
    items,
    tools: Object.fromEntries(calls.map((one, i) => [one.id, i + 2])),
  };
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

// Keys here can save settings, so every test gets a scratch config folder in place of yours.
const config = scratchConfig();
let quit: (() => void) | null = null;
beforeEach(config.start);
afterEach(async () => {
  quit?.();
  quit = null;
  await config.stop();
});

/**
 * astrocode in scrollback on a fake terminal, over `state`, as a real terminal gets it: each frame
 * drawn over the one before rather than written whole, and the mouse there for the viewer to turn
 * on, with Follow Claude on or off, kitty's keyboard protocol if asked, and background sessions
 * that may wait on you. Opening the agents view stops it, as it does in the terminal. `out()` is
 * everything written, escape codes and all.
 */
async function scrollback(state: State, { columns = 120, rows = 30, follow = false, kitty = false, agents = [] as Agent[] } = {}) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns, rows });
  const writes: string[] = [];
  stdout.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const store = new Store("/p", "/home/u");
  store.follow = follow;
  let current = state;
  const listeners = new Set<() => void>();
  store.getSnapshot = () => current;
  store.subscribe = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const session = new Proxy({}, { get: (_, name) => (name === "watchMods" ? () => () => {} : name === "knownId" ? undefined : () => Promise.resolve(null)) }) as unknown as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  const app = render(
    <MouseContext.Provider value={mouse}>
      {/* No conversations besides this one, and only the background sessions given: never the real `claude agents`. */}
      <App
        store={store}
        session={session}
        fullscreen={false}
        onToggleFullscreen={() => {}}
        onAgents={() => {
          app.clear();
          app.unmount();
        }}
        fleet={new Fleet()}
        backgroundSessions={new Background(async () => agents)}
        agentsHint={Promise.resolve(false)}
      />
    </MouseContext.Provider>,
    // Interactive even where a CI variable is set, since Ink hands the terminal over only then.
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
      ...(kitty ? { kittyKeyboard: { mode: "enabled" as const } } : {}),
    },
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
  const out = () => writes.join("");
  /** The viewer's last frame, a row per line, without its colors: the last write that fills the screen. */
  const screen = () => stripVTControlCharacters(writes.findLast((one) => one.split("\n").length >= rows - 1) ?? "").split("\n");
  const row = (text: RegExp) => screen().findIndex((line) => text.test(line));
  const press = async (keys: string) => {
    stdin.write(keys);
    await settle();
  };
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
  return { out, screen, row, press, click, update, exited: () => exited };
}

/** What went into the scrollback: everything written outside the alternate screen, without colors. */
function scrollbackOf(out: string) {
  let kept = "";
  let at = 0;
  for (;;) {
    const enter = out.indexOf(ENTER, at);
    kept += out.slice(at, enter === -1 ? undefined : enter);
    if (enter === -1) break;
    const leave = out.indexOf(LEAVE, enter);
    if (leave === -1) break;
    at = leave + LEAVE.length;
  }
  return stripVTControlCharacters(kept);
}

const count = (text: string, part: string) => text.split(part).length - 1;

for (const [name, key] of [
  ["Esc", KEYS.esc],
  ["q", "q"],
  ["Ctrl+O", KEYS.ctrlO],
] as const) {
  test(`Ctrl+O in scrollback opens the transcript on the alternate screen, and ${name} leaves the scrollback as it was`, async () => {
    const { out, press, screen } = await scrollback(finished());
    const before = out();
    expect(count(stripVTControlCharacters(before), "All quiet in here.")).toBe(1);
    expect(before).not.toContain(ENTER);
    await press(KEYS.ctrlO);
    const opened = out().slice(before.length);
    expect(opened).toContain(ENTER);
    // The viewer draws the whole conversation, with the cursor on its last line, the turn's closing line.
    expect(screen().join("\n")).toContain("All quiet in here.");
    expect(screen().find((line) => line.includes("6s · 1 file +2 −1"))?.[1]).toBe("›");
    await press(key);
    const after = out().slice(before.length);
    expect(after.indexOf(LEAVE)).toBeGreaterThan(after.indexOf(ENTER));
    // Nothing cleared the scrollback, and nothing of the conversation was written into it again.
    expect(out()).not.toContain(CLEAR_SCROLLBACK);
    expect(count(scrollbackOf(out()), "All quiet in here.")).toBe(1);
    expect(count(scrollbackOf(out()), "look around")).toBe(1);
    // The message box is drawn again under it, back in the scrollback.
    expect(stripVTControlCharacters(after.slice(after.lastIndexOf(LEAVE)))).toContain("❯");
  });
}

test("what's typed in the box is still there in the viewer, and after it", async () => {
  const { out, press, screen } = await scrollback(finished());
  await press("draft kept");
  await press(KEYS.ctrlO);
  expect(screen().find((line) => line.startsWith(" ❯"))).toContain("draft kept");
  await press(KEYS.esc);
  const after = out().slice(out().lastIndexOf(LEAVE));
  expect(stripVTControlCharacters(after)).toContain("❯ draft kept");
});

test("what settles while the viewer is open goes into the scrollback once it closes, and not before", async () => {
  const { out, press, update, row } = await scrollback(finished());
  await press(KEYS.ctrlO);
  const state = finished();
  await update({ ...state, items: [...state.items, { kind: "notice", key: "n", tone: "info", text: "Background command finished: sleep 9" }] });
  // The viewer shows it at once, and the scrollback doesn't have it yet.
  expect(row(/Background command finished/)).not.toBe(-1);
  expect(scrollbackOf(out())).not.toContain("Background command finished");
  await press(KEYS.esc);
  expect(count(scrollbackOf(out()), "Background command finished: sleep 9")).toBe(1);
  expect(count(scrollbackOf(out()), "All quiet in here.")).toBe(1);
});

test("the viewer has full screen's cursor: Enter on the turn's closing line opens its ledger, and Enter on a file there its diff", async () => {
  const { press, screen, row } = await scrollback(finished());
  await press(KEYS.ctrlO);
  // The cursor's `›` stands in the rail, or under the closing line where the ledger's rows start.
  const cursor = () => screen().findIndex((line) => /^(?:.| {3})›/u.test(line));
  expect(cursor()).toBe(row(/6s · 1 file \+2 −1/));
  await press(KEYS.enter);
  // The ledger, as full screen opens it: the file and how it changed, the command the turn ran, its tokens.
  expect(row(/^ {4}src\/a\.ts +\+2 −1/)).toBe(cursor() + 1);
  expect(row(/^ {4}bun test/)).toBeGreaterThan(cursor());
  expect(row(/^ {4}1\.2k tokens/)).toBeGreaterThan(cursor());
  // The closing line holds still as the ledger opens under it, so ↓ goes to the file, where Enter opens its diff.
  await press(KEYS.down);
  expect(cursor()).toBe(row(/src\/a\.ts +\+2 −1/));
  await press(KEYS.enter);
  expect(row(/Its diff wasn't kept\./)).toBeGreaterThan(cursor());
  // Esc closes the diff, then the ledger, as in full screen.
  await press(KEYS.esc);
  expect(row(/Its diff wasn't kept/)).toBe(-1);
  expect(row(/src\/a\.ts +\+2 −1/)).not.toBe(-1);
  await press(KEYS.esc);
  expect(row(/src\/a\.ts +\+2 −1/)).toBe(-1);
  // ↑ goes back over the reply to the calls, where Enter opens one under its line.
  for (let i = 0; i < 2; i++) await press(KEYS.up);
  expect(cursor()).toBe(row(/Searched +c in src/));
  await press(KEYS.enter);
  expect(screen()[row(/Searched +c in src/) + 1]).toContain("‹ 3 of 3 ›");
});

test("/diff in scrollback opens the viewer on the latest turn's ledger, with the cursor on its line, as in full screen", async () => {
  const { out, press, screen, row } = await scrollback(finished());
  const before = out();
  await press("/diff");
  await press(KEYS.enter);
  expect(out().slice(before.length)).toContain(ENTER);
  const cursor = () => screen().findIndex((line) => /^(?:.| {3})›/u.test(line));
  expect(cursor()).toBe(row(/6s · 1 file \+2 −1/));
  expect(row(/^ {4}src\/a\.ts +\+2 −1/)).toBe(cursor() + 1);
  // Esc closes the ledger, and again goes back to the scrollback, where nothing of the ledger was written.
  await press(KEYS.esc);
  await press(KEYS.esc);
  expect(out().lastIndexOf(LEAVE)).toBeGreaterThan(out().lastIndexOf(ENTER));
  expect(scrollbackOf(out())).not.toContain("1.2k tokens");
  expect(count(scrollbackOf(out()), "6s · 1 file +2 −1")).toBe(1);
});

test("Ctrl+O after the viewer /diff opened has closed puts the cursor on the last line, not back on that ledger", async () => {
  const { press, screen, row, update } = await scrollback(finished());
  await press("/diff");
  await press(KEYS.enter);
  await press("q");
  const state = finished();
  const more: Item[] = [
    { kind: "prompt", key: "p2", text: "and again" },
    { kind: "text", key: "r2", text: "Still quiet." },
    { kind: "turn", key: "end2", outcome: "finished", durationMs: 3000, tokens: 0 },
  ];
  await update({ ...state, items: [...state.items, ...more] });
  await press(KEYS.ctrlO);
  const cursor = () => screen().findIndex((line) => /^(?:.| {3})›/u.test(line));
  expect(cursor()).toBe(row(/─ 3s\b/));
});

test("? on a call opened in the viewer lists full screen's keys for it, then the transcript's and the mouse", async () => {
  const { press, screen } = await scrollback(finished());
  await press(KEYS.ctrlO);
  // ↑ over the reply to the last call, which Enter opens under its line.
  for (let i = 0; i < 2; i++) await press(KEYS.up);
  await press(KEYS.enter);
  await press("?");
  const sheet = screen().join("\n");
  expect(sheet).toContain("In an opened call");
  expect(sheet).toMatch(/e +the tab in \$EDITOR/);
  expect(sheet).toContain("In the transcript");
  expect(sheet).toContain("Mouse");
  // Not the keys of scrollback's inspector, which the viewer retired.
  expect(sheet).not.toContain("that tab");
  expect(sheet).not.toContain("In the box");
});

test("the key sheet over a call opened in the viewer leaves it on the tab you chose", async () => {
  const { press, screen } = await scrollback(finished());
  // The opened call's row of tabs, where the one it shows is set apart.
  const tab = () => screen().find((line) => /Results/.test(line))?.match(/▐([^▌]+)▌/)?.[1];
  await press(KEYS.ctrlO);
  for (let i = 0; i < 2; i++) await press(KEYS.up);
  await press(KEYS.enter);
  const first = tab();
  await press("\t");
  const chosen = tab();
  expect(chosen).toBeDefined();
  expect(chosen).not.toBe(first);
  await press("?");
  await press(KEYS.esc);
  expect(tab()).toBe(chosen);
});

test("? on a permission prompt in the viewer lists what scrolls the conversation above it, and the mouse, as in full screen", async () => {
  const { press, screen, update } = await scrollback(finished());
  await press(KEYS.ctrlO);
  await update({ ...finished(), pending: [{ id: "c", toolName: "Bash", input: { command: "rm -rf build" } }] });
  await press("?");
  const sheet = screen().join("\n");
  expect(sheet).toContain("In a permission prompt");
  expect(sheet).toMatch(/pgup, pgdn +a page/);
  expect(sheet).toMatch(/wheel +scroll/);
});

test("at 80×24 a decision in the viewer fits under the line that asks, with No, Esc to cancel and the status bar in view, as in full screen", async () => {
  const wide = Array.from({ length: 40 }, (_, i) => `  const value${i} = compute(${i}); // a fairly long line of code that wraps at eighty columns`).join("\n");
  const write = { file_path: "/p/src/wide.ts", content: wide };
  const state = finished();
  const asking: State = {
    ...state,
    busy: true,
    items: [...state.items, { kind: "prompt", key: "p2", text: "write it" }, { kind: "tool", key: "x", call: call("x", { name: "Write", input: write, status: "running" }) }],
    tools: { ...state.tools, x: state.items.length + 1 },
  };
  const { out, press, screen, row, update } = await scrollback(asking, { columns: 80, rows: 24 });
  await press(KEYS.ctrlO);
  expect(out()).toContain(ENTER);
  await update({ ...asking, pending: [{ id: "x", toolName: "Write", input: write }] });
  const edge = row(/^▁+$/);
  expect(edge).toBeGreaterThan(0);
  expect(screen().slice(0, edge).some((line) => /Write\s+src\/wide\.ts/.test(line))).toBe(true);
  expect(screen().length).toBeLessThanOrEqual(24);
  expect(row(/ \d {2}No\b/)).toBeGreaterThan(edge);
  expect(row(/Esc to cancel/)).toBeGreaterThan(edge);
  // The status bar is the last row, under the decision.
  expect(screen().at(-1)).toMatch(/ask first|auto|default/i);
});

test("the mouse works in the viewer, and goes back to the terminal with the scrollback", async () => {
  const { out, press, click, row, screen } = await scrollback(finished());
  expect(out()).not.toContain(MOUSE_ON);
  await press(KEYS.ctrlO);
  expect(out().indexOf(MOUSE_ON)).toBeGreaterThan(out().indexOf(ENTER));
  // A click on a call's line opens it under the line, as Enter does.
  await click(10, row(/Ran +the tests/));
  expect(screen()[row(/Ran +the tests/) + 1]).toContain("‹ 2 of 3 ›");
  await press(KEYS.esc);
  await press(KEYS.esc);
  expect(out().lastIndexOf(MOUSE_OFF)).toBeGreaterThan(out().lastIndexOf(MOUSE_ON));
  expect(out().lastIndexOf(LEAVE)).toBeGreaterThan(out().lastIndexOf(MOUSE_ON));
});

test("Ctrl+O with nothing in the conversation leaves the screen alone", async () => {
  const { out, press } = await scrollback({ ...initialState("/p", "/home/u"), loaded: { version: "2.1.318" }, recent: [] });
  await press(KEYS.ctrlO);
  expect(out()).not.toContain(ENTER);
});

test("Ctrl+L in the viewer draws it again without clearing the scrollback", async () => {
  const { out, press, screen } = await scrollback(finished());
  await press(KEYS.ctrlO);
  const before = out().length;
  await press(KEYS.ctrlL);
  expect(out().slice(before)).toContain("\x1b[2J");
  expect(out()).not.toContain(CLEAR_SCROLLBACK);
  expect(screen().join("\n")).toContain("All quiet in here.");
});

test("exiting from the viewer goes back to the scrollback first, with what settled meanwhile written there", async () => {
  const { out, press, update, exited } = await scrollback(finished());
  await press(KEYS.ctrlO);
  const state = finished();
  await update({ ...state, items: [...state.items, { kind: "notice", key: "n", tone: "info", text: "Compacted: 142k tokens to 18k" }] });
  await press(KEYS.ctrlD);
  await press(KEYS.ctrlD);
  expect(exited()).toBe(true);
  expect(out().lastIndexOf(LEAVE)).toBeGreaterThan(out().lastIndexOf(ENTER));
  expect(count(scrollbackOf(out()), "Compacted: 142k tokens to 18k")).toBe(1);
});

test("/ in the viewer finds as claude's does: Enter closes the bar on the match, and n goes on to the next one", async () => {
  const { press, screen, row } = await scrollback(finished());
  await press(KEYS.ctrlO);
  const cursor = () => screen().findIndex((line) => [...line][1] === "›");
  await press("/");
  await press("Searched");
  await press(KEYS.enter);
  expect(row(/Find /)).toBe(-1);
  expect(cursor()).toBe(row(/Searched +c in src/));
  await press("n");
  expect(cursor()).toBe(row(/Searched +a in src/));
});

test("leaving the viewer with a call open closes the call, so Follow Claude goes on in the scrollback", async () => {
  const { out, press } = await scrollback(finished(), { follow: true });
  await press(KEYS.ctrlO);
  await press(KEYS.up);
  await press(KEYS.up);
  await press(KEYS.enter);
  await press("q");
  const after = stripVTControlCharacters(out().slice(out().lastIndexOf(LEAVE)));
  expect(after).toContain("◉ Following");
  expect(after).not.toContain("following paused");
});

/** The keyboard modes kitty is told to push and pop, and the switches between screens, in order. */
const switches = (out: string) => [...out.matchAll(/\x1b\[\?1049[hl]|\x1b\[<u|\x1b\[>\d+u/g)].map((match) => match[0]);

/** Another conversation, in the background, that waits on you. */
const waiting: Agent = { id: "b1", name: "other", cwd: "/q", folder: "/q", state: "blocked", alive: true, status: "waiting", createdAt: 0, updatedAt: 0, prs: [] };

test("kitty's keyboard modes stay balanced on each screen, through the viewer and as the agents view takes over from it", async () => {
  const { out, press, click, screen, exited } = await scrollback(finished(), { kitty: true, agents: [waiting] });
  await press(KEYS.ctrlO);
  await press(KEYS.esc);
  expect(switches(out())).toEqual(["\x1b[>1u", "\x1b[<u", ENTER, "\x1b[>1u", "\x1b[<u", LEAVE, "\x1b[>1u"]);
  await press(KEYS.ctrlO);
  const before = out().length;
  const bar = screen().findIndex((line) => line.includes("← 1 needs you"));
  await click(screen()[bar]!.indexOf("← 1 needs you") + 4, bar);
  await settle();
  expect(exited()).toBe(true);
  // The viewer closes first: the alternate screen pops what it pushed, and the scrollback's screen what it did.
  expect(switches(out().slice(before))).toEqual(["\x1b[<u", LEAVE, "\x1b[>1u", "\x1b[<u"]);
});

test("an editor opened from the viewer gets the scrollback's screen, and the viewer comes back after it", async () => {
  const kept = mkdtempSync(join(tmpdir(), "astrocode-viewer-"));
  const visual = process.env.VISUAL;
  // The editor borrows the test's own stdin, which isn't a terminal; it waits to be let go, so what's on screen meanwhile can be seen.
  const setRawMode = process.stdin.setRawMode;
  process.stdin.setRawMode = (() => process.stdin) as typeof process.stdin.setRawMode;
  process.env.VISUAL = `sh -c 'cp "$1" ${kept}/seen; while [ -d ${kept} ] && [ ! -e ${kept}/go ]; do sleep 0.05; done' sh`;
  try {
    const { out, press, screen } = await scrollback(finished());
    await press(KEYS.ctrlO);
    const opened = out().length;
    await press("v");
    for (let i = 0; i < 50 && !existsSync(join(kept, "seen")); i++) await settle(100);
    expect(readFileSync(join(kept, "seen"), "utf8")).toContain("All quiet in here.");
    // While the editor runs, the terminal is on the scrollback's screen.
    const during = out().slice(opened);
    expect(during.lastIndexOf(LEAVE)).toBeGreaterThan(during.lastIndexOf(ENTER));
    writeFileSync(join(kept, "go"), "");
    for (let i = 0; i < 50 && out().lastIndexOf(ENTER) < opened + during.length; i++) await settle(100);
    await settle();
    const after = out().slice(opened);
    expect(after.lastIndexOf(ENTER)).toBeGreaterThan(after.lastIndexOf(LEAVE));
    expect(screen().join("\n")).toContain("All quiet in here.");
    expect(count(scrollbackOf(out()), "All quiet in here.")).toBe(1);
  } finally {
    process.stdin.setRawMode = setRawMode;
    if (visual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = visual;
    rmSync(kept, { recursive: true, force: true });
  }
});
