import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSession } from "../src/session";
import { saved, settingsPath } from "../src/settings";
import { App } from "./app";
import { Background, Fleet } from "./fleet";
import { scratchConfig } from "./scratch-config";
import { Store } from "./store";

/** Keys as a terminal sends them. */
const KEYS = { enter: "\r", ctrlL: "\x0c", shiftUp: "\x1b[1;2A", esc: "\x1b", up: "\x1b[A" };

/** What Ctrl+L writes in scrollback: the screen and its scrollback cleared, for the conversation to be written again. */
const CLEARED = "\x1b[2J\x1b[3J\x1b[H";

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

// The settings a key might save, and anything written into Claude Code's folder, go to a scratch folder, never yours.
const config = scratchConfig();
beforeEach(config.start);
afterEach(config.stop);

/** The app in scrollback on a fake terminal, with a session that does nothing but note what it's asked. */
function app() {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  let written = "";
  stdout.on("data", (chunk: Buffer) => {
    written += chunk.toString();
  });
  const store = new Store(process.cwd(), process.cwd());
  const asked: string[] = [];
  const session = new Proxy({} as AgentSession, {
    get: (_, name) => {
      if (name === "knownId" || name === "id" || name === "then") return undefined;
      if (name === "watchMods") return () => () => {};
      return (...args: unknown[]) => {
        asked.push(String(name));
        return Promise.resolve(args[0]);
      };
    },
  });
  // No conversations besides this one, and no background sessions: never the real `claude agents`.
  const ink = render(
    <App
      store={store}
      session={session}
      fullscreen={false}
      onToggleFullscreen={() => {}}
      onAgents={() => {}}
      fleet={new Fleet()}
      backgroundSessions={new Background(async () => [])}
      agentsHint={Promise.resolve(false)}
    />,
    {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  /** Each key on its own, as typed. */
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await settle();
    }
  };
  return { press, store, asked, ink, written: () => written };
}

test("Ctrl+L in scrollback lets a running ! command finish, and Claude hears what it printed", async () => {
  const { press, store, asked, ink, written } = app();
  await settle();
  await press("!sleep 0.3; echo done-here", KEYS.enter, KEYS.ctrlL);
  expect(written()).toContain(CLEARED);
  await settle(800);
  // The command went into the scratch prompt history; the line has to land before the scratch folder goes.
  await store.prompts.written();
  ink.unmount();
  const shell = store.getSnapshot().items.find((item) => item.kind === "shell");
  expect(shell?.status).toBe("done");
  expect(asked).toContain("note");
});

test("Ctrl+L redraws with an overlay open too, where the message box doesn't have the keys", async () => {
  const { press, ink, written } = app();
  await settle();
  await press("/tasks", KEYS.enter);
  expect(stripVTControlCharacters(written())).toContain("Nothing runs alongside the conversation");
  const before = written().length;
  await press(KEYS.ctrlL);
  ink.unmount();
  expect(written().slice(before)).toContain(CLEARED);
});

test("Ctrl+L in scrollback writes the start screen again, at the top of the cleared screen", async () => {
  const { press, store, ink, written } = app();
  store.emit({ kind: "loaded", loaded: { version: "2.1.318" } });
  await settle(300);
  expect(stripVTControlCharacters(written())).toContain("Claude Code 2.1.318 underneath");
  const before = written().length;
  await press(KEYS.ctrlL);
  ink.unmount();
  const after = written().slice(before);
  expect(after).toContain(CLEARED);
  expect(stripVTControlCharacters(after.slice(after.indexOf(CLEARED)))).toContain("Claude Code 2.1.318 underneath");
});

test("Ctrl+L leaves the start screen's sessions as they were listed, without reading them again", async () => {
  const { press, store, ink } = app();
  store.emit({ kind: "loaded", loaded: { version: "2.1.318" } });
  await settle(300);
  const listed = store.getSnapshot().recent;
  expect(listed).toBeDefined();
  await press(KEYS.ctrlL);
  await settle(300);
  ink.unmount();
  expect(store.getSnapshot().recent).toBe(listed);
});

