import { afterAll, beforeAll, expect, test } from "bun:test";
import { render } from "ink";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import type { SessionSettings } from "../src/agents";
import { installedBinary } from "../src/claude";
import { loadSettings, remember } from "../src/settings";
import { AgentsView, othersListed } from "./agents";
import { Fleet } from "./fleet";
import { Store } from "./store";

// A stand-in `claude` on PATH: `agents --json` lists two background sessions in another project and one in a third,
// and `--bg` says where it was started instead of starting one.
const root = mkdtempSync(join(tmpdir(), "astrocode-agents-"));
const here = join(root, "here");
const other = join(root, "other");
const third = join(root, "third");
const dispatched = join(root, "dispatched");
/** What the stand-in's `agents --json` prints. */
const listed = join(root, "listed.json");
const saved = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };

beforeAll(() => {
  for (const folder of [here, other, third, join(root, "bin")]) mkdirSync(folder);
  const list = JSON.stringify([
    { id: "0a1b2c3d", cwd: other, kind: "background", startedAt: 1, state: "done", name: "older" },
    { id: "1a1b2c3d", cwd: other, kind: "background", startedAt: 2, state: "done", name: "newer" },
    { id: "2a1b2c3d", cwd: third, kind: "background", startedAt: 3, state: "done", name: "elsewhere" },
  ]);
  writeFileSync(listed, list);
  const claude = join(root, "bin", "claude");
  writeFileSync(claude, `#!/bin/sh\nif [ "$1" = "--bg" ]; then pwd > '${dispatched}'; echo 'backgrounded · 9f8e7d6c · task'; exit 0; fi\ncat '${listed}'\n`);
  chmodSync(claude, 0o755);
  process.env.PATH = `${join(root, "bin")}:${process.env.PATH}`;
  process.env.CLAUDE_CONFIG_DIR = root;
  // Never let these tests start a real background session.
  if (installedBinary() !== claude) throw new Error(`The stand-in claude isn't the one found: ${installedBinary()}`);
});

afterAll(() => {
  process.env.PATH = saved.PATH;
  if (saved.CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = saved.CLAUDE_CONFIG_DIR;
  rmSync(root, { recursive: true, force: true });
});

/** The agents view on a fake terminal, over a fleet of stand-in conversations, with what it was asked to do. */
function view(options: { here?: string; mine?: string[]; settings?: SessionSettings } = {}) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 });
  let screen = "";
  stdout.on("data", (chunk: Buffer) => {
    screen += chunk.toString();
  });
  const fleet = new Fleet();
  /** A conversation in astrocode, as `onStart` would start: in `cwd`, working on `task`. */
  const add = (task: string, cwd: string) => {
    const store = new Store(cwd, root);
    store.emit({ kind: "prompt", text: task });
    return fleet.add({ key: `astrocode-${fleet.getSnapshot().length + 1}`, store, session: { knownId: undefined }, cwd });
  };
  for (const task of options.mine ?? []) add(task, here);
  const started: { task: string; cwd: string }[] = [];
  const shownKeys: string[] = [];
  const stopped: string[] = [];
  const app = render(
    <AgentsView
      fleet={fleet}
      here={options.here}
      cwd={here}
      home={root}
      settings={options.settings ?? {}}
      onShow={(key) => shownKeys.push(key)}
      onOpen={async () => {}}
      onStart={async (task, cwd) => {
        started.push({ task, cwd });
        return add(task, cwd).key;
      }}
      onStop={(key) => {
        stopped.push(key);
        const conversation = fleet.get(key);
        if (conversation) fleet.remove(conversation);
      }}
      onExit={async () => {}}
    />,
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false, patchConsole: false },
  );
  return { press: (keys: string) => stdin.write(keys), started, shown: shownKeys, stopped, fleet, app, screen: () => stripVTControlCharacters(screen) };
}

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

test("Enter starts the task in astrocode and stays in the view, so another can start alongside it", async () => {
  const { press, started, shown, fleet, app, screen } = view();
  // The list is read before the row it chooses is known.
  await settle(500);
  press("fix the build");
  await settle();
  press("\r");
  await settle();
  press("add the tests");
  await settle();
  press("\r");
  await settle(500);
  app.unmount();
  expect(started).toEqual([
    { task: "fix the build", cwd: other },
    { task: "add the tests", cwd: other },
  ]);
  expect(shown).toEqual([]);
  expect(fleet.getSnapshot().map((one) => one.cwd)).toEqual([other, other]);
  expect(existsSync(dispatched)).toBe(false);
  const last = screen().split("Conversations").at(-1) ?? "";
  expect(last).toContain("2 working");
  expect(last).toContain("fix the build");
  expect(last).toContain("add the tests");
});

test("Ctrl+Enter starts the task in astrocode, in the chosen row's project, and opens it", async () => {
  const { press, started, shown, app } = view();
  await settle(500);
  press("fix the build");
  await settle();
  // Ctrl+Enter as the kitty keyboard protocol sends it.
  press("\x1b[13;5u");
  await settle();
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: other }]);
  expect(shown).toEqual(["astrocode-1"]);
  expect(existsSync(dispatched)).toBe(false);
});

