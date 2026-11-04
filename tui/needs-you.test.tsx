import { expect, test } from "bun:test";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession } from "../src/session";
import { App } from "./app";
import { Fleet } from "./fleet";
import { Mouse, MouseContext } from "./mouse";
import { Store } from "./store";

const ROWS = 30;
const COLUMNS = 100;

/** A session that does nothing, so the App can be drawn without Claude Code. */
const session = new Proxy({}, { get: (_, key) => (key === "then" ? undefined : key === "watchMods" ? () => () => {} : () => Promise.resolve()) }) as AgentSession;

/**
 * The App full screen on a fake terminal, as the conversation `here` in a fleet with `other`, with
 * how often it asked for the conversations, keys to type and a mouse to click with.
 */
function conversation({ hint = false } = {}) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: COLUMNS, rows: ROWS });
  let drawn = "";
  stdout.on("data", (chunk: Buffer) => {
    drawn += chunk.toString();
  });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const mouse = new Mouse(stdin as unknown as NodeJS.ReadStream, { write: () => true } as unknown as NodeJS.WriteStream);
  mouse.start();
  const fleet = new Fleet();
  const here = fleet.add({ key: "astrocode-1", store: new Store("/nonexistent/here", "/nonexistent"), session: { knownId: undefined }, cwd: "/nonexistent/here" });
  const other = fleet.add({ key: "astrocode-2", store: new Store("/nonexistent/other", "/nonexistent"), session: { knownId: undefined }, cwd: "/nonexistent/other" });
  const opened = { agents: 0 };
  const app = render(
    <MouseContext value={mouse}>
      <App
        store={here.store}
        session={session}
        fullscreen
        onToggleFullscreen={() => {}}
        onAgents={() => (opened.agents += 1)}
        fleet={fleet}
        agentsHint={Promise.resolve(hint)}
      />
    </MouseContext>,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  /** The last frame's rows. */
  const frame = () => stripVTControlCharacters(drawn).split("\n").slice(-ROWS);
  const statusBar = () => frame().findLast((line) => line.trim()) ?? "";
  /** A left click on the status bar, at the start of `words` in it. */
  const clickOn = async (words: string) => {
    const x = statusBar().indexOf(words);
    expect(x).toBeGreaterThanOrEqual(0);
    const y = frame().findLastIndex((line) => line.trim());
    stdin.write(`\x1b[<0;${x + 2};${y + 1}M\x1b[<0;${x + 2};${y + 1}m`);
    await settle();
  };
  const type = async (keys: string) => {
    stdin.write(keys);
    await settle();
  };
  return { here, other, opened, frame, statusBar, clickOn, type, stop: () => (app.unmount(), mouse.stop()) };
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

test("a click on ← N needs you opens the conversations only when ← would, so nothing typed is lost", async () => {
  const { other, here, opened, clickOn, type, frame, stop } = conversation();
  try {
    other.store.emit({ kind: "permission", request: { id: "p1", toolName: "Bash", input: { command: "rm -rf dist" } } });
    await settle();
    await type("half-written message I care about");
    await clickOn("← 1 needs you");
    expect(opened.agents).toBe(0);
    expect(frame().join("\n")).toContain("half-written message I care about");
    // Emptied, the box lets it go, as ← does.
    await type("\x15");
    await clickOn("← 1 needs you");
    expect(opened.agents).toBe(1);
    // A question of this conversation's own has the keys, so ← goes to it, and the click waits too.
    here.store.emit({ kind: "question", request: { id: "q1", questions: [{ question: "Tea or coffee?", header: "Drink", multiSelect: false, options: [{ label: "Tea", description: "" }, { label: "Coffee", description: "" }] }] } });
    await settle();
    await clickOn("← 1 needs you");
    expect(opened.agents).toBe(1);
  } finally {
    stop();
  }
});

test("the status bar's count follows the other conversations as they start and stop waiting on you", async () => {
  const { other, statusBar, stop } = conversation();
  try {
    await settle();
    expect(statusBar()).not.toContain("need");
    other.store.emit({ kind: "permission", request: { id: "p1", toolName: "Bash", input: { command: "rm -rf dist" } } });
    await settle();
    expect(statusBar()).toContain("← 1 needs you");
    other.store.emit({ kind: "question", request: { id: "q1", questions: [] } });
    other.store.emit({ kind: "resolved", id: "p1", outcome: "allow" });
    await settle();
    expect(statusBar()).toContain("← 1 needs you");
    other.store.emit({ kind: "resolved", id: "q1", outcome: "allow" });
    await settle();
    expect(statusBar()).not.toContain("need");
  } finally {
    stop();
  }
});

test("the empty, idle box says ← for conversations until they've been opened, and gives way while Claude works or waits on you", async () => {
  const unseen = conversation({ hint: true });
  const seen = conversation({ hint: false });
  try {
    await settle();
    const box = (frame: string[]) => frame.find((line) => line.includes("❯")) ?? "";
    expect(box(unseen.frame())).toContain("← for conversations");
    expect(box(seen.frame())).not.toContain("←");
    unseen.here.store.emit({ kind: "prompt", text: "run ls" });
    await settle();
    expect(box(unseen.frame())).toContain("Claude is working");
    expect(unseen.frame().join("\n")).not.toContain("← for conversations");
    unseen.here.store.emit({ kind: "permission", request: { id: "p1", toolName: "Bash", input: { command: "ls" } } });
    await settle();
    expect(box(unseen.frame())).toContain("waiting for your OK");
  } finally {
    unseen.stop();
    seen.stop();
  }
});
