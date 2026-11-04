import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { Agent } from "../src/agents";
import type { AgentSession } from "../src/session";
import { initialState, type Item, type State, type ToolCall } from "../src/view/state";
import { App } from "./app";
import { Background, Fleet } from "./fleet";
import { Mouse, MouseContext } from "./mouse";
import { scratchConfig } from "./scratch-config";
import { Store } from "./store";
import { PALETTE, rgb } from "./theme";
import { trueColor } from "./truecolor";

const COLUMNS = 120;
const ROWS = 40;

// What the App might save, settings or prompt history, goes to a scratch folder, never yours. Its
// frames are drawn in true color, so a test can read their colors.
const config = scratchConfig();
const color = trueColor();
let quit: (() => void) | null = null;
beforeEach(() => {
  config.start();
  color.start();
});
afterEach(async () => {
  quit?.();
  quit = null;
  color.stop();
  await config.stop();
});

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

const call = (id: string, more: Partial<ToolCall> = {}): ToolCall => ({ id, name: "Grep", input: { pattern: id, path: "/p/src" }, status: "done", subagentCalls: 0, result: "src/a.ts", ...more });

/** A finished turn: your message, Claude's sentence, its calls, and the reply. */
function turn(more: Partial<State> = {}): State {
  const calls = [call("a"), call("b", { name: "Bash", input: { command: "bun test", description: "Run the tests" }, result: "3 pass" })];
  const items: Item[] = [
    { kind: "prompt", key: "p", text: "look around" },
    { kind: "text", key: "t", text: "Looking around." },
    ...calls.map((one) => ({ kind: "tool" as const, key: one.id, call: one })),
    { kind: "text", key: "r", text: "All quiet in here." },
  ];
  return { ...initialState("/p", "/home/u"), items, tools: { a: 2, b: 3 }, ...more };
}

/**
 * astrocode full screen at 120×40 over `state`, with a session that does nothing and Claude Code's
 * background sessions `agents`. `frame()` is the last frame drawn, a row per line, and `drawn()`
 * the same with its colors.
 */
async function launch(state: State, agents: Agent[] = []) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: COLUMNS, rows: ROWS });
  const writes: string[] = [];
  stdout.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const store = new Store("/p", "/home/u");
  store.getSnapshot = () => state;
  store.subscribe = () => () => {};
  const session = new Proxy({}, { get: (_, key) => (key === "then" || key === "knownId" ? undefined : key === "watchMods" ? () => () => {} : () => Promise.resolve(null)) }) as AgentSession;
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream);
  mouse.start();
  const app = render(
    <MouseContext.Provider value={mouse}>
      <App
        store={store}
        session={session}
        fullscreen
        onToggleFullscreen={() => {}}
        onAgents={() => {}}
        fleet={new Fleet()}
        backgroundSessions={new Background(async () => agents)}
        agentsHint={Promise.resolve(false)}
      />
    </MouseContext.Provider>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false, debug: true },
  );
  quit = () => {
    app.unmount();
    mouse.stop();
  };
  await settle();
  // Each frame is written whole; the mouse writes its own codes between them.
  const drawn = () => writes.findLast((one) => one.split("\n").length >= ROWS - 1) ?? "";
  const frame = () => stripVTControlCharacters(drawn()).split("\n");
  const press = async (keys: string) => {
    stdin.write(keys);
    await settle();
  };
  return { frame, drawn, press };
}

/** The rows from the box's hairline to the bottom of the screen. */
const chrome = (lines: string[]) => lines.slice(lines.findIndex((line) => /^▁{20}/.test(line))).filter((line, i, all) => i < all.length - 1 || line !== "");

test("under the transcript, the box is its hairline and a row, then the status bar, and nothing else", async () => {
  const { frame } = await launch(turn());
  const rows = chrome(frame());
  expect(rows).toHaveLength(3);
  expect(rows[1]).toMatch(/^ ❯/);
});

test("while Claude works, the line that says what it's doing sits right over the box, with no row of its own above it", async () => {
  const { frame } = await launch(turn({ busy: true }));
  const lines = frame();
  const hairline = lines.findIndex((line) => /^▁{20}/.test(line));
  expect(chrome(lines)).toHaveLength(3);
  expect(lines[hairline - 1]).toMatch(/esc to stop/);
  // Above it is the transcript's end, not a row holding a dot.
  expect(lines[hairline - 2]).not.toMatch(/^[⠀-⣿]\s*$/);
});

const GOLD = rgb(PALETTE.gold).join(";");

