import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { AgentSession } from "../src/session";
import { App } from "./app";
import { Store } from "./store";

/** Keys as a terminal sends them. */
const KEYS = { enter: "\r", ctrlL: "\x0c", shiftUp: "\x1b[1;2A" };

/** What Ctrl+L writes in scrollback: the screen and its scrollback cleared, for the conversation to be written again. */
const CLEARED = "\x1b[2J\x1b[3J\x1b[H";

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

// The settings a key might save go to a folder of the test's own, never yours.
let config = "";
const xdg = process.env.XDG_CONFIG_HOME;
beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), "astrocode-keys-"));
  process.env.XDG_CONFIG_HOME = config;
});
afterEach(async () => {
  if (xdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = xdg;
  await rm(config, { recursive: true, force: true });
});

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
  const ink = render(<App store={store} session={session} fullscreen={false} onToggleFullscreen={() => {}} onAgents={() => {}} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });
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