test("with a task typed, ↓ moves to the next project, past the rest of this one's sessions", async () => {
  const { press, started, app } = view();
  await settle(500);
  press("fix the build");
  await settle();
  press("\x1b[B");
  await settle();
  press("\r");
  await settle(500);
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: third }]);
});

test("with the box empty, ↓ moves to the next session in the same project", async () => {
  const { press, started, app } = view();
  await settle(500);
  press("\x1b[B");
  await settle();
  press("fix the build");
  await settle();
  press("\r");
  await settle(500);
  app.unmount();
  expect(started).toEqual([{ task: "fix the build", cwd: other }]);
});

test("Enter or → on one of astrocode's conversations shows it, and Esc goes back to the one the view was opened from", async () => {
  const { press, shown, app } = view({ here: "astrocode-1", mine: ["first", "second"] });
  await settle(500);
  press("\x1b[B");
  await settle();
  press("\r");
  await settle();
  press("\x1b[C");
  await settle();
  press("\x1b");
  await settle();
  app.unmount();
  expect(shown).toEqual(["astrocode-2", "astrocode-2", "astrocode-1"]);
});

test("Ctrl+X stops one of astrocode's conversations, and its row goes", async () => {
  const { press, stopped, app, screen } = view({ here: "astrocode-1", mine: ["first"] });
  await settle(500);
  press("\x18");
  await settle(500);
  app.unmount();
  expect(stopped).toEqual(["astrocode-1"]);
  expect(screen().split("Conversations").at(-1)).toContain("Stopped first.");
});

test("the box mentions ← while the view would list a conversation besides this one", async () => {
  expect(await othersListed(undefined)).toBe(true);
  const kept = await Bun.file(listed).text();
  try {
    // A conversation handed to the background service before is listed there, as this one.
    writeFileSync(listed, JSON.stringify([{ id: "3a1b2c3d", cwd: here, kind: "background", startedAt: 4, state: "stopped", sessionId: "this-one" }]));
    expect(await othersListed("this-one")).toBe(false);
    expect(await othersListed("another")).toBe(true);
    writeFileSync(listed, "[]");
    expect(await othersListed(undefined)).toBe(false);
    // A `claude` that can't list them says nothing worth a hint.
    writeFileSync(listed, "not json");
    expect(await othersListed(undefined)).toBe(false);
  } finally {
    writeFileSync(listed, kept);
  }
});

test("having opened the view is remembered, so the box stops mentioning ← next time", async () => {
  const kept = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = root;
  try {
    expect((await loadSettings()).agentsViewed).toBeUndefined();
    await remember({ agentsViewed: true });
    expect((await loadSettings()).agentsViewed).toBe(true);
  } finally {
    if (kept === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = kept;
  }
});

test("draws each conversation with the Ledger's mark for its state, under counts of each, and never the state's word", async () => {
  const kept = await Bun.file(listed).text();
  writeFileSync(
    listed,
    JSON.stringify([
      { id: "4a1b2c3d", cwd: other, kind: "background", startedAt: 1, state: "blocked", pid: 1, status: "waiting", name: "asking" },
      // Handed to the background service as astrocode quit: listed as needing input, it only waits for a prompt.
      { id: "5a1b2c3d", cwd: other, kind: "background", startedAt: 2, state: "blocked", pid: 2, status: "idle", name: "handed" },
      { id: "6a1b2c3d", cwd: other, kind: "background", startedAt: 3, state: "working", pid: 3, status: "busy", name: "busy" },
      { id: "7a1b2c3d", cwd: third, kind: "background", startedAt: 4, state: "failed", name: "broke" },
      { id: "8a1b2c3d", cwd: third, kind: "background", startedAt: 5, state: "stopped", name: "halted" },
    ]),
  );
  try {
    const { fleet, app, screen } = view({ here: "astrocode-1", mine: ["first", "second"], settings: { model: "claude-opus-5-5", effort: "xhigh", mode: "default" } });
    fleet.get("astrocode-2")?.store.emit({ kind: "permission", request: { id: "p", toolName: "Bash", input: { command: "rm -rf dist" } } });
    await settle(500);
    app.unmount();
    const last = screen().split("Conversations").at(-1) ?? "";
    const row = (name: string) => last.split("\n").find((line) => line.includes(` ${name} `)) ?? "";
    expect(last).toContain("new ones start in ~/here · Opus 5.5 xhigh · ask first");
    expect(last).toContain("2 need you · 2 working · 1 failed");
    expect(row("first")).toMatch(/◐ first {2}\(this one\)/);
    expect(row("second")).toContain("◇ second");
    expect(row("asking")).toContain("◇ asking");
    expect(row("handed")).toContain("○ handed");
    expect(row("busy")).toContain("◐ busy");
    expect(row("broke")).toContain("✕ broke");
    expect(row("halted")).toContain("■ halted");
    for (const word of ["Working", "Needs input", "Done", "Failed", "Stopped", "Idle"]) expect(last).not.toContain(word);
  } finally {
    writeFileSync(listed, kept);
  }
});