/**
 * What a frame draws in gold, top to bottom and left to right: each run of characters in gold, or
 * of cells on gold (`█` for a blank one), with its spaces closed up. A hairline of `▁`, however
 * long, is `▁`. Spaces in gold show nothing, so they only join what's on either side.
 */
function goldIn(frame: string) {
  const runs: string[] = [];
  for (const line of frame.split("\n")) {
    let fg = "";
    let bg = "";
    let row = "";
    for (const [, code, text] of line.matchAll(/(\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[A-Za-z])|([^\x1b])/gu)) {
      if (code?.endsWith("m") && code.startsWith("\x1b[")) {
        const params = code.slice(2, -1).split(";");
        for (let i = 0; i < params.length; i++) {
          const n = Number(params[i] || 0);
          if (n === 0) [fg, bg] = ["", ""];
          else if (n === 39) fg = "";
          else if (n === 49) bg = "";
          else if (n === 38 || n === 48) {
            const value = params[i + 1] === "2" ? params.slice(i + 2, i + 5).join(";") : params[i + 2]!;
            if (n === 38) fg = value;
            else bg = value;
            i += params[i + 1] === "2" ? 4 : 2;
          }
        }
      } else if (text !== undefined) row += bg === GOLD ? (text === " " ? "█" : text) : fg === GOLD ? text : "\0";
    }
    for (const run of row.split(/\0+/)) {
      const words = run.replace(/\s+/g, " ").trim();
      if (words) runs.push(/^▁+$/.test(words) ? "▁" : words);
    }
  }
  return runs;
}

/** A turn with a step Claude named, so the step has its mark, then the reply and the turn's ledger. */
function finished(more: Partial<State> = {}): State {
  const state = turn(more);
  state.items.push({ kind: "turn", key: "end", outcome: "finished", durationMs: 6000, tokens: 1200, files: [{ path: "/p/src/a.ts", added: 2, removed: 1 }] });
  return state;
}

/** Another conversation, a background session, waiting on you. */
const elsewhere: Agent = { id: "bg1", name: "other", cwd: "/q", folder: "/q", state: "blocked", status: "waiting", alive: true, createdAt: 0, updatedAt: 0, prs: [] };

test("gold marks only you: your message, where your keys are, and what waits on you, in every mode", async () => {
  for (const mode of ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"] as const) {
    const { drawn } = await launch(finished({ mode }), [elsewhere]);
    // Your message's mark; the box, which has your keys: its hairline, its ❯ and its cursor; and the conversation waiting on you.
    expect({ mode, gold: goldIn(drawn()) }).toEqual({ mode, gold: ["●", "▁", "❯ █", "← 1 needs you"] });
    quit?.();
  }
});

test("with your keys in the transcript, gold is its cursor's ›, and no longer the box's", async () => {
  const { drawn, press } = await launch(finished({ mode: "auto" }), [elsewhere]);
  await press("\x0f");
  expect(goldIn(drawn())).toEqual(["●", "›", "← 1 needs you"]);
});

test("while Claude waits on you, gold is the step and the line that ask, and the decision with your keys", async () => {
  const state = turn({ busy: true });
  const asking = state.items.findIndex((item) => item.kind === "tool" && item.call.name === "Bash");
  const item = state.items[asking]!;
  if (item.kind === "tool") state.items[asking] = { ...item, call: { ...item.call, status: "running", result: undefined } };
  state.pending = [{ id: "b", toolName: "Bash", input: { command: "bun test" }, description: "Run the tests" }];
  state.items = state.items.slice(0, asking + 1);
  const { drawn } = await launch(state);
  await settle(600);
  expect(goldIn(drawn())).toEqual(["●", "●", "Run the tests", "▁", expect.stringMatching(/^waiting \d+s$/), "›"]);
});

test("scrolled away from the end, gold still marks only you: not the scrollbar, nor the pill that says what's below", async () => {
  const items: Item[] = Array.from({ length: 20 }, (_, i): Item[] => [
    { kind: "prompt", key: `p${i}`, text: `question ${i}` },
    { kind: "text", key: `r${i}`, text: `answer ${i}` },
  ]).flat();
  const { frame, drawn, press } = await launch({ ...initialState("/p", "/home/u"), items });
  await press("\x1b[5~");
  // Scrolled: the pill says what's below.
  expect(frame().some((line) => /↓ \d+ more lines/.test(line))).toBe(true);
  expect(goldIn(drawn()).filter((run) => run !== "●")).toEqual(["▁", "❯ █"]);
});