test("Shift+↑ at the top says once, for a moment, that max takes /effort, as claude does", async () => {
  const { press, store, ink, written } = app();
  await settle();
  store.emit({ kind: "effort", effort: "xhigh" });
  await settle();
  await press(KEYS.shiftUp, KEYS.shiftUp, KEYS.shiftUp);
  expect(stripVTControlCharacters(written())).toContain("Shift+↑ stops below max · /effort max to set it");
  expect(store.getSnapshot().items.filter((item) => item.kind === "notice")).toEqual([]);
  const before = written().length;
  await settle(2200);
  ink.unmount();
  expect(stripVTControlCharacters(written().slice(before))).toContain("ask first");
});

test("Shift+↑ steps the effort for this session only, as claude does", async () => {
  const { press, asked, ink } = app();
  await settle();
  await press(KEYS.shiftUp);
  await saved();
  ink.unmount();
  expect(asked).toContain("setEffort");
  expect(existsSync(settingsPath())).toBe(false);
});

test("Esc Esc clears the box into Claude Code's prompt history, where ↑ finds it at once", async () => {
  const { press, store, ink, written } = app();
  await settle();
  await press("draft to keep", KEYS.esc);
  const armed = written().length;
  await press(KEYS.esc);
  // The box has emptied, so the draft drawn next can only be ↑ bringing it back.
  expect(stripVTControlCharacters(written().slice(armed))).not.toContain("draft to keep");
  const cleared = written().length;
  await press(KEYS.up);
  const recalled = stripVTControlCharacters(written().slice(cleared));
  await store.prompts.written();
  ink.unmount();
  expect(recalled).toContain("draft to keep");
  const file = readFileSync(join(config.folder(), "claude", "history.jsonl"), "utf8");
  expect(file).toContain('"display":"draft to keep"');
});

test("/diff in scrollback prints the latest turn's ledger whole at the end, and says so when no turn has ended", async () => {
  const { press, store, ink, written } = app();
  store.emit({ kind: "loaded", loaded: { version: "2.1.318" } });
  await settle(300);
  await press("/diff", KEYS.enter);
  expect(stripVTControlCharacters(written())).toContain("No turn has ended yet.");
  const file = join(process.cwd(), "src/a.ts");
  store.emit({ kind: "prompt", text: "fix it", starts: true });
  store.emit({ kind: "ledger", files: [{ path: file, added: 2, removed: 1 }], commits: [], unseen: [] });
  store.emit({ kind: "sdk", message: { type: "result", subtype: "success", uuid: "r", session_id: "s", duration_ms: 6000, num_turns: 1, is_error: false, result: "done" } as unknown as SDKMessage });
  await settle(300);
  const before = written().length;
  await press("/diff", KEYS.enter);
  await settle(300);
  await store.prompts.written();
  ink.unmount();
  const printed = stripVTControlCharacters(written().slice(before));
  // The closing line again, and under it the file with how it changed, and what it says of its diff.
  expect(printed).toMatch(/6s · 1 file \+2 −1 · not committed/);
  expect(printed).toMatch(/ {4}src\/a\.ts +\+2 −1/);
  expect(printed).toContain("Its diff wasn't kept.");
  expect(store.getSnapshot().items.at(-1)?.kind).toBe("review");
});

test("/diff in scrollback while Claude works says to run it again once Claude is done, and prints nothing into the turn", async () => {
  const { press, store, ink, written } = app();
  store.emit({ kind: "loaded", loaded: { version: "2.1.318" } });
  await settle(300);
  const end = (uuid: string) => store.emit({ kind: "sdk", message: { type: "result", subtype: "success", uuid, session_id: "s", duration_ms: 6000, num_turns: 1, is_error: false, result: "done" } as unknown as SDKMessage });
  store.emit({ kind: "prompt", text: "fix it", starts: true });
  store.emit({ kind: "ledger", files: [{ path: join(process.cwd(), "src/a.ts"), added: 2, removed: 1 }], commits: [], unseen: [] });
  end("r1");
  store.emit({ kind: "prompt", text: "and again", starts: true });
  await settle(300);
  await press("/diff", KEYS.enter);
  await settle(300);
  expect(store.getSnapshot().items.some((item) => item.kind === "review")).toBe(false);
  expect(stripVTControlCharacters(written())).toContain("Run /diff again once it's done");
  end("r2");
  await settle(300);
  await press("/diff", KEYS.enter);
  await settle(300);
  await store.prompts.written();
  ink.unmount();
  expect(store.getSnapshot().items.at(-1)?.kind).toBe("review");
});
