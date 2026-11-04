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
const KEYS = { enter: "\r", ctrlL: "\x0c", ctrlO: "\x0f", shiftUp: "\x1b[1;2A", esc: "\x1b", up: "\x1b[A", pgDn: "\x1b[6~", tab: "\t" };

/** What Ctrl+L writes in scrollback: the screen and its scrollback cleared, for the conversation to be written again. */
const CLEARED = "\x1b[2J\x1b[3J\x1b[H";

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

// The settings a key might save, and anything written into Claude Code's folder, go to a scratch folder, never yours.
const config = scratchConfig();
beforeEach(config.start);
afterEach(config.stop);

/** The app in scrollback, or full screen, on a fake terminal, with a session that does nothing but note what it's asked. */
function app({ fullscreen = false } = {}) {
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
      fullscreen={fullscreen}
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

test("/diff in scrollback says so when no turn has ended yet", async () => {
  const { press, store, ink, written } = app();
  store.emit({ kind: "loaded", loaded: { version: "2.1.318" } });
  await settle(300);
  await press("/diff", KEYS.enter);
  await store.prompts.written();
  ink.unmount();
  expect(stripVTControlCharacters(written())).toContain("No turn has ended yet.");
});

test("/help shows the key sheet in scrollback too, with Ctrl+O's transcript and without full screen's mouse", async () => {
  const { press, store, ink, written } = app();
  await settle();
  // The sheet is taller than 30 rows; typing filters it to the row.
  await press("/help", KEYS.enter, "transcript");
  // /help went into the scratch prompt history; the line has to land before the scratch folder goes.
  await store.prompts.written();
  ink.unmount();
  const sheet = stripVTControlCharacters(written());
  expect(sheet).toContain("In the box");
  expect(sheet).toMatch(/ctrl\+o +transcript/);
  expect(sheet).not.toContain("click a line");
});

/** Claude Code's guess at your next message, as the SDK sends it after a turn's result. */
const suggested = (text: string) => ({ kind: "sdk", message: { type: "prompt_suggestion", suggestion: text, uuid: "g", session_id: "s" } as unknown as SDKMessage }) as const;

test("Claude Code's suggested next message reaches the empty box, where Tab takes it and Enter sends it", async () => {
  const { press, store, asked, ink, written } = app();
  await settle();
  const before = written().length;
  store.emit(suggested("next one adds two numbers"));
  await settle();
  expect(stripVTControlCharacters(written().slice(before))).toContain("next one adds two numbers");
  await press(KEYS.tab, KEYS.enter);
  await store.prompts.written();
  ink.unmount();
  expect(asked).toContain("send");
});

test("anything you send uses up the suggestion, a command astrocode runs itself too, as in claude", async () => {
  const { press, store, ink, written } = app();
  await settle();
  store.emit(suggested("next one adds two numbers"));
  await settle();
  const before = written().length;
  await press("/help", KEYS.enter);
  // /help opens the key sheet, and Esc closing it shows the box again, empty.
  expect(stripVTControlCharacters(written().slice(before))).toContain("In the box");
  await press(KEYS.esc);
  await store.prompts.written();
  ink.unmount();
  expect(store.getSnapshot().nextPrompt).toBeUndefined();
  expect(stripVTControlCharacters(written().slice(before))).not.toContain("next one adds two numbers");
});

for (const fullscreen of [true, false]) {
  test(`/diff in ${fullscreen ? "full screen" : "scrollback"} keeps the suggestion, for Esc to give the box back with it, as the spec's review of a turn goes`, async () => {
    const { press, store, ink, written } = app({ fullscreen });
    await settle();
    store.emit({ kind: "prompt", text: "fix it", starts: true });
    store.emit({ kind: "ledger", files: [{ path: join(process.cwd(), "src/a.ts"), added: 2, removed: 1 }], commits: [], unseen: [] });
    store.emit({ kind: "sdk", message: { type: "result", subtype: "success", uuid: "r", session_id: "s", duration_ms: 6000, num_turns: 1, is_error: false, result: "done" } as unknown as SDKMessage });
    store.emit(suggested("merge it"));
    await settle(300);
    await press("/diff", KEYS.enter);
    // Esc closes the ledger, and Esc again gives the box back.
    await press(KEYS.esc);
    const before = written().length;
    await press(KEYS.esc);
    await store.prompts.written();
    ink.unmount();
    expect(store.getSnapshot().nextPrompt).toBe("merge it");
    expect(stripVTControlCharacters(written().slice(before))).toMatch(/merge it +tab to use/);
  });
}
